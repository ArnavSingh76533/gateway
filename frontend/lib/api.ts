export type User = {
  id: string;
  name: string;
  email: string;
  is_admin?: boolean;
};
export type Health = {
  status?: string;
  latency_ms?: number;
  retry_at?: number;
  http_status?: number;
};
export type Provider = {
  id: string;
  kind: string;
  name: string;
  base_url: string;
  enabled: boolean;
  priority: number;
  pinned: boolean;
  models_count: number;
  discovered_at: number | null;
  discovery_error: string | null;
  health: Health;
};
export type Model = {
  shared?: boolean;
  owned?: boolean;
  id: string;
  model_id: string;
  name: string;
  provider: string;
  provider_name: string;
  provider_id: string;
  route_id: string;
  capabilities: Record<string, boolean | null>;
  context_window: number | null;
  input_price: number | null;
  output_price: number | null;
  available: boolean;
  enabled: boolean;
  favorite: boolean;
  manual: boolean;
  source: string;
  health: Health;
};
export type GatewayKey = {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked: boolean;
};
export type Attempt = {
  provider: string;
  provider_name: string;
  model: string;
  status: number;
  latency_ms: number;
  error?: string;
};
export type Log = {
  id: string;
  provider_name: string | null;
  requested_model: string;
  resolved_model: string | null;
  endpoint: string;
  status: number;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost: number | null;
  attempts: Attempt[];
  error_code: string | null;
  created_at: number;
};
export type Metrics = {
  requests: number;
  successes: number | null;
  avg_latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost: number | null;
  priced_requests: number;
};
export type Usage = {
  summary: Metrics;
  series: (Metrics & { day: number })[];
  providers: (Metrics & { provider_name: string })[];
  days: number;
};
export type Page<T> = { data: T[]; total: number };
export const providerInfo: Record<
  string,
  { name: string; symbol: string; color: string; url: string }
> = {
  openrouter: {
    name: "OpenRouter",
    symbol: "↗",
    color: "#a58af5",
    url: "https://openrouter.ai/api/v1",
  },
  groq: {
    name: "Groq",
    symbol: "g",
    color: "#f59a76",
    url: "https://api.groq.com/openai/v1",
  },
  google: {
    name: "Google AI Studio",
    symbol: "✦",
    color: "#8baaff",
    url: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  huggingface: {
    name: "Hugging Face",
    symbol: "H",
    color: "#e3bd6a",
    url: "https://router.huggingface.co/v1",
  },
  together: {
    name: "Together AI",
    symbol: "t",
    color: "#9bcbe8",
    url: "https://api.together.ai/v1",
  },
  fireworks: {
    name: "Fireworks AI",
    symbol: "✳",
    color: "#e494d7",
    url: "https://api.fireworks.ai/inference/v1",
  },
  custom: { name: "Custom endpoint", symbol: "⌘", color: "#a9b3ba", url: "" },
};
export function csrf(): string {
  return typeof document === "undefined"
    ? ""
    : decodeURIComponent(
        document.cookie
          .split("; ")
          .find((x) => x.startsWith("gw_csrf="))
          ?.split("=")[1] || "",
      );
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch("/api" + path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf(),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ApiError(
      error?.error?.message || `Request failed (${response.status})`,
      response.status,
      error?.error?.code,
    );
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
export function num(value: number | null | undefined): string {
  return value == null
    ? "—"
    : Intl.NumberFormat("en", {
        notation: value >= 10000 ? "compact" : "standard",
        maximumFractionDigits: 1,
      }).format(value);
}
export function money(value: number | null | undefined): string {
  return value == null
    ? "Unknown"
    : `$${value.toFixed(value > 0 && value < 0.01 ? 5 : 2)}`;
}
export function duration(value: number | null | undefined): string {
  if (value == null) return "—";
  return value >= 1000
    ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s`
    : `${Math.round(value)} ms`;
}

export async function loadAllModels(
  signal?: AbortSignal,
  ownedOnly = false,
): Promise<Model[]> {
  const models = new Map<string, Model>();
  let offset = 0;
  while (true) {
    const page = await api<Page<Model>>(
      `/models?limit=1000&offset=${offset}${ownedOnly ? "&owned_only=true" : ""}`,
      { signal },
    );
    page.data.forEach((model) => models.set(model.id, model));
    offset += page.data.length;
    if (offset >= page.total) {
      if (models.size < page.total)
        throw new Error(
          "The catalog changed while loading. Refresh models to try again.",
        );
      return [...models.values()];
    }
    if (!page.data.length)
      throw new Error(
        "The complete catalog could not be loaded. Refresh models to try again.",
      );
  }
}
export function stamp(value: number | null | undefined): string {
  return value
    ? new Date(value * 1000).toLocaleString("en-US", {
        timeZone: "UTC",
        timeZoneName: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Never";
}
