import base64
import hashlib
import json
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from conftest import BytesStream, connect, register
from sqlalchemy import select

from app.errors import UpstreamError
from app.models import Provider
from app.providers import ADAPTERS
from app.providers.catalog import CATALOG, DIRECT
from app.providers.native_anthropic import NativeAnthropicAdapter, to_messages
from app.quotas import header_windows, reset_time
from app.security import token_hash


def test_provider_catalog_agrees_with_frontend_and_supported_adapters():
    frontend = Path(__file__).resolve().parents[2] / "frontend/lib/provider-catalog.json"
    assert json.loads(frontend.read_text(encoding="utf-8")) == CATALOG
    assert len({p["id"] for p in CATALOG}) == len(CATALOG)
    assert set(DIRECT) == set(ADAPTERS)
    assert len(DIRECT) > 50
    assert all(p["auth"] == ["9router"] for p in CATALOG if p["integration"] == "bridge")


@pytest.mark.parametrize(
    "value,expected",
    [
        ("7.66s", 1007.66),
        ("1h2m3s", 4723),
        ("120ms", 1000.12),
        ("60", 1060),
        ("1700000000", 1700000000),
        ("1700000000000", 1700000000),
        ("2025-01-01T00:00:00Z", 1735689600),
        ("nonsense", None),
        ("NaN", None),
    ],
)
def test_reset_formats(value, expected):
    assert reset_time(value, 1000) == expected


def test_limits_preserve_unknowns_and_anthropic_header_order():
    windows = header_windows(
        httpx.Headers(
            {
                "x-ratelimit-remaining-tokens": "0",
                "x-ratelimit-limit-tokens": "1000",
                "x-ratelimit-reset-tokens": "2m",
                "anthropic-ratelimit-requests-remaining": "8",
                "anthropic-ratelimit-requests-reset": "2025-01-01T00:00:00Z",
            }
        ),
        1000,
    )
    assert windows[0]["limit"] is None
    assert windows[1]["remaining"] == 0
    assert windows[1]["reset_at"] == 1120
    assert header_windows(httpx.Headers({"authorization": "SECRET"}), 1000) == []
    assert header_windows(httpx.Headers({"x-ratelimit-remaining": "2"}), 1000)[0]["remaining"] == 2


async def test_quota_capture_usage_isolation_and_credential_replacement(environment):
    app, client, upstream = environment
    key, _ = await register(client)
    pid = await connect(client)
    original = upstream.handle

    async def handle(request):
        response = await original(request)
        if request.method == "POST":
            response.headers.update(
                {
                    "x-ratelimit-remaining-tokens": "876",
                    "x-ratelimit-limit-tokens": "1000",
                    "x-ratelimit-reset-tokens": "7s",
                }
            )
        return response

    app.state.http._transport = httpx.MockTransport(handle)
    response = await client.post(
        "/v1/chat/completions",
        headers={"Authorization": "Bearer " + key},
        json={"model": pid + "::model-a", "messages": [{"role": "user", "content": "hello"}]},
    )
    assert response.status_code == 200
    data = (await client.get("/api/quotas")).json()["data"][0]
    assert data["windows"][0]["remaining"] == 876
    assert data["model"] == "model-a"
    assert data["gateway_usage_24h"]["input_tokens"] == 10
    assert data["gateway_usage_24h"]["requests"] == 1
    assert "upstream-provider-key" not in json.dumps(data)
    assert (
        await client.patch("/api/providers/" + pid, json={"api_key": "replacement"})
    ).status_code == 200
    assert (await client.get("/api/quotas")).json()["data"][0]["windows"] == []
    await client.post("/api/auth/logout")
    await register(client, "second@example.com")
    assert (await client.get("/api/quotas")).json()["data"] == []
    assert (await client.post(f"/api/providers/{pid}/quota-refresh")).status_code == 404


async def test_balance_refresh_distinguishes_dollars_daily_requests_and_limits(environment):
    app, client, upstream = environment
    await register(client)
    pid = (
        await client.post(
            "/api/providers", json={"kind": "openrouter", "name": "Router", "api_key": "secret"}
        )
    ).json()["id"]
    original = upstream.handle

    async def handle(request):
        if request.url.path == "/api/v1/key":
            assert request.headers["authorization"] == "Bearer secret"
            return httpx.Response(
                200,
                json={
                    "data": {
                        "limit": 10,
                        "limit_remaining": 8.25,
                        "usage": 1.75,
                        "limit_reset": "monthly",
                        "free_model_daily_requests": {"limit": 50, "remaining": 42},
                    }
                },
            )
        return await original(request)

    app.state.http._transport = httpx.MockTransport(handle)
    response = await client.post(f"/api/providers/{pid}/quota-refresh")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["balance"]["unit"] == "USD"
    assert data["balance"]["remaining"] == 8.25
    assert data["windows"][0]["resource"] == "free-model daily requests"
    assert data["windows"][0]["remaining"] == 42
    assert data["windows"][0]["reset_at"] > time.time()
    assert (await client.post(f"/api/providers/{pid}/quota-refresh")).status_code == 429
    custom = (
        await client.post(
            "/api/providers",
            json={
                "kind": "openrouter",
                "name": "Other endpoint",
                "api_key": "secret",
                "base_url": "https://other.example.com/v1",
            },
        )
    ).json()["id"]
    assert (await client.post(f"/api/providers/{custom}/quota-refresh")).status_code == 400


async def oauth_start(client):
    response = await client.post("/api/oauth/openrouter/start", json={"name": "OAuth router"})
    assert response.status_code == 200, response.text
    query = parse_qs(urlsplit(response.json()["authorization_url"]).query)
    callback = urlsplit(query["callback_url"][0])
    state = parse_qs(callback.query)["state"][0]
    return query, callback.path + "?" + callback.query, state


async def test_oauth_pkce_encryption_session_binding_and_replay(environment):
    app, client, upstream = environment
    await register(client)
    query, callback, state = await oauth_start(client)
    sealed = await app.state.shared.get("oauth:" + token_hash(state))
    assert sealed and "verifier" not in sealed
    record = app.state.vault.open(sealed)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(record["verifier"].encode()).digest())
        .decode()
        .rstrip("=")
    )
    assert query["code_challenge"] == [challenge]
    assert query["code_challenge_method"] == ["S256"]
    original = upstream.handle
    exchanges = []

    async def handle(request):
        if request.url.path == "/api/v1/auth/keys":
            exchanges.append(json.loads(request.content))
            return httpx.Response(200, json={"key": "oauth-secret-key"})
        return await original(request)

    app.state.http._transport = httpx.MockTransport(handle)
    # A second logged-in account cannot consume the first account's authorization state.
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Origin": "http://test"},
    ) as other:
        await register(other, "other@example.com")
        assert (await other.get(callback + "&code=abc")).status_code == 403
    response = await client.get(callback + "&code=abc")
    assert response.status_code == 303
    assert response.headers["location"] == "/?connection=connected#providers"
    assert exchanges == [
        {"code": "abc", "code_verifier": record["verifier"], "code_challenge_method": "S256"}
    ]
    assert (await client.get(callback + "&code=abc")).status_code == 400
    async with app.state.db() as db:
        provider = await db.scalar(select(Provider).where(Provider.name == "OAuth router"))
        assert "oauth-secret-key" not in provider.encrypted_credentials
        assert app.state.vault.open(provider.encrypted_credentials)["api_key"] == "oauth-secret-key"
    assert "oauth-secret-key" not in (await client.get("/api/providers")).text


async def test_oauth_csrf_and_expired_state(environment):
    app, client, _ = environment
    await register(client)
    assert (
        await client.post("/api/oauth/openrouter/start", json={}, headers={"X-CSRF-Token": "wrong"})
    ).status_code == 403
    _, callback, state = await oauth_start(client)
    await app.state.shared.delete("oauth:" + token_hash(state))
    assert (await client.get(callback + "&code=abc")).status_code == 400
    _, callback, _ = await oauth_start(client)
    assert (await client.get(callback + "&error=cancelled")).headers[
        "location"
    ] == "/?connection=cancelled#providers"


async def test_9router_discovery_preserves_provider_prefixes_and_service_catalogs():
    requests = []

    async def handle(request):
        requests.append(request)
        model = {
            "/v1/models": {"id": "claude/claude-test", "capabilities": {"vision": True}},
            "/v1/models/embedding": {"id": "voyage/voyage-test"},
            "/v1/models/image": {"id": "recraft/recraft-test"},
        }.get(request.url.path)
        return httpx.Response(200, json={"data": [model] if model else []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
        adapter = ADAPTERS["9router"](
            http, "https://private.example.com/v1", {"api_key": "bridge-key"}, 100000
        )
        models = {m.model_id: m for m in await adapter.discover()}
    assert len(requests) == 5
    assert all(r.headers["authorization"] == "Bearer bridge-key" for r in requests)
    assert models["claude/claude-test"].capabilities["chat"] is True
    assert models["voyage/voyage-test"].capabilities["embeddings"] is True
    assert models["recraft/recraft-test"].capabilities["chat"] is False


async def test_native_anthropic_translation_and_streaming_tools():
    calls = []
    stream = BytesStream(
        [
            b'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":5}}}\n\n',
            b'data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"tool-1","name":"weather"}}\n\n',
            b'data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"Delhi\\"}"}}\n\n',
            b'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":8}}\n\n',
            b'data: {"type":"message_stop"}\n\n',
        ]
    )

    async def handle(request):
        calls.append(request)
        if json.loads(request.content).get("stream"):
            return httpx.Response(200, stream=stream, headers={"content-type": "text/event-stream"})
        return httpx.Response(
            200,
            json={
                "id": "msg-1",
                "content": [{"type": "text", "text": "Hello"}],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 3, "output_tokens": 2},
            },
        )

    payload = {
        "model": "claude-test",
        "messages": [
            {"role": "system", "content": "Be concise"},
            {"role": "user", "content": "Hi"},
        ],
        "tools": [
            {"type": "function", "function": {"name": "weather", "parameters": {"type": "object"}}}
        ],
        "tool_choice": "required",
    }
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
        adapter = NativeAnthropicAdapter(
            http, "https://api.anthropic.com/v1", {"api_key": "test-key"}, 100000
        )
        result = await adapter.send("chat/completions", payload)
        assert result.json()["choices"][0]["message"]["content"] == "Hello"
        assert result.json()["usage"]["total_tokens"] == 5
        response = await adapter.send("chat/completions", {**payload, "stream": True})
        data = (await response.aread()).decode()
    assert stream.closed
    chunks = [
        json.loads(line[6:])
        for line in data.splitlines()
        if line.startswith("data:") and "[DONE]" not in line
    ]
    assert chunks[1]["choices"][0]["delta"]["tool_calls"][0]["index"] == 0
    assert chunks[-1]["usage"]["prompt_tokens"] == 15
    assert chunks[-1]["choices"][0]["finish_reason"] == "tool_calls"
    assert calls[0].headers["x-api-key"] == "test-key"
    assert "authorization" not in calls[0].headers
    body = json.loads(calls[0].content)
    assert body["system"] == [{"type": "text", "text": "Be concise"}]
    assert body["tool_choice"] == {"type": "any"}
    assert body["max_tokens"] == 4096
    with pytest.raises(UpstreamError):
        to_messages({**payload, "response_format": {"type": "json_object"}})
