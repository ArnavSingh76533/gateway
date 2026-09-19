# Delivery validation

Updated 19 September 2026 for native account connections and model preferences.

## Current local checks

| Check | Result |
| --- | --- |
| Backend automated tests | **98 passed** |
| Frontend automated tests | **64 passed** |
| Backend lint and typing | Ruff passes; mypy reports no issues in 35 source files |
| Production frontend | Next.js build and TypeScript check pass |
| SQLite migration | Upgrade to `c3101d` succeeds |
| Native authorization initiation | Copilot, Codex, Kimi, Kilo, and Grok Build public initiation endpoints each returned HTTP 200 |
| Chrome interaction | Searched a 1,205-model catalog, found its last free model, added/reordered preferences, saved the restriction, and streamed an automatic request through preferred model 1 |
| UI review | Corrected search and checkbox alignment in the preferences editor; retained the existing landing design |

Tests cover authorization session/user binding, CSRF, expiry, cancellation, polling backoff, idempotent completion, encrypted credential storage, serialized refresh rotation, preference fallback and exact-route behavior, streaming/tool translation, malformed upstream responses, stream closure, quota units and unknown values. Existing tenancy, routing, credentials, administration and shared-model tests also pass.

## Scope of the evidence

Local browser inference and automated authorization exchanges use controlled upstream fixtures. The five real provider checks only initiated authorization: no subscription account was authorized and no paid inference was performed. Live authenticated inference, discovery, and quotas for every subscription still require testing with eligible provider accounts. Public client protocols and account access can change independently of this gateway.

No local Docker runtime is available. GitHub CI builds the image, starts embedded PostgreSQL/Redis, applies migrations and verifies administrator activation. Its result is reported in the pull request checks.

Earlier gateway releases were deployed to Hugging Face. The native-connections release is deployed separately from merging code. The current Space uses ephemeral PostgreSQL; its manual workflow requires a backup or explicit acceptance of losing the current data before deployment. The seeded administrator can be recreated, but that does not preserve other users, provider credentials or history.

The directory marks unimplemented account protocols unavailable. This is not complete 9router parity or provider certification. No independent security audit, load/soak test, or failover/recovery drill is claimed.
