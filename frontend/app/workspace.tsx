"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Gauge,
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  LockKeyhole,
  CircleHelp,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Network,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
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
  duration,
} from "@/lib/api";
import { defaultSite, SiteOptions } from "@/lib/site";
import { errorGuidance } from "@/lib/errors";
import {
  demoProviders,
  demoModels,
  demoUsage,
  demoLogs,
  demoKeys,
} from "@/lib/demo";
import { AuthForm, ProviderForm, ModelForm } from "./forms";
import Landing from "./landing";
import ProviderDirectory from "./provider-directory";
import QuotaPanel from "./quota-panel";
import Playground from "./playground";
import AdminPanel from "./admin-panel";
import Documentation from "./documentation";
import RequestTable from "./request-table";
import {
  PageHeading,
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
  Capabilities,
  ProviderStatus,
  Skeleton,
} from "./ui";

type View =
  | "home"
  | "quotas"
  | "overview"
  | "providers"
  | "models"
  | "playground"
  | "keys"
  | "requests"
  | "usage"
  | "docs"
  | "admin";
const nav: { id: View; name: string; icon: typeof Activity }[] = [
  { id: "overview", name: "Overview", icon: LayoutDashboard },
  { id: "providers", name: "Providers", icon: Waypoints },
  { id: "models", name: "Model explorer", icon: Layers3 },
  { id: "playground", name: "Playground", icon: Terminal },
  { id: "keys", name: "API keys", icon: KeyRound },
  { id: "requests", name: "Request logs", icon: Activity },
  { id: "usage", name: "Usage & analytics", icon: ChartNoAxesCombined },
  { id: "quotas", name: "Tokens & limits", icon: Gauge },
  { id: "docs", name: "Documentation", icon: BookOpen },
  { id: "admin", name: "Administration", icon: ShieldCheck },
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

export default function Dashboard() {
  const [site, setSite] = useState<SiteOptions>(defaultSite);
  const [revision, setRevision] = useState(0);
  const [playgroundModel, setPlaygroundModel] = useState<Model | null>(null);
  const [explorerModels, setExplorerModels] = useState<Model[]>([]);
  const [explorerTotal, setExplorerTotal] = useState(0);
  const [requestLogs, setRequestLogs] = useState<Log[]>([]);
  const [requestTotal, setRequestTotal] = useState(0);
  const [freeOnly, setFreeOnly] = useState(false);
  const [view, setView] = useState<View>("home"),
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
  const [newProviderKind, setNewProviderKind] = useState("openrouter");
  const [authOpen, setAuthOpen] = useState(false),
    [providerModal, setProviderModal] = useState<Provider | "new" | null>(null),
    [modelModal, setModelModal] = useState<Model | "new" | null>(null),
    [keyModal, setKeyModal] = useState(false),
    [keyError, setKeyError] = useState(""),
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
  const [endpoint, setEndpoint] = useState("");
  const [toastTone, setToastTone] = useState<"success" | "error" | "info">(
    "success",
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const notify = useCallback(
    (s: string, tone: "success" | "error" | "info" = "success") => {
      setToastTone(tone);
      setToast(s);
    },
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    setEndpoint(window.location.origin + "/v1");
    const syncHash = () => {
      const hash = window.location.hash.slice(1) as View;
      if (!hash || hash === "home" || nav.some((n) => n.id === hash)) {
        setView(hash || "home");
        setMobile(false);
      }
    };
    syncHash();
    const outcome = new URLSearchParams(window.location.search).get(
      "connection",
    );
    if (["connected", "failed", "cancelled"].includes(outcome || "")) {
      notify(
        outcome === "connected"
          ? "OpenRouter connected. Your models are ready to explore."
          : outcome === "cancelled"
            ? "Provider sign-in cancelled."
            : "Provider sign-in could not finish. Please try connecting again.",
        outcome === "failed" ? "error" : "info",
      );
      const cleaned = new URL(window.location.href);
      cleaned.searchParams.delete("connection");
      window.history.replaceState(
        null,
        "",
        cleaned.pathname + cleaned.search + cleaned.hash,
      );
    }
    window.addEventListener("hashchange", syncHash);
    Promise.all([
      api<User>("/auth/me").catch(() => null),
      api<SiteOptions>("/site").catch(() => defaultSite),
    ])
      .then(([u, options]) => {
        setUser(u);
        setDemo(!u);
        setSite(options);
      })
      .finally(() => setReady(true));
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);
  useEffect(() => {
    document.title = `${nav.find((n) => n.id === view)?.name || "Welcome"} · ${site.site_name} AI Gateway`;
  }, [view, site.site_name]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);
  useEffect(() => {
    if (!mobile) return;
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setMobile(false);
      return;
    }
    const drawer = sidebarRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const getFocusable = () =>
      Array.from(
        drawer?.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled])",
        ) || [],
      );
    getFocusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMobile(false);
      }
      if (e.key !== "Tab") return;
      const elements = getFocusable();
      const first = elements[0],
        last = elements[elements.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    const media = window.matchMedia("(min-width: 1024px)");
    const onWide = () => {
      if (media.matches) setMobile(false);
    };
    document.addEventListener("keydown", onKey);
    media.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      media.removeEventListener("change", onWide);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [mobile]);
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
      setRevision((value) => value + 1);
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
        `/models?limit=100&offset=${modelPage * 100}&search=${encodeURIComponent(search)}&capability=${capability}&provider=${filterProvider}&free_only=${freeOnly}`,
      )
        .then((r) => {
          if (active) {
            setExplorerModels(r.data);
            setExplorerTotal(r.total);
          }
        })
        .catch((e) => notify(e.message, "error"));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    view,
    demo,
    search,
    capability,
    filterProvider,
    freeOnly,
    modelPage,
    notify,
    revision,
  ]);
  useEffect(() => {
    if (demo || view !== "requests") return;
    let active = true;
    api<Page<Log>>(`/logs?offset=${logPage * 25}&errors_only=${errorsOnly}`)
      .then((r) => {
        if (active) {
          setRequestLogs(r.data);
          setRequestTotal(r.total);
        }
      })
      .catch((e) => notify(e.message, "error"));
    return () => {
      active = false;
    };
  }, [view, demo, logPage, errorsOnly, notify, revision]);
  const p = demo ? demoProviders : providers,
    m = demo ? demoModels : models,
    k = demo ? demoKeys : keys,
    l = demo ? demoLogs : logs,
    u = demo ? demoUsage : usage;
  const displayedModels = demo
    ? m
        .filter(
          (x) =>
            (!search ||
              [x.name, x.model_id].some((v) =>
                v.toLowerCase().includes(search.toLowerCase()),
              )) &&
            (!capability || x.capabilities[capability]) &&
            (!filterProvider || x.provider_id === filterProvider),
          // Sample filtering follows the same free-price rule as the live catalog.
        )
        .filter(
          (x) =>
            !freeOnly ||
            x.shared ||
            (x.input_price === 0 && x.output_price === 0),
        )
    : explorerModels;
  const s = u.summary,
    successRate = s.requests
      ? (((s.successes || 0) / s.requests) * 100).toFixed(1)
      : "—";
  function openKeyModal() {
    setKeyError("");
    setKeyModal(true);
  }
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
      notify((err as Error).message, "error");
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
        loading={!ready || busy}
      />
      <Metric
        label="Average latency"
        value={duration(s.avg_latency_ms)}
        icon={Zap}
        detail="End-to-end request duration"
        loading={!ready || busy}
      />
      <Metric
        label="Success rate"
        value={successRate}
        suffix={s.requests ? "%" : ""}
        icon={ShieldCheck}
        detail={`${num(s.requests - (s.successes || 0))} failed requests`}
        loading={!ready || busy}
      />
      <Metric
        label="Estimated cost"
        value={s.estimated_cost == null ? "—" : money(s.estimated_cost)}
        icon={ChartNoAxesCombined}
        detail={`${num(s.priced_requests)} requests with known pricing`}
        loading={!ready || busy}
      />
    </div>
  );
  if (view === "home")
    return (
      <>
        <Landing site={site} user={user} onSignIn={() => setAuthOpen(true)} />
        {authOpen && (
          <AuthForm
            site={site}
            onClose={() => setAuthOpen(false)}
            onSuccess={(newUser, key) => {
              setUser(newUser);
              setDemo(false);
              setAuthOpen(false);
              if (key) setSecret(key);
              navigate("overview");
              notify("Welcome to your workspace");
            }}
          />
        )}
      </>
    );
  return (
    <div className="app-shell" data-accent={site.accent}>
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
      <aside
        ref={sidebarRef}
        id="workspace-navigation"
        className={`sidebar ${mobile ? "open" : ""}`}
        role={mobile ? "dialog" : undefined}
        aria-modal={mobile || undefined}
        aria-label="Workspace navigation"
      >
        <button
          className="icon-button drawer-close"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        >
          <X size={20} />
        </button>
        <a href="#home" className="brand" onClick={() => navigate("home")}>
          <span className="brand-mark">
            {site.site_name.slice(0, 1).toUpperCase()}
          </span>
          <span>
            {site.site_name.toLowerCase()}
            <span className="brand-period">.</span>
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
          <ShieldCheck size={16} className="muted" aria-hidden="true" />
        </div>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {nav.slice(0, 8).map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              onClick={() => setMobile(false)}
              className={`nav-link ${view === n.id ? "selected" : ""}`}
              aria-current={view === n.id ? "page" : undefined}
            >
              <n.icon size={18} />
              {n.name}
              {n.id === "providers" && (
                <span className="nav-count">{p.length}</span>
              )}
            </a>
          ))}
        </nav>
        {user?.is_admin && (
          <a
            href="#admin"
            onClick={() => setMobile(false)}
            className={`nav-link ${view === "admin" ? "selected" : ""}`}
            aria-current={view === "admin" ? "page" : undefined}
          >
            <ShieldCheck size={18} />
            Administration
          </a>
        )}
        <div className="sidebar-bottom">
          <a
            className={`nav-link ${view === "docs" ? "selected" : ""}`}
            href="#docs"
            onClick={() => setMobile(false)}
            aria-current={view === "docs" ? "page" : undefined}
          >
            <BookOpen size={18} />
            Documentation
            <ChevronRight size={14} />
          </a>
          <div className="user-bar">
            <span className="user-avatar">
              {demo ? "D" : user?.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{demo ? "Demo workspace" : user?.name}</strong>
              <small>{demo ? "Sample data · read only" : user?.email}</small>
            </span>
            {!demo && (
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={() => {
                  if (demo) setAuthOpen(true);
                  else
                    void api("/auth/logout", { method: "POST" })
                      .then(() => {
                        setUser(null);
                        setDemo(true);
                        setSecret("");
                        setPlaygroundModel(null);
                        notify("Signed out");
                      })
                      .catch((e) => notify(e.message, "error"));
                }}
              >
                <LogOut size={18} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="workspace-main" inert={mobile || undefined}>
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              ref={menuRef}
              className="icon-button menu-toggle"
              aria-controls="workspace-navigation"
              aria-expanded={mobile}
              onClick={() => {
                if (!window.matchMedia("(min-width: 1024px)").matches)
                  setMobile(true);
              }}
              aria-label="Open navigation"
            >
              <Menu size={22} />
            </button>
            <span className="topbar-label">
              {nav.find((n) => n.id === view)?.name}
            </span>
            {demo && (
              <span
                className="demo-pill"
                title="Illustrative sample data. Sign in for your own workspace."
              >
                <span className="demo-dot" />
                Demo<span className="demo-pill-detail"> workspace</span>
              </span>
            )}
          </div>
          <div className="topbar-actions">
            <a
              className="icon-button self-hosted"
              href="#docs"
              title="Self-hosted gateway · integration guide"
              aria-label="Integration guide"
            >
              <BookOpen size={17} />
            </a>
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
                aria-busy={busy}
              >
                <RefreshCw size={14} className={busy ? "spin" : ""} />
                Refresh
              </button>
            )}
          </div>
        </header>
        <main
          id="main-content"
          className={`content ${!ready || busy ? "is-loading" : ""}`}
          tabIndex={-1}
          aria-busy={!ready || busy}
        >
          {connectionError && (
            <Banner tone="error">
              <strong>Workspace couldn’t refresh.</strong> {connectionError}{" "}
              <button className="text-button" onClick={() => void load()}>
                Retry
              </button>
            </Banner>
          )}
          {(!ready || busy) && (
            <span className="sr-only" role="status">
              Loading workspace data…
            </span>
          )}
          {view === "overview" && (
            <>
              <div className="page-heading">
                <div>
                  <h1>Gateway overview</h1>
                  <p className="page-subtitle">
                    Monitor traffic, connections, and routing health.
                  </p>
                </div>
                <div className="heading-actions">
                  {selectDays}
                  <button
                    className="button primary"
                    onClick={() =>
                      requireAccount(() => {
                        setNewProviderKind("openrouter");
                        setProviderModal("new");
                      })
                    }
                  >
                    <Plus size={17} />
                    Connect provider
                  </button>
                </div>
              </div>
              {demo && (
                <div className="workspace-notice">
                  <span>
                    You're exploring sample data. Sign in to connect providers
                    or try community models.
                  </span>
                  <button
                    className="text-button"
                    onClick={() => setAuthOpen(true)}
                  >
                    Open your workspace <ArrowRight size={15} />
                  </button>
                </div>
              )}
              {!demo && !busy && !s.requests && (
                <div className="onboarding panel">
                  <div>
                    <h2>Make your first request</h2>
                    <p>
                      Choose a community model in the Playground, or connect
                      your own provider.
                    </p>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => navigate("playground")}
                  >
                    Open Playground <ArrowRight size={15} />
                  </button>
                  <button className="button" onClick={() => navigate("keys")}>
                    View your API keys
                  </button>
                </div>
              )}
              <div className="operational-strip">
                <span>
                  <span className="dot" />
                  {p.filter((x) => x.enabled).length} enabled{" "}
                  {p.filter((x) => x.enabled).length === 1
                    ? "connection"
                    : "connections"}
                </span>
                <span>
                  <ShieldCheck size={14} />
                  Your keys, encrypted
                </span>
                <span className="health-summary">
                  <Clock size={14} />
                  {
                    p.filter((x) => x.enabled && x.health.status === "cooldown")
                      .length
                  }{" "}
                  in cooldown
                </span>
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
                  <Topology
                    providers={p}
                    demo={demo}
                    siteName={site.site_name}
                  />
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
                      <ChevronRight size={14} className="provider-chevron" />
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
              <div className={`bottom-grid ${p.length ? "configured" : ""}`}>
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
                {!p.length && (
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
                      <code>
                        {endpoint || <Skeleton className="endpoint-skeleton" />}
                      </code>
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
                )}
              </div>
            </>
          )}
          {view === "providers" && (
            <>
              <PageHeading
                title="Your providers"
                subtitle="Connect once. Keep control of every credential and route."
                action={
                  <button
                    className="button primary"
                    onClick={() =>
                      requireAccount(() => {
                        setNewProviderKind("openrouter");
                        setProviderModal("new");
                      })
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
              <ProviderDirectory
                onConnect={(kind) =>
                  requireAccount(() => {
                    setNewProviderKind(kind);
                    setProviderModal("new");
                  })
                }
              />
              <div className="connections-heading">
                <h2>Connected accounts</h2>
                <button
                  className="text-button"
                  onClick={() => navigate("quotas")}
                >
                  Tokens & limits <ArrowRight size={15} />
                </button>
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
                        aria-pressed={provider.pinned}
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
                    {!!provider.preferred_models?.length && (
                      <div className="connection-preferences">
                        <small>
                          {provider.preferred_only
                            ? "Automatic routing limited to"
                            : "Preferred model order"}
                        </small>
                        <ol>
                          {provider.preferred_models.slice(0, 3).map((mid) => (
                            <li className="mono" key={mid}>
                              {mid}
                            </li>
                          ))}
                        </ol>
                        {provider.preferred_models.length > 3 && (
                          <small>
                            +{provider.preferred_models.length - 3} more
                          </small>
                        )}
                      </div>
                    )}
                    {provider.discovery_error && (
                      <Banner tone="error">{provider.discovery_error}</Banner>
                    )}
                    <p className="form-note provider-health-note">
                      Connection health reflects recent routing state;
                      individual models may have different access or limits.
                    </p>
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
                  onClick={() =>
                    requireAccount(() => {
                      setNewProviderKind("openrouter");
                      setProviderModal("new");
                    })
                  }
                >
                  <span className="add-circle">
                    <Plus size={25} />
                  </span>
                  <h2>Connect another provider</h2>
                  <p>
                    Cloud models or your own endpoint.
                    <br />
                    Same simple connection.
                  </p>
                  <div className="provider-symbols">
                    {[
                      "openrouter",
                      "groq",
                      "google",
                      "anthropic",
                      "nvidia",
                    ].map((kind) => (
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
              <div
                className={`filter-bar model-filters ${filtersOpen ? "expanded" : ""}`}
              >
                <label className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="Search models"
                    placeholder="Search models…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setModelPage(0);
                    }}
                  />
                </label>
                <button
                  className="button filters-toggle"
                  aria-expanded={filtersOpen}
                  aria-controls="model-filter-controls"
                  onClick={() => setFiltersOpen(!filtersOpen)}
                >
                  <Settings2 size={16} />
                  Filters
                  {(capability || filterProvider) && (
                    <span className="dot violet" />
                  )}
                </button>
                <div className="filter-controls" id="model-filter-controls">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={freeOnly}
                      onChange={(e) => {
                        setFreeOnly(e.target.checked);
                        setModelPage(0);
                      }}
                    />
                    Free only
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
              </div>
              <div className="table-note">
                <span>
                  {demo ? displayedModels.length : explorerTotal} models{" "}
                  <span className="mid-dot">·</span> Prices in USD per million
                  tokens
                </span>
                <span>— means unknown</span>
              </div>
              <section className="panel table-panel">
                <div className="table-scroll">
                  <table role="table" className="responsive-table model-table">
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
                        <tr key={model.id} role="row">
                          <td className="model-identity" role="cell">
                            <div className="model-cell">
                              <ProviderIcon kind={model.provider} small />
                              <div>
                                <strong>{model.name}</strong>
                                <small title={model.model_id}>
                                  {model.model_id}
                                </small>
                                <span>{model.provider_name}</span>
                                {model.shared && (
                                  <Badge tone="green">Community · Free</Badge>
                                )}
                              </div>
                            </div>
                          </td>
                          <td data-label="Capabilities" role="cell">
                            <Capabilities values={model.capabilities} />
                          </td>
                          <td className="mono" data-label="Context" role="cell">
                            {num(model.context_window)}
                          </td>
                          <td data-label="Input / Output · $ / 1M" role="cell">
                            <Price value={model.input_price} />
                            <span className="muted"> / </span>
                            <Price value={model.output_price} />
                          </td>
                          <td data-label="Availability" role="cell">
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
                          <td
                            className="model-actions"
                            data-label="Model actions"
                            role="cell"
                          >
                            <div className="row-actions">
                              <button
                                className="icon-button"
                                aria-label={`Try ${model.name} in Playground`}
                                title="Try in Playground"
                                disabled={
                                  !model.enabled ||
                                  !model.available ||
                                  model.capabilities.chat === false
                                }
                                onClick={() => {
                                  setPlaygroundModel(model);
                                  navigate("playground");
                                }}
                              >
                                <Terminal size={16} />
                              </button>
                              <button
                                className={`icon-button ${model.favorite ? "accent" : ""}`}
                                aria-label={`Favorite ${model.name}`}
                                aria-pressed={model.favorite}
                                disabled={model.owned === false}
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
                                aria-label={`Configure ${model.name}`}
                                disabled={model.owned === false}
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
                    headingLevel={2}
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
                    total={demo ? displayedModels.length : explorerTotal}
                    setPage={setModelPage}
                  />
                </div>
              </section>
            </>
          )}
          {view === "playground" && (
            <Playground
              key={user?.id || "demo"}
              demo={demo}
              providers={p}
              models={m}
              requireAccount={requireAccount}
              notify={notify}
              onFinish={load}
              initialModel={playgroundModel}
              defaults={site}
            />
          )}
          {view === "keys" && (
            <>
              <PageHeading
                title="Gateway API keys"
                subtitle="One key connects your agents to every provider in this workspace."
                action={
                  <button
                    className="button primary"
                    onClick={() => requireAccount(() => openKeyModal())}
                  >
                    <Plus size={17} />
                    Create API key
                  </button>
                }
              />
              <div className="info-row">
                <LockKeyhole size={16} />
                <span>
                  Keys are shown only once. Save each new key before closing.
                </span>
                <Badge>
                  {k.filter((key) => !key.revoked).length}{" "}
                  {k.filter((key) => !key.revoked).length === 1
                    ? "key"
                    : "keys"}
                </Badge>
              </div>
              <section className="panel table-panel">
                <div className="table-scroll">
                  <table role="table" className="responsive-table keys-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Key prefix</th>
                        <th>Created</th>
                        <th>Last used</th>
                        <th>Expires</th>
                        <th>Status</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {k.map((key) => (
                        <tr key={key.id} role="row">
                          <td data-label="Name">
                            <strong>{key.name}</strong>
                          </td>
                          <td data-label="Key prefix">
                            <code>{key.prefix}••••••</code>
                          </td>
                          <td data-label="Created">{stamp(key.created_at)}</td>
                          <td data-label="Last used">
                            {stamp(key.last_used_at)}
                          </td>
                          <td data-label="Expires">
                            {key.expires_at
                              ? stamp(key.expires_at)
                              : "No expiration"}
                          </td>
                          <td data-label="Status">
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
                          <td className="key-actions" data-label="Access">
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
                    headingLevel={2}
                    text="Give each agent or environment a separate key so you can revoke access independently."
                    action="Create API key"
                    onAction={() => openKeyModal()}
                  />
                )}
              </section>
            </>
          )}
          {view === "requests" && (
            <>
              <PageHeading
                title="Request history"
                subtitle="Inspect routing decisions, timing, token usage, and fallback attempts."
                action={
                  <a
                    className="button"
                    href="/api/usage/export"
                    onClick={(event) => {
                      if (demo) {
                        event.preventDefault();
                        setAuthOpen(true);
                      }
                    }}
                  >
                    <ArrowDownToLine size={16} />
                    Export CSV
                  </a>
                }
              />
              <div className="filter-bar">
                <div className="segmented">
                  <button
                    className={!errorsOnly ? "active" : ""}
                    aria-pressed={!errorsOnly}
                    onClick={() => {
                      setErrorsOnly(false);
                      setLogPage(0);
                    }}
                  >
                    All requests
                  </button>
                  <button
                    className={errorsOnly ? "active" : ""}
                    aria-pressed={errorsOnly}
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
                    demo
                      ? errorsOnly
                        ? l.filter((x) => x.status >= 400)
                        : l
                      : requestLogs
                  }
                  onSelect={setSelectedLog}
                />
                <div className="table-footer">
                  <span>{demo ? l.length : requestTotal} requests</span>
                  <Pagination
                    page={logPage}
                    size={25}
                    total={demo ? l.length : requestTotal}
                    setPage={setLogPage}
                  />
                </div>
              </section>
            </>
          )}
          {view === "quotas" && (
            <QuotaPanel
              key={user?.id || "demo"}
              demo={demo}
              onSignIn={() => setAuthOpen(true)}
            />
          )}
          {view === "usage" && (
            <>
              <PageHeading
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
                  <a
                    className="text-button"
                    href={`/api/usage/export?days=${days}`}
                    onClick={(event) => {
                      if (demo) {
                        event.preventDefault();
                        setAuthOpen(true);
                      }
                    }}
                  >
                    <ArrowDownToLine size={15} />
                    Export usage
                  </a>
                </section>
              </div>
            </>
          )}
          {view === "docs" && (
            <Documentation endpoint={endpoint} notify={notify} />
          )}
          {view === "admin" &&
            (user?.is_admin ? (
              <AdminPanel
                user={user}
                onSettings={setSite}
                notify={notify}
                onConnect={() => setProviderModal("new")}
                onRegisterModel={() => setModelModal("new")}
                revision={revision}
              />
            ) : (
              <>
                <PageHeading
                  title="Administration"
                  subtitle="Restricted to administrator accounts."
                />
                <Empty
                  title="Administrator access required"
                  headingLevel={2}
                  text={
                    demo
                      ? "Sign in with your administrator account to manage the site."
                      : "Your account does not have an administrator role. Roles are granted on the gateway server."
                  }
                  action={demo ? "Sign in" : undefined}
                  onAction={() => setAuthOpen(true)}
                />
              </>
            ))}
          <footer className="page-footer">
            <span>
              <span className="brand-mark tiny">
                {site.site_name.slice(0, 1).toUpperCase()}
              </span>
              {site.site_name} · {site.tagline}
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
        <div
          className={`toast ${toastTone}`}
          role={toastTone === "error" ? "alert" : "status"}
        >
          {toastTone === "error" ? (
            <TriangleAlert size={18} />
          ) : toastTone === "info" ? (
            <CircleHelp size={18} />
          ) : (
            <Check size={18} />
          )}
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
          site={site}
          onClose={() => setAuthOpen(false)}
          onSuccess={(newUser, key) => {
            setUser(newUser);
            setPlaygroundModel(null);
            setDemo(false);
            setAuthOpen(false);
            if (key) setSecret(key);
            notify("Welcome to your workspace");
          }}
        />
      )}
      {providerModal && (
        <ProviderForm
          initialKind={newProviderKind}
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
              setKeyError("");
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
                setKeyError((err as Error).message);
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
            {keyError && <Banner tone="error">{keyError}</Banner>}
            <Banner>
              The full key is only shown after creation. Store it securely
              before closing.
            </Banner>
            <button className="button primary" disabled={busy} aria-busy={busy}>
              {busy && <LoaderCircle className="spin" size={16} />} Create key
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
                Gateway HTTP {selectedLog.status}
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
                <dd>{duration(selectedLog.latency_ms)}</dd>
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
                    Provider HTTP {a.status}
                  </Badge>
                  <span className="mono">{duration(a.latency_ms)}</span>
                </div>
              ))}
              {!selectedLog.attempts.length && (
                <p className="muted">No upstream attempt was made.</p>
              )}
            </div>
            {selectedLog.error_code && (
              <Banner tone="error">
                <span>
                  {errorGuidance(
                    selectedLog.attempts.at(-1)?.status || selectedLog.status,
                    selectedLog.error_code,
                  )}
                </span>
                <details>
                  <summary>Technical details</summary>
                  <code>{selectedLog.error_code}</code>
                </details>
              </Banner>
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

function Metric({
  label,
  value,
  suffix,
  detail,
  icon: Icon,
  loading = false,
}: {
  label: string;
  value: string;
  suffix?: string;
  detail: string;
  icon: typeof Activity;
  loading?: boolean;
}) {
  return (
    <section className="stat-card">
      <div className="stat-label">
        {label}
        <Icon size={16} />
      </div>
      <div className="stat-main">
        <strong>
          {loading ? (
            <Skeleton className="stat-skeleton" />
          ) : (
            <>
              {value}
              <span>{suffix}</span>
            </>
          )}
        </strong>
      </div>
      <p>{detail}</p>
    </section>
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
