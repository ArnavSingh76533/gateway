"use client";
import { useState } from "react";
import { ChevronDown, Search, RefreshCw, Check } from "lucide-react";
import { Model, money, num } from "@/lib/api";
import { Banner, Badge, Modal } from "./ui";

export default function ModelPicker({
  models,
  selected,
  onSelect,
  provider = "",
  manual = false,
  loading = false,
  error = "",
  onRefresh,
  disabled = false,
  label = "Model",
  allowAuto = true,
}: {
  models: Model[];
  selected: Model | null;
  onSelect: (model: Model | null) => void;
  provider?: string;
  manual?: boolean;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
  disabled?: boolean;
  label?: string;
  allowAuto?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [free, setFree] = useState(false);
  const eligible = models.filter(
    (m) => !provider || m.provider_id === provider,
  );
  const results = eligible.filter(
    (m) =>
      (!free || m.shared || (m.input_price === 0 && m.output_price === 0)) &&
      `${m.name} ${m.model_id} ${m.provider_name}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  function choose(model: Model | null) {
    onSelect(model);
    setOpen(false);
  }
  return (
    <div className="model-picker">
      <span className="field-label">{label}</span>
      <button
        type="button"
        className="model-picker-trigger"
        aria-label={`Select ${label.toLowerCase()}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span>
          <strong>
            {selected?.name ||
              (manual || !allowAuto ? "Choose a model" : "Auto-select a model")}
          </strong>
          <small>
            {selected
              ? selected.model_id
              : loading
                ? "Loading the full catalog…"
                : "Search the full catalog · find free models"}
          </small>
        </span>
        <ChevronDown size={16} />
      </button>
      {selected && (
        <small className="selected-route">
          {selected.shared ? "Community · free to use" : selected.provider_name}{" "}
          · {num(selected.context_window)} context
        </small>
      )}
      {open && (
        <Modal title="Choose a model" onClose={() => setOpen(false)} wide>
          <div className="modal-body model-picker-body">
            <label className="search-field">
              <Search size={17} />
              <input
                autoFocus
                aria-label="Search all models"
                placeholder="Search by name, ID, or provider…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="model-picker-toolbar">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={free}
                  onChange={(e) => setFree(e.target.checked)}
                />
                Free only
              </label>
              {onRefresh && (
                <button
                  type="button"
                  className="text-button"
                  disabled={loading}
                  onClick={onRefresh}
                >
                  <RefreshCw size={14} />
                  Refresh models
                </button>
              )}
            </div>
            <p className="form-note" aria-live="polite">
              {loading
                ? "Loading every page of the model catalog…"
                : `${results.length} matching models · ${eligible.length} in this catalog`}
            </p>
            {error && <Banner tone="error">{error}</Banner>}
            <div className="model-picker-results">
              {allowAuto && !manual && !search && !free && (
                <button className="model-option" onClick={() => choose(null)}>
                  <span>
                    <strong>Auto-select a model</strong>
                    <small>Let the routing strategy choose</small>
                  </span>
                  {!selected && <Check size={17} />}
                </button>
              )}
              {results.map((model) => {
                const unavailable =
                  !model.enabled ||
                  !model.available ||
                  model.capabilities.chat === false;
                return (
                  <button
                    type="button"
                    className={`model-option ${selected?.id === model.id ? "selected" : ""}`}
                    key={model.id}
                    aria-label={`Choose ${model.name} · ${model.provider_name}`}
                    disabled={unavailable}
                    onClick={() => choose(model)}
                  >
                    <span>
                      <strong>{model.name}</strong>
                      <small className="mono">{model.model_id}</small>
                      <small>
                        {model.provider_name} · {num(model.context_window)}{" "}
                        context
                      </small>
                      {unavailable && (
                        <small>
                          {model.capabilities.chat === false
                            ? "Available in the catalog; this model does not support chat"
                            : "Currently unavailable"}
                        </small>
                      )}
                    </span>
                    <span className="model-option-price">
                      {model.shared ? (
                        <Badge tone="green">Community · Free</Badge>
                      ) : model.input_price === 0 &&
                        model.output_price === 0 ? (
                        <Badge tone="green">Free</Badge>
                      ) : (
                        <small>
                          {money(model.input_price)} /{" "}
                          {money(model.output_price)}
                          <br />
                          per 1M tokens
                        </small>
                      )}
                      {selected?.id === model.id && <Check size={17} />}
                    </span>
                  </button>
                );
              })}
              {!results.length && !loading && (
                <p className="empty-catalog">
                  No matching models. Try another search or refresh the catalog.
                </p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
