#!/usr/bin/env python3
"""Generate separate private-bridge credentials without overwriting existing files."""

import secrets
from pathlib import Path

path = Path(__file__).resolve().parents[1] / ".env.9router"
content = (
    "# Private 9router credentials. Never commit or share this file.\n"
    + "\n".join(
        f"{name}={secrets.token_urlsafe(36)}"
        for name in (
            "JWT_SECRET",
            "INITIAL_PASSWORD",
            "API_KEY_SECRET",
            "MACHINE_ID_SALT",
        )
    )
    + "\nAUTH_COOKIE_SECURE=false\n"
)
try:
    with path.open("x", encoding="utf-8") as output:
        output.write(content)
    path.chmod(0o600)
except FileExistsError:
    raise SystemExit(".env.9router already exists; kept unchanged.") from None
print(
    "Created .env.9router. Its INITIAL_PASSWORD is your private 9router dashboard login."
)
print(
    "Run docker compose -f docker-compose.yml -f docker-compose.9router.yml up --build -d"
)
