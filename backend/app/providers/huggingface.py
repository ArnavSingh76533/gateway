from .base import DiscoveredModel, OpenAIAdapter, normalize


class HuggingFaceAdapter(OpenAIAdapter):
    kind = "huggingface"
    default_url = "https://router.huggingface.co/v1"
    endpoints = {"chat/completions", "responses"}

    async def discover(self) -> list[DiscoveredModel]:
        raw = await self.get_json(self.base_url + "/models")
        results = []
        for item in raw.get("data", []):
            m = normalize(item)
            m.capabilities.update(chat=True, streaming=True)
            providers = [p for p in item.get("providers", []) if p.get("status") == "live"]
            if providers:
                # HF itself routes across providers. Only claim capability when all candidates confirm it.
                for dest, source in [
                    ("tools", "supports_tools"),
                    ("json_mode", "supports_structured_output"),
                ]:
                    if all(p.get(source) is True for p in providers):
                        m.capabilities[dest] = True
                contexts = [p.get("context_length") for p in providers]
                if all(isinstance(c, int) for c in contexts):
                    m.context_window = min(contexts)
            # A single HF model can have different prices. Leave price unknown instead of underquoting.
            results.append(m)
        return results
