// =============================================================================
// Models workspace — copy string table (Fable §10).
//
// Holds the behavioral spec's own sentences verbatim plus the fixed-template
// labels/footers/legends used by the §5/§9 primitives. The workspace never
// invents copy at render time; it reads from this table. No exported string
// contains a forbidden universal phrase or scalar (asserted by copy.test.ts
// against FORBIDDEN_CLAIM_PHRASES plus the UI-literal sweep).
// =============================================================================

import { FORBIDDEN_CLAIM_PHRASES } from "../../lib/model-profiles/profile-claims";

// --- §10 canonical example sentences (verbatim) -------------------------------

export const VERIFIED_ON_SENTENCE =
  "Verified on 8 of 10 code-transformation Tasks under verifier cohort X.";

export const WON_TIED_LOST_SENTENCE =
  "Won 6, tied 2, lost 4 against configuration Y on 12 shared eligible Tasks.";

export const MIXED_COHORTS_SENTENCE =
  "Evidence is mixed across two Rubric cohorts; values are not pooled.";

export const PROVIDER_VERSION_SENTENCE =
  "Provider version was not reported for 14 observations from May–August.";

export const INSUFFICIENT_SENTENCE =
  "Insufficient independent coverage for an interval — 4 resolved task-cluster units, 5 required.";

// --- §5.1 HonestValue ---------------------------------------------------------

const HONEST_VALUE = {
  unavailableWord: "Unavailable",
  limitedMarker: "limited",
  unresolved: (n: number) => `(${n} unresolved)`,
} as const;

// --- §5.2 VersionStatusChip ---------------------------------------------------

const VERSION_STATUS = {
  exact: "Exact version",
  rollingAlias: "Rolling alias",
  partialIdentity: "Partial identity",
  rollingAliasWindow: (window: string) => `Rolling alias · ${window}`,
  partialIdentityDimension: (dimension: string) => `Partial identity · ${dimension}`,
} as const;

// --- §5.3 EvidenceMixChips ----------------------------------------------------

const EVIDENCE_MIX = {
  order: ["exploratory", "comparable", "verified", "benchmark"] as const,
  words: {
    exploratory: "exploratory",
    comparable: "comparable",
    verified: "verified",
    benchmark: "benchmark",
  },
} as const;

// --- §5.4 CohortBlock ---------------------------------------------------------

const COHORT = {
  nonPoolingDivider: "Rubric cohorts are not commensurate; values are not pooled.",
  interval: (level: number, lower: number, upper: number, unitCount: number, unitKind: string) =>
    `${level}% · ${lower}–${upper} · ${unitCount} ${unitKind} units`,
} as const;

// --- §5.5 InsufficientState ---------------------------------------------------

const INSUFFICIENT = {
  title: "Insufficient independent coverage for an interval",
  insufficientLine: (
    unitCount: number,
    required: number,
    resolverVersion: string,
    digest: string,
  ) =>
    `${unitCount} resolved task-cluster units · ${required} required · resolver ${resolverVersion} · digest ${digest}…`,
} as const;

// --- §5.6 ClaimMark -----------------------------------------------------------

const CLAIM_WORDS: Record<string, string> = {
  strongest_supported: "Strongest supported",
  weakest_supported: "Weakest supported",
  mixed: "Mixed",
  descriptive_only: "Descriptive only",
  missing: "Missing",
};

const CLAIM = {
  words: CLAIM_WORDS,
  boundaryTitle: (boundaryRef: string) =>
    `Boundary declared by ${boundaryRef} before these results.`,
} as const;

// --- §5.7 PairedGlyphStrip ----------------------------------------------------

const PAIRED_GLYPH_STRIP = {
  legend: "W won · T tied · L lost — per shared task, task order fixed",
  accessibleName: (outcome: "win" | "tie" | "loss", taskId: string) => {
    const verb = outcome === "win" ? "Won" : outcome === "tie" ? "Tied" : "Lost";
    return `${verb} on task ${taskId}`;
  },
} as const;

// --- §5.8 DeterministicNarrative ----------------------------------------------

const DETERMINISTIC_NARRATIVE = {
  header: "OVERVIEW — TEMPLATE-GENERATED",
  footer:
    "Every sentence is generated from fixed templates over the facts below. It adds no judgment.",
} as const;

// --- §7.5 ComparatorPicker ----------------------------------------------------

const COMPARATOR_PICKER = {
  trigger: "Select comparator",
  title: "Select comparator",
  rankingLabel: "Ordered by shared-task overlap, not quality.",
  sharedTasks: (n: number) => `${n} shared eligible Tasks`,
} as const;

// --- §5.10 NarrowingChipBar ---------------------------------------------------

const NARROWING_CHIP_BAR = {
  clearAll: "Clear all",
  removeLabel: (label: string) => `Remove ${label}`,
} as const;

// --- §5.11 ObservationCard ----------------------------------------------------

const OBSERVATION_CARD = {
  rowLabels: {
    task: "Task",
    version: "Version",
    instance: "Instance",
    eligibility: "Eligibility",
    evidenceClass: "Evidence class",
    source: "Source",
  },
} as const;

// --- §9 Rollup forward contract -----------------------------------------------

const ROLLUP = {
  eyebrow: "SAVED ROLLUP",
  policy:
    "Stratified only. This rollup is a pinned list of exact configurations shown side by side. It is not a model, not a pooled respondent, and never produces a merged estimate.",
  membersLine: (memberCount: number, pinnedDate: string, digest: string) =>
    `Members: ${memberCount} exact configurations · version pinned ${pinnedDate} · member manifest digest ${digest}….`,
  immutability: "Member or name changes create a new version; this version is pinned forever.",
  tombstone: (memberId: string) => `Member ${memberId} is not present in this database`,
  differsMarker: "differs",
} as const;

// --- Task 8 worker computation phases -----------------------------------------

// Accessible labels for the off-main-thread computation phases emitted by the
// model-profile Worker. Keys mirror ProfileWorkerPhase; kept as a plain string
// table so the copy module stays free of lib imports.
const COMPUTATION_PHASE = {
  select: "Selecting exact observations",
  coverage: "Summarizing coverage",
  aggregate: "Aggregating task-family evidence",
  uncertainty: "Resolving uncertainty units",
  family_loop: "Computing family intervals",
  evidence_rows: "Building evidence rows",
  paired: "Computing paired comparison",
  identity: "Finalizing identity receipt",
  done: "Finalizing",
} as const;

export type ProfilePhaseKey = keyof typeof COMPUTATION_PHASE;

// --- Public surface -----------------------------------------------------------

export const COPY = {
  honestValue: HONEST_VALUE,
  versionStatus: VERSION_STATUS,
  evidenceMix: EVIDENCE_MIX,
  cohort: COHORT,
  insufficient: INSUFFICIENT,
  claim: CLAIM,
  pairedGlyphStrip: PAIRED_GLYPH_STRIP,
  deterministicNarrative: DETERMINISTIC_NARRATIVE,
  comparatorPicker: COMPARATOR_PICKER,
  narrowingChipBar: NARROWING_CHIP_BAR,
  observationCard: OBSERVATION_CARD,
  rollup: ROLLUP,
  computationPhase: COMPUTATION_PHASE,
} as const;

// --- Forbidden-copy guard -----------------------------------------------------

/**
 * UI-literal forbidden patterns (spec §10) beyond {@link FORBIDDEN_CLAIM_PHRASES}:
 * `n=<digits>` anywhere, "Overall score", "Best model", "good at", and the
 * causal verb "because the model". Checked case-insensitively against every
 * exported string in {@link ALL_COPY_STRINGS}.
 */
export const FORBIDDEN_COPY_PATTERNS: readonly RegExp[] = [
  /\bn\s*=\s*\d/i,
  /\boverall score\b/i,
  /\bbest model\b/i,
  /\bgood at\b/i,
  /because the model/i,
];

/**
 * Every literal string the table can emit, flattened for the forbidden-copy
 * sweep. Template functions are sampled with representative arguments that
 * exercise their literals without producing a forbidden scalar.
 */
export const ALL_COPY_STRINGS: readonly string[] = [
  VERIFIED_ON_SENTENCE,
  WON_TIED_LOST_SENTENCE,
  MIXED_COHORTS_SENTENCE,
  PROVIDER_VERSION_SENTENCE,
  INSUFFICIENT_SENTENCE,
  HONEST_VALUE.unavailableWord,
  HONEST_VALUE.limitedMarker,
  HONEST_VALUE.unresolved(14),
  VERSION_STATUS.exact,
  VERSION_STATUS.rollingAlias,
  VERSION_STATUS.partialIdentity,
  VERSION_STATUS.rollingAliasWindow("May–Aug 2026"),
  VERSION_STATUS.partialIdentityDimension("no resolved version"),
  ...Object.values(EVIDENCE_MIX.words),
  COHORT.nonPoolingDivider,
  COHORT.interval(95, 64.1, 77.8, 6, "task-cluster"),
  INSUFFICIENT.title,
  INSUFFICIENT.insufficientLine(4, 5, "v1", "9a2f"),
  ...Object.values(CLAIM_WORDS),
  CLAIM.boundaryTitle("rubric rub-eval@2"),
  PAIRED_GLYPH_STRIP.legend,
  PAIRED_GLYPH_STRIP.accessibleName("win", "code-transform-03"),
  PAIRED_GLYPH_STRIP.accessibleName("tie", "code-transform-02"),
  PAIRED_GLYPH_STRIP.accessibleName("loss", "code-transform-01"),
  DETERMINISTIC_NARRATIVE.header,
  DETERMINISTIC_NARRATIVE.footer,
  COMPARATOR_PICKER.trigger,
  COMPARATOR_PICKER.title,
  COMPARATOR_PICKER.rankingLabel,
  COMPARATOR_PICKER.sharedTasks(12),
  NARROWING_CHIP_BAR.clearAll,
  NARROWING_CHIP_BAR.removeLabel("Task: t-1"),
  ...Object.values(OBSERVATION_CARD.rowLabels),
  ROLLUP.eyebrow,
  ROLLUP.policy,
  ...Object.values(COMPUTATION_PHASE),
  ROLLUP.immutability,
  ROLLUP.tombstone("mc-4f"),
  ROLLUP.differsMarker,
];

// Re-export so the forbidden sweep in copy.test.ts can locate the source list.
export { FORBIDDEN_CLAIM_PHRASES };
