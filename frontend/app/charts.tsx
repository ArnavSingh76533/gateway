"use client";
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
import { Usage, num } from "@/lib/api";

const tooltipStyle = {
  background: "var(--overlay)",
  border: "1px solid var(--border-strong)",
  borderRadius: 10,
  color: "var(--text)",
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
    date: new Date(d.day * 86400000).toLocaleDateString("en-US", {
      timeZone: "UTC",
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
                stopColor={
                  metric === "errors" ? "var(--danger)" : "var(--accent)"
                }
                stopOpacity={0.28}
              />
              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="var(--border)"
            strokeDasharray="3 5"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--text-3)", fontSize: 12 }}
            tickMargin={14}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--text-3)", fontSize: 12 }}
            tickFormatter={(v) => num(v)}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ stroke: "var(--accent)" }}
          />
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
            stroke={metric === "errors" ? "var(--danger)" : "var(--accent)"}
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
            tick={{ fill: "var(--text-2)", fontSize: 12 }}
          />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar
            dataKey="requests"
            name="Requests"
            fill="var(--accent)"
            radius={[0, 4, 4, 0]}
            barSize={16}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
