from .base import DiscoveredModel, OpenAIAdapter


class FireworksAdapter(OpenAIAdapter):
    kind = "fireworks"
    default_url = "https://api.fireworks.ai/inference/v1"
    endpoints = {"chat/completions", "embeddings", "responses"}

    async def discover(self) -> list[DiscoveredModel]:
        if self.base_url != self.default_url:
            return await super().discover()
        models = []
        token = ""
        for _ in range(50):
            raw = await self.get_json(
                "https://api.fireworks.ai/v1/accounts/fireworks/models",
                {"pageSize": 200, "pageToken": token},
            )
            for item in raw.get("models", []):
                if not item.get("supportsServerless"):
                    continue
                mid = item.get("name", "")
                if not mid:
                    continue
                m = DiscoveredModel(mid, item.get("displayName", mid))
                m.context_window = item.get("contextLength")
                if item.get("kind") == "EMBEDDING_MODEL":
                    m.capabilities.update(chat=False, embeddings=True, streaming=False)
                else:
                    m.capabilities.update(chat=True, streaming=True)
                if "supportsImageInput" in item:
                    m.capabilities["vision"] = item["supportsImageInput"]
                models.append(m)
            token = raw.get("nextPageToken", "")
            if not token:
                return models
        from ..errors import UpstreamError

        raise UpstreamError(502, "catalog_pagination_limit")
