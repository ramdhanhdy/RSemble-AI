// =============================================================================
// VerifiedOutcomes — Section 4: verified outcomes (Fable §7.4).
//
// Renders only when deterministic verifier evidence exists. A contained-scroll
// table of verifier cohorts: Cohort, Verified tasks, Pass rate, Interval (or
// InsufficientState), Failures (count + narrowing button). A missing verifier
// outcome renders the non_aggregatable reason, not a zero.
//
// Renders emitted backend shapes; computes no aggregates, intervals, or claims.
// =============================================================================

import type { ReactNode } from "react";
import type { AggregatedValue } from "../../lib/model-profiles/family-aggregation";
import { HonestValue } from "./HonestValue";
import { InsufficientState } from "./InsufficientState";
import { MIN_CLAIM_RESOLVED_UNITS } from "../../lib/model-profiles/profile-claims";
import type { Narrowing } from "./useNarrowing";

export interface VerifiedOutcome {
  cohortRef: string;
  verifiedTasks: string;
  passRate: AggregatedValue;
  interval?: {
    level: number;
    lower: number;
    upper: number;
    unitCount: number;
    unitKind: string;
  } | null;
  failureCount?: number;
  resolverVersion?: string;
  digest?: string;
}

interface VerifiedOutcomesProps {
  outcomes: readonly VerifiedOutcome[];
  /** Called when a narrowing button is clicked. */
  onApplyNarrowing?: (narrowing: Narrowing) => void;
}

const SCROLL_CLASS =
  "scroll-thin max-w-full overflow-x-auto rounded-md border border-edge focus:outline-none focus:ring-2 focus:ring-accent";

function renderPassRate(value: AggregatedValue): ReactNode {
  if (value.state === "available" || value.state === "limited") {
    return (
      <span className="font-mono tabular-nums text-text">
        {String(value.value)}
      </span>
    );
  }
  if (value.state === "non_aggregatable") {
    return (
      <InsufficientState
        kind="non_aggregatable"
        reason={value.detail ?? value.reason}
      />
    );
  }
  return <HonestValue quantity={{ state: "unavailable", reason: value.reason }} />;
}

function renderInterval(
  outcome: VerifiedOutcome,
): ReactNode {
  if (!outcome.interval) return <span className="text-text-muted">—</span>;
  if (outcome.interval.unitCount < MIN_CLAIM_RESOLVED_UNITS) {
    return (
      <InsufficientState
        kind="insufficient"
        unitCount={outcome.interval.unitCount}
        required={MIN_CLAIM_RESOLVED_UNITS}
        resolverVersion={outcome.resolverVersion ?? "v1"}
        digest={outcome.digest ?? ""}
      />
    );
  }
  return (
    <span className="font-mono text-xs text-text-secondary">
      {outcome.interval.level}% · {outcome.interval.lower}–{outcome.interval.upper} ·{" "}
      {outcome.interval.unitCount} {outcome.interval.unitKind} units
    </span>
  );
}

export function VerifiedOutcomes({
  outcomes,
  onApplyNarrowing,
}: VerifiedOutcomesProps): ReactNode {
  if (outcomes.length === 0) return null;

  return (
    <section data-section="verified-outcomes" aria-labelledby="verified-heading">
      <h2 id="verified-heading" className="text-base font-semibold text-text">
        Verified outcomes
      </h2>
      <div className="mt-3">
        <div
          className={SCROLL_CLASS}
          role="region"
          aria-label="Verified outcomes — scrollable"
          tabIndex={0}
        >
          <table data-verified-table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-edge">
                <th className="sticky left-0 bg-panel px-3 py-2 text-left text-xs font-semibold text-text-secondary">
                  Cohort
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">
                  Verified tasks
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">
                  Pass rate
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">
                  Interval
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">
                  Failures
                </th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((outcome, i) => (
                <tr
                  key={`${outcome.cohortRef}-${i}`}
                  className="border-b border-edge last:border-b-0"
                >
                  <td className="sticky left-0 bg-panel px-3 py-2">
                    <span className="text-xs text-text-secondary">
                      {outcome.cohortRef}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-text">
                    {outcome.verifiedTasks}
                  </td>
                  <td className="px-3 py-2">{renderPassRate(outcome.passRate)}</td>
                  <td className="px-3 py-2">{renderInterval(outcome)}</td>
                  <td className="px-3 py-2">
                    {outcome.failureCount !== undefined && outcome.failureCount > 0 ? (
                      <button
                        type="button"
                        data-narrowing="failures"
                        className="pressable font-mono text-xs text-error hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                        onClick={() =>
                          onApplyNarrowing?.({
                            key: `failures:${outcome.cohortRef}`,
                            label: `Failures — ${outcome.cohortRef}`,
                          })
                        }
                      >
                        {outcome.failureCount} failures
                      </button>
                    ) : (
                      <span className="font-mono text-text-muted">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
