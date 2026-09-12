import asyncio
import os

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import pool, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.db import Base
from app import models  # noqa: F401

load_dotenv()
url = os.environ.get("DATABASE_URL") or "sqlite+aiosqlite:///./gateway.db"
target_metadata = Base.metadata


def apply(connection):
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def online():
    engine = create_async_engine(url, poolclass=pool.NullPool)
    async with engine.connect() as conn:
        if engine.dialect.name == "postgresql":
            await conn.execute(text("SELECT pg_advisory_lock(81276340)"))
            await conn.commit()
        try:
            await conn.run_sync(apply)
        finally:
            if engine.dialect.name == "postgresql":
                await conn.execute(text("SELECT pg_advisory_unlock(81276340)"))
                await conn.commit()
    await engine.dispose()


if context.is_offline_mode():
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(online())
