// =============================================================================
// EvaluationDisclosure — replaces RubricDisclosure (spec §9.3).
//
// Compare can choose:
//   1. Holistic judgment (default — no explicit criteria)
//   2. Saved profile (pins an exact version)
//   3. Custom criteria (one-off snapshot; Save as profile is separate)
//
// No goal/metric/gap kinds, no preset chips. Criteria use a one-open accordion
// with blur validation, normalized header preview, and total-weight summary.
// =============================================================================

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Action } from "../studio-engine";
import type { AdHocEvaluationConfig } from "../lib/evaluations/evaluation-profile-adhoc";
import { HOLISTIC_EVALUATION } from "../lib/evaluations/evaluation-profile-adhoc";
import { EvaluationProfileEditor } from "./EvaluationProfileEditor";
import type { EvaluationProfile } from "../lib/evaluations/evaluation-types";

export function EvaluationDisclosure({
  evaluation,
  dispatch,
}: {
  evaluation: AdHocEvaluationConfig;
  dispatch: React.Dispatch<Action>;
}) {
  const [open, setOpen] = useState(false);

  const summary = formatSummary(evaluation);

  return (
    <div className="rounded-md border border-edge bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="evaluation-panel"
        className="pressable flex w-full min-h-[44px] items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ChevronRight
          size={13}
          className={`text-text-muted transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Evaluation
        </span>
        <span className="font-mono text-xs text-text-muted">{summary}</span>
      </button>

      {open && (
        <div id="evaluation-panel" className="space-y-3 border-t border-edge px-3 py-3">
          <EvaluationModeSelector evaluation={evaluation} dispatch={dispatch} />

          {evaluation.kind !== "holistic" && (
            <EvaluationProfileEditor
              profile={evaluation.profile}
              onChange={(profile: EvaluationProfile) => {
                if (evaluation.kind === "custom") {
                  dispatch({ type: "SET_EVALUATION", config: { kind: "custom", profile } });
                } else if (evaluation.kind === "profile") {
                  dispatch({
                    type: "SET_EVALUATION",
                    config: { kind: "custom", profile },
                  });
                }
              }}
            />
          )}

          {evaluation.kind === "custom" && (
            <button
              type="button"
              className="pressable flex min-h-[44px] items-center gap-1.5 rounded-sm border border-dashed border-edge px-3 font-mono text-xs text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={() => {
                // Save as profile is a separate deliberate action — it opens a
                // named draft and does not silently mutate Compare.
                window.dispatchEvent(new CustomEvent("rsemble:save-profile"));
              }}
            >
              Save as profile
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function formatSummary(evaluation: AdHocEvaluationConfig): string {
  switch (evaluation.kind) {
    case "holistic":
      return "· Holistic judgment";
    case "profile":
      return `· ${evaluation.profile.name} · v${evaluation.profile.version}`;
    case "custom":
      return `· Custom · ${evaluation.profile.criteria.length} ${evaluation.profile.criteria.length === 1 ? "criterion" : "criteria"}`;
  }
}

function EvaluationModeSelector({
  evaluation,
  dispatch,
}: {
  evaluation: AdHocEvaluationConfig;
  dispatch: React.Dispatch<Action>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <ModeOption
        label="Holistic judgment"
        active={evaluation.kind === "holistic"}
        onClick={() => dispatch({ type: "SET_EVALUATION", config: HOLISTIC_EVALUATION })}
      />
      <ModeOption
        label="Saved profile…"
        active={evaluation.kind === "profile"}
        onClick={() => {
          window.dispatchEvent(new CustomEvent("rsemble:select-profile"));
        }}
      />
      <ModeOption
        label="Custom criteria"
        active={evaluation.kind === "custom"}
        onClick={() => {
          if (evaluation.kind !== "custom") {
            const emptyProfile: EvaluationProfile = {
              id: "custom",
              version: 1,
              name: "Custom criteria",
              description: "",
              judgeInstruction: "",
              criteria: [],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            dispatch({ type: "SET_EVALUATION", config: { kind: "custom", profile: emptyProfile } });
          }
        }}
      />
    </div>
  );
}

function ModeOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`pressable flex min-h-[44px] items-center gap-2 rounded-sm px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active ? "bg-accent/10 text-accent" : "text-text-secondary hover:bg-card-hover"
      }`}
    >
      <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${active ? "border-accent bg-accent" : "border-edge-bright"}`}>
        {active && <span className="h-2 w-2 rounded-full bg-on-accent" />}
      </span>
      {label}
    </button>
  );
}
