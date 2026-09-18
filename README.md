---
title: Nexus Universal AI Gateway
emoji: 🔗
colorFrom: purple
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# Nexus — Universal AI Gateway

A self-hosted, bring-your-own-key AI gateway with a Next.js dashboard and an async FastAPI backend. Connect provider accounts, generate a `gw_` key, and give your applications one OpenAI-compatible base URL.

The public landing page opens immediately, with no blocking workspace-loading screen. The unauthenticated dashboard includes a **clearly labelled, read-only demo workspace**. Register or sign in to access real connections and usage. Demo numbers, prices, health states, and models are illustrative fixtures; they are never used by the router.

## Included in v1

- Searchable directory of 121 providers/services, with 57 direct connection types including OpenAI, Anthropic, DeepSeek, Groq, NVIDIA NIM, Azure, and custom endpoints. Subscription and specialist providers connect through a private 9router instance.
- OpenRouter PKCE sign-in and a private 9router bridge that preserves provider/model namespaces.
- Provider-reported token/request limits and reset countdowns, OpenRouter/DeepSeek credit checks, and per-connection gateway usage. Unknown quotas remain unknown. See [provider setup and limitations](docs/provider-hub.md).
- Account registration/login/logout, Argon2id passwords, revocable database sessions, and one-time Gateway API keys with optional expiry.
- Authenticated encryption for both provider keys and custom headers; only hashes of Gateway keys and session tokens are stored.
- Provider discovery, persistent per-account model registry, manual model metadata, pinned providers, favorite models, and model search.
- Priority, fastest, cheapest, coding, reasoning, vision, image, embedding, and manual routing.
- Configurable retries, provider/model cooldowns, automatic catalog refresh, request metadata, audit history, latency/errors/token analytics, and CSV export.
- SSE chat streaming, function/tool calling, JSON mode, vision payloads, embeddings, audio transcription/speech, and capability-gated image and Responses forwarding.
- An Anthropic Messages bridge for ordinary Claude Code text/image/client-tool workflows, including streaming. See its explicit compatibility limits below.
- Responsive dark dashboard, provider management, model explorer, a working streaming playground, key lifecycle management, charts, and detailed fallback history.
- Python and TypeScript SDK packages built on the official OpenAI SDK, Docker Compose, a rootless Hugging Face image, deployment examples, migrations, typed code, and automated tests.

## Start locally with Docker

Requirements: Docker with Compose, and Python 3 to generate secrets.

```bash
python scripts/setup.py
docker compose up --build -d
```

Open **http://localhost:7860**. Create an account, save the Gateway key shown once, then connect a provider. Check discovery status in **Providers**. Use **Model explorer** to confirm capabilities, then try **Playground**.

Compose starts PostgreSQL and Redis as separate services. Only the gateway is exposed, on loopback port 7860. The databases have named volumes and no host ports. Generated database passwords contain URL-safe characters. The default local profile uses HTTP cookies; enable the production settings before exposing it publicly.

To stop while retaining data:

```bash
docker compose down
```

Do not add `--volumes` unless you intend to delete the database.

## Hugging Face Docker Space

The repository root contains the required Dockerfile and README YAML. The image serves the prebuilt Next.js dashboard and API together on port **7860**, as UID **1000**. No Node.js process or frontend secrets are needed at runtime.

1. Create a **Docker Space** and upload/push this repository’s contents at its root.
2. Configure the following in Space Settings:

| Variable/secret | Value |
|---|---|
| `ENCRYPTION_KEYS` (secret) | A generated Fernet key, retained for the life of your data |
| `ENVIRONMENT` | `production` |
| `COOKIE_SECURE` | `true` |
| `ALLOWED_ORIGINS` | `["https://YOUR-SPACE-SUBDOMAIN.hf.space"]` |
| `REGISTRATION_CODE` (secret, recommended for a private workspace) | Your chosen invitation code |
| `PERSISTENT_STORAGE_CONFIRMED` | `true` **only after** attaching durable storage at `/data` when using embedded PostgreSQL |

Generate an encryption key without dependencies:

```bash
python -c 'import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())'
```

3. Choose a database topology:
   - **Single-Space deployment:** omit `DATABASE_URL` and `REDIS_URL`. The entrypoint starts PostgreSQL and Redis on Unix sockets inside the container. PostgreSQL is under `/data/postgres`; Redis data is under `/data/redis`. Durable `/data` is required for production and must be backed up. This avoids assuming that normal outbound database ports are available.
   - **External managed databases:** supply an async SQLAlchemy `DATABASE_URL` using `postgresql+asyncpg://…` and a `REDIS_URL` using `rediss://…` where supported. Confirm that your Space can reach their ports. Spaces document outbound ports 80, 443 and 8080; a normal hosted PostgreSQL URL on 5432 cannot be assumed reachable. Do not weaken TLS or expose unauthenticated databases to solve connectivity.
4. Open the **direct `https://…hf.space` URL**. The app disallows embedding to protect the authenticated dashboard, so use the direct URL instead of the Hub’s iframe.
5. For a single-key agent connection, use an app URL that is not gated by private-Space authentication. Public or protected Spaces can use this gateway’s own account/API-key authentication; private Spaces additionally require Hugging Face authentication.
6. Register with your invitation code, connect your provider accounts, and save a Gateway key. After initial setup you may set `ALLOW_REGISTRATION=false`.

The application deliberately refuses embedded production startup unless persistence is explicitly configured. For an expendable demo only, use `ENVIRONMENT=development`; its local data may disappear when the Space restarts. Free hardware can sleep and is not an always-on availability guarantee. Use suitable always-on hosting for continuous agent workloads.

## Your first API call

```bash
export GATEWAY_BASE_URL="https://YOUR-GATEWAY/v1"
export GATEWAY_API_KEY="gw_YOUR_NEW_KEY"

curl "$GATEWAY_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello!"}]}'
```

Use the **actual model IDs returned by your registry**, not assumed or legacy provider aliases. `llama-3` is not a universal native ID. To pin a provider and native model:

```json
{
  "provider": "groq",
  "model": "NATIVE_MODEL_ID_FROM_YOUR_REGISTRY",
  "messages": [{"role": "user", "content": "Hello"}]
}
```

A provider value can be its adapter kind or the UUID of one saved connection. `/v1/models` returns unique IDs of the form `CONNECTION_UUID::NATIVE_MODEL_ID`; copying one pins that exact connection. There is no ambiguous slash-based model-name stripping.

### OpenAI Python SDK

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url=os.environ["GATEWAY_BASE_URL"],
    api_key=os.environ["GATEWAY_API_KEY"],
    max_retries=0,  # Let the gateway own the retry budget.
)
response = client.chat.completions.create(
    model="auto/coding",
    messages=[{"role": "user", "content": "Explain an async generator."}],
    extra_body={"max_retries": 2},
)
print(response.choices[0].message.content)
```

### Included SDKs

```bash
pip install ./sdk/python
```

```python
from universal_gateway import Gateway, AsyncGateway
client = Gateway()  # GATEWAY_BASE_URL + GATEWAY_API_KEY
```

```bash
cd sdk/node
npm ci
npm run build
# In your Node application, install the built package directory.
```

```typescript
import { Gateway } from 'universal-gateway-client';
const gateway = new Gateway(); // GATEWAY_BASE_URL + GATEWAY_API_KEY
const response = await gateway.chat.completions.create({
  model: 'auto',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

## Routing and failure behavior

| Request | Behavior |
|---|---|
| `auto` | Compatible confirmed capabilities, then pin preference, priority and observed latency |
| `auto/fastest` | Lowest observed end-to-end latency; unknown measurements sort last |
| `auto/cheapest` | Lowest known input+output USD per million tokens; unknown prices sort last |
| `auto/coding` | Declared coding support or a coding-family name is preferred, then priority; this is a heuristic, not a quality benchmark |
| `auto/reasoning` | Requires confirmed reasoning support |
| `auto/vision` | Requires confirmed vision support |
| `auto/image` | Use with `/v1/images/generations`, requires image support |
| `auto/embedding` | Use with `/v1/embeddings`, requires embedding support |
| Named model | Exact native ID only across allowed connections by default |
| `allow_alternatives: true` | Named-model requests may fall back to a different model with confirmed required capabilities |
| `provider` or `UUID::model` | Hard provider boundary, including during fallback |

For streaming, tools, JSON output, and vision requests, the router derives the required capabilities. Unknown capability metadata is allowed for an explicit named model but excluded from automatic routing and alternative-model fallback. Some providers do not report capabilities; configure them in the explorer instead of assuming every model supports every feature.

Retries apply to 401, 403, 404, 429, 500, 502, 503, 504 and upstream timeouts. 404 means that a previously registered model may no longer exist. Ordinary 400/422 errors are not retried. The request retry budget cannot exceed the operator’s `MAX_RETRIES`. There is one attempt per candidate; no retry sleep consumes the caller’s latency budget. Explicitly pinned providers never silently spill into another provider.

**Streaming is never restarted after output begins.** Pre-output errors can fall back; a mid-stream error returns a sanitized SSE error and ends the stream. Responses and tool deltas remain in OpenAI wire format. Client cancellation closes the upstream connection. Caller retries can still duplicate work or charges; this gateway does not promise exactly-once inference.

Cooldowns are scoped per model for outages and per connection for authentication/quota failures. Expired circuits become eligible again on the next real request. The monitor refreshes model catalogs without running paid generation probes. High latency is labelled degraded; fastest routing uses recorded end-to-end latency, not time-to-first-token benchmarks.

## Endpoints

| Endpoint | Support |
|---|---|
| `GET /v1/models` | User-isolated OpenAI-style model registry |
| `POST /v1/chat/completions` | JSON and SSE, tool/function fields, JSON mode, vision parts |
| `POST /v1/embeddings` | Compatible embedding providers/models |
| `POST /v1/images/generations` | Compatible providers/models only; media pricing is not inferred from token prices |
| `POST /v1/audio/transcriptions` | Multipart audio, JSON or text formats supported by the selected provider |
| `POST /v1/audio/speech` | Binary audio passthrough with content type |
| `POST /v1/responses` | Explicit-model provider passthrough; provider must actually support Responses |
| `POST /v1/messages` | Anthropic Messages bridge for ordinary client-tool workflows |
| `POST /v1/messages/count_tokens` | Disclosed conservative byte-based estimate for the bridge |
| `/api/*` | Session-authenticated dashboard API; unsafe methods require allowed Origin and CSRF token |
| `GET /health/live`, `GET /health/ready` | Process and database/Redis readiness |
| `GET /api/docs`, `GET /api/openapi.json` | Interactive API reference and machine-readable schema |

Responses objects remain upstream-owned. Use a **connection-qualified model ID** with `previous_response_id`; stateful continuation disables fallback. There is no local Responses object store, retrieval, deletion, background-response lifecycle or universal protocol emulation. Audio endpoints are non-streaming in v1. Native image/audio protocols are not falsely advertised as OpenAI compatible.

The optional interactive Swagger page loads Swagger UI from jsDelivr. The dashboard itself uses locally built assets, no external fonts or runtime CDN.

## Agent configuration

For OpenAI-compatible clients such as OpenCode, Continue, Cline, Cursor, Roo Code and Aider, select their custom/OpenAI-compatible provider mode and set:

- Base URL: `https://YOUR-GATEWAY/v1`
- API key: your `gw_…` key
- Model, when the client requires one: `auto`, `auto/coding`, or an ID from `/v1/models`

Client versions and feature restrictions differ. The gateway does not claim those applications were all live-tested. For a MiMo client/provider, use its OpenAI-compatible connection option when available; this project does not assume a native MiMo-specific integration.

For **Claude Code**, the gateway provides an additional Messages-format bridge; setting an OpenAI base URL alone is insufficient:

```bash
export ANTHROPIC_BASE_URL="https://YOUR-GATEWAY"
export ANTHROPIC_AUTH_TOKEN="$GATEWAY_API_KEY"
export ANTHROPIC_MODEL="auto/coding"
```

The bridge supports text, base64/URL images, system text, ordinary client-side tools and tool results, stop controls, and SSE. Tool argument fragments are buffered until the tool call completes, then emitted as Anthropic tool blocks. **Extended thinking, computer use, server-side tools, document blocks, prompt caching, and provider-specific beta features are not emulated.** Unsupported content and tool types are rejected. Token counting is a conservative UTF-8 byte estimate, labelled by `X-Gateway-Token-Count`; it is not a model tokenizer. If upstream token usage is absent, bridge protocol fields use zero while stored gateway analytics retain unknown values. This bridge is covered by mocked protocol tests, not a live Claude Code certification.

## Development without Docker

```bash
python scripts/setup.py
python -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.lock -e './backend[dev]' -e ./sdk/python
cd frontend
npm ci
npm run build
cd ..
PYTHONPATH=backend uvicorn app.main:app --port 7860
```

SQLite and process-local rate-limit/health state work in development only. Keep one worker in this mode. Production requires PostgreSQL, Redis and HTTPS. The static frontend can be rebuilt independently and is served by FastAPI; for Next development run `npm run dev` and configure a same-origin proxy to the API instead of sending credentials across origins.

The delivery archive includes `frontend/out` for an immediate **UI-only demo**:

```bash
python -m http.server 7860 --directory frontend/out
```

This last command is not the gateway; sign-in and live requests require FastAPI.

## Checks

```bash
pytest backend/tests -q
ruff check backend/app backend/tests
mypy backend/app
python -m alembic -c backend/alembic.ini upgrade head
python -m alembic -c backend/alembic.ini check
cd frontend && npm run build
```

Tests use mocked providers and isolated databases. They check tenancy, key secrecy, CSRF, body limits, SSRF/DNS protections, adapters, routing, SSE failure boundaries, audio/embeddings, SDK compatibility, and the Messages bridge. See [VALIDATION.md](VALIDATION.md) for the delivered verification status and [docs/OPERATIONS.md](docs/OPERATIONS.md) for deployment and recovery.

## Structure

```text
backend/app/             FastAPI, account security, routing, analytics
backend/app/providers/   Seven isolated adapters
backend/alembic/          Versioned database migrations
backend/tests/           Security, routing, provider and SDK tests
frontend/                Next.js / React / Tailwind dashboard
sdk/python/              Sync and async Python clients
sdk/node/                TypeScript client
scripts/                 Secret setup and credential rotation
deploy/                  Rootless supervisor, hosting templates, Caddy
```

## Restricted administration and community models

The `/#admin` panel manages branding, Playground defaults, registration and request limits, user suspension, and explicitly published chat models. Roles require server access; public signup cannot create an administrator. See [Administration guide](docs/administration.md) for activation, deployment, publishing your own model, and revocation.

## Scope and operational limits

This v1 implements the requested core and selected providers. Favorites, pins, model search and usage export are included. Automated paid benchmarks, public leaderboards, webhooks, saved prompt templates and prompt replay are **not included**. Prompt replay would require an explicit opt-in content-retention design; this version never logs prompts or completions.

Prices/capabilities depend on provider metadata and manual configuration. Catalog-listed does not guarantee your account has quota or access. Free-tier usage is still subject to each provider’s rules, credits and rate limits. Administrators can explicitly publish selected chat models for community use. Credentials remain encrypted on the server; the administrator covers upstream charges. No provider quota bypass is provided. Usage costs are partial estimates, not billing records.

This is a production-oriented initial implementation, not an assertion of independent security audit, live-provider certification, load-tested capacity or high availability. The included single-container database topology is a single node. Use external database services and backups for stronger availability requirements.

## Primary references

- [Google OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [Google model discovery](https://ai.google.dev/api/models)
- [Groq OpenAI compatibility](https://console.groq.com/docs/openai)
- [OpenRouter model registry](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
- [Hugging Face router model metadata](https://huggingface.co/docs/inference-providers/hub-api)
- [Together model catalog](https://docs.together.ai/reference/models)
- [Fireworks model catalog](https://docs.fireworks.ai/api-reference/list-models)
- [Hugging Face Docker Spaces](https://huggingface.co/docs/hub/spaces-sdks-docker), [Space networking](https://huggingface.co/docs/hub/spaces-overview)
- [Claude Code gateway configuration](https://code.claude.com/docs/en/llm-gateway)

Visual direction: an original developer control room informed by the requested gateway references. Frenix was accessible for content review; CognixAI returned 403 and EvolveX could not be retrieved. No private pages, branding assets or site code were copied.
