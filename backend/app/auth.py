import secrets
import time
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db
from .errors import fail
from .models import AuditLog, GatewayKey, Session, User
from .schemas import Credentials, NewGatewayKey, Register
from .security import DUMMY_HASH, hash_password, new_key, token_hash, verify_password

router = APIRouter(prefix="/api/auth", tags=["Accounts"])
DB = Annotated[AsyncSession, Depends(get_db)]


async def current_user(request: Request, db: DB) -> User:
    raw = request.cookies.get("gw_session", "")
    session = await db.get(Session, token_hash(raw)) if raw else None
    if not session or session.expires_at < time.time():
        raise fail(401, "Please sign in.", "authentication_required")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        csrf = request.headers.get("x-csrf-token", "")
        if not csrf or not secrets.compare_digest(session.csrf_hash, token_hash(csrf)):
            raise fail(403, "Invalid CSRF token.", "csrf_failed")
    user = await db.get(User, session.user_id)
    if not user:
        raise fail(401, "Please sign in.", "authentication_required")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


@dataclass(frozen=True)
class Principal:
    user_id: str
    key_id: str | None = None


async def gateway_auth(request: Request, db: DB) -> Principal:
    auth = request.headers.get("authorization", "")
    if not auth and request.url.path.startswith("/v1/messages"):
        auth = "Bearer " + request.headers.get("x-api-key", "")
    scheme, _, raw = auth.partition(" ")
    if scheme.lower() != "bearer" or not raw.startswith("gw_") or len(raw) > 100:
        raise fail(401, "A valid Gateway API key is required.", "invalid_api_key")
    key = await db.scalar(
        select(GatewayKey).where(
            GatewayKey.token_hash == token_hash(raw), GatewayKey.revoked.is_(False)
        )
    )
    if not key or (key.expires_at and key.expires_at < time.time()):
        raise fail(401, "Invalid or expired Gateway API key.", "invalid_api_key")
    await request.app.state.shared.rate_limit(
        "user:" + key.user_id, request.app.state.settings.requests_per_minute
    )
    key.last_used_at = time.time()
    await db.commit()
    return Principal(key.user_id, key.id)


GatewayPrincipal = Annotated[Principal, Depends(gateway_auth)]


async def establish_session(
    request: Request, response: Response, db: AsyncSession, user: User
) -> None:
    old = request.cookies.get("gw_session")
    if old:
        old_row = await db.get(Session, token_hash(old))
        if old_row:
            await db.delete(old_row)
    raw, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    seconds = request.app.state.settings.session_hours * 3600
    db.add(
        Session(
            token_hash=token_hash(raw),
            user_id=user.id,
            csrf_hash=token_hash(csrf),
            expires_at=time.time() + seconds,
        )
    )
    await db.commit()
    for name, value, http_only in [("gw_session", raw, True), ("gw_csrf", csrf, False)]:
        response.set_cookie(
            name,
            value,
            max_age=seconds,
            httponly=http_only,
            secure=request.app.state.settings.cookie_secure,
            samesite="lax",
            path="/",
        )


def user_view(user: User) -> dict[str, str]:
    return {"id": user.id, "name": user.name, "email": user.email}


async def issue_key(db: AsyncSession, user_id: str, body: NewGatewayKey) -> tuple[GatewayKey, str]:
    raw = new_key()
    key = GatewayKey(
        user_id=user_id,
        name=body.name,
        prefix=raw[:11],
        token_hash=token_hash(raw),
        expires_at=time.time() + body.expires_in_days * 86400 if body.expires_in_days else None,
    )
    db.add(key)
    await db.flush()
    db.add(AuditLog(user_id=user_id, action="key.created", target_id=key.id))
    return key, raw


@router.post("/register", status_code=201)
async def register(body: Register, request: Request, response: Response, db: DB) -> dict:
    settings = request.app.state.settings
    if not settings.allow_registration:
        raise fail(403, "Registration is currently closed.", "registration_closed")
    if settings.registration_code and not secrets.compare_digest(
        body.registration_code, settings.registration_code
    ):
        raise fail(403, "An invitation code is required.", "invalid_invitation")
    user = User(
        email=str(body.email).strip().lower(),
        name=body.name.strip(),
        password_hash=await hash_password(body.password),
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise fail(
            409, "Unable to create this account. Try signing in.", "account_exists"
        ) from None
    _, raw = await issue_key(db, user.id, NewGatewayKey(name="Default key"))
    db.add(AuditLog(user_id=user.id, action="account.created"))
    await establish_session(request, response, db, user)
    return {"user": user_view(user), "gateway_key": raw}


@router.post("/login")
async def login(body: Credentials, request: Request, response: Response, db: DB) -> dict:
    user = await db.scalar(select(User).where(User.email == str(body.email).strip().lower()))
    valid = await verify_password(user.password_hash if user else DUMMY_HASH, body.password)
    if not user or not valid:
        raise fail(401, "Incorrect email or password.", "invalid_credentials")
    db.add(AuditLog(user_id=user.id, action="account.login"))
    await establish_session(request, response, db, user)
    return {"user": user_view(user)}


@router.get("/me")
async def me(user: CurrentUser) -> dict:
    return user_view(user)


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, db: DB, user: CurrentUser) -> None:
    session = await db.get(Session, token_hash(request.cookies.get("gw_session", "")))
    if session:
        await db.delete(session)
    db.add(AuditLog(user_id=user.id, action="account.logout"))
    await db.commit()
    response.delete_cookie("gw_session")
    response.delete_cookie("gw_csrf")
