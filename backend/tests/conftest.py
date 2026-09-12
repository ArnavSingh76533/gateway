import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
from cryptography.fernet import Fernet

from app.config import Settings
from app.main import create_app

MODEL = {
    "id": "model-a",
    "name": "Model A",
    "context_length": 100000,
    "capabilities": {
        "chat": True,
        "tools": True,
        "vision": True,
        "streaming": True,
        "json_mode": True,
        "reasoning": True,
        "embeddings": True,
        "speech": True,
        "transcription": True,
        "images": True,
        "responses": True,
    },
}


class BytesStream(httpx.AsyncByteStream):
    def __init__(self, chunks: list[bytes]):
        self.chunks = chunks
        self.closed = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self.chunks:
            yield chunk

    async def aclose(self) -> None:
        self.closed = True


@dataclass
class Upstream:
    calls: list[httpx.Request] = field(default_factory=list)
    statuses: dict[str, int] = field(default_factory=dict)
    streams: dict[str, list[bytes]] = field(default_factory=dict)
    responses: dict[str, Any] = field(default_factory=dict)
    catalog: list[dict[str, Any]] = field(default_factory=lambda: [MODEL])
    opened_streams: list[BytesStream] = field(default_factory=list)

    async def handle(self, request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if request.method == "GET":
            return httpx.Response(200, json={"data": self.catalog})
        self.calls.append(request)
        status = self.statuses.get(host, 200)
        if status != 200:
            return httpx.Response(
                status,
                json={"error": {"message": "LEAK-THIS-SECRET upstream-provider-key"}},
                headers={"Retry-After": "1"},
            )
        payload = (
            json.loads(request.content)
            if "application/json" in request.headers.get("content-type", "")
            else {}
        )
        if payload.get("stream"):
            chunks = self.streams.get(
                host,
                [
                    b'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\n',
                    b'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
                    b"data: [DONE]\n\n",
                ],
            )
            stream = BytesStream(chunks)
            self.opened_streams.append(stream)
            return httpx.Response(200, headers={"Content-Type": "text/event-stream"}, stream=stream)
        if request.url.path.endswith("audio/speech"):
            return httpx.Response(
                200, content=b"RIFFaudio-data", headers={"Content-Type": "audio/wav"}
            )
        if request.url.path.endswith("audio/transcriptions"):
            return httpx.Response(200, json={"text": "Spoken words"})
        if request.url.path.endswith("embeddings"):
            return httpx.Response(
                200,
                json={
                    "object": "list",
                    "data": [{"object": "embedding", "index": 0, "embedding": [0.1, 0.2]}],
                    "usage": {"prompt_tokens": 10, "total_tokens": 10},
                },
            )
        if request.url.path.endswith("images/generations"):
            return httpx.Response(200, json={"created": 1, "data": [{"b64_json": "aW1hZ2U="}]})
        return httpx.Response(
            200,
            json=self.responses.get(
                host,
                {
                    "id": "chatcmpl-test",
                    "object": "chat.completion",
                    "created": 1,
                    "model": payload.get("model"),
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": "Hello"},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
                },
            ),
        )


@pytest.fixture
async def environment(tmp_path: Any) -> AsyncIterator[tuple[Any, httpx.AsyncClient, Upstream]]:
    upstream = Upstream()
    settings = Settings(
        encryption_keys=Fernet.generate_key().decode(),
        database_url=f"sqlite+aiosqlite:///{tmp_path}/test.db",
        allowed_origins=["http://test"],
        requests_per_minute=1000,
        static_dir=str(tmp_path),
    )
    app = create_app(settings, httpx.MockTransport(upstream.handle), background=False)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as client:
            yield app, client, upstream


async def register(client: httpx.AsyncClient, email: str = "alice@example.com") -> tuple[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"email": email, "password": "correct-horse-battery-123", "name": "Alice"},
    )
    assert response.status_code == 201, response.text
    client.headers["X-CSRF-Token"] = client.cookies.get("gw_csrf", "")
    return response.json()["gateway_key"], response.json()["user"]["id"]


async def connect(
    client: httpx.AsyncClient,
    name: str = "Primary",
    host: str = "first.example.com",
    priority: int = 1,
    models: list[dict] | None = None,
) -> str:
    response = await client.post(
        "/api/providers",
        json={
            "kind": "custom",
            "name": name,
            "base_url": f"https://{host}/v1",
            "api_key": "upstream-provider-key",
            "headers": {"X-Custom-Secret": "private-header-value"},
            "priority": priority,
            "models": models or [],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]
