// =============================================================================
// RSemble AI — Study repository contract tests (spec §4, §5, §12)
//
// RED: specifies the generic Study lifecycle and immutable Policy Playbook
// persistence contract. Exercises both the Dexie-backed and in-memory
// implementations through a shared parity suite.
//
// Required behavior:
//  - study create / update-draft / start / seal / fail / archive / list / get;
//  - draft CAS revision; start seals the definition (no mutation after start);
//  - completed immutability (reportRef set, definition/trials/observations
//    frozen);
//  - Trial create / seal; treatment-changing Attempt linkage (atomic successor
//    trial + attempt, sampleIndex increment, from != to);
//  - terminal Observation append (sealed trial only, retry = new observation
//    on the same sealed trial, atomic observationIds update);
//  - Policy Playbook create / get immutable (idempotent on identical content,
//    no update/delete path);
//  - CAS conflict, duplicate event, multi-tab owner, interrupted transition,
//    missing refs, partial child append;
//  - repository cannot invoke providers;
//  - archive-only after any paid execution; no ordinary delete API for started
//    evidence; no unarchive API.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";

import { RSembleEvaluationDB } from "./database";
import {
  createStudyRepository,
  InMemoryStudyRepository,
  type StudyRepository,
} from "./study-repository";
import {
  POLICY_DEFINITION_SCHEMA_VERSION,
  POLICY_MEASUREMENT_SCHEMA_VERSION,
  POLICY_REPORT_SCHEMA_VERSION,
  POLICY_TRIAL_PAYLOAD_SCHEMA_VERSION,
  isPolicyStudyRecord,
  isPolicyStudyTrial,
  isPolicyStudyObservation,
  isPolicyReportPayload,
  policyStudyRegistration,
  type ExactModelConfigurationRef,
  type PolicyMeasurementPayload,
  type PolicyReportPayload,
  type PolicyStudyDefinition,
  type PolicyStudyRecord,
  type PolicyStudyTrial,
  type PolicyStudyObservation,
  type PolicyTrialPayload,
} from "../studies/policy/policy-study-types";
import { fingerprintStudyValue } from "../studies/study-fingerprint";
import type { StudyAttempt, TokenCost } from "../studies/study-types";

// --- Fixtures -----------------------------------------------------------------

const MC = "mc:sha256:" + "0".repeat(64);
const MC2 = "mc:sha256:" + "1".repeat(64);
const DIGEST = "sha256:" + "a".repeat(64);
const PROTOCOL_FP = "sha256:" + "b".repeat(64);
const PB_ID = "pb:sha256:" + "f".repeat(64);

function mcRef(id: string = MC): ExactModelConfigurationRef {
  return { id };
}

function makeDefinition(
  overrides: Partial<PolicyStudyDefinition> = {},
): PolicyStudyDefinition {
  return {
    workload: { taskSetId: "ts1", version: 6, manifestDigest: DIGEST },
    modelPool: { poolId: "p1", version: 3, digest: DIGEST },
    fusionRecipes: [{ recipeId: "r1", version: 1, digest: DIGEST }],
    judge1: mcRef(),
    judge2: mcRef(MC2),
    rubric: { rubricId: "rub1", version: 2 },
    protocolFingerprint: PROTOCOL_FP,
    policies: ["best_fixed", "rank", "fuse", "refine"],
    stageProtocolVersion: 1,
    claimPlan: "exploration",
    ...overrides,
  };
}

function makeConfirmationDefinition(
  overrides: Partial<PolicyStudyDefinition> = {},
): PolicyStudyDefinition {
  return makeDefinition({
    claimPlan: "confirmation",
    ...overrides,
  });
}

function makeTrialPayload(
  overrides: Partial<PolicyTrialPayload> = {},
): PolicyTrialPayload {
  return {
    policy: "fuse",
    stage: "B",
    candidateConfig: { members: [mcRef(), mcRef(MC2)] },
    recipeRef: { recipeId: "r1", version: 1, digest: DIGEST },
    synthesizer: mcRef(),
    ...overrides,
  };
}

function makeMeasurementPayload(
  overrides: Partial<PolicyMeasurementPayload> = {},
): PolicyMeasurementPayload {
  return {
    judge: mcRef(MC2),
    overallScore: 4.25,
    tokensIn: 300,
    tokensOut: 120,
    error: null,
    ...overrides,
  };
}

const ZERO_COST: TokenCost = { tokensIn: 0, tokensOut: 0 };

function makeStudyRecord(
  overrides: Partial<PolicyStudyRecord> = {},
): PolicyStudyRecord {
  const def = makeDefinition();
  return {
    id: "study-1",
    revision: 0,
    kind: "policy",
    title: "Pair screening on holdout",
    status: "draft",
    claimLevel: "exploratory",
    definitionSchemaVersion: POLICY_DEFINITION_SCHEMA_VERSION,
    definitionFingerprint: fingerprintStudyValue(def),
    definition: def,
    reportRef: null,
    confirmationOf: null,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
    ...overrides,
  };
}

function makeConfirmationStudyRecord(
  id: string,
  parentId: string,
  overrides: Partial<PolicyStudyRecord> = {},
): PolicyStudyRecord {
  const def = makeConfirmationDefinition();
  return makeStudyRecord({
    id,
    title: "Confirmation of " + parentId,
    claimLevel: "confirmed",
    confirmationOf: parentId,
    definition: def,
    definitionFingerprint: fingerprintStudyValue(def),
    ...overrides,
  });
}

function makeTrial(
  overrides: Partial<PolicyStudyTrial> = {},
): PolicyStudyTrial {
  const { payload: payloadOverride, ...rest } = overrides;
  const payload = payloadOverride ?? makeTrialPayload();
  return {
    id: "trial-1",
    studyId: "study-1",
    payloadKind: "policy",
    payloadSchemaVersion: POLICY_TRIAL_PAYLOAD_SCHEMA_VERSION,
    payloadFingerprint: fingerprintStudyValue(payload),
    payload,
    status: "in_progress",
    sampleIndex: 0,
    artifactRefs: [],
    observationIds: [],
    policyCost: ZERO_COST,
    experimentalCost: ZERO_COST,
    createdAt: 2000,
    sealedAt: null,
    ...rest,
  };
}

function makeStudyObservation(
  overrides: Partial<PolicyStudyObservation> = {},
): PolicyStudyObservation {
  const payload = makeMeasurementPayload();
  return {
    id: "obs-1",
    studyId: "study-1",
    trialId: "trial-1",
    payloadKind: "policy_measurement",
    payloadSchemaVersion: POLICY_MEASUREMENT_SCHEMA_VERSION,
    payload,
    status: "completed",
    sourceRunId: "run-1",
    createdAt: 3000,
    finishedAt: 3100,
    ...overrides,
  };
}

function makePlaybook(
  overrides: Partial<PolicyReportPayload> = {},
): PolicyReportPayload {
  return {
    studyId: "study-1",
    definitionFingerprint: fingerprintStudyValue(makeDefinition()),
    rows: [
      {
        policy: "fuse",
        configuration: "B + C -> Synth X",
        meanOutcome: 4.52,
        lift: 0.34,
        costMultiplier: 3.2,
        confidence: "medium",
      },
    ],
    recommendation: {
      kind: "do_not_fuse",
      rationale: "Rank matches Fuse within MPID at lower cost.",
    },
    poolAdequacy: { probed: true, outcome: "confirmed", note: "Challenger failed." },
    recipeSensitivity: { checked: true, note: "Stable across prompt variants." },
    claimLevel: "exploratory",
    conclusion: "Rank A+C when cost matters; do not use fusion for routine runs.",
    supportingTrialIds: ["trial-1"],
    supportingObservationIds: ["obs-1"],
    reportSchemaVersion: POLICY_REPORT_SCHEMA_VERSION,
    createdAt: 4000,
    ...overrides,
  };
}

// --- Shared parity suite ------------------------------------------------------

function repositorySuite(name: string, makeRepo: () => StudyRepository & object) {
  describe(name, () => {
    // --- create / get / list -------------------------------------------------

    it("creates a draft study and reads it back", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      const got = await repo.getStudy("study-1");
      expect(got).not.toBeNull();
      expect(isPolicyStudyRecord(got)).toBe(true);
      expect(got).toMatchObject({ id: "study-1", status: "draft", revision: 0 });
    });

    it("rejects creating a duplicate study (duplicate event)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await expect(repo.createStudy(makeStudyRecord())).rejects.toThrow(/already exists/);
    });

    it("rejects creating a study with an invalid record", async () => {
      const repo = makeRepo();
      const bad = { ...makeStudyRecord(), definitionFingerprint: "not-a-fingerprint" } as PolicyStudyRecord;
      await expect(repo.createStudy(bad)).rejects.toThrow(/invalid/i);
    });

    it("rejects creating a study with prohibited credential keys", async () => {
      const repo = makeRepo();
      const bad = { ...makeStudyRecord(), apiKey: "sk-xxx" } as unknown as PolicyStudyRecord;
      await expect(repo.createStudy(bad)).rejects.toThrow(/invalid/i);
    });

    it("lists studies (active only by default, archived included with flag)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord({ id: "s1" }));
      await repo.createStudy(makeStudyRecord({ id: "s2" }));
      const active = await repo.listStudies();
      expect(active.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
      const all = await repo.listStudies(true);
      expect(all.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    });

    it("getStudy returns null for unknown id", async () => {
      const repo = makeRepo();
      expect(await repo.getStudy("nope")).toBeNull();
    });

    // --- update draft (CAS) --------------------------------------------------

    it("updateDraftStudy bumps revision and updates title + definition fingerprint", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      const nextDef = makeDefinition({ policies: ["best_fixed", "rank"] });
      const newRev = await repo.updateDraftStudy(
        "study-1",
        0,
        { definition: nextDef, title: "Revised title" },
        1500,
      );
      expect(newRev).toBe(1);
      const got = (await repo.getStudy("study-1"))!;
      expect(got.revision).toBe(1);
      expect(got.title).toBe("Revised title");
      expect(got.definitionFingerprint).toBe(fingerprintStudyValue(nextDef));
      expect(got.definition).toEqual(nextDef);
      expect(got.updatedAt).toBe(1500);
    });

    it("updateDraftStudy rejects a stale revision (CAS conflict)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      const nextDef = makeDefinition({ policies: ["best_fixed"] });
      await repo.updateDraftStudy("study-1", 0, { definition: nextDef, title: "v2" }, 1500);
      // Second edit with the now-stale revision 0.
      await expect(
        repo.updateDraftStudy("study-1", 0, { definition: nextDef, title: "v3" }, 1600),
      ).rejects.toThrow(/Stale|revision/);
    });

    it("updateDraftStudy rejects editing a non-draft study (definition sealed after start)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      const nextDef = makeDefinition({ policies: ["best_fixed"] });
      await expect(
        repo.updateDraftStudy("study-1", 1, { definition: nextDef, title: "x" }, 2100),
      ).rejects.toThrow(/draft|not draft|sealed/i);
    });

    it("updateDraftStudy rejects an unknown study (missing ref)", async () => {
      const repo = makeRepo();
      await expect(
        repo.updateDraftStudy("nope", 0, { definition: makeDefinition(), title: "x" }, 100),
      ).rejects.toThrow(/not found|missing/);
    });

    // --- start (seal definition) --------------------------------------------

    it("startStudy transitions draft -> in_progress and bumps revision", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      const newRev = await repo.startStudy("study-1", 0, 2000);
      expect(newRev).toBe(1);
      const got = (await repo.getStudy("study-1"))!;
      expect(got.status).toBe("in_progress");
      expect(got.revision).toBe(1);
      expect(got.updatedAt).toBe(2000);
    });

    it("startStudy rejects a stale revision (multi-tab owner conflict)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      // A second tab that still holds revision 0 must lose the CAS race.
      await expect(repo.startStudy("study-1", 0, 2100)).rejects.toThrow(/Stale|revision/);
    });

    it("startStudy rejects a non-draft study", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await expect(repo.startStudy("study-1", 1, 2100)).rejects.toThrow(/draft|already/);
    });

    it("startStudy on an unknown study is a missing ref", async () => {
      const repo = makeRepo();
      await expect(repo.startStudy("nope", 0, 100)).rejects.toThrow(/not found|missing/);
    });

    // --- seal (complete) -----------------------------------------------------

    it("sealStudy transitions in_progress -> completed and sets reportRef", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      const newRev = await repo.sealStudy("study-1", 1, "pb:sha256:" + "f".repeat(64), 5000);
      expect(newRev).toBe(2);
      const got = (await repo.getStudy("study-1"))!;
      expect(got.status).toBe("completed");
      expect(got.reportRef).toBe("pb:sha256:" + "f".repeat(64));
    });

    it("sealStudy rejects a draft (must start first)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await expect(
        repo.sealStudy("study-1", 0, "pb:sha256:" + "f".repeat(64), 5000),
      ).rejects.toThrow(/in_progress|not started|draft/);
    });

    it("sealStudy rejects re-sealing a completed study (immutability)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.sealStudy("study-1", 1, "pb:sha256:" + "f".repeat(64), 5000);
      await expect(
        repo.sealStudy("study-1", 2, "pb:sha256:" + "e".repeat(64), 6000),
      ).rejects.toThrow(/completed|in_progress|already/);
    });

    it("sealStudy rejects a stale revision", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await expect(
        repo.sealStudy("study-1", 99, "pb:sha256:" + "f".repeat(64), 5000),
      ).rejects.toThrow(/Stale|revision/);
    });

    // --- fail ----------------------------------------------------------------

    it("failStudy transitions in_progress -> failed", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      const newRev = await repo.failStudy("study-1", 1, 5100);
      expect(newRev).toBe(2);
      const got = (await repo.getStudy("study-1"))!;
      expect(got.status).toBe("failed");
    });

    it("failStudy rejects a draft", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await expect(repo.failStudy("study-1", 0, 5100)).rejects.toThrow(/in_progress|draft/);
    });

    // --- archive / delete / no unarchive ------------------------------------

    it("archiveStudy archives started evidence (in_progress) and does not delete children", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      const newRev = await repo.archiveStudy("study-1", 1, 9000);
      expect(newRev).toBe(2);
      const got = (await repo.getStudy("study-1"))!;
      expect(got.status).toBe("archived");
      expect(got.archivedAt).toBe(9000);
    });

    it("archiveStudy rejects a draft (drafts are deletable, not archive-only)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await expect(repo.archiveStudy("study-1", 0, 9000)).rejects.toThrow(/draft|started|archive/);
    });

    it("archiveStudy rejects an already-archived study", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.archiveStudy("study-1", 1, 9000);
      await expect(repo.archiveStudy("study-1", 2, 9100)).rejects.toThrow(/archived/);
    });

    it("archiveStudy rejects a stale revision", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await expect(repo.archiveStudy("study-1", 99, 9000)).rejects.toThrow(/Stale|revision/);
    });

    it("archived studies are excluded from active list but included with includeArchived", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord({ id: "s1" }));
      await repo.startStudy("s1", 0, 2000);
      await repo.archiveStudy("s1", 1, 9000);
      const active = await repo.listStudies();
      expect(active).toHaveLength(0);
      const all = await repo.listStudies(true);
      expect(all.map((s) => s.id)).toEqual(["s1"]);
    });

    it("deleteStudy removes an untouched draft", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.deleteStudy("study-1", 0);
      expect(await repo.getStudy("study-1")).toBeNull();
    });

    it("deleteStudy rejects started evidence (archive-only after paid execution)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await expect(repo.deleteStudy("study-1", 1)).rejects.toThrow(/draft|started|archive/);
    });

    it("deleteStudy rejects a completed study", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.sealStudy("study-1", 1, "pb:sha256:" + "f".repeat(64), 5000);
      await expect(repo.deleteStudy("study-1", 2)).rejects.toThrow(/draft|started|archive/);
    });

    it("deleteStudy rejects a stale revision", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await expect(repo.deleteStudy("study-1", 99)).rejects.toThrow(/Stale|revision/);
    });

    it("exposes no unarchive method (no unarchive API)", async () => {
      const repo = makeRepo();
      expect((repo as unknown as Record<string, unknown>).unarchiveStudy).toBeUndefined();
      expect((repo as unknown as Record<string, unknown>).restoreStudy).toBeUndefined();
    });

    // --- trials --------------------------------------------------------------

    it("createTrial persists a trial against an in_progress study", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      const trial = makeTrial({ studyId: "study-1" });
      await repo.createTrial(trial);
      const got = await repo.getTrial("trial-1");
      expect(got).not.toBeNull();
      expect(isPolicyStudyTrial(got)).toBe(true);
      expect(got).toMatchObject({ id: "trial-1", studyId: "study-1", status: "in_progress" });
    });

    it("createTrial rejects a draft study (must start first)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await expect(repo.createTrial(makeTrial())).rejects.toThrow(/in_progress|started|draft/);
    });

    it("createTrial rejects an unknown study (missing ref)", async () => {
      const repo = makeRepo();
      await expect(repo.createTrial(makeTrial({ studyId: "nope" }))).rejects.toThrow(
        /not found|missing/,
      );
    });

    it("createTrial rejects a duplicate trial id (duplicate event)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial());
      await expect(repo.createTrial(makeTrial())).rejects.toThrow(/already exists/);
    });

    it("createTrial rejects an invalid trial (prohibited keys)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      const bad = { ...makeTrial(), apiKey: "sk-xxx" } as unknown as PolicyStudyTrial;
      await expect(repo.createTrial(bad)).rejects.toThrow(/invalid/i);
    });

    it("sealTrial transitions a trial in_progress -> sealed and sets sealedAt", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial());
      // Trials carry no revision field; CAS is on the trial row version. The
      // repository tracks an internal row revision; sealing bumps it.
      const newRev = await repo.sealTrial("trial-1", 0, 3500);
      expect(newRev).toBe(1);
      const got = (await repo.getTrial("trial-1"))!;
      expect(got.status).toBe("sealed");
      expect(got.sealedAt).toBe(3500);
    });

    it("sealTrial rejects an already-sealed trial", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial());
      await repo.sealTrial("trial-1", 0, 3500);
      await expect(repo.sealTrial("trial-1", 1, 3600)).rejects.toThrow(/sealed|already/);
    });

    it("sealTrial rejects a stale row revision", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial());
      await expect(repo.sealTrial("trial-1", 99, 3500)).rejects.toThrow(/Stale|revision/);
    });

    it("listTrials returns all trials for a study sorted by sampleIndex", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial({ id: "t0", sampleIndex: 0 }));
      await repo.createTrial(makeTrial({ id: "t1", sampleIndex: 1 }));
      const trials = await repo.listTrials("study-1");
      expect(trials.map((t) => t.id)).toEqual(["t0", "t1"]);
    });

    it("getTrial returns null for unknown id", async () => {
      const repo = makeRepo();
      expect(await repo.getTrial("nope")).toBeNull();
    });

    // --- attempts (treatment-changing retry) ---------------------------------

    it("createAttempt atomically links a sealed trial to a successor trial with incremented sampleIndex", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      const t1 = makeTrial({ id: "t1", sampleIndex: 0 });
      await repo.createTrial(t1);
      await repo.sealTrial("t1", 0, 3500);
      const t2 = makeTrial({
        id: "t2",
        sampleIndex: 1,
        payload: makeTrialPayload({ policy: "rank", recipeRef: null, synthesizer: null }),
        createdAt: 3600,
      });
      const attempt: StudyAttempt = {
        id: "att-1",
        studyId: "study-1",
        fromTrialId: "t1",
        toTrialId: "t2",
        reason: "treatment_changed_rank",
        createdAt: 3600,
      };
      await repo.createAttempt(attempt, t2);
      const got = await repo.getTrial("t2");
      expect(got).not.toBeNull();
      expect(got?.sampleIndex).toBe(1);
      const attempts = await repo.listAttempts("study-1");
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ fromTrialId: "t1", toTrialId: "t2" });
    });

    it("createAttempt rejects when fromTrial is not sealed (cannot replace an in-progress treatment)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial({ id: "t1" }));
      const t2 = makeTrial({ id: "t2", sampleIndex: 1, createdAt: 3600 });
      const attempt: StudyAttempt = {
        id: "att-1",
        studyId: "study-1",
        fromTrialId: "t1",
        toTrialId: "t2",
        reason: "x",
        createdAt: 3600,
      };
      await expect(repo.createAttempt(attempt, t2)).rejects.toThrow(/sealed|in.progress/);
      // Interrupted transition: no successor trial persisted on rejection.
      expect(await repo.getTrial("t2")).toBeNull();
    });

    it("createAttempt rejects a successor trial whose sampleIndex is not fromTrial.sampleIndex + 1", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial({ id: "t1", sampleIndex: 0 }));
      await repo.sealTrial("t1", 0, 3500);
      const t2 = makeTrial({ id: "t2", sampleIndex: 5, createdAt: 3600 });
      const attempt: StudyAttempt = {
        id: "att-1",
        studyId: "study-1",
        fromTrialId: "t1",
        toTrialId: "t2",
        reason: "x",
        createdAt: 3600,
      };
      await expect(repo.createAttempt(attempt, t2)).rejects.toThrow(/sampleIndex|contiguous/);
    });

    it("createAttempt rejects when from and to are the same trial", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial({ id: "t1" }));
      await repo.sealTrial("t1", 0, 3500);
      const attempt: StudyAttempt = {
        id: "att-1",
        studyId: "study-1",
        fromTrialId: "t1",
        toTrialId: "t1",
        reason: "x",
        createdAt: 3600,
      };
      await expect(repo.createAttempt(attempt, makeTrial({ id: "t1", sampleIndex: 1 }))).rejects.toThrow(
        /distinct|same|from.*to|invalid/i,
      );
    });

    it("createAttempt rejects an unknown fromTrial (missing ref)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      const t2 = makeTrial({ id: "t2", sampleIndex: 1, createdAt: 3600 });
      const attempt: StudyAttempt = {
        id: "att-1",
        studyId: "study-1",
        fromTrialId: "ghost",
        toTrialId: "t2",
        reason: "x",
        createdAt: 3600,
      };
      await expect(repo.createAttempt(attempt, t2)).rejects.toThrow(/not found|missing/);
    });

    it("createAttempt rejects a duplicate attempt id (duplicate event)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial({ id: "t1" }));
      await repo.sealTrial("t1", 0, 3500);
      const t2 = makeTrial({ id: "t2", sampleIndex: 1, createdAt: 3600 });
      const attempt: StudyAttempt = {
        id: "att-1",
        studyId: "study-1",
        fromTrialId: "t1",
        toTrialId: "t2",
        reason: "x",
        createdAt: 3600,
      };
      await repo.createAttempt(attempt, t2);
      await repo.sealTrial("t2", 0, 3650);
      const t3 = makeTrial({ id: "t3", sampleIndex: 2, createdAt: 3700 });
      const attempt2: StudyAttempt = {
        id: "att-1",
        studyId: "study-1",
        fromTrialId: "t2",
        toTrialId: "t3",
        reason: "x",
        createdAt: 3700,
      };
      await expect(repo.createAttempt(attempt2, t3)).rejects.toThrow(/already exists/);
    });

    // --- observations (terminal append) -------------------------------------

    it("appendObservation appends a terminal observation to a sealed trial and updates trial.observationIds atomically", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial({ id: "t1" }));
      await repo.sealTrial("t1", 0, 3500);
      const obs = makeStudyObservation({ id: "o1", trialId: "t1" });
      await repo.appendObservation(obs);
      const got = await repo.getTrial("t1");
      expect(got?.observationIds).toEqual(["o1"]);
      const list = await repo.listObservationsForTrial("t1");
      expect(list).toHaveLength(1);
      expect(isPolicyStudyObservation(list[0])).toBe(true);
    });

    it("appendObservation rejects an unsealed trial (measurements attach to sealed artifacts)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial({ id: "t1" }));
      const obs = makeStudyObservation({ id: "o1", trialId: "t1" });
      await expect(repo.appendObservation(obs)).rejects.toThrow(/sealed|in.progress/);
      // Interrupted transition: no observation persisted on rejection.
      expect(await repo.listObservationsForTrial("t1")).toHaveLength(0);
    });

    it("appendObservation rejects an unknown trial (missing ref)", async () => {
      const repo = makeRepo();
      const obs = makeStudyObservation({ id: "o1", trialId: "ghost" });
      await expect(repo.appendObservation(obs)).rejects.toThrow(/not found|missing/);
    });

    it("a measurement-only retry appends a new observation on the same sealed trial (no new trial)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial({ id: "t1" }));
      await repo.sealTrial("t1", 0, 3500);
      await repo.appendObservation(makeStudyObservation({ id: "o1", trialId: "t1", createdAt: 4000, finishedAt: 4100 }));
      await repo.appendObservation(
        makeStudyObservation({ id: "o2", trialId: "t1", createdAt: 4200, finishedAt: 4300 }),
      );
      const got = await repo.getTrial("t1");
      expect(got?.observationIds).toEqual(["o1", "o2"]);
      // Still exactly one trial.
      const trials = await repo.listTrials("study-1");
      expect(trials).toHaveLength(1);
    });

    it("appendObservation rejects a duplicate observation id (duplicate event)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial({ id: "t1" }));
      await repo.sealTrial("t1", 0, 3500);
      await repo.appendObservation(makeStudyObservation({ id: "o1", trialId: "t1" }));
      await expect(
        repo.appendObservation(makeStudyObservation({ id: "o1", trialId: "t1" })),
      ).rejects.toThrow(/already exists/);
    });

    it("appendObservation rejects an invalid observation (prohibited keys)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial({ id: "t1" }));
      await repo.sealTrial("t1", 0, 3500);
      const bad = { ...makeStudyObservation({ trialId: "t1" }), apiKey: "sk-xxx" } as unknown as PolicyStudyObservation;
      await expect(repo.appendObservation(bad)).rejects.toThrow(/invalid/i);
    });

    it("listObservations returns all observations for a study", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      await repo.startStudy("study-1", 0, 2000);
      await repo.createTrial(makeTrial({ id: "t1" }));
      await repo.sealTrial("t1", 0, 3500);
      await repo.appendObservation(makeStudyObservation({ id: "o1", trialId: "t1", createdAt: 4000, finishedAt: 4100 }));
      await repo.appendObservation(makeStudyObservation({ id: "o2", trialId: "t1", createdAt: 4200, finishedAt: 4300 }));
      const all = await repo.listObservations("study-1");
      expect(all.map((o) => o.id).sort()).toEqual(["o1", "o2"]);
    });

    // --- Policy Playbook (immutable) ----------------------------------------

    it("createPlaybook persists an immutable playbook and reads it back", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      const pb = makePlaybook();
      await repo.createPlaybook(PB_ID, pb);
      const got = await repo.getPlaybook(PB_ID);
      expect(got).not.toBeNull();
      expect(isPolicyReportPayload(got)).toBe(true);
    });

    it("createPlaybook is idempotent on byte-equivalent content", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      const pb = makePlaybook();
      await repo.createPlaybook(PB_ID, pb);
      // Re-create with identical content — no-op, no throw.
      await repo.createPlaybook(PB_ID, pb);
      const forStudy = await repo.getPlaybookForStudy("study-1");
      expect(forStudy).not.toBeNull();
      expect(forStudy?.id).toBe(PB_ID);
    });

    it("createPlaybook rejects a collision with different content (immutable)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      const pb = makePlaybook();
      await repo.createPlaybook(PB_ID, pb);
      const different = makePlaybook({ conclusion: "Different conclusion." });
      await expect(repo.createPlaybook(PB_ID, different)).rejects.toThrow(/collision|digest|immutable/);
    });

    it("createPlaybook rejects a playbook whose studyId does not reference an existing study (missing ref)", async () => {
      const repo = makeRepo();
      const pb = makePlaybook({ studyId: "ghost" });
      await expect(repo.createPlaybook(PB_ID, pb)).rejects.toThrow(/not found|missing|study/);
    });

    it("createPlaybook rejects a playbook whose definitionFingerprint does not match the study (provenance)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      const pb = makePlaybook({
        definitionFingerprint: "sha256:" + "e".repeat(64),
      });
      await expect(repo.createPlaybook(PB_ID, pb)).rejects.toThrow(/fingerprint|provenance|mismatch/);
    });

    it("createPlaybook rejects an invalid playbook (prohibited keys)", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord());
      const bad = { ...makePlaybook(), apiKey: "sk-xxx" } as unknown as PolicyReportPayload;
      await expect(repo.createPlaybook(PB_ID, bad)).rejects.toThrow(/invalid/i);
    });

    it("getPlaybook returns null for unknown id", async () => {
      const repo = makeRepo();
      expect(await repo.getPlaybook("nope")).toBeNull();
    });

    it("exposes no update/delete playbook path (immutable)", async () => {
      const repo = makeRepo();
      expect((repo as unknown as Record<string, unknown>).updatePlaybook).toBeUndefined();
      expect((repo as unknown as Record<string, unknown>).deletePlaybook).toBeUndefined();
    });

    // --- confirmation linkage ------------------------------------------------

    it("creates a confirmation study linked to its exploration parent", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudyRecord({ id: "exp-1" }));
      const confirmation = makeConfirmationStudyRecord("conf-1", "exp-1");
      await repo.createStudy(confirmation);
      const got = (await repo.getStudy("conf-1"))!;
      expect(got.claimLevel).toBe("confirmed");
      expect(got.confirmationOf).toBe("exp-1");
      expect(isPolicyStudyRecord(got)).toBe(true);
    });

    it("rejects a confirmation study whose parent does not exist (missing ref)", async () => {
      const repo = makeRepo();
      const confirmation = makeConfirmationStudyRecord("conf-1", "ghost");
      await expect(repo.createStudy(confirmation)).rejects.toThrow(/parent|missing|not found/);
    });

    // --- repository cannot invoke providers ---------------------------------

    it("exposes no provider/execute/call methods (repository cannot invoke providers)", async () => {
      const repo = makeRepo();
      const methodNames: string[] = [];
      let proto: object | null = repo;
      while (proto !== null && proto !== Object.prototype) {
        for (const k of Object.getOwnPropertyNames(proto)) {
          if (
            typeof (repo as Record<string, unknown>)[k] === "function" &&
            !methodNames.includes(k)
          ) {
            methodNames.push(k);
          }
        }
        proto = Object.getPrototypeOf(proto);
      }
      for (const name of methodNames) {
        expect(name).not.toMatch(/execute|invoke|callProvider|runProvider|providerCall/i);
      }
      // Sanity: the lifecycle methods we expect are present.
      expect(methodNames).toContain("createStudy");
      expect(methodNames).toContain("startStudy");
      expect(methodNames).toContain("sealStudy");
      expect(methodNames).toContain("appendObservation");
      expect(methodNames).toContain("createPlaybook");
    });
  });
}

// --- Run suites against both implementations ----------------------------------

repositorySuite("InMemoryStudyRepository", () => new InMemoryStudyRepository());

const dbs: RSembleEvaluationDB[] = [];
afterEach(async () => {
  while (dbs.length > 0) {
    const db = dbs.pop()!;
    db.close();
    await db.delete();
  }
});

repositorySuite("Dexie study repository", () => {
  const db = new RSembleEvaluationDB(`study-repo-test-${crypto.randomUUID()}`);
  dbs.push(db);
  return createStudyRepository(db);
});

// --- Registry-backed validation -----------------------------------------------

describe("study repository uses registered payload validation", () => {
  it("the policy registration fingerprint matches the test fixture", () => {
    const def = makeDefinition();
    expect(policyStudyRegistration.fingerprintDefinition(def)).toBe(
      fingerprintStudyValue(def),
    );
    expect(policyStudyRegistration.validateDefinition(def)).toBe(true);
  });
});
