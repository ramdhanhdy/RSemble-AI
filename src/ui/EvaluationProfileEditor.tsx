// =============================================================================
// EvaluationProfileEditor — criterion authoring with anchored 1/3/5 scores.
//
// Spec §10.5:
// - One-open-at-a-time accordion
// - Collapsed header shows name, raw weight, live normalized share
// - Sticky/in-flow total weight summary
// - Blur validation + Save validation (never erase draft input)
// - No goal/metric/gap or preset chips
// =============================================================================

import { useState, useMemo } from "react";
import { ChevronDown, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import type { EvaluationProfile, EvaluationCriterion } from "../lib/evaluations/evaluation-types";
import {
  normalizedWeights,
  totalWeight,
  getComplianceInfluence,
} from "../lib/evaluations/evaluation-profile";
import type { RequirementGroup } from "../lib/evaluations/evaluation-types";

export function EvaluationProfileEditor({
  profile,
  onChange,
  readOnly = false,
}: {
  profile: EvaluationProfile;
  onChange: (profile: EvaluationProfile) => void;
  readOnly?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(profile.criteria[0]?.id ?? null);

  const nw = useMemo(() => normalizedWeights(profile.criteria), [profile.criteria]);
  const tw = useMemo(() => totalWeight(profile.criteria), [profile.criteria]);

  function updateCriterion(id: string, patch: Record<string, unknown>) {
    onChange({
      ...profile,
      criteria: profile.criteria.map((c) =>
        c.id === id ? ({ ...c, ...patch } as EvaluationCriterion) : c,
      ),
      updatedAt: Date.now(),
    });
  }

  function addGradedCriterion() {
    const id = `c-${Date.now()}`;
    const newCriterion: EvaluationCriterion = {
      id,
      kind: "graded",
      name: "New graded criterion",
      description: "",
      weight: 1,
      anchors: {
        one: "1 — does not meet this criterion at all",
        two: "2 — weak; material weakness remains",
        three: "3 — partially meets this criterion",
        four: "4 — strong, explicit, reproducible execution",
        five: "5 — fully meets this criterion",
      },
    } as EvaluationCriterion;
    onChange({ ...profile, criteria: [...profile.criteria, newCriterion], updatedAt: Date.now() });
    setOpenId(id);
  }

  function addBinaryCriterion() {
    const id = `b-${Date.now()}`;
    const newCriterion: EvaluationCriterion = {
      id,
      kind: "binary",
      name: "New binary check",
      description: "",
      trueWhen: "Describe when this check passes",
      falseWhen: "Describe when this check fails",
    } as EvaluationCriterion;
    // Materialize a singleton requirement group for the new binary check.
    const groupId = `g-${Date.now()}`;
    const group: RequirementGroup = {
      id: groupId,
      name: newCriterion.name,
      checkIds: [id],
      weight: 1,
      mode: "ALL",
    };
    onChange({
      ...profile,
      criteria: [...profile.criteria, newCriterion],
      requirementGroups: [...(profile.requirementGroups ?? []), group],
      updatedAt: Date.now(),
    });
    setOpenId(id);
  }

  function updateComplianceInfluence(value: number) {
    onChange({ ...profile, complianceInfluence: value, updatedAt: Date.now() });
  }

  function removeCriterion(id: string) {
    onChange({
      ...profile,
      criteria: profile.criteria.filter((c) => c.id !== id),
      updatedAt: Date.now(),
    });
    if (openId === id) setOpenId(null);
  }

  function moveCriterion(id: string, direction: -1 | 1) {
    const idx = profile.criteria.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= profile.criteria.length) return;
    const criteria = [...profile.criteria];
    [criteria[idx], criteria[newIdx]] = [criteria[newIdx], criteria[idx]];
    onChange({ ...profile, criteria, updatedAt: Date.now() });
  }

  return (
    <div className="space-y-2">
      {/* Total weight summary — always visible */}
      <div className="flex items-center justify-between rounded-sm bg-card-hover px-2 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Total weight
        </span>
        <span className="font-mono text-xs tabular-nums text-text-secondary">
          {tw.toFixed(2)}
          {tw === 0 && <span className="ml-1 text-warning">· needs positive weight</span>}
        </span>
      </div>

      {/* Criteria accordion */}
      <ul className="space-y-1" role="list">
        {profile.criteria.map((c, i) => (
          <CriterionAccordion
            key={c.id}
            criterion={c}
            normalizedShare={nw[c.id] ?? 0}
            isOpen={openId === c.id}
            readOnly={readOnly}
            canMoveUp={i > 0}
            canMoveDown={i < profile.criteria.length - 1}
            onToggle={() => setOpenId(openId === c.id ? null : c.id)}
            onChange={(patch) => updateCriterion(c.id, patch)}
            onRemove={() => removeCriterion(c.id)}
            onMoveUp={() => moveCriterion(c.id, -1)}
            onMoveDown={() => moveCriterion(c.id, 1)}
          />
        ))}
      </ul>

      {/* Compliance influence control */}
      {(profile.requirementGroups?.length ?? 0) > 0 && (
        <div className="rounded-sm bg-card-hover px-2 py-1.5">
          <label className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
            Compliance influence (λ)
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={getComplianceInfluence(profile)}
              readOnly={readOnly}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v >= 0 && v <= 1) updateComplianceInfluence(v);
              }}
              className="w-20 rounded-sm border border-edge bg-card px-2 py-1 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <span className="text-xs text-text-muted">
              Max points failing all checks may cost ({getComplianceInfluence(profile).toFixed(1)})
            </span>
            {getComplianceInfluence(profile) === 0 && (
              <span className="text-xs text-warning">· checks excluded from ranking</span>
            )}
          </div>
        </div>
      )}

      {/* Requirement groups summary */}
      {(profile.requirementGroups?.length ?? 0) > 0 && (
        <div className="rounded-sm border border-edge px-2 py-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
            Requirement groups ({profile.requirementGroups!.length})
          </span>
          <ul className="mt-1 space-y-0.5">
            {profile.requirementGroups!.map((g) => (
              <li key={g.id} className="text-xs text-text-secondary">
                {g.name}: {g.checkIds.length} check(s) · weight {g.weight.toFixed(1)} · ALL
              </li>
            ))}
          </ul>
        </div>
      )}

      {!readOnly && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={addGradedCriterion}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-sm border border-dashed border-edge px-3 font-mono text-xs text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Plus size={13} /> Add graded
          </button>
          <button
            type="button"
            onClick={addBinaryCriterion}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-sm border border-dashed border-edge px-3 font-mono text-xs text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Plus size={13} /> Add binary
          </button>
        </div>
      )}
    </div>
  );
}

function CriterionAccordion({
  criterion,
  normalizedShare,
  isOpen,
  readOnly,
  canMoveUp,
  canMoveDown,
  onToggle,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  criterion: EvaluationCriterion;
  normalizedShare: number;
  isOpen: boolean;
  readOnly: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: () => void;
  onChange: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validateField(field: string, value: string) {
    if (!value.trim()) {
      setErrors((prev) => ({ ...prev, [field]: "Required" }));
    } else {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  return (
    <li className="rounded-md border border-edge">
      {/* Collapsed header */}
      <div data-geometry="criterion-header" className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="flex min-h-[44px] flex-1 items-center gap-2 rounded-md px-2 text-left hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChevronDown
            size={13}
            className={`disclosure-chevron shrink-0 text-text-muted transition-transform duration-150 ease-out ${isOpen ? "" : "-rotate-90"}`}
          />
          <span className="flex-1 truncate text-sm text-text">
            {criterion.name || "Untitled criterion"}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-text-muted">
            {"weight" in criterion ? `Weight ${criterion.weight.toFixed(1)} · ` : ""}
            {normalizedShare.toFixed(0)}%
          </span>
        </button>

        {!readOnly && (
          <div className="flex items-center">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              aria-label="Move criterion up"
              className="flex h-11 w-11 items-center justify-center text-text-secondary transition-colors hover:bg-card-hover hover:text-text disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              aria-label="Move criterion down"
              className="flex h-11 w-11 items-center justify-center text-text-secondary transition-colors hover:bg-card-hover hover:text-text disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ArrowDown size={13} />
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove criterion"
              className="flex h-11 w-11 items-center justify-center text-text-secondary transition-colors hover:bg-card-hover hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Expanded body */}
      {isOpen && (
        <div className="space-y-3 border-t border-edge px-3 py-3">
          <LabeledInput
            label="Criterion name"
            value={criterion.name}
            error={errors.name}
            readOnly={readOnly}
            onChange={(v) => onChange({ name: v })}
            onBlur={() => validateField("name", criterion.name)}
          />
          <LabeledTextarea
            label="Description"
            value={criterion.description}
            error={errors.description}
            readOnly={readOnly}
            onChange={(v) => onChange({ description: v })}
            onBlur={() => validateField("description", criterion.description)}
          />
          {criterion.kind === "binary" ? (
            <>
              <LabeledTextarea
                label="TRUE when"
                value={criterion.trueWhen}
                error={errors.trueWhen}
                readOnly={readOnly}
                onChange={(v) => onChange({ trueWhen: v })}
                onBlur={() => validateField("trueWhen", criterion.trueWhen)}
              />
              <LabeledTextarea
                label="FALSE when"
                value={criterion.falseWhen}
                error={errors.falseWhen}
                readOnly={readOnly}
                onChange={(v) => onChange({ falseWhen: v })}
                onBlur={() => validateField("falseWhen", criterion.falseWhen)}
              />
            </>
          ) : (
            <>
              {criterion.kind === "graded" && (
                <>
                  <LabeledInput
                    label="Score 1 anchor"
                    value={criterion.anchors.one}
                    error={errors.anchorOne}
                    readOnly={readOnly}
                    onChange={(v) => onChange({ anchors: { ...criterion.anchors, one: v } })}
                    onBlur={() => validateField("anchorOne", criterion.anchors.one)}
                  />
                  <LabeledInput
                    label="Score 2 anchor"
                    value={criterion.anchors.two}
                    error={errors.anchorTwo}
                    readOnly={readOnly}
                    onChange={(v) => onChange({ anchors: { ...criterion.anchors, two: v } })}
                    onBlur={() => validateField("anchorTwo", criterion.anchors.two)}
                  />
                  <LabeledInput
                    label="Score 3 anchor"
                    value={criterion.anchors.three}
                    error={errors.anchorThree}
                    readOnly={readOnly}
                    onChange={(v) => onChange({ anchors: { ...criterion.anchors, three: v } })}
                    onBlur={() => validateField("anchorThree", criterion.anchors.three)}
                  />
                  <LabeledInput
                    label="Score 4 anchor"
                    value={criterion.anchors.four}
                    error={errors.anchorFour}
                    readOnly={readOnly}
                    onChange={(v) => onChange({ anchors: { ...criterion.anchors, four: v } })}
                    onBlur={() => validateField("anchorFour", criterion.anchors.four)}
                  />
                  <LabeledInput
                    label="Score 5 anchor"
                    value={criterion.anchors.five}
                    error={errors.anchorFive}
                    readOnly={readOnly}
                    onChange={(v) => onChange({ anchors: { ...criterion.anchors, five: v } })}
                    onBlur={() => validateField("anchorFive", criterion.anchors.five)}
                  />
                </>
              )}
              {criterion.kind === undefined && (
                <>
                  <LabeledInput
                    label="Score 1 anchor"
                    value={criterion.anchors.one}
                    error={errors.anchorOne}
                    readOnly={readOnly}
                    onChange={(v) => onChange({ anchors: { ...criterion.anchors, one: v } })}
                    onBlur={() => validateField("anchorOne", criterion.anchors.one)}
                  />
                  <LabeledInput
                    label="Score 3 anchor"
                    value={criterion.anchors.three}
                    error={errors.anchorThree}
                    readOnly={readOnly}
                    onChange={(v) => onChange({ anchors: { ...criterion.anchors, three: v } })}
                    onBlur={() => validateField("anchorThree", criterion.anchors.three)}
                  />
                  <LabeledInput
                    label="Score 5 anchor"
                    value={criterion.anchors.five}
                    error={errors.anchorFive}
                    readOnly={readOnly}
                    onChange={(v) => onChange({ anchors: { ...criterion.anchors, five: v } })}
                    onBlur={() => validateField("anchorFive", criterion.anchors.five)}
                  />
                </>
              )}
              <div>
                <label
                  htmlFor={`criterion-weight-${criterion.id}`}
                  className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
                >
                  Weight
                </label>
                <input
                  id={`criterion-weight-${criterion.id}`}
                  type="number"
                  min={0}
                  step={0.1}
                  value={criterion.weight}
                  readOnly={readOnly}
                  onChange={(e) => onChange({ weight: parseFloat(e.target.value) || 0 })}
                  className="mt-1 w-full rounded-sm border border-edge bg-card px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function LabeledInput({
  label,
  value,
  error,
  readOnly,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  error?: string;
  readOnly: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <div>
      <label className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
        {label}
      </label>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={!!error}
        aria-describedby={error ? `${label}-error` : undefined}
        className="mt-1 w-full rounded-sm border border-edge bg-card px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      {error && (
        <p id={`${label}-error`} className="mt-1 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

function LabeledTextarea({
  label,
  value,
  error,
  readOnly,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  error?: string;
  readOnly: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <div>
      <label className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
        {label}
      </label>
      <textarea
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        rows={2}
        aria-invalid={!!error}
        className="mt-1 w-full rounded-sm border border-edge bg-card px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      {error && <p className="mt-1 text-xs text-error">{error}</p>}
    </div>
  );
}
