// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, cleanup, settle } from "./models-test-harness";
import { ModelEvidenceProfile, type ProfileData } from "./ModelEvidenceProfile";
import { PairedComparisonSection, type PairedComparatorIdentity } from "./PairedComparisonSection";
import type {
  PairedComparisonResult,
  PairedTaskDelta,
} from "../../lib/model-profiles/paired-comparison";
import type { ComparatorCandidate } from "./ComparatorPicker";

const CANDIDATES: ComparatorCandidate[] = [
  { id: "mc-low", label: "provider-a · slug-low", sharedTaskCount: 2 },
  { id: "mc-high", label: "provider-b · slug-high", sharedTaskCount: 12 },
  { id: "mc-mid", label: "provider-c · slug-mid", sharedTaskCount: 7 },
];

const COMPARATOR: PairedComparatorIdentity = {
  id: "mc-high",
  providerId: "provider-b",
  requestedModel: "slug-high",
  resolvedVersion: "2026-05",
};

function coverage(partial: Partial<PairedComparisonResult["coverage"]> = {}) {
  return {
    sharedTaskCount: 0,
    comparableTaskCount: 0,
    incompatibleTaskCount: 0,
    wins: 0,
    ties: 0,
    losses: 0,
    missingInA: 0,
    missingInB: 0,
    ...partial,
  };
}

function delta(
  partial: Partial<PairedTaskDelta> & Pick<PairedTaskDelta, "taskId" | "state">,
): PairedTaskDelta {
  return {
    metric: "judged_score",
    cohortId: null,
    valueA: null,
    valueB: null,
    delta: null,
    outcome: null,
    versionsA: [],
    versionsB: [],
    changedTaskVersion: false,
    observationIdsA: [],
    observationIdsB: [],
    instancesA: [],
    instancesB: [],
    missingInstancesA: [],
    missingInstancesB: [],
    disclosure: null,
    ...partial,
  };
}

function emptyResult(): PairedComparisonResult {
  return {
    ruleVersion: 1,
    configurationAId: "mc-subject",
    configurationBId: "mc-high",
    metric: "judged_score",
    epsilon: 0,
    empty: true,
    emptyReason: "No shared eligible tasks",
    coverage: coverage(),
    taskDeltas: [],
    meanDelta: null,
    bootstrap: null,
    uncertaintyResolution: null,
    cohortResults: [],
    disclosures: [],
  };
}

function resultsPayload(): PairedComparisonResult {
  return {
    ruleVersion: 1,
    configurationAId: "mc-subject",
    configurationBId: "mc-high",
    metric: "judged_score",
    epsilon: 0,
    empty: false,
    emptyReason: null,
    coverage: coverage({
      sharedTaskCount: 12,
      comparableTaskCount: 10,
      incompatibleTaskCount: 2,
      wins: 6,
      ties: 2,
      losses: 4,
      missingInA: 1,
      missingInB: 1,
    }),
    taskDeltas: [
      delta({
        taskId: "task-win",
        state: "comparable",
        cohortId: "rub-a@1",
        valueA: 80,
        valueB: 70,
        delta: 10,
        outcome: "win",
        observationIdsA: ["obs-a-win"],
        observationIdsB: ["obs-b-win"],
      }),
      delta({
        taskId: "task-tie",
        state: "comparable",
        cohortId: "rub-a@1",
        valueA: 50,
        valueB: 50,
        delta: 0,
        outcome: "tie",
      }),
      delta({
        taskId: "task-loss",
        state: "comparable",
        cohortId: "rub-a@1",
        valueA: 40,
        valueB: 60,
        delta: -20,
        outcome: "loss",
      }),
      delta({
        taskId: "task-incompat",
        state: "incompatible_cohort",
        disclosure: "Rubric cohorts are not commensurate",
      }),
      delta({
        taskId: "task-missing-here",
        state: "missing_in_a",
      }),
      delta({
        taskId: "task-missing-there",
        state: "missing_in_b",
      }),
      delta({
        taskId: "task-versions",
        state: "comparable",
        cohortId: "rub-a@1",
        valueA: 61,
        valueB: 55,
        delta: 6,
        outcome: "win",
        versionsA: [1],
        versionsB: [2],
        changedTaskVersion: true,
      }),
    ],
    meanDelta: 4.2,
    bootstrap: {
      interval: { lower: 1.1, upper: 7.3, level: 0.95 },
      coverageState: { state: "sufficient", unitCount: 6 },
      seed: "seed-1",
      unitCount: 6,
      omittedUnitIds: [],
      resamples: 2000,
      uncertaintyRuleVersion: 1,
      aggregationRuleVersion: 1,
      assignmentDigest: "9a2f4c",
    },
    uncertaintyResolution: {
      uncertaintyRuleVersion: 1,
      assignmentDigest: "9a2f4c",
      units: [],
      unitCount: 6,
      fallbackAssumption:
        "No higher-order dependency is encoded; Task identity is the resampling unit.",
      disclosures: [],
    },
    cohortResults: [],
    disclosures: ["Shared-task coverage excludes incompatible cohorts."],
  };
}

function renderSection(props: {
  comparator?: PairedComparatorIdentity | null;
  result?: PairedComparisonResult | null;
  onSelect?: (id: string) => void;
  onRemove?: () => void;
  onTaskNarrowing?: (taskId: string) => void;
}) {
  return render(
    <PairedComparisonSection
      subjectConfigurationId="mc-subject"
      candidates={CANDIDATES}
      comparator={props.comparator ?? null}
      result={props.result ?? null}
      onSelectComparator={props.onSelect ?? (() => {})}
      onRemoveComparator={props.onRemove ?? (() => {})}
      onTaskNarrowing={props.onTaskNarrowing}
    />,
  );
}

function makeProfileData(): ProfileData {
  return {
    identity: {
      modelConfigurationId: "mc-subject",
      providerId: "openai",
      requestedModel: "gpt-5.6-sol",
      versionStatus: "exact",
      aggregationRuleVersion: 1,
      uncertaintyRuleVersion: 1,
      eligibilityRuleVersion: 1,
    },
    coverage: {
      uniqueTasks: { state: "available", value: 8 },
      taskVersions: { state: "available", value: 8 },
      taskInstances: { state: "available", value: 8 },
      activeObservations: { state: "available", value: 8 },
      acceptedCandidateResponses: { state: "available", value: 8 },
      attempts: { state: "available", value: 12 },
      plannedReplicates: { state: "available", value: 0 },
      resolvedIndependentUncertaintyUnits: { state: "unavailable", reason: "Not assigned." },
      uncertaintyUnitKind: { state: "unavailable", reason: "Not assigned." },
      uncertaintyAssumption: { state: "unavailable", reason: "Not assigned." },
      comparabilityCohorts: { state: "available", value: 1 },
      rubricVersions: { state: "available", value: 1 },
      evaluatorConfigurations: { state: "available", value: 1 },
      earliestObservation: { state: "unavailable", reason: "None." },
      latestObservation: { state: "unavailable", reason: "None." },
      missingCells: { state: "available", value: 0 },
      inMetricsEvidenceClassSplit: {
        exploratory: 0,
        comparable: 8,
        verified: 0,
        benchmark_anchor: 0,
      },
      consideredEvidenceClassSplit: {
        exploratory: 0,
        comparable: 8,
        verified: 0,
        benchmark_anchor: 0,
      },
      inMetricsEligibilityStatusSplit: { eligible: 8, provisional: 0, excluded: 0 },
      consideredEligibilityStatusSplit: { eligible: 8, provisional: 0, excluded: 0 },
      sourceKindSplit: { comparison: 8, evaluation: 0 },
      identityCompleteness: "exact",
      limitationReasons: {},
    },
    narrative: [],
    claims: [],
    families: [],
    verifiedOutcomes: [],
    evidenceRows: [],
  };
}

describe("PairedComparisonSection — Fable §7.5 state 1 (no comparator)", () => {
  it("renders the empty-block copy and a min-h-44 Select comparator trigger", () => {
    const h = renderSection({});
    expect(h.$("[data-section=paired]")).not.toBeNull();
    expect(h.$("[data-paired-state=no-comparator]")).not.toBeNull();
    expect(h.text()).toContain(
      "Pair this configuration against one you select. Pairing uses shared eligible tasks only.",
    );
    const trigger = h.$("button[data-comparator-trigger]")!;
    expect(trigger.textContent).toBe("Select comparator");
    expect(trigger.className).toMatch(/min-h-\[44px\]/);
    cleanup(h);
  });

  it("opens ComparatorPicker as a DialogSurface ordered by shared-task overlap (D7)", async () => {
    const h = renderSection({});
    act(() => {
      h.$("button[data-comparator-trigger]")!.click();
    });
    await settle();
    expect(document.body.querySelector("[data-dialog-backdrop]")).not.toBeNull();
    expect(document.body.textContent).toContain("Ordered by shared-task overlap, not quality.");
    const rows = [...document.body.querySelectorAll<HTMLElement>("[data-comparator-candidate]")];
    expect(rows.map((r) => r.dataset.candidateId)).toEqual(["mc-high", "mc-mid", "mc-low"]);
    cleanup(h);
  });

  it("Escape closes the picker and restores focus to Select comparator", async () => {
    const h = renderSection({});
    const trigger = h.$("button[data-comparator-trigger]")!;
    act(() => {
      trigger.focus();
      trigger.click();
    });
    await settle();
    expect(document.body.querySelector("[role=dialog]")).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(document.body.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    cleanup(h);
  });

  it("selecting a candidate reports exactly one comparator id", async () => {
    const onSelect = vi.fn();
    const h = renderSection({ onSelect });
    act(() => {
      h.$("button[data-comparator-trigger]")!.click();
    });
    await settle();
    act(() => {
      document.body.querySelector<HTMLElement>("[data-candidate-id=mc-high]")!.click();
    });
    await settle();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("mc-high");
    cleanup(h);
  });
});

describe("PairedComparisonSection — Fable §7.5 state 2 (empty intersection)", () => {
  it("renders the §7.5 empty-intersection copy verbatim plus a removable chip", () => {
    const onRemove = vi.fn();
    const h = renderSection({
      comparator: COMPARATOR,
      result: emptyResult(),
      onRemove,
    });
    expect(h.$("[data-paired-state=empty-intersection]")).not.toBeNull();
    expect(h.text()).toContain(
      "No shared eligible tasks with slug-high. Pairing never compares unrelated task mixes.",
    );
    expect(h.$("[data-comparator-chip]")).not.toBeNull();
    const remove = h.$("[data-remove-comparator]")!;
    expect(remove).not.toBeNull();
    act(() => {
      remove.click();
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
    cleanup(h);
  });

  it("does not render a second comparator picker trigger while one is selected", () => {
    const h = renderSection({ comparator: COMPARATOR, result: emptyResult() });
    expect(h.$$("button[data-comparator-trigger]")).toHaveLength(0);
    expect(h.$$("[data-comparator-chip]")).toHaveLength(1);
    cleanup(h);
  });
});

describe("PairedComparisonSection — Fable §7.5 state 3 (results)", () => {
  it("renders coverage, glyph strip, count line, mean delta, disclosures, and the full delta table", () => {
    const h = renderSection({ comparator: COMPARATOR, result: resultsPayload() });
    expect(h.$("[data-paired-state=results]")).not.toBeNull();
    expect(h.$("[data-paired-coverage]")!.textContent).toBe(
      "12 shared tasks · 10 comparable · 2 incompatible cohorts · 1 missing here · 1 missing there",
    );
    expect(h.$("[data-paired-glyph-strip]")).not.toBeNull();
    expect(h.$("[data-paired-counts]")!.textContent).toBe("Won 6 · tied 2 · lost 4");
    expect(h.$("[data-mean-delta]")).not.toBeNull();
    expect(h.$("[data-mean-delta]")!.textContent).toContain("4.2");
    expect(h.$("[data-paired-disclosures]")!.textContent).toContain(
      "Shared-task coverage excludes incompatible cohorts.",
    );
    const rows = h.$$("[data-paired-task-row]");
    expect(rows.length).toBe(7);
    expect(h.$("[data-task-state=incompatible_cohort]")!.textContent).toContain(
      "incompatible cohort",
    );
    expect(h.$("[data-task-state=missing_in_a]")!.textContent).toContain("missing here");
    expect(h.$("[data-task-state=missing_in_b]")!.textContent).toContain("missing there");
    expect(h.text()).toContain("versions differ");
    cleanup(h);
  });

  it("keeps incompatible and missing rows instead of dropping them", () => {
    const h = renderSection({ comparator: COMPARATOR, result: resultsPayload() });
    const ids = h.$$("[data-paired-task-row]").map((r) => r.getAttribute("data-task-id"));
    expect(ids).toContain("task-incompat");
    expect(ids).toContain("task-missing-here");
    expect(ids).toContain("task-missing-there");
    expect(ids).toContain("task-win");
    cleanup(h);
  });

  it("renders InsufficientState in the mean-delta slot when coverage is below five units", () => {
    const result = resultsPayload();
    const insufficient: PairedComparisonResult = {
      ...result,
      meanDelta: 1.5,
      bootstrap: {
        interval: null,
        coverageState: { state: "insufficient", unitCount: 4, reason: "below five" },
        seed: "s",
        unitCount: 4,
        omittedUnitIds: [],
        resamples: 2000,
        uncertaintyRuleVersion: 1,
        aggregationRuleVersion: 1,
        assignmentDigest: "abcd",
      },
    };
    const h = renderSection({ comparator: COMPARATOR, result: insufficient });
    const slot = h.$("[data-mean-delta]")!;
    expect(slot.textContent).toContain("Insufficient independent coverage for an interval");
    expect(slot.textContent).not.toMatch(/±/);
    cleanup(h);
  });

  it("applies task narrowing from a paired row", () => {
    const onTaskNarrowing = vi.fn();
    const h = renderSection({
      comparator: COMPARATOR,
      result: resultsPayload(),
      onTaskNarrowing,
    });
    act(() => {
      h.$("[data-paired-task-narrowing]")!.click();
    });
    expect(onTaskNarrowing).toHaveBeenCalledWith("task-win");
    cleanup(h);
  });
});

describe("PairedComparisonSection — mounted on the profile (C4)", () => {
  it("ModelEvidenceProfile mounts section 5 in the no-comparator state by default", () => {
    const h = render(
      <MemoryRouter initialEntries={["/models/mc-subject"]}>
        <Routes>
          <Route
            path="/models/:modelConfigurationId"
            element={<ModelEvidenceProfile data={makeProfileData()} computing={false} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(h.$("[data-section=paired]")).not.toBeNull();
    expect(h.$("[data-paired-state=no-comparator]")).not.toBeNull();
    cleanup(h);
  });
});
