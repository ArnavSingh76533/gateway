from pathlib import Path

from cryptography.fernet import Fernet
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    environment: str = "development"
    database_url: str = "sqlite+aiosqlite:///./gateway.db"
    redis_url: str | None = None
    encryption_keys: str = ""  # Comma-separated Fernet keys, newest first.
    allowed_origins: list[str] = ["http://localhost:7860"]
    allow_registration: bool = True
    registration_code: str = ""
    cookie_secure: bool = False
    session_hours: int = Field(default=24, ge=1, le=720)
    requests_per_minute: int = Field(default=60, ge=1)
    max_retries: int = Field(default=2, ge=0, le=5)
    upstream_timeout_seconds: float = Field(default=60, ge=1, le=300)
    max_request_bytes: int = Field(default=26_214_400, ge=1024)
    max_response_bytes: int = Field(default=52_428_800, ge=1024)
    discovery_interval_seconds: int = Field(default=3600, ge=60)
    health_interval_seconds: int = Field(default=60, ge=5)
    circuit_cooldown_seconds: int = Field(default=30, ge=1)
    high_latency_ms: int = Field(default=15_000, ge=1)
    private_upstream_hosts: list[str] = []
    static_dir: str = "../frontend/out"
    log_retention_days: int = Field(default=30, ge=1)

    @model_validator(mode="after")
    def validate_secrets(self) -> "Settings":
        if not self.encryption_keys:
            raise ValueError("ENCRYPTION_KEYS is required. Run python scripts/setup.py first.")
        for key in self.encryption_keys.split(","):
            Fernet(key.strip().encode())
        if self.environment == "production":
            if not self.redis_url or self.database_url.startswith("sqlite"):
                raise ValueError("Production requires PostgreSQL and Redis.")
            if not self.cookie_secure or any(
                not o.startswith("https://") for o in self.allowed_origins
            ):
                raise ValueError(
                    "Production requires COOKIE_SECURE=true and HTTPS ALLOWED_ORIGINS."
                )
        return self

    @property
    def static_path(self) -> Path:
        return Path(self.static_dir).resolve()
