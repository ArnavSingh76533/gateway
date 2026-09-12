"use client";
import { useEffect, useRef, ReactNode } from "react";
import { X, Copy, Check, TriangleAlert, Plus, Activity } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
  BarChart,
  Bar,
} from "recharts";
import { Usage, Provider, providerInfo, num, money } from "@/lib/api";

export function ProviderIcon({
  kind,
  small = false,
}: {
  kind: string;
  small?: boolean;
}) {
  const p = providerInfo[kind] || providerInfo.custom;
  return (
    <span
      className={`provider-icon ${small ? "small" : ""}`}
      style={{
        color: p.color,
        background: p.color + "12",
        borderColor: p.color + "26",
      }}
    >
      {p.symbol}
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
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
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
}: {
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Activity size={25} />
      </span>
      <h3>{title}</h3>
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
  return (
    <button
      className="button subtle"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          onCopy("Copied to clipboard");
        } catch {
          onCopy("Clipboard unavailable. Select and copy the text.");
        }
      }}
    >
      <Copy size={14} />
      {label}
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
    <div className={`banner ${tone}`}>
      <TriangleAlert size={16} />
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

const tooltipStyle = {
  background: "#1c1d26",
  border: "1px solid #3b3d4b",
  borderRadius: 10,
  color: "#efedf5",
  fontSize: 14,
};
export function TrafficChart({
  usage,
  metric = "requests",
}: {
  usage: Usage;
  metric?: "requests" | "latency" | "errors";
}) {
  const data = usage.series.map((d) => ({
    date: new Date(d.day * 86400000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    value:
      metric === "requests"
        ? d.requests
        : metric === "latency"
          ? d.avg_latency_ms
          : d.requests - (d.successes || 0),
  }));
  return (
    <div
      className="chart"
      role="img"
      aria-label={`${metric} over the selected period`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ left: -18, right: 12, top: 14, bottom: 0 }}
        >
          <defs>
            <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={metric === "errors" ? "#e19a82" : "#a38cff"}
                stopOpacity={0.28}
              />
              <stop offset="95%" stopColor="#a38cff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="#242630"
            strokeDasharray="3 5"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#85899d", fontSize: 12 }}
            tickMargin={14}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#85899d", fontSize: 12 }}
            tickFormatter={(v) => num(v)}
          />
          <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "#6c5d99" }} />
          <Area
            type="monotone"
            dataKey="value"
            name={
              metric === "latency"
                ? "Latency (ms)"
                : metric === "errors"
                  ? "Errors"
                  : "Requests"
            }
            stroke={metric === "errors" ? "#e19a82" : "#ad98ff"}
            strokeWidth={2.5}
            fill={`url(#fill-${metric})`}
            isAnimationActive={false}
            connectNulls={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function ProviderChart({ usage }: { usage: Usage }) {
  return (
    <div className="chart compact" role="img" aria-label="Requests by provider">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={usage.providers}
          layout="vertical"
          margin={{ left: 10, right: 25 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            width={115}
            dataKey="provider_name"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#b5b7c6", fontSize: 12 }}
          />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar
            dataKey="requests"
            name="Requests"
            fill="#9d87df"
            radius={[0, 4, 4, 0]}
            barSize={16}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
export function Topology({
  providers,
  demo,
}: {
  providers: Provider[];
  demo: boolean;
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
        <span className="brand-mark mini">N</span>
        <div>
          <strong>Nexus gateway</strong>
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
          : `${providers.filter((p) => p.enabled).length} enabled connections`}
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
