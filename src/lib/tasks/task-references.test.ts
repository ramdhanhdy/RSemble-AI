// =============================================================================
// RSemble AI — Exact Task reference resolution tests (RED)
//
// Child 02 (Canonical Tasks) Milestone D, Task 9 (RED first).
//
// Covers spec §6–§7 and the Task 9 acceptance list:
//   - resolve current Suite and historical Experiment coordinates through
//     exact migration crosswalks — never the latest Task Version as fallback;
//   - archived Tasks stay referenceable; unresolved/corrupt/missing
//     crosswalks and incomplete definitions stay explicit;
//   - instances distinguish complete / metadata_only / incomplete;
//   - multiple suites with identical text stay namespaced;
//   - deterministic grouped counts; secret-shaped text is never disclosed.
//
// Pure read-model tests: no provider calls, no source-record mutation.
// =============================================================================

import { describe, expect, it } from "vitest";

import type {
  EvaluationSuite,
  EvaluationTask,
  ExperimentRecord,
} from "../evaluations/evaluation-types";
import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import { computeInstanceInputDigest } from "./task-instance";
import {
  abbreviateInputDigest,
  buildTaskReferenceReadModel,
  parseLegacyCrosswalkKey,
  summarizeTaskReferences,
  type TaskMigrationCrosswalk,
  type TaskReferenceSources,
} from "./task-references";
import type {
  TaskInstance,
  TaskRecord,
  TaskVersion,
} from "./task-types";
import { legacyTaskCrosswalkKey } from "../persistence/canonical-task-migration";

const NOW = 1_700_000_000_000;
const SECRET_TEXT = "sk-live123SECRET_TOKEN";

function makeEvalTask(overrides: Partial<EvaluationTask> = {}): EvaluationTask {
  return {
    id: "t1",
    title: "Summarize",
    prompt: "Summarize the passage.",
    systemPrompt: "Use three bullets.",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: 0,
    ...overrides,
  };
}

function makeSuite(overrides: Partial<EvaluationSuite> = {}): EvaluationSuite {
  return {
    id: "suite-1",
    revision: 1,
    version: 2,
    name: "Suite One",
    description: "",
    tasks: [makeEvalTask()],
    modelSlots: [],
    defaultJudge: { providerId: "openrouter", model: "openai/gpt-4o" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

function makeExperiment(
  overrides: Partial<ExperimentRecord> = {},
  snapshotTasks: EvaluationTask[] = [makeEvalTask({ prompt: "Older prompt." })],
  snapshotVersion = 1,
): ExperimentRecord {
  return {
    id: "exp-1",
    revision: 1,
    suiteId: "suite-1",
    suiteVersion: snapshotVersion,
    protocolFingerprint: "sha256:fp",
    status: "completed",
    execution: null,
    snapshot: {
      suiteId: "suite-1",
      suiteVersion: snapshotVersion,
      tasks: snapshotTasks,
      modelSlots: [],
      defaultJudge: { providerId: "openrouter", model: "openai/gpt-4o" },
      defaultEvaluation: { kind: "holistic" },
      profiles: [],
      protocolFingerprint: "sha256:fp",
      createdAt: NOW - 1_000,
    },
    tasks: [],
    createdAt: NOW - 1_000,
    updatedAt: NOW - 1_000,
    ...overrides,
  };
}

function executableDigest(task: EvaluationTask): string {
  return hashArtifactContent(
    canonicalJsonString({
      title: task.title,
      objective: task.prompt,
      candidateInstruction: task.systemPrompt,
      defaultContextManifest: [],
      responseContract: null,
      taskVerifierRef: task.verification ?? null,
      evaluation: task.evaluation,
    }),
  );
}

function taskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "legacy-task-suite-1-t1",
    latestVersion: 2,
    createdAt: NOW - 2_000,
    updatedAt: NOW,
    archivedAt: null,
    origin: "legacy-task-set",
    revision: 1,
    ...overrides,
  };
}

function taskVersion(overrides: Partial<TaskVersion> = {}): TaskVersion {
  return {
    taskId: "legacy-task-suite-1-t1",
    version: 1,
    title: "Summarize",
    objective: "Older prompt.",
    candidateInstruction: "Use three bullets.",
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "legacy-task-set", legacyScopeKey: "suite-1::t1", note: "legacy-definition:v1" },
    createdAt: NOW - 2_000,
    ...overrides,
  };
}

function instance(overrides: Partial<TaskInstance> = {}): TaskInstance {
  const base: TaskInstance = {
    id: "inst-1",
    taskId: "legacy-task-suite-1-t1",
    taskVersion: 1,
    normalizedInput: { text: "ordinary input", artifactIds: [], metadata: {} },
    contextManifest: [],
    inputDigest: "sha256:" + "0".repeat(64),
    inputCompleteness: "complete",
    createdAt: NOW,
    sourceRef: { kind: "legacy-task-set", legacyScopeKey: "suite-1::t1", originId: "exp-1" },
    ...overrides,
  };
  return { ...base, inputDigest: overrides.inputDigest ?? computeInstanceInputDigest(base) };
}

function crosswalk(
  suiteId: string,
  suiteVersion: number,
  legacyTaskId: string,
  task: EvaluationTask,
  taskId: string,
  taskVersion: number,
): TaskMigrationCrosswalk {
  return {
    legacyScopeKey: legacyTaskCrosswalkKey(
      suiteId,
      suiteVersion,
      legacyTaskId,
      executableDigest(task),
    ),
    taskId,
    taskVersion,
  };
}

function sources(overrides: Partial<TaskReferenceSources> = {}): TaskReferenceSources {
  const current = makeEvalTask();
  const historical = makeEvalTask({ prompt: "Older prompt." });
  const task = taskRecord();
  return {
    task,
    versions: [
      taskVersion(),
      taskVersion({
        version: 2,
        objective: current.prompt,
        createdAt: NOW,
        source: { kind: "legacy-task-set", legacyScopeKey: "suite-1::t1", note: "legacy-definition:v2" },
      }),
    ],
    crosswalks: [
      crosswalk("suite-1", 1, "t1", historical, task.id, 1),
      crosswalk("suite-1", 2, "t1", current, task.id, 2),
    ],
    suites: [makeSuite()],
    experiments: [makeExperiment()],
    instances: [],
    liveScanAvailable: true,
    ...overrides,
  };
}

describe("parseLegacyCrosswalkKey", () => {
  it("parses the suite/version/task/digest authority coordinate", () => {
    const digest = "sha256:" + "ab".repeat(32);
    const key = legacyTaskCrosswalkKey("suite-1", 4, "t1", digest);
    expect(parseLegacyCrosswalkKey(key)).toEqual({
      suiteId: "suite-1",
      suiteVersion: 4,
      taskId: "t1",
      definitionDigest: digest,
    });
  });

  it("returns null for a corrupt key instead of guessing a latest version", () => {
    expect(parseLegacyCrosswalkKey("not-a-crosswalk")).toBeNull();
  });
});

describe("abbreviateInputDigest", () => {
  it("returns the first eight hex characters and never the full digest", () => {
    const digest = "sha256:" + "abcdef0123456789".repeat(4);
    expect(abbreviateInputDigest(digest)).toBe("abcdef01");
    expect(abbreviateInputDigest(digest)).not.toContain("sha256:");
  });
});

describe("buildTaskReferenceReadModel — exact version selection", () => {
  it("binds a changed historical experiment to v1 and the current suite to v2, never latest as fallback", () => {
    const model = buildTaskReferenceReadModel(sources());

    expect(model.taskId).toBe("legacy-task-suite-1-t1");
    expect(model.currentSuites).toHaveLength(1);
    expect(model.currentSuites[0]).toMatchObject({
      suiteId: "suite-1",
      suiteVersion: 2,
      legacyTaskId: "t1",
      taskVersion: 2,
      state: "resolved",
    });
    expect(model.experiments).toHaveLength(1);
    expect(model.experiments[0]).toMatchObject({
      experimentId: "exp-1",
      suiteVersion: 1,
      taskVersion: 1,
      state: "resolved",
    });
    expect(model.currentSuites[0].taskVersion).not.toBe(model.task.latestVersion === 2 ? 1 : 2);
    expect(model.experiments[0].taskVersion).toBe(1);
    expect(model.experiments[0].taskVersion).not.toBe(model.task.latestVersion);
  });

  it("does not select latestVersion when the exact crosswalk is absent", () => {
    const model = buildTaskReferenceReadModel(
      sources({
        crosswalks: [
          crosswalk("suite-1", 1, "t1", makeEvalTask({ prompt: "Older prompt." }), "legacy-task-suite-1-t1", 1),
        ],
      }),
    );

    expect(model.currentSuites[0].state).toBe("unresolved");
    expect(model.currentSuites[0].taskVersion).toBeNull();
    expect(model.currentSuites[0].limitation).toMatch(/absent/i);
    expect(model.counts.absentOrCorruptCrosswalks).toBeGreaterThanOrEqual(1);
  });

  it("does not select latestVersion when the crosswalk is corrupt", () => {
    const current = makeEvalTask();
    const model = buildTaskReferenceReadModel(
      sources({
        crosswalks: [
          crosswalk("suite-1", 1, "t1", makeEvalTask({ prompt: "Older prompt." }), "legacy-task-suite-1-t1", 1),
          {
            legacyScopeKey: legacyTaskCrosswalkKey(
              "suite-1",
              2,
              "t1",
              executableDigest(current),
            ),
            taskId: "legacy-task-suite-1-t1",
            taskVersion: 999,
          },
        ],
      }),
    );

    expect(model.currentSuites[0].state).toBe("unresolved");
    expect(model.currentSuites[0].taskVersion).not.toBe(2);
    expect(model.currentSuites[0].limitation).toMatch(/corrupt/i);
    expect(model.counts.absentOrCorruptCrosswalks).toBeGreaterThanOrEqual(1);
  });
});

describe("buildTaskReferenceReadModel — namespacing and archive", () => {
  it("does not merge identical text across suite scopes", () => {
    const shared = makeEvalTask();
    const taskA = taskRecord({ id: "legacy-a" });
    const taskB = taskRecord({ id: "legacy-b" });
    const versionA = taskVersion({
      taskId: "legacy-a",
      version: 1,
      source: { kind: "legacy-task-set", legacyScopeKey: "suite-a::t1", note: null },
    });
    const versionB = taskVersion({
      taskId: "legacy-b",
      version: 1,
      source: { kind: "legacy-task-set", legacyScopeKey: "suite-b::t1", note: null },
    });
    const modelA = buildTaskReferenceReadModel({
      task: taskA,
      versions: [versionA],
      crosswalks: [crosswalk("suite-a", 1, "t1", shared, "legacy-a", 1)],
      suites: [
        makeSuite({ id: "suite-a", version: 1, name: "A", tasks: [shared] }),
        makeSuite({ id: "suite-b", version: 1, name: "B", tasks: [shared] }),
      ],
      experiments: [],
      instances: [],
      liveScanAvailable: true,
    });
    const modelB = buildTaskReferenceReadModel({
      task: taskB,
      versions: [versionB],
      crosswalks: [crosswalk("suite-b", 1, "t1", shared, "legacy-b", 1)],
      suites: [
        makeSuite({ id: "suite-a", version: 1, name: "A", tasks: [shared] }),
        makeSuite({ id: "suite-b", version: 1, name: "B", tasks: [shared] }),
      ],
      experiments: [],
      instances: [],
      liveScanAvailable: true,
    });

    expect(modelA.currentSuites.map((item) => item.suiteId)).toEqual(["suite-a"]);
    expect(modelB.currentSuites.map((item) => item.suiteId)).toEqual(["suite-b"]);
    expect(modelA.currentSuites[0].taskVersion).toBe(1);
    expect(modelB.currentSuites[0].taskVersion).toBe(1);
  });

  it("keeps references to exact versions of an archived Task", () => {
    const model = buildTaskReferenceReadModel(
      sources({
        task: taskRecord({ archivedAt: NOW + 50 }),
      }),
    );

    expect(model.currentSuites[0].state).toBe("resolved");
    expect(model.experiments[0].state).toBe("resolved");
    expect(model.counts.archivedReferencedVersions).toBeGreaterThanOrEqual(1);
  });
});

describe("buildTaskReferenceReadModel — unresolved definitions and instances", () => {
  it("keeps an incomplete current-suite definition unresolved without fabricating a version", () => {
    const broken = makeEvalTask({ id: "t1", evaluation: { kind: "profile" } as EvaluationTask["evaluation"] });
    const model = buildTaskReferenceReadModel(
      sources({
        suites: [makeSuite({ tasks: [broken] })],
        unresolvedInventoryKeys: ["suite-1::t1::v2"],
      }),
    );

    expect(model.unresolvedDefinitions.length).toBeGreaterThanOrEqual(1);
    expect(model.unresolvedDefinitions[0].taskVersion).toBeNull();
    expect(model.unresolvedDefinitions[0].state).toBe("unresolved");
    expect(model.unresolvedDefinitions[0].limitation).toMatch(/reconstruct/i);
    expect(model.counts.unresolvedDefinitions).toBeGreaterThanOrEqual(1);
  });

  it("groups instances by completeness and never upgrades metadata_only or incomplete", () => {
    const complete = instance({ id: "inst-complete", inputCompleteness: "complete" });
    const metadata = instance({
      id: "inst-meta",
      inputCompleteness: "metadata_only",
      normalizedInput: { text: "", artifactIds: ["missing-art"], metadata: { filename: "notes.txt" } },
    });
    const incomplete = instance({
      id: "inst-inc",
      inputCompleteness: "incomplete",
      normalizedInput: { text: "", artifactIds: [], metadata: {} },
    });
    const model = buildTaskReferenceReadModel(
      sources({ instances: [incomplete, complete, metadata] }),
    );

    expect(model.instances.map((row) => row.id)).toEqual([
      "inst-complete",
      "inst-inc",
      "inst-meta",
    ]);

    expect(model.instances).toHaveLength(3);
    expect(model.instances.find((row) => row.id === "inst-complete")?.state).toBe("resolved");
    expect(model.instances.find((row) => row.id === "inst-meta")?.state).toBe("metadata_only");
    expect(model.instances.find((row) => row.id === "inst-inc")?.state).toBe("incomplete");
    expect(model.counts.instancesComplete).toBe(1);
    expect(model.counts.instancesMetadataOnly).toBe(1);
    expect(model.counts.instancesIncomplete).toBe(1);
    expect(model.instances.every((row) => row.useCount === null)).toBe(true);
  });

  it("orders suite and experiment groups deterministically", () => {
    const task = makeEvalTask();
    const model = buildTaskReferenceReadModel(
      sources({
        suites: [
          makeSuite({ id: "suite-z", version: 1, name: "Z", tasks: [task] }),
          makeSuite({ id: "suite-a", version: 3, name: "A3", tasks: [task] }),
          makeSuite({ id: "suite-a", version: 1, name: "A1", tasks: [task] }),
        ],
        experiments: [
          makeExperiment({ id: "exp-b" }, [makeEvalTask({ prompt: "Older prompt." })], 1),
          makeExperiment({ id: "exp-a" }, [makeEvalTask({ prompt: "Older prompt." })], 1),
        ],
        versions: [
          taskVersion({
            source: { kind: "legacy-task-set", legacyScopeKey: "suite-a::t1", note: null },
          }),
          taskVersion({
            version: 2,
            source: { kind: "legacy-task-set", legacyScopeKey: "suite-z::t1", note: null },
          }),
        ],
        task: taskRecord({ latestVersion: 2 }),
        crosswalks: [
          crosswalk("suite-a", 1, "t1", task, "legacy-task-suite-1-t1", 1),
          crosswalk("suite-a", 3, "t1", task, "legacy-task-suite-1-t1", 1),
          crosswalk("suite-z", 1, "t1", task, "legacy-task-suite-1-t1", 2),
          crosswalk("suite-1", 1, "t1", makeEvalTask({ prompt: "Older prompt." }), "legacy-task-suite-1-t1", 1),
        ],
      }),
    );

    expect(model.currentSuites.map((item) => `${item.suiteId}:v${item.suiteVersion}`)).toEqual([
      "suite-a:v1",
      "suite-a:v3",
      "suite-z:v1",
    ]);
    expect(model.experiments.map((item) => item.experimentId)).toEqual(["exp-a", "exp-b"]);
  });
});

describe("buildTaskReferenceReadModel — origin honesty and secrets", () => {
  it("discloses namespaced legacy origin without implying cross-suite identity", () => {
    const model = buildTaskReferenceReadModel(sources());
    expect(model.origin).toBe("legacy-task-set");
    expect(model.originLimitation).toMatch(/namespaced/i);
    expect(model.originLimitation).not.toMatch(/same task/i);
  });

  it("discloses that a live suite/experiment scan was unavailable instead of fabricating zero history", () => {
    const model = buildTaskReferenceReadModel(
      sources({
        suites: [],
        experiments: [],
        liveScanAvailable: false,
      }),
    );
    expect(model.originLimitation).toMatch(/not scanned|unavailable/i);
    expect(model.counts.currentSuites).toBe(0);
  });

  it("never puts secret-shaped instance text or credential-like suite names in the read model", () => {
    const secretSuite = makeSuite({ name: SECRET_TEXT });
    const secretInstance = instance({
      id: "inst-secret",
      normalizedInput: { text: SECRET_TEXT, artifactIds: [], metadata: { note: SECRET_TEXT } },
    });
    const model = buildTaskReferenceReadModel(
      sources({
        suites: [secretSuite],
        instances: [secretInstance],
      }),
    );
    const serialized = JSON.stringify(model);
    expect(serialized).not.toContain(SECRET_TEXT);
    expect(serialized).not.toContain("sk-live");
    expect(model.instances[0]?.inputDigestAbbreviation).toBe(
      abbreviateInputDigest(secretInstance.inputDigest),
    );
    expect(model.currentSuites[0]?.suiteName).toBeNull();
  });

  it("does not invent Compare or Observation groups in this child", () => {
    const model = buildTaskReferenceReadModel(sources());
    const serialized = JSON.stringify(model);
    expect(serialized).not.toMatch(/"compare"/i);
    expect(serialized).not.toMatch(/"observation"/i);
    expect("compare" in model).toBe(false);
    expect("observations" in model).toBe(false);
  });
});

describe("summarizeTaskReferences", () => {
  it("returns deterministic catalog totals from the grouped read model", () => {
    const model = buildTaskReferenceReadModel(
      sources({
        instances: [
          instance({ id: "inst-a", inputCompleteness: "complete" }),
          instance({
            id: "inst-b",
            inputCompleteness: "metadata_only",
            normalizedInput: { text: "", artifactIds: ["x"], metadata: {} },
          }),
        ],
      }),
    );
    const summary = summarizeTaskReferences(model);
    expect(summary.total).toBe(model.counts.total);
    expect(summary.total).toBe(
      model.counts.currentSuites +
        model.counts.experiments +
        model.counts.instancesComplete +
        model.counts.instancesMetadataOnly +
        model.counts.instancesIncomplete +
        model.counts.unresolvedDefinitions,
    );
    expect(summary.unresolved).toBe(
      model.counts.unresolvedDefinitions + model.counts.absentOrCorruptCrosswalks,
    );
  });
});
