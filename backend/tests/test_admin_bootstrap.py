import pytest
from sqlalchemy import select

from app.admin_bootstrap import provision_admin
from app.models import User
from app.security import hash_password


async def test_bootstrap_requires_explicit_valid_seed(environment):
    app, _, _ = environment
    async with app.state.db() as db:
        for action, seed in [("grant", None), ("bootstrap", None), ("bootstrap", "not-a-hash")]:
            with pytest.raises(ValueError):
                await provision_admin(db, "owner@example.com", action, seed)
        assert await db.scalar(select(User)) is None


async def test_fresh_owner_can_sign_in_and_restarts_preserve_password(environment):
    app, client, _ = environment
    seed = await hash_password("bootstrap-owner-password-123")
    async with app.state.db() as db:
        owner = await provision_admin(db, "owner@example.com", "bootstrap", seed)
        uid = owner.id
        assert owner.is_admin
    login = await client.post(
        "/api/auth/login",
        json={"email": "owner@example.com", "password": "bootstrap-owner-password-123"},
    )
    assert login.status_code == 200 and login.json()["user"]["is_admin"]
    assert (await client.get("/api/admin/settings")).status_code == 200
    async with app.state.db() as db:
        owner = await provision_admin(
            db, "owner@example.com", "bootstrap", await hash_password("a-different-password-123")
        )
        assert owner.id == uid and owner.password_hash == seed
        await provision_admin(db, "owner@example.com", "revoke")
    assert (await client.get("/api/admin/settings")).status_code == 403


async def test_bootstrap_does_not_unsuspend_accounts(environment):
    app, _, _ = environment
    async with app.state.db() as db:
        owner = await provision_admin(
            db,
            "owner@example.com",
            "bootstrap",
            await hash_password("bootstrap-owner-password-123"),
        )
        owner.disabled = True
        await db.commit()
        with pytest.raises(ValueError, match="Restore"):
            await provision_admin(db, "owner@example.com", "bootstrap")
        assert owner.disabled
