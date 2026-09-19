"""Direct account transports; catalogs always come from the connected provider."""

from typing import Any, ClassVar

import httpx

from ..errors import UpstreamError
from .base import DiscoveredModel, OpenAIAdapter, normalize, numeric
from .native_anthropic import NativeAnthropicAdapter
from .native_responses import NativeResponsesAdapter


class SubscriptionHeaders:
    # Mixed into OpenAIAdapter subclasses below.
    credentials: dict
    kind: ClassVar[str]

    def headers(self) -> dict[str, str]:
        creds = self.credentials
        token = creds.get("copilot_token") if self.kind == "github" else creds.get("access_token")
        headers = {
            "accept": "application/json",
            "authorization": "Bearer " + (token or creds.get("api_key", "")),
        }
        if self.kind == "github":
            headers.update(
                {
                    "copilot-integration-id": "vscode-chat",
                    "editor-version": "vscode/1.110.0",
                    "editor-plugin-version": "copilot-chat/0.38.0",
                    "user-agent": "GitHubCopilotChat/0.38.0",
                    "x-github-api-version": "2025-04-01",
                    "X-Initiator": "user",
                    "anthropic-version": "2023-06-01",
                }
            )
        elif self.kind == "codex":
            headers.update({"originator": "gateway", "user-agent": "Gateway/1.0"})
            if creds.get("account_id"):
                headers["ChatGPT-Account-ID"] = creds["account_id"]
        elif self.kind == "grok-cli":
            headers.update(
                {
                    "x-xai-token-auth": "xai-grok-cli",
                    "x-grok-client-identifier": "grok-shell",
                    "x-grok-client-version": "0.2.99",
                }
            )
        elif self.kind == "kimi":
            from ..native_auth import auth_headers

            headers.update(auth_headers("kimi", creds.get("device_id", "")))
        if creds.get("auth_type") != "oauth":
            headers.update(creds.get("headers", {}))
        return headers


class KimiAdapter(SubscriptionHeaders, OpenAIAdapter):
    kind = "kimi"
    default_url = "https://api.kimi.com/coding/v1"
    endpoints = {"chat/completions"}

    async def discover(self) -> list[DiscoveredModel]:
        result = await super().discover()
        for model in result:
            model.capabilities.update(chat=True, streaming=True, tools=True)
        return result


class KiloAdapter(SubscriptionHeaders, OpenAIAdapter):
    kind = "kilocode"
    default_url = "https://api.kilo.ai/api/gateway"
    endpoints = {"chat/completions"}

    async def discover(self) -> list[DiscoveredModel]:
        raw = await self.get_json(self.base_url + "/models")
        result = []
        for item in raw.get("data", []):
            model = normalize(item)
            model.capabilities.update(chat=True, streaming=True)
            price = item.get("pricing") or {}
            for attr, key in (("input_price", "prompt"), ("output_price", "completion")):
                value = numeric(price.get(key))
                setattr(model, attr, value * 1_000_000 if value is not None else None)
            result.append(model)
        return result


class CopilotAdapter(SubscriptionHeaders, OpenAIAdapter):
    kind = "github"
    default_url = "https://api.githubcopilot.com"
    endpoints = {"chat/completions", "responses"}

    async def discover(self) -> list[DiscoveredModel]:
        raw = await self.get_json(self.base_url + "/models")
        result = []
        for item in raw.get("data", []):
            caps = item.get("capabilities") or {}
            if (
                caps.get("type") != "chat"
                or item.get("policy", {}).get("state", "enabled") != "enabled"
            ):
                continue
            model = normalize(item)
            support = caps.get("supports") or {}
            model.capabilities.update(
                chat=True,
                streaming=True,
                tools=support.get("tool_calls"),
                vision=support.get("vision"),
                reasoning=support.get("reasoning_effort"),
                responses="/responses" in item.get("supported_endpoints", []),
            )
            model.context_window = caps.get("limits", {}).get("max_context_window_tokens")
            result.append(model)
        return result

    async def send(
        self, endpoint: str, payload: dict[str, Any], files: dict[str, Any] | None = None
    ) -> httpx.Response:
        await self.prepare()
        model = payload.get("model", "")
        self.quota_model = model
        if endpoint == "chat/completions" and "claude" in model.lower():
            adapter: OpenAIAdapter = NativeAnthropicAdapter(
                self.client, self.base_url + "/v1", self.credentials, self.max_bytes
            )
        elif endpoint == "responses" or "codex" in model.lower():
            adapter = NativeResponsesAdapter(
                self.client, self.base_url, self.credentials, self.max_bytes
            )
        else:
            return await super().send(endpoint, payload, files)
        adapter.headers = self.headers  # type: ignore[method-assign]
        adapter.on_headers = self.on_headers
        return await adapter.send(endpoint, payload, files)


class CodexAdapter(SubscriptionHeaders, NativeResponsesAdapter):
    kind = "codex"
    default_url = "https://chatgpt.com/backend-api/codex"

    async def discover(self) -> list[DiscoveredModel]:
        raw = await self.get_json(self.base_url + "/models", params={"client_version": "0.154.0"})
        items = raw.get("models", raw.get("data", []))
        if not isinstance(items, list):
            raise UpstreamError(502, "invalid_model_catalog")
        result = []
        for item in items:
            mid = item.get("slug") or item.get("id")
            if not mid or item.get("visibility") == "hidden":
                continue
            model = normalize({**item, "id": mid})
            model.capabilities.update(
                chat=True,
                streaming=True,
                tools=True,
                responses=True,
                reasoning=True,
                vision="image" in item.get("input_modalities", []),
            )
            result.append(model)
        return result


class GrokBuildAdapter(SubscriptionHeaders, NativeResponsesAdapter):
    kind = "grok-cli"
    default_url = "https://cli-chat-proxy.grok.com/v1"

    async def discover(self) -> list[DiscoveredModel]:
        result = await super().discover()
        for model in result:
            model.capabilities.update(chat=True, streaming=True, tools=True, responses=True)
        return result
