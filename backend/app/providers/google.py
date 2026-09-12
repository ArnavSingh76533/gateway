from .base import DiscoveredModel, OpenAIAdapter, numeric


class GoogleAdapter(OpenAIAdapter):
    kind = "google"
    default_url = "https://generativelanguage.googleapis.com/v1beta/openai"
    endpoints = {"chat/completions", "embeddings"}

    async def discover(self) -> list[DiscoveredModel]:
        if self.base_url != self.default_url:
            return await super().discover()
        models = []
        token = ""
        for _ in range(30):
            raw = await self.get_json(
                "https://generativelanguage.googleapis.com/v1beta/models",
                params={"pageSize": 1000, "pageToken": token},
                headers={
                    "x-goog-api-key": self.credentials.get("api_key", ""),
                    "accept": "application/json",
                },
            )
            for item in raw.get("models", []):
                mid = item["name"].removeprefix("models/")
                methods = item.get("supportedGenerationMethods", [])
                chat, embed = "generateContent" in methods, "embedContent" in methods
                if not (chat or embed):
                    continue
                m = DiscoveredModel(mid, item.get("displayName", mid))
                m.capabilities.update(
                    chat=chat, embeddings=embed, streaming=chat, reasoning=item.get("thinking")
                )
                ctx = numeric(item.get("inputTokenLimit"))
                m.context_window = int(ctx) if ctx else None
                # Only ordinary Gemini text models inherit the documented compatibility features.
                if (
                    chat
                    and mid.startswith("gemini-")
                    and not any(x in mid for x in ("image", "tts", "audio", "robotics", "live"))
                ):
                    m.capabilities.update(tools=True, vision=True, json_mode=True)
                    m.source = "provider + documented Gemini family"
                elif chat:
                    continue  # Native-only media/live models are not OpenAI chat models.
                models.append(m)
            token = raw.get("nextPageToken", "")
            if not token:
                return models
        from ..errors import UpstreamError

        raise UpstreamError(502, "catalog_pagination_limit")
