// =============================================================================
// RSemble AI — model-profile-worker.test.ts (Child 07 Task 8)
//
// Focused tests for the off-main-thread exact-profile computation seam.
// Verifies:
//  - `computeProfileSync` is deterministic and permutation-invariant over the
//    seeded acceptance corpus (input-order independence).
//  - `runProfileComputation` dispatches to a Web Worker when constructible and
//    does NOT run `computeProfileSync` on the calling (main) thread.
//  - cancel via AbortSignal terminates the worker and rejects with AbortError.
//  - progress phase events fire from the worker.
//  - the in-process fallback (no Worker constructor) produces output identical
//    to the direct compute for the same input.
//
// Vite URL Workers (`new Worker(new URL(..., import.meta.url))`) cannot be
// constructed in the node/happy-dom vitest environment, so the offload path is
// exercised through a mock `Worker` constructor that proves the dispatcher
// posts to a worker and never calls the heavy sync compute on the main thread.
// The pure compute function is exercised directly for correctness.
// =============================================================================
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { seedProfileTestCorpus } from "../../workspaces/models/model-profile-loader-test-seed";

import * as workerModule from "./model-profile-worker";
import * as pairedMod from "./paired-comparison";
import {
  computeProfileSync,
  runProfileComputation,
  AbortError,
  type ProfileWorkerInput,
  type ProfileWorkerOutput,
  type ProfileWorkerPhase,
  type ComparatorWorkerInput,
  type ComparatorWorkerOutput,
} from "./model-profile-worker";
import { QUERY_ELIGIBILITY_RULE_VERSION } from "./model-evidence-query";
import type { EligibilityDecision } from "../evidence/evidence-types";
import { InMemoryEvidenceRepository } from "../persistence/evidence-repository";
import { InMemoryTaskRepository } from "../persistence/in-memory-task-repository";
import {
  assembleProfileWorkerInput,
  loadProfileData,
} from "../../workspaces/models/model-profile-loader";

// ---------------------------------------------------------------------------
// Input assembly — mirrors the loader's async I/O so the worker compute can be
// exercised against the real seeded acceptance corpus without repository I/O
// inside the timed compute.
// ---------------------------------------------------------------------------

async function assembleInput(
  evidenceRepo: InMemoryEvidenceRepository,
  taskRepo: InMemoryTaskRepository,
  modelConfigurationId: string,
  selectedComparatorId: string | null = null,
): Promise<ProfileWorkerInput> {
  const config = await evidenceRepo.getModelConfiguration(modelConfigurationId);
  if (!config) throw new Error("config not found");

  const observations =
    await evidenceRepo.listObservationsByModelConfiguration(modelConfigurationId);
  const decisions = (
    await Promise.all(observations.map((obs) => evidenceRepo.getActiveDecision(obs.id)))
  ).filter((d): d is EligibilityDecision => d !== null);

  const families = await taskRepo.listTaskFamilies();
  const familyNames: Record<string, string> = {};
  for (const fam of families) familyNames[fam.id] = fam.name;

  const supportsRelations =
    "listTaskFamilyRelations" in taskRepo &&
    typeof (taskRepo as unknown as { listTaskFamilyRelations?: unknown })
      .listTaskFamilyRelations === "function";
  const taskFamilyRelations = supportsRelations
    ? await (
        taskRepo as unknown as { listTaskFamilyRelations: () => Promise<never[]> }
      ).listTaskFamilyRelations()
    : [];
  const taskIds = [...new Set(observations.map((o) => o.taskId))];
  const taskFamilyAssignments = (
    await Promise.all(taskIds.map((tid) => taskRepo.listTaskFamilyAssignments(tid)))
  ).flat();
  const facets = (
    await Promise.all(taskIds.map((tid) => taskRepo.listTaskFacetAnnotations(tid)))
  ).flat();

  const allConfigs = await evidenceRepo.listModelConfigurations();
  const candidates: { id: string; label: string; sharedTaskCount: number }[] = [];
  for (const c of allConfigs) {
    if (c.id === modelConfigurationId) continue;
    const otherObs = await evidenceRepo.listObservationsByModelConfiguration(c.id);
    const otherTaskIds = new Set(otherObs.map((o) => o.taskId));
    const sharedCount = taskIds.filter((t) => otherTaskIds.has(t)).length;
    candidates.push({
      id: c.id,
      label: `${c.providerId} · ${c.requestedModel}`,
      sharedTaskCount: sharedCount,
    });
  }
  candidates.sort(
    (a, b) => b.sharedTaskCount - a.sharedTaskCount || a.label.localeCompare(b.label),
  );

  let comparatorCorpus: ProfileWorkerInput["comparatorCorpus"] = null;
  if (selectedComparatorId) {
    const compConfig = allConfigs.find((c) => c.id === selectedComparatorId);
    if (compConfig) {
      const compObs = await evidenceRepo.listObservationsByModelConfiguration(selectedComparatorId);
      const compDecs = (
        await Promise.all(compObs.map((o) => evidenceRepo.getActiveDecision(o.id)))
      ).filter((d): d is EligibilityDecision => d !== null);
      comparatorCorpus = {
        config: compConfig,
        observations: compObs,
        decisions: compDecs,
      };
    }
  }

  return {
    modelConfigurationId,
    subjectCorpus: { config, observations, decisions, facets },
    familyNames,
    taskFamilyRelations,
    taskFamilyAssignments,
    candidates,
    selectedComparatorId,
    comparatorCorpus,
    generatedAt: 1_700_000_000_000,
  };
}

// ---------------------------------------------------------------------------
// computeProfileSync — correctness, determinism, permutation invariance
// ---------------------------------------------------------------------------

describe("computeProfileSync — exact-profile synchronous compute", () => {
  it("produces a non-null profile over the seeded acceptance corpus", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedProfileTestCorpus();
    const input = await assembleInput(evidenceRepo, taskRepo, configAId);
    const profile = computeProfileSync(input);
    expect(profile).not.toBeNull();
    expect(profile.identity.modelConfigurationId).toBe(configAId);
    expect(profile.evidenceRows.length).toBeGreaterThan(0);
    expect(profile.families.length).toBeGreaterThan(0);
    expect(profile.identity.generatedAt).toBe(input.generatedAt);
  });

  it("is deterministic: identical input → identical output", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedProfileTestCorpus();
    const input = await assembleInput(evidenceRepo, taskRepo, configAId);
    const a = computeProfileSync(input);
    const b = computeProfileSync(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is permutation-invariant over corpus input order (seeds 101/202/303)", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedProfileTestCorpus();
    const base = await assembleInput(evidenceRepo, taskRepo, configAId);
    const canonical = computeProfileSync(base);
    const canonicalJson = JSON.stringify(canonical);

    function mulberry32(seed: number): () => number {
      let s = seed >>> 0;
      return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function permute<T>(items: readonly T[], seed: number): T[] {
      const arr = [...items];
      const rng = mulberry32(seed);
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    }

    for (const seed of [101, 202, 303]) {
      const permuted: ProfileWorkerInput = {
        ...base,
        subjectCorpus: {
          ...base.subjectCorpus,
          observations: permute(base.subjectCorpus.observations, seed),
          decisions: permute(base.subjectCorpus.decisions, seed + 1),
          facets: permute(base.subjectCorpus.facets, seed + 3),
        },
      };
      const out = computeProfileSync(permuted);
      expect(JSON.stringify(out)).toBe(canonicalJson);
    }
  });

  it("computes paired comparison when a comparator corpus is supplied", async () => {
    const { evidenceRepo, taskRepo, configAId, configBId } = await seedProfileTestCorpus();
    const input = await assembleInput(evidenceRepo, taskRepo, configAId, configBId);
    const profile = computeProfileSync(input);
    expect(profile.paired?.comparator?.id).toBe(configBId);
    expect(profile.paired?.result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runProfileComputation — offload, cancel, progress, fallback
// ---------------------------------------------------------------------------

describe("runProfileComputation — off-main-thread dispatch", () => {
  let originalWorker: unknown;

  beforeEach(() => {
    originalWorker = (globalThis as unknown as { Worker?: unknown }).Worker;
    createdWorkers.length = 0;
  });

  afterEach(() => {
    if (originalWorker === undefined) {
      delete (globalThis as unknown as { Worker?: unknown }).Worker;
    } else {
      (globalThis as unknown as { Worker?: unknown }).Worker = originalWorker;
    }
  });

  it("dispatches to a Worker and does NOT call computeProfileSync on the main thread", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedProfileTestCorpus();
    const input = await assembleInput(evidenceRepo, taskRepo, configAId);
    const computeSpy = vi.spyOn(workerModule, "computeProfileSync");

    installMockWorker(() => ({
      onPosted: () => ({ kind: "result", data: SENTINEL_PROFILE }),
    }));

    const result = await runProfileComputation(input);
    expect(result).toEqual(SENTINEL_PROFILE);
    expect(computeSpy).not.toHaveBeenCalled();
    expect(createdWorkers.length).toBe(1);
    expect(createdWorkers[0].terminated).toBe(true);
    expect(createdWorkers[0].postedMessages.length).toBe(1);
    expect(createdWorkers[0].postedMessages[0]).toBe(input);
    computeSpy.mockRestore();
  });

  it("emits progress phase events from the worker", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedProfileTestCorpus();
    const input = await assembleInput(evidenceRepo, taskRepo, configAId);
    const phases: ProfileWorkerPhase[] = [];

    installMockWorker(() => ({
      onPosted: (post) => {
        for (const phase of ["select", "aggregate", "done"] as ProfileWorkerPhase[]) {
          post({ kind: "progress", phase });
        }
        return { kind: "result", data: SENTINEL_PROFILE };
      },
    }));

    await runProfileComputation(input, { onProgress: (p) => phases.push(p) });
    expect(phases).toEqual(["select", "aggregate", "done"]);
  });

  it("terminates the worker and rejects with AbortError when the signal aborts", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedProfileTestCorpus();
    const input = await assembleInput(evidenceRepo, taskRepo, configAId);
    const controller = new AbortController();

    // The mock worker never posts a result on its own; the test aborts first.
    installMockWorker(() => ({ onPosted: () => null }));

    const promise = runProfileComputation(input, { signal: controller.signal });
    // Yield once so the dispatcher has constructed the worker and posted input.
    await Promise.resolve();
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(AbortError);
    expect(createdWorkers.length).toBe(1);
    expect(createdWorkers[0].terminated).toBe(true);
  });

  it("rejects with AbortError when the signal is already aborted", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedProfileTestCorpus();
    const input = await assembleInput(evidenceRepo, taskRepo, configAId);
    const controller = new AbortController();
    controller.abort();

    installMockWorker(() => ({ onPosted: () => ({ kind: "result", data: SENTINEL_PROFILE }) }));

    await expect(
      runProfileComputation(input, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(AbortError);
    // No worker should have been created for an already-aborted signal.
    expect(createdWorkers.length).toBe(0);
  });

  it("falls back to in-process compute when no Worker constructor exists", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedProfileTestCorpus();
    const input = await assembleInput(evidenceRepo, taskRepo, configAId);
    delete (globalThis as unknown as { Worker?: unknown }).Worker;

    const result = await runProfileComputation(input);
    expect(result).not.toBeNull();
    expect(result?.identity.modelConfigurationId).toBe(configAId);
  });

  it("in-process fallback output is identical to direct computeProfileSync", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedProfileTestCorpus();
    const input = await assembleInput(evidenceRepo, taskRepo, configAId);
    delete (globalThis as unknown as { Worker?: unknown }).Worker;

    const result = await runProfileComputation(input);
    const direct = computeProfileSync(input);
    expect(JSON.stringify(result)).toBe(JSON.stringify(direct));
  });
});

// ---------------------------------------------------------------------------
// Loader integration — loadProfileData delegates and produces identical output
// ---------------------------------------------------------------------------

describe("loadProfileData — worker delegation output identity", () => {
  it("produces output identical to assembleProfileWorkerInput + computeProfileSync", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedProfileTestCorpus();

    // In node (no Worker constructor) the dispatcher falls back to in-process
    // computeProfileSync, so loadProfileData exercises the same compute the
    // worker would run. This proves the loader assembles the input faithfully
    // and the offloaded compute matches the direct compute for the same input.
    delete (globalThis as unknown as { Worker?: unknown }).Worker;

    const input = await assembleProfileWorkerInput({
      modelConfigurationId: configAId,
      evidenceRepo,
      taskRepo,
    });
    expect(input).not.toBeNull();
    const direct = computeProfileSync(input!);

    const viaLoader = await loadProfileData({
      modelConfigurationId: configAId,
      evidenceRepo,
      taskRepo,
    });
    expect(viaLoader).not.toBeNull();

    // Normalize the volatile generatedAt timestamp captured at dispatch time.
    const loaderJson = JSON.parse(JSON.stringify(viaLoader));
    loaderJson.identity.generatedAt = input!.generatedAt;
    expect(loaderJson).toEqual(JSON.parse(JSON.stringify(direct)));
  });

  it("returns null for a missing model configuration", async () => {
    const { evidenceRepo, taskRepo } = await seedProfileTestCorpus();
    delete (globalThis as unknown as { Worker?: unknown }).Worker;
    const profile = await loadProfileData({
      modelConfigurationId: "mc:sha256:does-not-exist",
      evidenceRepo,
      taskRepo,
    });
    expect(profile).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mock Worker constructor — synchronous posting (no real timers)
// ---------------------------------------------------------------------------

interface MockWorkerInstance {
  terminated: boolean;
  postedMessages: unknown[];
}

const createdWorkers: MockWorkerInstance[] = [];

interface MockWorkerOptions {
  /** Called on postMessage; may post messages back via `post` and/or return a final outbound message. */
  onPosted: (post: (msg: unknown) => void) => unknown;
}

function installMockWorker(makeOptions: () => MockWorkerOptions): void {
  (globalThis as unknown as { Worker: unknown }).Worker = class MockWorker {
    terminated = false;
    postedMessages: unknown[] = [];
    private messageListeners: Array<(ev: MessageEvent) => void> = [];
    private opts: MockWorkerOptions;

    constructor(_scriptURL: URL, _options?: { type?: "classic" | "module" }) {
      this.opts = makeOptions();
      createdWorkers.push(this);
    }

    postMessage(message: unknown): void {
      this.postedMessages.push(message);
      const post = (msg: unknown) => {
        for (const listener of this.messageListeners) {
          listener({ data: msg } as MessageEvent);
        }
      };
      // Synchronous: the dispatcher attaches its listener before postMessage,
      // so posting here deterministically delivers progress/result. The cancel
      // path uses an onPosted that returns null so nothing is delivered and the
      // promise stays pending until the signal aborts.
      const out = this.opts.onPosted(post);
      if (out !== null && out !== undefined) post(out);
    }

    terminate(): void {
      this.terminated = true;
    }

    addEventListener(type: "message" | "error", listener: (ev: MessageEvent) => void): void {
      if (type === "message") this.messageListeners.push(listener);
    }

    removeEventListener(type: "message" | "error", listener: (ev: MessageEvent) => void): void {
      if (type === "message") {
        this.messageListeners = this.messageListeners.filter((l) => l !== listener);
      }
    }
  };
}

const SENTINEL_PROFILE: ProfileWorkerOutput = {
  identity: {
    modelConfigurationId: "sentinel",
    providerId: "sentinel",
    requestedModel: "sentinel",
    versionStatus: "exact",
    generatedAt: 1,
    aggregationRuleVersion: 1,
    uncertaintyRuleVersion: 1,
    eligibilityRuleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
  },
  coverage: { comparabilityCohorts: { state: "insufficient", reason: "sentinel" } },
  narrative: [],
  claims: [],
  families: [],
  verifiedOutcomes: [],
  evidenceRows: [],
  paired: { candidates: [], comparator: null, result: null },
} as unknown as ProfileWorkerOutput;

// ---------------------------------------------------------------------------
// Run 28 T8 repair — real worker-emitted phases + comparator dispatch
// ---------------------------------------------------------------------------

async function assembleComparatorInput(
  evidenceRepo: InMemoryEvidenceRepository,
  taskRepo: InMemoryTaskRepository,
  subjectConfigurationId: string,
  comparatorId: string,
): Promise<ComparatorWorkerInput> {
  const configA = await evidenceRepo.getModelConfiguration(subjectConfigurationId);
  const configB = await evidenceRepo.getModelConfiguration(comparatorId);
  if (!configA || !configB) throw new Error("comparator configs not found");

  const observationsA = await evidenceRepo.listObservationsByModelConfiguration(
    subjectConfigurationId,
  );
  const observationsB = await evidenceRepo.listObservationsByModelConfiguration(comparatorId);
  const decisionsA = (
    await Promise.all(observationsA.map((o) => evidenceRepo.getActiveDecision(o.id)))
  ).filter((d): d is EligibilityDecision => d !== null);
  const decisionsB = (
    await Promise.all(observationsB.map((o) => evidenceRepo.getActiveDecision(o.id)))
  ).filter((d): d is EligibilityDecision => d !== null);

  const taskIds = [...new Set([...observationsA, ...observationsB].map((o) => o.taskId))];
  const taskFamilyAssignments = (
    await Promise.all(taskIds.map((tid) => taskRepo.listTaskFamilyAssignments(tid)))
  ).flat();
  const supportsRelations =
    "listTaskFamilyRelations" in taskRepo &&
    typeof (taskRepo as unknown as { listTaskFamilyRelations?: unknown })
      .listTaskFamilyRelations === "function";
  const taskFamilyRelations = supportsRelations
    ? await (
        taskRepo as unknown as { listTaskFamilyRelations: () => Promise<never[]> }
      ).listTaskFamilyRelations()
    : [];
  const facets = (
    await Promise.all(taskIds.map((tid) => taskRepo.listTaskFacetAnnotations(tid)))
  ).flat();

  return {
    subjectConfigurationId,
    comparatorId,
    configA,
    configB,
    observationsA,
    observationsB,
    decisionsA,
    decisionsB,
    facets,
    taskFamilyAssignments,
    taskFamilyRelations,
  };
}

describe("computeProfileSync — real computation phases", () => {
  it("emits meaningful phases at the actual computation steps", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedProfileTestCorpus();
    const input = await assembleInput(evidenceRepo, taskRepo, configAId);

    const phases: ProfileWorkerPhase[] = [];
    computeProfileSync(input, (phase) => phases.push(phase));

    // Phases must originate from the computation itself, not a timer or a
    // synthetic list replayed by the dispatcher.
    expect(phases[0]).toBe("select");
    expect(phases[phases.length - 1]).toBe("done");
    for (const expected of [
      "coverage",
      "aggregate",
      "uncertainty",
      "family_loop",
      "evidence_rows",
      "identity",
    ] as ProfileWorkerPhase[]) {
      expect(phases).toContain(expected);
    }
  });
});

describe("runPairedComparisonComputation — off-main-thread comparator dispatch", () => {
  let originalWorker: unknown;

  beforeEach(() => {
    originalWorker = (globalThis as unknown as { Worker?: unknown }).Worker;
    createdWorkers.length = 0;
  });

  afterEach(() => {
    if (originalWorker === undefined) {
      delete (globalThis as unknown as { Worker?: unknown }).Worker;
    } else {
      (globalThis as unknown as { Worker?: unknown }).Worker = originalWorker;
    }
  });

  it("dispatches comparator compute to a Worker and never runs it on the main thread", async () => {
    const { evidenceRepo, taskRepo, configAId, configBId } = await seedProfileTestCorpus();
    const input = await assembleComparatorInput(evidenceRepo, taskRepo, configAId, configBId);
    const selectSpy = vi.spyOn(selectionMod, "selectProfileObservations");
    const pairedSpy = vi.spyOn(pairedMod, "computePairedEvidence");

    const sentinelPair = {
      comparator: { id: configBId, providerId: "p", requestedModel: "m" },
      result: { metric: "judged_score" },
    } as unknown as ComparatorWorkerOutput;
    installMockWorker(() => ({
      onPosted: () => ({ kind: "comparator_result", data: sentinelPair }),
    }));

    const result = await workerModule.runPairedComparisonComputation(input);
    expect(result).toEqual(sentinelPair);
    expect(selectSpy).not.toHaveBeenCalled();
    expect(pairedSpy).not.toHaveBeenCalled();
    expect(createdWorkers.length).toBe(1);
    expect(createdWorkers[0].terminated).toBe(true);
    selectSpy.mockRestore();
    pairedSpy.mockRestore();
  });

  it("terminates the worker and rejects with AbortError when the signal aborts", async () => {
    const { evidenceRepo, taskRepo, configAId, configBId } = await seedProfileTestCorpus();
    const input = await assembleComparatorInput(evidenceRepo, taskRepo, configAId, configBId);
    const controller = new AbortController();

    installMockWorker(() => ({ onPosted: () => null }));

    const promise = workerModule.runPairedComparisonComputation(input, {
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(AbortError);
    expect(createdWorkers.length).toBe(1);
    expect(createdWorkers[0].terminated).toBe(true);
  });

  it("in-process fallback output is identical to computeComparatorSync", async () => {
    const { evidenceRepo, taskRepo, configAId, configBId } = await seedProfileTestCorpus();
    const input = await assembleComparatorInput(evidenceRepo, taskRepo, configAId, configBId);
    delete (globalThis as unknown as { Worker?: unknown }).Worker;

    const viaDispatcher = await workerModule.runPairedComparisonComputation(input);
    const direct = workerModule.computeComparatorSync(input);
    expect(JSON.stringify(viaDispatcher)).toBe(JSON.stringify(direct));
    expect(viaDispatcher).not.toBeNull();
    expect(viaDispatcher?.comparator.id).toBe(configBId);
  });
});
