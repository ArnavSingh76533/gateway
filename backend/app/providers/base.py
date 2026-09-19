import json
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, ClassVar

import httpx

from ..errors import UpstreamError

CAPABILITIES = (
    "chat",
    "tools",
    "vision",
    "audio",
    "json_mode",
    "streaming",
    "reasoning",
    "coding",
    "embeddings",
    "images",
    "transcription",
    "speech",
    "responses",
)


@dataclass
class DiscoveredModel:
    model_id: str
    name: str
    capabilities: dict[str, bool | None] = field(
        default_factory=lambda: dict.fromkeys(CAPABILITIES)
    )
    context_window: int | None = None
    input_price: float | None = None  # USD per million tokens; None means unknown, not free.
    output_price: float | None = None
    available: bool = True
    source: str = "provider"


def numeric(value: Any) -> float | None:
    try:
        result = float(value)
        return result if 0 <= result < float("inf") else None
    except (ValueError, TypeError):
        return None


def normalize(item: dict[str, Any]) -> DiscoveredModel:
    mid = str(item.get("id") or item.get("name") or "")
    caps: dict[str, bool | None] = dict.fromkeys(CAPABILITIES)
    caps.update(
        {k: v for k, v in item.get("capabilities", {}).items() if k in caps and isinstance(v, bool)}
    )
    params = item.get("supported_parameters")
    if params is not None:
        caps.update(
            tools="tools" in params,
            json_mode=bool({"response_format", "structured_outputs"} & set(params)),
            reasoning=bool({"reasoning", "reasoning_effort"} & set(params)),
        )
    arch = item.get("architecture", {})
    inputs, outputs = arch.get("input_modalities"), arch.get("output_modalities")
    if inputs is not None:
        caps.update(vision="image" in inputs, audio="audio" in inputs)
    if outputs is not None:
        caps.update(images="image" in outputs)
    kind = item.get("type")
    if kind in ("chat", "language"):
        caps.update(chat=True, streaming=True)
    elif kind in ("embedding", "embeddings"):
        caps.update(chat=False, embeddings=True, streaming=False)
    elif kind == "image":
        caps.update(chat=False, images=True)
    ctx = numeric(item.get("context_length") or item.get("context_window"))
    return DiscoveredModel(
        mid,
        str(item.get("display_name") or item.get("name") or mid),
        caps,
        int(ctx) if ctx else None,
        available=item.get("active", True),
    )


class OpenAIAdapter:
    kind: ClassVar[str] = "custom"
    default_url: ClassVar[str] = ""
    endpoints: ClassVar[set[str]] = {
        "chat/completions",
        "embeddings",
        "audio/transcriptions",
        "audio/speech",
        "images/generations",
        "responses",
    }

    def __init__(
        self, client: httpx.AsyncClient, base_url: str, credentials: dict[str, Any], max_bytes: int
    ):
        self.client = client
        self.base_url = base_url.rstrip("/")
        self.credentials = credentials
        self.max_bytes = max_bytes
        self.on_headers: Callable[[httpx.Headers], Awaitable[None]] | None = None
        self.quota_model: str | None = None
        self.credentials_loader: Callable[[], Awaitable[dict[str, Any]]] | None = None

    async def prepare(self) -> None:
        if self.credentials_loader:
            self.credentials = await self.credentials_loader()

    def headers(self) -> dict[str, str]:
        headers = {"accept": "application/json"}
        if self.credentials.get("api_key"):
            headers["authorization"] = "Bearer " + self.credentials["api_key"]
        headers.update({k.lower(): v for k, v in self.credentials.get("headers", {}).items()})
        return headers

    async def send(
        self, endpoint: str, payload: dict[str, Any], files: dict[str, Any] | None = None
    ) -> httpx.Response:
        if endpoint not in self.endpoints:
            raise UpstreamError(400, "unsupported_endpoint")
        await self.prepare()
        self.quota_model = payload.get("model")
        args: dict[str, Any] = {"data": payload, "files": files} if files else {"json": payload}
        req = self.client.build_request(
            "POST", self.base_url + "/" + endpoint, headers=self.headers(), **args
        )
        response = await self.client.send(req, stream=True)
        await self.check(response)
        return response

    async def check(self, response: httpx.Response) -> None:
        if self.on_headers:
            await self.on_headers(response.headers)
        if response.status_code >= 300:
            retry_after = response.headers.get("retry-after", "0")
            await response.aclose()
            raise UpstreamError(
                response.status_code,
                "upstream_http_error",
                int(retry_after) if retry_after.isdigit() else 0,
            )

    async def read_bytes(self, response: httpx.Response) -> bytes:
        chunks: list[bytes] = []
        total = 0
        try:
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > self.max_bytes:
                    raise UpstreamError(502, "upstream_response_too_large")
                chunks.append(chunk)
        finally:
            await response.aclose()
        return b"".join(chunks)

    async def get_json(
        self,
        url: str,
        params: dict[str, str | int] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        await self.prepare()
        req = self.client.build_request(
            "GET", url, params=params, headers=headers or self.headers()
        )
        response = await self.client.send(req, stream=True)
        await self.check(response)
        try:
            return json.loads(await self.read_bytes(response))
        except (ValueError, UnicodeError):
            raise UpstreamError(502, "invalid_model_catalog") from None

    async def discover(self) -> list[DiscoveredModel]:
        raw = await self.get_json(self.base_url + "/models")
        items = raw if isinstance(raw, list) else raw.get("data", [])
        if not isinstance(items, list):
            raise UpstreamError(502, "invalid_model_catalog")
        return [normalize(item) for item in items if isinstance(item, dict) and item.get("id")]
