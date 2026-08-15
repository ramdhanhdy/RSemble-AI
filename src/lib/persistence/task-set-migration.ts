// =============================================================================
// RSemble AI — Suite → Task Set migration (Child 03 Milestone B, Task 4)
//
// Deterministic, resumable reconstruction of canonical Task Set records and
// immutable versions from legacy EvaluationSuite rows and historical
// ExperimentRecord snapshots, plus exact Suite/Experiment/Fusion-owner
// crosswalks. Spec §8.1/§8.2, §10; implementation plan Task 4.
//
// Hard rules (spec §8, implementation plan STOP conditions):
//  - Source evidence is read-only. Suites, experiments, Rubric records/versions,
//    child-02 Task stores, and every Fusion collection are never included in a
//    write transaction; their persisted payloads are byte/semantic unchanged.
//  - One Task Set per Suite (taskSetId = suiteId); one Task Set Version only
//    when the complete workload manifest digest changes. Canonical version
//    numbers are contiguous positions in the deterministic digest chronology,
//    never legacy suiteVersion values.
//  - Each embedded legacy task resolves through the exact child-02 coordinate
//    (suiteId, suiteVersion, taskId, definitionDigest) and verifies the target
//    canonical Task Version exists. Absence yields an explicit unresolved
//    member — never latest substitution, invention, or omission.
//  - Every Experiment maps to the exact reconstructed version (or explicit
//    unresolved); row-level suiteId/suiteVersion/protocolFingerprint must agree
//    with the frozen snapshot. Every Fusion Study maps by its full frozen
//    suiteRef (suiteId, suiteVersion, protocolFingerprint); Trial/Playbook
//    suiteRefs must agree. Disagreement or no unique match is unresolved,
//    never guessed.
//  - Writes are idempotent: pre-existing identical rows are reused, non-
//    identical collisions abort without overwrite, the completion marker is
//    written only after independent verification, and repeat startup with a
//    valid marker performs no writes.
// =============================================================================

import { canonicalJsonString, computeProtocolFingerprint, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import { legacyTaskCrosswalkKey } from "./canonical-task-migration";
import {
  computeLegacyExecutableDefinitionDigest,
  resolveLegacyDefinitionStatus,
} from "../tasks/legacy-task-inventory";
import type {
  EvaluationRubric,
  EvaluationSelection,
  EvaluationSuite,
  EvaluationTask,
  ExperimentRecord,
  ExperimentSnapshot,
  TaskEvaluationSelection,
  TaskVerification,
} from "../evaluations/evaluation-types";
import type { ModelSlot } from "../../studio-data";
import type { CriticRef, ReasoningPolicy } from "../providers/types";
import type {
  JudgeSnapshot,
  ProtocolDefaults,
  TaskExecutionOverrides,
  TaskSetMember,
  TaskSetRecord,
  TaskSetVersion,
  TaskVersionRef,
} from "../evaluations/task-set-types";
import type { FusionPlaybook, FusionStudy, FusionTrial, SuiteSnapshotRef } from "../evaluations/fusion-study-types";
import {
  type RSembleEvaluationDB,
  type TaskSetOwnershipCrosswalkRow,
  StorageError,
  classifyStorageError,
} from "./database";

export const taskSetMigrationMarkerKey = "task-set-migration:v1";

export interface TaskSetMigrationResult {
  migratedSuites: number;
  createdVersions: number;
  crosswalksWritten: number;
  unresolvedMembers: number;
  unresolvedExperiments: number;
  unresolvedFusionOwners: number;
  complete: boolean;
}

/** Shape of the persisted terminal completion marker. */
interface MigrationMarkerValue {
  kind: string;
  version: number;
  completedAt: number;
  migratedSuites: number;
  unresolvedMembers: number;
  unresolvedExperiments: number;
  unresolvedFusionOwners: number;
}

/** A terminal marker is valid when its kind/version identify a completed
 *  migration. The completedAt timestamp is recorded once on completion and
 *  never rewritten, because a valid marker short-circuits repeat startup. */
function isValidMigrationMarker(value: unknown): value is MigrationMarkerValue {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.kind === "task-set-migration" && v.version === 1;
}

// --- internal types ---------------------------------------------------------

interface LegacyWorkloadView {
  suiteId: string;
  suiteVersion: number;
  tasks: EvaluationTask[];
  modelSlots: ModelSlot[];
  defaultJudge: CriticRef;
  defaultEvaluation: EvaluationSelection;
  reasoningPolicy?: ReasoningPolicy;
  /** Referenced rubrics resolved from profileVersions (Suite) or embedded in
   *  the snapshot (Experiment), filtered to referenced refs, sorted by
   *  id/version. Empty for holistic evaluation. */
  rubrics: EvaluationRubric[];
  /** Shipped semantic protocol fingerprint (`sha256:<hex>`). */
  protocolFingerprint: string;
  createdAt: number;
}

interface MemberDescriptor {
  task: EvaluationTask;
  resolved: TaskVersionRef | null;
  definitionDigest: string | null;
  unresolvedReason: string | null;
}

interface Observation {
  source: "experiment" | "suite";
  experimentId: string | null;
  suiteVersion: number;
  executedAt: number | null;
  createdAt: number;
  view: LegacyWorkloadView;
  members: MemberDescriptor[];
  digest: string;
  unresolvedMemberIds: string[];
}

interface ReconstructedVersion {
  version: number;
  digest: string;
  representative: Observation;
  observations: Observation[];
}

interface SuitePlan {
  suite: EvaluationSuite;
  versions: ReconstructedVersion[];
  /** Full suiteRef coordinate → set of candidate canonical versions, for
   *  Fusion owner resolution. A coordinate is resolvable only when the set
   *  has exactly one member (no duplicate-coordinate ambiguity). */
  coordinateToVersion: Map<string, Set<number>>;
}

// --- projection helpers (pure, mirror suite-compat without mutating source) --

function rubricRefFromEvaluation(sel: EvaluationSelection | TaskEvaluationSelection): { id: string; version: number } | null {
  if (sel.kind === "profile") return { id: sel.profile.id, version: sel.profile.version };
  return null;
}

function cloneSelection(sel: TaskEvaluationSelection): TaskEvaluationSelection {
  if (sel.kind === "profile") return { kind: "profile", profile: { ...sel.profile } };
  return { kind: sel.kind };
}

function executionOverridesFromTask(t: EvaluationTask): TaskExecutionOverrides {
  const overrides: TaskExecutionOverrides = {
    evaluation: cloneSelection(t.evaluation),
    judgeInstructionOverride: t.judgeInstructionOverride,
  };
  if (t.verification !== undefined) {
    overrides.verification = { ...t.verification };
  }
  return overrides;
}

function judgeSnapshotFromCritic(ref: CriticRef): JudgeSnapshot {
  return { providerId: ref.providerId, model: ref.model };
}

function protocolDefaultsFromReasoningPolicy(reasoningPolicy?: ReasoningPolicy): ProtocolDefaults {
  if (!reasoningPolicy) return {};
  return { reasoningPolicy: { candidates: reasoningPolicy.candidates, judge: reasoningPolicy.judge } };
}

/** Locale-independent code-unit ordinal comparator for string identifiers.
 *  Used for every deterministic ordering (Rubric id tie-break, Experiment-id
 *  chronology tie-break) so digest coalescing and canonical version assignment
 *  do not depend on host collation. */
function compareOrdinal(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// --- rubric resolution ------------------------------------------------------

function collectReferencedRubricRefs(view: {
  defaultEvaluation: EvaluationSelection;
  tasks: EvaluationTask[];
}): Array<{ id: string; version: number }> {
  const refs: Array<{ id: string; version: number }> = [];
  const defaultRef = rubricRefFromEvaluation(view.defaultEvaluation);
  if (defaultRef) refs.push(defaultRef);
  for (const t of view.tasks) {
    const r = rubricRefFromEvaluation(t.evaluation);
    if (r) refs.push(r);
  }
  return refs;
}

function resolveRubrics(
  refs: Array<{ id: string; version: number }>,
  rubricVersionMap: Map<string, EvaluationRubric>,
  embedded: EvaluationRubric[],
): EvaluationRubric[] {
  const byKey = new Map<string, EvaluationRubric>();
  for (const r of embedded) byKey.set(`${r.id}::v${r.version}`, r);
  const out: EvaluationRubric[] = [];
  for (const ref of refs) {
    const key = `${ref.id}::v${ref.version}`;
    const resolved = byKey.get(key) ?? rubricVersionMap.get(key);
    if (resolved) out.push(resolved);
  }
  out.sort((a, b) => (a.id !== b.id ? compareOrdinal(a.id, b.id) : a.version - b.version));
  // Deduplicate by id+version while preserving order.
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.id}::v${r.version}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// --- legacy task definition digest (mirrors legacy-task-inventory) -----------

function legacyDefinitionDigest(t: EvaluationTask): string | null {
  if (resolveLegacyDefinitionStatus(t) !== "complete") return null;
  const definition = {
    title: t.title,
    objective: t.prompt,
    candidateInstruction: t.systemPrompt,
    defaultContextManifest: [] as never[],
    responseContract: null,
    taskVerifierRef: (t.verification ?? null) as TaskVerification | null,
    evaluation: t.evaluation,
  };
  return computeLegacyExecutableDefinitionDigest(definition);
}

// --- migration workload digest ----------------------------------------------

function rubricDigestEntry(r: EvaluationRubric): unknown {
  const groupsPresent = Array.isArray(r.requirementGroups) && r.requirementGroups.length > 0;
  const hasBinary = r.criteria.some((c) => c.kind === "binary");
  const groups = groupsPresent
    ? r.requirementGroups!.map((g) => ({
        name: g.name,
        checkIds: g.checkIds,
        weight: g.weight,
        mode: g.mode,
      }))
    : undefined;
  const lambda = groupsPresent || hasBinary ? (r.complianceInfluence ?? 1.0) : undefined;
  return {
    id: r.id,
    version: r.version,
    name: r.name,
    description: r.description,
    judgeInstruction: r.judgeInstruction,
    criteria: r.criteria,
    requirementGroups: groups,
    complianceInfluence: lambda,
  };
}

function buildWorkloadDigestInput(view: LegacyWorkloadView, members: MemberDescriptor[]): unknown {
  return {
    members: members.map((m) => ({
      id: m.task.id,
      order: m.task.order,
      role: "organic",
      weight: 1,
      stratum: null,
      evaluation: m.task.evaluation,
      judgeInstructionOverride: m.task.judgeInstructionOverride,
      verification: m.task.verification ?? null,
      rubricOverrideRef: rubricRefFromEvaluation(m.task.evaluation),
      taskVersionRef: m.resolved,
      unresolved:
        m.resolved === null
          ? { legacyTaskId: m.task.id, definitionDigest: m.definitionDigest }
          : null,
    })),
    modelSlots: view.modelSlots.map((s) => ({
      id: s.id,
      providerId: s.providerId,
      slug: s.slug,
      model: s.model,
      enabled: s.enabled,
    })),
    defaultJudge: { providerId: view.defaultJudge.providerId, model: view.defaultJudge.model },
    defaultRubricRef: rubricRefFromEvaluation(view.defaultEvaluation),
    repeatPolicy: { kind: "none" },
    missingnessPolicy: { kind: "allow-repair" },
    protocolDefaults: protocolDefaultsFromReasoningPolicy(view.reasoningPolicy),
    rubrics: view.rubrics.map(rubricDigestEntry),
    aggregationPolicy: "equal-task",
    trialsPerTask: 1,
  };
}

function computeWorkloadDigest(view: LegacyWorkloadView, members: MemberDescriptor[]): string {
  return hashArtifactContent(canonicalJsonString(buildWorkloadDigestInput(view, members)));
}

// --- observation construction ----------------------------------------------

function isEvaluationSuite(v: unknown): v is EvaluationSuite {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.version === "number" &&
    Array.isArray(o.tasks) &&
    typeof o.name === "string" &&
    Array.isArray(o.modelSlots)
  );
}

function isExperimentRecord(v: unknown): v is ExperimentRecord {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.suiteId !== "string" || typeof o.suiteVersion !== "number") return false;
  const snap = o.snapshot;
  if (typeof snap !== "object" || snap === null || Array.isArray(snap)) return false;
  const s = snap as Record<string, unknown>;
  return (
    typeof s.suiteId === "string" &&
    typeof s.suiteVersion === "number" &&
    Array.isArray(s.tasks) &&
    typeof s.createdAt === "number" &&
    typeof s.protocolFingerprint === "string"
  );
}

function buildViewFromSuite(
  suite: EvaluationSuite,
  rubricVersionMap: Map<string, EvaluationRubric>,
): LegacyWorkloadView {
  const refs = collectReferencedRubricRefs(suite);
  const rubrics = resolveRubrics(refs, rubricVersionMap, []);
  return {
    suiteId: suite.id,
    suiteVersion: suite.version,
    tasks: suite.tasks,
    modelSlots: suite.modelSlots,
    defaultJudge: suite.defaultJudge,
    defaultEvaluation: suite.defaultEvaluation,
    reasoningPolicy: suite.reasoningPolicy,
    rubrics,
    protocolFingerprint: computeProtocolFingerprint(suite, rubrics),
    createdAt: suite.updatedAt,
  };
}

function buildViewFromSnapshot(snap: ExperimentSnapshot): LegacyWorkloadView {
  const refs = collectReferencedRubricRefs({
    defaultEvaluation: snap.defaultEvaluation,
    tasks: snap.tasks,
  });
  const rubrics = resolveRubrics(refs, new Map(), snap.profiles ?? []);
  return {
    suiteId: snap.suiteId,
    suiteVersion: snap.suiteVersion,
    tasks: snap.tasks,
    modelSlots: snap.modelSlots,
    defaultJudge: snap.defaultJudge,
    defaultEvaluation: snap.defaultEvaluation,
    reasoningPolicy: snap.reasoningPolicy,
    rubrics,
    protocolFingerprint: snap.protocolFingerprint,
    createdAt: snap.createdAt,
  };
}

function resolveMembers(
  view: LegacyWorkloadView,
  crosswalkMap: Map<string, { taskId: string; taskVersion: number }>,
  taskVersionSet: Set<string>,
): { members: MemberDescriptor[]; unresolvedMemberIds: string[] } {
  const members: MemberDescriptor[] = [];
  const unresolvedMemberIds: string[] = [];
  for (const t of view.tasks) {
    const definitionDigest = legacyDefinitionDigest(t);
    let resolved: TaskVersionRef | null = null;
    let unresolvedReason: string | null = null;
    if (definitionDigest === null) {
      unresolvedReason = "incomplete-legacy-definition";
    } else {
      const key = legacyTaskCrosswalkKey(view.suiteId, view.suiteVersion, t.id, definitionDigest);
      const cw = crosswalkMap.get(key);
      if (cw && taskVersionSet.has(`${cw.taskId}::v${cw.taskVersion}`)) {
        resolved = { taskId: cw.taskId, version: cw.taskVersion };
      } else {
        unresolvedReason = "unmapped-crosswalk";
      }
    }
    if (resolved === null) unresolvedMemberIds.push(t.id);
    members.push({ task: t, resolved, definitionDigest, unresolvedReason });
  }
  return { members, unresolvedMemberIds };
}

function compareObservations(a: Observation, b: Observation): number {
  if (a.suiteVersion !== b.suiteVersion) return a.suiteVersion - b.suiteVersion;
  if (a.executedAt === null && b.executedAt !== null) return 1;
  if (a.executedAt !== null && b.executedAt === null) return -1;
  if (a.executedAt !== null && b.executedAt !== null && a.executedAt !== b.executedAt) {
    return a.executedAt - b.executedAt;
  }
  return compareOrdinal(a.experimentId ?? "", b.experimentId ?? "");
}

// --- TaskSetRecord / TaskSetVersion construction ----------------------------

function buildTaskSetRecord(suite: EvaluationSuite, latestVersion: number): TaskSetRecord {
  return {
    id: suite.id,
    latestVersion,
    name: suite.name,
    description: suite.description,
    createdAt: suite.createdAt,
    updatedAt: suite.updatedAt,
    archivedAt: suite.archivedAt,
    revision: 0,
    origin: "legacy-suite",
  };
}

function buildTaskSetVersion(taskSetId: string, canonicalVersion: number, obs: Observation): TaskSetVersion {
  const members: TaskSetMember[] = obs.members.map((m) => ({
    id: m.task.id,
    taskVersionRef: m.resolved ?? { taskId: "", version: 0 },
    order: m.task.order,
    role: "organic",
    stratum: null,
    weight: 1,
    rubricOverrideRef: rubricRefFromEvaluation(m.task.evaluation),
    executionOverrides: executionOverridesFromTask(m.task),
    unresolved: m.unresolvedReason,
  }));
  return {
    taskSetId,
    version: canonicalVersion,
    members,
    defaultRubricRef: rubricRefFromEvaluation(obs.view.defaultEvaluation),
    defaultModelSlots: obs.view.modelSlots.map((s) => ({ ...s })),
    defaultJudge: judgeSnapshotFromCritic(obs.view.defaultJudge),
    repeatPolicy: { kind: "none" },
    missingnessPolicy: { kind: "allow-repair" },
    protocolDefaults: protocolDefaultsFromReasoningPolicy(obs.view.reasoningPolicy),
    createdAt: obs.createdAt,
  };
}

// --- crosswalk row keys -----------------------------------------------------

function suiteManifestKey(taskSetId: string, digest: string): string {
  return `ts-xwalk:suite:${taskSetId}:${digest}`;
}
function experimentOwnerKey(experimentId: string): string {
  return `ts-xwalk:exp:${experimentId}`;
}
function fusionOwnerKey(studyId: string): string {
  return `ts-xwalk:fusion:${studyId}`;
}

function sameJson(a: unknown, b: unknown): boolean {
  return canonicalJsonString(a) === canonicalJsonString(b);
}

// --- planning ---------------------------------------------------------------

interface MigrationPlan {
  suitePlans: SuitePlan[];
  experiments: ExperimentRecord[];
  fusionStudies: FusionStudy[];
  fusionTrials: FusionTrial[];
  fusionPlaybooks: FusionPlaybook[];
  unresolvedMemberTotal: number;
}

async function buildPlan(
  db: RSembleEvaluationDB,
  crosswalkMap: Map<string, { taskId: string; taskVersion: number }>,
  taskVersionSet: Set<string>,
  rubricVersionMap: Map<string, EvaluationRubric>,
): Promise<MigrationPlan> {
  const [suiteRows, experimentRows, fusionStudyRows, fusionTrialRows, fusionPlaybookRows] = await Promise.all([
    db.suites.toArray(),
    db.experiments.toArray(),
    db.fusionStudies.toArray(),
    db.fusionTrials.toArray(),
    db.fusionPlaybooks.toArray(),
  ]);

  const suites = suiteRows.map((r) => r.suite).filter(isEvaluationSuite);
  const experiments = experimentRows.map((r) => r.experiment).filter(isExperimentRecord);
  const fusionStudies = fusionStudyRows
    .map((r) => r.study)
    .filter((v): v is FusionStudy => v != null && typeof v === "object" && "suiteRef" in v);
  const fusionTrials = fusionTrialRows
    .map((r) => r.trial)
    .filter((v): v is FusionTrial => v != null && typeof v === "object" && "suiteRef" in v);
  const fusionPlaybooks = fusionPlaybookRows
    .map((r) => r.playbook)
    .filter((v): v is FusionPlaybook => v != null && typeof v === "object" && "suiteRef" in v);

  const experimentsBySuite = new Map<string, ExperimentRecord[]>();
  for (const e of experiments) {
    const list = experimentsBySuite.get(e.suiteId) ?? [];
    list.push(e);
    experimentsBySuite.set(e.suiteId, list);
  }

  const suitePlans: SuitePlan[] = [];
  let unresolvedMemberTotal = 0;

  for (const suite of suites) {
    const observations: Observation[] = [];
    // Historical experiment snapshots (frozen authority).
    for (const e of experimentsBySuite.get(suite.id) ?? []) {
      const snap = e.snapshot;
      if (snap.suiteId !== suite.id) continue; // row/snapshot suiteId must agree
      const view = buildViewFromSnapshot(snap);
      const { members, unresolvedMemberIds } = resolveMembers(view, crosswalkMap, taskVersionSet);
      observations.push({
        source: "experiment",
        experimentId: e.id,
        suiteVersion: snap.suiteVersion,
        executedAt: e.createdAt,
        createdAt: snap.createdAt,
        view,
        members,
        digest: computeWorkloadDigest(view, members),
        unresolvedMemberIds,
      });
    }
    // Current suite (latest, possibly unexecuted) — ordered after history.
    const currentView = buildViewFromSuite(suite, rubricVersionMap);
    const { members: currentMembers, unresolvedMemberIds: currentUnresolved } = resolveMembers(
      currentView,
      crosswalkMap,
      taskVersionSet,
    );
    observations.push({
      source: "suite",
      experimentId: null,
      suiteVersion: suite.version,
      executedAt: null,
      createdAt: suite.updatedAt,
      view: currentView,
      members: currentMembers,
      digest: computeWorkloadDigest(currentView, currentMembers),
      unresolvedMemberIds: currentUnresolved,
    });

    observations.sort(compareObservations);

    // Coalesce by digest → contiguous canonical versions.
    const byDigest = new Map<string, Observation[]>();
    for (const obs of observations) {
      const list = byDigest.get(obs.digest) ?? [];
      list.push(obs);
      byDigest.set(obs.digest, list);
    }
    // Preserve chronological order of first appearance.
    const seenDigests = new Set<string>();
    const orderedDigests: string[] = [];
    for (const obs of observations) {
      if (!seenDigests.has(obs.digest)) {
        seenDigests.add(obs.digest);
        orderedDigests.push(obs.digest);
      }
    }
    const versions: ReconstructedVersion[] = [];
    for (let i = 0; i < orderedDigests.length; i += 1) {
      const digest = orderedDigests[i];
      const group = byDigest.get(digest)!;
      const representative = [...group].sort(compareObservations)[0];
      versions.push({
        version: i + 1,
        digest,
        representative,
        observations: group,
      });
      if (representative.unresolvedMemberIds.length > 0) {
        unresolvedMemberTotal += representative.unresolvedMemberIds.length;
      }
    }
    const coordinateToVersion = new Map<string, Set<number>>();
    for (const v of versions) {
      const seen = new Set<string>();
      for (const obs of v.observations) {
        const coord = `${obs.view.suiteId}::v${obs.view.suiteVersion}::${obs.view.protocolFingerprint}`;
        if (seen.has(coord)) continue;
        seen.add(coord);
        const candidates = coordinateToVersion.get(coord) ?? new Set<number>();
        candidates.add(v.version);
        coordinateToVersion.set(coord, candidates);
      }
    }

    suitePlans.push({ suite, versions, coordinateToVersion });
  }

  return {
    suitePlans,
    experiments,
    fusionStudies,
    fusionTrials,
    fusionPlaybooks,
    unresolvedMemberTotal,
  };
}

// --- per-suite write --------------------------------------------------------

function buildSuiteManifestRows(plan: SuitePlan): TaskSetOwnershipCrosswalkRow[] {
  const rows: TaskSetOwnershipCrosswalkRow[] = [];
  for (const v of plan.versions) {
    const status = v.representative.unresolvedMemberIds.length > 0 ? "unresolved" : "resolved";
    rows.push({
      key: suiteManifestKey(plan.suite.id, v.digest),
      kind: "suite-manifest",
      taskSetId: plan.suite.id,
      version: v.version,
      digest: v.digest,
      status,
      unresolvedMemberIds: v.representative.unresolvedMemberIds.length
        ? [...v.representative.unresolvedMemberIds]
        : undefined,
      updatedAt: v.representative.createdAt,
    });
  }
  return rows;
}

function buildExperimentOwnerRows(
  plan: MigrationPlan,
): Array<{ row: TaskSetOwnershipCrosswalkRow; experiment: ExperimentRecord }> {
  const suitePlanById = new Map(plan.suitePlans.map((p) => [p.suite.id, p]));
  // experimentId → reconstructed version, derived from the plan's own
  // observations so Experiment mapping never recomputes a divergent digest.
  const experimentVersion = new Map<string, { version: number; digest: string }>();
  for (const sp of plan.suitePlans) {
    for (const v of sp.versions) {
      for (const obs of v.observations) {
        if (obs.experimentId !== null && !experimentVersion.has(obs.experimentId)) {
          experimentVersion.set(obs.experimentId, { version: v.version, digest: v.digest });
        }
      }
    }
  }
  const out: Array<{ row: TaskSetOwnershipCrosswalkRow; experiment: ExperimentRecord }> = [];
  for (const e of plan.experiments) {
    const snap = e.snapshot;
    const suitePlan = suitePlanById.get(e.suiteId);
    const rowAgrees =
      e.suiteId === snap.suiteId &&
      e.suiteVersion === snap.suiteVersion &&
      e.protocolFingerprint === snap.protocolFingerprint;
    let version: number | null = null;
    let status: "resolved" | "unresolved" = "unresolved";
    let digest: string | null = null;
    let note: string | null = null;
    if (!suitePlan) {
      note = "suite-not-found";
    } else if (!rowAgrees) {
      note = "row-snapshot-mismatch";
    } else {
      const match = experimentVersion.get(e.id);
      if (match) {
        version = match.version;
        digest = match.digest;
        status = "resolved";
      } else {
        note = "no-matching-version";
      }
    }
    out.push({
      experiment: e,
      row: {
        key: experimentOwnerKey(e.id),
        kind: "experiment-owner",
        taskSetId: e.suiteId,
        version,
        digest,
        status,
        experimentId: e.id,
        note,
        updatedAt: e.createdAt,
      },
    });
  }
  return out;
}

function buildFusionOwnerRows(plan: MigrationPlan): TaskSetOwnershipCrosswalkRow[] {
  const suitePlanById = new Map(plan.suitePlans.map((p) => [p.suite.id, p]));
  const trialsByStudy = new Map<string, FusionTrial[]>();
  for (const t of plan.fusionTrials) {
    const list = trialsByStudy.get(t.studyId) ?? [];
    list.push(t);
    trialsByStudy.set(t.studyId, list);
  }
  const playbooksByStudy = new Map<string, FusionPlaybook[]>();
  for (const p of plan.fusionPlaybooks) {
    const list = playbooksByStudy.get(p.studyId) ?? [];
    list.push(p);
    playbooksByStudy.set(p.studyId, list);
  }

  const rows: TaskSetOwnershipCrosswalkRow[] = [];
  for (const study of plan.fusionStudies) {
    const suitePlan = suitePlanById.get(study.suiteRef.suiteId);
    const coord = `${study.suiteRef.suiteId}::v${study.suiteRef.suiteVersion}::${study.suiteRef.protocolFingerprint}`;
    let version: number | null = null;
    let status: "resolved" | "unresolved" = "unresolved";
    let note: string | null = null;

    if (!suitePlan) {
      note = "suite-not-found";
    } else {
      const candidates = suitePlan.coordinateToVersion.get(coord);
      if (candidates === undefined || candidates.size === 0) {
        note = "no-matching-suiteRef";
      } else if (candidates.size > 1) {
        // The same full suiteRef coordinate occurs in more than one
        // reconstructed digest; the Study cannot be resolved by guess.
        note = "ambiguous-suiteRef";
      } else {
        // Unique candidate — verify Trial/Playbook suiteRefs agree with the
        // Study suiteRef before resolving.
        const trials = trialsByStudy.get(study.id) ?? [];
        const playbooks = playbooksByStudy.get(study.id) ?? [];
        const allAgree =
          trials.every((t) => sameSuiteRef(t.suiteRef, study.suiteRef)) &&
          playbooks.every((p) => sameSuiteRef(p.suiteRef, study.suiteRef));
        if (!allAgree) {
          note = "trial-or-playbook-suiteRef-disagreement";
        } else {
          version = [...candidates][0];
          status = "resolved";
        }
      }
    }

    rows.push({
      key: fusionOwnerKey(study.id),
      kind: "fusion-owner",
      taskSetId: study.suiteRef.suiteId,
      version,
      digest: null,
      status,
      suiteRef: { ...study.suiteRef },
      note,
      updatedAt: study.createdAt,
    });
  }
  return rows;
}

function sameSuiteRef(a: SuiteSnapshotRef, b: SuiteSnapshotRef): boolean {
  return (
    a.suiteId === b.suiteId &&
    a.suiteVersion === b.suiteVersion &&
    a.protocolFingerprint === b.protocolFingerprint
  );
}

// --- write execution --------------------------------------------------------

async function writeSuite(
  db: RSembleEvaluationDB,
  plan: SuitePlan,
  suiteManifestRows: TaskSetOwnershipCrosswalkRow[],
  counts: { createdVersions: number; crosswalksWritten: number },
): Promise<void> {
  const taskSetId = plan.suite.id;
  const expectedRecord = buildTaskSetRecord(plan.suite, plan.versions.length);
  await db.transaction("rw", db.taskSets, db.taskSetVersions, db.taskSetOwnershipCrosswalk, async () => {
    // TaskSetRecord — reuse identical, fail on non-identical collision.
    const existingRecord = await db.taskSets.get(taskSetId);
    if (existingRecord) {
      const existingRecordValue = existingRecord.record as TaskSetRecord;
      if (
        !sameJson(existingRecordValue, expectedRecord) ||
        existingRecord.latestVersion !== expectedRecord.latestVersion ||
        existingRecord.origin !== expectedRecord.origin ||
        existingRecord.revision !== expectedRecord.revision ||
        existingRecord.archivedAt !== expectedRecord.archivedAt
      ) {
        throw new StorageError(
          "conflict",
          `Task Set migration found a non-identical record collision for ${taskSetId}`,
        );
      }
    } else {
      await db.taskSets.put({
        id: expectedRecord.id,
        record: expectedRecord,
        latestVersion: expectedRecord.latestVersion,
        createdAt: expectedRecord.createdAt,
        updatedAt: expectedRecord.updatedAt,
        archivedAt: expectedRecord.archivedAt,
        origin: expectedRecord.origin,
        revision: expectedRecord.revision,
      });
    }

    // TaskSetVersions — reuse identical, write missing, fail on collision.
    for (const v of plan.versions) {
      const expectedVersion = buildTaskSetVersion(taskSetId, v.version, v.representative);
      const existing = await db.taskSetVersions.get([taskSetId, v.version]);
      if (existing) {
        if (!sameJson(existing.version_, expectedVersion) || existing.createdAt !== expectedVersion.createdAt) {
          throw new StorageError(
            "conflict",
            `Task Set migration found a non-identical version collision for ${taskSetId}@${v.version}`,
          );
        }
      } else {
        await db.taskSetVersions.put({
          taskSetId,
          version: expectedVersion.version,
          version_: expectedVersion,
          createdAt: expectedVersion.createdAt,
        });
        counts.createdVersions += 1;
      }
    }

    // suite-manifest crosswalk rows — reuse identical, write missing, fail on collision.
    for (const row of suiteManifestRows) {
      const existing = await db.taskSetOwnershipCrosswalk.get(row.key);
      if (existing) {
        if (!sameJson(existing, row)) {
          throw new StorageError(
            "conflict",
            `Task Set migration found a non-identical suite-manifest crosswalk collision for ${row.key}`,
          );
        }
      } else {
        await db.taskSetOwnershipCrosswalk.put(row);
        counts.crosswalksWritten += 1;
      }
    }
  });
}

async function writeExperimentOwners(
  db: RSembleEvaluationDB,
  entries: Array<{ row: TaskSetOwnershipCrosswalkRow; experiment: ExperimentRecord }>,
  counts: { crosswalksWritten: number },
): Promise<void> {
  await db.transaction("rw", db.taskSetOwnershipCrosswalk, async () => {
    for (const { row } of entries) {
      const existing = await db.taskSetOwnershipCrosswalk.get(row.key);
      if (existing) {
        if (!sameJson(existing, row)) {
          throw new StorageError(
            "conflict",
            `Task Set migration found a non-identical experiment-owner crosswalk collision for ${row.key}`,
          );
        }
      } else {
        await db.taskSetOwnershipCrosswalk.put(row);
        counts.crosswalksWritten += 1;
      }
    }
  });
}

async function writeFusionOwners(
  db: RSembleEvaluationDB,
  rows: TaskSetOwnershipCrosswalkRow[],
  counts: { crosswalksWritten: number },
): Promise<void> {
  await db.transaction("rw", db.taskSetOwnershipCrosswalk, async () => {
    for (const row of rows) {
      const existing = await db.taskSetOwnershipCrosswalk.get(row.key);
      if (existing) {
        if (!sameJson(existing, row)) {
          throw new StorageError(
            "conflict",
            `Task Set migration found a non-identical fusion-owner crosswalk collision for ${row.key}`,
          );
        }
      } else {
        await db.taskSetOwnershipCrosswalk.put(row);
        counts.crosswalksWritten += 1;
      }
    }
  });
}

// --- verification -----------------------------------------------------------

async function snapshotAllSources(db: RSembleEvaluationDB): Promise<string> {
  const [
    suites, experiments, rubrics, profileVersions, tasks, taskVersions, taskMigrationCrosswalk,
    fusionRecipes, poolManifests, fusionStudies, fusionTrials, fusionAttempts, fusionObservations, fusionPlaybooks,
  ] = await Promise.all([
    db.suites.toArray(), db.experiments.toArray(), db.profiles.toArray(), db.profileVersions.toArray(),
    db.tasks.toArray(), db.taskVersions.toArray(), db.taskMigrationCrosswalk.toArray(),
    db.fusionRecipes.toArray(), db.poolManifests.toArray(), db.fusionStudies.toArray(),
    db.fusionTrials.toArray(), db.fusionAttempts.toArray(), db.fusionObservations.toArray(), db.fusionPlaybooks.toArray(),
  ]);
  return canonicalJsonString({
    suites, experiments, rubrics, profileVersions, tasks, taskVersions, taskMigrationCrosswalk,
    fusionRecipes, poolManifests, fusionStudies, fusionTrials, fusionAttempts, fusionObservations, fusionPlaybooks,
  });
}

async function verifyMigration(
  db: RSembleEvaluationDB,
  plan: MigrationPlan,
  beforeSnapshot: string,
): Promise<void> {
  // (a) every experiment has an experiment-owner crosswalk.
  for (const e of plan.experiments) {
    const row = await db.taskSetOwnershipCrosswalk.get(experimentOwnerKey(e.id));
    if (!row) {
      throw new StorageError("validation", `Migration verification failed: experiment ${e.id} has no owner crosswalk`);
    }
  }
  // (b) every fusion study has a fusion-owner crosswalk.
  for (const s of plan.fusionStudies) {
    const row = await db.taskSetOwnershipCrosswalk.get(fusionOwnerKey(s.id));
    if (!row) {
      throw new StorageError("validation", `Migration verification failed: fusion study ${s.id} has no owner crosswalk`);
    }
  }
  // (c) every suite-manifest crosswalk target version exists with the expected digest.
  for (const sp of plan.suitePlans) {
    for (const v of sp.versions) {
      const row = await db.taskSetOwnershipCrosswalk.get(suiteManifestKey(sp.suite.id, v.digest));
      if (!row || row.version !== v.version) {
        throw new StorageError(
          "validation",
          `Migration verification failed: suite-manifest crosswalk missing for ${sp.suite.id}@${v.version}`,
        );
      }
      const versionRow = await db.taskSetVersions.get([sp.suite.id, v.version]);
      if (!versionRow) {
        throw new StorageError(
          "validation",
          `Migration verification failed: target version ${sp.suite.id}@${v.version} missing`,
        );
      }
    }
  }
  // (d) all source payloads unchanged.
  const afterSnapshot = await snapshotAllSources(db);
  if (afterSnapshot !== beforeSnapshot) {
    throw new StorageError("validation", "Migration verification failed: a source payload was mutated");
  }
}

// --- public entry point -----------------------------------------------------

/**
 * Reconstruct canonical Task Set records, immutable versions, and exact
 * Suite/Experiment/Fusion-owner crosswalks from legacy Suite and Experiment
 * evidence. Deterministic, idempotent, transactionally safe, and resumable.
 * The versioned completion marker is written only after independent
 * verification inside the safe persistence boundary.
 */
export async function migrateSuitesToTaskSets(db: RSembleEvaluationDB): Promise<TaskSetMigrationResult> {
  db.assertWritable();
  try {
    // A valid terminal marker makes repeat startup a no-write operation:
    // validate it at entry, before any planning or writes, and return without
    // touching storage. A failed/interrupted attempt never wrote a marker
    // (it is written only after verification below), so a valid marker is an
    // authoritative completion signal.
    const priorMarker = await db.storageMeta.get(taskSetMigrationMarkerKey);
    if (priorMarker && isValidMigrationMarker(priorMarker.value)) {
      const m = priorMarker.value;
      return {
        migratedSuites: m.migratedSuites,
        createdVersions: 0,
        crosswalksWritten: 0,
        unresolvedMembers: m.unresolvedMembers,
        unresolvedExperiments: m.unresolvedExperiments,
        unresolvedFusionOwners: m.unresolvedFusionOwners,
        complete: true,
      };
    }

    const beforeSnapshot = await snapshotAllSources(db);

    // Read-only authority catalogs.
    const [crosswalkRows, taskVersionRows, rubricVersionRows] = await Promise.all([
      db.taskMigrationCrosswalk.toArray(),
      db.taskVersions.toArray(),
      db.profileVersions.toArray(),
    ]);
    const crosswalkMap = new Map<string, { taskId: string; taskVersion: number }>();
    for (const r of crosswalkRows) crosswalkMap.set(r.legacyScopeKey, { taskId: r.taskId, taskVersion: r.taskVersion });
    const taskVersionSet = new Set<string>();
    for (const r of taskVersionRows) taskVersionSet.add(`${r.taskId}::v${r.version}`);
    const rubricVersionMap = new Map<string, EvaluationRubric>();
    for (const r of rubricVersionRows) {
      const rubric = r.profile;
      if (rubric && typeof rubric === "object" && "id" in rubric && "version" in rubric) {
        rubricVersionMap.set(
          `${(rubric as { id: string }).id}::v${(rubric as { version: number }).version}`,
          rubric as EvaluationRubric,
        );
      }
    }

    const plan = await buildPlan(db, crosswalkMap, taskVersionSet, rubricVersionMap);

    const counts = { createdVersions: 0, crosswalksWritten: 0 };
    for (const sp of plan.suitePlans) {
      if (sp.versions.length === 0) continue; // suite with no reconstructable workload
      const manifestRows = buildSuiteManifestRows(sp);
      await writeSuite(db, sp, manifestRows, counts);
    }

    const experimentEntries = buildExperimentOwnerRows(plan);
    await writeExperimentOwners(db, experimentEntries, counts);
    const fusionRows = buildFusionOwnerRows(plan);
    await writeFusionOwners(db, fusionRows, counts);

    await verifyMigration(db, plan, beforeSnapshot);

    // Marker — written only after verification. A valid marker would have
    // short-circuited at entry, so reaching here means the marker was absent
    // or invalid; record completion once.
    const markerValue: MigrationMarkerValue = {
      kind: "task-set-migration",
      version: 1,
      completedAt: Date.now(),
      migratedSuites: plan.suitePlans.filter((p) => p.versions.length > 0).length,
      unresolvedMembers: plan.unresolvedMemberTotal,
      unresolvedExperiments: experimentEntries.filter((e) => e.row.status === "unresolved").length,
      unresolvedFusionOwners: fusionRows.filter((r) => r.status === "unresolved").length,
    };
    await db.storageMeta.put({ key: taskSetMigrationMarkerKey, value: markerValue });

    return {
      migratedSuites: plan.suitePlans.filter((p) => p.versions.length > 0).length,
      createdVersions: counts.createdVersions,
      crosswalksWritten: counts.crosswalksWritten,
      unresolvedMembers: plan.unresolvedMemberTotal,
      unresolvedExperiments: experimentEntries.filter((e) => e.row.status === "unresolved").length,
      unresolvedFusionOwners: fusionRows.filter((r) => r.status === "unresolved").length,
      complete: true,
    };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw classifyStorageError(error);
  }
}
