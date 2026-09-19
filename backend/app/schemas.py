from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .providers.catalog import DIRECT

ProviderKind = str


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class Register(Credentials):
    name: str = Field(min_length=1, max_length=80)
    registration_code: str = ""


class NewGatewayKey(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)


class Capabilities(BaseModel):
    chat: bool | None = None
    tools: bool | None = None
    vision: bool | None = None
    audio: bool | None = None
    json_mode: bool | None = None
    streaming: bool | None = None
    reasoning: bool | None = None
    coding: bool | None = None
    embeddings: bool | None = None
    images: bool | None = None
    transcription: bool | None = None
    speech: bool | None = None
    responses: bool | None = None


class ModelInput(BaseModel):
    model_id: str = Field(min_length=1, max_length=512, pattern=r"^[^\s]+$")
    name: str | None = Field(default=None, max_length=512)
    capabilities: Capabilities = Field(default_factory=Capabilities)
    context_window: int | None = Field(default=None, ge=1)
    input_price: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    output_price: float | None = Field(default=None, ge=0, allow_inf_nan=False)


class ModelPreferences(BaseModel):
    preferred_models: list[str] = Field(default_factory=list, max_length=200)
    preferred_only: bool = False

    @field_validator("preferred_models")
    @classmethod
    def valid_preferences(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)) or any(
            not mid or len(mid) > 512 or any(c.isspace() for c in mid) for mid in value
        ):
            raise ValueError("Use unique model IDs, without spaces, up to 512 characters each.")
        return value


class ProviderInput(ModelPreferences):
    kind: ProviderKind = Field(json_schema_extra={"enum": sorted(DIRECT)})
    name: str = Field(min_length=1, max_length=80)
    api_key: str = Field(default="", max_length=8192)
    base_url: str | None = Field(default=None, max_length=2048)
    enabled: bool = True
    priority: int = Field(default=10, ge=0, le=1000)
    headers: dict[str, str] = Field(default_factory=dict)
    models: list[ModelInput] = Field(default_factory=list, max_length=200)

    @field_validator("kind")
    @classmethod
    def known_provider(cls, value: str) -> str:
        if value not in DIRECT:
            raise ValueError("Choose a supported provider or a custom API endpoint.")
        return value


class ProviderPatch(BaseModel):
    preferred_models: list[str] | None = Field(default=None, max_length=200)
    preferred_only: bool | None = None

    @field_validator("preferred_models")
    @classmethod
    def valid_preferences(cls, value: list[str] | None) -> list[str] | None:
        return ModelPreferences.valid_preferences(value) if value is not None else None

    name: str | None = Field(default=None, min_length=1, max_length=80)
    api_key: str | None = Field(default=None, max_length=8192)
    enabled: bool | None = None
    pinned: bool | None = None
    priority: int | None = Field(default=None, ge=0, le=1000)
    headers: dict[str, str] | None = None


class GatewayRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    model: str = Field(default="auto", min_length=1, max_length=1024)
    provider: str | None = Field(default=None, max_length=80)
    routing: Literal[
        "auto",
        "fastest",
        "cheapest",
        "reasoning",
        "coding",
        "vision",
        "image",
        "embedding",
        "manual",
    ] = "auto"
    max_retries: int | None = Field(default=None, ge=0, le=5)
    allow_alternatives: bool = False
    stream: bool = False


class ChatRequest(GatewayRequest):
    response_format: dict[str, Any] | None = None
    tools: list[dict[str, Any]] | None = None
    functions: list[dict[str, Any]] | None = None
    max_tokens: int | None = Field(default=None, ge=1)
    max_completion_tokens: int | None = Field(default=None, ge=1)
    n: int | None = Field(default=None, ge=1, le=16)
    messages: list[dict[str, Any]] = Field(min_length=1, max_length=1000)


class EmbeddingRequest(GatewayRequest):
    input: str | list[str] | list[int] | list[list[int]]


class ImageRequest(GatewayRequest):
    prompt: str = Field(min_length=1)


class SpeechRequest(GatewayRequest):
    input: str = Field(min_length=1)
    voice: str = Field(min_length=1)


class ResponseRequest(GatewayRequest):
    input: str | list[dict[str, Any]]
