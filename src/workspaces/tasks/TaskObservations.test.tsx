// @vitest-environment happy-dom
//
// TaskObservations tests — Child 04 (Observations, Eligibility, and Evidence Provenance)
// Milestone D, Task 11 (RED first).
//
// Covers the Task observations contract from observations-and-evidence spec §12.2:
//   - Group by Task Version and Instance
//   - Filter by model configuration, class, eligibility, allowed use, cohort, source, date
//   - Paginate via the evidence repository / client-side pagination
//   - Honest counts distinguishing Tasks, versions, instances, active observations,
//     selected attempts, and all attempts (no inflation)
//   - Disclosures of unknown model versions and legacy provenance
//   - Deep links to exact Observation, source Record, Task Version, and Rubric
//   - Filter state persistence across navigation / URL search params
//   - FusionObservation invariant: FusionStudy observations are never listed as Task Observations
//   - Same-component navigation regression test across task changes
//
// Uses the repo's happy-dom createRoot/act harness — no testing-library.

import * as fs from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { InMemoryEvidenceRepository } from "../../lib/persistence/evidence-repository";
import {
  OBSERVATION_SCHEMA_VERSION,
  type AssessmentRef,
  type EligibilityDecision,
  type EvidenceClass,
  type EvidenceReasonCode,
  type EvidenceUse,
  type ModelConfigurationSnapshot,
  type Observation,
} from "../../lib/evidence/evidence-types";
import { canonicalizeModelConfiguration } from "../../lib/evidence/model-configuration";
import { observationIdFor } from "../../lib/evidence/evidence-validation";
import { TaskObservations } from "./TaskObservations";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- Fixtures -----------------------------------------------------------------

const NOW = 1_700_000_000_000;
const COHORT_1 = `sha256:${"1".repeat(64)}`;
const COHORT_2 = `sha256:${"2".repeat(64)}`;

function makeModelConfig(
  providerId = "anthropic",
  requestedModel = "claude-3-5-sonnet",
  resolvedModel: string | null = requestedModel,
  resolvedVersion: string | null = "2024-10-01",
): ModelConfigurationSnapshot {
  const result = canonicalizeModelConfiguration({
    providerId,
    requestedModel,
    resolvedModel,
    resolvedVersion,
    observedAt: NOW,
    runtimeSettings: {},
  });
  if (!result.ok) throw new Error(`Model configuration failed: ${result.reason}`);
  return result.snapshot;
}

function makeAssessmentRef(
  judgeAttemptId = "judge-att-1",
  overrides: Partial<AssessmentRef> = {},
): AssessmentRef {
  return {
    judgeAttemptId,
    judgeProviderId: "anthropic",
    judgeModel: "claude-3-5-sonnet",
    blindLabelMapping: { A: "cand-1" },
    candidateAttemptIdsByCandidateId: { "cand-1": `cand-att-${judgeAttemptId}` },
    rubricRef: { id: "rubric-std", version: 1 },
    verifierRef: null,
    verifierOutcome: null,
    ...overrides,
  };
}

function makeObservation(
  taskId: string,
  taskVersion: number,
  taskInstanceId: string,
  modelConfigurationId: string,
  overrides: Partial<Observation> = {},
): Observation {
  const suffix =
    overrides.sourceResultId ?? `${taskId}-${taskInstanceId}-${modelConfigurationId.slice(-6)}`;
  const base: Observation = {
    id: "",
    sourceKind: "evaluation",
    sourceResultId: `run-${suffix}`,
    executionLineageId: `lin-${taskId}-${taskInstanceId}`,
    runId: `run-${suffix}`,
    sourceTaskCellId: `cell-${taskId}-${taskInstanceId}`,
    taskId,
    taskVersion,
    taskInstanceId,
    taskFamilyId: null,
    modelConfigurationId,
    candidateAttemptId: `cand-att-${suffix}`,
    assessmentRef: makeAssessmentRef(`judge-att-${suffix}`),
    protocolFingerprint: `sha256:${"2".repeat(64)}`,
    rubricRef: { id: "rubric-std", version: 1 },
    evaluatorSnapshot: {
      kind: "model_judge",
      providerId: "anthropic",
      model: "claude-3-5-sonnet",
      resolvedVersion: "2024-10-22",
      instructionDigest: `sha256:${"3".repeat(64)}`,
      reasoningEffort: null,
      toolScaffoldSignature: null,
    },
    verifierSnapshot: null,
    outcome: {
      judgeAccepted: true,
      overallScore: 0.85,
      criterionValues: [{ criterionId: "c1", value: 4 }],
      verifierPassed: null,
    },
    observedAt: NOW,
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    ...overrides,
  };
  if (base.id === "") {
    base.id = observationIdFor(base);
  }
  return base;
}

function makeDecision(
  observationId: string,
  evidenceClass: EvidenceClass = "comparable",
  status: EligibilityDecision["status"] = "eligible",
  allowedUses: EvidenceUse[] = [
    "task_descriptive",
    "within_model_profile",
    "paired_model_comparison",
  ],
  reasonCodes: EvidenceReasonCode[] = [
    "canonical_task_resolved",
    "candidate_selected_completed",
    "assessment_selected_completed",
    "protocol_complete",
    "model_configuration_exact",
  ],
  comparabilityCohortId = `sha256:${"5".repeat(64)}`,
): EligibilityDecision {
  return {
    observationId,
    ruleVersion: 1,
    status,
    evidenceClass,
    allowedUses,
    reasonCodes,
    comparabilityCohortId,
    decidedAt: NOW,
  };
}

// --- Harness ------------------------------------------------------------------

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function render(node: React.ReactNode, opts: { initialEntries?: string[] } = {}): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={opts.initialEntries ?? ["/tasks/t-1"]}>{node}</MemoryRouter>,
    );
  });
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => Array.from(container.querySelectorAll<HTMLElement>(s)),
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

async function settle(turns = 5) {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

afterEach(() => {
  document.body.innerHTML = "";
});

// --- Tests --------------------------------------------------------------------

describe("TaskObservations — Section rendering and empty state", () => {
  it("renders observations section with honest empty state when no observations exist", async () => {
    const repo = new InMemoryEvidenceRepository();
    const h = render(<TaskObservations taskId="t-empty" evidenceRepo={repo} />);
    await settle();

    expect(h.$("[data-task-observations-section]")).toBeTruthy();
    expect(h.container.textContent).toMatch(/Observations/i);
    expect(h.$("[data-observations-empty]")).toBeTruthy();
    expect(h.container.textContent).toMatch(/No observations recorded for this task/i);

    // Honest counts present even in empty state
    expect(h.$("[data-count-tasks]")?.textContent).toContain("1");
    expect(h.$("[data-count-versions]")?.textContent).toContain("0");
    expect(h.$("[data-count-instances]")?.textContent).toContain("0");
    expect(h.$("[data-count-active-observations]")?.textContent).toContain("0");
    expect(h.$("[data-count-selected-attempts]")?.textContent).toContain("0");
    expect(h.$("[data-count-all-attempts]")?.textContent).toContain("0");

    cleanup(h);
  });

  it("handles repository load failure gracefully with a retry button", async () => {
    const repo = new InMemoryEvidenceRepository();
    repo.listObservationsByTask = async () => {
      throw new Error("Simulated storage error");
    };

    const h = render(<TaskObservations taskId="t-err" evidenceRepo={repo} />);
    await settle();

    expect(h.$("[data-task-observations-error]")).toBeTruthy();
    expect(h.container.textContent).toMatch(/Failed to load observations/i);
    expect(h.$("button[data-retry-button]")).toBeTruthy();

    cleanup(h);
  });
});

describe("TaskObservations — Grouping by Version and Instance", () => {
  it("groups observations by Task Version and Task Instance", async () => {
    const repo = new InMemoryEvidenceRepository();

    const m1 = makeModelConfig("anthropic", "claude-3-5-sonnet");
    const m2 = makeModelConfig("openai", "gpt-4o");
    await repo.putModelConfiguration(m1);
    await repo.putModelConfiguration(m2);

    // Task v1, instance inst-1: 2 observations (claude, gpt4o)
    const o1 = makeObservation("t-1", 1, "inst-1", m1.id, { sourceResultId: "res-1" });
    const o2 = makeObservation("t-1", 1, "inst-1", m2.id, { sourceResultId: "res-2" });
    // Task v1, instance inst-2: 1 observation
    const o3 = makeObservation("t-1", 1, "inst-2", m1.id, { sourceResultId: "res-3" });
    // Task v2, instance inst-3: 1 observation
    const o4 = makeObservation("t-1", 2, "inst-3", m2.id, { sourceResultId: "res-4" });

    await repo.putObservation(o1);
    await repo.putObservation(o2);
    await repo.putObservation(o3);
    await repo.putObservation(o4);

    await repo.putDecision(makeDecision(o1.id));
    await repo.putDecision(makeDecision(o2.id));
    await repo.putDecision(makeDecision(o3.id));
    await repo.putDecision(makeDecision(o4.id));

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    // Verify version groups exist
    expect(h.$('[data-version-group="1"]')).toBeTruthy();
    expect(h.$('[data-version-group="2"]')).toBeTruthy();

    // Verify instance groups exist inside version 1
    expect(h.$('[data-instance-group="inst-1"]')).toBeTruthy();
    expect(h.$('[data-instance-group="inst-2"]')).toBeTruthy();
    expect(h.$('[data-instance-group="inst-3"]')).toBeTruthy();

    // Verify all 4 observation rows are rendered
    expect(h.$$("[data-observation-row]").length).toBe(4);

    cleanup(h);
  });

  it("scopes observations to the specified version when version prop is provided", async () => {
    const repo = new InMemoryEvidenceRepository();
    const m1 = makeModelConfig("anthropic", "claude-3-5-sonnet");
    await repo.putModelConfiguration(m1);

    const o1 = makeObservation("t-1", 1, "inst-1", m1.id, { sourceResultId: "res-v1" });
    const o2 = makeObservation("t-1", 2, "inst-2", m1.id, { sourceResultId: "res-v2" });
    await repo.putObservation(o1);
    await repo.putObservation(o2);
    await repo.putDecision(makeDecision(o1.id));
    await repo.putDecision(makeDecision(o2.id));

    const h = render(<TaskObservations taskId="t-1" version={2} evidenceRepo={repo} />);
    await settle();

    // Only version 2 group is present
    expect(h.$('[data-version-group="1"]')).toBeNull();
    expect(h.$('[data-version-group="2"]')).toBeTruthy();
    expect(h.$$("[data-observation-row]").length).toBe(1);
    expect(h.container.textContent).toContain(o2.id);
    expect(h.container.textContent).not.toContain(o1.id);

    cleanup(h);
  });
});

describe("TaskObservations — Honest counts differentiation", () => {
  it("differentiates Tasks, versions, instances, active observations, selected attempts, and all attempts", async () => {
    const repo = new InMemoryEvidenceRepository();
    const m1 = makeModelConfig("anthropic", "claude-3-5-sonnet");
    await repo.putModelConfiguration(m1);

    // 2 versions, 3 instances, 3 observations, 3 selected attempts
    const o1 = makeObservation("t-1", 1, "inst-1", m1.id, {
      candidateAttemptId: "cand-1",
      sourceResultId: "res-1",
    });
    const o2 = makeObservation("t-1", 1, "inst-2", m1.id, {
      candidateAttemptId: "cand-2",
      sourceResultId: "res-2",
    });
    const o3 = makeObservation("t-1", 2, "inst-3", m1.id, {
      candidateAttemptId: "cand-3",
      sourceResultId: "res-3",
    });

    await repo.putObservation(o1);
    await repo.putObservation(o2);
    await repo.putObservation(o3);
    await repo.putDecision(makeDecision(o1.id));
    await repo.putDecision(makeDecision(o2.id));
    await repo.putDecision(makeDecision(o3.id));

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    expect(h.$("[data-count-tasks]")?.textContent).toContain("1");
    expect(h.$("[data-count-versions]")?.textContent).toContain("2");
    expect(h.$("[data-count-instances]")?.textContent).toContain("3");
    expect(h.$("[data-count-active-observations]")?.textContent).toContain("3");
    expect(h.$("[data-count-selected-attempts]")?.textContent).toContain("3");
    expect(h.$("[data-count-all-attempts]")?.textContent).toContain("3");

    cleanup(h);
  });
});

describe("TaskObservations — Filtering", () => {
  async function setupFilteredDataset(repo: InMemoryEvidenceRepository) {
    const mClaude = makeModelConfig(
      "anthropic",
      "claude-3-5-sonnet",
      "claude-3-5-sonnet-20241022",
      "2024-10-22",
    );
    const mGpt = makeModelConfig("openai", "gpt-4o", "gpt-4o-2024-08-06", "2024-08-06");
    const mUnknown = makeModelConfig("custom", "custom-model", null, null);

    await repo.putModelConfiguration(mClaude);
    await repo.putModelConfiguration(mGpt);
    await repo.putModelConfiguration(mUnknown);

    const o1 = makeObservation("t-1", 1, "inst-1", mClaude.id, {
      sourceKind: "evaluation",
      observedAt: NOW - 50_000,
      sourceResultId: "res-filter-1",
      protocolFingerprint: `sha256:${"1".repeat(64)}`,
    });
    const o2 = makeObservation("t-1", 1, "inst-1", mGpt.id, {
      sourceKind: "evaluation",
      observedAt: NOW - 20_000,
      sourceResultId: "res-filter-2",
      protocolFingerprint: `sha256:${"1".repeat(64)}`,
    });
    const o3 = makeObservation("t-1", 1, "inst-2", mUnknown.id, {
      sourceKind: "comparison",
      observedAt: NOW,
      sourceResultId: "res-filter-3",
      protocolFingerprint: `sha256:${"2".repeat(64)}`,
    });

    await repo.putObservation(o1);
    await repo.putObservation(o2);
    await repo.putObservation(o3);

    // o1: comparable, eligible, paired_model_comparison, cohort-1
    await repo.putDecision(
      makeDecision(
        o1.id,
        "comparable",
        "eligible",
        ["task_descriptive", "within_model_profile", "paired_model_comparison"],
        ["canonical_task_resolved", "model_configuration_exact"],
        COHORT_1,
      ),
    );
    // o2: verified, provisional, within_model_profile, cohort-1
    await repo.putDecision(
      makeDecision(
        o2.id,
        "verified",
        "provisional",
        ["task_descriptive", "within_model_profile"],
        ["canonical_task_resolved", "verifier_passed"],
        COHORT_1,
      ),
    );
    // o3: exploratory, excluded, [], cohort-2
    await repo.putDecision(
      makeDecision(
        o3.id,
        "exploratory",
        "excluded",
        [],
        ["canonical_task_unresolved", "model_version_unreported", "source_legacy_limited"],
        COHORT_2,
      ),
    );

    return { mClaude, mGpt, mUnknown, o1, o2, o3 };
  }

  it("filters observations by model configuration", async () => {
    const repo = new InMemoryEvidenceRepository();
    const { mClaude, o1, o2, o3 } = await setupFilteredDataset(repo);

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    expect(h.$$("[data-observation-row]").length).toBe(3);

    // Select claude model filter
    const modelSelect = h.$("select[data-filter-model]") as HTMLSelectElement;
    expect(modelSelect).toBeTruthy();
    act(() => {
      modelSelect.value = mClaude.id;
      modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(h.$$("[data-observation-row]").length).toBe(1);
    expect(h.container.textContent).toContain(o1.id);
    expect(h.container.textContent).not.toContain(o2.id);
    expect(h.container.textContent).not.toContain(o3.id);

    cleanup(h);
  });

  it("filters observations by evidence class", async () => {
    const repo = new InMemoryEvidenceRepository();
    const { o2 } = await setupFilteredDataset(repo);

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    const classSelect = h.$("select[data-filter-class]") as HTMLSelectElement;
    expect(classSelect).toBeTruthy();
    act(() => {
      classSelect.value = "verified";
      classSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(h.$$("[data-observation-row]").length).toBe(1);
    expect(h.container.textContent).toContain(o2.id);

    cleanup(h);
  });

  it("filters observations by eligibility status", async () => {
    const repo = new InMemoryEvidenceRepository();
    const { o3 } = await setupFilteredDataset(repo);

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    const statusSelect = h.$("select[data-filter-status]") as HTMLSelectElement;
    expect(statusSelect).toBeTruthy();
    act(() => {
      statusSelect.value = "excluded";
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(h.$$("[data-observation-row]").length).toBe(1);
    expect(h.container.textContent).toContain(o3.id);

    cleanup(h);
  });

  it("filters observations by allowed use", async () => {
    const repo = new InMemoryEvidenceRepository();
    const { o1 } = await setupFilteredDataset(repo);

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    const useSelect = h.$("select[data-filter-use]") as HTMLSelectElement;
    expect(useSelect).toBeTruthy();
    act(() => {
      useSelect.value = "paired_model_comparison";
      useSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(h.$$("[data-observation-row]").length).toBe(1);
    expect(h.container.textContent).toContain(o1.id);

    cleanup(h);
  });

  it("filters observations by cohort", async () => {
    const repo = new InMemoryEvidenceRepository();
    const { o3 } = await setupFilteredDataset(repo);

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    const cohortSelect = h.$("select[data-filter-cohort]") as HTMLSelectElement;
    expect(cohortSelect).toBeTruthy();
    act(() => {
      cohortSelect.value = COHORT_2;
      cohortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(h.$$("[data-observation-row]").length).toBe(1);
    expect(h.container.textContent).toContain(o3.id);

    cleanup(h);
  });

  it("filters observations by source kind", async () => {
    const repo = new InMemoryEvidenceRepository();
    const { o3 } = await setupFilteredDataset(repo);

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    const sourceSelect = h.$("select[data-filter-source]") as HTMLSelectElement;
    expect(sourceSelect).toBeTruthy();
    act(() => {
      sourceSelect.value = "comparison";
      sourceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(h.$$("[data-observation-row]").length).toBe(1);
    expect(h.container.textContent).toContain(o3.id);

    cleanup(h);
  });

  it("filters observations by date range", async () => {
    const repo = new InMemoryEvidenceRepository();
    await setupFilteredDataset(repo);

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    // The dataset has observations at NOW - 50_000, NOW - 20_000, and NOW.
    // Filter from date of NOW
    const dateInput = h.$("input[data-filter-date-from]") as HTMLInputElement;
    expect(dateInput).toBeTruthy();
    act(() => {
      dateInput.value = new Date(NOW).toISOString().slice(0, 10);
      dateInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    // All 3 fall on today's date
    expect(h.$$("[data-observation-row]").length).toBe(3);

    cleanup(h);
  });

  it("resets filters when clicking Clear Filters", async () => {
    const repo = new InMemoryEvidenceRepository();
    await setupFilteredDataset(repo);

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    const classSelect = h.$("select[data-filter-class]") as HTMLSelectElement;
    act(() => {
      classSelect.value = "exploratory";
      classSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(h.$$("[data-observation-row]").length).toBe(1);

    const clearBtn = h.$("button[data-clear-filters]") as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();
    act(() => {
      clearBtn.click();
    });
    await settle();

    expect(h.$$("[data-observation-row]").length).toBe(3);

    cleanup(h);
  });
});

describe("TaskObservations — Pagination", () => {
  it("paginates observations deterministically with next and previous controls", async () => {
    const repo = new InMemoryEvidenceRepository();
    const m = makeModelConfig("openai", "gpt-4o");
    await repo.putModelConfiguration(m);

    // Create 15 observations
    for (let i = 1; i <= 15; i++) {
      const pad = String(i).padStart(2, "0");
      const obs = makeObservation("t-1", 1, `inst-${pad}`, m.id, {
        sourceResultId: `res-page-${pad}`,
        observedAt: NOW - (15 - i) * 1000,
      });
      await repo.putObservation(obs);
      await repo.putDecision(makeDecision(obs.id));
    }

    const h = render(<TaskObservations taskId="t-1" pageSize={10} evidenceRepo={repo} />);
    await settle();

    expect(h.$("[data-pagination-info]")?.textContent).toMatch(/1[–-]10 of 15/i);
    expect(h.$$("[data-observation-row]").length).toBe(10);

    const nextBtn = h.$("button[data-pagination-next]") as HTMLButtonElement;
    expect(nextBtn).toBeTruthy();
    expect(nextBtn.disabled).toBe(false);

    act(() => {
      nextBtn.click();
    });
    await settle();

    expect(h.$("[data-pagination-info]")?.textContent).toMatch(/11[–-]15 of 15/i);
    expect(h.$$("[data-observation-row]").length).toBe(5);

    const prevBtn = h.$("button[data-pagination-prev]") as HTMLButtonElement;
    expect(prevBtn).toBeTruthy();
    expect(prevBtn.disabled).toBe(false);

    act(() => {
      prevBtn.click();
    });
    await settle();

    expect(h.$("[data-pagination-info]")?.textContent).toMatch(/1[–-]10 of 15/i);
    expect(h.$$("[data-observation-row]").length).toBe(10);

    cleanup(h);
  });
});

describe("TaskObservations — Disclosures of unknown and legacy provenance", () => {
  it("discloses unknown model version, partial identity completeness, and legacy limitations accessibly", async () => {
    const repo = new InMemoryEvidenceRepository();
    const mUnknown = makeModelConfig("custom", "unreported-model", null, null);
    await repo.putModelConfiguration(mUnknown);

    const obs = makeObservation("t-1", 1, "inst-1", mUnknown.id, {
      sourceResultId: "res-partial",
    });
    await repo.putObservation(obs);
    await repo.putDecision(
      makeDecision(
        obs.id,
        "exploratory",
        "excluded",
        [],
        ["model_version_unreported", "source_legacy_limited"],
      ),
    );

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    const row = h.$(`[data-observation-row="${obs.id}"]`);
    expect(row).toBeTruthy();

    // Check accessible disclosures exist in text (not color/badge alone)
    expect(row?.textContent).toMatch(/unreported version/i);
    expect(row?.textContent).toMatch(/partial/i);
    expect(row?.textContent).toMatch(/legacy/i);

    cleanup(h);
  });
});

describe("TaskObservations — Deep links to exact Observation and source Record", () => {
  it("renders deep links to exact Observation, source Record, Task Version, and Rubric", async () => {
    const repo = new InMemoryEvidenceRepository();
    const m = makeModelConfig("anthropic", "claude-3-5-sonnet");
    await repo.putModelConfiguration(m);

    const obs = makeObservation("t-1", 2, "inst-5", m.id, {
      sourceResultId: "eval-run-999",
      candidateAttemptId: "cand-attempt-888",
      assessmentRef: {
        judgeAttemptId: "judge-attempt-777",
        judgeProviderId: "anthropic",
        judgeModel: "claude-3-5-sonnet",
        blindLabelMapping: { A: "cand-1" },
        candidateAttemptIdsByCandidateId: { "cand-1": "cand-attempt-888" },
        rubricRef: { id: "rubric-custom", version: 3 },
        verifierRef: null,
        verifierOutcome: null,
      },
      rubricRef: { id: "rubric-custom", version: 3 },
    });
    await repo.putObservation(obs);
    await repo.putDecision(makeDecision(obs.id));

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    const row = h.$(`[data-observation-row="${obs.id}"]`);
    expect(row).toBeTruthy();

    // Deep link to source record
    const recordLink = row?.querySelector<HTMLAnchorElement>("a[data-link-record]");
    expect(recordLink).toBeTruthy();
    expect(recordLink?.getAttribute("href")).toContain("/runs/eval-run-999");

    // Deep link to task version
    const versionLink = row?.querySelector<HTMLAnchorElement>("a[data-link-version]");
    expect(versionLink).toBeTruthy();
    expect(versionLink?.getAttribute("href")).toBe("/tasks/t-1/versions/2");

    // Deep link to rubric
    const rubricLink = row?.querySelector<HTMLAnchorElement>("a[data-link-rubric]");
    expect(rubricLink).toBeTruthy();
    expect(rubricLink?.getAttribute("href")).toBe("/evaluations/rubrics/rubric-custom");

    cleanup(h);
  });

  it("formats source record deep link with URLSearchParams, omits attempt when null, and encodes URI components", async () => {
    const repo = new InMemoryEvidenceRepository();
    const m = makeModelConfig("anthropic", "claude-3-5-sonnet");
    await repo.putModelConfiguration(m);

    // Observation A with special characters in IDs and valid judgeAttemptId
    const obsA = makeObservation("t-1", 1, "inst-1", m.id, {
      sourceResultId: "run#special/id",
      candidateAttemptId: "cand#1/alpha",
      assessmentRef: makeAssessmentRef("judge#att&1"),
    });
    await repo.putObservation(obsA);
    await repo.putDecision(makeDecision(obsA.id));

    // Observation B with null judgeAttemptId
    const obsB: Observation = {
      ...obsA,
      id: "obs-no-judge",
      taskInstanceId: "inst-2",
      candidateAttemptId: "cand-2",
      assessmentRef: {
        ...obsA.assessmentRef,
        judgeAttemptId: null as unknown as string,
      },
    };

    repo.listObservationsByTask = async () => [obsA, obsB];

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    // Verify obsA link encoding
    const rowA = h.$(`[data-observation-row="${obsA.id}"]`);
    const recordLinkA = rowA?.querySelector<HTMLAnchorElement>("a[data-link-record]");
    expect(recordLinkA).toBeTruthy();
    expect(recordLinkA?.getAttribute("href")).toBe(
      "/runs/run%23special%2Fid?candidate=cand%231%2Falpha&attempt=judge%23att%261",
    );

    // Verify obsB link omits attempt parameter
    const rowB = h.$(`[data-observation-row="${obsB.id}"]`);
    const recordLinkB = rowB?.querySelector<HTMLAnchorElement>("a[data-link-record]");
    expect(recordLinkB).toBeTruthy();
    expect(recordLinkB?.getAttribute("href")).toBe(
      "/runs/run%23special%2Fid?candidate=cand-2",
    );

    cleanup(h);
  });
});

describe("TaskObservations — Navigation and URL filter preservation", () => {
  it("initializes filters from URL search params and updates URL on filter changes", async () => {
    const repo = new InMemoryEvidenceRepository();
    const m1 = makeModelConfig("anthropic", "claude-3-5-sonnet");
    const m2 = makeModelConfig("openai", "gpt-4o");
    await repo.putModelConfiguration(m1);
    await repo.putModelConfiguration(m2);

    const o1 = makeObservation("t-1", 1, "inst-1", m1.id, { sourceResultId: "res-nav-1" });
    const o2 = makeObservation("t-1", 1, "inst-1", m2.id, { sourceResultId: "res-nav-2" });
    await repo.putObservation(o1);
    await repo.putObservation(o2);
    await repo.putDecision(makeDecision(o1.id, "comparable", "eligible"));
    await repo.putDecision(makeDecision(o2.id, "verified", "provisional"));

    let capturedSearch = "";
    function LocationInspector() {
      const loc = useLocation();
      capturedSearch = loc.search;
      return null;
    }

    const h = render(
      <>
        <LocationInspector />
        <TaskObservations taskId="t-1" evidenceRepo={repo} />
      </>,
      { initialEntries: ["/tasks/t-1?obs_class=comparable"] },
    );
    await settle();

    // Filter initialized from URL
    expect(h.$$("[data-observation-row]").length).toBe(1);
    expect(h.container.textContent).toContain(o1.id);

    // Change filter updates search params
    const statusSelect = h.$("select[data-filter-status]") as HTMLSelectElement;
    act(() => {
      statusSelect.value = "eligible";
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(capturedSearch).toContain("obs_class=comparable");
    expect(capturedSearch).toContain("obs_status=eligible");

    cleanup(h);
  });
});

describe("TaskObservations — FusionStudy invariant", () => {
  it("never lists FusionStudy observations as Task Observations", async () => {
    const repo = new InMemoryEvidenceRepository();
    const m = makeModelConfig("anthropic", "claude-3-5-sonnet");
    await repo.putModelConfiguration(m);

    const canonicalObs = makeObservation("t-1", 1, "inst-1", m.id, {
      sourceResultId: "res-fusion-check",
    });
    await repo.putObservation(canonicalObs);
    await repo.putDecision(makeDecision(canonicalObs.id));

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    expect(h.$$("[data-observation-row]").length).toBe(1);
    expect(h.container.textContent).toContain(canonicalObs.id);
    expect(h.container.textContent).not.toMatch(/FusionObservation/i);

    cleanup(h);
  });
});

describe("TaskObservations — Same-component route transitions regression", () => {
  it("clears previous task observations and loads new task observations when taskId changes on same mounted component", async () => {
    const repo = new InMemoryEvidenceRepository();
    const m = makeModelConfig("anthropic", "claude-3-5-sonnet");
    await repo.putModelConfiguration(m);

    const oTask1 = makeObservation("t-1", 1, "inst-1", m.id, { sourceResultId: "res-task-1" });
    const oTask2 = makeObservation("t-2", 1, "inst-2", m.id, { sourceResultId: "res-task-2" });
    await repo.putObservation(oTask1);
    await repo.putObservation(oTask2);
    await repo.putDecision(makeDecision(oTask1.id));
    await repo.putDecision(makeDecision(oTask2.id));

    function RouteWrapper() {
      const loc = useLocation();
      const nav = useNavigate();
      const currentTaskId = loc.pathname.includes("t-2") ? "t-2" : "t-1";
      return (
        <div>
          <button type="button" data-nav-t2 onClick={() => nav("/tasks/t-2")}>
            Go to T2
          </button>
          <TaskObservations taskId={currentTaskId} evidenceRepo={repo} />
        </div>
      );
    }

    const h = render(
      <Routes>
        <Route path="/tasks/:taskId" element={<RouteWrapper />} />
      </Routes>,
      { initialEntries: ["/tasks/t-1"] },
    );
    await settle();

    // Initially shows task 1 observation
    expect(h.container.textContent).toContain(oTask1.id);
    expect(h.container.textContent).not.toContain(oTask2.id);

    // Navigate to task 2
    const btn = h.$("button[data-nav-t2]") as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    await settle();

    // Now shows task 2 observation, task 1 observation is gone
    expect(h.container.textContent).toContain(oTask2.id);
    expect(h.container.textContent).not.toContain(oTask1.id);

    cleanup(h);
  });

  it("does not leak stale observations or counts from previous taskId on synchronous render when taskId changes", async () => {
    const repo = new InMemoryEvidenceRepository();
    const m = makeModelConfig("anthropic", "claude-3-5-sonnet");
    await repo.putModelConfiguration(m);

    const oTask1A = makeObservation("t-1", 1, "inst-1", m.id, { sourceResultId: "res-task-1a" });
    const oTask1B = makeObservation("t-1", 1, "inst-2", m.id, { sourceResultId: "res-task-1b" });
    const oTask2 = makeObservation("t-2", 1, "inst-1", m.id, { sourceResultId: "res-task-2" });
    await repo.putObservation(oTask1A);
    await repo.putObservation(oTask1B);
    await repo.putObservation(oTask2);
    await repo.putDecision(makeDecision(oTask1A.id));
    await repo.putDecision(makeDecision(oTask1B.id));
    await repo.putDecision(makeDecision(oTask2.id));

    function RouteWrapper() {
      const loc = useLocation();
      const nav = useNavigate();
      const currentTaskId = loc.pathname.includes("t-2") ? "t-2" : "t-1";
      return (
        <div>
          <button type="button" data-nav-t2 onClick={() => nav("/tasks/t-2")}>
            Go to T2
          </button>
          <TaskObservations taskId={currentTaskId} evidenceRepo={repo} />
        </div>
      );
    }

    const h = render(
      <Routes>
        <Route path="/tasks/:taskId" element={<RouteWrapper />} />
      </Routes>,
      { initialEntries: ["/tasks/t-1"] },
    );
    await settle();

    // Initially shows task 1 observations (count = 2)
    expect(h.$$("[data-observation-row]").length).toBe(2);
    expect(h.$("[data-count-active-observations]")?.textContent).toBe("2");
    expect(h.$("[data-count-instances]")?.textContent).toBe("2");

    // Trigger navigation to t-2
    const btn = h.$("button[data-nav-t2]") as HTMLButtonElement;
    act(() => {
      btn.click();
    });

    // Synchronous assert WITHOUT awaiting settle:
    // Stale t-1 observation rows and counts must NOT be visible under t-2; loading state must be shown and counts must be 0.
    expect(h.$$("[data-observation-row]").length).toBe(0);
    expect(h.$("[data-count-active-observations]")?.textContent).toBe("0");
    expect(h.$("[data-count-instances]")?.textContent).toBe("0");
    expect(h.container.textContent).not.toContain(oTask1A.id);
    expect(h.container.textContent).not.toContain(oTask1B.id);
    expect(h.$("[data-task-observations-loading]")).toBeTruthy();

    await settle();
    expect(h.container.textContent).toContain(oTask2.id);
    expect(h.$$("[data-observation-row]").length).toBe(1);
    expect(h.$("[data-count-active-observations]")?.textContent).toBe("1");

    cleanup(h);
  });
});

describe("TaskObservations — Accessibility and reduced motion", () => {
  it("covers .animate-spin under prefers-reduced-motion in index.css", () => {
    const css = fs.readFileSync("src/index.css", "utf8");
    const reducedMotionMatch = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^}]+)\}/);
    expect(reducedMotionMatch).toBeTruthy();
    const reducedMotionBody = reducedMotionMatch?.[1] ?? "";
    expect(reducedMotionBody).toContain(".animate-spin,");
  });

  it("renders filter controls in a fieldset with a legend for screen reader accessibility", async () => {
    const repo = new InMemoryEvidenceRepository();
    const m = makeModelConfig("anthropic", "claude-3-5-sonnet");
    await repo.putModelConfiguration(m);
    const o = makeObservation("t-1", 1, "inst-1", m.id);
    await repo.putObservation(o);
    await repo.putDecision(makeDecision(o.id));

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    const fieldset = h.$("fieldset");
    expect(fieldset).toBeTruthy();
    const legend = h.$("fieldset legend");
    expect(legend).toBeTruthy();
    expect(legend?.textContent).toMatch(/Filters/i);

    cleanup(h);
  });
});
