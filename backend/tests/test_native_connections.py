import asyncio
import json
import time
from urllib.parse import parse_qs

import httpx
import pytest
from conftest import MODEL, BytesStream, connect, register

from app.auth import Principal
from app.errors import UpstreamError
from app.models import Provider
from app.native_auth import credentials_for
from app.providers import ADAPTERS
from app.providers.native_responses import to_responses
from app.routing import candidates
from app.schemas import ChatRequest
from app.security import token_hash
from app.subscription_quotas import windows


async def allow_poll(app, flow):
    key = "device-oauth:" + token_hash(flow["flow_id"])
    record = app.state.vault.open(await app.state.shared.get(key))
    record["next_poll"] = 0
    await app.state.shared.put(key, app.state.vault.seal(record), 900)
    return key, record


@pytest.mark.parametrize(
    "kind,host,verify",
    [
        ("github", "github.com", "https://github.com/login/device"),
        ("kimi", "auth.kimi.com", "https://www.kimi.com/code/authorize_device"),
        ("kilocode", "api.kilo.ai", "https://kilo.ai/authorize"),
        ("codex", "auth.openai.com", "https://auth.openai.com/codex/device"),
        ("grok-cli", "auth.x.ai", "https://auth.x.ai/activate"),
    ],
)
async def test_native_device_end_to_end_owner_binding_and_idempotency(
    environment, kind, host, verify
):
    app, client, upstream = environment
    _, owner = await register(client)
    calls = []

    async def handle(request):
        calls.append(request)
        path = request.url.path
        if path.endswith(("device/code", "device_authorization", "/usercode")) or (
            path.endswith("/codes") and request.method == "POST"
        ):
            return httpx.Response(
                200,
                json={
                    "device_code": "private-device",
                    "device_auth_id": "private-device",
                    "code": "public-code",
                    "user_code": "public-code",
                    "verification_uri": verify,
                    "verificationUrl": verify,
                    "interval": 5,
                    "expires_in": 900,
                },
            )
        if path.endswith("/deviceauth/token"):
            return httpx.Response(
                200,
                json={
                    "authorization_code": "authorization-code",
                    "code_verifier": "private-verifier",
                },
            )
        if path.endswith(("/oauth/token", "/access_token", "/oauth2/token")) or "/codes/" in path:
            return httpx.Response(
                200,
                json={
                    "access_token": "native-access-secret",
                    "token": "native-access-secret",
                    "status": "approved",
                    "refresh_token": "native-refresh-secret",
                    "expires_in": 3600,
                },
            )
        if path.endswith("/copilot_internal/v2/token"):
            return httpx.Response(
                200, json={"token": "copilot-access-secret", "expires_at": time.time() + 1800}
            )
        if path.endswith("/models"):
            if kind == "codex":
                return httpx.Response(
                    200,
                    json={
                        "models": [{"slug": "model-native", "input_modalities": ["text", "image"]}]
                    },
                )
            item = {
                "id": "model-native",
                "capabilities": {"type": "chat", "supports": {"tool_calls": True}},
                "policy": {"state": "enabled"},
            }
            return httpx.Response(200, json={"data": [item]})
        return await upstream.handle(request)

    app.state.http._transport = httpx.MockTransport(handle)
    response = await client.post(
        f"/api/oauth/{kind}/start",
        json={"name": "Native account", "preferred_models": ["model-native"]},
    )
    assert response.status_code == 200, response.text
    flow = response.json()
    assert flow["verification_url"] == verify
    assert "private-device" not in response.text
    assert (await client.post(f"/api/oauth/{kind}/poll", json={"flow_id": flow["flow_id"]})).json()[
        "status"
    ] == "pending"
    assert len(calls) == 1  # Server enforces the provider polling interval.
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Origin": "http://test"},
    ) as other:
        await register(other, "other@example.com")
        assert (
            await other.post(f"/api/oauth/{kind}/poll", json={"flow_id": flow["flow_id"]})
        ).status_code == 403
        assert (
            await other.post(f"/api/oauth/{kind}/cancel", json={"flow_id": flow["flow_id"]})
        ).status_code == 403
    await allow_poll(app, flow)
    response = await client.post(f"/api/oauth/{kind}/poll", json={"flow_id": flow["flow_id"]})
    assert response.status_code == 200, response.text
    pid = response.json()["provider_id"]
    assert response.json()["discovery"]["status"] == "ok"
    before = len(calls)
    assert (await client.post(f"/api/oauth/{kind}/poll", json={"flow_id": flow["flow_id"]})).json()[
        "provider_id"
    ] == pid
    assert len(calls) == before
    async with app.state.db() as db:
        p = await db.get(Provider, pid)
        assert p.user_id == owner and p.preferred_models == ["model-native"]
        assert "native-access-secret" not in p.encrypted_credentials
        assert (
            app.state.vault.open(p.encrypted_credentials)["access_token"] == "native-access-secret"
        )
    listed = await client.get("/api/providers")
    assert listed.json()[0]["auth_type"] == "oauth"
    assert "native-access-secret" not in listed.text and "native-refresh-secret" not in listed.text
    assert (
        await client.patch(f"/api/providers/{pid}", json={"api_key": "replacement"})
    ).status_code == 422
    assert (await client.get("/api/models")).json()["data"][0]["model_id"] == "model-native"
    if kind == "codex":
        exchange = next(r for r in calls if r.url.path == "/oauth/token")
        assert parse_qs(exchange.content.decode())["redirect_uri"] == [
            "https://auth.openai.com/deviceauth/callback"
        ]


async def test_device_flow_cancel_slowdown_expiry_csrf_and_verification_allowlist(environment):
    app, client, _ = environment
    await register(client)
    verify = "https://www.kimi.com/code/authorize_device"
    reply = {"error": "slow_down"}
    calls = []

    async def handle(request):
        calls.append(request)
        if request.url.path.endswith("device_authorization"):
            return httpx.Response(
                200, json={"device_code": "device", "user_code": "CODE", "verification_uri": verify}
            )
        return httpx.Response(400, json=reply)

    app.state.http._transport = httpx.MockTransport(handle)
    assert (
        await client.post(
            "/api/oauth/kimi/start", json={"name": "Kimi"}, headers={"X-CSRF-Token": "wrong"}
        )
    ).status_code == 403
    assert not calls
    flow = (await client.post("/api/oauth/kimi/start", json={"name": "Kimi"})).json()
    key, _ = await allow_poll(app, flow)
    response = await client.post("/api/oauth/kimi/poll", json={"flow_id": flow["flow_id"]})
    assert response.json() == {"status": "pending", "interval": 10}
    assert (await client.post("/api/oauth/kimi/cancel", json={"flow_id": flow["flow_id"]})).json()[
        "status"
    ] == "cancelled"
    assert await app.state.shared.get(key) is None
    assert (
        await client.post("/api/oauth/kimi/poll", json={"flow_id": flow["flow_id"]})
    ).status_code == 400
    verify = "https://attacker.example/steal"
    assert (await client.post("/api/oauth/kimi/start", json={"name": "Kimi"})).status_code == 502
    verify = "https://www.kimi.com@attacker.example/"
    assert (await client.post("/api/oauth/kimi/start", json={"name": "Kimi"})).status_code == 502


async def test_rotating_refresh_is_serialized_and_persisted(environment):
    app, client, _ = environment
    _, uid = await register(client)
    async with app.state.db() as db:
        p = Provider(
            user_id=uid,
            kind="kimi",
            name="Kimi",
            base_url=ADAPTERS["kimi"].default_url,
            encrypted_credentials=app.state.vault.seal(
                {
                    "auth_type": "oauth",
                    "access_token": "expired",
                    "refresh_token": "refresh-old",
                    "expires_at": time.time() - 1,
                }
            ),
        )
        db.add(p)
        await db.commit()
        pid = p.id
    calls = []

    async def handle(request):
        calls.append(request)
        await asyncio.sleep(0.05)
        assert parse_qs(request.content.decode())["refresh_token"] == ["refresh-old"]
        return httpx.Response(
            200,
            json={"access_token": "access-new", "refresh_token": "refresh-new", "expires_in": 3600},
        )

    app.state.http._transport = httpx.MockTransport(handle)
    results = await asyncio.gather(*(credentials_for(app.state, pid) for _ in range(4)))
    assert len(calls) == 1
    assert all(
        r["access_token"] == "access-new" and r["refresh_token"] == "refresh-new" for r in results
    )
    async with app.state.db() as db:
        p = await db.get(Provider, pid)
        p.enabled = False
        await db.commit()
    with pytest.raises(UpstreamError):
        await credentials_for(app.state, pid)


async def test_ranked_preferences_fallback_exact_routes_and_user_isolation(environment):
    app, client, upstream = environment
    key, uid = await register(client)
    upstream.catalog = [{**MODEL, "id": mid} for mid in ["alpha", "beta", "gamma"]]
    pid = await connect(client)
    response = await client.patch(
        f"/api/providers/{pid}",
        json={"preferred_models": ["gamma", "beta"], "preferred_only": True},
    )
    assert response.status_code == 200
    principal = Principal(user_id=uid, key_id=None)
    body = ChatRequest(model="auto", messages=[{"role": "user", "content": "Hi"}])
    assert [
        c.model.model_id for c in await candidates(app.state, principal, body, "chat/completions")
    ] == ["gamma", "beta"]
    exact = body.model_copy(update={"model": pid + "::alpha"})
    assert [
        c.model.model_id for c in await candidates(app.state, principal, exact, "chat/completions")
    ] == ["alpha"]
    models = await candidates(app.state, principal, body, "chat/completions")
    await app.state.shared.failed(models[0].scope, 429, 20)
    assert [
        c.model.model_id for c in await candidates(app.state, principal, body, "chat/completions")
    ] == ["beta"]
    await app.state.shared.delete("health:" + models[0].scope)
    attempted = []

    async def handle(request):
        payload = json.loads(request.content)
        attempted.append(payload["model"])
        if payload["model"] == "gamma":
            return httpx.Response(404)
        return await upstream.handle(request)

    app.state.http._transport = httpx.MockTransport(handle)
    response = await client.post(
        "/v1/chat/completions", headers={"Authorization": "Bearer " + key}, json=body.model_dump()
    )
    assert response.status_code == 200, response.text
    assert attempted == ["gamma", "beta"]
    assert (
        await client.patch(f"/api/providers/{pid}", json={"preferred_models": []})
    ).status_code == 422
    assert (
        await client.patch(f"/api/providers/{pid}", json={"preferred_models": ["beta", "beta"]})
    ).status_code == 422
    assert (
        await client.patch(f"/api/providers/{pid}", json={"preferred_models": ["has space"]})
    ).status_code == 422
    await register(client, "other@example.com")
    assert (
        await client.patch(f"/api/providers/{pid}", json={"preferred_only": False})
    ).status_code == 404


@pytest.mark.parametrize("streaming", [True, False])
async def test_native_responses_translation_tools_usage_and_stream_closure(streaming):
    result = {
        "id": "response-test",
        "status": "completed",
        "output": [
            {
                "type": "function_call",
                "call_id": "call-1",
                "name": "weather",
                "arguments": '{"city":"Delhi"}',
            }
        ],
        "usage": {"input_tokens": 9, "output_tokens": 4},
    }
    events = [
        {"type": "response.created", "response": {}},
        {
            "type": "response.output_item.added",
            "output_index": 3,
            "item": {
                "type": "function_call",
                "call_id": "call-1",
                "name": "weather",
                "arguments": "",
            },
        },
        {
            "type": "response.function_call_arguments.delta",
            "output_index": 3,
            "delta": '{"city":"Delhi"}',
        },
        {"type": "response.completed", "response": result},
    ]
    stream = BytesStream([b"data: " + json.dumps(event).encode() + b"\n\n" for event in events])
    calls = []

    async def handle(request):
        calls.append(request)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=stream)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        adapter = ADAPTERS["codex"](
            client,
            ADAPTERS["codex"].default_url,
            {"access_token": "private-access", "account_id": "account-a"},
            100000,
        )
        response = await adapter.send(
            "chat/completions",
            {
                "model": "model-test",
                "stream": streaming,
                "messages": [
                    {"role": "system", "content": "Be precise"},
                    {"role": "user", "content": "Weather?"},
                ],
                "tools": [
                    {
                        "type": "function",
                        "function": {"name": "weather", "parameters": {"type": "object"}},
                    }
                ],
            },
        )
        if streaming:
            text = (await response.aread()).decode()
            assert '"index": 0' in text and "[DONE]" in text and '"total_tokens": 13' in text
        else:
            assert response.json()["choices"][0]["message"]["tool_calls"][0]["id"] == "call-1"
            assert response.json()["usage"]["total_tokens"] == 13
        assert stream.closed
        body = json.loads(calls[0].content)
        assert body["stream"] is True and body["store"] is False
        assert body["input"][0]["role"] == "developer"
        assert calls[0].headers["ChatGPT-Account-ID"] == "account-a"
        assert calls[0].url.host == "chatgpt.com"
        with pytest.raises(UpstreamError):
            await adapter.send(
                "chat/completions", {"model": "m", "messages": [], "temperature": 0.5}
            )


async def test_native_stream_rejects_truncation_and_provider_errors():
    for event in [
        {"type": "response.output_text.delta", "delta": "partial"},
        {"type": "response.failed", "response": {"error": "private-secret"}},
    ]:
        stream = BytesStream([b"data: " + json.dumps(event).encode() + b"\n\n"])
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: httpx.Response(200, stream=stream))
        ) as client:
            adapter = ADAPTERS["codex"](
                client, ADAPTERS["codex"].default_url, {"access_token": "a"}, 10000
            )
            with pytest.raises(UpstreamError) as caught:
                await adapter.send("chat/completions", {"model": "m", "messages": []})
            assert "private-secret" not in str(caught.value)
            assert stream.closed


def test_native_quota_units_unknown_values_and_reset_dates():
    now = time.time()
    codex = windows(
        "codex",
        {
            "rate_limit": {
                "primary_window": {
                    "used_percent": 32,
                    "reset_at": now + 60,
                    "limit_window_seconds": 18000,
                },
                "secondary_window": {},
            }
        },
        now,
    )
    assert len(codex) == 1 and codex[0]["remaining"] == 68 and "(%)" in codex[0]["resource"]
    kimi = windows(
        "kimi", {"usage": {"limit": 100, "used": 12}, "limits": [{"detail": {"limit": 50}}]}, now
    )
    assert kimi[0]["remaining"] == 88 and kimi[1]["remaining"] is None
    assert all("provider units" in w["resource"] for w in kimi)
    assert windows("github", {"quota_snapshots": {"chat": {"unlimited": True}}}, now) == []


def test_chat_tool_results_and_images_translate_without_dropping_content():
    result = to_responses(
        {
            "model": "m",
            "messages": [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{"id": "c", "function": {"name": "f", "arguments": "{}"}}],
                },
                {"role": "tool", "tool_call_id": "c", "content": "result"},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Look"},
                        {"type": "image_url", "image_url": {"url": "https://example.com/img.png"}},
                    ],
                },
            ],
        }
    )
    assert result["input"][0]["type"] == "function_call"
    assert result["input"][1] == {
        "type": "function_call_output",
        "call_id": "c",
        "output": "result",
    }
    assert result["input"][2]["content"][1]["image_url"] == "https://example.com/img.png"


@pytest.mark.parametrize("streaming", [True, False])
async def test_native_malformed_completion_is_sanitized_and_closed(streaming):
    stream = BytesStream(
        [
            b'data: {"type":"response.completed","response":{"output":[{"type":"function_call"}]}}\n\n'
        ]
    )
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, stream=stream))
    ) as client:
        adapter = ADAPTERS["codex"](
            client, ADAPTERS["codex"].default_url, {"access_token": "a"}, 10000
        )
        with pytest.raises(UpstreamError, match="invalid_upstream_stream"):
            response = await adapter.send(
                "chat/completions", {"model": "m", "messages": [], "stream": streaming}
            )
            await response.aread()
        assert stream.closed
