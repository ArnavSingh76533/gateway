import json
from typing import Any

import pytest
from conftest import connect, register
from sqlalchemy import select

from app.models import GatewayKey, Provider

CHAT = {"model": "model-a", "messages": [{"role": "user", "content": "PRIVATE PROMPT CONTENT"}]}


async def test_account_encryption_and_no_credential_readback(environment: Any) -> None:
    app, client, upstream = environment
    key, uid = await register(client)
    pid = await connect(client)
    text = (await client.get("/api/providers")).text
    assert "upstream-provider-key" not in text and "private-header-value" not in text
    assert "encrypted_credentials" not in text
    async with app.state.db() as db:
        provider = await db.get(Provider, pid)
        assert provider and "upstream-provider-key" not in provider.encrypted_credentials
        assert (
            app.state.vault.open(provider.encrypted_credentials)["headers"]["X-Custom-Secret"]
            == "private-header-value"
        )
        stored = await db.scalar(select(GatewayKey).where(GatewayKey.user_id == uid))
        assert stored and stored.token_hash != key and not stored.token_hash.startswith("gw_")
    response = await client.post(
        "/v1/chat/completions", json=CHAT, headers={"Authorization": f"Bearer {key}"}
    )
    assert response.status_code == 200, response.text
    assert upstream.calls[-1].headers["authorization"] == "Bearer upstream-provider-key"
    assert upstream.calls[-1].headers["x-custom-secret"] == "private-header-value"
    history = await client.get("/api/logs")
    assert "PRIVATE PROMPT CONTENT" not in history.text
    assert "upstream-provider-key" not in history.text
    usage = (await client.get("/api/usage")).json()
    assert usage["summary"]["requests"] == 1
    assert usage["summary"]["input_tokens"] == 10
    assert usage["summary"]["estimated_cost"] is None


async def test_tenant_isolation_and_key_revocation(environment: Any) -> None:
    _, client, _ = environment
    first, _ = await register(client)
    pid = await connect(client)
    kid = (await client.get("/api/keys")).json()[0]["id"]
    second, _ = await register(client, "bob@example.com")
    assert (await client.get("/api/providers")).json() == []
    assert (await client.patch(f"/api/providers/{pid}", json={"enabled": False})).status_code == 404
    assert (await client.delete(f"/api/keys/{kid}")).status_code == 404
    assert (await client.get("/v1/models", headers={"Authorization": f"Bearer {second}"})).json()[
        "data"
    ] == []
    own = (await client.get("/api/keys")).json()[0]["id"]
    await client.delete(f"/api/keys/{own}")
    assert (
        await client.get("/v1/models", headers={"Authorization": f"Bearer {second}"})
    ).status_code == 401
    assert (
        await client.get("/v1/models", headers={"Authorization": f"Bearer {first}"})
    ).status_code == 200


@pytest.mark.parametrize("status", [401, 403, 429, 500, 502, 503, 504, 404])
async def test_fallback_and_sanitized_attempt_history(environment: Any, status: int) -> None:
    _, client, upstream = environment
    key, _ = await register(client)
    await connect(client)
    await connect(client, "Backup", "backup.example.com", 2)
    upstream.statuses["first.example.com"] = status
    response = await client.post(
        "/v1/chat/completions", json=CHAT, headers={"Authorization": f"Bearer {key}"}
    )
    assert response.status_code == 200, response.text
    assert response.headers["x-gateway-attempts"] == "2"
    assert [r.url.host for r in upstream.calls] == ["first.example.com", "backup.example.com"]
    history = (await client.get("/api/logs")).json()["data"][0]
    assert [a["status"] for a in history["attempts"]] == [status, 200]
    assert "LEAK-THIS-SECRET" not in json.dumps(history)


async def test_retry_budget_and_provider_pin(environment: Any) -> None:
    _, client, upstream = environment
    key, _ = await register(client)
    pid = await connect(client)
    await connect(client, "Backup", "backup.example.com", 2)
    upstream.statuses["first.example.com"] = 500
    headers = {"Authorization": f"Bearer {key}"}
    response = await client.post(
        "/v1/chat/completions", json={**CHAT, "max_retries": 0}, headers=headers
    )
    assert response.status_code == 502
    assert len(upstream.calls) == 1
    assert "LEAK" not in response.text
    response = await client.post(
        "/v1/chat/completions", json={**CHAT, "provider": pid}, headers=headers
    )
    assert response.status_code == 404  # Failed connection remains in its cooldown.
    assert len(upstream.calls) == 1


async def test_no_fallback_on_invalid_parameters(environment: Any) -> None:
    _, client, upstream = environment
    key, _ = await register(client)
    await connect(client)
    await connect(client, "Backup", "backup.example.com", 2)
    upstream.statuses["first.example.com"] = 400
    response = await client.post(
        "/v1/chat/completions", json=CHAT, headers={"Authorization": f"Bearer {key}"}
    )
    assert response.status_code == 400 and len(upstream.calls) == 1


async def test_streaming_sse_usage_and_cleanup(environment: Any) -> None:
    _, client, upstream = environment
    key, _ = await register(client)
    await connect(client)
    response = await client.post(
        "/v1/chat/completions",
        json={**CHAT, "stream": True},
        headers={"Authorization": f"Bearer {key}"},
    )
    assert response.status_code == 200
    assert "[DONE]" in response.text and "Hello" in response.text
    assert upstream.opened_streams[0].closed
    log = (await client.get("/api/logs")).json()["data"][0]
    assert log["input_tokens"] == 10 and log["output_tokens"] == 2 and log["status"] == 200


async def test_pre_stream_error_falls_back(environment: Any) -> None:
    _, client, upstream = environment
    key, _ = await register(client)
    await connect(client)
    await connect(client, "Backup", "backup.example.com", 2)
    upstream.streams["first.example.com"] = [
        b'data: {"error":{"code":429,"message":"LEAK-THIS-SECRET"}}\n\n'
    ]
    response = await client.post(
        "/v1/chat/completions",
        json={**CHAT, "stream": True},
        headers={"Authorization": f"Bearer {key}"},
    )
    assert response.status_code == 200 and "Hello" in response.text and "LEAK" not in response.text
    assert len(upstream.calls) == 2


async def test_never_retry_after_output_starts(environment: Any) -> None:
    _, client, upstream = environment
    key, _ = await register(client)
    await connect(client)
    await connect(client, "Backup", "backup.example.com", 2)
    upstream.streams["first.example.com"] = [
        b'data: {"choices":[{"delta":{"content":"first output"}}]}\n\n',
        b'data: {"error":{"message":"LEAK-THIS-SECRET"}}\n\n',
    ]
    response = await client.post(
        "/v1/chat/completions",
        json={**CHAT, "stream": True},
        headers={"Authorization": f"Bearer {key}"},
    )
    assert "first output" in response.text and "stream_interrupted" in response.text
    assert "LEAK" not in response.text and len(upstream.calls) == 1
    assert (await client.get("/api/logs")).json()["data"][0]["status"] == 502
    assert upstream.opened_streams[0].closed


async def test_exact_model_and_capability_constraints(environment: Any) -> None:
    _, client, upstream = environment
    key, _ = await register(client)
    await connect(client)
    headers = {"Authorization": f"Bearer {key}"}
    response = await client.post(
        "/v1/chat/completions", json={**CHAT, "model": "nonexistent"}, headers=headers
    )
    assert response.status_code == 404 and len(upstream.calls) == 0
    response = await client.post(
        "/v1/chat/completions",
        json={**CHAT, "model": "nonexistent", "allow_alternatives": True},
        headers=headers,
    )
    assert response.status_code == 200
    assert json.loads(upstream.calls[-1].content)["model"] == "model-a"
    result = await client.post(
        "/v1/chat/completions", json={**CHAT, "model": "auto/no-such-mode"}, headers=headers
    )
    assert result.status_code == 400


async def test_tools_vision_and_json_fields_preserved(environment: Any) -> None:
    _, client, upstream = environment
    key, _ = await register(client)
    await connect(client)
    payload = {
        **CHAT,
        "model": "auto/vision",
        "tools": [
            {"type": "function", "function": {"name": "lookup", "parameters": {"type": "object"}}}
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "item", "schema": {"type": "object"}},
        },
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,aGVsbG8="}}
                ],
            }
        ],
    }
    response = await client.post(
        "/v1/chat/completions", json=payload, headers={"Authorization": f"Bearer {key}"}
    )
    assert response.status_code == 200, response.text
    sent = json.loads(upstream.calls[-1].content)
    assert sent["tools"] == payload["tools"] and sent["messages"] == payload["messages"]
    assert sent["response_format"] == payload["response_format"]
    assert "routing" not in sent and "provider" not in sent


async def test_embeddings_audio_and_images(environment: Any) -> None:
    _, client, _ = environment
    key, _ = await register(client)
    await connect(client)
    headers = {"Authorization": f"Bearer {key}"}
    embedding = await client.post(
        "/v1/embeddings", json={"model": "auto/embedding", "input": ["one", "two"]}, headers=headers
    )
    assert embedding.status_code == 200 and embedding.json()["data"][0]["embedding"] == [0.1, 0.2]
    image = await client.post(
        "/v1/images/generations",
        json={"model": "auto/image", "prompt": "landscape"},
        headers=headers,
    )
    assert image.status_code == 200 and image.json()["data"][0]["b64_json"]
    audio = await client.post(
        "/v1/audio/speech",
        json={"model": "model-a", "input": "hello", "voice": "alloy"},
        headers=headers,
    )
    assert audio.status_code == 200 and audio.content.startswith(b"RIFF")
    transcript = await client.post(
        "/v1/audio/transcriptions",
        data={"model": "model-a"},
        files={"file": ("a.wav", b"RIFF-test", "audio/wav")},
        headers=headers,
    )
    assert transcript.status_code == 200 and transcript.json()["text"] == "Spoken words"


async def test_csrf_origin_validation_and_key_error_redaction(environment: Any) -> None:
    _, client, _ = environment
    await register(client)
    response = await client.post("/api/keys", json={"name": "x"}, headers={"X-CSRF-Token": ""})
    assert response.status_code == 403
    response = await client.post(
        "/api/keys", json={"name": "x"}, headers={"Origin": "https://evil.example"}
    )
    assert response.status_code == 403
    response = await client.post(
        "/api/providers",
        json={"kind": "invalid-provider", "api_key": "SECRET-IN-INVALID-BODY", "name": "Test"},
    )
    assert response.status_code == 422 and "SECRET-IN-INVALID-BODY" not in response.text
    response = await client.post(
        "/api/providers",
        json={"kind": "custom", "name": "Test", "base_url": "https://example.com/v1?key=SECRET"},
    )
    assert response.status_code == 422 and "SECRET" not in response.text


async def test_live_data_isolation_csv_and_priced_usage(environment: Any) -> None:
    _, client, _ = environment
    key, _ = await register(client)
    await connect(
        client,
        models=[
            {
                "model_id": "model-a",
                "capabilities": {"chat": True},
                "input_price": 1,
                "output_price": 2,
            }
        ],
    )
    await client.post("/v1/chat/completions", json=CHAT, headers={"Authorization": f"Bearer {key}"})
    usage = (await client.get("/api/usage")).json()["summary"]
    assert usage["estimated_cost"] == pytest.approx(0.000014)
    assert usage["priced_requests"] == 1
    csv = await client.get("/api/usage/export")
    assert csv.status_code == 200 and "model-a" in csv.text and "PRIVATE PROMPT" not in csv.text
    await register(client, "bob@example.com")
    assert (await client.get("/api/usage")).json()["summary"]["requests"] == 0
    assert (await client.get("/api/logs")).json()["total"] == 0


async def test_budget_counts_attempts_not_skipped_unhealthy_models(environment: Any) -> None:
    _, client, upstream = environment
    key, _ = await register(client)
    upstream.catalog = [
        {"id": name, "capabilities": {"chat": True}} for name in ("a-model", "b-model", "c-model")
    ]
    await connect(client)
    await connect(client, "Backup", "backup.example.com", 2)
    upstream.statuses["first.example.com"] = 401
    response = await client.post(
        "/v1/chat/completions",
        json={**CHAT, "model": "auto", "max_retries": 1},
        headers={"Authorization": f"Bearer {key}"},
    )
    assert response.status_code == 200
    assert len(upstream.calls) == 2 and upstream.calls[-1].url.host == "backup.example.com"


async def test_responses_continuation_requires_connection_pin(environment: Any) -> None:
    _, client, upstream = environment
    key, _ = await register(client)
    pid = await connect(client)
    headers = {"Authorization": f"Bearer {key}"}
    body = {"model": "model-a", "input": "Continue", "previous_response_id": "resp_previous"}
    response = await client.post("/v1/responses", json=body, headers=headers)
    assert response.status_code == 400 and not upstream.calls
    upstream.responses["first.example.com"] = {
        "id": "resp_next",
        "object": "response",
        "output": [],
    }
    response = await client.post(
        "/v1/responses", json={**body, "model": pid + "::model-a"}, headers=headers
    )
    assert response.status_code == 200 and response.json()["id"] == "resp_next"


async def test_fastest_and_cheapest_use_known_metadata(environment: Any) -> None:
    app, client, upstream = environment
    from app.models import RegistryModel

    key, _ = await register(client)
    first = await connect(
        client,
        models=[
            {
                "model_id": "model-a",
                "capabilities": {"chat": True},
                "input_price": 10,
                "output_price": 10,
            }
        ],
    )
    await connect(
        client,
        "Backup",
        "backup.example.com",
        2,
        models=[
            {
                "model_id": "model-a",
                "capabilities": {"chat": True},
                "input_price": 0,
                "output_price": 0,
            }
        ],
    )
    headers = {"Authorization": f"Bearer {key}"}
    response = await client.post(
        "/v1/chat/completions", json={**CHAT, "model": "auto/cheapest"}, headers=headers
    )
    assert response.status_code == 200 and upstream.calls[-1].url.host == "backup.example.com"
    async with app.state.db() as db:
        models = (await db.scalars(select(RegistryModel))).all()
    for model in models:
        await app.state.shared.succeeded(
            model.provider_id + ":" + model.id, 20 if model.provider_id == first else 800, 15000
        )
    response = await client.post(
        "/v1/chat/completions", json={**CHAT, "model": "auto/fastest"}, headers=headers
    )
    assert response.status_code == 200 and upstream.calls[-1].url.host == "first.example.com"
