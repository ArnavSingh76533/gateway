"""Grant/revoke a role for an existing account using access to the gateway server."""

import argparse
import asyncio
import os
from pathlib import Path

from sqlalchemy import select

from app.config import Settings
from app.db import create_database
from app.models import AuditLog, User


async def run() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["grant", "revoke", "list"])
    parser.add_argument(
        "--email", help="Exact email of an existing account; no account is created"
    )
    args = parser.parse_args()
    if args.action != "list" and not args.email:
        parser.error("--email is required for grant/revoke")
    # docker exec does not inherit variables set inside deploy/start.py.
    root = Path(os.environ.get("DATA_DIR", "/data"))
    if (
        not os.environ.get("DATABASE_URL")
        and (root / "postgres" / "PG_VERSION").exists()
    ):
        os.environ["DATABASE_URL"] = (
            f"postgresql+asyncpg://gateway@/gateway?host={root / 'run'}"
        )
    if not os.environ.get("REDIS_URL") and (root / "redis.sock").exists():
        os.environ["REDIS_URL"] = f"unix://{root / 'redis.sock'}?db=0"
    db_factory = create_database(Settings().database_url)
    try:
        async with db_factory() as db:
            if args.action == "list":
                for user in await db.scalars(
                    select(User).where(User.is_admin.is_(True))
                ):
                    print(f"{user.email} — administrator")
                return
            user = await db.scalar(
                select(User).where(User.email == args.email.strip().lower())
            )
            if not user:
                raise SystemExit(
                    "Account not found. Sign up on this gateway first; no account was created."
                )
            if user.disabled and args.action == "grant":
                raise SystemExit(
                    "Restore this account before granting administrator access."
                )
            user.is_admin = args.action == "grant"
            db.add(
                AuditLog(
                    user_id=user.id,
                    action=f"admin.role.{args.action}",
                    target_id=user.id,
                )
            )
            await db.commit()
            print(
                f"Administrator role {'granted to' if user.is_admin else 'revoked from'} {user.email}."
            )
            print(
                "Sign in with the existing account password at /#admin. No password was changed."
            )
    finally:
        await db_factory.kw["bind"].dispose()


if __name__ == "__main__":
    asyncio.run(run())
