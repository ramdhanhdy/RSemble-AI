import { describe, it, expect } from "vitest";
import {
  buildFrozenContext,
  buildPlaceholders,
  fenceFromLease,
  acceptedAttemptIdsByCandidate,
  type FrozenContextSource,
} from "./run-context-builders";
import type { ModelSlot } from "../studio-data";

// Characterization for the pure Compare run-context builders extracted from
// run-controller (Plan 007 Workstream C). These freeze the immutable protocol
// snapshot, build executor-matching placeholders, derive the fence shape, and
// resolve accepted attempt IDs — the frozen-run contract (spec §5.1/§11.3).

function sampleSource(overrides: Partial<FrozenContextSource> = {}): FrozenContextSource {
  const slot: ModelSlot = {
    id: "slot-1",
    providerId: "openrouter",
    provider: "OpenRouter",
    slug: "a",
    model: "A",
    strategyLabel: "Parallel model",
  } as unknown as ModelSlot;
  return {
    mode: "rank",
    prompt: "hello",
    systemPrompt: "sys",
    temperature: 0.7,
    evaluation: { profileId: "p1", profileVersion: 1 } as never,
    slots: [slot],
    critic: { providerId: "openrouter", model: "judge" },
    judgeInstruction: "",
    attachments: [],
    attachmentsToJudge: false,
    reasoningPolicy: { candidates: "low", judge: "low" },
    ...overrides,
  };
}

describe("buildFrozenContext", () => {
  it("returns an immutable, self-contained snapshot", () => {
    const src = sampleSource();
    const ctx = buildFrozenContext(src);
    expect(ctx.mode).toBe("rank");
    expect(ctx.task).toEqual({ prompt: "hello", systemPrompt: "sys", temperature: 0.7 });
    expect(ctx.prompt).toBe("hello");
    // slots/attachments are deep-copied, not referenced
    expect(ctx.slots![0]).not.toBe(src.slots[0]);
    expect(ctx.slots![0].id).toBe("slot-1");
    expect(ctx.critic).toEqual({ providerId: "openrouter", model: "judge" });
  });

  it("copies slots and attachments one level so later top-level mutation cannot leak", () => {
    const src = sampleSource();
    const ctx = buildFrozenContext(src);
    src.slots[0].model = "CHANGED";
    src.attachments.push({ name: "x", kind: "image", bytes: 1 } as never);
    expect(ctx.slots![0].model).toBe("A");
    expect(ctx.attachments.length).toBe(0);
  });
});

describe("buildPlaceholders", () => {
  it("mirrors the fanout jobs exactly with pending status", () => {
    const jobs = [
      {
        id: "cand-1",
        providerId: "openrouter",
        slug: "a",
        displayName: "A",
        provider: "OpenRouter",
        accent: "cyan",
        strategyLabel: "Parallel model",
      },
    ] as never[] as Parameters<typeof buildPlaceholders>[0];
    const ph = buildPlaceholders(jobs, 1000);
    expect(ph[0]).toMatchObject({
      id: "cand-1",
      model: "A",
      provider: "OpenRouter",
      providerId: "openrouter",
      slug: "a",
      strategy: "Parallel model",
      status: "pending",
      startedAt: 1000,
      summary: "",
      scores: {},
      segments: [],
    });
  });
});

describe("fenceFromLease", () => {
  it("maps a token with leaseId into the persisted fence shape", () => {
    const fence = fenceFromLease({
      ownerId: "tab-1",
      fence: 5,
      leaseId: "lease-9",
    } as never);
    expect(fence).toEqual({ ownerId: "tab-1", fence: 5, leaseId: "lease-9" });
  });

  it("omits the leaseId field when absent", () => {
    const fence = fenceFromLease({ ownerId: "tab-2", fence: 3 } as never);
    expect(fence).toEqual({ ownerId: "tab-2", fence: 3 });
    expect(fence && "leaseId" in fence).toBe(false);
  });

  it("returns undefined for a missing token", () => {
    expect(fenceFromLease(null)).toBeUndefined();
    expect(fenceFromLease(undefined)).toBeUndefined();
  });
});

describe("acceptedAttemptIdsByCandidate", () => {
  it("collects accepted attempt IDs keyed by candidateId", () => {
    const ids = acceptedAttemptIdsByCandidate({
      candidates: [
        { candidateId: "c1", acceptedAttemptId: "att-1" },
        { candidateId: "c2", acceptedAttemptId: null },
        { candidateId: "c3", acceptedAttemptId: "att-3" },
      ],
    });
    expect(ids).toEqual({ c1: "att-1", c3: "att-3" });
  });

  it("returns an empty map for a null record", () => {
    expect(acceptedAttemptIdsByCandidate(null)).toEqual({});
  });
});
