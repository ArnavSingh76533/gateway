from .base import OpenAIAdapter


class CustomAdapter(OpenAIAdapter):
    """Ollama /v1, LM Studio /v1, and any other OpenAI-compatible server.

    Catalog capabilities may be unknown; owners can register explicit metadata in the dashboard.
    """

    kind = "custom"
