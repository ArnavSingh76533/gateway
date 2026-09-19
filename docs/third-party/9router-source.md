# Provider directory source

Provider names, URLs, and directory metadata were adapted from the MIT-licensed decolua/9router registry at commit 17c4cc76877bd1755030a8414f8d0083f48dcccf (2026-09-18). See 9router-LICENSE.txt.

Native Python adapters are implemented in this repository. Device authorization endpoint/client metadata, subscription transport behavior, and quota shapes were referenced from `src/lib/oauth/providers`, `open-sse/providers/registry`, `open-sse/executors`, and `open-sse/services/usage` at that revision. Native account linking requires no separate 9router instance. Unsupported desktop/cookie/specialist protocols are marked unavailable.

Codex device authorization was independently implemented against the protocol in the upstream OpenAI Codex `codex-rs/login/src/device_code_auth.rs` (consulted 2026-09-19), alongside official authentication documentation. No Codex runtime or source implementation is bundled. Kimi and Kilo public protocol documentation was also consulted. Public client identifiers are protocol metadata, not private client secrets.

Directory presence does not assert live authenticated inference testing, provider endorsement, or account access. Do not remove the included 9router MIT notice when redistributing the adapted metadata.
