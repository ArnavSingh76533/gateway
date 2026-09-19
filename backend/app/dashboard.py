import csv
import io
import time
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import Integer, case, cast, func, or_, select
from sqlalchemy.exc import IntegrityError

from .auth import DB, CurrentUser, issue_key
from .discovery import refresh
from .errors import fail
from .models import AuditLog, GatewayKey, Provider, RegistryModel, RequestLog
from .providers import ADAPTERS
from .providers.catalog import CATALOG
from .schemas import ModelInput, NewGatewayKey, ProviderInput, ProviderPatch
from .security import validate_base_url, validate_headers
from .site_config import published_ids, site_options

router = APIRouter(prefix="/api", tags=["Dashboard"])


def public(row: Any, fields: str) -> dict[str, Any]:
    return {key: getattr(row, key) for key in fields.split()}


async def owned_provider(db: Any, user_id: str, pid: str) -> Provider:
    p = await db.scalar(select(Provider).where(Provider.id == pid, Provider.user_id == user_id))
    if not p:
        raise fail(404, "Provider not found.", "not_found")
    return p


@router.get("/catalog")
async def catalog(user: CurrentUser) -> list[dict[str, Any]]:
    return [{**entry, "kind": entry["id"], "base_url": entry["url"]} for entry in CATALOG]


@router.get("/providers")
async def providers(request: Request, db: DB, user: CurrentUser) -> list[dict]:
    rows = (
        await db.execute(
            select(Provider, func.count(RegistryModel.id))
            .outerjoin(RegistryModel, RegistryModel.provider_id == Provider.id)
            .where(Provider.user_id == user.id)
            .group_by(Provider.id)
            .order_by(Provider.priority, Provider.name)
        )
    ).all()
    result = []
    for p, count in rows:
        item = public(
            p,
            "id kind name base_url enabled priority pinned preferred_models preferred_only created_at discovered_at discovery_error",
        )
        item["models_count"] = count
        item["health"] = await request.app.state.shared.health(p.id)
        # Provider-level health is supplemented by the model-level routing health in /api/models.
        item["has_credentials"] = True
        item["auth_type"] = request.app.state.vault.open(p.encrypted_credentials).get(
            "auth_type", "api_key"
        )
        result.append(item)
    return result


@router.post("/providers", status_code=201)
async def create_provider(body: ProviderInput, request: Request, db: DB, user: CurrentUser) -> dict:
    if body.kind in {"github", "codex", "grok-cli"}:
        raise fail(422, "Use this provider’s native sign-in flow.")
    if body.preferred_only and not body.preferred_models:
        raise fail(422, "Choose at least one preferred model before limiting automatic routing.")
    if body.kind not in {"custom", "ollama-local"} and not body.api_key:
        raise fail(422, "An API key is required for this provider.")
    url = validate_base_url(
        body.base_url or ADAPTERS[body.kind].default_url,
        request.app.state.settings.private_upstream_hosts,
    )
    count = await db.scalar(
        select(func.count()).select_from(Provider).where(Provider.user_id == user.id)
    )
    if count and count >= 150:
        raise fail(409, "At most 150 provider connections are allowed.")
    p = Provider(
        user_id=user.id,
        kind=body.kind,
        name=body.name,
        base_url=url,
        enabled=body.enabled,
        priority=body.priority,
        preferred_models=body.preferred_models,
        preferred_only=body.preferred_only,
        encrypted_credentials=request.app.state.vault.seal(
            {"api_key": body.api_key, "headers": validate_headers(body.headers)}
        ),
    )
    db.add(p)
    try:
        await db.flush()
        for model in body.models:
            db.add(
                RegistryModel(
                    provider_id=p.id,
                    model_id=model.model_id,
                    name=model.name or model.model_id,
                    capabilities=model.capabilities.model_dump(),
                    context_window=model.context_window,
                    input_price=model.input_price,
                    output_price=model.output_price,
                    manual=True,
                    source="owner configured",
                )
            )
        db.add(AuditLog(user_id=user.id, action="provider.created", target_id=p.id))
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise fail(
            409, "Provider names and model IDs must be unique within this connection."
        ) from None
    discovery = await refresh(request.app.state, p.id)
    return {"id": p.id, "discovery": discovery}


@router.patch("/providers/{pid}")
async def patch_provider(
    pid: str, body: ProviderPatch, request: Request, db: DB, user: CurrentUser
) -> dict:
    p = await owned_provider(db, user.id, pid)
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    if "api_key" in data or "headers" in data:
        creds = request.app.state.vault.open(p.encrypted_credentials)
        if creds.get("auth_type") == "oauth":
            raise fail(
                422,
                "OAuth credentials are managed automatically. Reconnect the account to replace them.",
            )
        if body.api_key is not None:
            if not body.api_key and p.kind not in {"custom", "ollama-local"}:
                raise fail(422, "API key cannot be empty.")
            creds["api_key"] = body.api_key
        if body.headers is not None:
            creds["headers"] = validate_headers(body.headers)
        p.encrypted_credentials = request.app.state.vault.seal(creds)
        await request.app.state.shared.delete("health:" + p.id)
        await request.app.state.shared.delete("discovery:" + p.id)
        await request.app.state.shared.delete("quota:" + p.id)
        await request.app.state.shared.delete("balance:" + p.id)
        await request.app.state.shared.delete("account-quota:" + p.id)
        p.discovered_at = None
    for key in ("name", "enabled", "priority", "pinned", "preferred_models", "preferred_only"):
        if key in data:
            setattr(p, key, data[key])
    if p.preferred_only and not p.preferred_models:
        raise fail(422, "Choose at least one preferred model before limiting automatic routing.")
    db.add(AuditLog(user_id=user.id, action="provider.updated", target_id=p.id))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise fail(409, "A provider connection with that name already exists.") from None
    return {"id": p.id, "updated": True}


@router.delete("/providers/{pid}", status_code=204)
async def delete_provider(pid: str, db: DB, user: CurrentUser) -> None:
    p = await owned_provider(db, user.id, pid)
    await db.delete(p)
    db.add(AuditLog(user_id=user.id, action="provider.deleted", target_id=pid))
    await db.commit()


@router.post("/providers/{pid}/refresh")
async def refresh_provider(pid: str, request: Request, db: DB, user: CurrentUser) -> dict:
    await owned_provider(db, user.id, pid)
    db.add(AuditLog(user_id=user.id, action="provider.refreshed", target_id=pid))
    await db.commit()
    return await refresh(request.app.state, pid)


@router.get("/models")
async def models(
    request: Request,
    db: DB,
    user: CurrentUser,
    search: str = "",
    capability: str = "",
    provider: str = "",
    free_only: bool = False,
    owned_only: bool = False,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict:
    options = await site_options(db, request.app.state.settings)
    shared = set(await db.scalars(published_ids())) if options.shared_models_enabled else set()
    visible = Provider.user_id == user.id
    if not owned_only:
        visible = or_(visible, RegistryModel.id.in_(shared))
    query = select(RegistryModel, Provider).join(Provider).where(visible)
    if search:
        term = search[:120]
        query = query.where(
            or_(
                RegistryModel.model_id.icontains(term, autoescape=True),
                RegistryModel.name.icontains(term, autoescape=True),
                Provider.name.icontains(term, autoescape=True),
            )
        )
    if free_only:
        query = query.where(
            or_(
                (RegistryModel.input_price == 0) & (RegistryModel.output_price == 0),
                RegistryModel.id.in_(shared) & (Provider.user_id != user.id),
            )
        )
    if provider:
        query = query.where(Provider.id == provider)
    if capability:
        if capability not in (
            "chat",
            "tools",
            "vision",
            "audio",
            "json_mode",
            "streaming",
            "reasoning",
            "coding",
            "embeddings",
            "images",
            "transcription",
            "speech",
            "responses",
        ):
            raise fail(422, "Invalid capability.")
        query = query.where(RegistryModel.capabilities[capability].as_boolean().is_(True))
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = (
        await db.execute(
            query.order_by(RegistryModel.favorite.desc(), RegistryModel.model_id, RegistryModel.id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    result = []
    for m, p in rows:
        item = public(
            m,
            "id model_id name capabilities context_window input_price output_price available favorite manual source updated_at",
        )
        item.update(
            provider=p.kind,
            provider_name=p.name,
            provider_id=p.id,
            enabled=p.enabled,
            route_id=p.id + "::" + m.model_id,
            health=await request.app.state.shared.health(p.id + ":" + m.id),
            shared=m.id in shared and p.user_id != user.id,
            owned=p.user_id == user.id,
        )
        if p.user_id != user.id:
            item.update(input_price=0, output_price=0, provider_name="Community", favorite=False)
        result.append(item)
    return {"data": result, "total": total, "offset": offset, "limit": limit}


@router.put("/providers/{pid}/models")
async def save_model(pid: str, body: ModelInput, db: DB, user: CurrentUser) -> dict:
    await owned_provider(db, user.id, pid)
    m = await db.scalar(
        select(RegistryModel).where(
            RegistryModel.provider_id == pid, RegistryModel.model_id == body.model_id
        )
    )
    if not m:
        m = RegistryModel(provider_id=pid, model_id=body.model_id)
        db.add(m)
    m.name = body.name or body.model_id
    m.capabilities = body.capabilities.model_dump()
    m.context_window, m.input_price, m.output_price = (
        body.context_window,
        body.input_price,
        body.output_price,
    )
    m.manual, m.available, m.source, m.updated_at = True, True, "owner configured", time.time()
    db.add(AuditLog(user_id=user.id, action="model.configured", target_id=pid))
    await db.commit()
    return {"id": m.id}


@router.post("/models/{mid}/favorite")
async def favorite(mid: str, db: DB, user: CurrentUser) -> dict:
    m = await db.scalar(
        select(RegistryModel)
        .join(Provider)
        .where(RegistryModel.id == mid, Provider.user_id == user.id)
    )
    if not m:
        raise fail(404, "Model not found.")
    m.favorite = not m.favorite
    await db.commit()
    return {"favorite": m.favorite}


@router.get("/keys")
async def keys(db: DB, user: CurrentUser) -> list[dict]:
    rows = (
        await db.scalars(
            select(GatewayKey)
            .where(GatewayKey.user_id == user.id)
            .order_by(GatewayKey.created_at.desc())
        )
    ).all()
    return [public(k, "id name prefix created_at last_used_at expires_at revoked") for k in rows]


@router.post("/keys", status_code=201)
async def create_key(body: NewGatewayKey, db: DB, user: CurrentUser) -> dict:
    count = await db.scalar(
        select(func.count())
        .select_from(GatewayKey)
        .where(GatewayKey.user_id == user.id, GatewayKey.revoked.is_(False))
    )
    if count and count >= 50:
        raise fail(409, "Revoke an existing key before creating more than 50 active keys.")
    k, raw = await issue_key(db, user.id, body)
    await db.commit()
    return {"id": k.id, "name": k.name, "key": raw}


@router.delete("/keys/{kid}", status_code=204)
async def revoke_key(kid: str, db: DB, user: CurrentUser) -> None:
    k = await db.scalar(
        select(GatewayKey).where(GatewayKey.id == kid, GatewayKey.user_id == user.id)
    )
    if not k:
        raise fail(404, "Key not found.")
    k.revoked = True
    db.add(AuditLog(user_id=user.id, action="key.revoked", target_id=kid))
    await db.commit()


LOG_FIELDS = "id provider_name requested_model resolved_model endpoint status latency_ms input_tokens output_tokens estimated_cost attempts error_code created_at"


@router.get("/logs")
async def logs(
    db: DB,
    user: CurrentUser,
    offset: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=100),
    errors_only: bool = False,
) -> dict:
    query = select(RequestLog).where(RequestLog.user_id == user.id)
    if errors_only:
        query = query.where(RequestLog.status >= 400)
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = (
        await db.scalars(query.order_by(RequestLog.created_at.desc()).offset(offset).limit(limit))
    ).all()
    return {"data": [public(row, LOG_FIELDS) for row in rows], "total": total}


@router.get("/audit")
async def audits(db: DB, user: CurrentUser) -> list[dict]:
    rows = (
        await db.scalars(
            select(AuditLog)
            .where(AuditLog.user_id == user.id)
            .order_by(AuditLog.created_at.desc())
            .limit(100)
        )
    ).all()
    return [public(row, "id action target_id created_at") for row in rows]


@router.get("/usage")
async def usage(db: DB, user: CurrentUser, days: int = Query(7, ge=1, le=90)) -> dict:
    start = (int(time.time()) // 86400 - days + 1) * 86400
    condition = (RequestLog.user_id == user.id, RequestLog.created_at >= start)
    expressions = [
        func.count(RequestLog.id).label("requests"),
        func.sum(case((RequestLog.status < 400, 1), else_=0)).label("successes"),
        func.avg(RequestLog.latency_ms).label("avg_latency_ms"),
        func.sum(RequestLog.input_tokens).label("input_tokens"),
        func.sum(RequestLog.output_tokens).label("output_tokens"),
        func.sum(RequestLog.estimated_cost).label("estimated_cost"),
        func.count(RequestLog.estimated_cost).label("priced_requests"),
    ]
    summary = dict((await db.execute(select(*expressions).where(*condition))).mappings().one())
    day = cast(RequestLog.created_at / 86400, Integer).label("day")
    rows = (
        (await db.execute(select(day, *expressions).where(*condition).group_by(day).order_by(day)))
        .mappings()
        .all()
    )
    by_day = {r["day"]: dict(r) for r in rows}
    series = [
        by_day.get(
            start // 86400 + i,
            {
                "day": start // 86400 + i,
                "requests": 0,
                "successes": 0,
                "avg_latency_ms": None,
                "input_tokens": 0,
                "output_tokens": 0,
                "estimated_cost": None,
                "priced_requests": 0,
            },
        )
        for i in range(days)
    ]
    by_provider = (
        (
            await db.execute(
                select(RequestLog.provider_name, *expressions)
                .where(*condition)
                .group_by(RequestLog.provider_name)
            )
        )
        .mappings()
        .all()
    )
    return {
        "summary": summary,
        "series": series,
        "providers": [dict(p) for p in by_provider],
        "days": days,
    }


@router.get("/usage/export")
async def export(
    request: Request, user: CurrentUser, days: int = Query(30, ge=1, le=90)
) -> StreamingResponse:
    async def generate() -> Any:
        fields = "id provider_name resolved_model endpoint status latency_ms input_tokens output_tokens estimated_cost created_at".split()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(fields)
        yield output.getvalue()
        async with request.app.state.db() as db:
            rows = await db.stream_scalars(
                select(RequestLog)
                .where(
                    RequestLog.user_id == user.id,
                    RequestLog.created_at >= time.time() - days * 86400,
                )
                .order_by(RequestLog.created_at.desc())
                .execution_options(yield_per=500)
            )
            async for row in rows:
                output.seek(0)
                output.truncate(0)
                values = [getattr(row, f) for f in fields]
                values = [
                    ("'" + v)
                    if isinstance(v, str) and v.lstrip().startswith(("=", "+", "-", "@"))
                    else v
                    for v in values
                ]
                writer.writerow(values)
                yield output.getvalue()

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="gateway-usage.csv"'},
    )
