import asyncio
import logging
import time
from typing import Any

import httpx
from sqlalchemy import delete, select

from .errors import UpstreamError
from .models import AuditLog, Provider, RegistryModel, RequestLog, Session
from .providers import ADAPTERS
from .providers.base import OpenAIAdapter

logger = logging.getLogger("gateway.monitor")


def adapter_for(state: Any, provider: Provider) -> OpenAIAdapter:
    adapter = ADAPTERS[provider.kind](
        state.http,
        provider.base_url,
        state.vault.open(provider.encrypted_credentials),
        state.settings.max_response_bytes,
    )

    async def report(headers: httpx.Headers) -> None:
        from .quotas import capture

        await capture(state, provider.id, adapter.quota_model, headers)

    if adapter.credentials.get("auth_type") == "oauth":
        from .native_auth import credentials_for

        async def load_credentials() -> dict:
            return await credentials_for(state, provider.id)

        adapter.credentials_loader = load_credentials
    adapter.on_headers = report
    return adapter


async def refresh(state: Any, provider_id: str) -> dict[str, Any]:
    # Fixed lease bounds the discovery frequency across replicas, including manual requests.
    if not await state.shared.put("discovery:" + provider_id, "1", 60, nx=True):
        return {
            "status": "already_refreshing",
            "message": "A recent refresh is in progress or cooling down.",
        }
    async with state.db() as db:
        provider = await db.get(Provider, provider_id)
        if not provider:
            return {"status": "deleted"}
        try:
            async with asyncio.timeout(45):
                discovered = await adapter_for(state, provider).discover()
            if len(discovered) > 20000:
                raise UpstreamError(502, "catalog_too_large")
            existing = {
                m.model_id: m
                for m in (
                    await db.scalars(
                        select(RegistryModel).where(RegistryModel.provider_id == provider.id)
                    )
                ).all()
            }
            seen = set()
            for item in discovered:
                if not item.model_id or len(item.model_id) > 512:
                    continue
                seen.add(item.model_id)
                model = existing.get(item.model_id)
                if model and model.manual:
                    continue
                if not model:
                    model = RegistryModel(provider_id=provider.id, model_id=item.model_id)
                    existing[item.model_id] = model
                    db.add(model)
                for key in (
                    "name",
                    "capabilities",
                    "context_window",
                    "input_price",
                    "output_price",
                    "available",
                    "source",
                ):
                    setattr(model, key, getattr(item, key))
                model.updated_at = time.time()
            for model in existing.values():
                if model.model_id not in seen and not model.manual:
                    model.available = False
            provider.discovered_at = time.time()
            provider.discovery_error = None
            await db.commit()
            return {"status": "ok", "models": len(seen)}
        except (httpx.HTTPError, UpstreamError, TimeoutError, ValueError, KeyError, TypeError):
            # Never store provider responses, exception strings, URLs with keys, or prompts.
            provider.discovery_error = (
                "Discovery failed. Check the credential, endpoint, and provider availability."
            )
            provider.discovered_at = time.time()
            await db.commit()
            return {"status": "error", "message": provider.discovery_error}


async def monitor(state: Any) -> None:
    while True:
        try:
            async with state.db() as db:
                due = (
                    await db.scalars(
                        select(Provider.id)
                        .where(
                            Provider.enabled.is_(True),
                            (Provider.discovered_at.is_(None))
                            | (
                                Provider.discovered_at
                                < time.time() - state.settings.discovery_interval_seconds
                            ),
                        )
                        .limit(100)
                    )
                ).all()
            semaphore = asyncio.Semaphore(4)

            async def run(pid: str) -> None:
                async with semaphore:
                    await refresh(state, pid)

            await asyncio.gather(*(run(pid) for pid in due))
            if await state.shared.put("maintenance:retention", "1", 3600, nx=True):
                cutoff = time.time() - state.settings.log_retention_days * 86400
                async with state.db() as db:
                    await db.execute(delete(Session).where(Session.expires_at < time.time()))
                    await db.execute(delete(RequestLog).where(RequestLog.created_at < cutoff))
                    await db.execute(delete(AuditLog).where(AuditLog.created_at < cutoff))
                    await db.commit()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.error("Background model refresh failed; retrying on the next interval.")
        await asyncio.sleep(state.settings.health_interval_seconds)
