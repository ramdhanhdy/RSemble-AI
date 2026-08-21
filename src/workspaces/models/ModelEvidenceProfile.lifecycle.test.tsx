// @vitest-environment happy-dom
// =============================================================================
// ModelEvidenceProfile lifecycle — Run 28 T8 repair (RED → GREEN).
//
// Reproduces the behavioral defects reported by external review:
//  1. The Cancel button merely navigates away; the in-flight profile
//     computation is never aborted (no AbortController reaches the loader).
//  2. Route/model change and unmount leave the Worker computation running and
//     its stale result free to overwrite newer state.
//  3. Comparator selection has no supersession: selecting B while A is in
//     flight lets A's late result overwrite B (stale wins).
//  4. Worker-emitted computation phases are never forwarded to the accessible
//     computing UI (profile and comparator alike).
//
// The loader module is mocked so each test controls exactly when computations
// resolve; the assertions target the component's real AbortController/signal
// and progress wiring, not a mocked Worker.
// =============================================================================

import { describe, expect, it, beforeEach, vi } from "vitest";
import { act } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { render, cleanup, settle, type Harness } from "./models-test-harness";
import { ModelEvidenceProfile, type ProfileData } from "./ModelEvidenceProfile";
import type { ComparatorCandidate } from "./ComparatorPicker";
import type { PairedComparatorIdentity } from "./PairedComparisonSection";
import type { PairedComparisonResult } from "../../lib/model-profiles/paired-comparison";
import { loadProfileData, loadPairedComparison } from "./model-profile-loader";
import { InMemoryEvidenceRepository } from "../../lib/persistence/evidence-repository";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";

vi.mock("./model-profile-loader", () => ({
  loadProfileData: vi.fn(),
  loadPairedComparison: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROUTE_ID = "mc-route";

interface PairedPair {
  comparator: PairedComparatorIdentity;
  result: PairedComparisonResult;
}

function makeCandidates(): ComparatorCandidate[] {
  return [
    { id: "mc-aaa", label: "alpha · model-a", sharedTaskCount: 12 },
    { id: "mc-bbb", label: "beta · model-b", sharedTaskCount: 9 },
  ];
}

function makeRoutedProfileData(): ProfileData {
  return {
    identity: {
      modelConfigurationId: ROUTE_ID,
      providerId: "openai",
      requestedModel: "gpt-5.6-sol",
      resolvedModel: "gpt-5.6-sol",
      resolvedVersion: "gpt-5.6-sol",
      versionStatus: "exact",
      observedFrom: 1714867200000,
      observedTo: 1722470400000,
      rubricVersionCount: 1,
      evaluatorConfigCount: 1,
      comparabilityCohortCount: 1,
      queryFingerprint: "sha256:abcdef1234567890abcdef1234567890",
      generatedAt: 1722470400000,
      aggregationRuleVersion: 1,
      uncertaintyRuleVersion: 1,
      eligibilityRuleVersion: 1,
    },
    coverage: {
      uniqueTasks: { state: "available", value: 38 },
      taskVersions: { state: "available", value: 52 },
      taskInstances: { state: "available", value: 94 },
      activeObservations: { state: "available", value: 112 },
      acceptedCandidateResponses: { state: "available", value: 98 },
      attempts: { state: "available", value: 156 },
      plannedReplicates: { state: "available", value: 20 },
      resolvedIndependentUncertaintyUnits: { state: "unavailable", reason: "Not assigned." },
      uncertaintyUnitKind: { state: "unavailable", reason: "Not assigned." },
      uncertaintyAssumption: { state: "unavailable", reason: "Not assigned." },
      comparabilityCohorts: { state: "available", value: 2 },
      rubricVersions: { state: "available", value: 3 },
      evaluatorConfigurations: { state: "available", value: 2 },
      earliestObservation: { state: "available", value: 1714867200000 },
      latestObservation: { state: "available", value: 1722470400000 },
      missingCells: { state: "available", value: 4 },
      inMetricsEvidenceClassSplit: {
        exploratory: 12,
        comparable: 8,
        verified: 5,
        benchmark_anchor: 2,
      },
      consideredEvidenceClassSplit: {
        exploratory: 12,
        comparable: 8,
        verified: 5,
        benchmark_anchor: 2,
      },
      inMetricsEligibilityStatusSplit: { eligible: 14, provisional: 3, excluded: 6 },
      consideredEligibilityStatusSplit: { eligible: 14, provisional: 3, excluded: 6 },
      sourceKindSplit: { comparison: 61, evaluation: 51 },
      identityCompleteness: "exact",
      limitationReasons: {},
    },
    narrative: [],
    claims: [],
    families: [],
    verifiedOutcomes: [],
    evidenceRows: [],
    protocolCohorts: [],
    evaluatorConfigs: [],
    uncertaintyReceipt: {
      unitKind: "task_identity",
      resolvedCount: 6,
      fallbackAssumption: "Task identity is the explicit fallback assumption.",
      resolverVersion: "v1",
      aggregationVersion: "v1",
      seed: "abcdef12",
      assignmentDigest: "9a2f4c",
      resamples: 2000,
    },
    limitations: [],
    isExploratoryOnly: false,
    isUnknownVersion: false,
    isInsufficientEverywhere: false,
    paired: { candidates: makeCandidates(), comparator: null, result: null },
  } as unknown as ProfileData;
}

function makePair(id: string, model: string): PairedPair {
  return {
    comparator: { id, providerId: "p", requestedModel: model },
    result: { metric: "judged_score" } as unknown as PairedComparisonResult,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function defer<T>(): Deferred<T> {
  // Project TS lib is ES2020: no Promise.withResolvers available.
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Loader option shapes including the signal/progress contract under repair. */
interface CapturedProfileOptions {
  modelConfigurationId?: string;
  signal?: AbortSignal;
  onProgress?: (phase: string) => void;
}
interface CapturedPairedOptions {
  comparatorId?: string;
  signal?: AbortSignal;
  onProgress?: (phase: string) => void;
}

function profileCalls(): CapturedProfileOptions[] {
  return vi.mocked(loadProfileData).mock.calls.map(
    (call) => call[0] as unknown as CapturedProfileOptions,
  );
}

function pairedCalls(): CapturedPairedOptions[] {
  return vi.mocked(loadPairedComparison).mock.calls.map(
    (call) => call[0] as unknown as CapturedPairedOptions,
  );
}

function NavButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="nav-button" onClick={() => navigate(to)}>
      go
    </button>
  );
}

function renderRoute(): Harness {
  const evidenceRepo = new InMemoryEvidenceRepository();
  const taskRepo = new InMemoryTaskRepository();
  return render(
    <MemoryRouter initialEntries={["/models/mc-route"]}>
      <Routes>
        <Route path="/models" element={<div data-testid="models-index" />} />
        <Route
          path="/models/:modelConfigurationId"
          element={
            <>
              <NavButton to="/models/mc-other" />
              <ModelEvidenceProfile evidenceRepo={evidenceRepo} taskRepo={taskRepo} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function selectComparator(h: Harness, id: string): Promise<void> {
  act(() => {
    h.$("button[data-comparator-trigger]")!.click();
  });
  await settle();
  act(() => {
    document.body.querySelector<HTMLElement>(`[data-candidate-id="${id}"]`)!.click();
  });
  await settle();
}
describe("ModelEvidenceProfile lifecycle — real cancellation, supersession, progress", () => {
  beforeEach(() => {
    vi.mocked(loadProfileData).mockReset();
    vi.mocked(loadPairedComparison).mockReset();
  });

  it("Cancel aborts the in-flight profile computation via a real AbortController", async () => {
    vi.mocked(loadProfileData).mockImplementation(() => new Promise(() => {}));
    const h = renderRoute();
    await settle();

    expect(h.$("[data-profile-state=computing]")).not.toBeNull();
    act(() => {
      h.$("[data-action=cancel]")!.click();
    });

    const calls = profileCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].signal!.aborted).toBe(true);
    cleanup(h);
  });

  it("Route/model change aborts the in-flight computation and starts a fresh one", async () => {
    vi.mocked(loadProfileData).mockImplementation(() => new Promise(() => {}));
    const h = renderRoute();
    await settle();

    act(() => {
      h.$("[data-testid=nav-button]")!.click();
    });
    await settle();

    const calls = profileCalls();
    expect(calls.length).toBe(2);
    expect(calls[0].signal!.aborted).toBe(true);
    expect(calls[1].signal!.aborted).toBe(false);
    expect(calls[1].modelConfigurationId).toBe("mc-other");
    cleanup(h);
  });

  it("Unmount aborts the in-flight computation", async () => {
    vi.mocked(loadProfileData).mockImplementation(() => new Promise(() => {}));
    const h = renderRoute();
    await settle();

    cleanup(h);
    expect(profileCalls()[0].signal!.aborted).toBe(true);
  });

  it("Forwards worker computation phases to the accessible computing UI", async () => {
    vi.mocked(loadProfileData).mockImplementation((options) => {
      const opts = options as unknown as CapturedProfileOptions;
      opts.onProgress?.("aggregate");
      return new Promise(() => {});
    });
    const h = renderRoute();
    await settle();

    const progress = h.$("[data-profile-progress]");
    expect(progress).not.toBeNull();
    expect(progress!.closest("[role=status]")?.getAttribute("aria-live")).toBe("polite");
    expect(progress!.textContent).toMatch(/aggregat/i);
    cleanup(h);
  });

  it("Selecting B supersedes A: A is aborted and A's stale result never wins", async () => {
    vi.mocked(loadProfileData).mockResolvedValue(makeRoutedProfileData());

    const pending = new Map<string, Deferred<PairedPair>>();
    vi.mocked(loadPairedComparison).mockImplementation((options) => {
      const opts = options as unknown as CapturedPairedOptions;
      const d = defer<PairedPair>();
      pending.set(opts.comparatorId!, d);
      return d.promise;
    });

    const h = renderRoute();
    await settle();

    await selectComparator(h, "mc-aaa");
    expect(pending.has("mc-aaa")).toBe(true);

    // Select B while A is still in flight (supersession).
    await selectComparator(h, "mc-bbb");

    const calls = pairedCalls();
    expect(calls.length).toBe(2);
    expect(calls[0].comparatorId).toBe("mc-aaa");
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].signal!.aborted).toBe(true);
    expect(calls[1].comparatorId).toBe("mc-bbb");
    expect(calls[1].signal!.aborted).toBe(false);

    // B resolves first.
    await act(async () => {
      pending.get("mc-bbb")!.resolve(makePair("mc-bbb", "model-b"));
      await settle();
    });
    expect(h.$("[data-comparator-chip]")!.textContent).toContain("model-b");

    // A's stale result arrives late and must NOT overwrite B.
    await act(async () => {
      pending.get("mc-aaa")!.resolve(makePair("mc-aaa", "model-a"));
      await settle();
    });
    expect(h.$("[data-comparator-chip]")!.textContent).toContain("model-b");
    expect(h.$("[data-comparator-chip]")!.textContent).not.toContain("model-a");
    cleanup(h);
  });

  it("Comparator computation forwards worker phases and offers explicit cancel", async () => {
    vi.mocked(loadProfileData).mockResolvedValue(makeRoutedProfileData());
    vi.mocked(loadPairedComparison).mockImplementation((options) => {
      const opts = options as unknown as CapturedPairedOptions;
      opts.onProgress?.("paired");
      return new Promise(() => {});
    });

    const h = renderRoute();
    await settle();
    await selectComparator(h, "mc-aaa");

    expect(h.$('[data-paired-state="computing"]')).not.toBeNull();
    const progress = h.$("[data-paired-progress]");
    expect(progress).not.toBeNull();
    expect(progress!.textContent).toMatch(/pair/i);

    act(() => {
      h.$("[data-action=cancel-comparator]")!.click();
    });
    expect(pairedCalls()[0].signal!.aborted).toBe(true);
    cleanup(h);
  });
});
