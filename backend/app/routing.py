import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from sqlalchemy import select

from .auth import Principal
from .discovery import adapter_for
from .errors import UpstreamError, fail
from .models import Provider, RegistryModel, RequestLog
from .schemas import GatewayRequest

RETRYABLE = {401, 403, 404, 429, 500, 502, 503, 504}
ENDPOINT_CAPABILITY = {
    "chat/completions": "chat",
    "embeddings": "embeddings",
    "images/generations": "images",
    "audio/transcriptions": "transcription",
    "audio/speech": "speech",
    "responses": "responses",
}
MODES = {
    "auto",
    "fastest",
    "cheapest",
    "reasoning",
    "coding",
    "vision",
    "image",
    "embedding",
    "manual",
}


@dataclass
class Candidate:
    provider: Provider
    model: RegistryModel
    latency: float

    @property
    def scope(self) -> str:
        return self.provider.id + ":" + self.model.id


def requirements(endpoint: str, payload: dict[str, Any], mode: str) -> set[str]:
    required = {ENDPOINT_CAPABILITY[endpoint]}
    if payload.get("tools") or payload.get("functions"):
        required.add("tools")
    if (payload.get("response_format") or {}).get("type") in ("json_object", "json_schema"):
        required.add("json_mode")
    if payload.get("stream"):
        required.add("streaming")
    if payload.get("reasoning_effort") not in (None, "none"):
        required.add("reasoning")
    for msg in payload.get("messages", []):
        if not isinstance(msg, dict):
            continue
        for part in msg.get("content", []) if isinstance(msg.get("content"), list) else []:
            if isinstance(part, dict):
                if part.get("type") in ("image_url", "input_image"):
                    required.add("vision")
                if part.get("type") in ("input_audio", "audio"):
                    required.add("audio")
    if mode in ("reasoning", "vision"):
        required.add(mode)
    if mode == "image":
        required.add("images")
    if mode == "embedding":
        required.add("embeddings")
    return required


async def candidates(
    state: Any, principal: Principal, body: GatewayRequest, endpoint: str
) -> list[Candidate]:
    mode: str = body.routing
    mid = body.model
    if mid.startswith("auto/"):
        mode = mid.split("/", 1)[1]
        if mode not in MODES - {"manual"}:
            raise fail(400, "Unknown automatic routing mode.", "invalid_routing_mode")
    automatic = mid == "auto" or mid.startswith("auto/")
    if mode == "manual" and automatic:
        raise fail(400, "Manual routing requires a model ID.", "model_required")
    pin = body.provider
    if "::" in mid:
        namespace, mid = mid.split("::", 1)
        if pin and pin != namespace:
            raise fail(
                400, "Provider override conflicts with the namespaced model.", "provider_conflict"
            )
        pin = namespace
    if endpoint == "responses" and automatic:
        raise fail(
            400,
            "Responses requires an explicit model; state belongs to the selected provider.",
            "explicit_model_required",
        )
    if endpoint == "responses" and getattr(body, "background", False):
        raise fail(
            400, "Background Responses are not supported by this gateway.", "unsupported_feature"
        )
    if endpoint == "responses" and getattr(body, "previous_response_id", None):
        try:
            uuid.UUID(pin or "")
        except ValueError:
            raise fail(
                400,
                "Responses continuation requires a specific connection UUID.",
                "connection_required",
            ) from None
    required = requirements(endpoint, body.model_dump(), mode)
    async with state.db() as db:
        rows = (
            await db.execute(
                select(Provider, RegistryModel)
                .join(RegistryModel, Provider.id == RegistryModel.provider_id)
                .where(
                    Provider.user_id == principal.user_id,
                    Provider.enabled.is_(True),
                    RegistryModel.available.is_(True),
                )
            )
        ).all()
    matches: list[tuple[int, Candidate]] = []
    for provider, model in rows:
        if pin and pin not in (provider.kind, provider.id):
            continue
        if endpoint not in adapter_for(state, provider).endpoints:
            continue
        exact = model.model_id == mid
        if not automatic and not exact and not body.allow_alternatives:
            continue
        # Unknown metadata is permitted for an explicitly named model. Auto and alternatives require confirmation.
        if any(
            model.capabilities.get(cap) is False
            or ((automatic or not exact) and model.capabilities.get(cap) is not True)
            for cap in required
        ):
            continue
        if (await state.shared.health(provider.id)).get("status") == "cooldown":
            continue
        health = await state.shared.health(provider.id + ":" + model.id)
        if health.get("status") == "cooldown":
            continue
        matches.append(
            (0 if exact else 1, Candidate(provider, model, health.get("latency_ms", float("inf"))))
        )

    def order(entry: tuple[int, Candidate]) -> tuple:
        exact, c = entry
        price = (
            c.model.input_price + c.model.output_price
            if c.model.input_price is not None and c.model.output_price is not None
            else float("inf")
        )
        base = (exact, not c.provider.pinned)
        if mode == "fastest":
            return base + (c.latency, c.provider.priority, c.model.model_id)
        if mode == "cheapest":
            return base + (price, c.provider.priority, c.model.model_id)
        if mode == "coding":
            # A ranking hint, never a capability guarantee.
            coding = c.model.capabilities.get("coding") is True or any(
                x in c.model.model_id.lower() for x in ("coder", "code", "codestral")
            )
            return base + (not coding, c.provider.priority, c.latency, c.model.model_id)
        return base + (c.provider.priority, c.latency, c.model.model_id)

    matches.sort(key=order)
    return [c for _, c in matches]


def usage_from(data: dict[str, Any]) -> tuple[int | None, int | None]:
    usage = (
        data.get("usage")
        or data.get("response", {}).get("usage")
        or data.get("x_groq", {}).get("usage")
        or {}
    )
    inp = usage.get("prompt_tokens", usage.get("input_tokens"))
    out = usage.get("completion_tokens", usage.get("output_tokens"))
    return (
        inp if isinstance(inp, int) and inp >= 0 else None,
        out if isinstance(out, int) and out >= 0 else None,
    )


async def sse_events(
    response: httpx.Response, max_event_bytes: int = 2_097_152
) -> AsyncIterator[bytes]:
    buffer = b""
    async for chunk in response.aiter_bytes():
        buffer += chunk
        # Normalize after accumulation so a CRLF split over network chunks remains valid.
        while True:
            marker, size = -1, 0
            for separator in (b"\r\n\r\n", b"\n\n", b"\r\r"):
                index = buffer.find(separator)
                if index >= 0 and (marker < 0 or index < marker):
                    marker, size = index, len(separator)
            if marker < 0:
                break
            if marker > max_event_bytes:
                raise UpstreamError(502, "stream_event_too_large")
            event, buffer = buffer[: marker + size], buffer[marker + size :]
            yield event
        if len(buffer) > max_event_bytes:
            raise UpstreamError(502, "stream_event_too_large")
    if buffer.strip():
        raise UpstreamError(502, "truncated_stream_event")


def parse_event(event: bytes) -> tuple[dict[str, Any] | None, bool]:
    lines = event.decode("utf-8").splitlines()
    payload = "\n".join(line[5:].lstrip(" ") for line in lines if line.startswith("data:"))
    if payload == "[DONE]":
        return None, True
    if not payload:
        return None, False
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise UpstreamError(502, "invalid_stream_event")
    if data.get("error") or data.get("type") in ("error", "response.failed"):
        error = data.get("error") or data.get("response", {}).get("error") or {}
        code = error.get("code") if isinstance(error, dict) else None
        status = code if isinstance(code, int) and code in RETRYABLE else 502
        raise UpstreamError(status, "upstream_stream_error")
    return data, data.get("type") == "response.completed"


class Execution:
    def __init__(self, request: Request, principal: Principal, body: GatewayRequest, endpoint: str):
        self.state = request.app.state
        self.principal, self.body, self.endpoint = principal, body, endpoint
        self.id = request.state.request_id
        self.started = time.monotonic()
        self.attempts: list[dict[str, Any]] = []
        self.input_tokens: int | None = None
        self.output_tokens: int | None = None
        self.current: Candidate | None = None
        self.recorded = False

    async def record(self, status: int, error: str | None = None) -> None:
        if self.recorded:
            return
        self.recorded = True
        c = self.current
        estimated = None
        if c and self.input_tokens is not None and self.output_tokens is not None:
            if c.model.input_price is not None and c.model.output_price is not None:
                estimated = (
                    self.input_tokens * c.model.input_price
                    + self.output_tokens * c.model.output_price
                ) / 1_000_000
        async with self.state.db() as db:
            db.add(
                RequestLog(
                    id=self.id,
                    user_id=self.principal.user_id,
                    key_id=self.principal.key_id,
                    provider_id=c.provider.id if c else None,
                    provider_name=c.provider.name if c else None,
                    requested_model=self.body.model,
                    resolved_model=c.model.model_id if c else None,
                    endpoint=self.endpoint,
                    status=status,
                    latency_ms=(time.monotonic() - self.started) * 1000,
                    input_tokens=self.input_tokens,
                    output_tokens=self.output_tokens,
                    estimated_cost=estimated,
                    attempts=self.attempts,
                    error_code=error,
                )
            )
            await db.commit()

    async def failure(self, candidate: Candidate, error: UpstreamError) -> None:
        scope = candidate.provider.id if error.status in (401, 403, 429) else candidate.scope
        cooldown = max(error.retry_after, self.state.settings.circuit_cooldown_seconds)
        if error.status in (401, 403):
            cooldown = max(cooldown, 300)
        if error.status in RETRYABLE:
            await self.state.shared.failed(scope, error.status, cooldown)

    def headers(self) -> dict[str, str]:
        assert self.current
        return {
            "X-Request-ID": self.id,
            "X-Gateway-Provider": self.current.provider.kind,
            "X-Gateway-Model": quote(self.current.model.model_id, safe=":/._-"),
            "X-Gateway-Attempts": str(len(self.attempts)),
            "Cache-Control": "no-store",
        }

    async def run(self, files: dict[str, Any] | None = None) -> Response:
        try:
            choices = await candidates(self.state, self.principal, self.body, self.endpoint)
        except Exception:
            await self.record(400, "invalid_routing")
            raise
        if not choices:
            await self.record(404, "no_matching_model")
            raise fail(
                404,
                "No healthy matching model. Connect a provider, refresh models, or confirm the required capabilities.",
                "no_matching_model",
            )
        retries = min(
            self.body.max_retries
            if self.body.max_retries is not None
            else self.state.settings.max_retries,
            self.state.settings.max_retries,
        )
        # Stateful Responses objects cannot safely migrate across providers.
        if self.endpoint == "responses" and getattr(self.body, "previous_response_id", None):
            retries = 0
        payload = self.body.model_dump(
            exclude={"provider", "routing", "max_retries", "allow_alternatives"}, exclude_unset=True
        )
        if self.endpoint not in ("chat/completions", "responses"):
            payload.pop("stream", None)
        last_error = UpstreamError(503, "all_providers_failed")
        for c in choices:
            if len(self.attempts) >= retries + 1:
                break
            # An earlier failure in this request can open a provider-wide circuit.
            if (await self.state.shared.health(c.provider.id)).get("status") == "cooldown":
                continue
            self.current = c
            adapter = adapter_for(self.state, c.provider)
            payload["model"] = c.model.model_id
            started = time.monotonic()
            response: httpx.Response | None = None
            attempt: dict[str, Any] = {
                "provider": c.provider.kind,
                "provider_name": c.provider.name,
                "model": c.model.model_id,
                "status": 0,
                "latency_ms": 0.0,
            }
            self.attempts.append(attempt)
            try:
                async with asyncio.timeout(self.state.settings.upstream_timeout_seconds):
                    response = await adapter.send(self.endpoint, payload, files)
                    if self.body.stream and self.endpoint in ("chat/completions", "responses"):
                        if "text/event-stream" not in response.headers.get("content-type", ""):
                            raise UpstreamError(502, "invalid_stream_content_type")
                        iterator = sse_events(response)
                        first = None
                        async for event in iterator:
                            data, done = parse_event(event)
                            if data or done:
                                first = event
                                break
                        if first is None:
                            raise UpstreamError(502, "empty_stream")
                        attempt["status"] = 200
                        attempt["latency_ms"] = round((time.monotonic() - started) * 1000, 2)
                        return StreamingResponse(
                            self.stream(response, iterator, first, c, started),
                            media_type="text/event-stream",
                            headers={**self.headers(), "X-Accel-Buffering": "no"},
                        )
                    raw = await adapter.read_bytes(response)
                    if self.endpoint == "audio/speech":
                        content_type = response.headers.get("content-type", "audio/mpeg")
                        if not (
                            content_type.startswith("audio/")
                            or content_type == "application/octet-stream"
                        ):
                            raise UpstreamError(502, "invalid_audio_response")
                        result: Response = Response(
                            raw, media_type=content_type, headers=self.headers()
                        )
                    elif self.endpoint == "audio/transcriptions" and payload.get(
                        "response_format"
                    ) in ("text", "srt", "vtt"):
                        result = Response(raw, media_type="text/plain", headers=self.headers())
                    else:
                        data = json.loads(raw)
                        if not isinstance(data, dict) or data.get("error"):
                            raise UpstreamError(502, "invalid_upstream_response")
                        if self.endpoint == "chat/completions" and not isinstance(
                            data.get("choices"), list
                        ):
                            raise UpstreamError(502, "invalid_chat_response")
                        if self.endpoint in ("embeddings", "images/generations") and not isinstance(
                            data.get("data"), list
                        ):
                            raise UpstreamError(502, "invalid_data_response")
                        self.input_tokens, self.output_tokens = usage_from(data)
                        if self.endpoint == "embeddings" and self.input_tokens is not None:
                            self.output_tokens = 0
                        result = JSONResponse(data, headers=self.headers())
                    attempt["status"] = 200
                    attempt["latency_ms"] = round((time.monotonic() - started) * 1000, 2)
                    await self.state.shared.succeeded(
                        c.scope, float(attempt["latency_ms"]), self.state.settings.high_latency_ms
                    )
                    await self.state.shared.succeeded(
                        c.provider.id,
                        float(attempt["latency_ms"]),
                        self.state.settings.high_latency_ms,
                    )
                    await self.record(200)
                    return result
            except asyncio.CancelledError:
                if response:
                    await response.aclose()
                attempt["status"] = 499
                await self.record(499, "client_disconnected")
                raise
            except (httpx.HTTPError, UpstreamError, TimeoutError, ValueError, UnicodeError) as exc:
                if response:
                    await response.aclose()
                error = (
                    exc
                    if isinstance(exc, UpstreamError)
                    else UpstreamError(
                        504 if isinstance(exc, (TimeoutError, httpx.TimeoutException)) else 502,
                        "upstream_timeout"
                        if isinstance(exc, (TimeoutError, httpx.TimeoutException))
                        else "upstream_protocol_error",
                    )
                )
                attempt.update(
                    status=error.status,
                    latency_ms=round((time.monotonic() - started) * 1000, 2),
                    error=error.code,
                )
                await self.failure(c, error)
                last_error = error
                if error.status not in RETRYABLE:
                    break
        status = (
            429
            if last_error.status == 429
            else (last_error.status if last_error.status in (400, 404, 422, 504) else 502)
        )
        await self.record(status, last_error.code)
        raise fail(
            status,
            "Upstream request failed. Inspect the request ID in your dashboard; provider response details are redacted.",
            last_error.code,
        )

    async def stream(
        self,
        response: httpx.Response,
        iterator: AsyncIterator[bytes],
        first: bytes,
        c: Candidate,
        started: float,
    ) -> AsyncIterator[bytes]:
        status, error = 200, None
        total = 0
        completed = False
        try:
            async with asyncio.timeout(self.state.settings.upstream_timeout_seconds):

                async def events() -> AsyncIterator[bytes]:
                    yield first
                    async for event in iterator:
                        yield event

                async for event in events():
                    total += len(event)
                    if total > self.state.settings.max_response_bytes:
                        raise UpstreamError(502, "stream_too_large")
                    data, done = parse_event(event)
                    completed = completed or done
                    if data:
                        inp, out = usage_from(data)
                        if inp is not None:
                            self.input_tokens = inp
                        if out is not None:
                            self.output_tokens = out
                    yield event
                    if done:
                        break
                if not completed:
                    raise UpstreamError(502, "stream_interrupted")
        except (asyncio.CancelledError, GeneratorExit):
            status, error = 499, "client_disconnected"
            raise
        except (httpx.HTTPError, UpstreamError, TimeoutError, ValueError, UnicodeError):
            status, error = 502, "stream_interrupted"
            await self.failure(c, UpstreamError(502, error))
            yield (
                "data: "
                + json.dumps(
                    {
                        "error": {
                            "message": "The upstream stream was interrupted. Retry as a new request.",
                            "type": "gateway_error",
                            "code": error,
                            "request_id": self.id,
                        }
                    }
                )
                + "\n\n"
            ).encode()
            yield b"data: [DONE]\n\n"
        finally:
            await response.aclose()
            self.attempts[-1]["status"] = status
            self.attempts[-1]["latency_ms"] = round((time.monotonic() - started) * 1000, 2)
            if status == 200:
                await self.state.shared.succeeded(
                    c.scope,
                    float(self.attempts[-1]["latency_ms"]),
                    self.state.settings.high_latency_ms,
                )
            if status == 200:
                await self.state.shared.succeeded(
                    c.provider.id,
                    float(self.attempts[-1]["latency_ms"]),
                    self.state.settings.high_latency_ms,
                )
            await self.record(status, error)
