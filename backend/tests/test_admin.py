import json
from contextlib import aclosing

import httpx
import pytest
from conftest import connect, register
from sqlalchemy import select

from app.models import RegistryModel, RequestLog, User


async def promote(app, uid):
    async with app.state.db() as db:
        user = await db.get(User, uid)
        user.is_admin = True
        await db.commit()


async def community_setup(environment, quota=5):
    app, client, upstream = environment
    _, admin_id = await register(client)
    await promote(app, admin_id)
    pid = await connect(
        client,
        models=[
            {
                "model_id": "private-only",
                "capabilities": {"chat": True},
            }
        ],
    )
    catalog = (await client.get("/api/models")).json()["data"]
    model = next(m for m in catalog if m["model_id"] == "model-a")
    async with app.state.db() as db:
        row = await db.get(RegistryModel, model["id"])
        row.input_price = 1
        row.output_price = 2
        await db.commit()
    response = await client.put(
        f"/api/admin/shared-models/{model['id']}",
        json={
            "requests_per_minute": quota,
            "max_output_tokens": 256,
        },
    )
    assert response.status_code == 200, response.text
    member = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Origin": "http://test"},
    )
    key, member_id = await register(member, "member@example.com")
    return client, member, key, member_id, model, pid


async def test_admin_requires_role_session_and_csrf(environment):
    app, client, _ = environment
    assert (await client.get("/api/admin/settings")).status_code == 401
    response = await client.post(
        "/api/auth/register",
        json={
            "email": "member@example.com",
            "name": "Member",
            "password": "correct-horse-battery-123",
            "is_admin": True,
        },
    )
    uid = response.json()["user"]["id"]
    assert response.json()["user"]["is_admin"] is False
    client.headers["X-CSRF-Token"] = client.cookies.get("gw_csrf", "")
    for path in ("settings", "summary", "users", "shared-models"):
        assert (await client.get(f"/api/admin/{path}")).status_code == 403
    assert (await client.put("/api/admin/settings", json={})).status_code == 403
    assert (
        await client.patch(f"/api/admin/users/{uid}", json={"disabled": True})
    ).status_code == 403
    assert (await client.put("/api/admin/shared-models/fake", json={})).status_code == 403
    await promote(app, uid)
    config = (await client.get("/api/admin/settings")).json()["settings"]
    assert (
        await client.put("/api/admin/settings", json=config, headers={"X-CSRF-Token": "wrong"})
    ).status_code == 403
    assert (
        await client.put(
            "/api/admin/settings", json=config, headers={"Origin": "https://attacker.example"}
        )
    ).status_code == 403
    assert (
        await client.patch(f"/api/admin/users/{uid}", json={"disabled": True})
    ).status_code == 403


async def test_settings_are_persistent_and_public_subset_only(environment):
    app, client, _ = environment
    _, uid = await register(client)
    await promote(app, uid)
    settings = (await client.get("/api/admin/settings")).json()["settings"]
    settings.update(
        site_name="My Gateway", accent="blue", registration_open=False, default_mode="cheapest"
    )
    assert (await client.put("/api/admin/settings", json=settings)).status_code == 200
    public = (await client.get("/api/site")).json()
    assert public["site_name"] == "My Gateway"
    assert public["accent"] == "blue"
    assert set(public) == {
        "site_name",
        "tagline",
        "welcome_text",
        "accent",
        "default_mode",
        "default_stream",
        "default_retries",
        "shared_models_enabled",
    }
    assert (
        await client.post(
            "/api/auth/register",
            json={
                "email": "new@example.com",
                "name": "New",
                "password": "correct-horse-battery-123",
            },
        )
    ).status_code == 403
    assert (
        await client.put("/api/admin/settings", json=settings | {"requests_per_minute": 1001})
    ).status_code == 422
    assert (
        await client.put("/api/admin/settings", json=settings | {"extra": "unsafe"})
    ).status_code == 422


async def test_published_model_is_free_isolated_and_token_limited(environment):
    app, _, upstream = environment
    admin, member, key, _, model, pid = await community_setup(environment)
    async with aclosing(member):
        assert (await member.get("/api/providers")).json() == []
        catalog = (await member.get("/api/models?free_only=true")).json()
        assert catalog["total"] == 1
        public = catalog["data"][0]
        assert public["owned"] is False and public["shared"] is True
        assert public["input_price"] == public["output_price"] == 0
        assert public["provider_name"] == "Community"
        assert "upstream-provider-key" not in json.dumps(public)
        assert (await member.get("/api/models?owned_only=true")).json()["total"] == 0
        assert (
            await member.put(f"/api/providers/{pid}/models", json={"model_id": "model-a"})
        ).status_code == 404
        assert (
            await member.put(f"/api/admin/shared-models/{model['id']}", json={})
        ).status_code == 403
        headers = {"Authorization": f"Bearer {key}"}
        listed = (await member.get("/v1/models", headers=headers)).json()["data"]
        assert [m["native_id"] for m in listed] == ["model-a"]
        payload = {
            "model": public["route_id"],
            "messages": [{"role": "user", "content": "Hello"}],
            "n": 16,
            "max_completion_tokens": 100000,
            "max_tokens": 9999,
        }
        response = await member.post("/v1/chat/completions", headers=headers, json=payload)
        assert response.status_code == 200, response.text
        sent = json.loads(upstream.calls[-1].content)
        assert sent["max_completion_tokens"] == 256 and sent["n"] == 1
        assert "max_tokens" not in sent
        assert upstream.calls[-1].headers["authorization"] == "Bearer upstream-provider-key"
        log = (await member.get("/api/logs")).json()["data"][0]
        assert log["estimated_cost"] == 0 and log["provider_name"] == "Community"
        async with app.state.db() as db:
            record = await db.scalar(select(RequestLog).where(RequestLog.id == log["id"]))
            assert record.sponsored_cost == pytest.approx(0.000014)
        for endpoint, body in [
            ("embeddings", {"input": "hello"}),
            ("responses", {"input": "hello"}),
        ]:
            assert (
                await member.post(
                    f"/v1/{endpoint}", headers=headers, json={"model": public["route_id"], **body}
                )
            ).status_code == 404
        assert (
            await member.post("/api/playground", json=payload | {"model": f"{pid}::private-only"})
        ).status_code == 404
        await admin.put(f"/api/admin/shared-models/{model['id']}", json={"enabled": False})
        assert (await member.get("/api/models")).json()["total"] == 0
        assert (await member.post("/api/playground", json=payload)).status_code == 404


async def test_community_limits_and_site_switch(environment):
    _, _, upstream = environment
    admin, member, _, _, model, _ = await community_setup(environment, quota=1)
    async with aclosing(member):
        payload = {"model": model["route_id"], "messages": [{"role": "user", "content": "Hi"}]}
        assert (
            await member.post(
                "/api/playground",
                json=payload | {"messages": [{"role": "user", "content": "x" * 64001}]},
            )
        ).status_code == 413
        assert not upstream.calls
        assert (await member.post("/api/playground", json=payload)).status_code == 200
        assert (await member.post("/api/playground", json=payload)).status_code == 429
        assert len(upstream.calls) == 1
        settings = (await admin.get("/api/admin/settings")).json()["settings"]
        await admin.put("/api/admin/settings", json=settings | {"shared_models_enabled": False})
        assert (await member.get("/api/models")).json()["total"] == 0
        assert (await member.post("/api/playground", json=payload)).status_code == 404


async def test_suspension_ends_sessions_and_blocks_keys(environment):
    admin, member, key, uid, _, _ = await community_setup(environment)
    async with aclosing(member):
        response = await admin.patch(f"/api/admin/users/{uid}", json={"disabled": True})
        assert response.status_code == 200
        assert (await member.get("/api/auth/me")).status_code == 401
        assert (
            await member.get("/v1/models", headers={"Authorization": f"Bearer {key}"})
        ).status_code == 403
        assert (
            await member.post(
                "/api/auth/login",
                json={"email": "member@example.com", "password": "correct-horse-battery-123"},
            )
        ).status_code == 403
        assert (
            await admin.patch(f"/api/admin/users/{uid}", json={"disabled": False, "is_admin": True})
        ).status_code == 422
        await admin.patch(f"/api/admin/users/{uid}", json={"disabled": False})
        assert (
            await member.get("/v1/models", headers={"Authorization": f"Bearer {key}"})
        ).status_code == 200


async def test_full_catalog_search_includes_last_page_and_free_models(environment):
    app, client, _ = environment
    await register(client)
    pid = await connect(client)
    async with app.state.db() as db:
        db.add_all(
            [
                RegistryModel(
                    provider_id=pid,
                    model_id=f"catalog-{i:04d}",
                    name=f"Model {i}",
                    capabilities={"chat": True},
                    available=True,
                    input_price=0 if i == 1204 else 1,
                    output_price=0 if i == 1204 else 2,
                )
                for i in range(1205)
            ]
        )
        await db.commit()
    first = (await client.get("/api/models?limit=1000")).json()
    last = (await client.get("/api/models?limit=1000&offset=1000")).json()
    assert first["total"] == 1206 and len(first["data"]) == 1000
    assert len(last["data"]) == 206
    assert len({m["id"] for m in first["data"] + last["data"]}) == 1206
    result = (await client.get("/api/models?search=Model%201204&free_only=true")).json()
    assert result["total"] == 1 and result["data"][0]["model_id"] == "catalog-1204"


async def test_upstream_credit_error_is_actionable_without_leaking_details(environment):
    _, client, upstream = environment
    await register(client)
    await connect(client)
    upstream.statuses["first.example.com"] = 402
    response = await client.post(
        "/api/playground",
        json={"model": "model-a", "messages": [{"role": "user", "content": "hello"}]},
    )
    assert response.status_code == 502
    assert "HTTP 402" in response.json()["error"]["message"]
    assert "billing" in response.json()["error"]["message"]
    assert "LEAK" not in response.text and "upstream-provider-key" not in response.text
