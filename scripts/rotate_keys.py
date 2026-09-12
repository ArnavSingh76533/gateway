"""Re-encrypt provider credentials with the first ENCRYPTION_KEYS key.

Keep old keys in ENCRYPTION_KEYS until all rows are rotated and every old replica is replaced.
"""

import asyncio
from sqlalchemy import select
from app.config import Settings
from app.db import create_database
from app.models import Provider
from app.security import Vault


async def main() -> None:
    config = Settings()
    factory = create_database(config.database_url)
    vault = Vault(config.encryption_keys)
    total = 0
    async with factory() as db:
        rows = await db.stream_scalars(
            select(Provider).execution_options(yield_per=200)
        )
        async for row in rows:
            row.encrypted_credentials = vault.cipher.rotate(
                row.encrypted_credentials.encode()
            ).decode()
            total += 1
        await db.commit()
    await factory.kw["bind"].dispose()
    print(f"Rotated {total} encrypted provider credentials. No plaintext was written.")


if __name__ == "__main__":
    asyncio.run(main())
