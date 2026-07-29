// =============================================================================
// ModelList — the configurable model roster for the fanout.
//
// Two ways to add a model (OpenRouter ships new models constantly, so neither
// alone is enough):
//   1. Autocomplete from the LIVE catalog (state.models, fetched from
//      OpenRouter's /models endpoint when an API key is present).
//   2. Manual raw-slug entry — type any valid slug (e.g. a brand-new model that
//      isn't in the catalog yet) and it's added as-is.
//
// No roles, no provider catalogue browsing — every slot is an equal fanout
// participant (PRODUCT.md §5). Per UI.md §3.2.
//
// A11y: search input has aria-label + role=searchbox; icon-only buttons carry
// aria-labels; touch targets ≥44px on the action buttons. Per DESIGN.md.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Search, Trash2, X } from "lucide-react";
import type { Action } from "../studio-engine";
import type { ModelSlot } from "../studio-data";
import type { CatalogModel, ProviderId } from "../lib/providers/types";
import { BrandAvatar } from "./brand-icons";
import { getModelTelemetryCached, modelKey } from "../lib/history-cache";
import { pricingFor } from "../lib/cost";
import { ProviderTabs, PROVIDER_LABELS } from "./ProviderTabs";

interface ModelListProps {
  slots: ModelSlot[];
  models: CatalogModel[]; // live catalog (empty if no key / fetch failed)
  dispatch: React.Dispatch<Action>;
}

export function ModelList({ slots, models, dispatch }: ModelListProps) {
  const [adding, setAdding] = useState(false);
  const enabledCount = slots.filter((s) => s.enabled).length;

  useEffect(() => {
    const onAddModel = () => setAdding(true);
    window.addEventListener("rsemble:add-model", onAddModel);
    return () => window.removeEventListener("rsemble:add-model", onAddModel);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Models <span className="text-xs normal-case tracking-normal text-accent">· {enabledCount} selected</span>
        </span>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label="Add a model"
            className="flex min-h-[44px] items-center gap-1.5 rounded-sm border border-dashed border-edge px-3 font-mono text-xs text-text-secondary hover:border-edge-bright hover:text-text"
          >
            <Plus size={13} /> Add model
          </button>
        )}
      </div>

      <ul className={`mt-2 space-y-2 ${slots.length > 0 && enabledCount === 0 ? "opacity-60" : ""}`}>
        {slots.map((slot) => (
          <SlotRow key={slot.id} slot={slot} dispatch={dispatch} />
        ))}
        {slots.length === 0 && !adding && (
          <li className="rounded-md border border-dashed border-edge px-2 py-2 text-center font-mono text-sm text-text-muted">
            No models — add one to run
          </li>
        )}
      </ul>

      {adding && (
        <AddModelCombobox
          models={models}
          takenKeys={new Set(slots.map((s) => modelKey(s.providerId, s.slug)))}
          onCancel={() => setAdding(false)}
          onAdd={(slot) => {
            dispatch({ type: "ADD_SLOT", slot });
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Slot row — toggle on/off, remove
function SlotRow({ slot, dispatch }: { slot: ModelSlot; dispatch: React.Dispatch<Action> }) {
  const providerBadge = PROVIDER_LABELS[slot.providerId] ?? "OpenRouter";
  const telemetry = getModelTelemetryCached(modelKey(slot.providerId, slot.slug));
  const pricing = pricingFor(slot.slug);

  return (
    <li
      className={`flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 transition-[background-color,border-color] ease-out duration-150 ${
        slot.enabled ? "border-accent/50" : "border-edge hover:border-edge-bright"
      }`}
    >
      <button
        type="button"
        onClick={() => dispatch({ type: "TOGGLE_SLOT", id: slot.id })}
        aria-pressed={slot.enabled}
        aria-label={slot.enabled ? `Disable ${slot.model}` : `Enable ${slot.model}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center"
      >
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-sm border transition-[background-color,border-color] ease-out duration-100 ${
            slot.enabled ? "border-accent bg-accent text-on-accent" : "border-edge-bright text-transparent"
          }`}
        >
          <Check
            size={12}
            strokeWidth={3}
            className={`transition-transform ease-out duration-100 ${slot.enabled ? "scale-100" : "scale-75"}`}
          />
        </span>
      </button>
      <BrandAvatar slug={slot.slug} size={32} />
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm font-semibold ${slot.enabled ? "text-text" : "text-text-secondary"}`}
          title={slot.model}
        >
          {slot.model}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <span className="shrink-0 rounded-sm border border-edge px-1 text-[11px] uppercase tracking-wide text-text-secondary">
            {providerBadge}
          </span>
          <span dir="rtl" className="min-w-0 truncate font-mono text-xs text-text-muted" title={slot.slug}>
            {`‎${slot.slug}`}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-text-muted">
          {telemetry && telemetry.runCount >= 3 ? (
            <>
              <span>★ {(telemetry.winRate * 100).toFixed(0)}% win</span>
              <span aria-hidden>·</span>
              <span>{telemetry.avgScore.toFixed(1)} avg</span>
              <span aria-hidden>·</span>
              {pricing ? (
                <span>${pricing.inputPerM.toFixed(2)}/M</span>
              ) : (
                <span>— no pricing</span>
              )}
              <span aria-hidden>·</span>
              <span>~{Math.round(telemetry.avgLatencyMs / 1000)}s avg</span>
            </>
          ) : (
            <>
              {pricing ? (
                <span>${pricing.inputPerM.toFixed(2)}/M</span>
              ) : (
                <span>— no pricing</span>
              )}
              <span aria-hidden>·</span>
              <span>— no history yet</span>
            </>
          )}
        </span>
      </span>
      <button
        type="button"
        onClick={() => dispatch({ type: "REMOVE_SLOT", id: slot.id })}
        aria-label={`Remove ${slot.model}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-card-hover hover:text-error"
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

// -----------------------------------------------------------------------------
// AddModelCombobox — live-catalog autocomplete + manual raw-slug entry
// -----------------------------------------------------------------------------


export function AddModelCombobox({
  models,
  takenKeys,
  onCancel,
  onAdd,
}: {
  models: CatalogModel[];
  takenKeys: Set<string>;
  onCancel: () => void;
  onAdd: (slot: ModelSlot) => void;
}) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("openrouter");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const providerModels = useMemo(() => {
    return models.filter((m) => m.providerId === selectedProvider);
  }, [models, selectedProvider]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = providerModels.length > 0 ? providerModels : [];
    if (q.length === 0) return pool;
    return pool.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  }, [query, providerModels]);

  const hasCatalog = providerModels.length > 0;
  const trimmed = query.trim();
  const candidateKey = modelKey(selectedProvider, trimmed);
  const manualSlugValid =
    trimmed.length > 0 &&
    (selectedProvider === "openrouter" || selectedProvider === "commandcode" || selectedProvider === "clinepass"
      ? trimmed.includes("/")
      : true) &&
    !takenKeys.has(candidateKey);

  const commit = (slug: string, name?: string) => {
    const providerLabel = PROVIDER_LABELS[selectedProvider] ?? "OpenRouter";
    const model = name ?? (slug.includes("/") ? slug.split("/").slice(1).join("/") : slug);
    onAdd({
      id: `slot-${Date.now()}`,
      providerId: selectedProvider,
      provider: providerLabel,
      model,
      slug,
      enabled: true,
    });
  };

  // Provider IDs are separate namespaces — a slug typed under one provider must
  // never leak into another. Switching clears the query and refocuses so the
  // user can enter the new provider's native id without manual backspacing
  // (run-recovery spec §6.1). The input is a persistent element, so focusing
  // synchronously is safe and deterministic.
  const handleProviderChange = (p: ProviderId) => {
    setSelectedProvider(p);
    setQuery("");
    inputRef.current?.focus();
  };

  // Context-sensitive clear-or-cancel (spec §6.2): clear text first while the
  // selector stays open; close only when there is nothing left to clear.
  const handleClearOrCancel = () => {
    if (query.length > 0) {
      setQuery("");
      inputRef.current?.focus();
    } else {
      onCancel();
    }
  };

  return (
    <div className="mt-2 rounded-md border border-edge-bright bg-card p-2">
      <ProviderTabs
        value={selectedProvider}
        onChange={handleProviderChange}
        ariaLabel="Candidate model providers"
      />
      <label htmlFor="model-search" className="sr-only">
        Search models
      </label>
      <div className="flex items-center gap-1 rounded-sm border border-edge bg-panel px-2 py-1 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
        <Search size={13} className="shrink-0 text-text-muted" />
        <input
          id="model-search"
          ref={inputRef}
          role="searchbox"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (manualSlugValid) commit(trimmed);
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
          placeholder={hasCatalog ? "Search catalog or type a slug (provider/model)…" : "Type a slug (provider/model)…"}
          aria-label="Search the model catalog or enter a slug"
          className="min-h-[44px] flex-1 bg-transparent font-mono text-sm text-text placeholder-text-muted focus:outline-none"
        />
        <button
          type="button"
          onClick={handleClearOrCancel}
          aria-label={query.length > 0 ? "Clear model search" : "Cancel add model"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-text"
        >
          <X size={13} />
        </button>
      </div>

      {/* Live catalog matches */}
      {hasCatalog && matches.length > 0 && (
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-sm border border-edge scroll-thin">
          {matches.map((m) => {
            const taken = takenKeys.has(modelKey(m.providerId, m.id));
            return (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={taken}
                  onClick={() => commit(m.id, m.name)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-2 px-2 py-2 text-left font-mono text-sm text-text-secondary hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="min-w-0 truncate">
                    {m.name}
                    <span className="ml-2 text-text-muted">{m.id}</span>
                  </span>
                  {taken && <span className="shrink-0 text-text-muted">added</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hasCatalog && matches.length === 0 && query.trim().length > 0 && (
        <p className="px-1 py-2 font-mono text-sm text-text-muted">No catalog match — add as raw slug below.</p>
      )}

      {/* Manual raw-slug entry — works even with no catalog (no key) */}
      {manualSlugValid ? (
        <button
          type="button"
          onClick={() => commit(trimmed)}
          aria-label={`Add slug ${trimmed}`}
          className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm border border-accent/40 bg-accent/[0.06] py-2 font-mono text-sm text-accent hover:bg-accent/[0.12]"
        >
          <Plus size={13} /> add slug
          <span className="max-w-[55%] truncate" title={trimmed}>
            {trimmed}
          </span>
        </button>
      ) : (
        query.trim().length > 0 && (
          <p className="mt-2 px-1 font-mono text-sm text-text-muted">
            Enter a slug as <span className="text-text-secondary">provider/model</span>
            {takenKeys.has(candidateKey) && " · already added"}
          </p>
        )
      )}
    </div>
  );
}
