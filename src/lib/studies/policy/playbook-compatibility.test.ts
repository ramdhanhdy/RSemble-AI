// =============================================================================
// RED — playbook compatibility evaluation (spec §8, plan Task 10).
//
// A Policy Playbook applies to Compare only through explicit user opt-in. The
// compatibility evaluator is the pure gate:
//   - exact playbook version identity (no latest/follow semantics);
//   - provenance: playbook ↔ study definition fingerprint round trip;
//   - workload: pinned Task Set Version context or a canonical Task binding
//     that is an exact member of the pinned workload;
//   - model pool: every candidate model configuration must be an exact member
//     of the pinned Model Pool Version.
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  evaluatePlaybookCompatibility,
  modelConfigRefForIdentity,
  type PinnedTaskSetVersionView,
  type PlaybookCompatibilityInput,
} from "./playbook-compatibility";
import { POLICY_REPORT_SCHEMA_VERSION } from "./policy-study-types";
import {
  makeDefinition,
  makePlaybook,
  makePoolVersion,
  makeStudyRecord,
} from "../../../workspaces/lab/lab-test-fixtures";
import { exactModelConfigRefFor } from "../../../workspaces/lab/lab-draft";
import type { ModelSlot } from "../../../studio-data";
import type { ModelPoolVersion } from "../model-pool-types";

const CAND_A = modelConfigRefForIdentity("openrouter", "m-a");
const CAND_B = modelConfigRefForIdentity("umans", "m-b");
const CAND_OUTSIDE = modelConfigRefForIdentity("gemini", "m-z");

function slotFor(providerId: "openrouter" | "umans" | "gemini", model: string, id: string): ModelSlot {
  return { id, providerId, provider: "Test", model, slug: model, enabled: true };
}

const POOL_CORE = [slotFor("openrouter", "m-a", "s1"), slotFor("umans", "m-b", "s2")];

function poolVersion(core: ModelSlot[] = POOL_CORE): ModelPoolVersion {
  return makePoolVersion("pool-1", 4, { core, challengers: [] });
}

const WORKLOAD_VIEW: PinnedTaskSetVersionView = {
  taskSetId: "ts1",
  version: 6,
  members: [{ taskVersionRef: { taskId: "task-1", taskVersion: 3 } }],
};

interface WorldOverrides {
  poolCore?: ModelSlot[];
  workload?: { taskSetId: string; version: number; manifestDigest: string };
}

function world(overrides: WorldOverrides = {}) {
  const pool = poolVersion(overrides.poolCore ?? POOL_CORE);
  const definition = makeDefinition({
    modelPool: { poolId: pool.poolId, version: pool.version, digest: pool.digest },
    ...(overrides.workload ? { workload: overrides.workload } : {}),
  });
  const study = makeStudyRecord({
    id: "study-1",
    status: "completed",
    reportRef: "pb-1",
    definition,
  });
  const playbook = makePlaybook({
    studyId: study.id,
    definitionFingerprint: study.definitionFingerprint,
  });
  return { pool, definition, study, playbook };
}

function baseInput(overrides: Partial<PlaybookCompatibilityInput> = {}): PlaybookCompatibilityInput {
  const w = world();
  return {
    playbookId: "pb-1",
    playbook: w.playbook,
    study: w.study,
    pinnedTaskSetVersion: WORKLOAD_VIEW,
    poolVersion: w.pool,
    candidateConfigurations: [CAND_A, CAND_B],
    taskBinding: null,
    taskSetContext: { taskSetId: "ts1", version: 6 },
    ...overrides,
  };
}

describe("playbook identity and provenance", () => {
  it("accepts an exact playbook version against its sealed study", () => {
    const decision = evaluatePlaybookCompatibility(baseInput());
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.receipt.playbookId).toBe("pb-1");
    expect(decision.receipt.studyId).toBe("study-1");
    expect(decision.receipt.matchedCandidateIds).toEqual([CAND_A.id, CAND_B.id].sort());
  });

  it("rejects a blank playbook id — no latest/follow semantics ever", () => {
    const decision = evaluatePlaybookCompatibility(baseInput({ playbookId: "" }));
    expect(decision).toMatchObject({ ok: false, code: "playbook_id_required" });
  });

  it("rejects a playbook whose studyId does not match the fetched study", () => {
    const input = baseInput();
    const decision = evaluatePlaybookCompatibility({
      ...input,
      playbook: { ...input.playbook, studyId: "study-other" },
    });
    expect(decision).toMatchObject({ ok: false, code: "playbook_study_mismatch" });
  });

  it("rejects a definition fingerprint mismatch between playbook and study", () => {
    const input = baseInput();
    const decision = evaluatePlaybookCompatibility({
      ...input,
      playbook: {
        ...input.playbook,
        definitionFingerprint: `sha256:${"f".repeat(64)}`,
      },
    });
    expect(decision).toMatchObject({ ok: false, code: "definition_fingerprint_mismatch" });
  });

  it("rejects playbooks of studies that never completed", () => {
    for (const status of ["draft", "in_progress", "failed"] as const) {
      const w = world();
      const study = { ...w.study, status } as typeof w.study;
      const decision = evaluatePlaybookCompatibility(
        baseInput({ study, playbook: { ...w.playbook, studyId: study.id } }),
      );
      expect(decision).toMatchObject({ ok: false, code: "study_not_sealed" });
    }
  });

  it("still resolves playbooks of archived studies (refs remain resolvable)", () => {
    const w = world();
    const study = { ...w.study, status: "archived" as const, archivedAt: 9_000 };
    const decision = evaluatePlaybookCompatibility(baseInput({ study }));
    expect(decision.ok).toBe(true);
  });

  it("rejects a playbook with a foreign report schema version", () => {
    const input = baseInput();
    const decision = evaluatePlaybookCompatibility({
      ...input,
      playbook: { ...input.playbook, reportSchemaVersion: POLICY_REPORT_SCHEMA_VERSION + 1 },
    });
    expect(decision).toMatchObject({ ok: false, code: "report_schema_mismatch" });
  });
});

describe("workload compatibility — pinned Task Set Version or exact Task member", () => {
  it("accepts an explicit Task Set context equal to the pinned workload", () => {
    const decision = evaluatePlaybookCompatibility(
      baseInput({ taskBinding: null, taskSetContext: { taskSetId: "ts1", version: 6 } }),
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.receipt.workloadBasis).toBe("task_set_context");
    expect(decision.receipt.workload).toEqual({ taskSetId: "ts1", version: 6 });
  });

  it("accepts a canonical Task binding that is an exact member of the pinned workload", () => {
    const decision = evaluatePlaybookCompatibility(
      baseInput({
        taskBinding: { kind: "canonical", taskId: "task-1", taskVersion: 3 },
        taskSetContext: null,
      }),
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.receipt.workloadBasis).toBe("pinned_workload_member");
  });

  it("rejects a canonical Task binding that is not a member of the pinned workload", () => {
    const decision = evaluatePlaybookCompatibility(
      baseInput({
        taskBinding: { kind: "canonical", taskId: "task-9", taskVersion: 1 },
        taskSetContext: null,
      }),
    );
    expect(decision).toMatchObject({ ok: false, code: "task_not_in_pinned_workload" });
  });

  it("rejects a Task Set context that differs from the pinned workload", () => {
    const decision = evaluatePlaybookCompatibility(
      baseInput({ taskSetContext: { taskSetId: "ts1", version: 7 } }),
    );
    expect(decision).toMatchObject({ ok: false, code: "workload_context_mismatch" });
  });

  it("requires an explicit workload decision for ad-hoc comparisons", () => {
    const decision = evaluatePlaybookCompatibility(
      baseInput({
        taskBinding: { kind: "ad_hoc", inputSnapshotRef: `snap:sha256:${"a".repeat(64)}` },
        taskSetContext: null,
      }),
    );
    expect(decision).toMatchObject({ ok: false, code: "workload_decision_required" });
  });

  it("rejects when the pinned Task Set Version cannot be resolved", () => {
    const decision = evaluatePlaybookCompatibility(baseInput({ pinnedTaskSetVersion: null }));
    expect(decision).toMatchObject({ ok: false, code: "workload_unresolved" });
  });

  it("rejects a resolved Task Set Version that is not the pinned workload", () => {
    const decision = evaluatePlaybookCompatibility(
      baseInput({
        pinnedTaskSetVersion: { ...WORKLOAD_VIEW, version: 5 },
      }),
    );
    expect(decision).toMatchObject({ ok: false, code: "workload_unresolved" });
  });
});

describe("model pool compatibility — candidates must be pool members", () => {
  it("accepts candidates that are exact members of the pinned pool", () => {
    const decision = evaluatePlaybookCompatibility(baseInput());
    expect(decision.ok).toBe(true);
  });

  it("rejects a candidate configuration that is not in the pinned pool", () => {
    const decision = evaluatePlaybookCompatibility(
      baseInput({ candidateConfigurations: [CAND_A, CAND_OUTSIDE] }),
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.code).toBe("candidate_not_in_pool");
    expect(decision.reason).toContain(CAND_OUTSIDE.id);
  });

  it("rejects an empty candidate roster", () => {
    const decision = evaluatePlaybookCompatibility(baseInput({ candidateConfigurations: [] }));
    expect(decision).toMatchObject({ ok: false, code: "candidates_required" });
  });

  it("rejects when the pinned pool version cannot be resolved", () => {
    const decision = evaluatePlaybookCompatibility(baseInput({ poolVersion: null }));
    expect(decision).toMatchObject({ ok: false, code: "pool_unresolved" });
  });

  it("rejects a resolved pool version that is not the pinned one", () => {
    const input = baseInput();
    const foreign = makePoolVersion("pool-1", 5, { core: POOL_CORE, challengers: [] });
    const decision = evaluatePlaybookCompatibility({ ...input, poolVersion: foreign });
    expect(decision).toMatchObject({ ok: false, code: "pool_unresolved" });
  });
});

describe("identity hashing parity", () => {
  it("modelConfigRefForIdentity matches the Lab draft's exact mc ref hashing", () => {
    expect(modelConfigRefForIdentity("openrouter", "m-a")).toEqual(
      exactModelConfigRefFor({ providerId: "openrouter", model: "m-a" }),
    );
    expect(modelConfigRefForIdentity("umans", "m-b")).toEqual(
      exactModelConfigRefFor({ providerId: "umans", model: "m-b" }),
    );
  });
});
