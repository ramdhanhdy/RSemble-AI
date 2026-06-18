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

import { useMemo, useRef, useState } from "react";
import { Check, Plus, Search, Trash2, X } from "lucide-react";
import type { Action } from "../studio-engine";
import type { ModelSlot } from "../studio-data";
import type { OpenRouterModel } from "../lib/openrouter";

interface ModelListProps {
  slots: ModelSlot[];
  models: OpenRouterModel[]; // live catalog (empty if no key / fetch failed)
  dispatch: React.Dispatch<Action>;
}

export function ModelList({ slots, models, dispatch }: ModelListProps) {
  const [adding, setAdding] = useState(false);
  const enabledCount = slots.filter((s) => s.enabled).length;

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wider text-zinc-500">
          Models <span className="normal-case text-zinc-600">· {enabledCount} enabled</span>
        </span>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label="Add a model"
            className="flex min-h-[28px] items-center gap-1 font-mono text-sm text-zinc-400 hover:text-zinc-100"
          >
            <Plus size={13} /> add
          </button>
        )}
      </div>

      <ul className="mt-1.5 space-y-1">
        {slots.map((slot) => (
          <SlotRow key={slot.id} slot={slot} dispatch={dispatch} />
        ))}
        {slots.length === 0 && !adding && (
          <li className="rounded border border-dashed border-zinc-800 px-2 py-2 text-center font-mono text-sm text-zinc-600">
            No models — add one to run
          </li>
        )}
      </ul>

      {adding && (
        <AddModelCombobox
          models={models}
          takenSlugs={new Set(slots.map((s) => s.slug))}
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
// -----------------------------------------------------------------------------

function SlotRow({ slot, dispatch }: { slot: ModelSlot; dispatch: React.Dispatch<Action> }) {
  return (
    <li
      className={`group flex items-center gap-2 rounded border px-2 py-1.5 font-mono text-sm ${
        slot.enabled
          ? "border-cyan-500/40 bg-cyan-500/[0.06] text-zinc-200"
          : "border-zinc-800 text-zinc-500"
      }`}
    >
      <button
        type="button"
        onClick={() => dispatch({ type: "TOGGLE_SLOT", id: slot.id })}
        aria-pressed={slot.enabled}
        aria-label={slot.enabled ? `Disable ${slot.model}` : `Enable ${slot.model}`}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border ${
          slot.enabled ? "border-emerald-400 bg-emerald-400 text-zinc-950" : "border-zinc-600 text-transparent"
        }`}
      >
        <Check size={12} strokeWidth={3} />
      </button>
      <span className="flex-1 truncate" title={slot.slug}>
        {slot.model}
        <span className="ml-1.5 text-zinc-600">{slot.slug}</span>
      </span>
      <button
        type="button"
        onClick={() => dispatch({ type: "REMOVE_SLOT", id: slot.id })}
        aria-label={`Remove ${slot.model}`}
        // Icon-only control: padded to a comfortable touch target, focus-visible via global CSS.
        className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-rose-400 focus-visible:text-rose-400"
      >
        <Trash2 size={13} />
      </button>
    </li>
  );
}

// -----------------------------------------------------------------------------
// AddModelCombobox — live-catalog autocomplete + manual raw-slug entry
// -----------------------------------------------------------------------------

function AddModelCombobox({
  models,
  takenSlugs,
  onCancel,
  onAdd,
}: {
  models: OpenRouterModel[];
  takenSlugs: Set<string>;
  onCancel: () => void;
  onAdd: (slot: ModelSlot) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = models.length > 0 ? models : [];
    if (q.length === 0) return pool.slice(0, 8); // first 8 of catalog when empty
    return pool
      .filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, models]);

  const hasCatalog = models.length > 0;
  const trimmed = query.trim();
  const manualSlugValid = trimmed.length > 0 && trimmed.includes("/") && !takenSlugs.has(trimmed);

  const commit = (slug: string, name?: string) => {
    const provider = slug.split("/")[0] ?? "custom";
    const model = name ?? slug.split("/").slice(1).join("/") ?? slug;
    onAdd({
      id: `slot-${Date.now()}`,
      provider: provider.charAt(0).toUpperCase() + provider.slice(1),
      model,
      slug,
      enabled: true,
    });
  };

  return (
    <div className="mt-1.5 rounded-md border border-zinc-700 bg-zinc-900 p-2">
      <label
        htmlFor="model-search"
        className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-500"
      >
        <span className="sr-only">Search models</span>
        <Search size={13} className="text-zinc-500" />
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
          className="flex-1 bg-transparent font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel add"
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X size={13} />
        </button>
      </label>

      {/* Live catalog matches */}
      {hasCatalog && matches.length > 0 && (
        <ul className="mt-1.5 max-h-48 overflow-y-auto rounded border border-zinc-800">
          {matches.map((m) => {
            const taken = takenSlugs.has(m.id);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={taken}
                  onClick={() => commit(m.id, m.name)}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left font-mono text-sm text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="truncate">
                    {m.name}
                    <span className="ml-1.5 text-zinc-600">{m.id}</span>
                  </span>
                  {taken && <span className="shrink-0 text-zinc-600">added</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hasCatalog && matches.length === 0 && query.trim().length > 0 && (
        <p className="px-1 py-1.5 font-mono text-sm text-zinc-600">No catalog match — add as raw slug below.</p>
      )}

      {/* Manual raw-slug entry — works even with no catalog (no key) */}
      {manualSlugValid ? (
        <button
          type="button"
          onClick={() => commit(trimmed)}
          aria-label={`Add slug ${trimmed}`}
          className="mt-1.5 flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/[0.06] py-1.5 font-mono text-sm text-cyan-300 hover:bg-cyan-500/[0.12]"
        >
          <Plus size={13} /> add slug <span className="text-cyan-200">{trimmed}</span>
        </button>
      ) : (
        query.trim().length > 0 && (
          <p className="mt-1.5 px-1 font-mono text-sm text-zinc-600">
            Enter a slug as <span className="text-zinc-400">provider/model</span>
            {takenSlugs.has(trimmed) && " · already added"}
          </p>
        )
      )}
    </div>
  );
}
