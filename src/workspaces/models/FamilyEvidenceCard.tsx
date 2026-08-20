// =============================================================================
// FamilyEvidenceCard — Section 3: Task Family / facet evidence cards (Fable §7.3).
//
// One card per family: header row with family name, task count; body with
// judged-score cohorts first, then pass-rate cohorts as CohortBlock grids.
// Card footer: supporting/contradicting/mixed/missing counts as narrowing
// buttons. The whole card header is a narrowing button.
//
// Heterogeneous Rubrics render adjacent cohort blocks with the non-pooling
// divider line — never one number, never a cohort picker.
//
// Renders emitted backend shapes; computes no aggregates, intervals, or claims.
// =============================================================================

import type { ReactNode } from "react";
import type { FamilyAggregate, CohortMetric } from "../../lib/model-profiles/family-aggregation";
import { CohortBlock } from "./CohortBlock";
import { COPY } from "./copy";
import type { Narrowing } from "./useNarrowing";

interface FamilyEvidenceCardProps {
  family: FamilyAggregate;
  /** Optional family display name (resolved by the parent). */
  familyName?: string;
  /** Called when a narrowing button is clicked. */
  onApplyNarrowing?: (narrowing: Narrowing) => void;
}

function cohortRef(metric: CohortMetric): string {
  return metric.cohortId;
}

function coverageLine(metric: CohortMetric): string {
  if (metric.value.state === "available") {
    return `${metric.value.unitCount} units`;
  }
  return "";
}

export function FamilyEvidenceCard({
  family,
  familyName,
  onApplyNarrowing,
}: FamilyEvidenceCardProps): ReactNode {
  const name = familyName ?? family.familyId ?? "Unknown family";
  const judgedScores = family.judgedScores;
  const passRates = family.passRates;

  const hasHeterogeneousRubrics =
    judgedScores.length > 1 &&
    judgedScores.slice(1).some((m) => m.cohortId !== judgedScores[0].cohortId);

  return (
    <article
      data-family-card
      data-family-id={family.familyId ?? ""}
      className="rounded-md border border-edge bg-panel"
    >
      {/* Card header — narrowing button */}
      <button
        type="button"
        data-family-header
        className="pressable flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        onClick={() =>
          onApplyNarrowing?.({
            key: `family:${family.familyId ?? ""}`,
            label: `Family: ${name}`,
          })
        }
      >
        <span className="text-sm font-semibold text-text">{name}</span>
        <span className="font-mono text-xs text-text-muted">{family.taskCount} tasks</span>
      </button>

      {/* Body: cohort blocks */}
      <div className="px-3 pb-3">
        {/* Judged-score cohorts */}
        {judgedScores.length > 0 && (
          <div className="mt-2">
            <div className="text-xs font-semibold text-text-secondary">Judged scores</div>
            {hasHeterogeneousRubrics && (
              <div className="honesty-note my-1 text-xs text-text-muted">
                {COPY.cohort.nonPoolingDivider}
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {judgedScores.map((metric, i) => (
                <CohortBlock
                  key={`judged-${metric.cohortId}-${i}`}
                  cohortRef={cohortRef(metric)}
                  value={metric.value}
                  coverageLine={coverageLine(metric)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Pass-rate cohorts */}
        {passRates.length > 0 && (
          <div className="mt-3">
            <div className="text-xs font-semibold text-text-secondary">Pass rates</div>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {passRates.map((metric, i) => (
                <CohortBlock
                  key={`passrate-${metric.cohortId}-${i}`}
                  cohortRef={cohortRef(metric)}
                  value={metric.value}
                  coverageLine={coverageLine(metric)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Card footer: task-level drilldown */}
      {family.tasks.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-edge px-3 py-2">
          {family.tasks.slice(0, 4).map((task) => (
            <button
              key={task.taskId}
              type="button"
              data-narrowing="task"
              className="pressable font-mono text-xs text-text-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              onClick={() =>
                onApplyNarrowing?.({
                  key: `task:${task.taskId}`,
                  label: `Task: ${task.taskId}`,
                })
              }
            >
              {task.taskId}
            </button>
          ))}
          {family.tasks.length > 4 && (
            <span className="text-xs text-text-muted">+{family.tasks.length - 4} more</span>
          )}
        </div>
      )}
    </article>
  );
}
