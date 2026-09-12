"""Anthropic Messages bridge for ordinary text, image, and client-side tool workflows.

Extended thinking, server-side tools, computer use, and prompt-cache accounting are not emulated.
"""

import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from .auth import GatewayPrincipal
from .errors import fail
from .routing import Execution
from .schemas import ChatRequest

router = APIRouter(prefix="/v1", tags=["Anthropic Messages bridge"])


class MessagesRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    model: str = Field(default="auto", max_length=1024)
    messages: list[dict[str, Any]] = Field(min_length=1)
    max_tokens: int = Field(ge=1)
    system: str | list[dict[str, Any]] | None = None
    tools: list[dict[str, Any]] | None = None
    tool_choice: dict[str, Any] | None = None
    stream: bool = False
    temperature: float | None = None
    top_p: float | None = None
    stop_sequences: list[str] | None = None
    thinking: dict[str, Any] | None = None


def text_blocks(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list) and all(b.get("type") == "text" for b in value):
        return "\n".join(b.get("text", "") for b in value)
    raise fail(400, "This field supports text blocks only.", "unsupported_content")


def convert(body: MessagesRequest) -> ChatRequest:
    if body.thinking and body.thinking.get("type") != "disabled":
        raise fail(
            400, "Extended thinking is not supported by the Messages bridge.", "unsupported_feature"
        )
    messages: list[dict[str, Any]] = []
    if body.system:
        messages.append({"role": "system", "content": text_blocks(body.system)})
    for msg in body.messages:
        role = msg.get("role")
        if role not in ("user", "assistant"):
            raise fail(400, "Messages role must be user or assistant.")
        content = msg.get("content")
        if isinstance(content, str):
            messages.append({"role": role, "content": content})
            continue
        if not isinstance(content, list):
            raise fail(400, "Invalid message content.")
        parts: list[dict[str, Any]] = []
        calls: list[dict[str, Any]] = []
        results: list[dict[str, Any]] = []
        for block in content:
            kind = block.get("type")
            if kind == "text":
                parts.append({"type": "text", "text": block.get("text", "")})
            elif kind == "image":
                source = block.get("source", {})
                if source.get("type") == "base64":
                    url = f"data:{source.get('media_type', 'image/png')};base64,{source.get('data', '')}"
                elif source.get("type") == "url":
                    url = source["url"]
                else:
                    raise fail(400, "Unsupported image source.")
                parts.append({"type": "image_url", "image_url": {"url": url}})
            elif kind == "tool_use" and role == "assistant":
                calls.append(
                    {
                        "id": block["id"],
                        "type": "function",
                        "function": {
                            "name": block["name"],
                            "arguments": json.dumps(block.get("input", {})),
                        },
                    }
                )
            elif kind == "tool_result" and role == "user":
                results.append(
                    {
                        "role": "tool",
                        "tool_call_id": block["tool_use_id"],
                        "content": text_blocks(block.get("content", "")),
                    }
                )
            else:
                raise fail(400, "Unsupported Messages content block.", "unsupported_content")
        messages.extend(results)
        if parts or calls:
            converted: dict[str, Any] = {"role": role, "content": parts or None}
            if calls:
                converted["tool_calls"] = calls
            messages.append(converted)
    payload: dict[str, Any] = {
        "model": body.model,
        "messages": messages,
        "max_tokens": body.max_tokens,
        "stream": body.stream,
    }
    if body.stream:
        payload["stream_options"] = {"include_usage": True}
    if body.tools:
        if any(t.get("type") not in (None, "custom") for t in body.tools):
            raise fail(400, "Only client-side function tools are supported.", "unsupported_tool")
        payload["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("input_schema", {"type": "object"}),
                },
            }
            for t in body.tools
        ]
    if body.tool_choice:
        choice = body.tool_choice
        kind = choice.get("type")
        if kind == "tool":
            payload["tool_choice"] = {"type": "function", "function": {"name": choice["name"]}}
        elif kind in ("auto", "any", "none"):
            payload["tool_choice"] = {"any": "required"}.get(str(kind), kind)
        else:
            raise fail(400, "Unsupported tool choice.")
        if choice.get("disable_parallel_tool_use"):
            payload["parallel_tool_calls"] = False
    for source, dest in [
        ("temperature", "temperature"),
        ("top_p", "top_p"),
        ("stop_sequences", "stop"),
    ]:
        val = getattr(body, source)
        if val is not None:
            payload[dest] = val
    return ChatRequest.model_validate(payload)


def stop_reason(reason: str | None) -> str:
    return {"tool_calls": "tool_use", "function_call": "tool_use", "length": "max_tokens"}.get(
        reason or "", "end_turn"
    )


def converted_response(data: dict[str, Any]) -> dict[str, Any]:
    msg = data["choices"][0]["message"]
    content: list[dict[str, Any]] = []
    if msg.get("content"):
        content.append({"type": "text", "text": msg["content"]})
    for call in msg.get("tool_calls", []):
        try:
            args = json.loads(call["function"]["arguments"])
        except (ValueError, KeyError):
            raise fail(
                502, "Provider returned invalid tool arguments.", "invalid_tool_arguments"
            ) from None
        content.append(
            {"type": "tool_use", "id": call["id"], "name": call["function"]["name"], "input": args}
        )
    usage = data.get("usage") or {}
    return {
        "id": "msg_" + uuid.uuid4().hex,
        "type": "message",
        "role": "assistant",
        "model": data.get("model"),
        "content": content,
        "stop_reason": stop_reason(data["choices"][0].get("finish_reason")),
        "stop_sequence": None,
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
        },
    }


def event(name: str, data: dict[str, Any]) -> bytes:
    return f"event: {name}\ndata: {json.dumps({'type': name, **data})}\n\n".encode()


async def converted_stream(response: StreamingResponse, model: str) -> AsyncIterator[bytes]:
    index, text_open = 0, False
    tools: dict[int, dict[str, str]] = {}
    reason: str | None = None
    usage: dict[str, int] = {"input_tokens": 0, "output_tokens": 0}
    finished = False
    yield event(
        "message_start",
        {
            "message": {
                "id": "msg_" + uuid.uuid4().hex,
                "type": "message",
                "role": "assistant",
                "model": model,
                "content": [],
                "stop_reason": None,
                "stop_sequence": None,
                "usage": usage,
            }
        },
    )
    iterator = response.body_iterator
    try:
        async for raw in iterator:
            data_text = "\n".join(
                line[5:].lstrip()
                for line in (raw.decode() if isinstance(raw, bytes) else str(raw)).splitlines()
                if line.startswith("data:")
            )
            if not data_text:
                continue
            if data_text == "[DONE]":
                finished = True
                continue
            data = json.loads(data_text)
            if data.get("error"):
                yield event(
                    "error",
                    {"error": {"type": "api_error", "message": "Upstream stream interrupted."}},
                )
                return
            if data.get("usage"):
                usage.update(
                    input_tokens=data["usage"].get("prompt_tokens", 0),
                    output_tokens=data["usage"].get("completion_tokens", 0),
                )
            for choice in data.get("choices", []):
                if choice.get("index", 0) != 0:
                    continue
                delta = choice.get("delta", {})
                if delta.get("content"):
                    if not text_open:
                        text_open = True
                        yield event(
                            "content_block_start",
                            {"index": index, "content_block": {"type": "text", "text": ""}},
                        )
                    yield event(
                        "content_block_delta",
                        {"index": index, "delta": {"type": "text_delta", "text": delta["content"]}},
                    )
                for call in delta.get("tool_calls", []):
                    tool = tools.setdefault(
                        call.get("index", 0), {"id": "", "name": "", "arguments": ""}
                    )
                    if call.get("id"):
                        tool["id"] = call["id"]
                    fn = call.get("function", {})
                    tool["name"] += fn.get("name", "")
                    tool["arguments"] += fn.get("arguments", "")
                reason = choice.get("finish_reason") or reason
        if not finished:
            yield event(
                "error",
                {"error": {"type": "api_error", "message": "Upstream stream ended unexpectedly."}},
            )
            return
        if text_open:
            yield event("content_block_stop", {"index": index})
            index += 1
        for tool in tools.values():
            json.loads(
                tool["arguments"] or "{}"
            )  # Reject malformed tool arguments instead of fabricating input.
            yield event(
                "content_block_start",
                {
                    "index": index,
                    "content_block": {
                        "type": "tool_use",
                        "id": tool["id"],
                        "name": tool["name"],
                        "input": {},
                    },
                },
            )
            yield event(
                "content_block_delta",
                {
                    "index": index,
                    "delta": {
                        "type": "input_json_delta",
                        "partial_json": tool["arguments"] or "{}",
                    },
                },
            )
            yield event("content_block_stop", {"index": index})
            index += 1
        yield event(
            "message_delta",
            {"delta": {"stop_reason": stop_reason(reason), "stop_sequence": None}, "usage": usage},
        )
        yield event("message_stop", {})
    except (ValueError, KeyError, TypeError):
        yield event(
            "error", {"error": {"type": "api_error", "message": "Invalid upstream message data."}}
        )
    finally:
        if hasattr(iterator, "aclose"):
            await iterator.aclose()


@router.post("/messages")
async def messages(
    body: MessagesRequest, request: Request, principal: GatewayPrincipal
) -> Response:
    result = await Execution(request, principal, convert(body), "chat/completions").run()
    if isinstance(result, StreamingResponse):
        return StreamingResponse(
            converted_stream(result, result.headers.get("X-Gateway-Model", body.model)),
            media_type="text/event-stream",
            headers=dict(result.headers),
        )
    try:
        return JSONResponse(
            converted_response(json.loads(bytes(result.body))),
            headers={
                k: v
                for k, v in result.headers.items()
                if k not in ("content-length", "content-type")
            },
        )
    except (ValueError, KeyError, TypeError):
        raise fail(502, "Invalid upstream message response.", "invalid_upstream_response") from None


@router.post("/messages/count_tokens")
async def count_tokens(body: dict[str, Any], principal: GatewayPrincipal) -> JSONResponse:
    # Deliberately conservative, disclosed approximation; provider tokenizers differ.
    encoded = json.dumps(
        {k: body[k] for k in ("system", "messages", "tools") if k in body}, ensure_ascii=False
    ).encode()
    return JSONResponse(
        {"input_tokens": len(encoded)},
        headers={"X-Gateway-Token-Count": "conservative-byte-estimate"},
    )
