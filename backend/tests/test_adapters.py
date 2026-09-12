import httpx

from app.providers import ADAPTERS
from app.providers.base import normalize


async def test_openrouter_pricing_and_capabilities() -> None:
    async def handle(r: httpx.Request) -> httpx.Response:
        if "/embeddings/" in r.url.path:
            return httpx.Response(200, json={"data": []})
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "org/model",
                        "context_length": 128000,
                        "architecture": {
                            "input_modalities": ["text", "image"],
                            "output_modalities": ["text"],
                        },
                        "supported_parameters": ["tools", "response_format", "reasoning"],
                        "pricing": {"prompt": ".000001", "completion": ".000002"},
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await ADAPTERS["openrouter"](
            client, ADAPTERS["openrouter"].default_url, {"api_key": "key"}, 100000
        ).discover()
    assert result[0].input_price == 1 and result[0].output_price == 2
    assert result[0].capabilities["vision"] and result[0].capabilities["tools"]


async def test_google_native_pagination_and_media_filter() -> None:
    async def handle(r: httpx.Request) -> httpx.Response:
        assert r.headers["x-goog-api-key"] == "private-key" and "key=" not in str(r.url)
        if r.url.params.get("pageToken") == "next":
            return httpx.Response(
                200,
                json={
                    "models": [
                        {
                            "name": "models/gemini-embedding-001",
                            "supportedGenerationMethods": ["embedContent"],
                        }
                    ]
                },
            )
        return httpx.Response(
            200,
            json={
                "models": [
                    {
                        "name": "models/gemini-2.5-flash",
                        "supportedGenerationMethods": ["generateContent"],
                        "inputTokenLimit": 1000000,
                        "thinking": True,
                    },
                    {
                        "name": "models/gemini-tts",
                        "supportedGenerationMethods": ["generateContent"],
                    },
                ],
                "nextPageToken": "next",
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await ADAPTERS["google"](
            client, ADAPTERS["google"].default_url, {"api_key": "private-key"}, 100000
        ).discover()
    assert len(result) == 2 and result[0].capabilities["vision"]
    assert result[1].capabilities["embeddings"] and not result[1].capabilities["chat"]


async def test_together_bare_array_and_zero_prices() -> None:
    async def handle(r: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                {"id": "free-model", "type": "chat", "pricing": {"input": 0, "output": 0}},
                {"id": "unknown-price", "type": "chat"},
            ],
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await ADAPTERS["together"](client, "https://example.com/v1", {}, 100000).discover()
    assert result[0].input_price == 0 and result[1].input_price is None


async def test_huggingface_does_not_claim_union_capabilities() -> None:
    async def handle(r: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "org/model",
                        "providers": [
                            {"status": "live", "supports_tools": True, "context_length": 100000},
                            {"status": "live", "supports_tools": False, "context_length": 32000},
                        ],
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await ADAPTERS["huggingface"](
            client, "https://example.com/v1", {}, 100000
        ).discover()
    assert result[0].capabilities["tools"] is None and result[0].context_window == 32000
    assert result[0].input_price is None


async def test_fireworks_filters_unavailable_serverless_models() -> None:
    async def handle(r: httpx.Request) -> httpx.Response:
        assert "/accounts/fireworks/models" in r.url.path
        return httpx.Response(
            200,
            json={
                "models": [
                    {"name": "accounts/fireworks/models/a", "supportsServerless": True},
                    {"name": "accounts/fireworks/models/b", "supportsServerless": False},
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await ADAPTERS["fireworks"](
            client, ADAPTERS["fireworks"].default_url, {}, 100000
        ).discover()
    assert len(result) == 1 and result[0].model_id.endswith("/a")


async def test_groq_audio_families_and_unknown_tool_support() -> None:
    async def handle(r: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": [
                    {"id": "whisper-large-v3"},
                    {"id": "llama-test"},
                    {"id": "canopylabs/orpheus-v1-english"},
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await ADAPTERS["groq"](client, "https://example.com", {}, 100000).discover()
    assert result[0].capabilities["transcription"]
    assert result[1].capabilities["chat"] and result[1].capabilities["tools"] is None
    assert result[2].capabilities["speech"]


def test_unknown_custom_capabilities_are_not_invented() -> None:
    m = normalize({"id": "unknown-model"})
    assert all(v is None for v in m.capabilities.values())
    assert m.input_price is None
