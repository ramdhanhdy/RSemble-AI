// =============================================================================
// RubricDisclosure — the demoted rubric editor.
//
// Per UI.md §3.3 / DESIGN.md: rubric is *supporting config*, not a primary
// surface, so it lives in a collapsed disclosure rather than a full inspector
// tab. Drives rubricText() consumed by draftMessages / judgeMessages /
// fusionMessages.
//
// §4.3: preset chips (one-tap add), per-criterion weight steppers, a normalized
// weight bar, and a self-judge warning (§4.4) when the critic slug matches an
// enabled candidate/slot.
//
// A11y: the disclosure trigger is a labelled button (aria-expanded + aria-controls);
// every checkbox/select/input has an accessible label (visible <label> for the
// checkbox, aria-label for the kind select and the label input). Per DESIGN.md.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, CirclePlus, Minus, Plus, Trash2, X } from "lucide-react";
import type { Action } from "../studio-engine";
import type { Candidate, RubricCriterion, RubricKind } from "../studio-data";
import type { CatalogModel, CriticRef, ProviderId } from "../lib/providers/types";

const KINDS: RubricKind[] = ["goal", "metric", "gap"];
const KIND_TONE: Record<RubricKind, string> = {
  goal: "text-accent",
  metric: "text-success",
  gap: "text-warning",
};

const PRESETS: { label: string; kind: RubricKind }[] = [
  { label: "Accuracy", kind: "metric" },
  { label: "Depth", kind: "goal" },
  { label: "Clarity", kind: "metric" },
  { label: "Concision", kind: "metric" },
  { label: "Citations", kind: "gap" },
  { label: "Code correctness", kind: "metric" },
];

const WEIGHT_MIN = 0;
const WEIGHT_MAX = 1;
const WEIGHT_STEP = 0.05;

export function RubricDisclosure({
  rubric,
  dispatch,
  critic,
  candidates,
  slots,
  models,
}: {
  rubric: RubricCriterion[];
  dispatch: React.Dispatch<Action>;
  critic: CriticRef;
  candidates: Candidate[];
  slots: { slug: string; enabled: boolean }[];
  models: CatalogModel[];
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const enabledCount = rubric.filter((c) => c.enabled).length;

  useEffect(() => {
    const onAddCriterion = () => {
      setOpen(true);
      setAdding(true);
    };
    window.addEventListener("rsemble:add-criterion", onAddCriterion);
    return () => window.removeEventListener("rsemble:add-criterion", onAddCriterion);
  }, []);

  const selfJudgeSlug = useMemo(() => {
    // Provider-scoped check: the critic is self-judging only if its model id
    // matches an enabled candidate/slot AND it's the same provider. A bare slug
    // match across providers is not self-judging (different models behind the same id).
    const criticKey = `${critic.providerId}:${critic.model}`;
    const enabledKeys = new Set<string>();
    for (const c of candidates) if (c.status !== "error") enabledKeys.add(`${(c as { providerId?: string }).providerId ?? ""}:${c.slug}`);
    for (const s of slots) if (s.enabled) enabledKeys.add(`${(s as { providerId?: string }).providerId ?? ""}:${s.slug}`);
    // Also check bare slug match for backward compat (candidates without providerId)
    const enabledSlugs = new Set<string>();
    for (const c of candidates) if (c.status !== "error") enabledSlugs.add(c.slug);
    for (const s of slots) if (s.enabled) enabledSlugs.add(s.slug);
    if (enabledKeys.has(criticKey)) return critic.model;
    if (enabledSlugs.has(critic.model)) return critic.model;
    return null;
  }, [critic.model, critic.providerId, candidates, slots]);

  const neutralJudge = useMemo(() => {
    if (!selfJudgeSlug) return null;
    const enabledSlugs = new Set<string>();
    for (const c of candidates) if (c.status !== "error") enabledSlugs.add(c.slug);
    for (const s of slots) if (s.enabled) enabledSlugs.add(s.slug);
    return (
      models.find((m) => m.id !== critic.model && !enabledSlugs.has(m.id)) ?? null
    );
  }, [selfJudgeSlug, candidates, slots, models, critic.model]);

  return (
    <div className="rounded-md border border-edge bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="rubric-panel"
        className="flex w-full min-h-[44px] items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-card-hover"
      >
        <ChevronRight
          size={13}
          className={`text-text-muted transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">Rubric</span>
        <span className="font-mono text-xs text-text-muted">
          · {rubric.length} {rubric.length === 1 ? "criterion" : "criteria"}
          {rubric.length > 0 && ` · ${enabledCount} on`}
        </span>
        {rubric.length === 0 && <span className="ml-auto font-mono text-xs text-text-muted">optional</span>}
      </button>

      {open && (
        <div id="rubric-panel" className="space-y-3 border-t border-edge px-3 py-3">
          {selfJudgeSlug && (
            <SelfJudgeNote
              slug={selfJudgeSlug}
              neutral={neutralJudge}
              onUseNeutral={(model, providerId) =>
                dispatch({ type: "SET_CRITIC", critic: { providerId, model } })
              }
            />
          )}

          {rubric.length === 0 ? (
            <p className="text-sm leading-relaxed text-text-secondary">
              No criteria. The judge will use its own judgment. Add one to make “good” explicit for this task.
            </p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {rubric.map((c) => (
                  <CriterionRow key={c.id} criterion={c} dispatch={dispatch} />
                ))}
              </ul>
              <WeightBar rubric={rubric} />
            </>
          )}

          <PresetChips rubric={rubric} dispatch={dispatch} />
          <AddCriterion dispatch={dispatch} adding={adding} setAdding={setAdding} />
        </div>
      )}
    </div>
  );
}


function SelfJudgeNote({
  slug,
  neutral,
  onUseNeutral,
}: {
  slug: string;
  neutral: CatalogModel | null;
  onUseNeutral: (model: string, providerId: ProviderId) => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-sm border border-warning/50 bg-warning/[0.12] px-2.5 py-2"
    >
      <span className="font-mono text-xs leading-relaxed text-warning">
        ⚠ {slug} is judging its own answer — scores may be biased toward it.
      </span>
      <button
        type="button"
        onClick={neutral ? () => onUseNeutral(neutral.id, neutral.providerId) : undefined}
        disabled={!neutral}
        title={neutral ? `Switch judge to ${neutral.id}` : "No neutral model in catalog — pick a judge manually"}
        className="ml-auto flex min-h-[36px] items-center gap-1.5 rounded-sm border border-warning/60 bg-warning/[0.16] px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-warning transition-colors hover:bg-warning/25 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-warning/[0.16]"
      >
        Use a neutral judge
        {neutral ? (
          <span className="max-w-[10rem] truncate normal-case tracking-normal text-warning/80">
            · {neutral.id}
          </span>
        ) : (
          <span className="normal-case tracking-normal text-warning/60">· pick manually</span>
        )}
      </button>
    </div>
  );
}


function WeightBar({ rubric }: { rubric: RubricCriterion[] }) {
  const enabled = rubric.filter((c) => c.enabled);
  const total = enabled.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-panel" role="img" aria-label="Normalized criterion weights">
        {enabled.map((c) => {
          const share = (c.weight / total) * 100;
          if (share <= 0) return null;
          return (
            <div
              key={c.id}
              className={KIND_BAR[c.kind]}
              style={{ width: `${share}%` }}
              title={`${c.label}: ${share.toFixed(0)}%`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {enabled.map((c) => {
          const share = (c.weight / total) * 100;
          return (
            <span key={c.id} className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-text-muted">
              <span className={`inline-block size-1.5 rounded-full ${KIND_DOT[c.kind]}`} />
              {c.label} {share.toFixed(0)}%
            </span>
          );
        })}
      </div>
    </div>
  );
}

const KIND_BAR: Record<RubricKind, string> = {
  goal: "bg-accent",
  metric: "bg-success",
  gap: "bg-warning",
};
const KIND_DOT: Record<RubricKind, string> = {
  goal: "bg-accent",
  metric: "bg-success",
  gap: "bg-warning",
};


function PresetChips({
  rubric,
  dispatch,
}: {
  rubric: RubricCriterion[];
  dispatch: React.Dispatch<Action>;
}) {
  const existing = useMemo(() => new Set(rubric.map((c) => c.label.toLowerCase())), [rubric]);
  const available = PRESETS.filter((p) => !existing.has(p.label.toLowerCase()));
  if (available.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {available.map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={() => dispatch({ type: "ADD_RUBRIC", label: p.label, kind: p.kind })}
          className="flex min-h-[36px] items-center gap-1 rounded-full border border-edge bg-panel px-2.5 py-1 font-mono text-[11px] text-text-secondary transition-colors hover:border-edge-bright hover:bg-card-hover hover:text-text"
        >
          <Plus size={11} className="text-text-muted" />
          {p.label}
        </button>
      ))}
    </div>
  );
}


function CriterionRow({
  criterion,
  dispatch,
}: {
  criterion: RubricCriterion;
  dispatch: React.Dispatch<Action>;
}) {
  const setWeight = (next: number) => {
    const clamped = Math.round(Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, next)) * 100) / 100;
    if (clamped !== criterion.weight) {
      dispatch({ type: "SET_RUBRIC_WEIGHT", id: criterion.id, weight: clamped });
    }
  };
  return (
    <li className="flex items-center gap-1 rounded-sm border border-edge bg-panel px-2 py-1.5">
      <label
        htmlFor={`rubric-toggle-${criterion.id}`}
        className="-my-1.5 -ml-1 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center"
      >
        <input
          id={`rubric-toggle-${criterion.id}`}
          type="checkbox"
          checked={criterion.enabled}
          onChange={() => dispatch({ type: "TOGGLE_RUBRIC", id: criterion.id })}
          aria-label={`Enable criterion ${criterion.label}`}
          className="size-4 accent-accent"
        />
      </label>
      <span className={`font-mono text-[11px] uppercase tracking-wide ${KIND_TONE[criterion.kind]}`}>{criterion.kind}</span>
      <span
        className={`flex-1 truncate font-mono text-sm ${
          criterion.enabled ? "text-text" : "text-text-muted line-through"
        }`}
        title={criterion.description}
      >
        {criterion.label}
      </span>
      <WeightStepper weight={criterion.weight} onDec={() => setWeight(criterion.weight - WEIGHT_STEP)} onInc={() => setWeight(criterion.weight + WEIGHT_STEP)} />
      <button
        type="button"
        onClick={() => dispatch({ type: "REMOVE_RUBRIC", id: criterion.id })}
        aria-label={`Remove criterion ${criterion.label}`}
        className="-my-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-card-hover hover:text-error"
      >
        <Trash2 size={13} />
      </button>
    </li>
  );
}


function WeightStepper({
  weight,
  onDec,
  onInc,
}: {
  weight: number;
  onDec: () => void;
  onInc: () => void;
}) {
  const atMin = weight <= WEIGHT_MIN;
  const atMax = weight >= WEIGHT_MAX;
  return (
    <div className="flex items-center gap-0.5 rounded-sm border border-edge bg-card px-0.5">
      <button
        type="button"
        onClick={onDec}
        disabled={atMin}
        aria-label="Decrease weight"
        className="flex h-9 w-9 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-card-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Minus size={12} />
      </button>
      <span className="min-w-[2.5rem] text-center font-mono text-xs tabular-nums text-text-secondary">
        {weight.toFixed(2)}
      </span>
      <button
        type="button"
        onClick={onInc}
        disabled={atMax}
        aria-label="Increase weight"
        className="flex h-9 w-9 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-card-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}


function AddCriterion({
  dispatch,
  adding,
  setAdding,
}: {
  dispatch: React.Dispatch<Action>;
  adding: boolean;
  setAdding: (v: boolean) => void;
}) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<RubricKind>("goal");

  const trimmed = label.trim();

  const submit = () => {
    if (!trimmed) return;
    dispatch({ type: "ADD_RUBRIC", label: trimmed, kind });
    setLabel("");
    setKind("goal");
  };

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-dashed border-edge px-3 py-2 font-mono text-xs text-text-secondary transition-colors hover:border-edge-bright hover:text-text"
      >
        <CirclePlus size={14} /> Add a criterion (e.g., Accuracy, Depth, Clarity…)
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as RubricKind)}
        aria-label="New criterion kind"
        className="min-h-[44px] rounded-sm border border-edge bg-panel px-2 font-mono text-[11px] uppercase tracking-wide text-text-secondary focus:border-accent focus:outline-none"
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
          } else if (e.key === "Escape") {
            setAdding(false);
          }
        }}
        placeholder="Add a criterion (e.g. audience fit)…"
        aria-label="New criterion label"
        autoFocus
        className="min-h-[44px] flex-1 rounded-sm border border-edge bg-panel px-2 font-mono text-sm text-text placeholder-text-muted focus:border-accent focus:outline-none"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!trimmed}
        aria-label="Add criterion"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-edge-bright text-text-secondary hover:border-accent/50 hover:text-accent focus-visible:border-accent/50 focus-visible:text-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={14} />
      </button>
      <button
        type="button"
        onClick={() => setAdding(false)}
        aria-label="Cancel add criterion"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-text"
      >
        <X size={14} />
      </button>
    </div>
  );
}
