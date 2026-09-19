"""Chat/Responses translation for native subscription transports."""

import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..errors import UpstreamError
from .base import OpenAIAdapter


def to_responses(payload: dict) -> dict:
    if payload.get("n", 1) != 1 or payload.get("functions"):
        raise UpstreamError(400, "unsupported_responses_parameter")
    out: dict[str, Any] = {"model": payload["model"], "input": [], "stream": True, "store": False}
    try:
        for msg in payload["messages"]:
            role = msg["role"]
            if role == "tool":
                out["input"].append(
                    {
                        "type": "function_call_output",
                        "call_id": msg["tool_call_id"],
                        "output": msg.get("content") or "",
                    }
                )
                continue
            if role not in {"system", "developer", "user", "assistant"}:
                raise ValueError()
            content = msg.get("content")
            if isinstance(content, list):
                parts = []
                for part in content:
                    if part["type"] == "text":
                        parts.append(
                            {
                                "type": "output_text" if role == "assistant" else "input_text",
                                "text": part["text"],
                            }
                        )
                    elif part["type"] == "image_url" and role == "user":
                        parts.append({"type": "input_image", **part["image_url"]})
                        parts[-1]["image_url"] = parts[-1].pop("url")
                    else:
                        raise ValueError()
                content = parts
            if content:
                out["input"].append(
                    {"role": "developer" if role == "system" else role, "content": content}
                )
            for call in msg.get("tool_calls", []):
                out["input"].append(
                    {
                        "type": "function_call",
                        "call_id": call["id"],
                        "name": call["function"]["name"],
                        "arguments": call["function"]["arguments"],
                    }
                )
        if payload.get("tools"):
            out["tools"] = []
            for tool in payload["tools"]:
                if tool["type"] != "function":
                    raise ValueError()
                out["tools"].append({"type": "function", **tool["function"]})
        for key in ("parallel_tool_calls", "tool_choice"):
            if key in payload:
                out[key] = payload[key]
        if (
            isinstance(out.get("tool_choice"), dict)
            and out["tool_choice"].get("type") == "function"
        ):
            out["tool_choice"] = {
                "type": "function",
                "name": out["tool_choice"]["function"]["name"],
            }
        if payload.get("reasoning_effort"):
            out["reasoning"] = {"effort": payload["reasoning_effort"]}
        if payload.get("response_format"):
            fmt = payload["response_format"]
            out["text"] = {
                "format": {"type": "json_schema", **fmt["json_schema"]}
                if fmt["type"] == "json_schema"
                else fmt
            }
        # Preserve supported request controls; the transport rejects controls it cannot honor.
        for key in (
            "temperature",
            "top_p",
            "max_tokens",
            "max_completion_tokens",
            "stop",
            "seed",
            "logprobs",
            "presence_penalty",
            "frequency_penalty",
            "audio",
            "modalities",
        ):
            if payload.get(key) is not None:
                out[key] = payload[key]
        return out
    except (KeyError, ValueError, TypeError, AttributeError):
        raise UpstreamError(400, "invalid_responses_request") from None


def chat_result(response: dict, model: str) -> dict:
    try:
        return _chat_result(response, model)
    except (KeyError, ValueError, TypeError, AttributeError):
        raise UpstreamError(502, "invalid_upstream_stream") from None


def _chat_result(response: dict, model: str) -> dict:
    content: list[str] = []
    calls: list[dict] = []
    for item in response.get("output", []):
        if item.get("type") == "message":
            content.extend(
                p.get("text", "") for p in item.get("content", []) if p.get("type") == "output_text"
            )
        elif item.get("type") == "function_call":
            calls.append(
                {
                    "id": item["call_id"],
                    "type": "function",
                    "function": {"name": item["name"], "arguments": item["arguments"]},
                }
            )
    usage = response.get("usage") or {}
    inp, out = usage.get("input_tokens", 0), usage.get("output_tokens", 0)
    message: dict[str, Any] = {"role": "assistant", "content": "".join(content) or None}
    if calls:
        message["tool_calls"] = calls
    return {
        "id": response.get("id", "chatcmpl-" + uuid.uuid4().hex),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": "length"
                if response.get("status") == "incomplete"
                else "tool_calls"
                if calls
                else "stop",
            }
        ],
        "usage": {"prompt_tokens": inp, "completion_tokens": out, "total_tokens": inp + out},
    }


async def response_events(response: httpx.Response, maximum: int) -> AsyncIterator[dict]:
    from ..routing import sse_events

    total = 0
    try:
        async for frame in sse_events(response):
            total += len(frame)
            if total > maximum:
                raise UpstreamError(502, "upstream_response_too_large")
            data = b"\n".join(
                line[5:].lstrip() for line in frame.splitlines() if line.startswith(b"data:")
            )
            if not data or data == b"[DONE]":
                continue
            event = json.loads(data)
            if not isinstance(event, dict) or not isinstance(event.get("type"), str):
                raise ValueError()
            if event["type"] in {"response.completed", "response.incomplete"} and not isinstance(
                event.get("response"), dict
            ):
                raise ValueError()
            if event.get("type") in {"error", "response.failed"}:
                raise UpstreamError(502, "upstream_stream_error")
            yield event
            if event.get("type") in {"response.completed", "response.incomplete"}:
                return
        raise UpstreamError(502, "truncated_stream_event")
    except (ValueError, KeyError, TypeError):
        raise UpstreamError(502, "invalid_upstream_stream") from None
    finally:
        await response.aclose()


class ResponsesStream(httpx.AsyncByteStream):
    def __init__(self, response: httpx.Response, model: str, maximum: int, chat: bool):
        self.response, self.model, self.maximum, self.chat = response, model, maximum, chat

    async def __aiter__(self) -> AsyncIterator[bytes]:
        identity = "chatcmpl-" + uuid.uuid4().hex
        tools: dict[int, int] = {}
        try:
            async for event in response_events(self.response, self.maximum):
                if not self.chat:
                    yield (
                        b"event: "
                        + event["type"].encode()
                        + b"\ndata: "
                        + json.dumps(event).encode()
                        + b"\n\n"
                    )
                    continue
                kind = event.get("type")
                delta: dict[str, Any] = {}
                extra: dict[str, Any] = {}
                reason = None
                if kind == "response.created":
                    delta = {"role": "assistant", "content": ""}
                elif kind == "response.output_text.delta":
                    delta = {"content": event.get("delta", "")}
                elif kind == "response.reasoning_summary_text.delta":
                    delta = {"reasoning_content": event.get("delta", "")}
                elif (
                    kind == "response.output_item.added"
                    and event.get("item", {}).get("type") == "function_call"
                ):
                    item = event["item"]
                    index = len(tools)
                    tools[event["output_index"]] = index
                    delta = {
                        "tool_calls": [
                            {
                                "index": index,
                                "id": item["call_id"],
                                "type": "function",
                                "function": {
                                    "name": item["name"],
                                    "arguments": item.get("arguments", ""),
                                },
                            }
                        ]
                    }
                elif kind == "response.function_call_arguments.delta":
                    if event["output_index"] not in tools:
                        raise UpstreamError(502, "invalid_upstream_stream")
                    delta = {
                        "tool_calls": [
                            {
                                "index": tools[event["output_index"]],
                                "function": {"arguments": event.get("delta", "")},
                            }
                        ]
                    }
                elif kind in {"response.completed", "response.incomplete"}:
                    result = chat_result(event["response"], self.model)
                    reason = result["choices"][0]["finish_reason"]
                    extra = {"usage": result["usage"]}
                else:
                    continue
                chunk = {
                    "id": identity,
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": self.model,
                    "choices": [{"index": 0, "delta": delta, "finish_reason": reason}],
                    **extra,
                }
                yield b"data: " + json.dumps(chunk).encode() + b"\n\n"
                if reason:
                    yield b"data: [DONE]\n\n"
        except (KeyError, ValueError, TypeError, AttributeError):
            raise UpstreamError(502, "invalid_upstream_stream") from None
        finally:
            await self.response.aclose()

    async def aclose(self) -> None:
        await self.response.aclose()


class NativeResponsesAdapter(OpenAIAdapter):
    endpoints = {"chat/completions", "responses"}

    async def send(
        self, endpoint: str, payload: dict[str, Any], files: dict[str, Any] | None = None
    ) -> httpx.Response:
        if endpoint not in self.endpoints or files:
            raise UpstreamError(400, "unsupported_endpoint")
        await self.prepare()
        self.quota_model = payload["model"]
        chat = endpoint == "chat/completions"
        body = to_responses(payload) if chat else {**payload}
        if body.get("previous_response_id") or body.get("store"):
            raise UpstreamError(400, "subscription_requires_stateless_input")
        if self.kind == "codex":
            allowed = {
                "model",
                "input",
                "instructions",
                "tools",
                "tool_choice",
                "stream",
                "store",
                "reasoning",
                "service_tier",
                "include",
                "prompt_cache_key",
                "text",
                "parallel_tool_calls",
            }
            if any(
                v is not None and k not in allowed | {"stream_options"} for k, v in body.items()
            ):
                raise UpstreamError(400, "unsupported_codex_parameter")
        else:
            for key in ("max_completion_tokens", "max_tokens"):
                if key in body:
                    body["max_output_tokens"] = body.pop(key)
        body.pop("stream_options", None)
        body.update(stream=True, store=False)
        body.setdefault("instructions", "You are a helpful assistant.")
        req = self.client.build_request(
            "POST", self.base_url + "/responses", headers=self.headers(), json=body
        )
        upstream = await self.client.send(req, stream=True)
        await self.check(upstream)
        if payload.get("stream"):
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                stream=ResponsesStream(upstream, payload["model"], self.max_bytes, chat),
            )
        final = None
        async for event in response_events(upstream, self.max_bytes):
            if event.get("type") in {"response.completed", "response.incomplete"}:
                final = event["response"]
        if final is not None:
            return httpx.Response(200, json=chat_result(final, payload["model"]) if chat else final)
        raise UpstreamError(502, "truncated_stream_event")
