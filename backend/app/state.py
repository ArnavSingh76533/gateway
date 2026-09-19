import asyncio
import json
import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Awaitable, cast

from redis.asyncio import Redis

from .errors import fail


class SharedState:
    """Redis in production; bounded, process-local development fallback."""

    def __init__(self, redis_url: str | None):
        self.redis: Redis | None = (
            Redis.from_url(redis_url, decode_responses=True) if redis_url else None
        )
        self.memory: dict[str, tuple[str, float]] = {}
        self.lock = asyncio.Lock()

    async def close(self) -> None:
        if self.redis:
            await self.redis.aclose()

    async def get(self, key: str) -> str | None:
        if self.redis:
            return await self.redis.get(key)  # type: ignore[no-any-return]
        entry = self.memory.get(key)
        if entry and entry[1] > time.time():
            return entry[0]
        self.memory.pop(key, None)
        return None

    async def put(self, key: str, value: str, ttl: int, nx: bool = False) -> bool:
        if self.redis:
            return bool(await self.redis.set(key, value, ex=ttl, nx=nx))
        async with self.lock:
            now = time.time()
            self.memory = {k: v for k, v in self.memory.items() if v[1] > now}
            if nx and key in self.memory:
                return False
            self.memory[key] = (value, now + ttl)
            return True

    async def delete(self, key: str) -> None:
        if self.redis:
            await self.redis.delete(key)
        else:
            self.memory.pop(key, None)

    async def consume(self, key: str) -> str | None:
        """Atomically claim one-time OAuth state; a replay can never reuse it."""
        if self.redis:
            return await self.redis.getdel(key)  # type: ignore[no-any-return]
        async with self.lock:
            value = await self.get(key)
            self.memory.pop(key, None)
            return value

    @asynccontextmanager
    async def lease(self, key: str) -> AsyncIterator[None]:
        owner = secrets.token_urlsafe(24)
        for _ in range(200):
            if await self.put(key, owner, 120, nx=True):
                break
            await asyncio.sleep(0.1)
        else:
            raise fail(503, "Provider authorization is busy. Retry shortly.", "oauth_busy")
        try:
            yield
        finally:
            if self.redis:
                await self.redis.eval(
                    "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0",
                    1,
                    key,
                    owner,
                )  # type: ignore[misc]
            else:
                async with self.lock:
                    if await self.get(key) == owner:
                        self.memory.pop(key, None)

    async def rate_limit(self, key: str, limit: int, seconds: int = 60) -> None:
        key = "rate:" + key + ":" + str(int(time.time()) // seconds)
        if self.redis:
            count = int(
                await cast(
                    Awaitable[str],
                    self.redis.eval(
                        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
                        1,
                        key,
                        str(seconds + 1),
                    ),
                )
            )
        else:
            async with self.lock:
                count = int(await self.get(key) or "0") + 1
                self.memory[key] = (str(count), time.time() + seconds + 1)
                if len(self.memory) > 10000:
                    self.memory = {k: v for k, v in self.memory.items() if v[1] > time.time()}
        if count > limit:
            exc = fail(429, "Rate limit exceeded. Please retry later.", "rate_limit_exceeded")
            exc.headers = {"Retry-After": str(seconds)}
            raise exc

    async def health(self, scope: str) -> dict[str, Any]:
        return json.loads(await self.get("health:" + scope) or "{}")  # type: ignore[no-any-return]

    async def failed(self, scope: str, status: int, cooldown: int) -> None:
        await self.put(
            "health:" + scope,
            json.dumps(
                {"status": "cooldown", "http_status": status, "retry_at": time.time() + cooldown}
            ),
            cooldown,
        )

    async def succeeded(self, scope: str, latency: float, high_latency: int) -> None:
        previous = await self.health(scope)
        if previous.get("status") == "cooldown":
            return  # A concurrent success must not reopen an active failure circuit.
        latency = previous.get("latency_ms", latency) * 0.7 + latency * 0.3
        await self.put(
            "health:" + scope,
            json.dumps(
                {
                    "status": "degraded" if latency > high_latency else "healthy",
                    "latency_ms": latency,
                }
            ),
            86400,
        )
