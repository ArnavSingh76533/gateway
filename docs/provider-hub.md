# Provider hub, subscription connections, and quotas

The landing page is available immediately at `/` or `/#home`. The workspace is at `/#overview`, provider search at `/#providers`, and limits at `/#quotas`. Administration stays at `/#admin` and requires a server-granted administrator role.

## Connection methods

The directory contains 121 entries adapted from the 9router registry: 57 direct connection types (including custom endpoints and the 9router bridge), and 64 entries reached through a private 9router. The catalog includes media and specialist services as well as language models. Provider entries are configuration options, not a claim that every service or subscription was tested with a live credential.

1. **API key:** Search Providers, choose a direct connection, and enter the provider's key. The displayed base URL comes from the directory and can be changed before saving. Azure requires the resource's `/openai/v1` URL; Cloudflare requires the account-specific OpenAI-compatible URL. A provider without a model-list endpoint can still be used by adding its exact model ID and capabilities in Model explorer. Native Anthropic-compatible connections translate ordinary OpenAI chat, images, client tools, and SSE streams to Messages; unsupported parameters return an error instead of being silently applied.
2. **OpenRouter sign-in:** Choose OpenRouter → Sign in with OpenRouter → Continue. Authorization uses PKCE S256, a ten-minute single-use state, and the same signed-in gateway session. The returned provider key is encrypted using the existing vault. No OpenRouter client secret or new application registration is required. Configure the actual HTTPS site origin in `ALLOWED_ORIGINS`; keep secure cookies enabled in production. OpenRouter authorization is separate from signing in to this gateway.
3. **Private 9router:** Authorize subscription accounts in your own 9router dashboard. In this gateway choose Private 9router and save its `/v1` base URL plus a generated 9router gateway key. Subscription passwords, cookies, and refresh tokens stay in that instance. The gateway stores only the bridge key and URL, scoped to the owning gateway account. Each user can connect their own instance. Do not publish subscription routes as community models unless you intentionally want to sponsor other users' requests.

### Run a private 9router beside a self-hosted gateway

The optional Compose overlay builds the upstream source at the reviewed commit and uses a separate persistent volume. It is not enabled by the default deployment and does not run on Hugging Face automatically.

```sh
python scripts/setup.py       # only for a fresh gateway; existing .env stays unchanged
python scripts/setup_9router.py
docker compose -f docker-compose.yml -f docker-compose.9router.yml up --build -d
```

Open `http://localhost:20128` and sign in using `INITIAL_PASSWORD` from the private `.env.9router` file. Complete provider logins there and create a 9router API key. In the gateway provider form use `http://9router:20128/v1` and that API key. The dashboard port is bound to loopback; API-key enforcement is enabled. Back up both database volumes and their secret files. On a remote host, access the dashboard through an SSH tunnel or a private authenticated network.

The overlay sets `PRIVATE_UPSTREAM_HOSTS=["9router"]`. Preserve any other intentionally configured hosts when adapting it. An allowlisted host is reachable by gateway users, so always require a bridge API key. Do not allowlist arbitrary networks or metadata endpoints. Configure OAuth callback reachability according to each provider's instructions in the private dashboard.

### Connecting from the Hugging Face site

`localhost` on a Hugging Face Space means the Space container, not your computer. A separately hosted bridge must be reachable from the Space at an HTTPS URL on a supported outbound port. Keep its dashboard private and expose only authenticated inference/model-list routes through your reverse proxy. Supply the bridge URL and key in the provider form. Hosting and provider authorization are required before subscription calls can work; adding a directory card alone does not authorize an account.

The bridge discovers chat, image, embedding, speech and transcription catalogs. Gateway routes remain `/v1/chat/completions`, `/v1/responses`, `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/speech`, and `/v1/audio/transcriptions`, plus the existing `/v1/messages` compatibility bridge. Actual support depends on the model and upstream. 9router-specific video, web search/fetch, local desktop/MITM and management APIs are not proxied by this gateway; use the private dashboard/API for those services.

## Same model, different providers

Model explorer and the playground preserve every connected provider's model ID. Copy the exact `connection-id::model-id` route to choose a specific account. For 9router, provider prefixes remain intact: `connection-id::provider/model-id`. A plain model ID can route among eligible matching providers, while `auto` uses confirmed capabilities and the configured priority/fallback policy. Connecting Groq and OpenRouter does not mean their model IDs are interchangeable.

## Tokens, credit balances, and reset times

- OpenAI-style and Groq `x-ratelimit-*` response headers and Anthropic `anthropic-ratelimit-*` headers are recorded on successful and error responses. Counts apply to the reported window/model/account, not necessarily every model under a provider. A snapshot shows the last model and observation time.
- OpenRouter's Check credit balance action reads `/api/v1/key`: its key spending cap is shown in USD, separate from any reported free-model daily request counter. If the daily counter is returned, its reset is the next UTC day per OpenRouter's documented policy. A missing spending limit is not described as unlimited funds.
- DeepSeek's balance action reads `/user/balance` and keeps USD/CNY credit balances separate from token counts.
- Refreshing the page retrieves saved observations; it does not generate a paid inference request. Balance API checks are limited to one per connection per 30 seconds. Subscription-specific quota APIs stay in the private 9router dashboard. A bridge only exposes forwarded quota headers here when it supplies them.
- A passed reset time displays “Awaiting update”; the UI never fabricates a replenished balance. Unknown data remains unknown. Header snapshots expire after 48 hours and balance snapshots after 24 hours; Redis provides shared storage in production. Gateway usage covers the last 24 hours and only requests recorded here, with missing token counts explicitly described as incomplete.

## Validation and sources

Automated tests cover adapter translation and streaming, bridge model namespaces, OAuth ownership/session checks and replay, credential encryption, quota parsing and account isolation, provider search, landing accessibility, and stale-limit presentation. Live credentials are still needed to validate a particular provider/account's availability.

- [9router source and license](https://github.com/decolua/9router), pinned attribution in `third-party/9router-source.md`.
- [OpenRouter OAuth](https://openrouter.ai/docs/guides/overview/auth/oauth) and [limits](https://openrouter.ai/docs/api_reference/limits).
- [Groq rate limits](https://console.groq.com/docs/rate-limits).
- [DeepSeek balance endpoint](https://api-docs.deepseek.com/api/get-user-balance/).
- [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming).
