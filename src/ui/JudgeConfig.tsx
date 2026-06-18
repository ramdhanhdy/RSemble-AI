// =============================================================================
// JudgeConfig — the Judge/Fusion model selector.
//
// `state.criticModel` powers BOTH the Judge stage (Rank) and the Fusion stage
// (Fuse). It is user-configurable here — finishing the config of an IN-scope
// stage (the Judge is IN per PRODUCT.md §5). This is NOT the OUT item "model
// roles": that referred to assigning fanout *slots* to draft/critic/verifier
// buckets, which we don't do. Here there is exactly one judge, set globally.
//
// Reuses the same pattern as ModelList's combobox: live-catalog autocomplete +
// manual raw-slug entry (so a brand-new judge model works before it's cataloged).
// =============================================================================

import { useMemo, useRef, useState } from "react";
import { Check, Pencil, Search, X } from "lucide-react";
import type { Action } from "../studio-engine";
import type { OpenRouterModel } from "../lib/openrouter";

interface JudgeConfigProps {
  criticModel: string;
  models: OpenRouterModel[]; // live catalog (empty if no key / fetch failed)
  dispatch: React.Dispatch<Action>;
}

export function JudgeConfig({ criticModel, models, dispatch }: JudgeConfigProps) {
  const [editing, setEditing] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wider text-zinc-500">
          Judge <span className="normal-case text-zinc-600">· also fuses</span>
        </span>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Change judge model"
            className="flex min-h-[28px] items-center gap-1 font-mono text-sm text-zinc-400 hover:text-zinc-100"
          >
            <Pencil size={12} /> edit
          </button>
        )}
      </div>

      {!editing && (
        <div className="mt-1.5 flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 font-mono text-sm text-zinc-200">
          <span className="size-1.5 shrink-0 rounded-full bg-cyan-400" />
          <span className="flex-1 truncate" title={criticModel}>
            {criticModel}
          </span>
        </div>
      )}

      {editing && (
        <JudgeCombobox
          models={models}
          current={criticModel}
          onCancel={() => setEditing(false)}
          onCommit={(slug) => {
            dispatch({ type: "SET_CRITIC_MODEL", value: slug });
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

// ---- combobox (single-slug variant) -----------------------------------------

function JudgeCombobox({
  models,
  current,
  onCancel,
  onCommit,
}: {
  models: OpenRouterModel[];
  current: string;
  onCancel: () => void;
  onCommit: (slug: string) => void;
}) {
  const [query, setQuery] = useState(current);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = models.length > 0 ? models : [];
    if (q.length === 0) return pool.slice(0, 8);
    return pool
      .filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, models]);

  const hasCatalog = models.length > 0;
  const trimmed = query.trim();
  const slugValid = trimmed.length > 0 && trimmed.includes("/");

  return (
    <div className="mt-1.5 rounded-md border border-zinc-700 bg-zinc-900 p-2">
      <label
        htmlFor="judge-search"
        className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-500"
      >
        <span className="sr-only">Judge model</span>
        <Search size={13} className="text-zinc-500" />
        <input
          id="judge-search"
          ref={inputRef}
          role="searchbox"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (slugValid) onCommit(trimmed);
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
          placeholder="Search catalog or type a slug (provider/model)…"
          aria-label="Search the model catalog or enter a judge slug"
          className="flex-1 bg-transparent font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel edit"
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X size={13} />
        </button>
      </label>

      {/* Live catalog matches */}
      {hasCatalog && matches.length > 0 && (
        <ul className="mt-1.5 max-h-48 overflow-y-auto rounded border border-zinc-800">
          {matches.map((m) => {
            const selected = m.id === current;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onCommit(m.id)}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left font-mono text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  <span className="truncate">
                    {m.name}
                    <span className="ml-1.5 text-zinc-600">{m.id}</span>
                  </span>
                  {selected && <Check size={13} className="shrink-0 text-cyan-400" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hasCatalog && matches.length === 0 && query.trim().length > 0 && (
        <p className="px-1 py-1.5 font-mono text-sm text-zinc-600">No catalog match — commit the slug below.</p>
      )}

      {/* Manual raw-slug commit */}
      {slugValid && trimmed !== current ? (
        <button
          type="button"
          onClick={() => onCommit(trimmed)}
          aria-label={`Set judge to ${trimmed}`}
          className="mt-1.5 flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/[0.06] py-1.5 font-mono text-sm text-cyan-300 hover:bg-cyan-500/[0.12]"
        >
          <Check size={13} /> set judge <span className="text-cyan-200">{trimmed}</span>
        </button>
      ) : (
        query.trim().length > 0 &&
        !slugValid && (
          <p className="mt-1.5 px-1 font-mono text-sm text-zinc-600">
            Enter a slug as <span className="text-zinc-400">provider/model</span>
          </p>
        )
      )}
    </div>
  );
}
