from .base import DiscoveredModel, OpenAIAdapter, numeric


class OpenRouterAdapter(OpenAIAdapter):
    kind = "openrouter"
    default_url = "https://openrouter.ai/api/v1"
    endpoints = {"chat/completions", "embeddings", "responses", "images/generations"}

    async def discover(self) -> list[DiscoveredModel]:
        from .base import normalize

        raw = await self.get_json(self.base_url + "/models")
        results = []
        for item in raw.get("data", []):
            m = normalize(item)
            m.capabilities.update(chat=True, streaming=True)
            if item.get("architecture", {}).get("modality") == "text->embedding":
                m.capabilities.update(chat=False, embeddings=True, streaming=False)
            price = item.get("pricing", {})
            for attr, key in [("input_price", "prompt"), ("output_price", "completion")]:
                n = numeric(price.get(key))
                setattr(m, attr, n * 1_000_000 if n is not None else None)
            results.append(m)
        # Embeddings have their own catalog; a failed optional catalog must not erase chat models.
        from ..errors import UpstreamError

        try:
            emb = await self.get_json(self.base_url + "/embeddings/models")
        except UpstreamError:
            emb = {"data": []}
        for item in emb.get("data", []):
            m = normalize(item)
            m.capabilities.update(chat=False, embeddings=True, streaming=False)
            n = numeric(item.get("pricing", {}).get("prompt"))
            m.input_price = n * 1_000_000 if n is not None else None
            m.output_price = 0
            results.append(m)
        return list({m.model_id: m for m in results}.values())
