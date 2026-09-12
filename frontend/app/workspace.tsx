"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Box,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  Code2,
  Copy,
  ExternalLink,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Network,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Star,
  Terminal,
  Trash2,
  TriangleAlert,
  Waypoints,
  X,
  Zap,
} from "lucide-react";
import {
  api,
  ApiError,
  csrf,
  GatewayKey,
  Log,
  Model,
  Page,
  Provider,
  providerInfo,
  Usage,
  User,
  num,
  money,
  stamp,
} from "@/lib/api";
import {
  demoProviders,
  demoModels,
  demoUsage,
  demoLogs,
  demoKeys,
} from "@/lib/demo";
import { AuthForm, ProviderForm, ModelForm } from "./forms";
import {
  Badge,
  Banner,
  CopyButton,
  Empty,
  Modal,
  Price,
  ProviderChart,
  ProviderIcon,
  Topology,
  TrafficChart,
} from "./ui";

type View =
  | "overview"
  | "providers"
  | "models"
  | "playground"
  | "keys"
  | "requests"
  | "usage"
  | "docs";
const nav: { id: View; name: string; icon: typeof Activity }[] = [
  { id: "overview", name: "Overview", icon: LayoutDashboard },
  { id: "providers", name: "Providers", icon: Waypoints },
  { id: "models", name: "Model explorer", icon: Layers3 },
  { id: "playground", name: "Playground", icon: Terminal },
  { id: "keys", name: "API keys", icon: KeyRound },
  { id: "requests", name: "Request logs", icon: Activity },
  { id: "usage", name: "Usage & analytics", icon: ChartNoAxesCombined },
  { id: "docs", name: "Documentation", icon: BookOpen },
];
const blankUsage: Usage = {
  days: 7,
  summary: {
    requests: 0,
    successes: 0,
    avg_latency_ms: null,
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost: null,
    priced_requests: 0,
  },
  series: [],
  providers: [],
};
const modes = [
  "auto",
  "fastest",
  "cheapest",
  "reasoning",
  "coding",
  "vision",
  "image",
  "embedding",
  "manual",
];

export default function Dashboard() {
  const [view, setView] = useState<View>("overview"),
    [user, setUser] = useState<User | null>(null),
    [demo, setDemo] = useState(true),
    [ready, setReady] = useState(false),
    [mobile, setMobile] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]),
    [models, setModels] = useState<Model[]>([]),
    [keys, setKeys] = useState<GatewayKey[]>([]),
    [logs, setLogs] = useState<Log[]>([]),
    [usage, setUsage] = useState<Usage>(blankUsage),
    [totalModels, setTotalModels] = useState(0),
    [totalLogs, setTotalLogs] = useState(0);
  const [days, setDays] = useState(7),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [connectionError, setConnectionError] = useState("");
  const [authOpen, setAuthOpen] = useState(false),
    [providerModal, setProviderModal] = useState<Provider | "new" | null>(null),
    [modelModal, setModelModal] = useState<Model | "new" | null>(null),
    [keyModal, setKeyModal] = useState(false),
    [secret, setSecret] = useState(""),
    [selectedLog, setSelectedLog] = useState<Log | null>(null),
    [confirm, setConfirm] = useState<{
      title: string;
      text: string;
      action: () => Promise<void>;
    } | null>(null);
  const [search, setSearch] = useState(""),
    [capability, setCapability] = useState(""),
    [filterProvider, setFilterProvider] = useState(""),
    [modelPage, setModelPage] = useState(0),
    [logPage, setLogPage] = useState(0),
    [errorsOnly, setErrorsOnly] = useState(false);
  const [endpoint, setEndpoint] = useState("https://your-gateway.example/v1");
  const notify = useCallback((s: string) => setToast(s), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    setEndpoint(window.location.origin + "/v1");
    const hash = window.location.hash.slice(1) as View;
    if (nav.some((n) => n.id === hash)) setView(hash);
    api<User>("/auth/me")
      .then((u) => {
        setUser(u);
        setDemo(false);
      })
      .catch(() => {
        setDemo(true);
      })
      .finally(() => setReady(true));
  }, []);
  function navigate(next: View) {
    setView(next);
    setMobile(false);
    window.location.hash = next;
  }
  const load = useCallback(async () => {
    if (demo) return;
    setBusy(true);
    try {
      const [p, m, k, l, u] = await Promise.all([
        api<Provider[]>("/providers"),
        api<Page<Model>>("/models?limit=100"),
        api<GatewayKey[]>("/keys"),
        api<Page<Log>>("/logs"),
        api<Usage>(`/usage?days=${days}`),
      ]);
      setProviders(p);
      setModels(m.data);
      setTotalModels(m.total);
      setKeys(k);
      setLogs(l.data);
      setTotalLogs(l.total);
      setUsage(u);
      setConnectionError("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        setDemo(true);
        setAuthOpen(true);
      }
      setConnectionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [demo, days]);
  useEffect(() => {
    if (ready) void load();
  }, [load, ready]);
  useEffect(() => {
    if (demo || view !== "models") return;
    let active = true;
    const timer = setTimeout(() => {
      api<Page<Model>>(
        `/models?limit=100&offset=${modelPage * 100}&search=${encodeURIComponent(search)}&capability=${capability}&provider=${filterProvider}`,
      )
        .then((r) => {
          if (active) {
            setModels(r.data);
            setTotalModels(r.total);
          }
        })
        .catch((e) => notify(e.message));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [view, demo, search, capability, filterProvider, modelPage, notify]);
  useEffect(() => {
    if (demo || view !== "requests") return;
    let active = true;
    api<Page<Log>>(`/logs?offset=${logPage * 25}&errors_only=${errorsOnly}`)
      .then((r) => {
        if (active) {
          setLogs(r.data);
          setTotalLogs(r.total);
        }
      })
      .catch((e) => notify(e.message));
    return () => {
      active = false;
    };
  }, [view, demo, logPage, errorsOnly, notify]);
  const p = demo ? demoProviders : providers,
    m = demo ? demoModels : models,
    k = demo ? demoKeys : keys,
    l = demo ? demoLogs : logs,
    u = demo ? demoUsage : usage;
  const displayedModels = demo
    ? m.filter(
        (x) =>
          (!search ||
            [x.name, x.model_id].some((v) =>
              v.toLowerCase().includes(search.toLowerCase()),
            )) &&
          (!capability || x.capabilities[capability]) &&
          (!filterProvider || x.provider_id === filterProvider),
      )
    : m;
  const s = u.summary,
    successRate = s.requests
      ? (((s.successes || 0) / s.requests) * 100).toFixed(1)
      : "—";
  function requireAccount(fn: () => void) {
    if (demo) setAuthOpen(true);
    else fn();
  }
  async function mutate(path: string, method: string, body?: unknown) {
    try {
      await api(path, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      notify("Changes saved");
      await load();
    } catch (err) {
      notify((err as Error).message);
    }
  }
  function connected() {
    setProviderModal(null);
    setModelModal(null);
    notify("Saved. Check discovery status on the connection.");
    void load();
  }
  const selectDays = (
    <select
      className="period-select"
      value={days}
      onChange={(e) => {
        if (demo)
          notify(
            "Demo shows a fixed seven-day sample. Sign in for live date ranges.",
          );
        setDays(Number(e.target.value));
      }}
      aria-label="Date range"
    >
      <option value={7}>Last 7 days</option>
      <option value={30}>Last 30 days</option>
      <option value={90}>Last 90 days</option>
    </select>
  );
  const stats = (
    <div className="stats-grid">
      <Metric
        label="Total requests"
        value={num(s.requests)}
        icon={Activity}
        detail={`${num(s.successes || 0)} successful requests`}
        spark={u.series.map((d) => d.requests)}
      />
      <Metric
        label="Average latency"
        value={s.avg_latency_ms ? Math.round(s.avg_latency_ms).toString() : "—"}
        suffix="ms"
        icon={Zap}
        detail="End-to-end request duration"
        spark={u.series.map((d) => d.avg_latency_ms || 0)}
      />
      <Metric
        label="Success rate"
        value={successRate}
        suffix={s.requests ? "%" : ""}
        icon={ShieldCheck}
        detail={`${num(s.requests - (s.successes || 0))} failed requests`}
        spark={u.series.map((d) =>
          d.requests ? (d.successes || 0) / d.requests : 0,
        )}
      />
      <Metric
        label="Estimated cost"
        value={s.estimated_cost == null ? "—" : money(s.estimated_cost)}
        icon={ChartNoAxesCombined}
        detail={`${num(s.priced_requests)} requests with known pricing`}
        spark={u.series.map((d) => d.estimated_cost || 0)}
      />
    </div>
  );
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          href="#overview"
          className="brand"
          onClick={() => navigate("overview")}
        >
          <span className="brand-mark">N</span>
          <span>
            nexus<span className="brand-period">.</span>
          </span>
          <Badge>GATEWAY</Badge>
        </a>
        <div className="workspace-switch">
          <span className="workspace-avatar">
            {demo ? "D" : user?.name.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>
              {demo ? "Demo workspace" : user?.name || "My workspace"}
            </strong>
            <small>{demo ? "Sample data" : "Personal gateway"}</small>
          </span>
          <ChevronsUpDown size={15} />
        </div>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {nav.slice(0, 7).map((n) => (
            <button
              key={n.id}
              onClick={() => navigate(n.id)}
              className={`nav-link ${view === n.id ? "selected" : ""}`}
              aria-current={view === n.id ? "page" : undefined}
            >
              <n.icon size={18} />
              {n.name}
              {n.id === "providers" && (
                <span className="nav-count">{p.length}</span>
              )}
              {n.id === "playground" && <Badge tone="purple">TRY</Badge>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-note">
            <span className="note-icon">
              <Network size={19} />
            </span>
            <strong>One endpoint. All your AI.</strong>
            <p>
              Your credentials stay yours.
              <br />
              Nexus connects the rest.
            </p>
            <button className="text-button" onClick={() => navigate("docs")}>
              View quickstart <ArrowRight size={14} />
            </button>
          </div>
          <button
            className={`nav-link ${view === "docs" ? "selected" : ""}`}
            onClick={() => navigate("docs")}
          >
            <BookOpen size={18} />
            Documentation
            <ExternalLink size={14} />
          </button>
          <div className="user-bar">
            <span className="user-avatar">
              {demo ? "D" : user?.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{demo ? "Explore the demo" : user?.name}</strong>
              <small>{demo ? "Connect when you’re ready" : user?.email}</small>
            </span>
            <button
              className="icon-button"
              aria-label={demo ? "Sign in" : "Sign out"}
              onClick={() => {
                if (demo) setAuthOpen(true);
                else
                  void api("/auth/logout", { method: "POST" })
                    .then(() => {
                      setUser(null);
                      setDemo(true);
                      setSecret("");
                      notify("Signed out");
                    })
                    .catch((e) => notify(e.message));
              }}
            >
              {demo ? <ArrowRight size={18} /> : <LogOut size={18} />}
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button menu-toggle"
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
            >
              <Menu size={22} />
            </button>
            <span className="muted">Workspace</span>
            <span className="breadcrumb-separator">/</span>
            <span>{nav.find((n) => n.id === view)?.name}</span>
          </div>
          <div className="topbar-actions">
            <span className="self-hosted">
              <ShieldCheck size={14} />
              Self-hosted
            </span>
            <span className="top-divider" />
            {demo ? (
              <button
                className="button compact primary"
                onClick={() => setAuthOpen(true)}
              >
                Sign in <ArrowRight size={14} />
              </button>
            ) : (
              <button
                className="button compact"
                onClick={() => void load()}
                disabled={busy}
              >
                <RefreshCw size={14} className={busy ? "spin" : ""} />
                Refresh
              </button>
            )}
          </div>
        </header>
        {demo && (
          <div className="demo-strip">
            <span>
              <span className="demo-dot" />
              DEMO WORKSPACE{" "}
              <span className="demo-description">
                Explore the interface with sample data. No live requests or
                charges.
              </span>
            </span>
            <button onClick={() => setAuthOpen(true)}>
              Connect your accounts <ArrowRight size={14} />
            </button>
          </div>
        )}
        <main id="main-content" className="content">
          {connectionError && (
            <Banner tone="error">
              {connectionError}{" "}
              <button className="text-button" onClick={() => void load()}>
                Retry
              </button>
            </Banner>
          )}
          {!ready && (
            <div className="loading-note">
              <LoaderCircle size={16} className="spin" />
              Opening workspace…
            </div>
          )}
          {view === "overview" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR AI, CONNECTED</div>
                  <h1>Gateway overview</h1>
                  <p className="page-subtitle">
                    A clear view of every connection, request, and response.
                  </p>
                </div>
                <div className="heading-actions">
                  {selectDays}
                  <button
                    className="button primary"
                    onClick={() =>
                      requireAccount(() => setProviderModal("new"))
                    }
                  >
                    <Plus size={17} />
                    Connect provider
                  </button>
                </div>
              </div>
              {stats}
              <div className="overview-grid">
                <section className="panel traffic-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Request traffic</h2>
                      <p>Requests across your connected providers</p>
                    </div>
                    <Badge tone="purple">
                      <span className="legend-dot" />
                      Requests
                    </Badge>
                  </div>
                  {s.requests ? (
                    <TrafficChart usage={u} />
                  ) : (
                    <Empty
                      title="Your first request starts here"
                      text="Connect a provider, then send a message from the playground."
                      action="Open playground"
                      onAction={() => navigate("playground")}
                    />
                  )}
                  <div className="chart-footer">
                    <span>
                      <span className="dot" />
                      {num(s.input_tokens)} input tokens
                    </span>
                    <span>
                      <span className="dot violet" />
                      {num(s.output_tokens)} output tokens
                    </span>
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Routing topology</h2>
                      <p>Your connections, one entry point</p>
                    </div>
                    <Network size={18} className="muted" />
                  </div>
                  <Topology providers={p} demo={demo} />
                </section>
              </div>
              <section className="panel providers-overview">
                <div className="panel-heading">
                  <div className="inline-heading">
                    <h2>Connected providers</h2>
                    <Badge>{p.length}</Badge>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("providers")}
                  >
                    Manage providers <ArrowRight size={15} />
                  </button>
                </div>
                <div className="provider-summary-grid">
                  {p.slice(0, 4).map((provider) => (
                    <button
                      key={provider.id}
                      className="provider-summary"
                      onClick={() => navigate("providers")}
                    >
                      <ProviderIcon kind={provider.kind} />
                      <div>
                        <strong>{provider.name}</strong>
                        <span>
                          {provider.models_count} models{" "}
                          <span className="mid-dot">·</span> Priority{" "}
                          {provider.priority}
                        </span>
                      </div>
                      <ProviderStatus p={provider} />
                    </button>
                  ))}
                  {!p.length && (
                    <Empty
                      title="Bring your own keys"
                      text="Start with OpenRouter, Groq, Google, or your own endpoint."
                      action="Connect provider"
                      onAction={() => setProviderModal("new")}
                    />
                  )}
                </div>
              </section>
              <div className="bottom-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Recent requests</h2>
                    <button
                      className="text-button"
                      onClick={() => navigate("requests")}
                    >
                      View all <ArrowRight size={15} />
                    </button>
                  </div>
                  <RequestTable
                    logs={l.slice(0, 4)}
                    onSelect={setSelectedLog}
                    compact
                  />
                </section>
                <section className="panel quickstart-panel">
                  <div className="panel-heading">
                    <div className="inline-heading">
                      <Code2 size={18} className="accent" />
                      <h2>Your universal endpoint</h2>
                    </div>
                  </div>
                  <p>
                    Configure your client once. Choose the model on every
                    request.
                  </p>
                  <div className="endpoint-line">
                    <span>BASE URL</span>
                    <code>{endpoint}</code>
                    <CopyButton value={endpoint} onCopy={notify} label="" />
                  </div>
                  <pre className="code-snippet">
                    import os{"\n"}
                    <span className="code-purple">from</span> openai{" "}
                    <span className="code-purple">import</span> OpenAI{"\n\n"}
                    client = OpenAI({"\n"} base_url=
                    <span className="code-green">"{endpoint}"</span>,{"\n"}{" "}
                    api_key=
                    <span className="code-green">
                      os.environ["GATEWAY_API_KEY"]
                    </span>
                    {"\n"})
                  </pre>
                  <button
                    className="text-button"
                    onClick={() => navigate("docs")}
                  >
                    Read the integration guide <ArrowRight size={15} />
                  </button>
                </section>
              </div>
            </>
          )}
          {view === "providers" && (
            <>
              <PageHeading
                eyebrow="CONNECTIONS"
                title="Your providers"
                subtitle="Connect once. Keep control of every credential and route."
                action={
                  <button
                    className="button primary"
                    onClick={() =>
                      requireAccount(() => setProviderModal("new"))
                    }
                  >
                    <Plus size={17} />
                    Connect provider
                  </button>
                }
              />
              <div className="info-row">
                <ShieldCheck size={17} />
                <span>
                  API keys and custom headers are encrypted at rest. Saved
                  credentials are never displayed.
                </span>
                <Badge>{p.filter((x) => x.enabled).length} enabled</Badge>
              </div>
              <div className="provider-card-grid">
                {p.map((provider) => (
                  <section className="panel provider-card" key={provider.id}>
                    <div className="provider-card-top">
                      <ProviderIcon kind={provider.kind} />
                      <div>
                        <h2>{provider.name}</h2>
                        <span className="muted">
                          {providerInfo[provider.kind]?.name || provider.kind}
                        </span>
                      </div>
                      <button
                        className={`icon-button pin-button ${provider.pinned ? "accent" : ""}`}
                        title={
                          provider.pinned ? "Unpin provider" : "Pin provider"
                        }
                        onClick={() =>
                          requireAccount(
                            () =>
                              void mutate(
                                `/providers/${provider.id}`,
                                "PATCH",
                                { pinned: !provider.pinned },
                              ),
                          )
                        }
                      >
                        <Pin size={17} />
                      </button>
                    </div>
                    <div
                      className="provider-card-url mono"
                      title={provider.base_url}
                    >
                      {provider.base_url}
                    </div>
                    <div className="provider-card-metrics">
                      <div>
                        <small>Models</small>
                        <strong>{provider.models_count}</strong>
                      </div>
                      <div>
                        <small>Priority</small>
                        <strong>{provider.priority}</strong>
                      </div>
                      <div>
                        <small>Connection</small>
                        <ProviderStatus p={provider} />
                      </div>
                    </div>
                    {provider.discovery_error && (
                      <Banner tone="error">{provider.discovery_error}</Banner>
                    )}
                    <div className="provider-card-refreshed">
                      Catalog refreshed {stamp(provider.discovered_at)}
                    </div>
                    <div className="provider-card-actions">
                      <button
                        className={`switch ${provider.enabled ? "on" : ""}`}
                        role="switch"
                        aria-checked={provider.enabled}
                        aria-label={`Enable ${provider.name}`}
                        onClick={() =>
                          requireAccount(
                            () =>
                              void mutate(
                                `/providers/${provider.id}`,
                                "PATCH",
                                { enabled: !provider.enabled },
                              ),
                          )
                        }
                      >
                        <span />
                      </button>
                      <span className="muted">
                        {provider.enabled ? "Enabled" : "Disabled"}
                      </span>
                      <div className="spacer" />
                      <button
                        className="icon-button"
                        aria-label={`Refresh ${provider.name} models`}
                        onClick={() =>
                          requireAccount(
                            () =>
                              void mutate(
                                `/providers/${provider.id}/refresh`,
                                "POST",
                              ),
                          )
                        }
                      >
                        <RefreshCw size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${provider.name}`}
                        onClick={() =>
                          requireAccount(() => setProviderModal(provider))
                        }
                      >
                        <Settings2 size={16} />
                      </button>
                      <button
                        className="icon-button danger-hover"
                        aria-label={`Delete ${provider.name}`}
                        onClick={() =>
                          requireAccount(() =>
                            setConfirm({
                              title: "Remove provider?",
                              text: `${provider.name} and its model registry will be removed. Existing request history is retained.`,
                              action: () =>
                                mutate(`/providers/${provider.id}`, "DELETE"),
                            }),
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </section>
                ))}
                <button
                  className="add-provider-card"
                  onClick={() => requireAccount(() => setProviderModal("new"))}
                >
                  <span className="add-circle">
                    <Plus size={25} />
                  </span>
                  <h3>Connect another provider</h3>
                  <p>
                    Cloud models or your own endpoint.
                    <br />
                    Same simple connection.
                  </p>
                  <div className="provider-symbols">
                    {Object.keys(providerInfo)
                      .slice(0, 5)
                      .map((kind) => (
                        <ProviderIcon key={kind} kind={kind} small />
                      ))}
                  </div>
                </button>
              </div>
              <div className="note-panel">
                <h3>Using Ollama, LM Studio, or another provider?</h3>
                <p>
                  Select Custom endpoint and provide an OpenAI-compatible base
                  URL. Register model capabilities in the explorer when the
                  endpoint does not report them.
                </p>
                <button
                  className="text-button"
                  onClick={() => navigate("docs")}
                >
                  Custom endpoint guide <ArrowRight size={15} />
                </button>
              </div>
            </>
          )}
          {view === "models" && (
            <>
              <PageHeading
                eyebrow="UNIVERSAL REGISTRY"
                title="Model explorer"
                subtitle="Find the right model across the providers you have connected."
                action={
                  <button
                    className="button primary"
                    onClick={() => requireAccount(() => setModelModal("new"))}
                  >
                    <Plus size={17} />
                    Register model
                  </button>
                }
              />
              <div className="filter-bar">
                <label className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="Search models"
                    placeholder="Search models by name or ID…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setModelPage(0);
                    }}
                  />
                </label>
                <select
                  aria-label="Filter capability"
                  value={capability}
                  onChange={(e) => {
                    setCapability(e.target.value);
                    setModelPage(0);
                  }}
                >
                  <option value="">All capabilities</option>
                  {[
                    "tools",
                    "vision",
                    "reasoning",
                    "json_mode",
                    "streaming",
                    "embeddings",
                    "images",
                    "speech",
                    "transcription",
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter provider"
                  value={filterProvider}
                  onChange={(e) => {
                    setFilterProvider(e.target.value);
                    setModelPage(0);
                  }}
                >
                  <option value="">All providers</option>
                  {p.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="table-note">
                <span>
                  {demo ? displayedModels.length : totalModels} models{" "}
                  <span className="mid-dot">·</span> Prices in USD per million
                  tokens
                </span>
                <span>— means unknown</span>
              </div>
              <section className="panel table-panel">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>Capabilities</th>
                        <th>Context</th>
                        <th>Input / Output</th>
                        <th>Availability</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedModels.map((model) => (
                        <tr key={model.id}>
                          <td>
                            <div className="model-cell">
                              <ProviderIcon kind={model.provider} small />
                              <div>
                                <strong>{model.name}</strong>
                                <small title={model.model_id}>
                                  {model.model_id}
                                </small>
                                <span>{model.provider_name}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="capability-badges">
                              {Object.entries(model.capabilities)
                                .filter(
                                  ([c, v]) =>
                                    v &&
                                    [
                                      "tools",
                                      "vision",
                                      "reasoning",
                                      "embeddings",
                                      "images",
                                      "speech",
                                      "transcription",
                                      "json_mode",
                                    ].includes(c),
                                )
                                .slice(0, 4)
                                .map(([c]) => (
                                  <Badge
                                    key={c}
                                    tone={
                                      c === "reasoning" ? "purple" : "neutral"
                                    }
                                  >
                                    {c.replace("_", " ")}
                                  </Badge>
                                ))}
                              {!Object.values(model.capabilities).some(
                                Boolean,
                              ) && <span className="muted">Unconfirmed</span>}
                            </div>
                          </td>
                          <td className="mono">{num(model.context_window)}</td>
                          <td>
                            <Price value={model.input_price} />
                            <span className="muted"> / </span>
                            <Price value={model.output_price} />
                          </td>
                          <td>
                            <Badge
                              tone={
                                !model.enabled || !model.available
                                  ? "neutral"
                                  : model.health.status === "cooldown"
                                    ? "amber"
                                    : "green"
                              }
                            >
                              {!model.enabled
                                ? "Disabled"
                                : !model.available
                                  ? "Unavailable"
                                  : model.health.status === "cooldown"
                                    ? "Cooldown"
                                    : "Listed"}
                            </Badge>
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                className={`icon-button ${model.favorite ? "accent" : ""}`}
                                aria-label={`Favorite ${model.name}`}
                                onClick={() =>
                                  requireAccount(
                                    () =>
                                      void mutate(
                                        `/models/${model.id}/favorite`,
                                        "POST",
                                      ),
                                  )
                                }
                              >
                                <Star
                                  size={16}
                                  fill={
                                    model.favorite ? "currentColor" : "none"
                                  }
                                />
                              </button>
                              <button
                                className="icon-button"
                                title="Configure model"
                                onClick={() =>
                                  requireAccount(() => setModelModal(model))
                                }
                              >
                                <Settings2 size={16} />
                              </button>
                              <CopyButton
                                value={model.route_id}
                                onCopy={notify}
                                label=""
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!displayedModels.length && (
                  <Empty
                    title="No matching models"
                    text={
                      p.length
                        ? "Try a different search, refresh a provider, or register a model manually."
                        : "Connect a provider to discover available models."
                    }
                  />
                )}
                <div className="table-footer">
                  <span>
                    Capabilities come from provider metadata or your
                    configuration.
                  </span>
                  <Pagination
                    page={modelPage}
                    size={100}
                    total={demo ? displayedModels.length : totalModels}
                    setPage={setModelPage}
                  />
                </div>
              </section>
            </>
          )}
          {view === "playground" && (
            <Playground
              demo={demo}
              providers={p}
              models={m}
              requireAccount={requireAccount}
              notify={notify}
              onFinish={load}
            />
          )}
          {view === "keys" && (
            <>
              <PageHeading
                eyebrow="ACCESS CONTROL"
                title="Gateway API keys"
                subtitle="One key connects your agents to every provider in this workspace."
                action={
                  <button
                    className="button primary"
                    onClick={() => requireAccount(() => setKeyModal(true))}
                  >
                    <Plus size={17} />
                    Create API key
                  </button>
                }
              />
              <div className="key-hero panel">
                <div className="key-hero-icon">
                  <KeyRound size={28} />
                </div>
                <div>
                  <h2>A single key. Your entire model stack.</h2>
                  <p>
                    Gateway keys authenticate your applications. Provider
                    credentials stay securely behind the gateway.
                  </p>
                </div>
                <Badge tone="green">
                  <ShieldCheck size={13} />
                  Encrypted credentials
                </Badge>
              </div>
              <section className="panel table-panel">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Key prefix</th>
                        <th>Created</th>
                        <th>Last used</th>
                        <th>Expires</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {k.map((key) => (
                        <tr key={key.id}>
                          <td>
                            <strong>{key.name}</strong>
                          </td>
                          <td>
                            <code>{key.prefix}••••••</code>
                          </td>
                          <td>{stamp(key.created_at)}</td>
                          <td>{stamp(key.last_used_at)}</td>
                          <td>{stamp(key.expires_at)}</td>
                          <td>
                            <Badge
                              tone={
                                key.revoked
                                  ? "neutral"
                                  : key.expires_at &&
                                      key.expires_at < Date.now() / 1000
                                    ? "amber"
                                    : "green"
                              }
                            >
                              {key.revoked
                                ? "Revoked"
                                : key.expires_at &&
                                    key.expires_at < Date.now() / 1000
                                  ? "Expired"
                                  : "Active"}
                            </Badge>
                          </td>
                          <td>
                            {!key.revoked && (
                              <button
                                className="text-button danger"
                                onClick={() =>
                                  requireAccount(() =>
                                    setConfirm({
                                      title: "Revoke this key?",
                                      text: `Applications using “${key.name}” will immediately lose access. Create a replacement first if needed.`,
                                      action: () =>
                                        mutate(`/keys/${key.id}`, "DELETE"),
                                    }),
                                  )
                                }
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!k.length && (
                  <Empty
                    title="Create your first key"
                    text="Give each agent or environment a separate key so you can revoke access independently."
                    action="Create API key"
                    onAction={() => setKeyModal(true)}
                  />
                )}
              </section>
              <div className="note-panel">
                <ShieldCheck size={20} />
                <div>
                  <h3>Keys are shown only once</h3>
                  <p>
                    Store a new key when it appears. Lost keys cannot be
                    recovered; create a replacement and revoke the old one.
                  </p>
                </div>
              </div>
            </>
          )}
          {view === "requests" && (
            <>
              <PageHeading
                eyebrow="OBSERVABILITY"
                title="Request history"
                subtitle="Inspect routing decisions, timing, token usage, and fallback attempts."
                action={
                  <button
                    className="button"
                    onClick={() =>
                      requireAccount(() =>
                        window.location.assign("/api/usage/export"),
                      )
                    }
                  >
                    <ArrowDownToLine size={16} />
                    Export CSV
                  </button>
                }
              />
              <div className="filter-bar">
                <div className="segmented">
                  <button
                    className={!errorsOnly ? "active" : ""}
                    onClick={() => {
                      setErrorsOnly(false);
                      setLogPage(0);
                    }}
                  >
                    All requests
                  </button>
                  <button
                    className={errorsOnly ? "active" : ""}
                    onClick={() => {
                      setErrorsOnly(true);
                      setLogPage(0);
                    }}
                  >
                    Errors only
                  </button>
                </div>
                <span className="muted">
                  Prompts and responses are never stored in request logs.
                </span>
              </div>
              <section className="panel">
                <RequestTable
                  logs={
                    errorsOnly && demo ? l.filter((x) => x.status >= 400) : l
                  }
                  onSelect={setSelectedLog}
                />
                <div className="table-footer">
                  <span>{demo ? l.length : totalLogs} requests</span>
                  <Pagination
                    page={logPage}
                    size={25}
                    total={demo ? l.length : totalLogs}
                    setPage={setLogPage}
                  />
                </div>
              </section>
            </>
          )}
          {view === "usage" && (
            <>
              <PageHeading
                eyebrow="ANALYTICS"
                title="Usage & performance"
                subtitle="Understand your request volume, provider performance, and estimated spend."
                action={selectDays}
              />
              {stats}
              <div className="two-columns">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Response latency</h2>
                    <Badge>Milliseconds</Badge>
                  </div>
                  <TrafficChart usage={u} metric="latency" />
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Errors over time</h2>
                    <Badge tone="amber">Failed requests</Badge>
                  </div>
                  <TrafficChart usage={u} metric="errors" />
                </section>
              </div>
              <div className="two-columns">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Provider distribution</h2>
                    <Badge>Request volume</Badge>
                  </div>
                  {u.providers.length ? (
                    <ProviderChart usage={u} />
                  ) : (
                    <Empty
                      title="No usage yet"
                      text="Provider traffic appears after your first request."
                    />
                  )}
                </section>
                <section className="panel cost-panel">
                  <div className="panel-heading">
                    <h2>Token & cost breakdown</h2>
                  </div>
                  <div className="cost-total">
                    {s.estimated_cost == null ? "—" : money(s.estimated_cost)}
                    <small>Estimated token cost</small>
                  </div>
                  <div className="cost-row">
                    <span>Input tokens</span>
                    <strong>{num(s.input_tokens)}</strong>
                  </div>
                  <div className="cost-row">
                    <span>Output tokens</span>
                    <strong>{num(s.output_tokens)}</strong>
                  </div>
                  <div className="cost-row">
                    <span>Pricing coverage</span>
                    <strong>
                      {num(s.priced_requests)} / {num(s.requests)} requests
                    </strong>
                  </div>
                  <p className="form-note">
                    An estimate from reported usage and catalog prices. Missing
                    token counts or prices remain unknown. Provider invoices may
                    include other charges and failed attempts.
                  </p>
                  <button
                    className="text-button"
                    onClick={() =>
                      requireAccount(() =>
                        window.location.assign(
                          `/api/usage/export?days=${days}`,
                        ),
                      )
                    }
                  >
                    <ArrowDownToLine size={15} />
                    Export usage
                  </button>
                </section>
              </div>
            </>
          )}
          {view === "docs" && (
            <Documentation endpoint={endpoint} notify={notify} />
          )}
          <footer className="page-footer">
            <span>
              <span className="brand-mark tiny">N</span>Nexus · Universal AI
              Gateway
            </span>
            <span>
              {demo
                ? "Illustrative workspace · v1.0"
                : "Bring your own keys · v1.0"}
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {authOpen && (
        <AuthForm
          onClose={() => setAuthOpen(false)}
          onSuccess={(newUser, key) => {
            setUser(newUser);
            setDemo(false);
            setAuthOpen(false);
            if (key) setSecret(key);
            notify("Welcome to your workspace");
          }}
        />
      )}
      {providerModal && (
        <ProviderForm
          provider={providerModal === "new" ? undefined : providerModal}
          onClose={() => setProviderModal(null)}
          onSaved={connected}
        />
      )}
      {modelModal && (
        <ModelForm
          model={modelModal === "new" ? undefined : modelModal}
          providers={p}
          onClose={() => setModelModal(null)}
          onSaved={connected}
        />
      )}
      {keyModal && (
        <Modal
          title="Create a Gateway API key"
          onClose={() => setKeyModal(false)}
        >
          <form
            className="form modal-body"
            onSubmit={async (e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              try {
                const res = await api<{ key: string }>("/keys", {
                  method: "POST",
                  body: JSON.stringify({
                    name: f.get("name"),
                    expires_in_days: f.get("expires")
                      ? Number(f.get("expires"))
                      : null,
                  }),
                });
                setSecret(res.key);
                setKeyModal(false);
                void load();
              } catch (err) {
                notify((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Key name
              <input
                name="name"
                placeholder="My coding agent"
                required
                maxLength={80}
              />
            </label>
            <label>
              Expiration
              <select name="expires">
                <option value="">No expiration</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
            </label>
            <Banner>
              The full key is only shown after creation. Store it securely
              before closing.
            </Banner>
            <button className="button primary" disabled={busy}>
              Create key
            </button>
          </form>
        </Modal>
      )}
      {secret && (
        <Modal title="Save your new API key" onClose={() => setSecret("")}>
          <div className="modal-body form">
            <Badge tone="green">
              <Check size={14} />
              Key created
            </Badge>
            <p>Copy this key now. It will not be displayed again.</p>
            <textarea
              aria-label="New Gateway API key"
              className="secret-field mono"
              value={secret}
              readOnly
              rows={3}
            />
            <CopyButton value={secret} onCopy={notify} label="Copy API key" />
            <button className="button primary" onClick={() => setSecret("")}>
              I’ve saved my key
            </button>
          </div>
        </Modal>
      )}
      {selectedLog && (
        <Modal
          title="Request details"
          onClose={() => setSelectedLog(null)}
          wide
        >
          <div className="modal-body form">
            <div className="detail-summary">
              <Badge tone={selectedLog.status < 400 ? "green" : "amber"}>
                HTTP {selectedLog.status}
              </Badge>
              <code>{selectedLog.id}</code>
              <CopyButton value={selectedLog.id} onCopy={notify} />
            </div>
            <dl className="detail-grid">
              <div>
                <dt>Requested model</dt>
                <dd>{selectedLog.requested_model}</dd>
              </div>
              <div>
                <dt>Resolved model</dt>
                <dd>{selectedLog.resolved_model || "No matching model"}</dd>
              </div>
              <div>
                <dt>Latency</dt>
                <dd>{Math.round(selectedLog.latency_ms)} ms</dd>
              </div>
              <div>
                <dt>Tokens · input / output</dt>
                <dd>
                  {num(selectedLog.input_tokens)} /{" "}
                  {num(selectedLog.output_tokens)}
                </dd>
              </div>
              <div>
                <dt>Estimated cost</dt>
                <dd>{money(selectedLog.estimated_cost)}</dd>
              </div>
              <div>
                <dt>Timestamp</dt>
                <dd>{stamp(selectedLog.created_at)}</dd>
              </div>
            </dl>
            <h3>Routing attempts</h3>
            <div className="attempts-list">
              {selectedLog.attempts.map((a, i) => (
                <div className="attempt" key={i}>
                  <span className="attempt-number">{i + 1}</span>
                  <ProviderIcon kind={a.provider} small />
                  <div>
                    <strong>{a.provider_name}</strong>
                    <small>{a.model}</small>
                  </div>
                  <Badge tone={a.status < 400 ? "green" : "amber"}>
                    {a.status}
                  </Badge>
                  <span className="mono">{Math.round(a.latency_ms)} ms</span>
                </div>
              ))}
              {!selectedLog.attempts.length && (
                <p className="muted">No upstream attempt was made.</p>
              )}
            </div>
            {selectedLog.error_code && (
              <Banner tone="error">{selectedLog.error_code}</Banner>
            )}
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <div className="modal-body form">
            <p>{confirm.text}</p>
            <div className="form-actions">
              <button className="button" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="button danger-button"
                onClick={async () => {
                  await confirm.action();
                  setConfirm(null);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      <div className="heading-actions">{action}</div>
    </div>
  );
}
function Metric({
  label,
  value,
  suffix,
  detail,
  icon: Icon,
  spark,
}: {
  label: string;
  value: string;
  suffix?: string;
  detail: string;
  icon: typeof Activity;
  spark: number[];
}) {
  return (
    <section className="stat-card">
      <div className="stat-label">
        {label}
        <Icon size={16} />
      </div>
      <div className="stat-main">
        <strong>
          {value}
          <span>{suffix}</span>
        </strong>
        <svg className="sparkline" viewBox="0 0 82 28" aria-hidden="true">
          <polyline
            points={spark
              .map(
                (v, i) =>
                  `${(i * 78) / Math.max(spark.length - 1, 1)},${25 - (v / Math.max(...spark, 1)) * 20}`,
              )
              .join(" ")}
          />
        </svg>
      </div>
      <p>{detail}</p>
    </section>
  );
}
function ProviderStatus({ p }: { p: Provider }) {
  const state = !p.enabled
    ? "Disabled"
    : p.health.status === "cooldown"
      ? "Cooldown"
      : p.discovery_error
        ? "Check key"
        : p.health.status === "degraded"
          ? "High latency"
          : p.health.status === "healthy"
            ? "Healthy"
            : p.discovered_at
              ? "Connected"
              : "Not checked";
  return (
    <Badge
      tone={
        ["Healthy", "Connected"].includes(state)
          ? "green"
          : ["Cooldown", "Check key", "High latency"].includes(state)
            ? "amber"
            : "neutral"
      }
    >
      {state}
    </Badge>
  );
}
function Pagination({
  page,
  total,
  size,
  setPage,
}: {
  page: number;
  total: number;
  size: number;
  setPage: (p: number) => void;
}) {
  return (
    <div className="pagination">
      <button
        className="icon-button"
        aria-label="Previous page"
        disabled={page === 0}
        onClick={() => setPage(page - 1)}
      >
        <ChevronLeft size={17} />
      </button>
      <span>
        {page + 1} / {Math.max(1, Math.ceil(total / size))}
      </span>
      <button
        className="icon-button"
        aria-label="Next page"
        disabled={(page + 1) * size >= total}
        onClick={() => setPage(page + 1)}
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
}
function RequestTable({
  logs,
  onSelect,
  compact = false,
}: {
  logs: Log[];
  onSelect: (l: Log) => void;
  compact?: boolean;
}) {
  return logs.length ? (
    <div className="table-scroll">
      <table className="requests-table">
        <thead>
          <tr>
            <th>Model / request</th>
            <th>Status</th>
            <th>Latency</th>
            {!compact && (
              <>
                <th>Tokens in / out</th>
                <th>Cost</th>
                <th>Attempts</th>
              </>
            )}
            <th>Time</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} onClick={() => onSelect(log)}>
              <td>
                <button
                  className="table-cell-button"
                  onClick={() => onSelect(log)}
                >
                  <strong>{log.resolved_model || log.requested_model}</strong>
                  <small>
                    {log.provider_name || "No provider"}
                    {log.attempts.length > 1 && (
                      <span className="fallback-label"> ↪ Fallback</span>
                    )}
                  </small>
                </button>
              </td>
              <td>
                <Badge tone={log.status < 400 ? "green" : "amber"}>
                  {log.status < 400 ? (
                    <Check size={12} />
                  ) : (
                    <TriangleAlert size={12} />
                  )}{" "}
                  {log.status}
                </Badge>
              </td>
              <td className="mono">
                {Math.round(log.latency_ms)} <span className="muted">ms</span>
              </td>
              {!compact && (
                <>
                  <td className="mono">
                    {num(log.input_tokens)} / {num(log.output_tokens)}
                  </td>
                  <td>
                    <Price value={log.estimated_cost} />
                  </td>
                  <td>{log.attempts.length}</td>
                </>
              )}
              <td className="muted nowrap">{stamp(log.created_at)}</td>
              <td>
                <ChevronRight size={15} className="muted" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="No requests yet"
      text="Your gateway requests and routing history will appear here."
    />
  );
}

function Playground({
  demo,
  providers,
  models,
  requireAccount,
  notify,
  onFinish,
}: {
  demo: boolean;
  providers: Provider[];
  models: Model[];
  requireAccount: (fn: () => void) => void;
  notify: (s: string) => void;
  onFinish: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState(
      "Explain how an AI gateway routes a request in three clear steps.",
    ),
    [system, setSystem] = useState(
      "You are a helpful assistant. Be concise and accurate.",
    ),
    [mode, setMode] = useState("auto"),
    [provider, setProvider] = useState(""),
    [model, setModel] = useState("auto"),
    [stream, setStream] = useState(true),
    [output, setOutput] = useState(""),
    [running, setRunning] = useState(false),
    [info, setInfo] = useState(""),
    [alternatives, setAlternatives] = useState(false),
    [retries, setRetries] = useState(2);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run() {
    setRunning(true);
    setOutput("");
    setInfo("Connecting…");
    controller.current = new AbortController();
    const started = performance.now();
    try {
      const body = {
        model:
          model === "auto"
            ? mode === "auto"
              ? "auto"
              : `auto/${mode}`
            : model,
        routing: mode,
        provider: provider || undefined,
        stream,
        max_retries: retries,
        allow_alternatives: alternatives,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      };
      const response = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf() },
        body: JSON.stringify(body),
        signal: controller.current.signal,
      });
      if (!response.ok) {
        const e = await response.json();
        throw new Error(
          e.error?.message || `Request failed (${response.status})`,
        );
      }
      setInfo(
        `${response.headers.get("X-Gateway-Provider")} · ${response.headers.get("X-Gateway-Model")} · ${response.headers.get("X-Gateway-Attempts")} attempt(s)`,
      );
      if (stream && response.body) {
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            const data = JSON.parse(raw);
            if (data.error) throw new Error(data.error.message);
            const delta = data.choices?.[0]?.delta;
            if (delta?.content) setOutput((prev) => prev + delta.content);
            if (delta?.tool_calls)
              setOutput(
                (prev) =>
                  prev + "\n" + JSON.stringify(delta.tool_calls, null, 2),
              );
          }
        }
      } else {
        const data = await response.json();
        setOutput(
          data.choices?.[0]?.message?.content || JSON.stringify(data, null, 2),
        );
      }
      setInfo(
        (prev) =>
          prev + ` · ${((performance.now() - started) / 1000).toFixed(1)}s`,
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setInfo("Request stopped");
      } else {
        setInfo("Request failed");
        setOutput((prev) => prev + "\n" + (err as Error).message);
      }
    } finally {
      setRunning(false);
      void onFinish();
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="DEVELOPER TOOLS"
        title="Playground"
        subtitle="Test your gateway with a real request and inspect the selected route."
        action={
          <Badge tone="purple">
            <Terminal size={14} />
            Chat completions
          </Badge>
        }
      />
      {demo && (
        <Banner>
          Sign in and connect a provider to send real requests. The playground
          uses your provider account and may incur charges.
        </Banner>
      )}
      <div className="playground-grid">
        <section className="panel playground-settings">
          <h2>Request configuration</h2>
          <div className="form">
            <label>
              Routing strategy
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                {modes
                  .filter((x) => !["image", "embedding"].includes(x))
                  .map((x) => (
                    <option key={x} value={x}>
                      {x[0].toUpperCase() + x.slice(1)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Provider
              <select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setModel("auto");
                }}
              >
                <option value="">All enabled providers</option>
                {providers
                  .filter((x) => x.enabled)
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Model
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="auto">Auto-select a model</option>
                {models
                  .filter(
                    (m) =>
                      (!provider || m.provider_id === provider) &&
                      m.capabilities.chat !== false,
                  )
                  .map((m) => (
                    <option
                      key={m.id}
                      value={provider ? m.model_id : m.route_id}
                    >
                      {m.name} · {m.provider_name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Retry budget
              <select
                value={retries}
                onChange={(e) => setRetries(Number(e.target.value))}
              >
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option value={n} key={n}>
                    {n} {n === 1 ? "retry" : "retries"}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={stream}
                onChange={(e) => setStream(e.target.checked)}
              />
              Stream response
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={alternatives}
                onChange={(e) => setAlternatives(e.target.checked)}
              />
              Allow alternative models
            </label>
            <p className="form-note">
              Your server’s retry limit is the upper bound. Provider selection
              stays pinned. Alternatives require confirmed capabilities.
            </p>
          </div>
        </section>
        <section className="panel playground-chat">
          <div className="panel-heading">
            <h2>Compose a request</h2>
            <Badge>/v1/chat/completions</Badge>
          </div>
          <div className="form playground-compose">
            <label>
              System instruction
              <textarea
                rows={2}
                value={system}
                onChange={(e) => setSystem(e.target.value)}
              />
            </label>
            <label>
              Your message
              <textarea
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask something…"
              />
            </label>
            <div className="compose-actions">
              <span className="muted">
                <ShieldCheck size={14} />
                Prompt content is not logged
              </span>
              {running ? (
                <button
                  className="button"
                  onClick={() => controller.current?.abort()}
                >
                  <Square size={15} />
                  Stop
                </button>
              ) : (
                <button
                  className="button primary"
                  disabled={!prompt.trim()}
                  onClick={() => requireAccount(() => void run())}
                >
                  <Play size={15} />
                  Send request
                </button>
              )}
            </div>
          </div>
          <div className="response-heading">
            <div>
              <Sparkles size={16} />
              <h3>Response</h3>
            </div>
            {output && <CopyButton value={output} onCopy={notify} />}
          </div>
          <div
            className={`response-output ${!output ? "no-output" : ""}`}
            aria-live="polite"
          >
            {output ? (
              <pre>{output}</pre>
            ) : running ? (
              <span>
                <LoaderCircle size={18} className="spin" />
                Waiting for the provider…
              </span>
            ) : (
              <span>
                <Terminal size={25} />
                <strong>Your response will appear here</strong>
                <small>Choose a route, write a message, and send.</small>
              </span>
            )}
          </div>
          {info && <div className="response-info mono">{info}</div>}
        </section>
      </div>
    </>
  );
}

function Documentation({
  endpoint,
  notify,
}: {
  endpoint: string;
  notify: (s: string) => void;
}) {
  const [language, setLanguage] = useState("Python");
  const snippets: Record<string, string> = {
    Python: `import os\nfrom openai import OpenAI\n\nclient = OpenAI(\n    base_url="${endpoint}",\n    api_key=os.environ["GATEWAY_API_KEY"],\n    max_retries=0,  # Gateway owns the fallback budget\n)\n\nresponse = client.chat.completions.create(\n    model="auto/coding",\n    messages=[{"role": "user", "content": "Explain async Python"}],\n)\nprint(response.choices[0].message.content)`,
    TypeScript: `import OpenAI from "openai";\n\nconst client = new OpenAI({\n  baseURL: "${endpoint}",\n  apiKey: process.env.GATEWAY_API_KEY,\n  maxRetries: 0,\n});\n\nconst response = await client.chat.completions.create({\n  model: "auto/coding",\n  messages: [{ role: "user", content: "Explain async Python" }],\n});\nconsole.log(response.choices[0].message.content);`,
    cURL: `curl "${endpoint}/chat/completions" \\\n  -H "Authorization: Bearer $GATEWAY_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "auto/coding",\n    "messages": [{"role":"user", "content":"Hello!"}]\n  }'`,
  };
  return (
    <>
      <PageHeading
        eyebrow="INTEGRATION GUIDE"
        title="One endpoint. Start building."
        subtitle="Use the OpenAI SDK or any client that supports a custom OpenAI-compatible base URL."
      />
      <div className="docs-layout">
        <section className="panel docs-code">
          <div className="panel-heading">
            <div className="segmented">
              {Object.keys(snippets).map((x) => (
                <button
                  key={x}
                  className={language === x ? "active" : ""}
                  onClick={() => setLanguage(x)}
                >
                  {x}
                </button>
              ))}
            </div>
            <CopyButton value={snippets[language]} onCopy={notify} />
          </div>
          <pre>{snippets[language]}</pre>
        </section>
        <section className="panel docs-steps">
          <h2>Connect in three steps</h2>
          {[
            [
              "Add your providers",
              "Save a key from OpenRouter, Groq, Google AI Studio, Hugging Face, Together, Fireworks, or a custom endpoint.",
            ],
            [
              "Create a Gateway API key",
              "Copy the key once and store it as an environment variable.",
            ],
            [
              "Point your client to Nexus",
              "Set the base URL and Gateway API key, then choose auto or a model from your registry.",
            ],
          ].map(([title, text], i) => (
            <div className="doc-step" key={title}>
              <span>{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </div>
          ))}
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Routing reference</h2>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Model / mode</th>
                <th>Behavior</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  "auto",
                  "Selects a confirmed compatible model by provider priority and measured latency.",
                ],
                [
                  "auto/fastest",
                  "Prefers the lowest observed end-to-end latency. Unknown latency sorts last.",
                ],
                [
                  "auto/cheapest",
                  "Prefers the lowest known input + output token price. Unknown prices sort last.",
                ],
                [
                  "auto/coding",
                  "Prefers declared coding models or coding-family names, then normal priority.",
                ],
                [
                  "auto/reasoning · auto/vision",
                  "Requires confirmed reasoning or vision capability.",
                ],
                [
                  "auto/image · auto/embedding",
                  "Use on /images/generations or /embeddings respectively.",
                ],
                [
                  "provider + native model",
                  "Pins the provider and prefers the exact model ID.",
                ],
                [
                  "connection-id::model-id",
                  "Pins a specific provider connection. Copy this ID from Model explorer.",
                ],
              ].map(([a, b]) => (
                <tr key={a}>
                  <td className="mono">{a}</td>
                  <td>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="two-columns docs-notes">
        <div className="note-panel">
          <h3>Streaming & fallback</h3>
          <p>
            The gateway retries eligible upstream errors before any response
            data has been sent. After streaming starts, an interruption is
            reported in-stream; it never silently combines output from two
            providers.
          </p>
        </div>
        <div className="note-panel">
          <h3>Agent compatibility</h3>
          <p>
            Use OpenAI-compatible mode in OpenCode, Continue, Cline, Cursor, Roo
            Code, or Aider. Some clients also require a model ID. Claude Code
            uses the included Messages bridge. Client-specific features and
            model capabilities still apply.
          </p>
          <a
            className="text-button"
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
          >
            Open API reference <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </>
  );
}
