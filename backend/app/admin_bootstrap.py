"""Server-only role provisioning, including a password-hash seed for a fresh database."""

from typing import Literal

from argon2 import Type, extract_parameters
from pydantic import EmailStr, TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AuditLog, User


async def provision_admin(
    db: AsyncSession,
    email: str,
    action: Literal["grant", "revoke", "bootstrap"],
    password_hash: str | None = None,
) -> User:
    email = str(TypeAdapter(EmailStr).validate_python(email.strip())).lower()
    user = await db.scalar(select(User).where(User.email == email))
    created = False
    if not user:
        if action != "bootstrap" or not password_hash:
            raise ValueError("Account not found. No account was created.")
        try:
            params = extract_parameters(password_hash)
            valid = (
                params.type == Type.ID
                and params.version == 19
                and params.time_cost >= 2
                and params.memory_cost >= 19456
                and params.salt_len >= 16
                and params.hash_len >= 16
            )
        except (ValueError, TypeError):
            valid = False
        if not valid:
            raise ValueError(
                "ADMIN_BOOTSTRAP_PASSWORD_HASH must be a valid Argon2id password hash."
            )
        user = User(email=email, name="Gateway administrator", password_hash=password_hash)
        db.add(user)
        await db.flush()
        created = True
    if user.disabled and action != "revoke":
        raise ValueError("Restore this account before granting administrator access.")
    # Existing accounts keep their password, identity and data, even when a seed is set.
    user.is_admin = action != "revoke"
    db.add(
        AuditLog(
            user_id=user.id,
            action="admin.account.bootstrapped" if created else f"admin.role.{action}",
            target_id=user.id,
        )
    )
    await db.commit()
    return user
