// =============================================================================
// CoverageGrid — Section 2: coverage and evidence quality (Fable §7.2).
//
// A definition grid of the fifteen HonestQuantity fields in fixed emitted order
// (D6). The attempts cell is styled deliberately quieter with a provenance-only
// honesty note. Below the grid: EvidenceMixChips, eligibility split, source
// split — each a narrowing button. Limitation reasons render at the section foot.
//
// Renders emitted backend shapes; computes no aggregates, intervals, or claims.
// =============================================================================

import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import type { ProfileCoverageSummary, HonestQuantity } from "../../lib/model-profiles/coverage-summary";
import { HonestValue } from "./HonestValue";
import { EvidenceMixChips } from "./EvidenceMixChips";
import type { Narrowing } from "./useNarrowing";

interface CoverageGridProps {
  coverage: ProfileCoverageSummary;
  /** Called when a narrowing button is clicked. */
  onApplyNarrowing?: (narrowing: Narrowing) => void;
}

const CELL_LABELS: Record<string, string> = {
  uniqueTasks: "Unique Tasks",
  taskVersions: "Task Versions",
  taskInstances: "Task Instances",
  activeObservations: "Active Observations",
  acceptedCandidateResponses: "Accepted candidate responses",
  attempts: "Attempts",
  plannedReplicates: "Planned replicates",
  resolvedIndependentUncertaintyUnits: "Resolved independent units",
  uncertaintyUnitKind: "Unit kind",
  uncertaintyAssumption: "Unit assumption",
  comparabilityCohorts: "Comparability cohorts",
  rubricVersions: "Rubric versions",
  evaluatorConfigurations: "Evaluator configurations",
  earliestObservation: "Earliest observation",
  latestObservation: "Latest observation",
  missingCells: "Missing cells",
};

/** The fields in fixed emitted order (D6). */
const FIELD_ORDER: readonly (keyof ProfileCoverageSummary)[] = [
  "uniqueTasks",
  "taskVersions",
  "taskInstances",
  "activeObservations",
  "acceptedCandidateResponses",
  "attempts",
  "plannedReplicates",
  "resolvedIndependentUncertaintyUnits",
  "uncertaintyUnitKind",
  "uncertaintyAssumption",
  "comparabilityCohorts",
  "rubricVersions",
  "evaluatorConfigurations",
  "earliestObservation",
  "latestObservation",
  "missingCells",
];

function renderCell(
  field: keyof ProfileCoverageSummary,
  coverage: ProfileCoverageSummary,
): ReactNode {
  const label = CELL_LABELS[field] ?? field;
  const q = coverage[field];

  if (q && typeof q === "object" && "state" in q) {
    const isAttempts = field === "attempts";
    return (
      <div data-coverage-cell data-coverage-field={field} className={`bg-panel p-3 ${isAttempts ? "opacity-70" : ""}`}>
        <HonestValue quantity={q as HonestQuantity} label={label} />
        {isAttempts && (
          <div className="honesty-note mt-1 text-[10px] text-text-muted">
            provenance only, not a sample size
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-coverage-cell data-coverage-field={field} className="bg-panel p-3">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className="text-text-muted">—</div>
    </div>
  );
}

function limitationEntries(
  reasons: Readonly<Partial<Record<string, number>>>,
): { code: string; count: number }[] {
  return (Object.entries(reasons) as [string, number][])
    .filter(([, count]) => count !== undefined)
    .map(([code, count]) => ({ code, count }));
}

export function CoverageGrid({ coverage, onApplyNarrowing }: CoverageGridProps): ReactNode {
  const limitations = limitationEntries(coverage.limitationReasons as Readonly<Partial<Record<string, number>>>);

  return (
    <section data-section="coverage" aria-labelledby="coverage-heading">
      <h2 id="coverage-heading" className="text-base font-semibold text-text">
        Coverage &amp; evidence quality
      </h2>

      {/* Definition grid */}
      <div
        data-coverage-grid
        className="mt-3 grid grid-cols-2 gap-px bg-edge md:grid-cols-4"
      >
        {FIELD_ORDER.map((field) => (
          <div key={field}>{renderCell(field, coverage)}</div>
        ))}
      </div>

      {/* Split rows */}
      <div className="mt-3 space-y-2">
        <button
          type="button"
          data-narrowing="evidence-class"
          className="pressable text-left text-xs text-text-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          onClick={() =>
            onApplyNarrowing?.({
              key: "split:evidence-class",
              label: "Evidence class split",
            })
          }
        >
          <EvidenceMixChips
            counts={{
              exploratory: coverage.inMetricsEvidenceClassSplit.exploratory ?? 0,
              comparable: coverage.inMetricsEvidenceClassSplit.comparable ?? 0,
              verified: coverage.inMetricsEvidenceClassSplit.verified ?? 0,
              benchmark: coverage.inMetricsEvidenceClassSplit.benchmark_anchor ?? 0,
            }}
          />
        </button>

        <button
          type="button"
          data-narrowing="eligibility"
          className="pressable text-left font-mono text-xs text-text-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          onClick={() =>
            onApplyNarrowing?.({
              key: "split:eligibility",
              label: "Eligibility split",
            })
          }
        >
          {coverage.inMetricsEligibilityStatusSplit.eligible} eligible ·{" "}
          {coverage.inMetricsEligibilityStatusSplit.provisional} provisional ·{" "}
          {coverage.inMetricsEligibilityStatusSplit.excluded} excluded
        </button>

        <button
          type="button"
          data-narrowing="source"
          className="pressable text-left font-mono text-xs text-text-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          onClick={() =>
            onApplyNarrowing?.({
              key: "split:source",
              label: "Source split",
            })
          }
        >
          comparison {coverage.sourceKindSplit.comparison} · evaluation{" "}
          {coverage.sourceKindSplit.evaluation}
        </button>
      </div>

      {/* Limitation reasons */}
      {limitations.length > 0 && (
        <div className="mt-3 space-y-1">
          {limitations.map((lim, i) => (
            <button
              key={`${lim.code}-${i}`}
              type="button"
              data-narrowing="limitation"
              data-limitation-code={lim.code}
              className="pressable flex items-center gap-1 text-xs text-text-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              onClick={() =>
                onApplyNarrowing?.({
                  key: `limitation:${lim.code}`,
                  label: `Limitation: ${lim.code}`,
                })
              }
            >
              <CircleAlert size={12} aria-hidden="true" />
              {lim.code}
              {lim.count !== undefined && ` — ${lim.count} observations`}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
