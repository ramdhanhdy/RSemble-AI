import type { ComparisonRepository } from "../persistence/comparison-repository";
import type { EvaluationRepository } from "../persistence/evaluation-repository";
import type { EvidenceRepository } from "../persistence/evidence-repository";
import type { RunRepository } from "../persistence/run-repository";
import type { LegacyRunSummary, RunRecordV2, RunSummary } from "../persistence/run-types";
import type { StudyRepository } from "../persistence/study-repository";
import type { Observation } from "../evidence/evidence-types";
import type { PolicyStudyRecord } from "../studies/policy/policy-study-types";
import type { RecordReference, RecordType, TaskExecutionRecordReference } from "./record-reference";
import {
  composeRecordReferences,
  queryRecords,
  type RecordsPage,
  type RecordsQuery,
} from "./records-query";

const SOURCE_PAGE_SIZE = 500;

export interface RecordsRepositoryDependencies {
  runRepo: Pick<RunRepository, "get" | "list">;
  comparisonRepo: Pick<
    ComparisonRepository,
    "getComparisonResult" | "listComparisonResults"
  > | null;
  evaluationRepo: Pick<
    EvaluationRepository,
    "getExperiment" | "listExperiments" | "listSuites"
  > | null;
  studyRepo: Pick<
    StudyRepository,
    "getStudy" | "listStudies" | "listTrials" | "listObservations"
  > | null;
  evidenceRepo: Pick<
    EvidenceRepository,
    "getObservation" | "listObservations" | "listModelConfigurations"
  > | null;
}

export interface PolicyStudyChildren {
  trialCount: number;
  observationCount: number;
  exactRunCount: number;
  items: TaskExecutionRecordReference[];
}

export interface RecordsRepository {
  list(query: RecordsQuery): Promise<RecordsPage>;
  getReference(recordType: RecordType, id: string): Promise<RecordReference | null>;
  getTaskExecution(id: string): Promise<RunRecordV2 | null>;
  getLegacySummary(id: string): Promise<LegacyRunSummary | null>;
  getObservation(id: string): Promise<Observation | null>;
  getPolicyStudyRecord(id: string): Promise<PolicyStudyRecord | null>;
  getPolicyStudyChildren(id: string): Promise<PolicyStudyChildren>;
}

async function loadAllRuns(repo: Pick<RunRepository, "list">): Promise<RunSummary[]> {
  const all: RunSummary[] = [];
  for (let offset = 0; ; offset += SOURCE_PAGE_SIZE) {
    const page = await repo.list({ limit: SOURCE_PAGE_SIZE, offset });
    all.push(...page);
    if (page.length < SOURCE_PAGE_SIZE) return all;
  }
}

async function loadAllComparisons(repo: RecordsRepositoryDependencies["comparisonRepo"]) {
  if (!repo) return [];
  const all = [];
  for (let offset = 0; ; offset += SOURCE_PAGE_SIZE) {
    const page = await repo.listComparisonResults({ limit: SOURCE_PAGE_SIZE, offset });
    all.push(...page);
    if (page.length < SOURCE_PAGE_SIZE) return all;
  }
}

async function loadAllObservations(repo: RecordsRepositoryDependencies["evidenceRepo"]) {
  if (!repo) return [];
  const all: Observation[] = [];
  for (let offset = 0; ; offset += SOURCE_PAGE_SIZE) {
    const page = await repo.listObservations({ limit: SOURCE_PAGE_SIZE, offset });
    all.push(...page.items);
    if (all.length >= page.total || page.items.length < SOURCE_PAGE_SIZE) return all;
  }
}

async function policyStudyRunMap(
  repo: RecordsRepositoryDependencies["studyRepo"],
  studies: PolicyStudyRecord[],
): Promise<Record<string, string>> {
  if (!repo || studies.length === 0) return {};
  const links = new Map<string, Set<string>>();
  const children = await Promise.all(
    studies.map(async (study) => ({
      studyId: study.id,
      trials: await repo.listTrials(study.id),
      observations: await repo.listObservations(study.id),
    })),
  );
  for (const child of children) {
    for (const trial of child.trials) {
      for (const artifact of trial.artifactRefs) {
        const studyIds = links.get(artifact.runId) ?? new Set<string>();
        studyIds.add(child.studyId);
        links.set(artifact.runId, studyIds);
      }
    }
    for (const observation of child.observations) {
      if (!observation.sourceRunId) continue;
      const studyIds = links.get(observation.sourceRunId) ?? new Set<string>();
      studyIds.add(child.studyId);
      links.set(observation.sourceRunId, studyIds);
    }
  }
  const exact: Record<string, string> = {};
  for (const [runId, studyIds] of links) {
    if (studyIds.size === 1) exact[runId] = [...studyIds][0]!;
  }
  return exact;
}

export function createRecordsRepository(
  dependencies: RecordsRepositoryDependencies,
): RecordsRepository {
  async function loadReferences(): Promise<RecordReference[]> {
    const [
      runSummaries,
      comparisons,
      evaluations,
      policyStudies,
      observations,
      configurations,
      suites,
    ] = await Promise.all([
      loadAllRuns(dependencies.runRepo),
      loadAllComparisons(dependencies.comparisonRepo),
      dependencies.evaluationRepo?.listExperiments() ?? Promise.resolve([]),
      dependencies.studyRepo?.listStudies() ?? Promise.resolve([]),
      loadAllObservations(dependencies.evidenceRepo),
      dependencies.evidenceRepo?.listModelConfigurations() ?? Promise.resolve([]),
      dependencies.evaluationRepo?.listSuites(true) ?? Promise.resolve([]),
    ]);
    const [studyIdByRunId] = await Promise.all([
      policyStudyRunMap(dependencies.studyRepo, policyStudies),
    ]);
    const taskSetLabelById: Record<string, string> = {};
    for (const suite of suites) taskSetLabelById[suite.id] = suite.name;
    return composeRecordReferences({
      runSummaries,
      comparisons,
      evaluations,
      policyStudies,
      observations,
      modelConfigurations: configurations,
      policyStudyIdByRunId: studyIdByRunId,
      taskSetLabelById,
    });
  }

  return {
    async list(query) {
      return queryRecords(await loadReferences(), query);
    },
    async getReference(recordType, id) {
      if (id.trim().length === 0) return null;
      const page = queryRecords(await loadReferences(), {
        type: recordType,
        text: id,
        limit: 50,
      });
      return page.items.find((reference) => reference.id === id) ?? null;
    },
    getTaskExecution(id) {
      return dependencies.runRepo.get(id);
    },
    async getLegacySummary(id) {
      const summaries = await loadAllRuns(dependencies.runRepo);
      const summary = summaries.find((item) => item.id === id && item.kind === "legacy");
      return summary?.kind === "legacy" ? summary : null;
    },
    async getObservation(id) {
      return dependencies.evidenceRepo?.getObservation(id) ?? null;
    },
    async getPolicyStudyRecord(id) {
      return dependencies.studyRepo?.getStudy(id) ?? null;
    },
    async getPolicyStudyChildren(id) {
      if (!dependencies.studyRepo) {
        return { trialCount: 0, observationCount: 0, exactRunCount: 0, items: [] };
      }
      const [trials, observations, runSummaries] = await Promise.all([
        dependencies.studyRepo.listTrials(id),
        dependencies.studyRepo.listObservations(id),
        loadAllRuns(dependencies.runRepo),
      ]);
      const runIds = new Set<string>();
      for (const trial of trials) {
        for (const artifact of trial.artifactRefs) runIds.add(artifact.runId);
      }
      for (const observation of observations) {
        if (observation.sourceRunId) runIds.add(observation.sourceRunId);
      }
      const exactRuns = composeRecordReferences({
        runSummaries: runSummaries.filter((summary) => runIds.has(summary.id)),
        comparisons: [],
        evaluations: [],
        policyStudies: [],
        observations: [],
        modelConfigurations: [],
        policyStudyIdByRunId: Object.fromEntries([...runIds].map((runId) => [runId, id])),
      }).filter(
        (reference): reference is TaskExecutionRecordReference =>
          reference.recordType === "task-execution",
      );
      return {
        trialCount: trials.length,
        observationCount: observations.length,
        exactRunCount: exactRuns.length,
        items: exactRuns.slice(0, 20),
      };
    },
  };
}
