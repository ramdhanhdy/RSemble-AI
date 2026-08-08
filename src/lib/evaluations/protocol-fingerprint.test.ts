// =============================================================================
// protocol-fingerprint.test.ts — suite/snapshot fingerprint parity + roster
// rotation sensitivity (plan 001, B3).
// =============================================================================

import { describe, expect, it } from "vitest";
import type { EvaluationProfile, EvaluationSuite, ExperimentSnapshot } from "./evaluation-types";
import {
  buildFingerprintInput,
  computeProtocolFingerprint,
  computeSnapshotProtocolFingerprint,
  createExperimentSnapshot,
} from "./protocol-fingerprint";
import type { ModelSlot } from "../../studio-data";

const SLOTS: ModelSlot[] = [
  {
    id: "s1",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "m1",
    slug: "org/m1",
    enabled: true,
  },
  { id: "s2", providerId: "gemini", provider: "Gemini", model: "m2", slug: "m2", enabled: true },
];

function makeSuite(overrides: Partial<EvaluationSuite> = {}): EvaluationSuite {
  return {
    id: "suite-1",
    revision: 1,
    version: 1,
    name: "Suite",
    description: "",
    tasks: [
      {
        id: "t1",
        title: "Task 1",
        prompt: "prompt",
        systemPrompt: "sys",
        evaluation: { kind: "inherit" },
        judgeInstructionOverride: "",
        order: 0,
      },
    ],
    modelSlots: SLOTS.map((s) => ({ ...s })),
    defaultJudge: { providerId: "openrouter", model: "org/judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
    ...overrides,
  };
}

const PROFILES: EvaluationProfile[] = [];

describe("computeSnapshotProtocolFingerprint", () => {
  it("matches the suite-based fingerprint for identical semantic content", () => {
    const suite = makeSuite();
    const snapshot = createExperimentSnapshot(suite, PROFILES, 1000);
    expect(computeSnapshotProtocolFingerprint(snapshot)).toBe(
      computeProtocolFingerprint(suite, PROFILES),
    );
  });

  it("produces the canonical sha256 shape", () => {
    const snapshot = createExperimentSnapshot(makeSuite(), PROFILES, 1000);
    expect(computeSnapshotProtocolFingerprint(snapshot)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when a roster slot is appended", () => {
    const snapshot = createExperimentSnapshot(makeSuite(), PROFILES, 1000);
    const rotated: ExperimentSnapshot = {
      ...snapshot,
      modelSlots: [
        ...snapshot.modelSlots,
        {
          id: "s3",
          providerId: "deepseek",
          provider: "DeepSeek",
          model: "m3",
          slug: "m3",
          enabled: true,
        },
      ],
    };
    expect(computeSnapshotProtocolFingerprint(rotated)).not.toBe(
      computeSnapshotProtocolFingerprint(snapshot),
    );
  });

  it("changes when providerId, model, or enabled change", () => {
    const base = createExperimentSnapshot(makeSuite(), PROFILES, 1000);
    const baseFp = computeSnapshotProtocolFingerprint(base);

    const flipEnabled: ExperimentSnapshot = {
      ...base,
      modelSlots: base.modelSlots.map((s, i) => (i === 0 ? { ...s, enabled: false } : s)),
    };
    expect(computeSnapshotProtocolFingerprint(flipEnabled)).not.toBe(baseFp);

    const changeModel: ExperimentSnapshot = {
      ...base,
      modelSlots: base.modelSlots.map((s, i) => (i === 0 ? { ...s, model: "renamed" } : s)),
    };
    expect(computeSnapshotProtocolFingerprint(changeModel)).not.toBe(baseFp);

    const changeProvider: ExperimentSnapshot = {
      ...base,
      modelSlots: base.modelSlots.map((s, i) =>
        i === 0 ? { ...s, providerId: "umans" as const, slug: `umans/${s.slug}` } : s,
      ),
    };
    expect(computeSnapshotProtocolFingerprint(changeProvider)).not.toBe(baseFp);
  });

  it("changes when candidate or Judge reasoning effort changes", () => {
    const base = createExperimentSnapshot(makeSuite(), PROFILES, 1000);
    const changed: ExperimentSnapshot = {
      ...base,
      reasoningPolicy: { candidates: "low", judge: "high" },
    };
    expect(computeSnapshotProtocolFingerprint(changed)).not.toBe(
      computeSnapshotProtocolFingerprint(base),
    );
  });

  it("ignores slot id and display provider (non-semantic fields)", () => {
    const base = createExperimentSnapshot(makeSuite(), PROFILES, 1000);
    const baseFp = computeSnapshotProtocolFingerprint(base);
    const cosmetic: ExperimentSnapshot = {
      ...base,
      modelSlots: base.modelSlots.map((s) => ({
        ...s,
        id: `cosmetic-${s.id}`,
        provider: `Display ${s.provider}`,
      })),
    };
    expect(computeSnapshotProtocolFingerprint(cosmetic)).toBe(baseFp);
  });

  it("buildFingerprintInput keeps semantic fields only", () => {
    const input = buildFingerprintInput(makeSuite(), PROFILES) as Record<string, unknown>;
    const firstSlot = (input.modelSlots as Array<Record<string, unknown>>)[0];
    expect(firstSlot.id).toBeUndefined();
    expect(firstSlot.provider).toBeUndefined();
    expect(firstSlot.providerId).toBe("openrouter");
    expect(firstSlot.slug).toBe("org/m1");
  });
});

// --- Hybrid fingerprint mutation tests ----------------------------------------

function makeGradedProfile(): EvaluationProfile {
  return {
    id: "p1",
    version: 1,
    name: "Hybrid Profile",
    description: "test",
    judgeInstruction: "",
    criteria: [
      {
        id: "c1",
        kind: "graded",
        name: "Correctness",
        description: "d",
        weight: 2,
        anchors: {
          one: "1",
          two: "2",
          three: "3",
          four: "4",
          five: "5",
        },
      },
      {
        id: "b1",
        kind: "binary",
        name: "Uses ITT",
        description: "d",
        trueWhen: "true condition",
        falseWhen: "false condition",
      },
    ],
    requirementGroups: [{ id: "g1", name: "Group 1", checkIds: ["b1"], weight: 1, mode: "ALL" }],
    complianceInfluence: 1.0,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

describe("hybrid fingerprint mutations", () => {
  it("changes when complianceInfluence changes", () => {
    const suite = makeSuite({
      defaultEvaluation: { kind: "profile", profile: { id: "p1", version: 1 } },
    });
    const fp1 = computeProtocolFingerprint(suite, [makeGradedProfile()]);
    const fp2 = computeProtocolFingerprint(suite, [
      { ...makeGradedProfile(), complianceInfluence: 0.5 },
    ]);
    expect(fp1).not.toBe(fp2);
  });

  it("changes when requirement group weight changes", () => {
    const suite = makeSuite({
      defaultEvaluation: { kind: "profile", profile: { id: "p1", version: 1 } },
    });
    const fp1 = computeProtocolFingerprint(suite, [makeGradedProfile()]);
    const profile2 = {
      ...makeGradedProfile(),
      requirementGroups: [
        { id: "g1", name: "Group 1", checkIds: ["b1"], weight: 2, mode: "ALL" as const },
      ],
    };
    const fp2 = computeProtocolFingerprint(suite, [profile2]);
    expect(fp1).not.toBe(fp2);
  });

  it("changes when group membership changes", () => {
    const suite = makeSuite({
      defaultEvaluation: { kind: "profile", profile: { id: "p1", version: 1 } },
    });
    const fp1 = computeProtocolFingerprint(suite, [makeGradedProfile()]);
    const profile2 = {
      ...makeGradedProfile(),
      criteria: [
        ...makeGradedProfile().criteria,
        {
          id: "b2",
          kind: "binary" as const,
          name: "Rejects injection",
          description: "d",
          trueWhen: "t",
          falseWhen: "f",
        },
      ],
      requirementGroups: [
        { id: "g1", name: "Group 1", checkIds: ["b1", "b2"], weight: 1, mode: "ALL" as const },
      ],
    };
    const fp2 = computeProtocolFingerprint(suite, [profile2]);
    expect(fp1).not.toBe(fp2);
  });

  it("changes when Score 2 anchor changes", () => {
    const suite = makeSuite({
      defaultEvaluation: { kind: "profile", profile: { id: "p1", version: 1 } },
    });
    const fp1 = computeProtocolFingerprint(suite, [makeGradedProfile()]);
    const profile2 = {
      ...makeGradedProfile(),
      criteria: [
        {
          ...makeGradedProfile().criteria[0],
          anchors: { one: "1", two: "CHANGED", three: "3", four: "4", five: "5" },
        },
        makeGradedProfile().criteria[1],
      ],
    };
    const fp2 = computeProtocolFingerprint(suite, [profile2]);
    expect(fp1).not.toBe(fp2);
  });

  it("changes when binary trueWhen changes", () => {
    const suite = makeSuite({
      defaultEvaluation: { kind: "profile", profile: { id: "p1", version: 1 } },
    });
    const fp1 = computeProtocolFingerprint(suite, [makeGradedProfile()]);
    const profile2 = {
      ...makeGradedProfile(),
      criteria: [
        makeGradedProfile().criteria[0],
        { ...makeGradedProfile().criteria[1], trueWhen: "CHANGED" },
      ],
    };
    const fp2 = computeProtocolFingerprint(suite, [profile2]);
    expect(fp1).not.toBe(fp2);
  });

  it("legacy profiles (no hybrid fields) produce stable fingerprints", () => {
    const suite = makeSuite({
      defaultEvaluation: { kind: "profile", profile: { id: "p1", version: 1 } },
    });
    const legacy: EvaluationProfile = {
      id: "p1",
      version: 1,
      name: "Legacy",
      description: "test",
      judgeInstruction: "",
      criteria: [
        {
          id: "c1",
          name: "C",
          description: "d",
          weight: 1,
          anchors: { one: "1", three: "3", five: "5" },
        },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    };
    // Fingerprint should be deterministic and not affected by absence of hybrid fields
    const fp1 = computeProtocolFingerprint(suite, [legacy]);
    const fp2 = computeProtocolFingerprint(suite, [legacy]);
    expect(fp1).toBe(fp2);
  });
});

describe("legacy/pure-graded fingerprint stability (plan J.1)", () => {
  function pureGraded(): EvaluationProfile {
    return {
      id: "p1",
      version: 1,
      name: "Pure",
      description: "test",
      judgeInstruction: "",
      criteria: [
        {
          id: "c1",
          name: "C",
          description: "d",
          weight: 1,
          anchors: { one: "1", three: "3", five: "5" },
        },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    };
  }

  it("pure-graded profile hash is unchanged by an irrelevant complianceInfluence field", () => {
    // complianceInfluence is irrelevant for a profile with no binary channel
    // (C := 1 → rankValue = Q). It must NOT alter the fingerprint.
    const suite = makeSuite({
      defaultEvaluation: { kind: "profile", profile: { id: "p1", version: 1 } },
    });
    const plain = computeProtocolFingerprint(suite, [pureGraded()]);
    const withLambda = computeProtocolFingerprint(suite, [
      { ...pureGraded(), complianceInfluence: 0.5 },
    ]);
    expect(plain).toBe(withLambda);
  });

  it("a mixed profile's complianceInfluence DOES change the fingerprint", () => {
    const suite = makeSuite({
      defaultEvaluation: { kind: "profile", profile: { id: "p1", version: 1 } },
    });
    const mixed = (lambda: number | undefined): EvaluationProfile => ({
      ...makeGradedProfile(),
      complianceInfluence: lambda,
    });
    const fpAbsent = computeProtocolFingerprint(suite, [mixed(undefined)]);
    const fp05 = computeProtocolFingerprint(suite, [mixed(0.5)]);
    expect(fpAbsent).not.toBe(fp05);
  });
});
