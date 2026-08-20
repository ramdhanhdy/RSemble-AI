// =============================================================================
// RSemble AI — model-profile-loader.test.ts (Child 07 Task 8 — integration)
//
// Focused integration tests for the loader's off-main-thread seam. These prove
// the long-task budget repair: `loadProfileData` delegates the heavy
// synchronous exact-profile computation to `runProfileComputation` (the Web
// Worker dispatcher) and does NOT run the pure compute functions
// (selectProfileObservations / aggregateFamilyEvidence / computePairedEvidence)
// on the main thread, so the ~800ms synchronous block measured by the Run 27
// T8 benchmark is offloaded.
//
// Environment: node (vitest default). Vite URL Workers cannot be constructed
// here, so the offload is proven by mocking `runProfileComputation` and
// asserting the loader calls it (delegation) while the pure compute functions
// are never invoked on the calling thread. Output identity (worker compute vs
// loader) is proven in model-profile-worker.test.ts against the unmocked path.
// =============================================================================

import { describe, expect, it, beforeEach, vi } from "vitest";

import * as selectionMod from "../../lib/model-profiles/profile-observation-selection";
import * as aggregationMod from "../../lib/model-profiles/family-aggregation";
import * as pairedMod from "../../lib/model-profiles/paired-comparison";
import {
  runProfileComputation,
  type ProfileWorkerInput,
} from "../../lib/model-profiles/model-profile-worker";
import { loadProfileData } from "./model-profile-loader";
import { seedProfileTestCorpus } from "./model-profile-loader-test-seed";

// `loadProfileData` must delegate to the worker dispatcher. We mock the
// dispatcher so we can observe the delegation and assert the pure compute
// functions are never called on the main thread. The mock returns a sentinel
// profile so the loader's Promise<ProfileData | null> contract resolves
// without running the real compute.
vi.mock("../../lib/model-profiles/model-profile-worker", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/model-profiles/model-profile-worker")>();
  return {
    ...actual,
    runProfileComputation: vi.fn((input: ProfileWorkerInput) =>
      Promise.resolve({
        ...SENTINEL_PROFILE,
        identity: {
          ...SENTINEL_PROFILE.identity,
          modelConfigurationId: input.modelConfigurationId,
        },
      }),
    ),
  };
});

const SENTINEL_PROFILE = {
  identity: {
    modelConfigurationId: "sentinel",
    providerId: "sentinel",
    requestedModel: "sentinel",
    versionStatus: "exact",
    generatedAt: 1,
  },
  coverage: {},
  narrative: [],
  claims: [],
  families: [],
  verifiedOutcomes: [],
  evidenceRows: [],
  paired: { candidates: [], comparator: null, result: null },
} as unknown as import("../../lib/model-profiles/model-profile-worker").ProfileWorkerOutput;

describe("model-profile-loader — off-main-thread delegation (long-task budget repair)", () => {
  beforeEach(() => {
    vi.mocked(runProfileComputation).mockClear();
  });

  it("delegates the exact-profile computation to runProfileComputation (offload seam)", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedProfileTestCorpus();
    const profile = await loadProfileData({
      modelConfigurationId: configAId,
      evidenceRepo,
      taskRepo,
    });

    // The result must come from the dispatcher (sentinel), proving delegation.
    expect(profile).not.toBeNull();
    expect(profile?.identity.modelConfigurationId).toBe(configAId);
    expect(runProfileComputation).toHaveBeenCalledTimes(1);
    const dispatched = vi.mocked(runProfileComputation).mock.calls[0][0];
    expect(dispatched.modelConfigurationId).toBe(configAId);
    expect(dispatched.subjectCorpus.observations.length).toBeGreaterThan(0);
  });

  it("does NOT run the heavy pure compute functions on the main thread", async () => {
    const selectSpy = vi.spyOn(selectionMod, "selectProfileObservations");
    const aggregateSpy = vi.spyOn(aggregationMod, "aggregateFamilyEvidence");
    const pairedSpy = vi.spyOn(pairedMod, "computePairedEvidence");

    const { evidenceRepo, taskRepo, configAId } = await seedProfileTestCorpus();
    await loadProfileData({ modelConfigurationId: configAId, evidenceRepo, taskRepo });

    // The long-task budget repair requires these atomic synchronous functions
    // to run inside the worker, never on the main thread.
    expect(selectSpy).not.toHaveBeenCalled();
    expect(aggregateSpy).not.toHaveBeenCalled();
    expect(pairedSpy).not.toHaveBeenCalled();

    selectSpy.mockRestore();
    aggregateSpy.mockRestore();
    pairedSpy.mockRestore();
  });

  it("returns null when the model configuration does not exist (no dispatch)", async () => {
    const { evidenceRepo, taskRepo } = await seedProfileTestCorpus();
    const profile = await loadProfileData({
      modelConfigurationId: "mc:sha256:does-not-exist",
      evidenceRepo,
      taskRepo,
    });
    expect(profile).toBeNull();
    expect(runProfileComputation).not.toHaveBeenCalled();
  });
});
