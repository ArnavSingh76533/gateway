"""Provider-reported limits, not inferred subscription balances."""

import asyncio
import json
import math
import re
import time
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

import httpx
from fastapi import APIRouter, Request
from sqlalchemy import func, select

from .auth import DB, CurrentUser
from .dashboard import owned_provider
from .errors import UpstreamError, fail
from .models import Provider, RequestLog

router = APIRouter(prefix="/api", tags=["Provider quotas"])


def number(raw: Any) -> float | None:
    try:
        value = float(raw)
        return value if math.isfinite(value) and value >= 0 else None
    except (TypeError, ValueError):
        return None


def reset_time(raw: str | None, now: float) -> float | None:
    if not raw:
        return None
    raw = raw.strip()
    numeric = number(raw)
    if numeric is not None:
        if numeric > 1e12:
            return numeric / 1000
        return numeric if numeric > 1e9 else now + numeric
    parts = re.findall(r"(\d+(?:\.\d+)?)(ms|s|m|h|d)", raw)
    if parts and "".join(n + unit for n, unit in parts) == raw:
        scale = {"ms": 0.001, "s": 1, "m": 60, "h": 3600, "d": 86400}
        return now + sum(float(n) * scale[unit] for n, unit in parts)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return (parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)).timestamp()
    except ValueError:
        try:
            return parsedate_to_datetime(raw).timestamp()
        except (ValueError, TypeError, OverflowError):
            return None


def header_windows(headers: httpx.Headers, now: float) -> list[dict[str, Any]]:
    windows = []
    for resource in ("requests", "tokens", "input-tokens", "output-tokens"):
        for prefix in ("x-ratelimit", "anthropic-ratelimit"):
            # Anthropic places the resource before the measurement name.
            def value(field: str) -> str | None:
                key = (
                    f"{prefix}-{resource}-{field}"
                    if prefix == "anthropic-ratelimit"
                    else f"{prefix}-{field}-{resource}"
                )
                return headers.get(key)

            limit, remaining = number(value("limit")), number(value("remaining"))
            if limit is None and remaining is None:
                continue
            windows.append(
                {
                    "resource": resource,
                    "limit": limit,
                    "remaining": remaining,
                    "reset_at": reset_time(value("reset"), now),
                    "observed_at": now,
                    "source": "response_headers",
                }
            )
            break
    if not windows and (headers.get("x-ratelimit-limit") or headers.get("x-ratelimit-remaining")):
        windows.append(
            {
                "resource": "requests",
                "limit": number(headers.get("x-ratelimit-limit")),
                "remaining": number(headers.get("x-ratelimit-remaining")),
                "reset_at": reset_time(headers.get("x-ratelimit-reset"), now),
                "observed_at": now,
                "source": "response_headers",
            }
        )
    return windows


async def capture(state: Any, pid: str, model: str | None, headers: httpx.Headers) -> None:
    now = time.time()
    windows = header_windows(headers, now)
    if not windows:
        return
    await state.shared.put(
        "quota:" + pid,
        json.dumps(
            {
                "model": model,
                "windows": windows,
                "observed_at": now,
            }
        ),
        172800,
    )


async def snapshot(state: Any, provider: Provider) -> dict[str, Any]:
    saved = json.loads(await state.shared.get("quota:" + provider.id) or "{}")
    balance = json.loads(await state.shared.get("balance:" + provider.id) or "{}")
    account = json.loads(await state.shared.get("account-quota:" + provider.id) or "{}")
    health = await state.shared.health(provider.id)
    return {
        "provider_id": provider.id,
        "provider_name": provider.name,
        "kind": provider.kind,
        "enabled": provider.enabled,
        "model": saved.get("model"),
        "windows": saved.get("windows", [])
        + balance.pop("windows", [])
        + account.get("windows", []),
        "balance": balance or None,
        "observed_at": saved.get("observed_at"),
        "retry_at": health.get("retry_at"),
        "status": health.get("status", "unknown"),
        "can_refresh": provider.kind in {"openrouter", "deepseek", "codex", "github", "kimi"},
    }


@router.get("/quotas")
async def quotas(request: Request, db: DB, user: CurrentUser) -> dict:
    providers = (
        await db.scalars(
            select(Provider)
            .where(Provider.user_id == user.id)
            .order_by(Provider.priority, Provider.name)
        )
    ).all()
    rows = await asyncio.gather(*(snapshot(request.app.state, p) for p in providers))
    since = time.time() - 86400
    usage = (
        await db.execute(
            select(
                RequestLog.provider_id,
                func.sum(RequestLog.input_tokens),
                func.sum(RequestLog.output_tokens),
                func.count(RequestLog.id),
            )
            .where(RequestLog.user_id == user.id, RequestLog.created_at >= since)
            .group_by(RequestLog.provider_id)
        )
    ).all()
    totals = {
        pid: {"input_tokens": incoming, "output_tokens": outgoing, "requests": count}
        for pid, incoming, outgoing, count in usage
    }
    for item in rows:
        item["gateway_usage_24h"] = totals.get(
            item["provider_id"],
            {
                "input_tokens": 0,
                "output_tokens": 0,
                "requests": 0,
            },
        )
    return {"data": rows, "server_time": time.time()}


@router.post("/providers/{pid}/quota-refresh")
async def refresh_balance(pid: str, request: Request, db: DB, user: CurrentUser) -> dict:
    from .discovery import adapter_for

    p = await owned_provider(db, user.id, pid)
    from .providers.catalog import DIRECT
    from .subscription_quotas import KINDS, fetch

    if p.kind in KINDS:
        if p.base_url.rstrip("/") != DIRECT[p.kind]["url"].rstrip("/"):
            raise fail(400, "Account quotas require the official provider endpoint.")
        if not await request.app.state.shared.put("balance-refresh:" + p.id, "1", 30, nx=True):
            raise fail(429, "Please wait 30 seconds before checking this account again.")
        try:
            async with asyncio.timeout(45):
                windows = await fetch(request.app.state, p)
            await request.app.state.shared.put(
                "account-quota:" + p.id, json.dumps({"windows": windows}), 86400
            )
        except (
            httpx.HTTPError,
            UpstreamError,
            TimeoutError,
            ValueError,
            TypeError,
            AttributeError,
            KeyError,
        ):
            raise fail(
                502,
                "The provider did not report account limits. Check account access or try again later.",
                "quota_unavailable",
            ) from None
        return await snapshot(request.app.state, p)
    if p.kind not in {"openrouter", "deepseek"}:
        raise fail(
            400,
            "This provider reports limits on inference responses. Send a request to update them.",
        )
    # Never send a saved credential to a different host than its configured connection.
    expected = {
        "openrouter": "https://openrouter.ai/api/v1",
        "deepseek": "https://api.deepseek.com",
    }
    if p.base_url.rstrip("/") not in {expected[p.kind], expected[p.kind] + "/v1"}:
        raise fail(400, "Balance refresh is only available on this provider's official endpoint.")
    if not await request.app.state.shared.put("balance-refresh:" + p.id, "1", 30, nx=True):
        raise fail(429, "Please wait 30 seconds before refreshing this balance again.")
    adapter = adapter_for(request.app.state, p)
    try:
        async with asyncio.timeout(15):
            if p.kind == "openrouter":
                data = (await adapter.get_json(expected[p.kind] + "/key")).get("data", {})
                balance = {
                    "unit": "USD",
                    "remaining": number(data.get("limit_remaining")),
                    "limit": number(data.get("limit")),
                    "used": number(data.get("usage")),
                    "label": "API key spending limit",
                    "reset_at": None,
                    "reset_schedule": data.get("limit_reset")
                    if data.get("limit_reset") in {"daily", "weekly", "monthly"}
                    else None,
                }
                free = data.get("free_model_daily_requests")
                if isinstance(free, dict) and number(free.get("remaining")) is not None:
                    now = time.time()
                    balance["windows"] = [
                        {
                            "resource": "free-model daily requests",
                            "limit": number(free.get("limit")),
                            "remaining": number(free.get("remaining")),
                            "reset_at": (now // 86400 + 1) * 86400,
                            "observed_at": now,
                            "source": "provider_api",
                        }
                    ]
            else:
                data = await adapter.get_json(expected[p.kind] + "/user/balance")
                entries = data.get("balance_infos", [])
                balance = {
                    "label": "Account credit",
                    "balances": [
                        {"unit": x.get("currency"), "remaining": number(x.get("total_balance"))}
                        for x in entries
                        if x.get("currency") in {"USD", "CNY"}
                    ],
                    "reset_at": None,
                }
        balance.update(observed_at=time.time(), source="provider_api")
        await request.app.state.shared.put("balance:" + p.id, json.dumps(balance), 86400)
    except (httpx.HTTPError, UpstreamError, TimeoutError, ValueError, TypeError, AttributeError):
        raise fail(
            502,
            "The provider did not return a balance. Check the connection and try again.",
            "quota_unavailable",
        ) from None
    return await snapshot(request.app.state, p)
