"""Manage administrator roles using access to the gateway server."""

import argparse
import asyncio
import os
from pathlib import Path

from app.admin_bootstrap import provision_admin
from app.config import Settings
from app.db import create_database
from app.models import User
from sqlalchemy import select


async def run() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["grant", "revoke", "list", "bootstrap"])
    parser.add_argument(
        "--email",
        help="Exact account email; only bootstrap with a server seed can create it",
    )
    args = parser.parse_args()
    if args.action != "list" and not args.email:
        parser.error("--email is required for grant/revoke/bootstrap")
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
            try:
                user = await provision_admin(
                    db,
                    args.email,
                    args.action,
                    os.environ.get("ADMIN_BOOTSTRAP_PASSWORD_HASH"),
                )
            except ValueError:
                raise SystemExit(
                    "Admin provisioning failed: check the existing account, suspension status, and bootstrap hash configuration. No password was changed."
                ) from None
            print(
                f"Administrator role {'granted to' if user.is_admin else 'revoked from'} {user.email}."
            )
            print(
                "Sign in at /#admin with the account password. Existing passwords are never changed."
            )
    finally:
        await db_factory.kw["bind"].dispose()


if __name__ == "__main__":
    asyncio.run(run())
