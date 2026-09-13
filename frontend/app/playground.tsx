"use client";
import { useEffect, useRef, useState } from "react";
import {
  Terminal,
  Settings2,
  ChevronDown,
  LockKeyhole,
  ArrowUp,
  Square,
  Sparkles,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { ApiError, csrf, Model, Provider } from "@/lib/api";
import { Badge, Banner, CopyButton, PageHeading, Toggle } from "./ui";
const modes = [
  "auto",
  "fastest",
  "cheapest",
  "reasoning",
  "coding",
  "vision",
  "manual",
];
export default function Playground({
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [requestError, setRequestError] = useState<{
    message: string;
    status?: number;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => setSettingsOpen(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => () => controller.current?.abort(), []);
  async function run() {
    setRunning(true);
    setOutput("");
    setRequestError(null);
    setInfo("Connecting to your gateway…");
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
        const e = await response.json().catch(() => null);
        throw new ApiError(
          e?.error?.message || "The gateway could not complete this request.",
          response.status,
        );
      }
      setInfo(
        [
          response.headers.get("X-Gateway-Provider"),
          response.headers.get("X-Gateway-Model"),
          response.headers.get("X-Gateway-Attempts")
            ? `${response.headers.get("X-Gateway-Attempts")} attempt(s)`
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Request accepted",
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
        setRequestError({
          message: (err as Error).message,
          status: err instanceof ApiError ? err.status : undefined,
        });
      }
    } finally {
      setRunning(false);
      void onFinish();
    }
  }
  return (
    <>
      <PageHeading
        title="Playground"
        subtitle={
          demo
            ? "Explore settings. Sign in to send real requests."
            : "Send a request and inspect the selected route."
        }
        action={
          <Badge tone="purple">
            <Terminal size={14} />
            Chat completions
          </Badge>
        }
      />
      <div className="playground-grid">
        <section className="panel playground-settings">
          <button
            className="settings-summary"
            aria-expanded={settingsOpen}
            aria-controls="route-settings"
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            <Settings2 size={18} />
            <span>
              <strong>Request settings</strong>
              <small>
                {mode[0].toUpperCase() + mode.slice(1)} ·{" "}
                {providers.find((p) => p.id === provider)?.name ||
                  "All providers"}{" "}
                · {retries} retries
              </small>
            </span>
            <ChevronDown size={18} />
          </button>
          <div
            className="form settings-fields"
            id="route-settings"
            hidden={!settingsOpen}
          >
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
            <Toggle
              label="Stream response"
              checked={stream}
              onChange={setStream}
            />
            <Toggle
              label="Allow alternative models"
              checked={alternatives}
              onChange={setAlternatives}
            />
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
            <details className="system-instruction">
              <summary>
                System instruction <span>Optional</span>
              </summary>
              <label>
                <span className="sr-only">System instruction</span>
                <textarea
                  rows={2}
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                />
              </label>
            </details>
            <label>
              Your message
              <textarea
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    (e.ctrlKey || e.metaKey) &&
                    e.key === "Enter" &&
                    prompt.trim() &&
                    !running
                  ) {
                    e.preventDefault();
                    requireAccount(() => void run());
                  }
                }}
                placeholder="Ask something…"
              />
            </label>
            <div className="compose-actions">
              <span
                className="privacy-note"
                title="Prompts and responses are not stored in request logs."
              >
                <LockKeyhole size={15} />
                <span>Not saved to logs</span>
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
                  <ArrowUp size={17} />
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
            aria-busy={running}
          >
            {output ? (
              <pre className={running ? "streaming" : ""}>{output}</pre>
            ) : running ? (
              <span>
                <LoaderCircle size={18} className="spin" />
                Waiting for the provider…
              </span>
            ) : (
              <span>
                <Terminal size={25} />
                <strong>
                  {requestError
                    ? "Request couldn’t complete"
                    : "Ready when you are"}
                </strong>
                <small>
                  {demo
                    ? "Sign in to use your provider accounts. Usage may incur charges."
                    : "Your response and selected route will appear here."}
                </small>
              </span>
            )}
          </div>
          {requestError && (
            <div className="response-error">
              <Banner tone="error">
                <strong>
                  {requestError.status
                    ? `HTTP ${requestError.status}`
                    : "Request error"}
                </strong>
                <span>{requestError.message}</span>
                <button
                  className="text-button"
                  disabled={running}
                  onClick={() => requireAccount(() => void run())}
                >
                  <RefreshCw size={14} />
                  Retry request
                </button>
                <button
                  className="text-button"
                  onClick={() => setSettingsOpen(true)}
                >
                  Review route
                </button>
              </Banner>
            </div>
          )}
          {info && (
            <div className="response-info mono" role="status">
              {running && <LoaderCircle className="spin" size={14} />}
              {info}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
