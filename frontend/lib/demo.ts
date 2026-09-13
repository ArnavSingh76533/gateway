import { Provider, Model, Usage, Log, GatewayKey, providerInfo } from "./api";
// Fixed illustrative dates keep the static export and first client render consistent.
const now = Date.UTC(2026, 8, 12, 12) / 1000;
export const demoProviders: Provider[] = [
  "openrouter",
  "groq",
  "google",
  "huggingface",
  "together",
  "fireworks",
].map((kind, i) => ({
  id: `demo-${kind}`,
  kind,
  name: providerInfo[kind].name,
  base_url: providerInfo[kind].url,
  enabled: i !== 5,
  priority: i + 1,
  pinned: i === 0,
  models_count: [84, 14, 22, 48, 31, 18][i],
  discovered_at: now - 420,
  discovery_error: null,
  health:
    i === 2
      ? { status: "cooldown", http_status: 429, retry_at: now + 30 }
      : {
          status: i === 5 ? "disabled" : "healthy",
          latency_ms: [640, 182, 850, 940, 720, 450][i],
        },
}));
export const demoModels: Model[] = [
  ["Llama 3.3 70B", "llama-3.3-70b-versatile", "groq", 128000, 0.59, 0.79],
  ["Gemini 2.5 Flash", "gemini-2.5-flash", "google", 1048576, 0.3, 2.5],
  [
    "DeepSeek V3.1",
    "deepseek/deepseek-chat-v3.1",
    "openrouter",
    128000,
    0.2,
    0.8,
  ],
  [
    "Qwen3 Coder",
    "Qwen/Qwen3-Coder-480B-A35B-Instruct",
    "huggingface",
    256000,
    null,
    null,
  ],
  [
    "Llama 4 Maverick",
    "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
    "together",
    1048576,
    0.27,
    0.85,
  ],
  ["GPT OSS 120B", "openai/gpt-oss-120b", "groq", 131072, 0.15, 0.75],
].map((a, i) => ({
  id: `demo-model-${i}`,
  name: String(a[0]),
  model_id: String(a[1]),
  provider: String(a[2]),
  provider_name: providerInfo[String(a[2])].name,
  provider_id: `demo-${a[2]}`,
  route_id: `demo-${a[2]}::${a[1]}`,
  context_window: Number(a[3]),
  input_price: a[4] as number | null,
  output_price: a[5] as number | null,
  available: true,
  enabled: true,
  favorite: i === 0,
  manual: false,
  source: "Illustrative demo metadata",
  capabilities: {
    chat: true,
    tools: true,
    streaming: true,
    json_mode: true,
    vision: i === 1 || i === 4,
    reasoning: i === 1 || i === 5,
    coding: i === 3,
  },
  health: { status: "healthy", latency_ms: [182, 640, 950, 760, 450, 220][i] },
}));
export const demoUsage: Usage = {
  days: 7,
  summary: {
    requests: 24819,
    successes: 24670,
    avg_latency_ms: 482,
    input_tokens: 6231000,
    output_tokens: 2186000,
    estimated_cost: 8.42,
    priced_requests: 21481,
  },
  series: [1960, 2830, 2190, 4230, 3570, 4920, 5119].map((requests, i) => ({
    day: Math.floor(now / 86400) - 6 + i,
    requests,
    successes: requests - [7, 11, 18, 56, 28, 17, 12][i],
    avg_latency_ms: [570, 490, 520, 610, 460, 430, 482][i],
    input_tokens: requests * 251,
    output_tokens: requests * 88,
    estimated_cost: requests * 0.00034,
    priced_requests: Math.round(requests * 0.86),
  })),
  providers: demoProviders.slice(0, 4).map((p, i) => ({
    provider_name: p.name,
    requests: [12330, 7910, 3400, 1179][i],
    successes: [12300, 7880, 3330, 1160][i],
    avg_latency_ms: [620, 182, 830, 940][i],
    input_tokens: 1231000,
    output_tokens: 218600,
    estimated_cost: [3.16, 1.85, 2.45, 0.96][i],
    priced_requests: 1000,
  })),
};
export const demoLogs: Log[] = Array.from({ length: 8 }, (_, i) => ({
  id: `req_demo_${i + 1}`,
  provider_name: demoProviders[i % 4].name,
  requested_model: i % 3 === 0 ? "auto/coding" : "auto",
  resolved_model: demoModels[i % 6].model_id,
  endpoint: "chat/completions",
  status: i === 5 ? 429 : 200,
  latency_ms: [182, 634, 820, 241, 508, 1240, 312, 466][i],
  input_tokens: 342 + i * 42,
  output_tokens: 218 + i * 16,
  estimated_cost: i === 5 ? null : 0.00042 + i * 0.0001,
  attempts:
    i === 2
      ? [
          {
            provider: "google",
            provider_name: "Google AI Studio",
            model: "gemini-2.5-flash",
            status: 429,
            latency_ms: 92,
          },
          {
            provider: "openrouter",
            provider_name: "OpenRouter",
            model: "deepseek/deepseek-chat-v3.1",
            status: 200,
            latency_ms: 728,
          },
        ]
      : [
          {
            provider: demoProviders[i % 4].kind,
            provider_name: demoProviders[i % 4].name,
            model: demoModels[i % 6].model_id,
            status: i === 5 ? 429 : 200,
            latency_ms: 182,
          },
        ],
  error_code: i === 5 ? "rate_limit_exceeded" : null,
  created_at: now - i * 540,
}));
export const demoKeys: GatewayKey[] = [
  {
    id: "demo-key",
    name: "Production agents",
    prefix: "gw_demo_•••",
    created_at: now - 86400 * 12,
    last_used_at: now - 32,
    expires_at: null,
    revoked: false,
  },
];
