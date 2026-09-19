"""Account-bound OpenRouter PKCE. Device sign-ins live in native_auth."""

import asyncio
import base64
import hashlib
import json
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import Field
from sqlalchemy import func, select

from .auth import DB, CurrentUser
from .dashboard import create_provider
from .errors import UpstreamError, fail
from .models import Provider
from .providers.base import OpenAIAdapter
from .schemas import ModelPreferences, ProviderInput
from .security import token_hash

router = APIRouter(prefix="/api/oauth/openrouter", tags=["Provider OAuth"])


class OAuthStart(ModelPreferences):
    priority: int = Field(default=10, ge=0, le=1000)
    name: str = Field(default="OpenRouter", min_length=1, max_length=80)


@router.post("/start")
async def start(body: OAuthStart, request: Request, db: DB, user: CurrentUser) -> dict:
    if body.preferred_only and not body.preferred_models:
        raise fail(422, "Choose at least one preferred model.")
    await request.app.state.shared.rate_limit("oauth-start:" + user.id, 5)
    if await db.scalar(
        select(Provider.id).where(Provider.user_id == user.id, Provider.name == body.name)
    ):
        raise fail(409, "A connection with this name already exists. Choose another name.")
    if (
        await db.scalar(
            select(func.count()).select_from(Provider).where(Provider.user_id == user.id)
        )
        or 0
    ) >= 150:
        raise fail(409, "At most 150 provider connections are allowed.")
    origin = request.headers.get("origin", "")
    if origin not in request.app.state.settings.allowed_origins:
        raise fail(403, "Origin is not allowed.")
    verifier, state = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    callback = origin + "/api/oauth/openrouter/callback?" + urlencode({"state": state})
    record = {
        "user_id": user.id,
        "session": token_hash(request.cookies.get("gw_session", "")),
        "verifier": verifier,
        "name": body.name,
        "priority": body.priority,
        "preferred_models": body.preferred_models,
        "preferred_only": body.preferred_only,
    }
    await request.app.state.shared.put(
        "oauth:" + token_hash(state), request.app.state.vault.seal(record), 600
    )
    return {
        "authorization_url": "https://openrouter.ai/auth?"
        + urlencode(
            {
                "callback_url": callback,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        ),
        "expires_in": 600,
    }


@router.get("/callback")
async def callback(
    request: Request, db: DB, user: CurrentUser, state: str = "", code: str = "", error: str = ""
) -> RedirectResponse:
    if not state or len(state) > 128 or len(code) > 4096:
        raise fail(
            400,
            "Invalid or expired provider sign-in. Start again from Providers.",
            "oauth_state_invalid",
        )
    shared = request.app.state.shared
    key = "oauth:" + token_hash(state)
    encrypted = await shared.get(key)
    if not encrypted:
        raise fail(
            400,
            "This provider sign-in expired or was already used. Start again.",
            "oauth_state_invalid",
        )
    record = request.app.state.vault.open(encrypted)
    session = token_hash(request.cookies.get("gw_session", ""))
    if record.get("user_id") != user.id or not secrets.compare_digest(
        record.get("session", ""), session
    ):
        raise fail(
            403,
            "Complete provider sign-in from the same gateway account and browser.",
            "oauth_session_mismatch",
        )
    if not await shared.consume(key):
        raise fail(400, "This provider sign-in was already used.", "oauth_state_invalid")
    if error or not code:
        return RedirectResponse("/?connection=cancelled#providers", status_code=303)
    response = None
    try:
        async with asyncio.timeout(20):
            req = request.app.state.http.build_request(
                "POST",
                "https://openrouter.ai/api/v1/auth/keys",
                json={
                    "code": code,
                    "code_verifier": record["verifier"],
                    "code_challenge_method": "S256",
                },
            )
            response = await request.app.state.http.send(req, stream=True)
            if response.status_code != 200:
                return RedirectResponse("/?connection=failed#providers", status_code=303)
            reader = OpenAIAdapter(request.app.state.http, "", {}, 16384)
            data = json.loads(await reader.read_bytes(response))
            api_key = data.get("key")
            if not isinstance(api_key, str) or not 1 <= len(api_key) <= 8192:
                return RedirectResponse("/?connection=failed#providers", status_code=303)
    except (httpx.HTTPError, UpstreamError, TimeoutError, ValueError, AttributeError):
        return RedirectResponse("/?connection=failed#providers", status_code=303)
    finally:
        if response:
            await response.aclose()
    try:
        await create_provider(
            ProviderInput(
                kind="openrouter",
                name=record["name"],
                api_key=api_key,
                priority=record.get("priority", 10),
                preferred_models=record.get("preferred_models", []),
                preferred_only=record.get("preferred_only", False),
            ),
            request,
            db,
            user,
        )
    except HTTPException:
        return RedirectResponse("/?connection=failed#providers", status_code=303)
    return RedirectResponse("/?connection=connected#providers", status_code=303)
