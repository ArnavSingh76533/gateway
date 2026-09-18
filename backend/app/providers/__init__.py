from .base import OpenAIAdapter
from .catalog import DIRECT
from .compatible import AzureAdapter, CompatibleAdapter, NineRouterAdapter
from .custom import CustomAdapter
from .fireworks import FireworksAdapter
from .google import GoogleAdapter
from .groq import GroqAdapter
from .huggingface import HuggingFaceAdapter
from .native_anthropic import NativeAnthropicAdapter
from .openrouter import OpenRouterAdapter
from .together import TogetherAdapter

ADAPTERS: dict[str, type[OpenAIAdapter]] = {
    a.kind: a
    for a in (
        OpenRouterAdapter,
        GroqAdapter,
        GoogleAdapter,
        HuggingFaceAdapter,
        TogetherAdapter,
        FireworksAdapter,
        CustomAdapter,
    )
}
for kind, entry in DIRECT.items():
    if kind in ADAPTERS:
        continue
    base = NativeAnthropicAdapter if entry["protocol"] == "anthropic" else CompatibleAdapter
    if kind == "azure":
        base = AzureAdapter
    if kind == "9router":
        base = NineRouterAdapter
    endpoints = base.endpoints
    if kind in {"jina-ai", "voyage-ai"}:
        endpoints = {"embeddings"}
    elif kind == "recraft":
        endpoints = {"images/generations"}
    ADAPTERS[kind] = type(
        kind.replace("-", "_") + "Adapter",
        (base,),
        {
            "kind": kind,
            "default_url": entry["url"],
            "endpoints": endpoints,
        },
    )
