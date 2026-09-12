#!/usr/bin/env python3
"""Create local secrets without dependencies. Never overwrite an existing environment file."""

import base64
import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / ".env"
if path.exists():
    raise SystemExit(".env already exists; kept unchanged.")
key = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
password = secrets.token_urlsafe(32)
path.write_text(f"""# Keep this file private. Back up ENCRYPTION_KEYS with your database.
ENVIRONMENT=development
ENCRYPTION_KEYS={key}
ALLOWED_ORIGINS=["http://localhost:7860"]
COOKIE_SECURE=false
ALLOW_REGISTRATION=true
REGISTRATION_CODE=
POSTGRES_PASSWORD={password}
REDIS_PASSWORD={secrets.token_urlsafe(32)}
MAX_RETRIES=2
REQUESTS_PER_MINUTE=60
STATIC_DIR=frontend/out
""")
path.chmod(0o600)
print(
    "Created .env with fresh secrets. Run docker compose up --build, then open http://localhost:7860."
)
