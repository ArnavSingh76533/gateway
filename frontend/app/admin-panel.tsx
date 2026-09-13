"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  RefreshCw,
  Plus,
  Users,
  Globe,
  Settings2,
} from "lucide-react";
import { api, loadAllModels, Model, money, User } from "@/lib/api";
import { SiteOptions } from "@/lib/site";
import { Badge, Banner, Modal, PageHeading } from "./ui";
import ModelPicker from "./model-picker";

type AdminSettings = SiteOptions & {
  registration_open: boolean;
  requests_per_minute: number;
  shared_requests_per_minute: number;
};
type Published = {
  id: string;
  name: string;
  model_id: string;
  provider_name: string;
  enabled: boolean;
  requests_per_minute: number;
  max_output_tokens: number;
  owned: boolean;
};
type Account = User & { disabled: boolean; created_at: number };
type Summary = {
  users: number;
  suspended_users: number;
  requests: number;
  published_models: number;
  sponsored_cost: number | null;
};

export default function AdminPanel({
  user,
  onSettings,
  onConnect,
  onRegisterModel,
  notify,
  revision = 0,
}: {
  user: User;
  onSettings: (settings: SiteOptions) => void;
  onConnect: () => void;
  onRegisterModel: () => void;
  notify: (message: string) => void;
  revision?: number;
}) {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [limits, setLimits] = useState({
    requests_per_minute: 60,
    max_retries: 2,
    registration_allowed: true,
  });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [published, setPublished] = useState<Published[]>([]);
  const [selected, setSelected] = useState<Model | null>(null);
  const [quota, setQuota] = useState(5);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [users, setUsers] = useState<Account[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [userRevision, setUserRevision] = useState(0);
  const [target, setTarget] = useState<Account | null>(null);
  const [confirmError, setConfirmError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [config, stats, shared, catalog] = await Promise.all([
        api<{ settings: AdminSettings; limits: typeof limits }>(
          "/admin/settings",
        ),
        api<Summary>("/admin/summary"),
        api<Published[]>("/admin/shared-models"),
        loadAllModels(undefined, true),
      ]);
      setSettings(config.settings);
      setLimits(config.limits);
      setSummary(stats);
      setPublished(shared);
      setModels(catalog);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, revision]);
  useEffect(() => {
    const pending = new AbortController();
    const timer = setTimeout(() => {
      void api<{ data: Account[]; total: number }>(
        `/admin/users?search=${encodeURIComponent(search)}&offset=${offset}`,
        { signal: pending.signal },
      )
        .then((page) => {
          if (!pending.signal.aborted) {
            setUsers(page.data);
            setTotalUsers(page.total);
          }
        })
        .catch((e: Error) => {
          if (!pending.signal.aborted) setError(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      pending.abort();
    };
  }, [search, offset, userRevision]);
  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api<AdminSettings>("/admin/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      onSettings(saved);
      notify("Site settings saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish(
    id: string,
    enabled: boolean,
    rpm = quota,
    tokens = maxTokens,
  ) {
    setBusy(true);
    setError("");
    try {
      await api(`/admin/shared-models/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          enabled,
          requests_per_minute: rpm,
          max_output_tokens: tokens,
        }),
      });
      notify(
        enabled
          ? "Model published for all signed-in users"
          : "Community model disabled",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeAccount() {
    if (!target) return;
    setBusy(true);
    setConfirmError("");
    try {
      await api(`/admin/users/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify({ disabled: !target.disabled }),
      });
      setTarget(null);
      setUserRevision((v) => v + 1);
      notify(target.disabled ? "Account restored" : "Account suspended");
      setSummary(await api<Summary>("/admin/summary"));
    } catch (e) {
      setConfirmError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function update<K extends keyof AdminSettings>(
    key: K,
    value: AdminSettings[K],
  ) {
    setSettings((current) =>
      current ? { ...current, [key]: value } : current,
    );
  }
  return (
    <>
      <PageHeading
        title="Administration"
        subtitle="Manage your site, users, and community models."
        action={
          <Badge tone="purple">
            <ShieldCheck size={14} />
            Administrator
          </Badge>
        }
      />
      <div className="admin-access-note">
        <ShieldCheck size={17} />
        <span>
          Signed in as {user.email}. Administrator roles are managed on the
          server.
        </span>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {loading && <p aria-live="polite">Loading administration…</p>}
      {summary && (
        <div className="admin-stats">
          <div className="panel">
            <span>Accounts</span>
            <strong>{summary.users}</strong>
            <small>{summary.suspended_users} suspended</small>
          </div>
          <div className="panel">
            <span>Gateway requests</span>
            <strong>{summary.requests}</strong>
            <small>Across all accounts</small>
          </div>
          <div className="panel">
            <span>Published models</span>
            <strong>{summary.published_models}</strong>
            <small>Only enabled publications</small>
          </div>
          <div className="panel">
            <span>Sponsored usage</span>
            <strong>{money(summary.sponsored_cost)}</strong>
            <small>Estimated upstream token cost</small>
          </div>
        </div>
      )}
      <div className="admin-grid">
        {settings && (
          <section className="panel admin-section">
            <div className="panel-heading">
              <h2>
                <Settings2 size={18} />
                Site and service settings
              </h2>
            </div>
            <form className="form admin-form" onSubmit={saveSettings}>
              <label>
                Site name
                <input
                  maxLength={40}
                  required
                  value={settings.site_name}
                  onChange={(e) => update("site_name", e.target.value)}
                />
              </label>
              <label>
                Tagline
                <input
                  maxLength={160}
                  required
                  value={settings.tagline}
                  onChange={(e) => update("tagline", e.target.value)}
                />
              </label>
              <label>
                Welcome text
                <textarea
                  maxLength={180}
                  required
                  value={settings.welcome_text}
                  onChange={(e) => update("welcome_text", e.target.value)}
                />
              </label>
              <label>
                Accent color
                <select
                  value={settings.accent}
                  onChange={(e) =>
                    update("accent", e.target.value as SiteOptions["accent"])
                  }
                >
                  <option value="purple">Purple</option>
                  <option value="blue">Blue</option>
                  <option value="green">Green</option>
                </select>
              </label>
              <label>
                Default routing
                <select
                  value={settings.default_mode}
                  onChange={(e) => update("default_mode", e.target.value)}
                >
                  {[
                    "auto",
                    "fastest",
                    "cheapest",
                    "reasoning",
                    "coding",
                    "vision",
                  ].map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Default retry budget
                <input
                  type="number"
                  min={0}
                  max={limits.max_retries}
                  required
                  value={settings.default_retries}
                  onChange={(e) =>
                    update("default_retries", Number(e.target.value))
                  }
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={settings.default_stream}
                  onChange={(e) => update("default_stream", e.target.checked)}
                />
                Stream responses by default
              </label>
              <label>
                Requests per minute per account
                <input
                  type="number"
                  min={1}
                  max={limits.requests_per_minute}
                  required
                  value={settings.requests_per_minute}
                  onChange={(e) =>
                    update("requests_per_minute", Number(e.target.value))
                  }
                />
              </label>
              <small className="form-note">
                Server maximum: {limits.requests_per_minute} requests/minute and{" "}
                {limits.max_retries} retries.
              </small>
              <label className="check-label">
                <input
                  type="checkbox"
                  disabled={!limits.registration_allowed}
                  checked={settings.registration_open}
                  onChange={(e) =>
                    update("registration_open", e.target.checked)
                  }
                />
                Allow new registrations
              </label>
              {!limits.registration_allowed && (
                <small>
                  Registration is closed in the server configuration.
                </small>
              )}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={settings.shared_models_enabled}
                  onChange={(e) =>
                    update("shared_models_enabled", e.target.checked)
                  }
                />
                Enable community models
              </label>
              <label>
                Community requests per minute across the whole site
                <input
                  type="number"
                  min={1}
                  max={10000}
                  required
                  value={settings.shared_requests_per_minute}
                  onChange={(e) =>
                    update("shared_requests_per_minute", Number(e.target.value))
                  }
                />
              </label>
              <button className="button primary" disabled={busy || loading}>
                Save site settings
              </button>
            </form>
          </section>
        )}
        <section className="panel admin-section">
          <div className="panel-heading">
            <h2>
              <Globe size={18} />
              Community models
            </h2>
          </div>
          <div className="form admin-form">
            <p>
              Publish a model from your own provider connection. Every signed-in
              user can use it free of charge through the Playground or their
              Gateway API key. You cover the upstream provider cost.
            </p>
            <div className="admin-setup-actions">
              <button className="button" onClick={onConnect}>
                <Plus size={15} />
                Connect provider
              </button>
              <button className="button" onClick={onRegisterModel}>
                Register your model
              </button>
            </div>
            <ModelPicker
              label="Community model"
              models={models}
              selected={selected}
              onSelect={setSelected}
              allowAuto={false}
              loading={loading}
              onRefresh={() => void load()}
              disabled={busy}
            />
            <label>
              Requests per minute per user
              <input
                type="number"
                min={1}
                max={120}
                value={quota}
                onChange={(e) => setQuota(Number(e.target.value))}
              />
            </label>
            <label>
              Maximum output tokens per request
              <input
                type="number"
                min={128}
                max={8192}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
              />
            </label>
            <button
              className="button primary"
              disabled={
                !selected ||
                busy ||
                quota < 1 ||
                quota > 120 ||
                maxTokens < 128 ||
                maxTokens > 8192
              }
              onClick={() => selected && void publish(selected.id, true)}
            >
              Publish free model
            </button>
            <p className="form-note">
              Only the selected model is shared. Provider credentials remain
              encrypted. Community routes support chat, enforce token and
              request limits, and stop accepting new requests when disabled.
            </p>
            <div className="published-models">
              {published.map((model) => (
                <div className="published-model" key={model.id}>
                  <div>
                    <strong>{model.name}</strong>
                    <small className="mono">{model.model_id}</small>
                    <small>
                      {model.requests_per_minute} requests/min/user ·{" "}
                      {model.max_output_tokens} output tokens
                    </small>
                  </div>
                  <Badge tone={model.enabled ? "green" : "neutral"}>
                    {model.enabled ? "Published" : "Disabled"}
                  </Badge>
                  <button
                    className="button"
                    disabled={busy || !model.owned}
                    onClick={() =>
                      void publish(
                        model.id,
                        !model.enabled,
                        model.requests_per_minute,
                        model.max_output_tokens,
                      )
                    }
                  >
                    {model.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              ))}
            </div>
            {!published.length && <p>No community models published yet.</p>}
          </div>
        </section>
      </div>
      <section className="panel admin-section admin-users">
        <div className="panel-heading">
          <h2>
            <Users size={18} />
            Accounts
          </h2>
          <button
            className="text-button"
            onClick={() => setUserRevision((v) => v + 1)}
          >
            <RefreshCw size={14} />
            Refresh accounts
          </button>
        </div>
        <div className="admin-form">
          <label className="search-field">
            <input
              aria-label="Search accounts by email"
              placeholder="Search accounts by email…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Role</th>
                <th>Status</th>
                <th>Access</th>
              </tr>
            </thead>
            <tbody>
              {users.map((account) => (
                <tr key={account.id}>
                  <td>
                    <strong>{account.name}</strong>
                    <br />
                    <small>{account.email}</small>
                  </td>
                  <td>{account.is_admin ? "Administrator" : "Member"}</td>
                  <td>{account.disabled ? "Suspended" : "Active"}</td>
                  <td>
                    {account.is_admin || account.id === user.id ? (
                      <span className="muted">Managed on server</span>
                    ) : (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setTarget(account);
                          setConfirmError("");
                        }}
                      >
                        {account.disabled
                          ? "Restore access"
                          : "Suspend account"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>{totalUsers} accounts</span>
          <button
            className="button"
            disabled={offset === 0}
            onClick={() => setOffset((v) => Math.max(0, v - 50))}
          >
            Previous
          </button>
          <button
            className="button"
            disabled={offset + 50 >= totalUsers}
            onClick={() => setOffset((v) => v + 50)}
          >
            Next
          </button>
        </div>
      </section>
      {target && (
        <Modal
          title={
            target.disabled ? "Restore account access?" : "Suspend account?"
          }
          onClose={() => {
            if (!busy) setTarget(null);
          }}
        >
          <div className="modal-body form">
            <p>{target.email}</p>
            <p>
              {target.disabled
                ? "This member will be able to sign in and use their existing API keys again."
                : "This ends the member's sessions and blocks new requests from their API keys. Their data is retained."}
            </p>
            {confirmError && <Banner tone="error">{confirmError}</Banner>}
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void changeAccount()}
            >
              {target.disabled ? "Restore account" : "Confirm suspension"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
