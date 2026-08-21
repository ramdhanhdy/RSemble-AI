import type { ComparisonResultIndex } from "../compare/comparison-result-types";
import type { ModelConfigurationSnapshot, Observation } from "../evidence/evidence-types";
import type { ExperimentRecord } from "../evaluations/evaluation-types";
import type { RunStatus, RunSummary } from "../persistence/run-types";
import type { PolicyStudyRecord } from "../studies/policy/policy-study-types";
import type { StudyStatus } from "../studies/study-types";
import type {
  ComparisonRecordReference,
  EvaluationExecutionReference,
  LegacyRecordReference,
  ObservationRecordReference,
  PolicyStudyReference,
  RecordReference,
  RecordStatus,
  RecordType,
  TaskExecutionRecordReference,
} from "./record-reference";

export interface RecordsCompositionInput {
  runSummaries: RunSummary[];
  comparisons: ComparisonResultIndex[];
  evaluations: ExperimentRecord[];
  policyStudies: PolicyStudyRecord[];
  observations: Observation[];
  modelConfigurations: ModelConfigurationSnapshot[];
  /** Exact durable study artifact/observation links, keyed by source run id. */
  policyStudyIdByRunId: Record<string, string>;
  taskSetLabelById?: Record<string, string>;
}

export interface RecordsQuery {
  text?: string;
  type?: RecordType;
  modelKey?: string;
  status?: RecordStatus;
  mode?: "rank" | "fuse";
  source?: "adhoc" | "experiment" | "legacy";
  limit?: number;
  offset?: number;
}

export interface RecordsPage {
  items: RecordReference[];
  total: number;
  offset: number;
  limit: number;
}

const STUDY_STATUS: Record<StudyStatus, RecordStatus> = {
  draft: "draft",
  in_progress: "running",
  completed: "completed",
  failed: "failed",
  archived: "archived",
};

function compareRecords(a: RecordReference, b: RecordReference): number {
  return (
    b.createdAt - a.createdAt ||
    a.id.localeCompare(b.id) ||
    a.recordType.localeCompare(b.recordType)
  );
}

function taskExecutionSource(
  summary: Extract<RunSummary, { kind: "full" }>,
  comparisonIds: ReadonlySet<string>,
  policyStudyIdByRunId: Readonly<Record<string, string>>,
): TaskExecutionRecordReference["runSource"] {
  const studyId = policyStudyIdByRunId[summary.id];
  if (studyId) return { kind: "policy-study", studyId };
  if (summary.source.kind === "experiment") {
    return {
      kind: "experiment",
      evaluationExecutionId: summary.source.experimentId,
      taskSetId: summary.source.suiteId,
    };
  }
  return { kind: "adhoc", comparisonId: comparisonIds.has(summary.id) ? summary.id : null };
}

function taskExecutionOwnerHint(
  source: TaskExecutionRecordReference["runSource"],
  taskSetLabelById: Readonly<Record<string, string>>,
): string {
  if (source.kind === "policy-study") return "in a Policy Study · Lab";
  if (source.kind === "experiment") {
    return `in ${taskSetLabelById[source.taskSetId] ?? "Evaluation"} · Task Set`;
  }
  return source.comparisonId ? "in Compare" : "Origin unresolved — exact execution preserved";
}

function childRunIds(experiment: ExperimentRecord): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const task of experiment.tasks) {
    for (const attempt of task.attempts) {
      if (!attempt.runId || seen.has(attempt.runId)) continue;
      seen.add(attempt.runId);
      ids.push(attempt.runId);
    }
  }
  return ids;
}

function enabledModelKeys(experiment: ExperimentRecord): string[] {
  return experiment.snapshot.modelSlots
    .filter((slot) => slot.enabled)
    .map((slot) => `${slot.providerId}:${slot.slug}`);
}

export function composeRecordReferences(input: RecordsCompositionInput): RecordReference[] {
  const references: RecordReference[] = [];
  const runSummaryById = new Map(input.runSummaries.map((summary) => [summary.id, summary]));
  const comparisonIds = new Set(input.comparisons.map((comparison) => comparison.id));
  const taskSetLabels = input.taskSetLabelById ?? {};
  const modelKeyByConfigurationId: Record<string, string> = {};
  for (const configuration of input.modelConfigurations) {
    modelKeyByConfigurationId[configuration.id] =
      `${configuration.providerId}:${configuration.requestedModel}`;
  }

  for (const comparison of input.comparisons) {
    const summary = runSummaryById.get(comparison.runId);
    const modelKeys = summary?.modelKeys ?? [];
    const reference: ComparisonRecordReference = {
      recordType: "comparison",
      id: comparison.id,
      createdAt: comparison.createdAt,
      updatedAt: Math.max(comparison.createdAt, comparison.updatedAt),
      title: comparison.title,
      status: comparison.status,
      mode: comparison.mode,
      source: "adhoc",
      modelKeys,
      searchText: [comparison.id, comparison.title, ...modelKeys].join(" ").toLowerCase(),
      ownerHint: "in Compare",
      runId: comparison.runId,
      taskBinding: comparison.taskBinding,
    };
    references.push(reference);
  }

  for (const evaluation of input.evaluations) {
    const modelKeys = enabledModelKeys(evaluation);
    const taskSetLabel = taskSetLabels[evaluation.suiteId] ?? "Evaluation";
    const reference: EvaluationExecutionReference = {
      recordType: "evaluation",
      id: evaluation.id,
      createdAt: evaluation.createdAt,
      updatedAt: Math.max(evaluation.createdAt, evaluation.updatedAt),
      title: `${taskSetLabel} execution`,
      status: evaluation.status,
      mode: null,
      source: "experiment",
      modelKeys,
      searchText: [evaluation.id, taskSetLabel, ...modelKeys].join(" ").toLowerCase(),
      ownerHint: `in ${taskSetLabel} · Task Set v${evaluation.suiteVersion}`,
      taskSetId: evaluation.suiteId,
      taskSetVersion: evaluation.suiteVersion,
      childRunIds: childRunIds(evaluation),
    };
    references.push(reference);
  }

  for (const study of input.policyStudies) {
    const reference: PolicyStudyReference = {
      recordType: "policy-study",
      id: study.id,
      createdAt: study.createdAt,
      updatedAt: Math.max(study.createdAt, study.updatedAt),
      title: study.title,
      status: STUDY_STATUS[study.status],
      mode: null,
      source: null,
      modelKeys: [],
      searchText: `${study.id} ${study.title}`.toLowerCase(),
      ownerHint: "in the Lab",
      claimLevel: study.claimLevel,
    };
    references.push(reference);
  }

  for (const observation of input.observations) {
    const modelKey = modelKeyByConfigurationId[observation.modelConfigurationId];
    const modelKeys = modelKey ? [modelKey] : [observation.modelConfigurationId];
    const reference: ObservationRecordReference = {
      recordType: "observation",
      id: observation.id,
      createdAt: observation.observedAt,
      updatedAt: observation.observedAt,
      title: `Observation for ${observation.taskId}`,
      status: "completed",
      mode: null,
      source: observation.sourceKind === "comparison" ? "adhoc" : "experiment",
      modelKeys,
      searchText: [
        observation.id,
        observation.taskId,
        observation.sourceResultId,
        observation.runId,
        ...modelKeys,
      ]
        .join(" ")
        .toLowerCase(),
      ownerHint: observation.sourceKind === "comparison" ? "from Compare" : "from an Evaluation",
      sourceKind: observation.sourceKind,
      sourceResultId: observation.sourceResultId,
      runId: observation.runId,
      taskId: observation.taskId,
      modelConfigurationId: observation.modelConfigurationId,
    };
    references.push(reference);
  }

  for (const summary of input.runSummaries) {
    if (summary.kind === "legacy") {
      const reference: LegacyRecordReference = {
        recordType: "legacy",
        id: summary.id,
        createdAt: summary.createdAt,
        updatedAt: summary.createdAt,
        title: summary.taskExcerpt.trim() || "Imported record",
        status: null,
        mode: null,
        source: "legacy",
        modelKeys: summary.modelKeys,
        searchText: [summary.id, summary.searchText, ...summary.modelKeys].join(" ").toLowerCase(),
        ownerHint: "Origin unresolved — preserved as imported",
        ownerCrosswalk: null,
      };
      references.push(reference);
      continue;
    }

    const runSource = taskExecutionSource(summary, comparisonIds, input.policyStudyIdByRunId);
    const reference: TaskExecutionRecordReference = {
      recordType: "task-execution",
      id: summary.id,
      createdAt: summary.createdAt,
      updatedAt: Math.max(summary.createdAt, summary.completedAt ?? summary.createdAt),
      title: summary.taskTitle,
      status: summary.status as RunStatus,
      mode: summary.mode,
      source: summary.source.kind === "experiment" ? "experiment" : "adhoc",
      modelKeys: summary.modelKeys,
      searchText: [summary.id, summary.searchText, ...summary.modelKeys].join(" ").toLowerCase(),
      ownerHint: taskExecutionOwnerHint(runSource, taskSetLabels),
      runSource,
    };
    references.push(reference);
  }

  const byTypedId = new Map<string, RecordReference>();
  for (const reference of references) {
    const key = `${reference.recordType}:${reference.id}`;
    const current = byTypedId.get(key);
    if (!current || reference.updatedAt > current.updatedAt) byTypedId.set(key, reference);
  }
  return [...byTypedId.values()].sort(compareRecords);
}

export function queryRecords(
  records: readonly RecordReference[],
  query: RecordsQuery,
): RecordsPage {
  const text = query.text?.trim().toLowerCase() ?? "";
  const filtered = records.filter((record) => {
    if (query.type && record.recordType !== query.type) return false;
    if (query.modelKey && !record.modelKeys.includes(query.modelKey)) return false;
    if (query.status && record.status !== query.status) return false;
    if (query.mode && record.mode !== query.mode) return false;
    if (query.source && record.source !== query.source) return false;
    return (
      text.length === 0 || record.id.toLowerCase() === text || record.searchText.includes(text)
    );
  });

  filtered.sort((a, b) => {
    if (text.length > 0) {
      const aExact = a.id.toLowerCase() === text ? 1 : 0;
      const bExact = b.id.toLowerCase() === text ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
    }
    return compareRecords(a, b);
  });

  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.max(1, query.limit ?? 50);
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    offset,
    limit,
  };
}
