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
  { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "m1", slug: "org/m1", enabled: true },
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
        { id: "s3", providerId: "deepseek", provider: "DeepSeek", model: "m3", slug: "m3", enabled: true },
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
      modelSlots: base.modelSlots.map((s) => ({ ...s, id: `cosmetic-${s.id}`, provider: `Display ${s.provider}` })),
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
