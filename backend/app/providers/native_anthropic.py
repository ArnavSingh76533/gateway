"""OpenAI chat translation for native Anthropic-compatible API connections."""

import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..errors import UpstreamError
from .base import DiscoveredModel, OpenAIAdapter, normalize


def content_parts(value: Any) -> list[dict]:
    if value is None:
        return []
    if isinstance(value, str):
        return [{"type": "text", "text": value}] if value else []
    result = []
    for part in value:
        if part.get("type") == "text":
            result.append({"type": "text", "text": part.get("text", "")})
        elif part.get("type") == "image_url":
            url = part["image_url"]["url"]
            if url.startswith("data:") and ";base64," in url:
                mime, data = url[5:].split(";base64,", 1)
                source = {"type": "base64", "media_type": mime, "data": data}
            elif url.startswith("https://"):
                source = {"type": "url", "url": url}
            else:
                raise UpstreamError(400, "unsupported_image_source")
            result.append({"type": "image", "source": source})
        else:
            raise UpstreamError(400, "unsupported_content")
    return result


def to_messages(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return translate_messages(payload)
    except (KeyError, TypeError, ValueError, AttributeError):
        raise UpstreamError(400, "invalid_anthropic_request") from None


def translate_messages(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("n", 1) != 1 or payload.get("response_format") or payload.get("functions"):
        raise UpstreamError(400, "unsupported_anthropic_parameter")
    result: dict[str, Any] = {
        "model": payload["model"],
        "messages": [],
        "stream": payload.get("stream", False),
        "max_tokens": payload.get("max_completion_tokens") or payload.get("max_tokens") or 4096,
    }
    for field in (
        "logprobs",
        "top_logprobs",
        "logit_bias",
        "frequency_penalty",
        "presence_penalty",
        "seed",
        "audio",
        "modalities",
        "reasoning_effort",
    ):
        if payload.get(field) is not None:
            raise UpstreamError(400, "unsupported_anthropic_parameter")
    systems = []
    for msg in payload["messages"]:
        role = msg.get("role")
        if role in {"system", "developer"}:
            blocks = content_parts(msg.get("content"))
            if any(x["type"] != "text" for x in blocks):
                raise UpstreamError(400, "unsupported_system_content")
            systems.extend(blocks)
            continue
        if role == "tool":
            role = "user"
            blocks = [
                {
                    "type": "tool_result",
                    "tool_use_id": msg["tool_call_id"],
                    "content": content_parts(msg.get("content")),
                }
            ]
        elif role in {"user", "assistant"}:
            blocks = content_parts(msg.get("content"))
            for call in msg.get("tool_calls", []):
                blocks.append(
                    {
                        "type": "tool_use",
                        "id": call["id"],
                        "name": call["function"]["name"],
                        "input": json.loads(call["function"]["arguments"]),
                    }
                )
        else:
            raise UpstreamError(400, "unsupported_role")
        if result["messages"] and result["messages"][-1]["role"] == role:
            result["messages"][-1]["content"].extend(blocks)
        else:
            result["messages"].append({"role": role, "content": blocks})
    if systems:
        result["system"] = systems
    for field in ("temperature", "top_p"):
        if field in payload:
            result[field] = payload[field]
    if payload.get("stop"):
        result["stop_sequences"] = (
            [payload["stop"]] if isinstance(payload["stop"], str) else payload["stop"]
        )
    if payload.get("tools"):
        result["tools"] = [
            {
                "name": t["function"]["name"],
                "description": t["function"].get("description", ""),
                "input_schema": t["function"].get("parameters", {"type": "object"}),
            }
            for t in payload["tools"]
        ]
    choice = payload.get("tool_choice")
    if choice in ("auto", "required", "none"):
        result["tool_choice"] = {
            "type": {"auto": "auto", "required": "any", "none": "none"}[choice]
        }
    elif isinstance(choice, dict):
        result["tool_choice"] = {"type": "tool", "name": choice["function"]["name"]}
    return result


def finish(reason: str | None) -> str:
    return {"max_tokens": "length", "tool_use": "tool_calls"}.get(reason or "", "stop")


def usage(raw: dict) -> dict:
    incoming = (
        raw.get("input_tokens", 0)
        + raw.get("cache_read_input_tokens", 0)
        + raw.get("cache_creation_input_tokens", 0)
    )
    outgoing = raw.get("output_tokens", 0)
    return {
        "prompt_tokens": incoming,
        "completion_tokens": outgoing,
        "total_tokens": incoming + outgoing,
    }


class AnthropicStream(httpx.AsyncByteStream):
    def __init__(self, response: httpx.Response, model: str, maximum: int):
        self.response, self.model, self.maximum = response, model, maximum

    async def __aiter__(self) -> AsyncIterator[bytes]:
        buffer = b""
        total = 0
        identity = "chatcmpl-" + uuid.uuid4().hex
        token_usage: dict[str, int] = {}
        tool_indexes: dict[int, int] = {}
        stopped = False
        try:
            async for chunk in self.response.aiter_bytes():
                total += len(chunk)
                buffer += chunk
                if total > self.maximum or len(buffer) > 2_000_000:
                    raise UpstreamError(502, "upstream_response_too_large")
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    if not line.startswith(b"data:"):
                        continue
                    event = json.loads(line[5:])
                    kind = event.get("type")
                    delta: dict[str, Any] = {}
                    extra: dict[str, Any] = {}
                    reason = None
                    if kind == "error":
                        raise UpstreamError(502, "upstream_stream_error")
                    if kind == "message_start":
                        token_usage.update(event.get("message", {}).get("usage", {}))
                        delta = {"role": "assistant", "content": ""}
                    elif kind == "content_block_start":
                        block = event.get("content_block", {})
                        if block.get("type") != "tool_use":
                            continue
                        idx = len(tool_indexes)
                        tool_indexes[event["index"]] = idx
                        delta = {
                            "tool_calls": [
                                {
                                    "index": idx,
                                    "id": block["id"],
                                    "type": "function",
                                    "function": {"name": block["name"], "arguments": ""},
                                }
                            ]
                        }
                    elif kind == "content_block_delta":
                        part = event.get("delta", {})
                        if part.get("type") == "text_delta":
                            delta = {"content": part.get("text", "")}
                        elif part.get("type") == "input_json_delta":
                            delta = {
                                "tool_calls": [
                                    {
                                        "index": tool_indexes[event["index"]],
                                        "function": {"arguments": part.get("partial_json", "")},
                                    }
                                ]
                            }
                        elif part.get("type") == "thinking_delta":
                            delta = {"reasoning_content": part.get("thinking", "")}
                        else:
                            continue
                    elif kind == "message_delta":
                        token_usage.update(event.get("usage", {}))
                        reason = finish(event.get("delta", {}).get("stop_reason"))
                        extra["usage"] = usage(token_usage)
                    elif kind == "message_stop":
                        stopped = True
                        yield b"data: [DONE]\n\n"
                        return
                    else:
                        continue
                    out = {
                        "id": identity,
                        "object": "chat.completion.chunk",
                        "created": int(time.time()),
                        "model": self.model,
                        "choices": [{"index": 0, "delta": delta, "finish_reason": reason}],
                        **extra,
                    }
                    yield b"data: " + json.dumps(out).encode() + b"\n\n"
            if not stopped:
                raise UpstreamError(502, "truncated_stream_event")
        except (KeyError, TypeError, ValueError, AttributeError):
            raise UpstreamError(502, "invalid_upstream_stream") from None
        finally:
            await self.response.aclose()

    async def aclose(self) -> None:
        await self.response.aclose()


class NativeAnthropicAdapter(OpenAIAdapter):
    kind = "anthropic"
    default_url = "https://api.anthropic.com/v1"
    endpoints = {"chat/completions"}

    def headers(self) -> dict[str, str]:
        return {
            "accept": "application/json",
            "x-api-key": self.credentials.get("api_key", ""),
            "anthropic-version": "2023-06-01",
            **self.credentials.get("headers", {}),
        }

    async def discover(self) -> list[DiscoveredModel]:
        result = []
        after = ""
        for _ in range(30):
            params: dict[str, str | int] = {"limit": 1000}
            if after:
                params["after_id"] = after
            raw = await self.get_json(self.base_url + "/models", params=params)
            for item in raw.get("data", []):
                model = normalize(item)
                model.capabilities.update(chat=True, streaming=True, tools=True)
                model.source = "provider + Anthropic Messages adapter"
                result.append(model)
            if not raw.get("has_more"):
                return result
            after = raw.get("last_id", "")
            if not after:
                break
        raise UpstreamError(502, "catalog_pagination_limit")

    async def send(
        self, endpoint: str, payload: dict[str, Any], files: dict[str, Any] | None = None
    ) -> httpx.Response:
        if endpoint != "chat/completions" or files:
            raise UpstreamError(400, "unsupported_endpoint")
        self.quota_model = payload.get("model")
        req = self.client.build_request(
            "POST", self.base_url + "/messages", headers=self.headers(), json=to_messages(payload)
        )
        response = await self.client.send(req, stream=True)
        await self.check(response)
        if payload.get("stream"):
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                stream=AnthropicStream(response, payload["model"], self.max_bytes),
                request=req,
            )
        try:
            raw = json.loads(await self.read_bytes(response))
            if not isinstance(raw.get("content"), list):
                raise UpstreamError(502, "invalid_upstream_response")
            blocks = raw["content"]
            message: dict[str, Any] = {
                "role": "assistant",
                "content": "".join(b.get("text", "") for b in blocks if b.get("type") == "text"),
            }
            calls = [
                {
                    "id": b["id"],
                    "type": "function",
                    "function": {"name": b["name"], "arguments": json.dumps(b.get("input", {}))},
                }
                for b in blocks
                if b.get("type") == "tool_use"
            ]
            if calls:
                message["tool_calls"] = calls
            return httpx.Response(
                200,
                request=req,
                json={
                    "id": raw.get("id", "chatcmpl-" + uuid.uuid4().hex),
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": payload["model"],
                    "choices": [
                        {
                            "index": 0,
                            "message": message,
                            "finish_reason": finish(raw.get("stop_reason")),
                        }
                    ],
                    "usage": usage(raw.get("usage", {})),
                },
            )
        except (KeyError, TypeError, ValueError, AttributeError):
            raise UpstreamError(502, "invalid_upstream_response") from None
