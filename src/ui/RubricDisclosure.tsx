// =============================================================================
// RubricDisclosure — the demoted rubric editor.
//
// Per UI.md §3.3 / DESIGN.md: rubric is *supporting config*, not a primary
// surface, so it lives in a collapsed disclosure rather than a full inspector
// tab. Drives rubricText() consumed by draftMessages / judgeMessages /
// fusionMessages. NOTE: the reducer only persists kind+label on add; weight
// starts at 0.10 and is not user-editable here (kept minimal — see PRODUCT.md
// scope fence).
//
// A11y: the disclosure trigger is a labelled button (aria-expanded + aria-controls);
// every checkbox/select/input has an accessible label (visible <label> for the
// checkbox, aria-label for the kind select and the label input). Per DESIGN.md.
// =============================================================================

import { useId, useState } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import type { Action } from "../studio-engine";
import type { RubricCriterion, RubricKind } from "../studio-data";

const KINDS: RubricKind[] = ["goal", "metric", "gap"];
const KIND_TONE: Record<RubricKind, string> = {
  goal: "text-cyan-400",
  metric: "text-emerald-400",
  gap: "text-amber-400",
};

export function RubricDisclosure({
  rubric,
  dispatch,
}: {
  rubric: RubricCriterion[];
  dispatch: React.Dispatch<Action>;
}) {
  const [open, setOpen] = useState(false);
  const enabledCount = rubric.filter((c) => c.enabled).length;

  return (
    <div className="rounded-lg border border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="rubric-panel"
        className="flex w-full min-h-[40px] items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900"
      >
        <ChevronRight
          size={13}
          className={`text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="font-mono text-xs uppercase tracking-wider text-zinc-400">Rubric</span>
        <span className="font-mono text-sm text-zinc-600">
          · {rubric.length} {rubric.length === 1 ? "criterion" : "criteria"}
          {rubric.length > 0 && ` · ${enabledCount} on`}
        </span>
        {rubric.length === 0 && <span className="ml-auto font-mono text-sm text-zinc-600">optional</span>}
      </button>

      {open && (
        <div id="rubric-panel" className="border-t border-zinc-800 px-3 py-3">
          {rubric.length === 0 ? (
            <p className="font-mono text-sm leading-relaxed text-zinc-600">
              No criteria. The judge will use its own judgment. Add one to make “good” explicit for this task.
            </p>
          ) : (
            <ul className="space-y-1">
              {rubric.map((c) => (
                <CriterionRow key={c.id} criterion={c} dispatch={dispatch} />
              ))}
            </ul>
          )}

          <AddCriterion dispatch={dispatch} />
        </div>
      )}
    </div>
  );
}

// ---- one criterion row ------------------------------------------------------

function CriterionRow({
  criterion,
  dispatch,
}: {
  criterion: RubricCriterion;
  dispatch: React.Dispatch<Action>;
}) {
  const inputId = useId();
  return (
    <li className="group flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-2">
      <input
        id={inputId}
        type="checkbox"
        checked={criterion.enabled}
        onChange={() => dispatch({ type: "TOGGLE_RUBRIC", id: criterion.id })}
        className="size-4 accent-cyan-500"
      />
      <label htmlFor={inputId} className="sr-only">
        Toggle criterion {criterion.label}
      </label>
      <span className={`font-mono text-xs uppercase ${KIND_TONE[criterion.kind]}`}>{criterion.kind}</span>
      <span
        className={`flex-1 truncate font-mono text-sm ${
          criterion.enabled ? "text-zinc-200" : "text-zinc-500 line-through"
        }`}
        title={criterion.description}
      >
        {criterion.label}
      </span>
      <span className="font-mono text-sm text-zinc-600">w {criterion.weight.toFixed(2)}</span>
      <button
        type="button"
        onClick={() => dispatch({ type: "REMOVE_RUBRIC", id: criterion.id })}
        aria-label={`Remove criterion ${criterion.label}`}
        className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-rose-400 focus-visible:text-rose-400"
      >
        <Trash2 size={13} />
      </button>
    </li>
  );
}

// ---- add a new criterion ----------------------------------------------------

function AddCriterion({ dispatch }: { dispatch: React.Dispatch<Action> }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<RubricKind>("goal");

  const trimmed = label.trim();

  const submit = () => {
    if (!trimmed) return;
    dispatch({ type: "ADD_RUBRIC", label: trimmed, kind });
    setLabel("");
    setKind("goal");
  };

  return (
    <div className="mt-2 flex items-center gap-2">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as RubricKind)}
        aria-label="New criterion kind"
        className="min-h-[36px] rounded border border-zinc-800 bg-zinc-950 px-2 py-2 font-mono text-xs uppercase text-zinc-300 focus:border-cyan-500 focus:outline-none"
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Add a criterion (e.g. audience fit)…"
        aria-label="New criterion label"
        className="min-h-[36px] flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!trimmed}
        aria-label="Add criterion"
        className="flex h-9 w-9 items-center justify-center rounded border border-zinc-700 text-zinc-300 hover:border-cyan-500/50 hover:text-cyan-300 focus-visible:border-cyan-500/50 focus-visible:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
