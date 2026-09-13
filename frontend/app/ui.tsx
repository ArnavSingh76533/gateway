"use client";
import { useEffect, useRef, useId, useState, ReactNode } from "react";
import {
  X,
  Copy,
  Check,
  TriangleAlert,
  Plus,
  Activity,
  Info,
  CircleCheck,
  CirclePause,
  Clock,
  Eye,
  Wrench,
  Brain,
  Image,
  Mic,
  Braces,
  MessageSquare,
  Database,
  Radio,
  Code2,
} from "lucide-react";
import dynamic from "next/dynamic";
import { Provider, providerInfo, money } from "@/lib/api";

export function ProviderIcon({
  kind,
  small = false,
}: {
  kind: string;
  small?: boolean;
}) {
  const initials: Record<string, string> = {
    openrouter: "OR",
    groq: "GQ",
    google: "GA",
    huggingface: "HF",
    together: "TA",
    fireworks: "FW",
    custom: "CE",
  };
  return (
    <span
      className={`provider-icon ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      {initials[kind] || "AI"}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    const viewport = window.visualViewport;
    const syncViewport = () => {
      dialog?.style.setProperty(
        "--dialog-viewport",
        `${viewport?.height || window.innerHeight}px`,
      );
      dialog?.style.setProperty(
        "--dialog-offset",
        `${viewport?.offsetTop || 0}px`,
      );
    };
    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    return () => {
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      dialog?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({
  title,
  text,
  action,
  onAction,
  headingLevel = 3,
}: {
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="empty">
      <span className="empty-icon">
        <Activity size={25} />
      </span>
      <Heading>{title}</Heading>
      <p>{text}</p>
      {action && (
        <button className="button primary" onClick={onAction}>
          <Plus size={16} />
          {action}
        </button>
      )}
    </div>
  );
}
export function CopyButton({
  value,
  onCopy,
  label = "Copy",
}: {
  value: string;
  onCopy: (s: string) => void;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="button subtle"
      aria-label={copied ? "Copied" : label || "Copy to clipboard"}
      disabled={!value}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          onCopy("Copied to clipboard");
        } catch {
          onCopy("Clipboard unavailable. Select and copy the text.");
        }
      }}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {label && (copied ? "Copied" : label)}
    </button>
  );
}
export function Banner({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <div
      className={`banner ${tone}`}
      role={tone === "error" ? "alert" : "note"}
    >
      {tone === "error" ? <TriangleAlert size={18} /> : <Info size={18} />}
      <span>{children}</span>
    </div>
  );
}
export function CheckRow({ children }: { children: ReactNode }) {
  return (
    <div className="check-row">
      <Check size={16} />
      {children}
    </div>
  );
}

export function Topology({
  providers,
  demo,
  siteName = "Nexus",
}: {
  providers: Provider[];
  demo: boolean;
  siteName?: string;
}) {
  const active = providers.filter((p) => p.enabled).slice(0, 3);
  return (
    <div className="topology">
      <div className="topology-client">
        <span className="tiny-caps">YOUR APPLICATIONS</span>
        <div className="client-types">
          <span>Agents</span>
          <span>Apps</span>
          <span>SDKs</span>
        </div>
      </div>
      <div className="route-line" />
      <div className="gateway-node">
        <span className="brand-mark mini">
          {siteName.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <strong>{siteName} gateway</strong>
          <small>One endpoint · your keys</small>
        </div>
        <span className="node-tag">/v1</span>
      </div>
      <div className="route-fan">
        <svg viewBox="0 0 300 35" preserveAspectRatio="none" aria-hidden="true">
          <path d="M150 0V15M50 35V15H250V35M150 15V35" />
        </svg>
      </div>
      <div className="topology-providers">
        {active.length ? (
          active.map((p) => (
            <div key={p.id}>
              <ProviderIcon kind={p.kind} small />
              <span>{providerInfo[p.kind].name}</span>
            </div>
          ))
        ) : (
          <span className="muted">
            Connect your first provider to build a route.
          </span>
        )}
      </div>
      <div className="topology-footer">
        <span className="dot" />
        {demo
          ? "Example routing topology"
          : `${providers.filter((p) => p.enabled).length} enabled ${providers.filter((p) => p.enabled).length === 1 ? "connection" : "connections"}`}
      </div>
    </div>
  );
}
export function Price({ value }: { value: number | null }) {
  return (
    <span className={value === null ? "muted" : "mono"}>
      {value === null ? "—" : money(value)}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}
export const TrafficChart = dynamic(
  () => import("./charts").then((m) => m.TrafficChart),
  {
    ssr: false,
    loading: () => (
      <div className="chart chart-loading">
        <Skeleton />
      </div>
    ),
  },
);
export const ProviderChart = dynamic(
  () => import("./charts").then((m) => m.ProviderChart),
  {
    ssr: false,
    loading: () => (
      <div className="chart compact chart-loading">
        <Skeleton />
      </div>
    ),
  },
);
export function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="toggle-row"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span>{label}</span>
      <span
        className={`switch-track ${checked ? "on" : ""}`}
        aria-hidden="true"
      >
        <span />
      </span>
    </button>
  );
}
const capabilityIcons = [
  ["chat", "Chat", MessageSquare],
  ["tools", "Tools", Wrench],
  ["vision", "Vision", Eye],
  ["reasoning", "Reasoning", Brain],
  ["coding", "Coding", Code2],
  ["json_mode", "JSON", Braces],
  ["streaming", "Streaming", Radio],
  ["embeddings", "Embeddings", Database],
  ["images", "Images", Image],
  ["audio", "Audio", Mic],
  ["speech", "Speech", Mic],
  ["transcription", "Transcription", Mic],
  ["responses", "Responses", MessageSquare],
] as const;
export function Capabilities({
  values,
}: {
  values: Record<string, boolean | null>;
}) {
  const supported = capabilityIcons.filter(([key]) => values[key] === true);
  return (
    <div className="capability-badges">
      {supported.length ? (
        supported.map(([key, label, Icon]) => (
          <span
            key={key}
            className="capability-chip"
            title={`${label} supported`}
          >
            <Icon size={13} aria-hidden="true" />
            {label}
          </span>
        ))
      ) : (
        <span className="muted">Capabilities unconfirmed</span>
      )}
    </div>
  );
}
export function ProviderStatus({ p }: { p: Provider }) {
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
  const healthy = ["Healthy", "Connected"].includes(state);
  const warning = ["Cooldown", "Check key", "High latency"].includes(state);
  const Icon = healthy ? CircleCheck : warning ? CirclePause : Clock;
  return (
    <Badge tone={healthy ? "green" : warning ? "amber" : "neutral"}>
      <Icon size={12} aria-hidden="true" />
      {state}
    </Badge>
  );
}

export function PageHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      <div className="heading-actions">{action}</div>
    </div>
  );
}
