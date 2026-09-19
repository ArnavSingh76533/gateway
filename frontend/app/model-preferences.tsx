"use client";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Search, X } from "lucide-react";
import { api, Model, Page } from "@/lib/api";
import { Banner } from "./ui";

export default function ModelPreferences({
  providerId,
  models,
  only,
  onChange,
  onOnlyChange,
}: {
  providerId?: string;
  models: string[];
  only: boolean;
  onChange: (models: string[]) => void;
  onOnlyChange: (value: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [free, setFree] = useState(false);
  const [page, setPage] = useState<Page<Model>>({ data: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!providerId) return;
    let active = true;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          provider: providerId,
          owned_only: "true",
          search: query,
          free_only: String(free),
          limit: "50",
          offset: String(offset),
        });
        const result = await api<Page<Model>>(`/models?${params}`);
        if (active) {
          setPage(result);
          setError("");
        }
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) setBusy(false);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [providerId, query, free, offset]);
  function add(id: string) {
    if (id && !models.includes(id) && models.length < 200)
      onChange([...models, id]);
  }
  function move(index: number, direction: number) {
    const next = [...models];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    onChange(next);
  }
  const validId = query.trim().length <= 512 && /^\S+$/.test(query.trim());
  return (
    <section
      className="model-preferences"
      aria-labelledby="preferences-heading"
    >
      <div>
        <span className="eyebrow">YOUR CONNECTION, YOUR ORDER</span>
        <h3 id="preferences-heading">Model preferences</h3>
        <p className="muted">
          Auto tries model 1, then 2, then 3 within this connection. Connection
          priority comes first. Exact model requests stay exact; speed and cost
          modes keep their own ranking.
        </p>
      </div>
      <ol className="preference-list">
        {models.map((id, index) => (
          <li key={id}>
            <span className="preference-number">{index + 1}</span>
            <span className="mono preference-model" title={id}>
              {id}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label={`Move ${id} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Move ${id} down`}
              disabled={index === models.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove ${id} preference`}
              onClick={() => {
                onChange(models.filter((m) => m !== id));
                if (models.length === 1) onOnlyChange(false);
              }}
            >
              <X size={15} />
            </button>
          </li>
        ))}
      </ol>
      {!models.length && (
        <p className="form-note">
          No preferences yet. All eligible models can be chosen automatically.
        </p>
      )}
      <label className="preference-toggle">
        <input
          type="checkbox"
          checked={only}
          disabled={!models.length}
          onChange={(e) => onOnlyChange(e.target.checked)}
        />{" "}
        Only use these models for automatic routing and alternatives
      </label>
      <label className="directory-search">
        <Search size={17} />
        <input
          aria-label="Search models for preferences"
          placeholder={
            providerId
              ? "Search every model in this connection…"
              : "Enter a model ID, or choose after connecting"
          }
          value={query}
          maxLength={512}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      {providerId && (
        <>
          <label className="preference-toggle">
            <input
              type="checkbox"
              checked={free}
              onChange={(e) => {
                setFree(e.target.checked);
                setOffset(0);
              }}
            />{" "}
            Free models only
          </label>
          <p className="form-note" aria-live="polite">
            {busy
              ? "Searching models…"
              : `${page.total} ${page.total === 1 ? "model matches" : "models match"}`}
          </p>
          <div className="preference-results" aria-busy={busy}>
            {!busy &&
              page.data.map((m) => (
                <button
                  type="button"
                  className="preference-result"
                  key={m.id}
                  disabled={
                    !m.available ||
                    models.includes(m.model_id) ||
                    models.length >= 200
                  }
                  onClick={() => add(m.model_id)}
                >
                  <span>
                    <strong>{m.name}</strong>
                    <small className="mono">{m.model_id}</small>
                  </span>
                  <span>
                    {models.includes(m.model_id) ? (
                      "Added"
                    ) : !m.available ? (
                      "Unavailable"
                    ) : (
                      <Plus size={16} />
                    )}
                  </span>
                </button>
              ))}
          </div>
          {!busy && page.total > 50 && (
            <div className="preference-pagination">
              <button
                type="button"
                className="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Previous
              </button>
              <span>
                {offset + 1}–{Math.min(offset + 50, page.total)} of {page.total}
              </span>
              <button
                type="button"
                className="button"
                disabled={offset + 50 >= page.total}
                onClick={() => setOffset(offset + 50)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
      {validId &&
        !models.includes(query.trim()) &&
        (!providerId ||
          (!busy && !page.data.some((m) => m.model_id === query.trim()))) && (
          <button
            type="button"
            className="button"
            onClick={() => {
              add(query.trim());
              setQuery("");
            }}
          >
            Add model ID to preferences
          </button>
        )}
      <p className="form-note">
        Preferences do not grant model access. Undiscovered, unavailable,
        incompatible, or cooling-down models are skipped. Other eligible models
        follow your list unless you enable the restriction above.
      </p>
      {error && <Banner tone="error">{error}</Banner>}
    </section>
  );
}
