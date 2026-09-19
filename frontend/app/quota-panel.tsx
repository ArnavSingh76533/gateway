"use client";
import { useCallback, useEffect, useState } from "react";
import { Clock, Gauge, RefreshCw } from "lucide-react";
import { api, num } from "@/lib/api";
import { Banner, Empty, PageHeading, ProviderIcon, Skeleton } from "./ui";

export type Quota = {
  provider_id: string;
  provider_name: string;
  kind: string;
  enabled: boolean;
  model: string | null;
  observed_at: number | null;
  retry_at: number | null;
  status: string;
  windows: {
    resource: string;
    limit: number | null;
    remaining: number | null;
    reset_at: number | null;
    observed_at: number;
    source?: string;
  }[];
  balance: {
    label: string;
    unit?: string;
    remaining?: number | null;
    used?: number | null;
    limit?: number | null;
    reset_schedule?: string | null;
    observed_at: number;
    balances?: { unit: string; remaining: number | null }[];
  } | null;
  can_refresh: boolean;
  gateway_usage_24h: {
    requests: number;
    input_tokens: number | null;
    output_tokens: number | null;
  };
};
export function resetLabel(reset: number | null, now: number): string {
  if (!reset) return "Reset time not reported";
  const seconds = Math.ceil(reset - now);
  if (seconds <= 0) return "Reset time passed · awaiting update";
  const minutes = Math.floor(seconds / 60),
    hours = Math.floor(minutes / 60);
  return `Resets in ${hours ? `${hours}h ${minutes % 60}m` : minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`}`;
}
const observed = (at: number) => new Date(at * 1000).toLocaleString();

export default function QuotaPanel({
  demo,
  onSignIn,
}: {
  demo: boolean;
  onSignIn: () => void;
}) {
  const [rows, setRows] = useState<Quota[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [now, setNow] = useState(Date.now() / 1000),
    [offset, setOffset] = useState(0),
    [refreshing, setRefreshing] = useState("");
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (demo) {
        setLoading(false);
        return;
      }
      try {
        const data = await api<{ data: Quota[]; server_time: number }>(
          "/quotas",
          { signal },
        );
        setRows(data.data);
        setOffset(data.server_time - Date.now() / 1000);
        setError("");
      } catch (e) {
        if (!signal?.aborted) setError((e as Error).message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [demo],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const poll = setInterval(() => void load(controller.signal), 30000);
    return () => {
      controller.abort();
      clearInterval(poll);
    };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000 + offset), 1000);
    return () => clearInterval(timer);
  }, [offset]);
  async function refresh(row: Quota) {
    setRefreshing(row.provider_id);
    setError("");
    try {
      await api(`/providers/${row.provider_id}/quota-refresh`, {
        method: "POST",
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing("");
    }
  }
  return (
    <>
      <PageHeading
        title="Tokens & limits"
        subtitle="Provider-reported limits, credit balances, and the next reported reset."
        action={
          <button
            className="button"
            onClick={() => void load()}
            disabled={demo || loading}
          >
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />
      <div className="info-row">
        <Gauge size={18} />
        <span>
          Token limits are usually a rate window, not a lifetime balance. Limits
          can vary by model or account.
        </span>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {demo ? (
        <Empty
          title="Your limits, without the guesswork"
          text="Sign in and connect a provider to see reported token limits and resets. OpenRouter and DeepSeek also support balance checks. Providers that do not report a limit remain unknown."
          action="Sign in"
          onAction={onSignIn}
        />
      ) : loading ? (
        <Skeleton className="skeleton-chart" />
      ) : !rows.length ? (
        <Empty
          title="Connect your first provider"
          text="Limits appear here after a provider reports them on a request. You can refresh supported credit balances without generating tokens."
          action="Find providers"
          onAction={() => {
            window.location.hash = "providers";
          }}
        />
      ) : (
        <div className="quota-grid">
          {rows.map((row) => (
            <section className="panel quota-card" key={row.provider_id}>
              <div className="quota-heading">
                <ProviderIcon kind={row.kind} />
                <div>
                  <h2>{row.provider_name}</h2>
                  <small className="muted">
                    {row.enabled ? "Connected" : "Disabled"}
                    {row.model ? ` · Last model: ${row.model}` : ""}
                  </small>
                </div>
              </div>
              {row.retry_at != null && row.retry_at > now && (
                <p className="quota-cooldown">
                  <Clock size={15} /> Connection cooling down ·{" "}
                  {resetLabel(row.retry_at, now).replace("Resets", "Retry")}
                </p>
              )}
              {row.windows.length ? (
                row.windows.map((window) => {
                  const expired =
                    window.reset_at != null && window.reset_at <= now;
                  return (
                    <div className="quota-window" key={window.resource}>
                      <div className="quota-resource">
                        <strong>{window.resource.replaceAll("-", " ")}</strong>
                        <small>
                          {expired
                            ? "Previous window"
                            : "Last reported remaining"}
                        </small>
                      </div>
                      <div className="quota-value">
                        {expired ? "Awaiting update" : num(window.remaining)}
                        <span>
                          {window.limit != null && !expired
                            ? ` / ${num(window.limit)}`
                            : ""}
                        </span>
                      </div>
                      {!expired &&
                        window.limit != null &&
                        window.limit > 0 &&
                        window.remaining != null && (
                          <meter
                            min={0}
                            max={window.limit}
                            value={Math.min(window.limit, window.remaining)}
                            aria-label={`${window.resource} remaining`}
                          />
                        )}
                      <div className="quota-reset">
                        <Clock size={13} />
                        {resetLabel(window.reset_at, now)}
                      </div>
                      <small className="muted">
                        {window.source === "provider_api"
                          ? "Provider API"
                          : "Response headers"}{" "}
                        · {observed(window.observed_at)}
                      </small>
                    </div>
                  );
                })
              ) : (
                <div className="quota-unknown">
                  <strong>Token balance unknown</strong>
                  <p>
                    No token limit has been reported. Limits update from
                    supported response headers as you use this connection.
                  </p>
                </div>
              )}
              {row.balance && (
                <div className="quota-balance">
                  <div className="quota-resource">
                    <strong>{row.balance.label}</strong>
                    <small>Money, not tokens</small>
                  </div>
                  {(
                    row.balance.balances || [
                      {
                        unit: row.balance.unit || "USD",
                        remaining: row.balance.remaining ?? null,
                      },
                    ]
                  ).map((b) => (
                    <div className="quota-value" key={b.unit}>
                      {b.remaining == null
                        ? "Not reported"
                        : new Intl.NumberFormat("en", {
                            style: "currency",
                            currency: b.unit,
                          }).format(b.remaining)}
                      <span>{b.remaining == null ? "" : " remaining"}</span>
                    </div>
                  ))}
                  {row.balance.reset_schedule && (
                    <p className="muted">
                      Reset schedule: {row.balance.reset_schedule} · exact time
                      not reported
                    </p>
                  )}
                  <small className="muted">
                    Provider API · {observed(row.balance.observed_at)}
                  </small>
                </div>
              )}
              {row.can_refresh && (
                <button
                  className="button small"
                  onClick={() => void refresh(row)}
                  disabled={!!refreshing}
                >
                  <RefreshCw
                    size={14}
                    className={refreshing === row.provider_id ? "spin" : ""}
                  />
                  {refreshing === row.provider_id
                    ? "Checking…"
                    : ["codex", "github", "kimi"].includes(row.kind)
                      ? "Check account limits"
                      : "Check credit balance"}
                </button>
              )}
              <div className="quota-usage">
                <span>Recorded here · last 24 hours</span>
                <div>
                  <strong>{num(row.gateway_usage_24h.requests)}</strong>{" "}
                  requests{" "}
                  <strong>{num(row.gateway_usage_24h.input_tokens)}</strong>{" "}
                  input{" "}
                  <strong>{num(row.gateway_usage_24h.output_tokens)}</strong>{" "}
                  output tokens
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
      <p className="form-note quota-footnote">
        Usage includes requests through this gateway only; providers may omit
        token counts. Snapshots are observations, not a guarantee of available
        capacity. A passed reset time waits for the next provider response
        instead of assuming your quota refilled.
      </p>
    </>
  );
}
