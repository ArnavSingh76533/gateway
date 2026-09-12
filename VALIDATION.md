# Delivery validation

Prepared 12 September 2026.

## Passed in this environment

| Check | Result |
|---|---|
| Backend automated tests | **56 passed** |
| Backend lint | Ruff: all checks passed |
| Backend typing | Mypy: no issues in 23 source files |
| Frontend production build | Next.js 16.3.5 build and TypeScript check passed |
| Node SDK build | TypeScript declaration and JavaScript build passed |
| Official Python OpenAI SDK | Model listing, non-streaming chat and streaming exercised against the gateway |
| Anthropic Messages bridge | Text, tool conversion, SSE, unsupported thinking rejection and disclosed token estimate tested |
| SQLite migration | Alembic upgrade succeeded; schema check reported no pending differences |
| Dashboard HTTP smoke | FastAPI served the compiled dashboard and its referenced static assets successfully |
| API documentation | OpenAPI schema generated at `docs/openapi.json` with authentication schemes |
| Deployment configuration syntax | Compose, Render and CI YAML parsed successfully |

Tests use HTTPx ASGI/Mock transports, temporary SQLite databases, generated test secrets and fixture provider responses. No real credentials or production traffic were used.

Security tests cover user isolation, credential encryption, no credential readback, revocation, Origin/CSRF checks, error redaction, request-size caps, private/mixed DNS rejection, forbidden headers, key rotation and concurrent development rate limiting. Routing tests cover retryable status codes, exact model matching, provider pins, alternative-model opt-in, fastest/cheapest selection, skipped unhealthy candidates, JSON/tools/vision passthrough, streamed usage, pre-output fallback, post-output failure without retry and upstream stream closure.

## Not executed here

- **Docker image build or container boot:** no Docker runtime is available in this environment. A CI job is included to build the image and smoke-test its rootless embedded PostgreSQL/Redis setup.
- **Live PostgreSQL/Redis integration:** tests ran against SQLite and the development state backend; Redis atomic operations and PostgreSQL schema/migration code are included but not service-tested here.
- **Live provider inference/discovery:** no user provider credentials were supplied. Provider wire formats are implemented from primary documentation and tested with fixtures; account access, quotas, current native model IDs and provider-specific parameter limitations still need live confirmation.
- **Hugging Face/Railway/Render/Fly deployment:** no hosting account was provisioned or deployed. Configuration and instructions are supplied.
- **Browser/device visual or interaction testing:** frontend production compilation and HTTP asset checks passed, but no browser-level screenshots, accessibility audit or cross-device session was run.
- **Independent security audit, load/soak test, failover/recovery drill, or live certification of every named agent.**

This report distinguishes implemented code from verified runtime behavior. Treat the project as a production-oriented initial release; validate live credentials, Docker startup, persistence and backups on your target before relying on it for unattended workloads.

## Included build outputs

`frontend/out` is included so the read-only demo can be served immediately. `sdk/node/dist` is included with the SDK source. Runtime dependencies, environment secrets, virtual environments, databases, node_modules, caches and local build intermediates are excluded from the archive. Rebuilds are described in README.md.
