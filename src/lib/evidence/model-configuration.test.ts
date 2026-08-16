// =============================================================================
// model-configuration.test.ts — canonical model configuration identity
// (observations-and-evidence spec §3.1).
//
// Covers: exact / rolling_alias / partial identity, unknown version stays
// null/partial, reasoning/tool/runtime differences, canonical key permutation,
// secret omission, collision deep-check, date-window updates, and the
// no-marketing-name-rollup rule.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  ModelConfigurationCollisionError,
  assertConfigurationContentMatches,
  canonicalModelConfigurationJson,
  canonicalizeModelConfiguration,
  computeModelConfigurationId,
  configurationsCollide,
  extendConfigurationWindow,
  type ModelConfigurationInput,
} from "./model-configuration";

const ID_RE = /^mc:sha256:[0-9a-f]{64}$/;

function makeInput(overrides: Partial<ModelConfigurationInput> = {}): ModelConfigurationInput {
  return {
    providerId: "openrouter",
    requestedModel: "org/gpt-x",
    resolvedModel: "org/gpt-x-2025-06",
    resolvedVersion: "2025-06-01",
    reasoningRequested: "high",
    reasoningEffective: "medium",
    toolScaffoldSignature: `sha256:${"a".repeat(64)}`,
    runtimeSettings: { temperature: 0.7, maxTokens: 4096 },
    observedAt: 1000,
    ...overrides,
  };
}

function canonicalize(input: ModelConfigurationInput) {
  const result = canonicalizeModelConfiguration(input);
  if (!result.ok) throw new Error(`unexpected failure: ${result.reason}`);
  return result.snapshot;
}

describe("identity completeness", () => {
  it("is exact when both resolved model and version are known", () => {
    const s = canonicalize(makeInput());
    expect(s.identityCompleteness).toBe("exact");
    expect(s.resolvedModel).toBe("org/gpt-x-2025-06");
    expect(s.resolvedVersion).toBe("2025-06-01");
    expect(s.id).toMatch(ID_RE);
  });

  it("is rolling_alias when the model is known but the version is not", () => {
    const s = canonicalize(makeInput({ resolvedVersion: undefined }));
    expect(s.identityCompleteness).toBe("rolling_alias");
    expect(s.resolvedVersion).toBeNull();
  });

  it("is partial when nothing resolved", () => {
    const s = canonicalize(makeInput({ resolvedModel: undefined, resolvedVersion: undefined }));
    expect(s.identityCompleteness).toBe("partial");
    expect(s.resolvedModel).toBeNull();
    expect(s.resolvedVersion).toBeNull();
  });

  it("never invents an unknown version", () => {
    const s = canonicalize(makeInput({ resolvedVersion: null }));
    expect(s.resolvedVersion).toBeNull();
    expect(s.identityCompleteness).toBe("rolling_alias");
  });

  it("treats blank resolved fields as unknown", () => {
    const s = canonicalize(makeInput({ resolvedModel: "  ", resolvedVersion: "" }));
    expect(s.resolvedModel).toBeNull();
    expect(s.resolvedVersion).toBeNull();
    expect(s.identityCompleteness).toBe("partial");
  });
});

describe("identity sensitivity", () => {
  it("changes id when reasoning settings differ", () => {
    expect(canonicalize(makeInput({ reasoningRequested: "low" })).id).not.toBe(
      canonicalize(makeInput()).id,
    );
  });

  it("changes id when the tool scaffold differs", () => {
    expect(canonicalize(makeInput({ toolScaffoldSignature: null })).id).not.toBe(
      canonicalize(makeInput()).id,
    );
  });

  it("changes id when runtime settings differ", () => {
    expect(canonicalize(makeInput({ runtimeSettings: { temperature: 0.1 } })).id).not.toBe(
      canonicalize(makeInput()).id,
    );
  });

  it("changes id when the resolved version differs", () => {
    expect(canonicalize(makeInput({ resolvedVersion: "2025-07-01" })).id).not.toBe(
      canonicalize(makeInput()).id,
    );
  });

  it("is stable across key-order permutations of runtime settings", () => {
    const a = canonicalize(makeInput({ runtimeSettings: { temperature: 0.7, maxTokens: 4096, seed: 1 } }));
    const b = canonicalize(makeInput({ runtimeSettings: { seed: 1, temperature: 0.7, maxTokens: 4096 } }));
    expect(a.id).toBe(b.id);
    expect(canonicalModelConfigurationJson(a)).toBe(canonicalModelConfigurationJson(b));
  });

  it("is stable across input property insertion order", () => {
    const a = canonicalize(makeInput());
    const b = canonicalizeModelConfiguration({
      observedAt: 1000,
      runtimeSettings: { temperature: 0.7, maxTokens: 4096 },
      toolScaffoldSignature: `sha256:${"a".repeat(64)}`,
      reasoningEffective: "medium",
      reasoningRequested: "high",
      resolvedVersion: "2025-06-01",
      resolvedModel: "org/gpt-x-2025-06",
      requestedModel: "org/gpt-x",
      providerId: "openrouter",
    });
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.snapshot.id).toBe(a.id);
  });

  it("ignores unknown input fields (no marketing-name rollup)", () => {
    const plain = canonicalize(makeInput());
    const withMarketing = makeInput() as unknown as ModelConfigurationInput & {
      displayName: string;
      brand: string;
    };
    withMarketing.displayName = "GPT-X Super Model";
    withMarketing.brand = "Org";
    const s = canonicalize(withMarketing as ModelConfigurationInput);
    expect(s.id).toBe(plain.id);
    expect(canonicalModelConfigurationJson(s)).not.toContain("displayName");
    expect(canonicalModelConfigurationJson(s)).not.toContain("GPT-X Super Model");
  });
});

describe("secret omission", () => {
  it("omits prohibited keys and secret-shaped values from runtime settings", () => {
    const s = canonicalize(
      makeInput({
        runtimeSettings: {
          temperature: 0.7,
          apiKey: "sk-secret",
          token: "bearer-ish",
          headers: "{authorization: x}",
          plainValue: "sk-abc123",
          nested: { a: 1 } as never,
          bool: true,
        } as never,
      }),
    );
    expect(s.runtimeSettings).toEqual({ temperature: 0.7, bool: true });
  });

  it("keeps benign string and scalar settings", () => {
    const s = canonicalize(makeInput({ runtimeSettings: { stop: "###", seed: 42, stream: false } }));
    expect(s.runtimeSettings).toEqual({ stop: "###", seed: 42, stream: false });
  });
});

describe("computeModelConfigurationId", () => {
  it("is a canonical mc fingerprint", () => {
    const s = canonicalize(makeInput());
    expect(computeModelConfigurationId(s)).toBe(s.id);
    expect(computeModelConfigurationId(s)).toMatch(ID_RE);
  });

  it("does not change with observation windows", () => {
    const a = canonicalize(makeInput());
    const b = extendConfigurationWindow(a, 2000);
    expect(computeModelConfigurationId(b)).toBe(a.id);
  });
});

describe("collision deep-check", () => {
  it("throws when the same id carries different canonical content", () => {
    const a = canonicalize(makeInput());
    const b = { ...a, resolvedVersion: "tampered" };
    expect(configurationsCollide(a, b)).toBe(true);
    expect(() => assertConfigurationContentMatches(a, b)).toThrow(ModelConfigurationCollisionError);
  });

  it("passes when identical id has identical content", () => {
    const a = canonicalize(makeInput());
    const b = { ...a };
    expect(configurationsCollide(a, b)).toBe(false);
    expect(() => assertConfigurationContentMatches(a, b)).not.toThrow();
  });

  it("ignores distinct identities (no collision)", () => {
    const a = canonicalize(makeInput());
    const b = canonicalize(makeInput({ requestedModel: "org/other" }));
    expect(configurationsCollide(a, b)).toBe(false);
    expect(() => assertConfigurationContentMatches(a, b)).not.toThrow();
  });
});

describe("date-window updates", () => {
  it("extends observedTo and keeps identity", () => {
    const a = canonicalize(makeInput({ observedAt: 1000 }));
    const b = extendConfigurationWindow(a, 3000);
    expect(b.observedFrom).toBe(1000);
    expect(b.observedTo).toBe(3000);
    expect(b.id).toBe(a.id);
  });

  it("is a no-op for an equal or earlier in-window timestamp", () => {
    const a = canonicalize(makeInput({ observedAt: 1000 }));
    const b = extendConfigurationWindow(a, 2000);
    const c = extendConfigurationWindow(b, 1500);
    expect(c.observedTo).toBe(2000);
  });

  it("throws on an out-of-order observation before the window start", () => {
    const a = canonicalize(makeInput({ observedAt: 1000 }));
    expect(() => extendConfigurationWindow(a, 500)).toThrow(/out-of-order/i);
  });
});

describe("invalid input", () => {
  it("rejects a blank provider or requested model", () => {
    expect(canonicalizeModelConfiguration(makeInput({ providerId: " " })).ok).toBe(false);
    expect(canonicalizeModelConfiguration(makeInput({ requestedModel: "" })).ok).toBe(false);
  });

  it("rejects a resolved version without a resolved model", () => {
    const r = canonicalizeModelConfiguration(makeInput({ resolvedModel: null, resolvedVersion: "v1" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/resolvedVersion/i);
  });

  it("rejects non-finite observation timestamps", () => {
    expect(canonicalizeModelConfiguration(makeInput({ observedAt: Number.NaN })).ok).toBe(false);
    expect(canonicalizeModelConfiguration(makeInput({ observedAt: -1 })).ok).toBe(false);
  });
});
