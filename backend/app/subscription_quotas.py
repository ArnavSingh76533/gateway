"""Read-only account quotas. Percentages and provider units are never called tokens."""

import time
from typing import Any

from .discovery import adapter_for
from .errors import UpstreamError
from .models import Provider
from .quotas import number, reset_time

KINDS = {"codex", "github", "kimi"}


def windows(kind: str, data: dict, now: float) -> list[dict]:
    result = []

    def add(label: str, limit: Any, remaining: Any, reset: Any) -> None:
        maximum, left = number(limit), number(remaining)
        if maximum is None and left is None:
            return
        result.append(
            {
                "resource": label,
                "limit": maximum,
                "remaining": left,
                "reset_at": reset_time(str(reset), now) if reset is not None else None,
                "observed_at": now,
                "source": "provider_api",
            }
        )

    if kind == "codex":
        groups = data.get("rate_limits_by_limit_id") or {
            "account": data.get("rate_limit", data.get("rate_limits", {}))
        }
        for name, group in groups.items():
            group = group.get("rate_limit", group)
            for window in ("primary_window", "secondary_window"):
                detail = group.get(window) or {}
                used = number(detail.get("used_percent"))
                if used is not None:
                    seconds = number(detail.get("limit_window_seconds"))
                    label = (
                        f"{name} {int(seconds / 3600)}h remaining (%)"
                        if seconds
                        else f"{name} {window.replace('_', ' ')} remaining (%)"
                    )
                    add(label, 100, max(0, 100 - used), detail.get("reset_at"))
    elif kind == "github":
        for name, detail in (data.get("quota_snapshots") or {}).items():
            if not isinstance(detail, dict) or detail.get("unlimited"):
                continue
            add(
                name.replace("_", " ") + " requests",
                detail.get("entitlement"),
                detail.get("remaining"),
                data.get("quota_reset_date"),
            )
    elif kind == "kimi":
        groups = [("Plan allowance (provider units)", data.get("usage") or {})]
        groups.extend(
            (f"Rate window {i + 1} (provider units)", item.get("detail") or {})
            for i, item in enumerate(data.get("limits") or [])
        )
        for name, detail in groups:
            limit, used, left = (
                number(detail.get("limit")),
                number(detail.get("used")),
                number(detail.get("remaining")),
            )
            if left is None and limit is not None and used is not None:
                left = max(0, limit - used)
            add(name, limit, left, detail.get("resetTime") or detail.get("reset_at"))
    return result


async def fetch(state: Any, provider: Provider) -> list[dict]:
    adapter = adapter_for(state, provider)
    await adapter.prepare()
    urls = {
        "codex": "https://chatgpt.com/backend-api/wham/usage",
        "github": "https://api.github.com/copilot_internal/user",
        "kimi": "https://api.kimi.com/coding/v1/usages",
    }
    headers = adapter.headers()
    if provider.kind == "github":
        headers["authorization"] = "Bearer " + adapter.credentials["access_token"]
    if provider.kind == "kimi" and adapter.credentials.get("auth_type") != "oauth":
        headers = {"x-api-key": adapter.credentials["api_key"], "accept": "application/json"}
    data = await adapter.get_json(urls[provider.kind], headers=headers)
    result = windows(provider.kind, data, time.time())
    if not result:
        raise UpstreamError(502, "quota_unavailable")
    return result
