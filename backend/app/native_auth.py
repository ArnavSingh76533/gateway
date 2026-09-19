"""Native device authorization. No provider token is returned to the browser.

Wire formats referenced from 9router (MIT); see docs/third-party/9router-LICENSE.txt.
Codex device authorization follows the upstream OpenAI Codex login implementation.
"""

import asyncio
import base64
import json
import secrets
import time
import uuid
from typing import Any
from urllib.parse import quote, urlsplit

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from .auth import DB, CurrentUser
from .discovery import refresh
from .errors import UpstreamError, fail
from .models import AuditLog, Provider
from .providers.base import OpenAIAdapter
from .providers.catalog import DIRECT
from .schemas import ModelPreferences
from .security import token_hash

router = APIRouter(prefix="/api/oauth", tags=["Provider OAuth"])
DEVICE: dict[str, dict[str, str]] = {
    "github": {
        "start": "https://github.com/login/device/code",
        "token": "https://github.com/login/oauth/access_token",
        "client_id": "Iv1.b507a08c87ecfe98",
        "scope": "read:user",
        "verify": "github.com",
    },
    "kimi": {
        "start": "https://auth.kimi.com/api/oauth/device_authorization",
        "token": "https://auth.kimi.com/api/oauth/token",
        "client_id": "17e5f671-d194-4dfb-9706-5516cb48c098",
        "verify": "www.kimi.com",
    },
    "kilocode": {
        "start": "https://api.kilo.ai/api/device-auth/codes",
        "token": "https://api.kilo.ai/api/device-auth/codes",
        "client_id": "",
        "verify": "kilo.ai",
    },
    "codex": {
        "start": "https://auth.openai.com/api/accounts/deviceauth/usercode",
        "token": "https://auth.openai.com/oauth/token",
        "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
        "verify": "auth.openai.com",
    },
    "grok-cli": {
        "start": "https://auth.x.ai/oauth2/device/code",
        "token": "https://auth.x.ai/oauth2/token",
        "client_id": "b1a00492-073a-47ea-816f-4c329264a828",
        "scope": "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write",
        "verify": "auth.x.ai",
    },
}


def auth_headers(kind: str, device_id: str = "") -> dict[str, str]:
    headers = {"accept": "application/json", "user-agent": "Gateway/1.0"}
    if kind == "kimi":
        headers.update(
            {
                "X-Msh-Platform": "gateway",
                "X-Msh-Version": "1.0",
                "X-Msh-Device-Id": device_id,
                "X-Msh-Device-Name": "Gateway",
                "X-Msh-Device-Model": "server",
            }
        )
    return headers


async def auth_request(
    client: httpx.AsyncClient, method: str, url: str, **kwargs: Any
) -> tuple[int, dict]:
    """Fixed upstream URLs, no redirects, bounded bodies and sanitized failures."""
    try:
        async with asyncio.timeout(20):
            req = client.build_request(method, url, **kwargs)
            response = await client.send(req, stream=True, follow_redirects=False)
            try:
                raw = await OpenAIAdapter(client, "", {}, 65536).read_bytes(response)
                data = json.loads(raw) if raw else {}
                if not isinstance(data, dict):
                    raise ValueError()
                return response.status_code, data
            finally:
                await response.aclose()
    except (httpx.HTTPError, TimeoutError, ValueError, UpstreamError):
        raise UpstreamError(502, "provider_authorization_unavailable") from None


def checked_token(value: Any) -> str:
    if (
        not isinstance(value, str)
        or not 1 <= len(value) <= 16384
        or any(c.isspace() for c in value)
    ):
        raise UpstreamError(502, "invalid_provider_credentials")
    return value


def token_credentials(kind: str, data: dict, previous: dict | None = None) -> dict:
    result = {
        **(previous or {}),
        "auth_type": "oauth",
        "access_token": checked_token(data.get("access_token")),
    }
    if data.get("refresh_token"):
        result["refresh_token"] = checked_token(data["refresh_token"])
    lifetime = data.get("expires_in", 3600 if kind in {"codex", "grok-cli", "kimi"} else None)
    if lifetime is not None:
        seconds = float(lifetime)
        if not 0 < seconds < 366 * 86400:
            raise UpstreamError(502, "invalid_provider_credentials")
        result["expires_at"] = time.time() + seconds
    if kind == "codex":
        # Tokens came directly from the fixed issuer over TLS. Claims are only
        # routing metadata; they never authenticate a gateway user or grant access.
        try:
            raw = checked_token(data.get("id_token") or data.get("access_token")).split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
            account = claims.get("https://api.openai.com/auth", {}).get("chatgpt_account_id")
            if account:
                result["account_id"] = checked_token(account)
        except (ValueError, IndexError, AttributeError):
            pass
    return result


async def renew_credentials(client: httpx.AsyncClient, kind: str, creds: dict) -> dict:
    headers = auth_headers(kind, creds.get("device_id", ""))
    result = creds
    if creds.get("expires_at", float("inf")) <= time.time() + 90:
        if not creds.get("refresh_token"):
            raise UpstreamError(401, "provider_reconnect_required")
        config = DEVICE[kind]
        status, data = await auth_request(
            client,
            "POST",
            config["token"],
            headers=headers,
            data={
                "grant_type": "refresh_token",
                "client_id": config["client_id"],
                "refresh_token": creds["refresh_token"],
            },
        )
        if status != 200 or data.get("error"):
            raise UpstreamError(401 if status < 500 else 502, "provider_reconnect_required")
        result = token_credentials(kind, data, creds)
    if kind == "github" and result.get("copilot_expires_at", 0) <= time.time() + 90:
        status, data = await auth_request(
            client,
            "GET",
            "https://api.github.com/copilot_internal/v2/token",
            headers={
                **headers,
                "authorization": "Bearer " + result["access_token"],
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "GitHubCopilotChat/0.38.0",
            },
        )
        if status != 200:
            raise UpstreamError(403 if status < 500 else 502, "copilot_access_required")
        expiry = float(data.get("expires_at", 0))
        if not time.time() < expiry < time.time() + 366 * 86400:
            raise UpstreamError(502, "invalid_provider_credentials")
        result = {
            **result,
            "copilot_token": checked_token(data.get("token")),
            "copilot_expires_at": expiry,
        }
    return result


async def credentials_for(state: Any, provider_id: str) -> dict:
    # Serialize rotation across replicas and read the latest token after acquiring
    # the lease. Rotating refresh tokens must never be refreshed concurrently.
    async with state.shared.lease("oauth-refresh:" + provider_id):
        async with state.db() as db:
            p = await db.get(Provider, provider_id)
            if not p or not p.enabled:
                raise UpstreamError(401, "provider_connection_unavailable")
            creds = state.vault.open(p.encrypted_credentials)
            if creds.get("auth_type") != "oauth":
                return creds
            fresh = await renew_credentials(state.http, p.kind, creds)
            if fresh != creds:
                p.encrypted_credentials = state.vault.seal(fresh)
                await db.commit()
            return fresh


class Start(ModelPreferences):
    name: str = Field(min_length=1, max_length=80)
    priority: int = Field(default=10, ge=0, le=1000)


class Flow(BaseModel):
    flow_id: str = Field(min_length=32, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")


def check_kind(kind: str) -> dict:
    if kind not in DEVICE:
        raise fail(
            404,
            "Native sign-in is not available for this provider. Use its API key connector where available.",
        )
    return DEVICE[kind]


@router.post("/{kind}/start")
async def start(kind: str, body: Start, request: Request, db: DB, user: CurrentUser) -> dict:
    config = check_kind(kind)
    if request.headers.get("origin", "") not in request.app.state.settings.allowed_origins:
        raise fail(403, "Origin is not allowed.")
    if body.preferred_only and not body.preferred_models:
        raise fail(422, "Choose at least one preferred model.")
    await request.app.state.shared.rate_limit("oauth-start:" + user.id, 5)
    if await db.scalar(
        select(Provider.id).where(Provider.user_id == user.id, Provider.name == body.name)
    ):
        raise fail(409, "A connection with this name already exists.")
    if (
        await db.scalar(
            select(func.count()).select_from(Provider).where(Provider.user_id == user.id)
        )
        or 0
    ) >= 150:
        raise fail(409, "At most 150 provider connections are allowed.")
    device_id = str(uuid.uuid4())
    params = {"client_id": config["client_id"]}
    if config.get("scope"):
        params["scope"] = config["scope"]
    if kind == "grok-cli":
        params["referrer"] = "grok-build"
    try:
        status, data = await auth_request(
            request.app.state.http,
            "POST",
            config["start"],
            headers=auth_headers(kind, device_id),
            **(
                {"json": params}
                if kind == "codex"
                else {"json": {}}
                if kind == "kilocode"
                else {"data": params}
            ),
        )
        if status not in {200, 201}:
            raise UpstreamError(502, "provider_authorization_unavailable")
        code = (
            data.get("device_auth_id")
            if kind == "codex"
            else data.get("code")
            if kind == "kilocode"
            else data.get("device_code")
        )
        code = checked_token(code)
        user_code = checked_token(data.get("user_code") or data.get("usercode") or data.get("code"))
        verify = (
            "https://auth.openai.com/codex/device"
            if kind == "codex"
            else data.get("verification_uri_complete")
            or data.get("verificationUrl")
            or data.get("verification_uri")
        )
        parsed = urlsplit(verify or "")
        allowed = {config["verify"]}
        if kind == "kilocode":
            allowed.update({"app.kilo.ai", "api.kilo.ai", "kilocode.ai"})
        if kind == "grok-cli":
            allowed.add("accounts.x.ai")
        if (
            parsed.scheme != "https"
            or parsed.hostname not in allowed
            or parsed.username
            or parsed.password
            or parsed.port not in {None, 443}
        ):
            raise ValueError()
        ttl = min(900, max(30, int(data.get("expires_in") or data.get("expiresIn") or 900)))
        interval = min(30, max(3, int(data.get("interval") or 5)))
    except (UpstreamError, ValueError, TypeError):
        raise fail(
            502,
            "The provider could not start sign-in. Check availability or use an API key.",
            "oauth_start_failed",
        ) from None
    flow_id = secrets.token_urlsafe(32)
    record = {
        **body.model_dump(),
        "kind": kind,
        "user_id": user.id,
        "session": token_hash(request.cookies.get("gw_session", "")),
        "device_code": code,
        "user_code": user_code,
        "device_id": device_id,
        "interval": interval,
        "next_poll": time.time() + interval,
        "expires_at": time.time() + ttl,
    }
    await request.app.state.shared.put(
        "device-oauth:" + token_hash(flow_id), request.app.state.vault.seal(record), ttl
    )
    return {
        "flow_id": flow_id,
        "verification_url": verify,
        "user_code": user_code,
        "expires_in": ttl,
        "interval": interval,
        "flow": "device",
    }


async def owned_flow(kind: str, body: Flow, request: Request, user: Any) -> tuple[str, dict]:
    check_kind(kind)
    key = "device-oauth:" + token_hash(body.flow_id)
    encrypted = await request.app.state.shared.get(key)
    if not encrypted:
        raise fail(400, "Sign-in expired or was cancelled. Start again.", "oauth_state_invalid")
    record = request.app.state.vault.open(encrypted)
    if (
        record["kind"] != kind
        or record["user_id"] != user.id
        or not secrets.compare_digest(
            record["session"], token_hash(request.cookies.get("gw_session", ""))
        )
    ):
        raise fail(
            403,
            "Complete sign-in from the same gateway account and browser.",
            "oauth_session_mismatch",
        )
    return key, record


async def poll_upstream(state: Any, kind: str, record: dict) -> tuple[int, dict]:
    config = DEVICE[kind]
    headers = auth_headers(kind, record["device_id"])
    if kind == "kilocode":
        status, data = await auth_request(
            state.http,
            "GET",
            config["token"] + "/" + quote(record["device_code"], safe=""),
            headers=headers,
        )
        if status == 202 or (status == 200 and data.get("status") == "pending"):
            return 200, {"error": "authorization_pending"}
        return status, {"access_token": data.get("token")} if data.get(
            "status"
        ) == "approved" else {"error": "access_denied"}
    if kind == "codex":
        status, data = await auth_request(
            state.http,
            "POST",
            "https://auth.openai.com/api/accounts/deviceauth/token",
            headers=headers,
            json={"device_auth_id": record["device_code"], "user_code": record["user_code"]},
        )
        if status in {403, 404}:
            return 200, {"error": "authorization_pending"}
        if status != 200:
            return status, data
        return await auth_request(
            state.http,
            "POST",
            config["token"],
            headers=headers,
            data={
                "grant_type": "authorization_code",
                "client_id": config["client_id"],
                "code": checked_token(data.get("authorization_code")),
                "code_verifier": checked_token(data.get("code_verifier")),
                "redirect_uri": "https://auth.openai.com/deviceauth/callback",
            },
        )
    return await auth_request(
        state.http,
        "POST",
        config["token"],
        headers=headers,
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "client_id": config["client_id"],
            "device_code": record["device_code"],
        },
    )


@router.post("/{kind}/poll")
async def poll(kind: str, body: Flow, request: Request, db: DB, user: CurrentUser) -> dict:
    state = request.app.state
    await owned_flow(kind, body, request, user)
    async with state.shared.lease("device-poll:" + token_hash(body.flow_id)):
        key, record = await owned_flow(kind, body, request, user)
        if record.get("provider_id"):
            return {"status": "connected", "provider_id": record["provider_id"]}
        now = time.time()
        interval = record["interval"]
        if now < record["next_poll"]:
            return {"status": "pending", "interval": max(1, int(record["next_poll"] - now + 1))}
        record["next_poll"] = now + interval
        ttl = max(1, int(record["expires_at"] - now))
        await state.shared.put(key, state.vault.seal(record), ttl)
        try:
            status, data = await poll_upstream(state, kind, record)
            if data.get("error") in {"authorization_pending", "slow_down"}:
                if data["error"] == "slow_down":
                    record["interval"] = min(60, interval + 5)
                    record["next_poll"] = time.time() + record["interval"]
                    await state.shared.put(key, state.vault.seal(record), ttl)
                return {"status": "pending", "interval": record["interval"]}
            if status != 200 or data.get("error"):
                await state.shared.delete(key)
                raise fail(
                    400, "Provider sign-in was denied or expired. Start again.", "oauth_denied"
                )
            creds = token_credentials(kind, data)
            creds["device_id"] = record["device_id"]
            creds = await renew_credentials(state.http, kind, creds)
        except (UpstreamError, ValueError, TypeError):
            raise fail(
                502,
                "Could not finish provider sign-in. Check your account access and try again.",
                "oauth_exchange_failed",
            ) from None
        if (
            await db.scalar(
                select(func.count()).select_from(Provider).where(Provider.user_id == user.id)
            )
            or 0
        ) >= 150:
            raise fail(409, "At most 150 provider connections are allowed.")
        p = Provider(
            user_id=user.id,
            kind=kind,
            name=record["name"],
            base_url=DIRECT[kind]["url"],
            encrypted_credentials=state.vault.seal(creds),
            priority=record["priority"],
            preferred_models=record["preferred_models"],
            preferred_only=record["preferred_only"],
        )
        db.add(p)
        try:
            await db.flush()
            db.add(AuditLog(user_id=user.id, action="provider.oauth_connected", target_id=p.id))
            await db.commit()
        except IntegrityError:
            await db.rollback()
            await state.shared.delete(key)
            raise fail(
                409, "A connection with this name already exists. Start again with a new name."
            ) from None
        await state.shared.put(key, state.vault.seal({**record, "provider_id": p.id}), 180)
    discovery = await refresh(state, p.id)
    return {"status": "connected", "provider_id": p.id, "discovery": discovery}


@router.post("/{kind}/cancel")
async def cancel(kind: str, body: Flow, request: Request, user: CurrentUser) -> dict:
    await owned_flow(kind, body, request, user)
    async with request.app.state.shared.lease("device-poll:" + token_hash(body.flow_id)):
        key, record = await owned_flow(kind, body, request, user)
        await request.app.state.shared.delete(key)
    return {
        "status": "connected" if record.get("provider_id") else "cancelled",
        "provider_id": record.get("provider_id"),
    }
