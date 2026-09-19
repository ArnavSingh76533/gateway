# Native connections, model preferences, and quotas

The gateway runs provider linking, encrypted credential storage, refresh-token renewal, catalog discovery, and inference itself. No 9router process, private bridge, or separate dashboard is required. The existing landing design is retained.

## Connection methods

| Provider | Native linking | Inference | Account limits |
| --- | --- | --- | --- |
| OpenRouter | Browser redirect with PKCE | Existing direct adapter | Credit and reported free-request allowance |
| Kimi Code | Device authorization or coding API key | OpenAI-compatible chat | Plan/rate allowances in provider units |
| Kilo Code | Device authorization or API key | Kilo gateway chat and live catalog/prices | Reported response headers |
| GitHub Copilot | Device authorization; requires Copilot access | Chat; Anthropic Messages for Claude; Responses for Codex models | Reported quota snapshots |
| OpenAI Codex | Device authorization; enable device login in ChatGPT security/workspace settings | Stateless Responses, translated chat, streaming and client function calls | Reported session/account windows as percentages |
| Grok Build | Device authorization; requires account access | Stateless Responses and translated chat | Reported response headers |
| Other direct connectors | Provider API key | Supported native/OpenAI-compatible protocol | Reported response headers; DeepSeek credit endpoint |

The directory offers 61 native connection types. Other reference entries are marked **Not yet supported**, including desktop-specific, cookie-based, media, and specialist protocols without a native adapter. This release does not claim complete parity with every 9router executor. Use Anthropic API keys for Claude and Google AI Studio API keys for Gemini; Claude subscription login, Gemini CLI/Antigravity, Cursor, Kiro, and other unimplemented logins are unavailable. Custom OpenAI-compatible API endpoints remain supported. Existing legacy bridge connections still work for backward compatibility, but new flows never require or redirect to one.

The five new device authorization endpoints were reached successfully during development. Automated tests cover successful authorization exchanges and inference against controlled upstream responses; live authenticated inference on every subscription was not tested. Provider access, protocol availability, and client authorization rules remain controlled by the provider. These adapters use the referenced public client protocols; directory presence is not provider endorsement.

## Connect an account

1. Open **Providers**, find the service, and choose API key or **Sign in with …**.
2. For device sign-in, open the provider's authorization page, sign in there, and approve the displayed one-time code. The gateway polls at the provider's required interval. Your provider password never passes through this app.
3. After connection, search the full discovered catalog and choose model preferences. The search is server-side, includes every page, and has a free-model filter.
4. Complete the preferences step, or skip it and edit the connection later.

OpenRouter returns to this site after its browser flow. Its preferences entered before sign-in are retained; edit the connection afterward to use full-catalog search. To change an OAuth account, add a new connection and remove the old connection when ready. Each gateway account has its own credentials. Native authorization flows are bound to both the gateway user and browser session, expire, support cancellation, enforce polling intervals, and never return access/refresh tokens to the UI.

Refresh tokens are encrypted with the server's existing Fernet vault. Renewal uses a shared lease and reloads the latest saved credentials, so replicas cannot concurrently rotate the same refresh token. GitHub access tokens are exchanged for short-lived Copilot inference tokens. Failed refreshes require reconnecting; they never fall back to another user's credentials. Keep PostgreSQL, Redis, and `ENCRYPTION_KEYS` persistent.

## Model preferences and exact routes

Each connection saves an ordered `preferred_models` list and an optional `preferred_only` flag. For example, choose a fast model as 1, a reasoning model as 2, and a free fallback as 3.

- **Auto:** pinned connections and connection priority are considered first, then the model order within that priority. Unranked eligible models follow unless **Only use these models** is enabled.
- **Fastest/cheapest:** retain their explicit optimization target, with preferences used after equal connection priority and equal speed/price. Coding mode first applies its existing coding hint.
- **Exact model:** an explicit `connection-id::model-id` continues to select that model even when it is outside the automatic preference list. A plain ID can use eligible connections with the same ID. `allow_alternatives=true` allows compatible alternatives after exact matches, subject to preferences.
- Unavailable, undiscovered, incompatible, or cooling-down models are skipped. A manually typed preference does not register a model or grant access. Add manual model metadata separately if discovery is unavailable.
- Fallback stays within the request's retry budget. A provider-wide authentication, rate-limit, or outage cooldown skips that provider; model-specific failures can try the next eligible model. Streaming never retries after committing output.

The full playground and model explorer catalog remain searchable. Identical display names on Groq, OpenRouter, or NVIDIA do not make their upstream model IDs interchangeable. Use the copied connection-specific route for precise control.

## Protocol boundaries

Native subscription chat adapters support ordinary text, images when the provider confirms support, and client function calls. Codex and Grok Build use stateless Responses (`store=false`), so send conversation history instead of `previous_response_id`. Codex does not accept all Chat Completions controls; unsupported sampling/token-limit controls produce an error rather than being silently ignored. Use an ordinary OpenAI API-key connection when those controls are required. Native adapters discover live provider catalogs rather than inventing access from a static model list. Account plans can deny individual models.

The existing `/v1/messages` compatibility layer and native Anthropic API-key adapter retain their documented limits. Desktop session emulation, provider website cookies, video/search specialist APIs, and arbitrary management APIs are not exposed.

## Quotas

**Tokens & limits** combines observed response headers with optional read-only account quota checks. Limits can describe tokens, requests, percentages, or provider units; they are labeled as reported and are not interchangeable. Codex account percentages are not absolute token balances. Monetary balances remain separate.

OpenRouter/DeepSeek have credit checks. Codex, Copilot, and Kimi have **Check account limits**, subject to account access. Checks are rate-limited and do not generate inference. Missing fields remain unknown; zero and unlimited are not inferred. Expired observations show **Awaiting update** until a fresh provider response arrives. Other provider account APIs are not yet implemented, so the app can show only the rate headers they send.

## Source references

- [9router source](https://github.com/decolua/9router), pinned provenance and MIT notice in [third-party/9router-source.md](third-party/9router-source.md).
- [Codex authentication](https://developers.openai.com/codex/auth) and its upstream device-code protocol.
- [Kimi device authorization implementation](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/auth/oauth.py).
- [Kilo authentication](https://github.com/Kilo-Org/kilocode/blob/main/packages/kilo-docs/pages/gateway/authentication.md).
- [OpenRouter OAuth](https://openrouter.ai/docs/guides/overview/auth/oauth).
