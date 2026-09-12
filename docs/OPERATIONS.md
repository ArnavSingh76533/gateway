# Operations and security

## Runtime configuration

All configuration comes from environment variables (`.env` is a local convenience). `ENCRYPTION_KEYS` is mandatory in every environment. Production additionally enforces PostgreSQL, Redis, secure cookies and HTTPS allowed origins.

| Setting | Default | Meaning |
|---|---|---|
| `ENVIRONMENT` | `development` | Set `production` for enforced secure configuration |
| `ENCRYPTION_KEYS` | required | Comma-separated Fernet keys; first key encrypts, all decrypt |
| `DATABASE_URL` | local SQLite | Async SQLAlchemy URL; PostgreSQL required in production |
| `REDIS_URL` | absent | Redis URL; absent is allowed only in development |
| `ALLOWED_ORIGINS` | `["http://localhost:7860"]` | JSON array; exact origins for dashboard mutations |
| `COOKIE_SECURE` | false | Must be true with HTTPS production |
| `ALLOW_REGISTRATION` | true | Close after onboarding if appropriate |
| `REGISTRATION_CODE` | empty | Optional deployment-wide invitation code |
| `SESSION_HOURS` | 24 | Dashboard session lifetime |
| `REQUESTS_PER_MINUTE` | 60 | Per-user gateway request limit across all their keys |
| `MAX_RETRIES` | 2 | Max extra candidate attempts; request can reduce this |
| `UPSTREAM_TIMEOUT_SECONDS` | 60 | Per-attempt upstream timeout; stream phase also bounded |
| `MAX_REQUEST_BYTES` | 26214400 | Entire request body, including multipart overhead |
| `MAX_RESPONSE_BYTES` | 52428800 | Response/stream ceiling |
| `DISCOVERY_INTERVAL_SECONDS` | 3600 | Refresh due model catalogs |
| `HEALTH_INTERVAL_SECONDS` | 60 | Background refresh/maintenance loop |
| `CIRCUIT_COOLDOWN_SECONDS` | 30 | Base failure cooldown; Retry-After can extend it |
| `HIGH_LATENCY_MS` | 15000 | Marks observed model latency degraded |
| `LOG_RETENTION_DAYS` | 30 | Request and audit metadata retention |
| `PRIVATE_UPSTREAM_HOSTS` | `[]` | Exact operator-allowlisted hosts permitted to resolve privately |
| `PORT` | 7860 | Container public port |
| `WEB_CONCURRENCY` | 1 | Uvicorn workers; use shared PostgreSQL and Redis for multiple workers |
| `MAX_CONCURRENCY` | 32 | Uvicorn connection/request concurrency ceiling |
| `TRUSTED_PROXY_IPS` | empty | Exact trusted proxy networks; never `*` on an exposed listener |
| `DATA_DIR` | `/data` | Embedded services data directory |
| `PERSISTENT_STORAGE_CONFIRMED` | absent | Required `true` for embedded production PostgreSQL |

Set integer, boolean and JSON-list values as strings in hosted environment settings. Do not put keys in the frontend environment or public build arguments. A rootless image is used; persistent mount directories must be writable by UID 1000.

### TLS and reverse proxies

The gateway expects TLS termination at the hosting platform or a trusted reverse proxy. For a VPS use `deploy/Caddyfile`, configure DNS, and set `ALLOWED_ORIGINS` and `COOKIE_SECURE=true`. Compose binds to localhost, appropriate for a reverse proxy on the host. If Caddy is in another container, change network wiring explicitly.

SSE requires unbuffered responses. Caddy’s example sets `flush_interval -1`. With nginx set `proxy_buffering off` and a suitable read timeout. Requests can span `(MAX_RETRIES + 1)` attempts; streaming also has a bounded stream phase. Size your outer proxy timeout accordingly.

Do not trust arbitrary X-Forwarded-For headers. If no trusted proxy configuration is supplied, authentication throttling groups clients under the actual connecting proxy address. Configure only the ingress networks you control. Authentication endpoints have a fixed ten-mutations-per-minute limit per connecting address.

### Platform files

- **Hugging Face:** root Dockerfile and README metadata; see main guide for persistence/networking.
- **Railway:** use `deploy/railway.json` as the service config, with external PostgreSQL/Redis URLs and the production secrets. Adapt standard `postgresql://` connection URLs to `postgresql+asyncpg://`.
- **Render:** `deploy/render.yaml` is a template; supply secure URLs/secrets and use the Docker runtime. It does not provision billable databases automatically.
- **Fly.io:** set a unique app name in `deploy/fly.toml`, supply secrets and external databases, then deploy from the repository root with `fly deploy --config deploy/fly.toml`.
- **VPS:** Docker Compose plus HTTPS reverse proxy, backups and restart policy.

These are deployment templates, not claims that accounts were provisioned or deployments completed. Provider credentials and hosting credentials are never embedded in the project.

## Secrets and isolation

Provider API keys and custom headers are encrypted together using authenticated Fernet encryption. User passwords use Argon2id. Gateway keys have 256 bits of random entropy and are only stored as SHA-256 hashes plus a short display prefix; database sessions are random hashed opaque tokens. The encryption key stays outside the database.

Every provider, model, key, usage, log and audit query is scoped to the authenticated user, including mutations. A leaked `gw_` key can call the inference API for that account but cannot manage providers through the dashboard API. Key revocation is checked against the database on every request.

The dashboard uses HttpOnly SameSite=Lax sessions and a separately supplied CSRF token for unsafe requests. Origin checks also protect login and registration. There are no provider keys, session bearer tokens or Gateway keys saved to browser localStorage. A freshly generated Gateway key exists in frontend memory only until dismissed. TLS and trusted device/browser security remain necessary.

Upstream errors, validation input values, credentials, prompts, completions and audio bodies are not recorded in application logs. Access logs are disabled in the container command. Error responses give a request ID and sanitized code. Registry metadata, custom connection names and user emails are still sensitive account information. Audit metadata is retained for the same configured period as request metadata.

## Custom endpoints and network safety

Upstream URLs must be HTTP(S), contain no credentials/query/fragment, and use HTTPS unless an exact host is operator-allowlisted. Hop-by-hop and forwarding headers are rejected. Redirects are never followed and ambient HTTP proxy variables are ignored for provider requests.

At **socket connection time**, a custom HTTPcore network backend resolves the hostname, rejects private/reserved addresses unless explicitly allowed, and connects directly to a validated IP. HTTPcore retains the original TLS SNI and validates the certificate. Mixed public/private DNS answers are rejected. The integration uses HTTPcore’s internal network backend hook; HTTPx/HTTPcore versions are constrained and transport tests must pass before upgrading them. Existing persistent connections remain pinned to their original destination.

For local Ollama/LM Studio, add only the intended hostname to `PRIVATE_UPSTREAM_HOSTS`, and use its OpenAI-compatible `/v1` URL. Reachability depends on your Docker network; `localhost` inside the container is not your laptop. The allowlist is an operator environment setting and cannot be changed through the dashboard. Consider an egress firewall as an additional network boundary.

## Backups

Back up **both the PostgreSQL database and ENCRYPTION_KEYS**. Losing encryption keys makes provider credentials unrecoverable; Gateway keys also cannot be reconstructed from stored hashes.

For Compose, a custom-format dump can be made locally:

```bash
docker compose exec -T postgres pg_dump -U gateway -d gateway -Fc > gateway.dump
```

Treat the dump as private even though provider credentials are encrypted. Retain it outside the application host. Redis holds rate/circuit/lease state; it can be rebuilt, but resetting it resets active limits and cooldowns.

For embedded PostgreSQL, execute `pg_dump` inside the running container against the Unix socket `/data/run` as database user `gateway`. Do not copy live PostgreSQL data files without a consistent database backup procedure. The included image does not install an automated off-host backup service.

Restore into a separate database first, set the matching `ENCRYPTION_KEYS`, run migrations, and verify that you can sign in and decrypt/test one connection. Test your restore workflow before relying on it. Do not overwrite a running production database as an unreviewed recovery step.

## Encryption-key rotation

1. Back up database and current keys.
2. Generate a new Fernet key. Configure `ENCRYPTION_KEYS=NEW_KEY,OLD_KEY` on all instances. New writes use the new key, old ciphertext remains readable.
3. Stop credential edits or use a maintenance window to avoid a rotation/edit race.
4. Run from the project root with the same production environment:

```bash
PYTHONPATH=backend python scripts/rotate_keys.py
```

5. Verify, restart all replicas, and only then remove the old key from the active list. Retain old keys securely with backups that need them.

Gateway keys rotate by issuing a replacement, updating the client and revoking the old key. The plaintext of saved Gateway keys is not recoverable.

## Migrations and scaling

Alembic runs before Uvicorn in the container entrypoint. PostgreSQL migration execution is serialized with an advisory lock. The initial migration is frozen source; future changes should be generated/reviewed as new revisions. Development-only table creation is not a substitute for production migration management.

Use external PostgreSQL and Redis for multiple app replicas. Embedded services are one-node deployments and do not provide replication or failover. A fixed Redis discovery lease avoids duplicate refreshes across workers. Rate counters use atomic Redis operations; an unavailable Redis fails request authorization closed instead of disabling limits.

The router reads registry candidates from PostgreSQL per request, with a per-user limit of fifty connections. This is suitable for an initial deployment, not an unbounded high-QPS promise. Large catalogs and concurrency should be profiled before capacity commitments. Bound connections at the edge and configure host resources. There are no paid synthetic health probes or automatic benchmark costs.

## Data accuracy and failure semantics

- Missing capability, price, token count or latency is **unknown**, not false, zero/free, or a successful measurement.
- Manually configured model metadata is preserved across discovery refreshes.
- Successful discovery marks disappeared non-manual models unavailable. Failed discovery retains the previous registry and shows a sanitized error.
- Model catalog visibility is not proof of account entitlement, quotas, inference health or tool support.
- Costs cover reported tokens on the returned attempt when both token prices are known. Failed attempts, media charges, caching discounts, taxes and upstream routing differences can make invoices differ.
- Mid-stream failures retain HTTP 200 because headers have already been committed, emit an SSE error and are recorded as failed in analytics.
- Automatic failover can cause multiple billable provider attempts. There is no idempotency guarantee across providers.
- Responses continuation is upstream-owned: use a connection-qualified model ID and do not assume IDs work across providers.
- The system has no password-reset email, email verification or administrator UI in v1. Use an invitation code/closed registration for controlled deployments. Account recovery requires an operator-controlled process.
