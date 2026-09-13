# Administration and community models

Open `https://YOUR-GATEWAY/#admin` and sign in with an existing administrator account. There is no separate admin password, default account, or public role-grant endpoint. Ordinary members receive HTTP 403 from every administration API, even if they open the URL directly. Session mutations also require the same-origin CSRF token.

## Activate an administrator

Deploy this version first. The container runs the database migration automatically before starting the application. Keep the existing encryption keys and database; changing encryption keys without rotation makes existing provider credentials unreadable.

From the running gateway container:

```sh
docker exec YOUR_CONTAINER python scripts/admin.py grant --email owner@example.com
docker exec YOUR_CONTAINER python scripts/admin.py list
```

For a non-container installation, run `python scripts/admin.py grant --email owner@example.com` from the repository root using the application's Python environment and database configuration, after `python -m alembic -c backend/alembic.ini upgrade head`.

For Hugging Face Spaces without a container terminal, add a Space **Secret** named `ADMIN_BOOTSTRAP_EMAIL` containing the exact email of an **already registered** account, then restart the updated Space. The startup supervisor grants that account's role after migrating. With persistent database storage, remove this secret after the first successful activation; the role persists in the database. Leaving it set would grant the role again on later restarts. A suspended account is never restored automatically. An unknown account requires the explicit password-hash seed described below; otherwise startup stops without creating it. Remove the secret to recover from a typo.

### Fresh database after an approved reset

Set two private Space secrets before starting the updated application:

- `ADMIN_BOOTSTRAP_EMAIL`: the exact administrator email.
- `ADMIN_BOOTSTRAP_PASSWORD_HASH`: an Argon2id hash of your chosen password, generated locally. No plaintext password or default password is placed in the repository.

Generate a hash in your gateway Python environment with:

```sh
python -c "from argon2 import PasswordHasher; from getpass import getpass; print(PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2).hash(getpass('Admin password: ')))"
```

Copy only the generated hash into the private secret. On an empty database, startup creates that one administrator before accepting public requests. On an existing database, it keeps the account's password and data. The web worker does not inherit these bootstrap secrets. The equivalent server command is `python scripts/admin.py bootstrap --email owner@example.com` with the hash environment variable set.

On ephemeral storage, keep both secrets if you want this admin login recreated after later resets. This does **not** preserve provider connections, other users, site settings, published models, or request history. Use durable PostgreSQL to retain those. Once durable storage is configured, remove both bootstrap secrets so later role revocation cannot be undone by a restart.

Refresh the gateway after activation. **Administration** appears in the sidebar. Use the account's existing password. Public signup ignores client-supplied role fields and never promotes users.

To revoke access, first remove any bootstrap secret, then run:

```sh
docker exec YOUR_CONTAINER python scripts/admin.py revoke --email owner@example.com
```

Role checks read the database on every request. Revoking an administrator also makes their published models unavailable to other users. Restore another administrator through the server command if needed; administrator accounts cannot be suspended from the web panel.

## What the panel controls

- Site name, tagline, welcome text and purple/blue/green accent.
- Default Playground routing, streaming and retry budget. Existing Playground sessions retain their settings; reopening Playground uses updated defaults.
- New registrations, account request rate, community request rate across the site, and a community-model enable switch. Server environment limits remain the upper bounds.
- Search accounts, suspend members and restore access. Suspension deletes active sessions and blocks existing API keys. Restoring an account re-enables unexpired, unrevoked keys.
- Publish selected models from the administrator's own provider connections; enable or disable each publication. Change its quota by selecting that model, entering new limits, and publishing again.

Private provider credentials, other users' keys, password hashes, prompts and responses are not exposed in the administration panel. Changes create audit records. This is service administration, not arbitrary server command execution or a source-code editor.

## Publish your own free model

1. Open **Administration → Community models → Connect provider**.
2. Select a compatible provider or **Custom OpenAI-compatible** and enter the model server's API base URL (usually ending in `/v1`) and credential. For Ollama/LM Studio on a private network, the server operator must explicitly allow its exact hostname with `PRIVATE_UPSTREAM_HOSTS`; public users cannot change this setting.
3. Let discovery finish. If your server does not list models, choose **Register your model**, select the new connection, enter the exact model ID, and confirm Chat capability plus any capabilities the server actually supports. Configure real input/output prices when known so sponsored cost estimates can be calculated.
4. Choose that model in the admin picker, set requests per minute per member and the maximum output tokens, then **Publish free model**.
5. Members can find it under **Playground → Select model → Free only** or **Model explorer → Free only**. The catalog includes every page and supports model name, ID and provider search. Published models also appear in each member's authenticated `/v1/models` list and can be used with their own Gateway API key.

The gateway keeps the provider credential encrypted on the server and injects it only when contacting that provider. Publishing one model does not publish the provider's other models or grant members permission to edit that connection. Members' published-model requests show zero estimated cost; the actual estimated upstream cost is recorded as sponsored usage for administrators. The model sponsor remains responsible for provider charges and server capacity.

Community access requires a gateway account. It supports chat completions and chat streaming, including the chat-compatible messages adapter. It does not expose shared embeddings, images, audio or stateful Responses routes. Shared requests enforce the configured per-user/per-model and site-wide rates, one completion per request, output token limits, and a 64,000-character serialized request limit. Provider rate limits still apply. Disabling the publication, its provider, the community switch, or the owner's admin role blocks new shared requests; in-flight requests may finish.

## Deployment and verification

Deploy the complete repository, including `backend/alembic`, `scripts`, `deploy` and the frontend. The Dockerfile builds the static frontend; `deploy/start.py` applies migration `a481c6e724df` and starts the app. Do not copy only the frontend because admin authorization and community routing depend on the backend changes.

Use persistent storage or managed PostgreSQL for account and role durability. After rebuilding, verify `/health/ready`, sign in, open `/#admin`, save one setting, and check a published model using a separate member account. Never store provider keys or passwords in GitHub source files.

A manual GitHub workflow, **Deploy gateway Space**, can upload the full application while preserving the Hugging Face README metadata. Configure a Space trusted publisher for GitHub repository `ArnavSingh76533/gateway`, branch `main`, workflow `deploy-space.yml`; the workflow uses short-lived credentials restricted to that Space. It runs only when explicitly dispatched with the storage acknowledgement checked. Review CI first. The current free Space had no mounted storage or external database at implementation time, so do not rebuild it until its existing data has been backed up or you have explicitly accepted resetting it. See [Hugging Face storage](https://huggingface.co/docs/hub/spaces-storage) and [trusted publishers](https://huggingface.co/docs/hub/trusted-publishers).
