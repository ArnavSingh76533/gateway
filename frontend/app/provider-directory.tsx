"use client";
import { useMemo, useState } from "react";
import { ArrowUpRight, Search, Waypoints } from "lucide-react";
import { providerDirectory } from "@/lib/api";

export default function ProviderDirectory({
  onConnect,
}: {
  onConnect: (kind: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const matches = useMemo(
    () =>
      providerDirectory.filter(
        (p) =>
          `${p.name} ${p.id} ${p.category}`
            .toLowerCase()
            .includes(query.toLowerCase().trim()) &&
          (filter === "all" ||
            (filter === "direct"
              ? p.integration === "direct"
              : filter === "oauth"
                ? p.auth.includes("oauth") || p.category === "oauth"
                : p.integration === "bridge")),
      ),
    [query, filter],
  );
  const visible =
    query || expanded || filter !== "all" ? matches : matches.slice(0, 12);
  return (
    <section className="provider-directory" aria-labelledby="directory-title">
      <div className="directory-heading">
        <div>
          <span className="eyebrow">BUILD YOUR CONNECTIONS</span>
          <h2 id="directory-title">Find your provider</h2>
          <p className="muted">
            API keys, OpenRouter sign-in, and subscription accounts through your
            private 9router.
          </p>
        </div>
        <Waypoints size={28} className="accent" />
      </div>
      <div className="directory-tools">
        <label className="directory-search">
          <Search size={18} />
          <input
            aria-label="Search provider directory"
            placeholder="Search providers, e.g. DeepSeek, Claude, Groq…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="sr-only" htmlFor="directory-filter">
          Connection method
        </label>
        <select
          id="directory-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All connections</option>
          <option value="direct">Direct API</option>
          <option value="oauth">Sign-in providers</option>
          <option value="bridge">Via private 9router</option>
        </select>
      </div>
      <p className="directory-count" aria-live="polite">
        {matches.length} {matches.length === 1 ? "provider" : "providers"} ·{" "}
        {providerDirectory.filter((p) => p.integration === "direct").length}{" "}
        direct connectors available
      </p>
      <div className="directory-grid">
        {visible.map((p) => (
          <button
            key={p.id}
            className="directory-card"
            onClick={() =>
              onConnect(p.integration === "direct" ? p.id : "9router")
            }
          >
            <span className="directory-symbol" style={{ color: p.color }}>
              {p.symbol.slice(0, 3)}
            </span>
            <span className="directory-name">
              <strong>{p.name}</strong>
              <small>
                {p.id === "9router"
                  ? "Subscription bridge"
                  : p.integration === "bridge"
                    ? "Via private 9router"
                    : p.auth.includes("oauth")
                      ? "API key or sign-in"
                      : "API key"}
              </small>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
      </div>
      {!matches.length && (
        <p className="muted">
          No providers match. Use a custom OpenAI-compatible endpoint for other
          services.
        </p>
      )}
      {!query && filter === "all" && (
        <button
          className="button directory-more"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? "Show fewer providers"
            : `Browse all ${matches.length} providers`}
        </button>
      )}
      <p className="form-note">
        The directory includes chat, media, and specialist services. Available
        routes depend on each provider. Subscription sign-ins are managed in
        your private 9router instance.
      </p>
    </section>
  );
}
