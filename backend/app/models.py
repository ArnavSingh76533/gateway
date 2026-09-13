import time
import uuid
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def identifier() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    disabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())


class SiteConfiguration(Base):
    __tablename__ = "site_configuration"
    id: Mapped[str] = mapped_column(String(16), primary_key=True, default="global")
    settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class PublishedModel(Base):
    __tablename__ = "published_models"
    model_id: Mapped[str] = mapped_column(
        ForeignKey("registry_models.id", ondelete="CASCADE"), primary_key=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    requests_per_minute: Mapped[int] = mapped_column(Integer, default=5)
    max_output_tokens: Mapped[int] = mapped_column(Integer, default=1024)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Session(Base):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    csrf_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[float] = mapped_column(Float, index=True)


class GatewayKey(Base):
    __tablename__ = "gateway_keys"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    prefix: Mapped[str] = mapped_column(String(16))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    last_used_at: Mapped[float | None] = mapped_column(Float)
    expires_at: Mapped[float | None] = mapped_column(Float)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class Provider(Base):
    __tablename__ = "providers"
    __table_args__ = (UniqueConstraint("user_id", "name"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(80))
    base_url: Mapped[str] = mapped_column(String(2048))
    encrypted_credentials: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(Integer, default=10)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    discovered_at: Mapped[float | None] = mapped_column(Float)
    discovery_error: Mapped[str | None] = mapped_column(String(160))


class RegistryModel(Base):
    __tablename__ = "registry_models"
    __table_args__ = (UniqueConstraint("provider_id", "model_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    provider_id: Mapped[str] = mapped_column(
        ForeignKey("providers.id", ondelete="CASCADE"), index=True
    )
    model_id: Mapped[str] = mapped_column(String(512))
    name: Mapped[str] = mapped_column(String(512))
    capabilities: Mapped[dict[str, bool | None]] = mapped_column(JSON, default=dict)
    context_window: Mapped[int | None] = mapped_column(Integer)
    input_price: Mapped[float | None] = mapped_column(Float)
    output_price: Mapped[float | None] = mapped_column(Float)
    available: Mapped[bool] = mapped_column(Boolean, default=True)
    manual: Mapped[bool] = mapped_column(Boolean, default=False)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(80), default="provider")
    updated_at: Mapped[float] = mapped_column(Float, default=time.time)


class RequestLog(Base):
    __tablename__ = "request_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    key_id: Mapped[str | None] = mapped_column(String(36))
    provider_id: Mapped[str | None] = mapped_column(String(36))
    provider_name: Mapped[str | None] = mapped_column(String(80))
    requested_model: Mapped[str] = mapped_column(String(1024))
    resolved_model: Mapped[str | None] = mapped_column(String(512))
    endpoint: Mapped[str] = mapped_column(String(80))
    status: Mapped[int] = mapped_column(Integer)
    latency_ms: Mapped[float] = mapped_column(Float)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    estimated_cost: Mapped[float | None] = mapped_column(Float)
    sponsored_cost: Mapped[float | None] = mapped_column(Float)
    attempts: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    error_code: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[float] = mapped_column(Float, default=time.time, index=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(80))
    target_id: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[float] = mapped_column(Float, default=time.time, index=True)
