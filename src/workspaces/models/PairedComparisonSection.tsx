// =============================================================================
// PairedComparisonSection — Fable §7.5 (C4).
//
// Three states: no comparator, empty intersection, results. Exactly one
// comparator. ComparatorPicker is a DialogSurface ordered by shared-task
// overlap (D7). Results render the emitted PairedComparisonResult verbatim:
// coverage line, PairedGlyphStrip + count line, mean delta / InsufficientState,
// disclosures, and a per-task table that keeps incompatible and missing rows.
// =============================================================================

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Loader, X } from "lucide-react";
import { COPY } from "./copy";
import { CompactModelLabel } from "../../ui/CompactModelLabel";
import type {
  PairedCohortResult,
  PairedComparisonResult,
  PairedOutcome,
  PairedTaskDelta,
  PairedTaskState,
} from "../../lib/model-profiles/paired-comparison";
import { ComparatorPicker, type ComparatorCandidate } from "./ComparatorPicker";
import { HonestValue } from "./HonestValue";
import { InsufficientState } from "./InsufficientState";
import { PairedGlyphStrip, type PairedGlyph } from "./PairedGlyphStrip";

export interface PairedComparatorIdentity {
  id: string;
  providerId: string;
  requestedModel: string;
  resolvedVersion?: string | null;
}

export interface PairedComparisonSectionProps {
  subjectConfigurationId: string;
  candidates: readonly ComparatorCandidate[];
  comparator: PairedComparatorIdentity | null;
  result: PairedComparisonResult | null;
  onSelectComparator: (id: string) => void;
  onRemoveComparator: () => void;
  onTaskNarrowing?: (taskId: string) => void;
  /** True while the paired computation runs in the Worker. */
  comparatorComputing?: boolean;
  /**
   * External store for the latest worker-emitted computation phase. Read via
   * useSyncExternalStore so phase ticks re-render only this section.
   */
  comparatorPhaseStore?: {
    get: () => string | null;
    subscribe: (listener: () => void) => () => void;
  };
  /** Aborts the in-flight paired computation (explicit cancel). */
  onCancelComparator?: () => void;
}

const noopSubscribe = () => () => {};
const getNoPhase = () => null;

const NO_COMPARATOR_COPY =
  "Pair this configuration against one you select. Pairing uses shared eligible tasks only.";

function phaseLabel(phase: string | null): string {
  if (phase && phase in COPY.computationPhase) {
    return COPY.computationPhase[phase as keyof typeof COPY.computationPhase];
  }
  return "Preparing paired comparison";
}

function emptyIntersectionCopy(name: string): string {
  return `No shared eligible tasks with ${name}. Pairing never compares unrelated task mixes.`;
}

const STATE_WORDS: Record<Exclude<PairedTaskState, "comparable">, string> = {
  incompatible_cohort: "incompatible cohort",
  missing_in_a: "missing here",
  missing_in_b: "missing there",
};

const OUTCOME_WORDS: Record<PairedOutcome, { letter: string; word: string }> = {
  win: { letter: "W", word: "won" },
  tie: { letter: "T", word: "tied" },
  loss: { letter: "L", word: "lost" },
};

function coverageLine(result: PairedComparisonResult): string {
  const c = result.coverage;
  return `${c.sharedTaskCount} shared tasks · ${c.comparableTaskCount} comparable · ${c.incompatibleTaskCount} incompatible cohorts · ${c.missingInA} missing here · ${c.missingInB} missing there`;
}

function countLine(result: PairedComparisonResult): string {
  const c = result.coverage;
  return `Won ${c.wins} · tied ${c.ties} · lost ${c.losses}`;
}

function glyphsFrom(result: PairedComparisonResult): PairedGlyph[] {
  const out: PairedGlyph[] = [];
  for (const row of result.taskDeltas) {
    if (row.state === "comparable" && row.outcome) {
      out.push({ taskId: row.taskId, outcome: row.outcome });
    }
  }
  return out;
}

function ComparatorChip({
  comparator,
  onRemove,
}: {
  comparator: PairedComparatorIdentity;
  onRemove: () => void;
}): ReactNode {
  return (
    <span
      data-comparator-chip
      className="inline-flex min-h-[44px] items-center gap-2 rounded-sm border border-edge bg-card px-2"
    >
      <CompactModelLabel
        providerId={comparator.providerId}
        slug={comparator.requestedModel}
        interactive={false}
      />
      <button
        type="button"
        data-remove-comparator
        aria-label="Remove comparator"
        className="pressable inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm text-text-muted hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        onClick={onRemove}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </span>
  );
}

function MeanDelta({ result }: { result: PairedComparisonResult }): ReactNode {
  const bootstrap = result.bootstrap;
  const insufficient = bootstrap?.coverageState.state === "insufficient";
  const interval = bootstrap?.interval ?? null;
  const unitCount = bootstrap?.unitCount ?? result.uncertaintyResolution?.unitCount ?? 0;
  const digest =
    bootstrap?.assignmentDigest ?? result.uncertaintyResolution?.assignmentDigest ?? "";

  return (
    <div data-mean-delta className="space-y-1">
      {result.meanDelta !== null && (
        <HonestValue
          quantity={{ state: "available", value: result.meanDelta }}
          label="Mean delta"
        />
      )}
      {insufficient ? (
        <InsufficientState
          kind="insufficient"
          unitCount={bootstrap?.coverageState.unitCount ?? unitCount}
          required={5}
          resolverVersion={`v${bootstrap?.uncertaintyRuleVersion ?? 1}`}
          digest={digest.slice(0, 8)}
        />
      ) : interval ? (
        <div className="font-mono text-xs text-text-secondary">
          {interval.level * 100}% · {interval.lower}–{interval.upper} · {unitCount} units
          {digest ? ` · digest ${digest.slice(0, 8)}` : ""}
        </div>
      ) : null}
    </div>
  );
}

function OutcomeCell({ row }: { row: PairedTaskDelta }): ReactNode {
  if (row.state !== "comparable") {
    return <span>{STATE_WORDS[row.state]}</span>;
  }
  if (!row.outcome) {
    return <span>{row.state}</span>;
  }
  const visual = OUTCOME_WORDS[row.outcome];
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-xs">{visual.letter}</span>
      <span>{visual.word}</span>
    </span>
  );
}

function DeltaTable({
  deltas,
  subjectConfigurationId,
  onTaskNarrowing,
}: {
  deltas: readonly PairedTaskDelta[];
  subjectConfigurationId: string;
  onTaskNarrowing?: (taskId: string) => void;
}): ReactNode {
  if (deltas.length === 0) return null;
  return (
    <div
      className="scroll-thin mt-3 max-w-full overflow-x-auto rounded-md border border-edge"
      role="region"
      aria-label="Paired task deltas — scrollable"
      tabIndex={0}
    >
      <table data-paired-delta-table className="min-w-full text-sm">
        <caption className="sr-only">
          Per-task paired deltas including incompatible and missing rows
        </caption>
        <thead>
          <tr className="border-b border-edge">
            <th
              scope="col"
              className="px-3 py-2 text-left text-xs font-semibold text-text-secondary"
            >
              Task
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-left text-xs font-semibold text-text-secondary"
            >
              Value A
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-left text-xs font-semibold text-text-secondary"
            >
              Value B
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-left text-xs font-semibold text-text-secondary"
            >
              Δ
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-left text-xs font-semibold text-text-secondary"
            >
              Outcome
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-left text-xs font-semibold text-text-secondary"
            >
              Versions
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-left text-xs font-semibold text-text-secondary"
            >
              Observations
            </th>
          </tr>
        </thead>
        <tbody>
          {deltas.map((row) => {
            const obsIds = [...row.observationIdsA, ...row.observationIdsB];
            return (
              <tr
                key={row.taskId}
                data-paired-task-row
                data-task-id={row.taskId}
                data-task-state={row.state}
                className="border-b border-edge last:border-b-0"
              >
                <td className="px-3 py-2">
                  <button
                    type="button"
                    data-paired-task-narrowing
                    className="pressable font-mono text-xs text-accent hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                    onClick={() => onTaskNarrowing?.(row.taskId)}
                  >
                    {row.taskId}
                  </button>
                </td>
                <td className="px-3 py-2 font-mono text-xs tabular-nums text-text">
                  {row.valueA === null ? "—" : String(row.valueA)}
                </td>
                <td className="px-3 py-2 font-mono text-xs tabular-nums text-text">
                  {row.valueB === null ? "—" : String(row.valueB)}
                </td>
                <td className="px-3 py-2 font-mono text-xs tabular-nums text-text">
                  {row.delta === null ? "—" : String(row.delta)}
                </td>
                <td className="px-3 py-2 text-xs text-text">
                  <OutcomeCell row={row} />
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary">
                  {row.versionsA.length > 0 || row.versionsB.length > 0
                    ? `A ${row.versionsA.join(",")} · B ${row.versionsB.join(",")}`
                    : ""}
                  {row.changedTaskVersion ? (
                    <span data-versions-differ className="ml-1 text-warning">
                      versions differ
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {obsIds.map((obsId) => (
                      <a
                        key={obsId}
                        href={`#/models/${subjectConfigurationId}/evidence/${obsId}`}
                        className="font-mono text-xs text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                      >
                        {obsId}
                      </a>
                    ))}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CohortSection({
  cohort,
  deltas,
  subjectConfigurationId,
  onTaskNarrowing,
}: {
  cohort: PairedCohortResult;
  deltas: readonly PairedTaskDelta[];
  subjectConfigurationId: string;
  onTaskNarrowing?: (taskId: string) => void;
}): ReactNode {
  const glyphs: PairedGlyph[] = deltas
    .filter((r) => r.state === "comparable" && r.outcome)
    .map((r) => ({ taskId: r.taskId, outcome: r.outcome! }));

  const bootstrap = cohort.bootstrap;
  const insufficient = bootstrap?.coverageState.state === "insufficient";
  const interval = bootstrap?.interval ?? null;
  const unitCount = bootstrap?.unitCount ?? cohort.uncertaintyResolution?.unitCount ?? 0;
  const digest =
    bootstrap?.assignmentDigest ?? cohort.uncertaintyResolution?.assignmentDigest ?? "";

  return (
    <div
      data-paired-cohort-section
      data-cohort-id={cohort.cohortId}
      className="space-y-2 rounded-md border border-edge bg-panel p-3"
    >
      <div className="font-mono text-xs font-semibold text-text-secondary">{cohort.cohortId}</div>
      <p data-paired-counts className="text-sm text-text">
        Won {cohort.wins} · tied {cohort.ties} · lost {cohort.losses}
      </p>
      {glyphs.length > 0 && (
        <div className="scroll-thin max-w-full overflow-x-auto">
          <PairedGlyphStrip outcomes={glyphs} />
        </div>
      )}
      <div data-mean-delta className="space-y-1">
        {cohort.meanDelta !== null && (
          <HonestValue
            quantity={{ state: "available", value: cohort.meanDelta }}
            label="Mean delta"
          />
        )}
        {insufficient ? (
          <InsufficientState
            kind="insufficient"
            unitCount={bootstrap?.coverageState.unitCount ?? unitCount}
            required={5}
            resolverVersion={`v${bootstrap?.uncertaintyRuleVersion ?? 1}`}
            digest={digest.slice(0, 8)}
          />
        ) : interval ? (
          <div className="font-mono text-xs text-text-secondary">
            {interval.level * 100}% · {interval.lower}–{interval.upper} · {unitCount} units
            {digest ? ` · digest ${digest.slice(0, 8)}` : ""}
          </div>
        ) : null}
      </div>
      <DeltaTable
        deltas={deltas}
        subjectConfigurationId={subjectConfigurationId}
        onTaskNarrowing={onTaskNarrowing}
      />
    </div>
  );
}

export function PairedComparisonSection({
  subjectConfigurationId,
  candidates,
  comparator,
  result,
  onSelectComparator,
  onRemoveComparator,
  onTaskNarrowing,
  comparatorComputing = false,
  comparatorPhaseStore,
  onCancelComparator,
}: PairedComparisonSectionProps): ReactNode {
  const comparatorPhase = useSyncExternalStore(
    comparatorPhaseStore?.subscribe ?? noopSubscribe,
    comparatorPhaseStore?.get ?? getNoPhase,
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  function handleOpenChange(open: boolean) {
    setPickerOpen(open);
    if (!open) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>("[data-comparator-trigger]")?.focus();
      });
    }
  }

  const emptyIntersection = Boolean(comparator && result?.empty);
  const showResults = Boolean(comparator && result && !result.empty);

  let state: "no-comparator" | "computing" | "empty-intersection" | "results" =
    "no-comparator";
  if (comparatorComputing) state = "computing";
  else if (showResults) state = "results";
  else if (emptyIntersection || comparator) state = "empty-intersection";

  return (
    <section data-section="paired" aria-labelledby="paired-heading">
      <h2 id="paired-heading" className="text-base font-semibold text-text">
        Selected paired comparison
      </h2>

      {state === "computing" && (
        <div
          data-paired-state="computing"
          className="mt-3 space-y-3 rounded-md border border-edge bg-panel px-3 py-4"
        >
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 text-sm text-text-secondary"
          >
            <Loader size={16} className="animate-spin" aria-hidden="true" />
            <span data-paired-progress>{phaseLabel(comparatorPhase)}</span>
          </div>
          <button
            type="button"
            data-action="cancel-comparator"
            className="pressable inline-flex min-h-[44px] min-w-[44px] items-center rounded-md border border-edge bg-panel px-4 text-sm text-text hover:border-edge-bright focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            onClick={onCancelComparator}
          >
            Cancel
          </button>
          {/* The picker stays reachable so a newer selection supersedes the
              in-flight computation instead of having to wait it out. */}
          <div>
            <ComparatorPicker
              open={pickerOpen}
              onOpenChange={handleOpenChange}
              candidates={candidates}
              onSelect={onSelectComparator}
            />
          </div>
        </div>
      )}

      {state === "no-comparator" && (
        <div
          data-paired-state="no-comparator"
          className="mt-3 rounded-md border border-edge bg-panel px-3 py-4"
        >
          <p className="text-sm text-text-secondary">{NO_COMPARATOR_COPY}</p>
          <div className="mt-3">
            <ComparatorPicker
              open={pickerOpen}
              onOpenChange={handleOpenChange}
              candidates={candidates}
              onSelect={onSelectComparator}
            />
          </div>
        </div>
      )}

      {state === "empty-intersection" && comparator && (
        <div data-paired-state="empty-intersection" className="mt-3 space-y-3">
          <ComparatorChip comparator={comparator} onRemove={onRemoveComparator} />
          {result?.empty && (
            <p className="text-sm text-text-secondary">
              {emptyIntersectionCopy(comparator.requestedModel)}
            </p>
          )}
        </div>
      )}

      {state === "results" && comparator && result && (
        <div data-paired-state="results" className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <ComparatorChip comparator={comparator} onRemove={onRemoveComparator} />
            <span className="font-mono text-xs text-text-muted">{result.metric}</span>
          </div>
          <p data-paired-coverage className="text-xs text-text-secondary">
            {coverageLine(result)}
          </p>

          {result.cohortResults.length > 1 ? (
            <div data-paired-multi-cohort className="space-y-4">
              {result.cohortResults.map((cohort) => (
                <CohortSection
                  key={cohort.cohortId}
                  cohort={cohort}
                  deltas={result.taskDeltas.filter((r) => r.cohortId === cohort.cohortId)}
                  subjectConfigurationId={subjectConfigurationId}
                  onTaskNarrowing={onTaskNarrowing}
                />
              ))}
              {result.taskDeltas.some((r) => r.cohortId === null) && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-text-secondary">
                    Incompatible or unshared tasks
                  </div>
                  <DeltaTable
                    deltas={result.taskDeltas.filter((r) => r.cohortId === null)}
                    subjectConfigurationId={subjectConfigurationId}
                    onTaskNarrowing={onTaskNarrowing}
                  />
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="scroll-thin max-w-full overflow-x-auto">
                <PairedGlyphStrip outcomes={glyphsFrom(result)} />
              </div>
              <p data-paired-counts className="text-sm text-text">
                {countLine(result)}
              </p>
              <MeanDelta result={result} />
              {result.disclosures.length > 0 && (
                <ul data-paired-disclosures className="space-y-1">
                  {result.disclosures.map((line) => (
                    <li key={line} className="honesty-note text-xs text-text-muted">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
              <DeltaTable
                deltas={result.taskDeltas}
                subjectConfigurationId={subjectConfigurationId}
                onTaskNarrowing={onTaskNarrowing}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
