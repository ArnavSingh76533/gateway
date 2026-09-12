from .base import OpenAIAdapter
from .custom import CustomAdapter
from .fireworks import FireworksAdapter
from .google import GoogleAdapter
from .groq import GroqAdapter
from .huggingface import HuggingFaceAdapter
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
