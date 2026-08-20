// =============================================================================
// ModelEvidenceProfile — the routed configuration profile dossier (Fable §7).
//
// Sections 1–7 of the profile detail. One scrollable document with a
// sticky section nav at ≥1280px, horizontal anchor row below the identity header
// at <1280px. Focus on route change lands on the page heading (tabindex=-1).
//
// Section 1: identity header + receipt line + DeterministicNarrative (D2).
// Section 2: CoverageGrid (fifteen HonestQuantity cells, D6).
// Section 3: FamilyEvidenceCard list.
// Section 4: VerifiedOutcomes (conditional).
// Section 5: PairedComparisonSection (C4).
// Section 6: EvidenceTable (always).
// Section 7: protocols, rubrics, evaluators, limitations.
//
// Profile states: exploratory-only, unknown version, insufficient everywhere,
// unknown ID (not-found), computing/cancel.
//
// Renders emitted backend shapes; computes no aggregates, intervals, or claims.
// =============================================================================

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Cpu, Loader } from "lucide-react";
import type { ProfileCoverageSummary } from "../../lib/model-profiles/coverage-summary";
import type { FamilyAggregate } from "../../lib/model-profiles/family-aggregation";
import type { ClaimResult, ClaimSentence } from "../../lib/model-profiles/profile-claims";
import type { PairedComparisonResult } from "../../lib/model-profiles/paired-comparison";
import { VersionStatusChip, type VersionStatus } from "./VersionStatusChip";
import { DeterministicNarrative } from "./DeterministicNarrative";
import { ClaimMark } from "./ClaimMark";
import { CoverageGrid } from "./CoverageGrid";
import { FamilyEvidenceCard } from "./FamilyEvidenceCard";
import { VerifiedOutcomes, type VerifiedOutcome } from "./VerifiedOutcomes";
import { EvidenceTable, type EvidenceTableRow } from "./EvidenceTable";
import { useNarrowing } from "./useNarrowing";
import { PairedComparisonSection, type PairedComparatorIdentity } from "./PairedComparisonSection";
import type { ComparatorCandidate } from "./ComparatorPicker";
import type { CohortInterval } from "./CohortBlock";
import { useEvidenceRepository, useTaskRepository } from "../../lib/persistence/repository-context";
import type { EvidenceRepository } from "../../lib/persistence/evidence-repository";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import { loadProfileData, loadPairedComparison } from "./model-profile-loader";

// =============================================================================
// Test seams — injected data shapes
// =============================================================================

export interface ProfileIdentity {
  modelConfigurationId: string;
  providerId: string;
  requestedModel: string;
  resolvedModel?: string | null;
  resolvedVersion?: string | null;
  versionStatus: VersionStatus;
  versionWindow?: string;
  missingDimension?: string;
  reasoningRequested?: string | null;
  reasoningEffective?: string | null;
  toolScaffoldSignature?: string | null;
  observedFrom?: number;
  observedTo?: number;
  rubricVersionCount?: number;
  evaluatorConfigCount?: number;
  comparabilityCohortCount?: number;
  queryFingerprint?: string;
  generatedAt?: number;
  aggregationRuleVersion?: number;
  uncertaintyRuleVersion?: number;
  eligibilityRuleVersion?: number;
}

export interface ProfileData {
  identity: ProfileIdentity;
  coverage: ProfileCoverageSummary;
  narrative: readonly ClaimSentence[];
  claims: readonly ClaimResult[];
  families: readonly FamilyAggregate[];
  /** Resolved family names (familyId → display name). */
  familyNames?: Readonly<Record<string, string>>;
  /** Per-cohort uncertainty intervals. */
  cohortIntervals?: Readonly<Record<string, CohortInterval>>;
  verifiedOutcomes: readonly VerifiedOutcome[];
  evidenceRows: readonly EvidenceTableRow[];
  /** Section 7 data */
  protocolCohorts?: readonly { ref: string; taskCount: number; groupId?: string }[];
  evaluatorConfigs?: readonly {
    kind: string;
    modelRef?: string;
    instructionDigest?: string;
    observationCount: number;
  }[];
  uncertaintyReceipt?: {
    unitKind: string;
    resolvedCount: number;
    fallbackAssumption: string;
    resolverVersion: string;
    aggregationVersion: string;
    seed: string;
    assignmentDigest: string;
    resamples: number;
  };
  limitations?: readonly { code: string; reason: string }[];
  isExploratoryOnly?: boolean;
  isUnknownVersion?: boolean;
  isInsufficientEverywhere?: boolean;
  /** Section 5: emitted paired comparison (C4). Absent → no-comparator state. */
  paired?: {
    candidates: readonly ComparatorCandidate[];
    comparator: PairedComparatorIdentity | null;
    result: PairedComparisonResult | null;
  };
}

// =============================================================================
// Props
// =============================================================================

export interface ModelEvidenceProfileProps {
  /** Test seam: inject pre-computed profile data. */
  data?: ProfileData | null;
  /** Test seam: simulate computing state. */
  computing?: boolean;
  /** Test seam: simulate not-found state. */
  notFound?: boolean;
  /** Test seam: inject evidence repo. */
  evidenceRepo?: EvidenceRepository | null;
  /** Test seam: inject task repo. */
  taskRepo?: TaskRepository | null;
}

// =============================================================================
// Section nav
// =============================================================================

const SECTIONS = [
  { id: "identity", label: "Identity" },
  { id: "coverage", label: "Coverage" },
  { id: "families", label: "Families" },
  { id: "verified", label: "Verified" },
  { id: "paired", label: "Paired" },
  { id: "evidence", label: "Observations" },
  { id: "protocols", label: "Protocols" },
] as const;

function SectionNav({ activeSection }: { activeSection: string }): ReactNode {
  return (
    <nav data-section-nav aria-label="Profile sections" className="hidden min-[1280px]:block">
      <ul className="space-y-1">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              data-nav-item={s.id}
              className={`block rounded-sm px-2 py-1 text-xs transition-colors duration-150 hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent ${
                activeSection === s.id ? "text-accent" : "text-text-muted"
              }`}
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function HorizontalAnchorRow(): ReactNode {
  return (
    <nav
      data-anchor-row
      aria-label="Profile sections"
      className="min-[1280px]:hidden scroll-thin flex gap-1 overflow-x-auto"
    >
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          data-anchor-item={s.id}
          className="shrink-0 rounded-sm px-2 py-1 text-xs text-text-muted transition-colors duration-150 hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

// =============================================================================
// Section 7: Protocols, rubrics, evaluators, limitations
// =============================================================================

function Section7({ data }: { data: ProfileData }): ReactNode {
  return (
    <section data-section="protocols" aria-labelledby="protocols-heading">
      <h2 id="protocols-heading" className="text-base font-semibold text-text">
        Protocols, Rubrics, evaluators &amp; limitations
      </h2>

      <div className="mt-3 space-y-4">
        {/* Protocol/Rubric cohorts */}
        {data.protocolCohorts && data.protocolCohorts.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-text-secondary">Protocol / Rubric cohorts</h3>
            <div className="mt-1 space-y-1">
              {data.protocolCohorts.map((c, i) => (
                <div
                  key={`${c.ref}-${i}`}
                  className="flex items-center gap-2 text-xs text-text-secondary"
                >
                  <span className="font-mono">{c.ref}</span>
                  <span>{c.taskCount} tasks</span>
                  {c.groupId && <span>· commensurate with {c.groupId}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Evaluator configurations */}
        {data.evaluatorConfigs && data.evaluatorConfigs.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-text-secondary">Evaluator configurations</h3>
            <div className="mt-1 space-y-1">
              {data.evaluatorConfigs.map((ec, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-text-secondary">
                  <span>{ec.kind}</span>
                  {ec.modelRef && <span className="font-mono">{ec.modelRef}</span>}
                  {ec.instructionDigest && (
                    <span className="font-mono text-text-muted">{ec.instructionDigest}</span>
                  )}
                  <span>{ec.observationCount} observations</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Uncertainty receipt */}
        {data.uncertaintyReceipt && (
          <div>
            <h3 className="text-sm font-semibold text-text-secondary">Uncertainty receipt</h3>
            <div className="mt-1 space-y-0.5 font-mono text-xs text-text-muted">
              <div>
                Unit kind: {data.uncertaintyReceipt.unitKind} · resolved:{" "}
                {data.uncertaintyReceipt.resolvedCount}
              </div>
              <div>{data.uncertaintyReceipt.fallbackAssumption}</div>
              <div>
                resolver {data.uncertaintyReceipt.resolverVersion} · aggregation{" "}
                {data.uncertaintyReceipt.aggregationVersion} · seed {data.uncertaintyReceipt.seed}
              </div>
              <div>
                assignment digest {data.uncertaintyReceipt.assignmentDigest} ·{" "}
                {data.uncertaintyReceipt.resamples} resamples
              </div>
            </div>
          </div>
        )}

        {/* Limitations */}
        {data.limitations && data.limitations.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-text-secondary">Limitations</h3>
            <div className="mt-1 space-y-1">
              {data.limitations.map((lim, i) => (
                <div key={`${lim.code}-${i}`} className="text-xs text-text-secondary">
                  {lim.code}: {lim.reason}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// =============================================================================
// Main component
// =============================================================================

export function ModelEvidenceProfile({
  data: dataProp,
  computing: computingProp,
  notFound: notFoundProp,
  evidenceRepo: evidenceRepoProp,
  taskRepo: taskRepoProp,
}: ModelEvidenceProfileProps = {}): ReactNode {
  const { modelConfigurationId } = useParams<{ modelConfigurationId: string }>();
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const ctxEvidenceRepo = useEvidenceRepository();
  const ctxTaskRepo = useTaskRepository();
  const evidenceRepo = evidenceRepoProp !== undefined ? evidenceRepoProp : ctxEvidenceRepo;
  const taskRepo = taskRepoProp !== undefined ? taskRepoProp : ctxTaskRepo;

  const narrowing = useNarrowing();
  const [comparator, setComparator] = useState<PairedComparatorIdentity | null>(
    dataProp?.paired?.comparator ?? null,
  );
  // Focus heading on mount.
  useEffect(() => {
    requestAnimationFrame(() => {
      headingRef.current?.focus();
    });
  }, [modelConfigurationId]);

  // --- State machine ---
  const [loadedData, setLoadedData] = useState<ProfileData | null>(null);
  const [notFound, setNotFound] = useState(notFoundProp ?? false);
  const [computing, setComputing] = useState(
    computingProp ?? (dataProp === undefined && notFoundProp === undefined),
  );
  const [cancelled, setCancelled] = useState(false);

  // When test seam provides data, exit computing.
  useEffect(() => {
    if (dataProp) {
      setComputing(false);
    }
  }, [dataProp]);
  useEffect(() => {
    setComparator(dataProp?.paired?.comparator ?? loadedData?.paired?.comparator ?? null);
  }, [dataProp?.paired?.comparator, loadedData?.paired?.comparator]);

  // Route load effect
  useEffect(() => {
    if (dataProp !== undefined || notFoundProp !== undefined || computingProp !== undefined) {
      return;
    }
    if (!evidenceRepo || !modelConfigurationId) {
      setNotFound(true);
      setComputing(false);
      return;
    }
    let isCancelled = false;
    setComputing(true);
    setNotFound(false);

    loadProfileData({
      modelConfigurationId,
      evidenceRepo,
      taskRepo,
    })
      .then((result) => {
        if (!isCancelled) {
          if (!result) {
            setNotFound(true);
          } else {
            setLoadedData(result);
            setComparator(result.paired?.comparator ?? null);
          }
          setComputing(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setNotFound(true);
          setComputing(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [evidenceRepo, taskRepo, modelConfigurationId, dataProp, notFoundProp, computingProp]);

  const handleCancel = () => {
    setCancelled(true);
    void navigate("/models");
  };

  const handleSelectComparator = async (cid: string) => {
    const activeData = dataProp ?? loadedData;
    const known = activeData?.paired?.comparator;
    if (known && known.id === cid) {
      setComparator(known);
      return;
    }
    const cand = (activeData?.paired?.candidates ?? []).find((c) => c.id === cid);
    if (!cand) return;

    if (!evidenceRepo || !modelConfigurationId) {
      setComparator({
        id: cand.id,
        providerId: cand.label,
        requestedModel: cand.label,
      });
      return;
    }

    const pair = await loadPairedComparison({
      subjectConfigurationId: modelConfigurationId,
      comparatorId: cid,
      evidenceRepo,
      taskRepo,
    });

    if (pair) {
      setComparator(pair.comparator);
      if (loadedData) {
        setLoadedData({
          ...loadedData,
          paired: {
            candidates: loadedData.paired?.candidates ?? [],
            comparator: pair.comparator,
            result: pair.result,
          },
        });
      }
    } else {
      setComparator({
        id: cand.id,
        providerId: cand.label,
        requestedModel: cand.label,
      });
    }
  };

  const handleRemoveComparator = () => {
    setComparator(null);
    if (loadedData) {
      setLoadedData({
        ...loadedData,
        paired: loadedData.paired
          ? { ...loadedData.paired, comparator: null, result: null }
          : undefined,
      });
    }
  };

  // --- Not-found state ---
  if (notFoundProp || notFound) {
    return (
      <div data-profile-state="not-found" className="flex flex-col gap-4 py-8">
        <div className="text-text">
          <p className="text-sm">
            No model configuration with id <span className="font-mono">{modelConfigurationId}</span>{" "}
            exists in this database.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/models"
            data-action="open-models"
            className="pressable inline-flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-4 text-sm text-text hover:border-edge-bright focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            Open Models
          </Link>
          <Link
            to="/runs"
            data-action="open-records"
            className="pressable inline-flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-4 text-sm text-text hover:border-edge-bright focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            Open Records
          </Link>
        </div>
        <p className="honesty-note text-xs text-text-muted">
          This lookup is device-local. The configuration may exist in another database or under a
          different identity.
        </p>
      </div>
    );
  }

  // --- Computing state ---
  if (computing && !cancelled) {
    return (
      <div data-profile-state="computing" className="flex flex-col gap-4 py-8">
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-sm text-text-secondary"
        >
          <Loader size={16} className="animate-spin" aria-hidden="true" />
          <span>Aggregating observations · building profile</span>
        </div>
        <button
          type="button"
          data-action="cancel"
          className="pressable inline-flex min-h-[44px] min-w-[44px] items-center rounded-md border border-edge bg-panel px-4 text-sm text-text hover:border-edge-bright focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          onClick={handleCancel}
        >
          Cancel
        </button>
      </div>
    );
  }

  const data = dataProp ?? loadedData;

  // --- No data ---
  if (!data) {
    return (
      <div data-profile-state="no-data" className="py-8 text-sm text-text-muted">
        No profile data available.
      </div>
    );
  }

  const id = data.identity;

  // --- Build section nav ---
  const hasVerified = data.verifiedOutcomes.length > 0;

  return (
    <div data-model-evidence-profile className="min-h-0 min-w-0">
      {/* Sticky section nav (≥1280px) */}
      <div className="hidden min-[1280px]:block">
        <div className="fixed right-[max(16px,calc((100vw-1280px)/2+16px))] top-[120px] w-[180px]">
          <SectionNav activeSection="identity" />
        </div>
      </div>

      <div className="max-w-[960px]">
        {/* ================================================================
             Section 1: Identity header + receipt line + D2 narrative
             ================================================================ */}
        <section data-section="identity" aria-labelledby="profile-heading">
          {/* Breadcrumb */}
          <Link
            to="/models"
            className="text-xs text-text-muted hover:text-text transition-colors duration-150 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            Models
          </Link>

          {/* KindEyebrow + VersionStatusChip */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
              <Cpu size={11} aria-hidden="true" />
              MODEL CONFIGURATION
            </span>
            <VersionStatusChip
              status={id.versionStatus}
              window={id.versionWindow}
              missingDimension={id.missingDimension}
            />
          </div>

          {/* Title */}
          <h1
            ref={headingRef}
            id="profile-heading"
            tabIndex={-1}
            className="mt-1 text-lg text-text outline-none"
          >
            {id.providerId} · {id.requestedModel}
          </h1>

          {/* Resolved identity line */}
          <div className="mt-1 font-mono text-xs text-text-secondary">
            {id.resolvedModel && id.resolvedVersion ? (
              <span>
                resolved: {id.resolvedModel}-{id.resolvedVersion}
              </span>
            ) : id.resolvedModel ? (
              <span>resolved: {id.resolvedModel}</span>
            ) : null}
            {id.reasoningEffective && (
              <span> · reasoning: {id.reasoningEffective} (effective)</span>
            )}
            {id.toolScaffoldSignature && <span> · tools: {id.toolScaffoldSignature}</span>}
          </div>

          {/* Observation window · cohort counts */}
          <div className="mt-1 font-mono text-xs text-text-secondary">
            {id.observedFrom && id.observedTo && (
              <span>
                observed {new Date(id.observedFrom).toISOString().slice(0, 10)} –{" "}
                {new Date(id.observedTo).toISOString().slice(0, 10)}
              </span>
            )}
            {id.rubricVersionCount !== undefined && (
              <span> · {id.rubricVersionCount} rubric versions</span>
            )}
            {id.evaluatorConfigCount !== undefined && (
              <span> · {id.evaluatorConfigCount} evaluator configurations</span>
            )}
            {id.comparabilityCohortCount !== undefined && (
              <span> · {id.comparabilityCohortCount} comparability cohorts</span>
            )}
          </div>

          {/* Receipt line */}
          <div className="mt-1 font-mono text-[11px] text-text-muted">
            {id.queryFingerprint && <span>query {id.queryFingerprint.slice(0, 12)}… · </span>}
            {id.generatedAt && (
              <span>generated {new Date(id.generatedAt).toISOString().slice(11, 19)} · </span>
            )}
            aggregation v{id.aggregationRuleVersion ?? "?"} · uncertainty v
            {id.uncertaintyRuleVersion ?? "?"} · eligibility v{id.eligibilityRuleVersion ?? "?"}
          </div>

          {/* Rolling alias disclosure */}
          {id.versionStatus === "rolling_alias" && (
            <p className="honesty-note mt-2 text-xs text-text-muted">
              Provider alias without a reported version. This profile covers observations
              {id.versionWindow ? ` from ${id.versionWindow}` : ""} only; a later alias window is a
              separate configuration.
            </p>
          )}

          {/* Partial identity disclosure */}
          {id.versionStatus === "partial_identity" && (
            <p className="honesty-note mt-2 text-xs text-text-muted">
              {id.missingDimension
                ? `${id.missingDimension}`
                : "no resolved version · reasoning settings not reported"}
            </p>
          )}

          {/* Exploratory-only honesty note */}
          {data.isExploratoryOnly && (
            <p className="honesty-note mt-2 rounded-md border border-edge bg-panel px-3 py-2 text-xs text-text-muted">
              All evidence for this configuration is exploratory — coverage is real, claims are not
              yet supported.
            </p>
          )}

          {/* Unknown version limitation */}
          {data.isUnknownVersion && (
            <p className="honesty-note mt-2 text-xs text-text-muted">
              Provider version was not reported for observations from this window.
            </p>
          )}

          {/* D2: DeterministicNarrative immediately below the header */}
          {data.narrative.length > 0 && (
            <div className="mt-4">
              <DeterministicNarrative
                sentences={data.narrative}
                onApplySource={(sourceKey) => {
                  narrowing.apply({
                    key: `source:${sourceKey}`,
                    label: `Source: ${sourceKey}`,
                  });
                  narrowing.focusTableHeading();
                }}
              />
            </div>
          )}

          {/* Claims strip */}
          {data.claims.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {data.claims.map((claim, i) => (
                <ClaimMark
                  key={`${claim.label}-${i}`}
                  label={claim.label}
                  sentence={claim.sentences[0] ?? { text: claim.label, sourceMetricKey: "" }}
                  boundaryRef={claim.receipt.boundaryRef ?? undefined}
                  onApply={(sentence) => {
                    narrowing.apply({
                      key: `claim:${sentence.sourceMetricKey}`,
                      label: `Claim: ${sentence.text.slice(0, 40)}`,
                    });
                    narrowing.focusTableHeading();
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {/* Horizontal anchor row (<1280px) */}
        <div className="mt-4 min-[1280px]:hidden">
          <HorizontalAnchorRow />
        </div>

        {/* ================================================================
             Section 2: Coverage grid
             ================================================================ */}
        <div className="mt-6" id="coverage">
          <CoverageGrid
            coverage={data.coverage}
            onApplyNarrowing={(n) => {
              narrowing.apply(n);
              narrowing.focusTableHeading();
            }}
          />
        </div>

        {/* ================================================================
             Section 3: Family evidence cards
             ================================================================ */}
        {data.families.length > 0 && (
          <div className="mt-6" id="families">
            <section data-section="families" aria-labelledby="families-heading">
              <h2 id="families-heading" className="text-base font-semibold text-text">
                Task Family evidence
              </h2>
              <div className="mt-3 space-y-3">
                {data.families.map((family) => (
                  <FamilyEvidenceCard
                    key={family.familyId ?? `family-${family.taskCount}`}
                    family={family}
                    familyName={
                      family.familyId && data.familyNames
                        ? data.familyNames[family.familyId]
                        : undefined
                    }
                    cohortIntervals={data.cohortIntervals}
                    onApplyNarrowing={(n) => {
                      narrowing.apply(n);
                      narrowing.focusTableHeading();
                    }}
                  />
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ================================================================
             Section 4: Verified outcomes
             ================================================================ */}
        {hasVerified && (
          <div className="mt-6" id="verified">
            <VerifiedOutcomes
              outcomes={data.verifiedOutcomes}
              onApplyNarrowing={(n) => {
                narrowing.apply(n);
                narrowing.focusTableHeading();
              }}
            />
          </div>
        )}

        {/* ================================================================
             Section 5: selected paired comparison
             ================================================================ */}
        <div className="mt-6" id="paired">
          <PairedComparisonSection
            subjectConfigurationId={id.modelConfigurationId}
            candidates={data.paired?.candidates ?? []}
            comparator={comparator}
            result={
              comparator &&
              data.paired?.result &&
              data.paired.result.configurationBId === comparator.id
                ? data.paired.result
                : null
            }
            onSelectComparator={handleSelectComparator}
            onRemoveComparator={handleRemoveComparator}
            onTaskNarrowing={(taskId) => {
              narrowing.apply({ key: `task:${taskId}`, label: `Task: ${taskId}` });
              narrowing.focusTableHeading();
            }}
          />
        </div>

        {/* ================================================================
             Section 6: Evidence table (always)
             ================================================================ */}
        <div className="mt-6" id="evidence">
          <EvidenceTable
            rows={data.evidenceRows}
            headingRef={narrowing.tableHeadingRef}
            narrowings={narrowing.narrowings}
            onRemoveNarrowing={narrowing.remove}
            onClearAllNarrowings={() => {
              narrowing.clearAll();
            }}
            onRowClick={(observationId) => {
              void navigate(`/models/${id.modelConfigurationId}/evidence/${observationId}`);
            }}
          />
        </div>

        {/* ================================================================
             Section 7: Protocols, rubrics, evaluators, limitations
             ================================================================ */}
        <div className="mt-6" id="protocols">
          <Section7 data={data} />
        </div>

        {/* Saved rollups section — empty state + honesty note (T11 deferred) */}
        <div className="mt-6">
          <div className="boundary-rule my-4" />
          <section data-section="saved-rollups">
            <h2 className="text-base font-semibold text-text">Saved rollups</h2>
            <p className="mt-1 text-xs text-text-muted">No saved rollups for this configuration.</p>
            <p className="honesty-note mt-1 text-xs text-text-muted">
              A rollup is a pinned list of exact configurations viewed side by side. It is not a
              model and never pools evidence.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
