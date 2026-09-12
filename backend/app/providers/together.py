from .base import DiscoveredModel, OpenAIAdapter, normalize, numeric


class TogetherAdapter(OpenAIAdapter):
    kind = "together"
    default_url = "https://api.together.ai/v1"
    endpoints = {
        "chat/completions",
        "embeddings",
        "images/generations",
        "audio/transcriptions",
        "audio/speech",
    }

    async def discover(self) -> list[DiscoveredModel]:
        raw = await self.get_json(self.base_url + "/models")
        results = []
        for item in raw if isinstance(raw, list) else raw.get("data", []):
            m = normalize(item)
            m.input_price = numeric(item.get("pricing", {}).get("input"))
            m.output_price = numeric(item.get("pricing", {}).get("output"))
            if m.capabilities.get("embeddings"):
                m.output_price = 0
            results.append(m)
        return results
