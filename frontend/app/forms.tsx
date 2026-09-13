"use client";
import { FormEvent, useState } from "react";
import {
  ArrowRight,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  LoaderCircle,
} from "lucide-react";
import { api, User, Provider, Model, providerInfo } from "@/lib/api";
import { Banner, CheckRow, Modal } from "./ui";
import { defaultSite, SiteOptions } from "@/lib/site";

export function AuthForm({
  onClose,
  onSuccess,
  site = defaultSite,
}: {
  onClose: () => void;
  onSuccess: (user: User, key?: string) => void;
  site?: SiteOptions;
}) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const result = await api<{ user: User; gateway_key?: string }>(
        register ? "/auth/register" : "/auth/login",
        { method: "POST", body: JSON.stringify(Object.fromEntries(form)) },
      );
      onSuccess(result.user, result.gateway_key);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={register ? "Create your workspace" : "Welcome back"}
      onClose={onClose}
      wide
    >
      <div className="auth-layout">
        <div className="auth-aside">
          <div className="brand-mark large">
            {site.site_name.slice(0, 1).toUpperCase()}
          </div>
          <h2>{site.welcome_text}</h2>
          <p>Bring your providers together in a workspace you control.</p>
          <div className="auth-checks">
            <CheckRow>Encrypted provider credentials</CheckRow>
            <CheckRow>Automatic routing & fallback</CheckRow>
            <CheckRow>OpenAI-compatible API</CheckRow>
          </div>
          <div className="lock-caption">
            <ShieldCheck size={18} />
            Self-hosted. Privately connected.
          </div>
        </div>
        <form
          onSubmit={submit}
          className="form auth-form"
          onInvalid={(e) => {
            const input = e.target as HTMLInputElement;
            setFieldErrors((prev) => ({
              ...prev,
              [input.name]: input.validationMessage,
            }));
          }}
          onInput={(e) => {
            const input = e.target as HTMLInputElement;
            setFieldErrors((prev) => ({ ...prev, [input.name]: "" }));
          }}
        >
          <p className="muted">
            {register
              ? "Connect your first provider after creating an account."
              : "Sign in to manage your gateway."}
          </p>
          {register && (
            <label>
              Your name
              <input
                name="name"
                aria-invalid={!!fieldErrors.name}
                aria-describedby={
                  fieldErrors.name ? "auth-name-error" : undefined
                }
                required
                maxLength={80}
                autoComplete="name"
                placeholder="Alex Morgan"
              />
              {fieldErrors.name && (
                <small className="field-error" id="auth-name-error">
                  {fieldErrors.name}
                </small>
              )}
            </label>
          )}
          <label>
            Email address
            <input
              type="email"
              name="email"
              aria-invalid={!!fieldErrors.email}
              aria-describedby={
                fieldErrors.email ? "auth-email-error" : undefined
              }
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
            {fieldErrors.email && (
              <small className="field-error" id="auth-email-error">
                {fieldErrors.email}
              </small>
            )}
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              aria-invalid={!!fieldErrors.password}
              aria-describedby={
                fieldErrors.password ? "auth-password-error" : undefined
              }
              minLength={12}
              maxLength={128}
              required
              autoComplete={register ? "new-password" : "current-password"}
              placeholder={
                register ? "At least 12 characters" : "Your password"
              }
            />
            {fieldErrors.password && (
              <small className="field-error" id="auth-password-error">
                {fieldErrors.password}
              </small>
            )}
          </label>
          {register && (
            <label>
              Invitation code <span className="muted">(if required)</span>
              <input
                name="registration_code"
                autoComplete="off"
                placeholder="Provided by your gateway administrator"
              />
            </label>
          )}
          {error && <Banner tone="error">{error}</Banner>}
          <button
            className="button primary full"
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <ArrowRight size={17} />
            )}{" "}
            {register ? "Create workspace" : "Sign in"}
          </button>
          <button
            type="button"
            className="text-button auth-alternate"
            onClick={() => {
              setRegister(!register);
              setError("");
              setFieldErrors({});
            }}
          >
            {register
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
          <p className="form-note">
            <LockKeyhole size={14} />
            Provider keys stay encrypted on your server.
          </p>
        </form>
      </div>
    </Modal>
  );
}
export function ProviderForm({
  provider,
  onClose,
  onSaved,
}: {
  provider?: Provider;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState(provider?.kind || "openrouter"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [headersError, setHeadersError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setHeadersError("");
    const f = new FormData(e.currentTarget);
    try {
      const raw = String(f.get("headers") || "").trim();
      let headers: Record<string, string> | undefined;
      try {
        headers = raw ? JSON.parse(raw) : undefined;
        if (
          raw &&
          (!headers ||
            Array.isArray(headers) ||
            typeof headers !== "object" ||
            Object.values(headers).some((value) => typeof value !== "string"))
        )
          throw new Error();
      } catch {
        setHeadersError(
          'Enter a JSON object with text values, for example {"X-Organization":"your-org"}.',
        );
        return;
      }
      const body: Record<string, unknown> = {
        name: f.get("name"),
        priority: Number(f.get("priority")),
      };
      if (String(f.get("api_key") || "")) body.api_key = f.get("api_key");
      if (headers) body.headers = headers;
      if (!provider) {
        body.kind = kind;
        body.base_url = f.get("base_url") || null;
        body.headers = headers || {};
      }
      await api(provider ? `/providers/${provider.id}` : "/providers", {
        method: provider ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={provider ? "Edit provider connection" : "Connect a provider"}
      onClose={onClose}
    >
      <form className="form modal-body" onSubmit={submit}>
        <p className="muted">
          Use your own provider account. Your API key and custom headers are
          encrypted and never returned.
        </p>
        {!provider && (
          <label>
            Provider
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(providerInfo).map(([k, p]) => (
                <option key={k} value={k}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Connection name
          <input
            name="name"
            key={kind}
            defaultValue={provider?.name || providerInfo[kind].name}
            required
            maxLength={80}
          />
        </label>
        <label>
          {provider ? "Replace API key (optional)" : "Provider API key"}
          <input
            type="password"
            name="api_key"
            placeholder={
              provider
                ? "Leave empty to keep saved key"
                : "Paste your provider key"
            }
            autoComplete="off"
            required={!provider && kind !== "custom"}
          />
        </label>
        {!provider && (
          <label>
            Base URL
            <input
              name="base_url"
              type="url"
              key={kind + "url"}
              defaultValue={providerInfo[kind].url}
              placeholder="https://your-endpoint.com/v1"
              required={kind === "custom"}
            />
          </label>
        )}
        <label>
          Priority <span className="muted">— lower numbers are preferred</span>
          <input
            type="number"
            name="priority"
            min={0}
            max={1000}
            defaultValue={provider?.priority ?? 10}
            required
          />
        </label>
        <details>
          <summary>Advanced · custom headers</summary>
          <label>
            Headers as JSON
            <textarea
              name="headers"
              aria-invalid={!!headersError}
              aria-describedby={headersError ? "headers-error" : undefined}
              onChange={() => setHeadersError("")}
              rows={3}
              placeholder={'{"X-Organization": "your-org"}'}
            />
            {headersError && (
              <small className="field-error" id="headers-error">
                {headersError}
              </small>
            )}
          </label>
          <p className="form-note">
            {provider
              ? "Omit to keep existing headers; enter {} to clear. "
              : " "}
            Custom authorization headers override Bearer authentication.
          </p>
        </details>
        {error && <Banner tone="error">{error}</Banner>}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy} aria-busy={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <KeyRound size={16} />
            )}{" "}
            {busy
              ? "Connecting & discovering…"
              : provider
                ? "Save connection"
                : "Connect provider"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
const caps = [
  "chat",
  "tools",
  "vision",
  "audio",
  "json_mode",
  "streaming",
  "reasoning",
  "coding",
  "embeddings",
  "images",
  "transcription",
  "speech",
  "responses",
];
export function ModelForm({
  model,
  providers,
  onClose,
  onSaved,
}: {
  model?: Model;
  providers: Provider[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget),
      capabilities: Record<string, boolean | null> = {};
    caps.forEach((c) => {
      const v = f.get(c);
      capabilities[c] = v === "unknown" ? null : v === "true";
    });
    try {
      await api(`/providers/${f.get("provider")}/models`, {
        method: "PUT",
        body: JSON.stringify({
          model_id: f.get("model_id"),
          name: f.get("name") || null,
          context_window: f.get("context_window")
            ? Number(f.get("context_window"))
            : null,
          input_price: f.get("input_price")
            ? Number(f.get("input_price"))
            : null,
          output_price: f.get("output_price")
            ? Number(f.get("output_price"))
            : null,
          capabilities,
        }),
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={model ? "Configure model metadata" : "Register a model"}
      onClose={onClose}
      wide
    >
      <form className="form modal-body" onSubmit={submit}>
        <Banner>
          Only mark a capability as supported when you have confirmed it. Owner
          settings override automatic discovery.
        </Banner>
        <div className="form-grid">
          <label>
            Connection
            <select name="provider" defaultValue={model?.provider_id} required>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Native model ID
            <input
              name="model_id"
              defaultValue={model?.model_id}
              required
              readOnly={!!model}
              maxLength={512}
            />
          </label>
          <label>
            Display name
            <input name="name" defaultValue={model?.name} />
          </label>
          <label>
            Context window (tokens)
            <input
              type="number"
              min={1}
              name="context_window"
              defaultValue={model?.context_window || ""}
            />
          </label>
          <label>
            Input price / 1M tokens (USD)
            <input
              type="number"
              min={0}
              step="any"
              name="input_price"
              defaultValue={model?.input_price ?? ""}
              placeholder="Unknown"
            />
          </label>
          <label>
            Output price / 1M tokens (USD)
            <input
              type="number"
              min={0}
              step="any"
              name="output_price"
              defaultValue={model?.output_price ?? ""}
              placeholder="Unknown"
            />
          </label>
        </div>
        <div className="capability-grid">
          {caps.map((c) => (
            <label key={c}>
              {c.replaceAll("_", " ")}
              <select
                name={c}
                defaultValue={
                  model?.capabilities[c] == null
                    ? "unknown"
                    : String(model.capabilities[c])
                }
              >
                <option value="unknown">Unknown</option>
                <option value="true">Supported</option>
                <option value="false">Unsupported</option>
              </select>
            </label>
          ))}
        </div>
        {error && <Banner tone="error">{error}</Banner>}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy} aria-busy={busy}>
            {busy && <LoaderCircle className="spin" size={16} />} Save model
          </button>
        </div>
      </form>
    </Modal>
  );
}
