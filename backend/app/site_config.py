from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import Settings
from .models import Provider, PublishedModel, RegistryModel, SiteConfiguration, User


class SiteOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    site_name: str = Field(default="Nexus", min_length=1, max_length=40)
    tagline: str = Field(default="Universal AI Gateway", min_length=1, max_length=160)
    welcome_text: str = Field(
        default="Your models. Your keys. One connection.", min_length=1, max_length=180
    )
    accent: Literal["purple", "blue", "green"] = "purple"
    registration_open: bool = True
    requests_per_minute: int = Field(default=60, ge=1, le=10000)
    shared_models_enabled: bool = True
    shared_requests_per_minute: int = Field(default=30, ge=1, le=10000)
    default_mode: Literal["auto", "fastest", "cheapest", "reasoning", "coding", "vision"] = "auto"
    default_stream: bool = True
    default_retries: int = Field(default=2, ge=0, le=5)


async def site_options(db: AsyncSession, config: Settings) -> SiteOptions:
    row = await db.get(SiteConfiguration, "global")
    defaults: dict[str, Any] = {
        "registration_open": config.allow_registration,
        "requests_per_minute": min(config.requests_per_minute, 10000),
        "default_retries": config.max_retries,
    }
    options = SiteOptions.model_validate(defaults | (row.settings if row else {}))
    options.registration_open = options.registration_open and config.allow_registration
    options.requests_per_minute = min(options.requests_per_minute, config.requests_per_minute)
    options.default_retries = min(options.default_retries, config.max_retries)
    return options


def published_ids() -> Any:
    """Only explicitly published models belonging to active administrators are shared."""
    return (
        select(PublishedModel.model_id)
        .join(RegistryModel, RegistryModel.id == PublishedModel.model_id)
        .join(Provider, Provider.id == RegistryModel.provider_id)
        .join(User, User.id == Provider.user_id)
        .where(
            PublishedModel.enabled.is_(True),
            Provider.enabled.is_(True),
            RegistryModel.available.is_(True),
            User.is_admin.is_(True),
            User.disabled.is_(False),
        )
    )
