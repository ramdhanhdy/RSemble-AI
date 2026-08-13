// =============================================================================
// RSemble AI — Legacy Task inventory tests (RED)
//
// Child 02 (Canonical Tasks) Milestone A — Task 4 (RED first).
//
// Covers spec §6 (conservative legacy migration inputs/reconstruction):
//   - deterministic inventory keyed by legacy (suiteId, taskId) scope
//   - one entry per distinct complete executable-definition digest
//   - latest suite definition included even when never executed (§6.2 #6)
//   - historical definitions sorted by explicit execution/suite chronology
//     with deterministic tie-breaks (§6.2 #3)
//   - verifier differences are part of the digest contract; evaluation and
//     judge instruction are execution protocol, not Task identity
//   - never auto-merged across different suite scopes (§6.2 #7)
//   - missing/corrupt definitions stay explicit; nothing is fabricated
//     into a complete Task (§6.4)
//
// Fixtures combine current suites and historical ExperimentRecord snapshots
// with changed/unchanged definitions, verifier differences, latest unexecuted
// edits, duplicate text across suites, and missing/corrupt definitions.
//
// Pure/read-only domain logic only: no Dexie writes, no source-record
// mutation, no provider calls.
// =============================================================================

import { describe, expect, it } from "vitest";

import type {
  EvaluationSuite,
  EvaluationTask,
  ExperimentRecord,
} from "../evaluations/evaluation-types";
import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import {
  buildLegacyTaskInventory,
  resolveLegacyDefinitionStatus,
  type LegacyTaskInventoryInput,
} from "./legacy-task-inventory";

// --- fixtures ---------------------------------------------------------------

function makeTask(overrides: Partial<EvaluationTask> = {}): EvaluationTask {
  return {
    id: "t1",
    title: "Summarize",
    prompt: "Summarize the passage.",
    systemPrompt: "",
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
    version: 1,
    name: "Suite One",
    description: "",
    tasks: [makeTask()],
    modelSlots: [],
    defaultJudge: { providerId: "openrouter", model: "openai/gpt-4o" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
    ...overrides,
  };
}

function makeExperiment(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  const suite = makeSuite();
  return {
    id: "exp-1",
    revision: 1,
    suiteId: suite.id,
    suiteVersion: suite.version,
    protocolFingerprint: "sha256:fp",
    status: "completed",
    execution: null,
    snapshot: {
      suiteId: suite.id,
      suiteVersion: suite.version,
      tasks: suite.tasks,
      modelSlots: suite.modelSlots,
      defaultJudge: suite.defaultJudge,
      defaultEvaluation: suite.defaultEvaluation,
      profiles: [],
      protocolFingerprint: "sha256:fp",
      createdAt: 1_000,
    },
    tasks: [],
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function input(
  suites: EvaluationSuite[],
  experiments: ExperimentRecord[],
): LegacyTaskInventoryInput {
  return { suites, experiments };
}

// --- expected helpers ---------------------------------------------------------

/** Reference digest for the canonical Task-version identity slice. */
function expectedDigest(task: EvaluationTask): string {
  return hashArtifactContent(canonicalJsonString({
    title: task.title,
    objective: task.prompt,
    candidateInstruction: task.systemPrompt,
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: task.verification ?? null,
  }));
}

// --- suite-level inventory ----------------------------------------------------

describe("buildLegacyTaskInventory — suite definitions", () => {
  it("produces a deterministic inventory entry for a single current suite task", () => {
    const result = buildLegacyTaskInventory(input([makeSuite()], []));

    expect(result.entries).toHaveLength(1);
    const [entry] = result.entries;
    expect(entry.scope).toEqual({ suiteId: "suite-1", taskId: "t1" });
    expect(entry.status).toBe("complete");
    expect(entry.executions).toBe(0);
    expect(entry.definitionDigest).toBe(expectedDigest(makeTask()));
    expect(entry.origin).toBe("legacy-task-set");
    // Latest unexecuted suite definition is still included per §6.2 #6.
    expect(entry.sources).toContain("current-suite");
    expect(entry.latestSuiteVersion).toBe(1);
  });

  it("never merges duplicate text across different suite scopes (§6.2 #7)", () => {
    const suiteA = makeSuite({ id: "suite-a", tasks: [makeTask({ id: "t1", prompt: "Same text" })] });
    const suiteB = makeSuite({ id: "suite-b", tasks: [makeTask({ id: "t2", prompt: "Same text" })] });
    const result = buildLegacyTaskInventory(input([suiteA, suiteB], []));

    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((e) => e.scope)).toEqual([
      { suiteId: "suite-a", taskId: "t1" },
      { suiteId: "suite-b", taskId: "t2" },
    ]);
    // Each scope gets its own entry even when the visible text is identical.
    expect(result.entries[0].definitionDigest).toBe(expectedDigest(makeTask({ prompt: "Same text" })));
    expect(result.entries[1].definitionDigest).toBe(expectedDigest(makeTask({ prompt: "Same text" })));
  });
});

// --- historical snapshots -----------------------------------------------------

describe("buildLegacyTaskInventory — experiment snapshots", () => {
  it("includes historical experiment snapshots when the definition changed", () => {
    const oldTask = makeTask({ prompt: "Old prompt.", systemPrompt: "Old sys." });
    const newTask = makeTask({ prompt: "New prompt.", systemPrompt: "Old sys." });
    const currentSuite = makeSuite({ version: 3, tasks: [newTask] });
    const experiment = makeExperiment({
      id: "exp-1",
      suiteId: currentSuite.id,
      suiteVersion: 2,
      snapshot: {
        ...makeExperiment().snapshot,
        suiteId: currentSuite.id,
        suiteVersion: 2,
        tasks: [oldTask],
      },
    });

    const result = buildLegacyTaskInventory(input([currentSuite], [experiment]));

    // Two distinct digests for one scope: old from snapshot, new from current suite.
    expect(result.entries).toHaveLength(2);
    const digests = result.entries.map((e) => e.definitionDigest);
    expect(digests).toContain(expectedDigest(oldTask));
    expect(digests).toContain(expectedDigest(newTask));

    // Older snapshot definition first, then the current edit (execution/suite chronology).
    const [older, newer] = result.entries;
    expect(older.chronology.executedAt).not.toBeNull();
    expect(newer.chronology.executedAt).toBeNull();
    expect(newer.chronology.suiteVersion).toBe(3);
  });

  it("does not duplicate an entry when snapshot and current suite definitions are identical", () => {
    const task = makeTask({ prompt: "Stable prompt." });
    const currentSuite = makeSuite({ version: 2, tasks: [task] });
    const experiment = makeExperiment({
      suiteId: currentSuite.id,
      suiteVersion: 2,
      snapshot: {
        ...makeExperiment().snapshot,
        suiteId: currentSuite.id,
        suiteVersion: 2,
        tasks: [task],
      },
    });

    const result = buildLegacyTaskInventory(input([currentSuite], [experiment]));

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].sources).toContain("current-suite");
    expect(result.entries[0].sources).toContain("experiment-snapshot");
    expect(result.entries[0].executions).toBe(1);
  });

  it("splits entries when verifier configuration changes even if prose is unchanged", () => {
    const noVerifier = makeTask({ prompt: "P" });
    const withVerifier = makeTask({
      prompt: "P",
      verification: { kind: "exact_match" },
    });

    const currentSuite = makeSuite({ version: 4, tasks: [withVerifier] });
    const experiment = makeExperiment({
      suiteId: currentSuite.id,
      suiteVersion: 3,
      snapshot: {
        ...makeExperiment().snapshot,
        suiteId: currentSuite.id,
        suiteVersion: 3,
        tasks: [noVerifier],
      },
    });

    const result = buildLegacyTaskInventory(input([currentSuite], [experiment]));

    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((e) => e.definitionDigest)).toEqual([
      expectedDigest(noVerifier),
      expectedDigest(withVerifier),
    ]);
  });

  it("does not split entries when evaluation selection changes but the Task definition is stable", () => {
    const inherit = makeTask({ prompt: "P", evaluation: { kind: "inherit" } });
    const holistic = makeTask({ prompt: "P", evaluation: { kind: "holistic" } });

    const currentSuite = makeSuite({ version: 5, tasks: [holistic] });
    const experiment = makeExperiment({
      suiteId: currentSuite.id,
      suiteVersion: 4,
      snapshot: {
        ...makeExperiment().snapshot,
        suiteId: currentSuite.id,
        suiteVersion: 4,
        tasks: [inherit],
      },
    });

    const result = buildLegacyTaskInventory(input([currentSuite], [experiment]));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].definitionDigest).toBe(expectedDigest(inherit));
  });

  it("does not split entries for judge-instruction-only protocol edits", () => {
    const historical = makeTask({ prompt: "P", judgeInstructionOverride: "Judge for brevity." });
    const current = makeTask({ prompt: "P", judgeInstructionOverride: "Judge for citations." });
    const suite = makeSuite({ version: 2, tasks: [current] });
    const experiment = makeExperiment({
      suiteId: suite.id,
      suiteVersion: 1,
      snapshot: { ...makeExperiment().snapshot, suiteId: suite.id, suiteVersion: 1, tasks: [historical] },
    });

    const result = buildLegacyTaskInventory(input([suite], [experiment]));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].definitionDigest).toBe(expectedDigest(current));
  });

  it("sorts multiple historical snapshots by explicit suite chronology with deterministic tie-breaks", () => {
    const tAtVersion = (version: number, marker: string) =>
      makeTask({ title: `v${version}`, prompt: marker });

    const currentSuite = makeSuite({
      id: "s-chron",
      version: 4,
      tasks: [tAtVersion(4, "latest edit")],
    });

    const experiments = [
      // Deliberately out-of-order input; inventory must still be deterministic.
      makeExperiment({
        id: "exp-c",
        suiteId: "s-chron",
        suiteVersion: 3,
        snapshot: {
          ...makeExperiment().snapshot,
          suiteId: "s-chron",
          suiteVersion: 3,
          tasks: [tAtVersion(3, "snapshot C")],
        },
        createdAt: 3_000,
      }),
      makeExperiment({
        id: "exp-a",
        suiteId: "s-chron",
        suiteVersion: 1,
        snapshot: {
          ...makeExperiment().snapshot,
          suiteId: "s-chron",
          suiteVersion: 1,
          tasks: [tAtVersion(1, "snapshot A")],
        },
        createdAt: 1_000,
      }),
      makeExperiment({
        id: "exp-b",
        suiteId: "s-chron",
        suiteVersion: 2,
        snapshot: {
          ...makeExperiment().snapshot,
          suiteId: "s-chron",
          suiteVersion: 2,
          tasks: [tAtVersion(2, "snapshot B")],
        },
        createdAt: 2_000,
      }),
    ];

    const result = buildLegacyTaskInventory(input([currentSuite], experiments));

    expect(result.entries).toHaveLength(4);
    expect(result.entries.map((e) => e.chronology.suiteVersion)).toEqual([1, 2, 3, 4]);
    expect(result.entries.map((e) => e.executions)).toEqual([1, 1, 1, 0]);
    // Deterministic key strings are stable and carry the scope + version.
    expect(result.entries.map((e) => e.key)).toEqual([
      "s-chron::t1::v1",
      "s-chron::t1::v2",
      "s-chron::t1::v3",
      "s-chron::t1::v4",
    ]);
  });
});

// --- missing / corrupt definitions ---------------------------------------------

describe("buildLegacyTaskInventory — explicit unresolved definitions", () => {
  it("marks snapshot tasks with missing prompt/title as incomplete and never fabricates a complete entry", () => {
    const corruptTask = {
      ...makeTask({ id: "t-corrupt" }),
      prompt: 42 as unknown as string,
    };
    const suite = makeSuite({ id: "s-missing", tasks: [] });
    const experiment = makeExperiment({
      id: "exp-corrupt",
      suiteId: suite.id,
      suiteVersion: 1,
      snapshot: {
        ...makeExperiment().snapshot,
        suiteId: suite.id,
        suiteVersion: 1,
        tasks: [corruptTask],
      },
    });

    const result = buildLegacyTaskInventory(input([suite], [experiment]));

    expect(result.entries).toHaveLength(1);
    const [entry] = result.entries;
    expect(entry.scope).toEqual({ suiteId: "s-missing", taskId: "t-corrupt" });
    expect(entry.status).toBe("incomplete");
    expect(entry.definitionDigest).toBeNull();
    expect(entry.sources).toEqual(["experiment-snapshot"]);
  });

  it("marks snapshot tasks with corrupt verifier configuration as incomplete", () => {
    const corruptVerifierTask = {
      ...makeTask({ id: "t-bad-verifier" }),
      verification: { kind: "not-a-real-kind" } as unknown as EvaluationTask["verification"],
    };
    const suite = makeSuite({ id: "s-verifier", tasks: [] });
    const experiment = makeExperiment({
      id: "exp-bad-verifier",
      suiteId: suite.id,
      suiteVersion: 1,
      snapshot: {
        ...makeExperiment().snapshot,
        suiteId: suite.id,
        suiteVersion: 1,
        tasks: [corruptVerifierTask],
      },
    });

    const result = buildLegacyTaskInventory(input([suite], [experiment]));

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].status).toBe("incomplete");
    expect(result.entries[0].definitionDigest).toBeNull();
  });

  it.each([
    { kind: "profile" },
    { kind: "profile", profile: {} },
    { kind: "profile", profile: { id: "", version: 1 } },
    { kind: "profile", profile: { id: "rubric-1", version: Number.NaN } },
  ])("marks corrupt profile evaluation %o as incomplete", (evaluation) => {
    const corruptProfileTask = { ...makeTask({ id: "t-bad-profile" }), evaluation };
    expect(resolveLegacyDefinitionStatus(corruptProfileTask)).toBe("incomplete");
  });

  it("marks missing snapshot task references as explicit failed entries when the current suite no longer has the task", () => {
    const presentTask = makeTask({ id: "t-retained", prompt: "Still here." });
    const missingTaskId = "t-deleted";
    const currentSuite = makeSuite({ id: "s-deleted", tasks: [presentTask] });
    const experiment = makeExperiment({
      id: "exp-deleted",
      suiteId: currentSuite.id,
      suiteVersion: 1,
      snapshot: {
        ...makeExperiment().snapshot,
        suiteId: currentSuite.id,
        suiteVersion: 1,
        tasks: [
          { ...presentTask, id: missingTaskId },
        ],
      },
    });

    const result = buildLegacyTaskInventory(input([currentSuite], [experiment]));

    // Current suite contributes its own entry; the deleted snapshot task stays
    // explicit as an orphaned historical definition.
    const orphaned = result.entries.find((e) => e.scope.taskId === missingTaskId);
    expect(orphaned).toBeDefined();
    expect(orphaned!.family).toBe("orphaned-snapshot");
    expect(orphaned!.sources).toEqual(["experiment-snapshot"]);
    expect(orphaned!.presentInCurrentSuite).toBe(false);

    const retained = result.entries.find((e) => e.scope.taskId === "t-retained");
    expect(retained).toBeDefined();
    expect(retained!.family).toBe("current");
    expect(retained!.presentInCurrentSuite).toBe(true);
  });
});

// --- determinism ---------------------------------------------------------------

describe("buildLegacyTaskInventory — determinism", () => {
  it("produces byte-identical key ordering regardless of input array order", () => {
    const suiteA = makeSuite({ id: "suite-a", tasks: [makeTask({ id: "t1", prompt: "A" })] });
    const suiteB = makeSuite({ id: "suite-b", tasks: [makeTask({ id: "t1", prompt: "B" })] });
    const suiteC = makeSuite({ id: "suite-c", tasks: [makeTask({ id: "t2", prompt: "C" })] });

    const run1 = buildLegacyTaskInventory(input([suiteA, suiteB, suiteC], []));
    const run2 = buildLegacyTaskInventory(input([suiteC, suiteA, suiteB], []));
    const run3 = buildLegacyTaskInventory(input([suiteB, suiteC, suiteA], []));

    expect(run1.entries.map((e) => e.key)).toEqual(run2.entries.map((e) => e.key));
    expect(run1.entries.map((e) => e.key)).toEqual(run3.entries.map((e) => e.key));
  });

  it("recomputes digests deterministically on repeated invocations", () => {
    const suite = makeSuite();
    const run1 = buildLegacyTaskInventory(input([suite], []));
    const run2 = buildLegacyTaskInventory(input([suite], []));
    expect(run1.entries[0].definitionDigest).toBe(run2.entries[0].definitionDigest);
    expect(run1.entries).toEqual(run2.entries);
  });
});

// --- status resolution unit tests -----------------------------------------------

describe("resolveLegacyDefinitionStatus", () => {
  it("returns complete for a valid definition with no missing fields", () => {
    expect(resolveLegacyDefinitionStatus(makeTask())).toBe("complete");
  });

  it("returns incomplete when prompt is missing", () => {
    expect(resolveLegacyDefinitionStatus({ ...makeTask(), prompt: "" } as EvaluationTask)).toBe(
      "incomplete",
    );
  });

  it("returns incomplete when verification is not a valid VerificationKind", () => {
    const task = makeTask({ verification: { kind: "bad" } as unknown as EvaluationTask["verification"] });
    expect(resolveLegacyDefinitionStatus(task)).toBe("incomplete");
  });
});
