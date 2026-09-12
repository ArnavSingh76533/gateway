"""Drop-in OpenAI clients. Gateway controls retries by default."""

import os
from typing import Any

from openai import AsyncOpenAI, OpenAI


def options(
    base_url: str | None, api_key: str | None, kwargs: dict[str, Any]
) -> dict[str, Any]:
    url = base_url or os.environ.get("GATEWAY_BASE_URL")
    key = api_key or os.environ.get("GATEWAY_API_KEY")
    if not url or not key:
        raise ValueError(
            "Set GATEWAY_BASE_URL and GATEWAY_API_KEY or pass both explicitly."
        )
    return {"base_url": url.rstrip("/"), "api_key": key, "max_retries": 0, **kwargs}


class Gateway(OpenAI):
    def __init__(
        self, *, base_url: str | None = None, api_key: str | None = None, **kwargs: Any
    ):
        super().__init__(**options(base_url, api_key, kwargs))


class AsyncGateway(AsyncOpenAI):
    def __init__(
        self, *, base_url: str | None = None, api_key: str | None = None, **kwargs: Any
    ):
        super().__init__(**options(base_url, api_key, kwargs))


__all__ = ["Gateway", "AsyncGateway"]
