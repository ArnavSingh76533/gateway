from .base import DiscoveredModel, OpenAIAdapter


class GroqAdapter(OpenAIAdapter):
    kind = "groq"
    default_url = "https://api.groq.com/openai/v1"
    endpoints = {"chat/completions", "audio/transcriptions", "audio/speech", "responses"}

    async def discover(self) -> list[DiscoveredModel]:
        models = await super().discover()
        for m in models:
            # Model-family rules are labelled; discovery does not report tool/vision support.
            m.source = "provider + adapter family rules"
            if "whisper" in m.model_id.lower():
                m.capabilities.update(chat=False, transcription=True, audio=True, streaming=False)
            elif "tts" in m.model_id.lower() or "orpheus" in m.model_id.lower():
                m.capabilities.update(chat=False, speech=True, audio=True, streaming=False)
            elif "guard" in m.model_id.lower():
                m.capabilities.update(chat=False)
            else:
                m.capabilities.update(chat=True, streaming=True)
        return models
