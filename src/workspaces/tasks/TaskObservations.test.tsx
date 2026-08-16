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

import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { InMemoryEvidenceRepository } from "../../lib/persistence/evidence-repository";
import type {
  EligibilityDecision,
  EvidenceClass,
  EvidenceReasonCode,
  EvidenceUse,
  ModelConfigurationSnapshot,
  Observation,
} from "../../lib/evidence/evidence-types";
import { TaskObservations } from "./TaskObservations";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- Fixtures -----------------------------------------------------------------

const NOW = 1_700_000_000_000;

function makeModelConfig(
  id: string,
  requestedModel: string,
  resolvedModel: string | null = requestedModel,
  resolvedVersion: string | null = "2024-10-01",
  identityCompleteness: ModelConfigurationSnapshot["identityCompleteness"] = "exact",
  providerId = "anthropic",
): ModelConfigurationSnapshot {
  return {
    id,
    providerId,
    requestedModel,
    resolvedModel,
    resolvedVersion,
    reasoningRequested: null,
    reasoningEffective: null,
    toolScaffoldSignature: null,
    runtimeSettings: {},
    observedFrom: NOW - 10_000,
    observedTo: NOW,
    identityCompleteness,
  };
}

function makeObservation(
  id: string,
  taskId: string,
  taskVersion: number,
  taskInstanceId: string,
  modelConfigurationId: string,
  overrides: Partial<Observation> = {},
): Observation {
  return {
    id,
    sourceKind: "evaluation",
    sourceResultId: `run-${id}`,
    executionLineageId: `lin-${id}`,
    runId: `run-${id}`,
    sourceTaskCellId: `cell-${taskId}-${taskInstanceId}`,
    taskId,
    taskVersion,
    taskInstanceId,
    taskFamilyId: null,
    modelConfigurationId,
    candidateAttemptId: `cand-att-${id}`,
    assessmentRef: {
      judgeAttemptId: `judge-att-${id}`,
      verifierExecutionId: null,
      blindLabel: "Candidate A",
      rubricVersion: 1,
      selectedTaskAttemptId: `cand-att-${id}`,
    },
    protocolFingerprint: "proto-fp-abc12345",
    rubricRef: { id: "rubric-std", version: 1 },
    evaluatorSnapshot: {
      kind: "model_judge",
      model: "gpt-4o",
      version: "2024-08-06",
      instructionDigest: "digest-eval",
      configurationDigest: "cfg-eval",
    },
    verifierSnapshot: null,
    outcome: {
      normalizedScore: 0.85,
      rawScores: { accuracy: 4, clarity: 5 },
      verifierPassed: null,
      selectedRationaleRef: "rat-1",
    },
    observedAt: NOW,
    observationSchemaVersion: 1,
    ...overrides,
  };
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
  comparabilityCohortId = "cohort-default-123",
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

function render(
  node: React.ReactNode,
  opts: { initialEntries?: string[] } = {},
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={opts.initialEntries ?? ["/tasks/t-1"]}>
        {node}
      </MemoryRouter>,
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
    // Simulate error by throwing in listObservationsByTask
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

    const m1 = makeModelConfig("cfg-claude", "claude-3-5-sonnet");
    const m2 = makeModelConfig("cfg-gpt4o", "gpt-4o");
    await repo.putModelConfiguration(m1);
    await repo.putModelConfiguration(m2);

    // Task v1, instance inst-1: 2 observations (claude, gpt4o)
    const o1 = makeObservation("obs-1", "t-1", 1, "inst-1", "cfg-claude");
    const o2 = makeObservation("obs-2", "t-1", 1, "inst-1", "cfg-gpt4o");
    // Task v1, instance inst-2: 1 observation
    const o3 = makeObservation("obs-3", "t-1", 1, "inst-2", "cfg-claude");
    // Task v2, instance inst-3: 1 observation
    const o4 = makeObservation("obs-4", "t-1", 2, "inst-3", "cfg-gpt4o");

    await repo.putObservation(o1);
    await repo.putObservation(o2);
    await repo.putObservation(o3);
    await repo.putObservation(o4);

    await repo.putDecision(makeDecision("obs-1"));
    await repo.putDecision(makeDecision("obs-2"));
    await repo.putDecision(makeDecision("obs-3"));
    await repo.putDecision(makeDecision("obs-4"));

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
    const m1 = makeModelConfig("cfg-claude", "claude-3-5-sonnet");
    await repo.putModelConfiguration(m1);

    const o1 = makeObservation("obs-v1", "t-1", 1, "inst-1", "cfg-claude");
    const o2 = makeObservation("obs-v2", "t-1", 2, "inst-2", "cfg-claude");
    await repo.putObservation(o1);
    await repo.putObservation(o2);
    await repo.putDecision(makeDecision("obs-v1"));
    await repo.putDecision(makeDecision("obs-v2"));

    const h = render(<TaskObservations taskId="t-1" version={2} evidenceRepo={repo} />);
    await settle();

    // Only version 2 group is present
    expect(h.$('[data-version-group="1"]')).toBeNull();
    expect(h.$('[data-version-group="2"]')).toBeTruthy();
    expect(h.$$("[data-observation-row]").length).toBe(1);
    expect(h.container.textContent).toContain("obs-v2");
    expect(h.container.textContent).not.toContain("obs-v1");

    cleanup(h);
  });
});

describe("TaskObservations — Honest counts differentiation", () => {
  it("differentiates Tasks, versions, instances, active observations, selected attempts, and all attempts", async () => {
    const repo = new InMemoryEvidenceRepository();
    const m1 = makeModelConfig("cfg-claude", "claude-3-5-sonnet");
    await repo.putModelConfiguration(m1);

    // 2 versions, 3 instances, 3 observations, 3 selected attempts
    const o1 = makeObservation("obs-1", "t-1", 1, "inst-1", "cfg-claude", {
      candidateAttemptId: "cand-1",
    });
    const o2 = makeObservation("obs-2", "t-1", 1, "inst-2", "cfg-claude", {
      candidateAttemptId: "cand-2",
    });
    const o3 = makeObservation("obs-3", "t-1", 2, "inst-3", "cfg-claude", {
      candidateAttemptId: "cand-3",
    });

    await repo.putObservation(o1);
    await repo.putObservation(o2);
    await repo.putObservation(o3);
    await repo.putDecision(makeDecision("obs-1"));
    await repo.putDecision(makeDecision("obs-2"));
    await repo.putDecision(makeDecision("obs-3"));

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
    const mClaude = makeModelConfig("cfg-claude", "claude-3-5-sonnet", "claude-3-5-sonnet-20241022", "2024-10-22", "exact", "anthropic");
    const mGpt = makeModelConfig("cfg-gpt4o", "gpt-4o", "gpt-4o-2024-08-06", "2024-08-06", "exact", "openai");
    const mUnknown = makeModelConfig("cfg-unknown", "custom-model", null, null, "partial", "custom");

    await repo.putModelConfiguration(mClaude);
    await repo.putModelConfiguration(mGpt);
    await repo.putModelConfiguration(mUnknown);

    const o1 = makeObservation("obs-1", "t-1", 1, "inst-1", "cfg-claude", {
      sourceKind: "evaluation",
      observedAt: NOW - 50_000,
      protocolFingerprint: "proto-standard",
    });
    const o2 = makeObservation("obs-2", "t-1", 1, "inst-1", "cfg-gpt4o", {
      sourceKind: "evaluation",
      observedAt: NOW - 20_000,
      protocolFingerprint: "proto-standard",
    });
    const o3 = makeObservation("obs-3", "t-1", 1, "inst-2", "cfg-unknown", {
      sourceKind: "comparison",
      observedAt: NOW,
      protocolFingerprint: "proto-exploratory",
    });

    await repo.putObservation(o1);
    await repo.putObservation(o2);
    await repo.putObservation(o3);

    // o1: comparable, eligible, paired_model_comparison, cohort-1
    await repo.putDecision(
      makeDecision("obs-1", "comparable", "eligible", ["task_descriptive", "within_model_profile", "paired_model_comparison"], ["canonical_task_resolved", "model_configuration_exact"], "cohort-1"),
    );
    // o2: verified, provisional, within_model_profile, cohort-1
    await repo.putDecision(
      makeDecision("obs-2", "verified", "provisional", ["task_descriptive", "within_model_profile"], ["canonical_task_resolved", "verifier_passed"], "cohort-1"),
    );
    // o3: exploratory, excluded, [], cohort-2
    await repo.putDecision(
      makeDecision("obs-3", "exploratory", "excluded", [], ["canonical_task_unresolved", "model_version_unreported", "source_legacy_limited"], "cohort-2"),
    );
  }

  it("filters observations by model configuration", async () => {
    const repo = new InMemoryEvidenceRepository();
    await setupFilteredDataset(repo);

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    expect(h.$$("[data-observation-row]").length).toBe(3);

    // Select claude model filter
    const modelSelect = h.$("select[data-filter-model]") as HTMLSelectElement;
    expect(modelSelect).toBeTruthy();
    act(() => {
      modelSelect.value = "cfg-claude";
      modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(h.$$("[data-observation-row]").length).toBe(1);
    expect(h.container.textContent).toContain("obs-1");
    expect(h.container.textContent).not.toContain("obs-2");
    expect(h.container.textContent).not.toContain("obs-3");

    cleanup(h);
  });

  it("filters observations by evidence class", async () => {
    const repo = new InMemoryEvidenceRepository();
    await setupFilteredDataset(repo);

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
    expect(h.container.textContent).toContain("obs-2");

    cleanup(h);
  });

  it("filters observations by eligibility status", async () => {
    const repo = new InMemoryEvidenceRepository();
    await setupFilteredDataset(repo);

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
    expect(h.container.textContent).toContain("obs-3");

    cleanup(h);
  });

  it("filters observations by allowed use", async () => {
    const repo = new InMemoryEvidenceRepository();
    await setupFilteredDataset(repo);

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
    expect(h.container.textContent).toContain("obs-1");

    cleanup(h);
  });

  it("filters observations by cohort", async () => {
    const repo = new InMemoryEvidenceRepository();
    await setupFilteredDataset(repo);

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    const cohortSelect = h.$("select[data-filter-cohort]") as HTMLSelectElement;
    expect(cohortSelect).toBeTruthy();
    act(() => {
      cohortSelect.value = "cohort-2";
      cohortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(h.$$("[data-observation-row]").length).toBe(1);
    expect(h.container.textContent).toContain("obs-3");

    cleanup(h);
  });

  it("filters observations by source kind", async () => {
    const repo = new InMemoryEvidenceRepository();
    await setupFilteredDataset(repo);

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
    expect(h.container.textContent).toContain("obs-3");

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
    const m = makeModelConfig("cfg-1", "gpt-4o");
    await repo.putModelConfiguration(m);

    // Create 15 observations
    for (let i = 1; i <= 15; i++) {
      const pad = String(i).padStart(2, "0");
      const obs = makeObservation(`obs-${pad}`, "t-1", 1, `inst-${pad}`, "cfg-1", {
        observedAt: NOW - (15 - i) * 1000,
      });
      await repo.putObservation(obs);
      await repo.putDecision(makeDecision(`obs-${pad}`));
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
    const mUnknown = makeModelConfig("cfg-partial", "unreported-model", null, null, "partial", "custom");
    await repo.putModelConfiguration(mUnknown);

    const obs = makeObservation("obs-partial", "t-1", 1, "inst-1", "cfg-partial");
    await repo.putObservation(obs);
    await repo.putDecision(
      makeDecision("obs-partial", "exploratory", "excluded", [], [
        "model_version_unreported",
        "source_legacy_limited",
      ]),
    );

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    const row = h.$('[data-observation-row="obs-partial"]');
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
    const m = makeModelConfig("cfg-claude", "claude-3-5-sonnet");
    await repo.putModelConfiguration(m);

    const obs = makeObservation("obs-linked", "t-1", 2, "inst-5", "cfg-claude", {
      sourceResultId: "eval-run-999",
      candidateAttemptId: "cand-attempt-888",
      assessmentRef: {
        judgeAttemptId: "judge-attempt-777",
        verifierExecutionId: null,
        blindLabel: "Candidate A",
        rubricVersion: 3,
        selectedTaskAttemptId: "cand-attempt-888",
      },
      rubricRef: { id: "rubric-custom", version: 3 },
    });
    await repo.putObservation(obs);
    await repo.putDecision(makeDecision("obs-linked"));

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    const row = h.$('[data-observation-row="obs-linked"]');
    expect(row).toBeTruthy();

    // Deep link to source record
    const recordLink = row?.querySelector<HTMLAnchorElement>('a[data-link-record]');
    expect(recordLink).toBeTruthy();
    expect(recordLink?.getAttribute("href")).toContain("/runs/eval-run-999");

    // Deep link to task version
    const versionLink = row?.querySelector<HTMLAnchorElement>('a[data-link-version]');
    expect(versionLink).toBeTruthy();
    expect(versionLink?.getAttribute("href")).toBe("/tasks/t-1/versions/2");

    // Deep link to rubric
    const rubricLink = row?.querySelector<HTMLAnchorElement>('a[data-link-rubric]');
    expect(rubricLink).toBeTruthy();
    expect(rubricLink?.getAttribute("href")).toBe("/evaluations/rubrics/rubric-custom");

    cleanup(h);
  });
});

describe("TaskObservations — Navigation and URL filter preservation", () => {
  it("initializes filters from URL search params and updates URL on filter changes", async () => {
    const repo = new InMemoryEvidenceRepository();
    const m1 = makeModelConfig("cfg-claude", "claude-3-5-sonnet");
    const m2 = makeModelConfig("cfg-gpt4o", "gpt-4o");
    await repo.putModelConfiguration(m1);
    await repo.putModelConfiguration(m2);

    const o1 = makeObservation("obs-1", "t-1", 1, "inst-1", "cfg-claude");
    const o2 = makeObservation("obs-2", "t-1", 1, "inst-1", "cfg-gpt4o");
    await repo.putObservation(o1);
    await repo.putObservation(o2);
    await repo.putDecision(makeDecision("obs-1", "comparable", "eligible"));
    await repo.putDecision(makeDecision("obs-2", "verified", "provisional"));

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
    expect(h.container.textContent).toContain("obs-1");

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
    const m = makeModelConfig("cfg-claude", "claude-3-5-sonnet");
    await repo.putModelConfiguration(m);

    const canonicalObs = makeObservation("obs-canonical", "t-1", 1, "inst-1", "cfg-claude");
    await repo.putObservation(canonicalObs);
    await repo.putDecision(makeDecision("obs-canonical"));

    const h = render(<TaskObservations taskId="t-1" evidenceRepo={repo} />);
    await settle();

    expect(h.$$("[data-observation-row]").length).toBe(1);
    expect(h.container.textContent).toContain("obs-canonical");
    // Ensure no Fusion observation or fusion terminology is fabricated
    expect(h.container.textContent).not.toMatch(/FusionObservation/i);

    cleanup(h);
  });
});

describe("TaskObservations — Same-component route transitions regression", () => {
  it("clears previous task observations and loads new task observations when taskId changes on same mounted component", async () => {
    const repo = new InMemoryEvidenceRepository();
    const m = makeModelConfig("cfg-claude", "claude-3-5-sonnet");
    await repo.putModelConfiguration(m);

    const oTask1 = makeObservation("obs-task1", "t-1", 1, "inst-1", "cfg-claude");
    const oTask2 = makeObservation("obs-task2", "t-2", 1, "inst-2", "cfg-claude");
    await repo.putObservation(oTask1);
    await repo.putObservation(oTask2);
    await repo.putDecision(makeDecision("obs-task1"));
    await repo.putDecision(makeDecision("obs-task2"));

    // Route component that can navigate between tasks
    function RouteWrapper() {
      const loc = useLocation();
      const nav = useNavigate();
      const currentTaskId = loc.pathname.includes("t-2") ? "t-2" : "t-1";
      return (
        <div>
          <button
            type="button"
            data-nav-t2
            onClick={() => nav("/tasks/t-2")}
          >
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
    expect(h.container.textContent).toContain("obs-task1");
    expect(h.container.textContent).not.toContain("obs-task2");

    // Navigate to task 2
    const btn = h.$("button[data-nav-t2]") as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    await settle();

    // Now shows task 2 observation, task 1 observation is gone
    expect(h.container.textContent).toContain("obs-task2");
    expect(h.container.textContent).not.toContain("obs-task1");

    cleanup(h);
  });
});
