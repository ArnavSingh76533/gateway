import asyncio

from ..errors import UpstreamError
from .base import DiscoveredModel, OpenAIAdapter, normalize


class CompatibleAdapter(OpenAIAdapter):
    async def discover(self) -> list[DiscoveredModel]:
        models = await super().discover()
        for model in models:
            mid = model.model_id.lower()
            # Unknown capabilities stay unknown for explicit routes; do not guess tools/vision.
            if any(word in mid for word in ("embedding", "embed-", "rerank")):
                model.capabilities.update(chat=False, embeddings="rerank" not in mid)
            elif self.kind in {"deepseek", "cerebras", "perplexity", "mistral", "sambanova"}:
                model.capabilities.update(chat=True, streaming=True)
                model.source = "provider + chat adapter family rules"
        return models


class AzureAdapter(CompatibleAdapter):
    def headers(self) -> dict[str, str]:
        return {
            "accept": "application/json",
            "api-key": self.credentials.get("api_key", ""),
            **self.credentials.get("headers", {}),
        }


class NineRouterAdapter(CompatibleAdapter):
    kind = "9router"

    async def discover(self) -> list[DiscoveredModel]:
        models = await super().discover()
        # /v1/models from the bridge retains its provider/model route IDs verbatim.
        for model in models:
            model.capabilities.update(chat=True, streaming=True)
            model.source = "private 9router catalog"
        by_id = {model.model_id: model for model in models}

        async def catalog(slug: str, capability: str) -> list[DiscoveredModel]:
            try:
                raw = await self.get_json(self.base_url + "/models/" + slug)
            except UpstreamError as exc:
                if exc.status in {404, 405}:
                    return []  # Older bridge versions may only expose the chat catalog.
                raise
            result = []
            for item in raw.get("data", []):
                if not isinstance(item, dict) or not item.get("id"):
                    continue
                model = normalize(item)
                model.capabilities.update(chat=False, streaming=False)
                model.capabilities[capability] = True
                model.source = "private 9router " + slug + " catalog"
                result.append(model)
            return result

        catalogs = await asyncio.gather(
            *(
                catalog(slug, cap)
                for slug, cap in (
                    ("image", "images"),
                    ("tts", "speech"),
                    ("stt", "transcription"),
                    ("embedding", "embeddings"),
                )
            )
        )
        for result in catalogs:
            for model in result:
                if model.model_id in by_id:
                    by_id[model.model_id].capabilities.update(
                        {k: v for k, v in model.capabilities.items() if v is True}
                    )
                else:
                    by_id[model.model_id] = model
        return list(by_id.values())
