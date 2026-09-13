"""Restricted management. Roles are granted using the server CLI, never public signup."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select

from .auth import DB, CurrentUser, user_view
from .errors import fail
from .models import (
    AuditLog,
    Provider,
    PublishedModel,
    RegistryModel,
    RequestLog,
    Session,
    SiteConfiguration,
    User,
)
from .site_config import SiteOptions, site_options

router = APIRouter(prefix="/api", tags=["Administration"])


async def administrator(user: CurrentUser) -> User:
    if not user.is_admin:
        raise fail(403, "Administrator access is required.", "admin_required")
    return user


AdminUser = Annotated[User, Depends(administrator)]


@router.get("/site")
async def public_settings(request: Request, db: DB) -> dict:
    options = await site_options(db, request.app.state.settings)
    return options.model_dump(
        include={
            "site_name",
            "tagline",
            "welcome_text",
            "accent",
            "default_mode",
            "default_stream",
            "default_retries",
            "shared_models_enabled",
        }
    )


@router.get("/admin/settings")
async def get_settings(request: Request, db: DB, user: AdminUser) -> dict:
    options = await site_options(db, request.app.state.settings)
    return {
        "settings": options.model_dump(),
        "limits": {
            "requests_per_minute": request.app.state.settings.requests_per_minute,
            "max_retries": request.app.state.settings.max_retries,
            "registration_allowed": request.app.state.settings.allow_registration,
        },
    }


@router.put("/admin/settings")
async def save_settings(body: SiteOptions, request: Request, db: DB, user: AdminUser) -> dict:
    config = request.app.state.settings
    if (
        body.requests_per_minute > config.requests_per_minute
        or body.default_retries > config.max_retries
    ):
        raise fail(422, "Keep rate and retry limits within the server's configured maximums.")
    if body.registration_open and not config.allow_registration:
        raise fail(422, "Registration is disabled in the server configuration.")
    row = await db.get(SiteConfiguration, "global")
    if not row:
        row = SiteConfiguration(id="global")
        db.add(row)
    row.settings = body.model_dump()
    db.add(AuditLog(user_id=user.id, action="admin.settings.updated", target_id="global"))
    await db.commit()
    return body.model_dump()


@router.get("/admin/summary")
async def summary(db: DB, user: AdminUser) -> dict:
    return {
        "users": await db.scalar(select(func.count(User.id))),
        "suspended_users": await db.scalar(
            select(func.count(User.id)).where(User.disabled.is_(True))
        ),
        "requests": await db.scalar(select(func.count(RequestLog.id))),
        "published_models": await db.scalar(
            select(func.count(PublishedModel.model_id)).where(PublishedModel.enabled.is_(True))
        ),
        "sponsored_cost": await db.scalar(select(func.sum(RequestLog.sponsored_cost))),
    }


@router.get("/admin/users")
async def users(db: DB, user: AdminUser, search: str = "", offset: int = Query(0, ge=0)) -> dict:
    query = select(User)
    if search:
        query = query.where(User.email.icontains(search[:120], autoescape=True))
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = (
        await db.scalars(query.order_by(User.created_at, User.id).limit(50).offset(offset))
    ).all()
    return {
        "data": [user_view(u) | {"disabled": u.disabled, "created_at": u.created_at} for u in rows],
        "total": total,
    }


class AccountStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    disabled: bool


@router.patch("/admin/users/{uid}")
async def account_status(uid: str, body: AccountStatus, db: DB, user: AdminUser) -> dict:
    target = await db.get(User, uid)
    if not target:
        raise fail(404, "Account not found.")
    if target.id == user.id or target.is_admin:
        raise fail(
            403, "Administrator accounts can only be changed using the server admin command."
        )
    target.disabled = body.disabled
    if body.disabled:
        await db.execute(delete(Session).where(Session.user_id == target.id))
    db.add(
        AuditLog(
            user_id=user.id,
            action="admin.user.suspended" if body.disabled else "admin.user.restored",
            target_id=uid,
        )
    )
    await db.commit()
    return {"id": uid, "disabled": target.disabled}


class PublishOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    requests_per_minute: int = Field(default=5, ge=1, le=120)
    max_output_tokens: int = Field(default=1024, ge=128, le=8192)


@router.get("/admin/shared-models")
async def shared_models(db: DB, user: AdminUser) -> list[dict]:
    rows = (
        await db.execute(
            select(PublishedModel, RegistryModel, Provider)
            .join(RegistryModel, RegistryModel.id == PublishedModel.model_id)
            .join(Provider, Provider.id == RegistryModel.provider_id)
            .order_by(RegistryModel.name)
        )
    ).all()
    return [
        {
            "id": m.id,
            "name": m.name,
            "model_id": m.model_id,
            "provider_name": p.name,
            "enabled": shared.enabled,
            "requests_per_minute": shared.requests_per_minute,
            "max_output_tokens": shared.max_output_tokens,
            "owned": p.user_id == user.id,
        }
        for shared, m, p in rows
    ]


@router.put("/admin/shared-models/{mid}")
async def publish(mid: str, body: PublishOptions, db: DB, user: AdminUser) -> dict:
    model = await db.scalar(
        select(RegistryModel)
        .join(Provider)
        .where(
            RegistryModel.id == mid,
            Provider.user_id == user.id,
        )
    )
    if not model:
        raise fail(404, "Select a model from a provider you own.")
    if model.capabilities.get("chat") is not True:
        raise fail(422, "Shared models must have confirmed chat capability.")
    row = await db.get(PublishedModel, mid)
    if not row:
        row = PublishedModel(model_id=mid)
        db.add(row)
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.add(
        AuditLog(
            user_id=user.id,
            action="admin.model.published" if body.enabled else "admin.model.unpublished",
            target_id=mid,
        )
    )
    await db.commit()
    return {"id": mid, **body.model_dump()}
