// =============================================================================
// CohortBlock — Fable §5.4.
//
// One metric inside one commensurate cohort. Fixed anatomy: cohort ref chip,
// value (mono text-lg), interval slot (or the §5.5 insufficient-coverage state),
// and a coverage line. Heterogeneous cohorts render as adjacent CohortBlocks
// with the non-pooling divider between groups (rendered by the parent). The
// block renders emitted backend shapes; it computes no interval or aggregate.
// =============================================================================

import type { ReactNode } from "react";
import type { AggregatedValue } from "../../lib/model-profiles/family-aggregation";
import { MIN_CLAIM_RESOLVED_UNITS } from "../../lib/model-profiles/profile-claims";
import { COPY } from "./copy";
import { HonestValue } from "./HonestValue";
import { InsufficientState } from "./InsufficientState";

export interface CohortInterval {
  level: number;
  lower: number;
  upper: number;
  unitCount: number;
  unitKind: string;
}

interface CohortBlockProps {
  cohortRef: string;
  value: AggregatedValue;
  interval?: CohortInterval | null;
  coverageLine: string;
  resolverVersion?: string;
  digest?: string;
}

function ValueSlot({ value }: { value: AggregatedValue }): ReactNode {
  if (value.state === "available") {
    return (
      <div data-cohort-value className="font-mono text-lg tabular-nums text-text">
        {String(value.value)}
      </div>
    );
  }
  if (value.state === "limited") {
    return (
      <div className="flex flex-wrap items-baseline gap-1">
        <span data-cohort-value className="font-mono text-lg tabular-nums text-text">
          {String(value.value)}
        </span>
        <span className="font-mono text-text-secondary"> ({value.omittedCount} omitted)</span>
        <span
          data-limited-marker
          className="text-[10px] font-mono uppercase text-warning border border-dashed border-warning/40 rounded-sm px-1"
          title={value.reason}
        >
          {COPY.honestValue.limitedMarker}
        </span>
      </div>
    );
  }
  if (value.state === "non_aggregatable") {
    return <InsufficientState kind="non_aggregatable" reason={value.detail ?? value.reason} />;
  }
  return <HonestValue quantity={{ state: "unavailable", reason: value.reason }} />;
}

function IntervalSlot({
  interval,
  resolverVersion,
  digest,
}: {
  interval: CohortInterval | null | undefined;
  resolverVersion?: string;
  digest?: string;
}): ReactNode {
  if (!interval) return null;
  if (interval.unitCount < MIN_CLAIM_RESOLVED_UNITS) {
    return (
      <div data-cohort-interval>
        <InsufficientState
          kind="insufficient"
          unitCount={interval.unitCount}
          required={MIN_CLAIM_RESOLVED_UNITS}
          resolverVersion={resolverVersion ?? "v1"}
          digest={digest ?? ""}
        />
      </div>
    );
  }
  return (
    <div data-cohort-interval className="font-mono text-xs text-text-secondary">
      {COPY.cohort.interval(
        interval.level,
        interval.lower,
        interval.upper,
        interval.unitCount,
        interval.unitKind,
      )}
    </div>
  );
}

export function CohortBlock({
  cohortRef,
  value,
  interval,
  coverageLine,
  resolverVersion,
  digest,
}: CohortBlockProps): ReactNode {
  return (
    <div data-cohort-block className="rounded-sm border border-edge bg-card p-3">
      <div data-cohort-ref className="text-xs text-text-secondary">
        {cohortRef}
      </div>
      <ValueSlot value={value} />
      <IntervalSlot interval={interval} resolverVersion={resolverVersion} digest={digest} />
      <div data-cohort-coverage className="text-xs text-text-secondary">
        {coverageLine}
      </div>
    </div>
  );
}
