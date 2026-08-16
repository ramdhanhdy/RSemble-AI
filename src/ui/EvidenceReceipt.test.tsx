// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { EvidenceReceipt } from "./EvidenceReceipt";
import {
  OBSERVATION_SCHEMA_VERSION,
  type EligibilityDecision,
  type ModelConfigurationSnapshot,
  type Observation,
} from "../lib/evidence/evidence-types";
import {
  InMemoryEvidenceRepository,
  type EvidenceIndexJob,
} from "../lib/persistence/evidence-repository";
import { observationIdFor } from "../lib/evidence/evidence-validation";
import { EVIDENCE_RULE_VERSION } from "../lib/evidence/evidence-eligibility";
import { canonicalizeModelConfiguration } from "../lib/evidence/model-configuration";
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const VALID_SHA = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const VALID_MC_ID = "mc:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const VALID_OBS_ID = "obs:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function renderWithRouter(node: ReactNode, initialEntries: string[] = ["/"]): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter initialEntries={initialEntries}>{node}</MemoryRouter>);
  });
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await flush();
    });
  }
}
afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  const runId = overrides.runId ?? overrides.sourceResultId ?? "run_456";
  return {
    id: VALID_OBS_ID,
    sourceKind: "evaluation",
    sourceResultId: runId,
    executionLineageId: "lineage_789",
    runId,
    sourceTaskCellId: "cell_task_model",
    taskId: "task_sentiment_analysis",
    taskVersion: 2,
    taskInstanceId: "inst_001",
    taskFamilyId: "family_nlp",
    modelConfigurationId: VALID_MC_ID,
    candidateAttemptId: "att_cand_01",
    assessmentRef: {
      judgeAttemptId: "att_judge_01",
      judgeProviderId: "gemini",
      judgeModel: "gemini-1.5-pro",
      blindLabelMapping: { candidate_a: "slot_0" },
      candidateAttemptIdsByCandidateId: { slot_0: "att_cand_01" },
      rubricRef: { id: "rubric_accuracy", version: 1 },
      verifierRef: { id: "verifier_regex", version: 1 },
      verifierOutcome: {
        taskId: "task_sentiment_analysis",
        modelKey: "gemini:gemini-1.5-pro",
        passed: true,
        executedAt: 1700000000000,
      },
    },
    protocolFingerprint: VALID_SHA,
    rubricRef: { id: "rubric_accuracy", version: 1 },
    evaluatorSnapshot: {
      kind: "model_judge",
      providerId: "gemini",
      model: "gemini-1.5-pro",
      resolvedVersion: "002",
      instructionDigest: VALID_SHA,
      reasoningEffort: "medium",
      toolScaffoldSignature: null,
    },
    verifierSnapshot: {
      verifierRef: { id: "verifier_regex", version: 1 },
      kind: "exact_match",
      configurationDigest: VALID_SHA,
    },
    outcome: {
      judgeAccepted: true,
      overallScore: 4.5,
      criterionValues: [{ criterionId: "c1", value: 4.5 }],
      verifierPassed: true,
    },
    observedAt: 1700000000000,
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<EligibilityDecision> = {}): EligibilityDecision {
  return {
    observationId: VALID_OBS_ID,
    ruleVersion: EVIDENCE_RULE_VERSION,
    status: "eligible",
    evidenceClass: "comparable",
    allowedUses: [
      "task_descriptive",
      "within_model_profile",
      "paired_model_comparison",
      "task_set_standing",
    ],
    reasonCodes: [
      "canonical_task_resolved",
      "instance_reconstructed",
      "candidate_selected_completed",
      "assessment_selected_completed",
      "rubric_resolved",
      "protocol_complete",
      "model_configuration_exact",
      "full_pair_coverage",
      "full_task_set_coverage",
    ],
    comparabilityCohortId: VALID_SHA,
    decidedAt: 1700000000000,
    ...overrides,
  };
}
function makeModelConfig(
  overrides: Partial<ModelConfigurationSnapshot> = {},
): ModelConfigurationSnapshot {
  const res = canonicalizeModelConfiguration({
    providerId: "gemini",
    requestedModel: "gemini-1.5-pro",
    resolvedModel: "gemini-1.5-pro-002",
    resolvedVersion: "002",
    reasoningRequested: "medium",
    reasoningEffective: "medium",
    runtimeSettings: { temperature: 0.7 },
    observedAt: 1700000000000,
  });
  if (!res.ok) throw new Error(res.reason);
  return {
    ...res.snapshot,
    ...overrides,
  };
}

function makeIndexJob(overrides: Partial<EvidenceIndexJob> = {}): EvidenceIndexJob {
  return {
    sourceResultId: "run_456",
    sourceKind: "evaluation",
    status: "complete",
    ruleVersion: EVIDENCE_RULE_VERSION,
    sourceRevision: 1,
    updatedAt: 1700000000000,
    errorKind: null,
    errorMessage: null,
    summary: {
      observationCount: 1,
      gapCount: 0,
      limitationCount: 0,
      integrityIssues: [],
    },
    ...overrides,
  };
}

// --- Tests --------------------------------------------------------------------

describe("EvidenceReceipt — Eligibility statuses", () => {
  it("renders eligible status with full plain-language description and summary", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      status: "eligible",
      evidenceClass: "comparable",
    });
    const modelConfig = makeModelConfig();

    const h = renderWithRouter(
      <EvidenceReceipt
        observation={obs}
        decision={decision}
        modelConfig={modelConfig}
        defaultOpen
      />,
    );

    expect(h.container.textContent).toContain("Eligible");
    expect(h.container.textContent).toContain("Comparable");
    expect(h.container.textContent).toContain("Eligible for all declared uses of its class.");
    cleanup(h);
  });

  it("renders provisional status with qualification explanation", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      status: "provisional",
      evidenceClass: "comparable",
      allowedUses: ["task_descriptive", "within_model_profile"],
      reasonCodes: [
        "canonical_task_resolved",
        "instance_reconstructed",
        "candidate_selected_completed",
        "assessment_selected_completed",
        "paired_cell_missing",
      ],
    });

    const h = renderWithRouter(
      <EvidenceReceipt
        observation={obs}
        decision={decision}
        modelConfig={makeModelConfig()}
        defaultOpen
      />,
    );

    expect(h.container.textContent).toContain("Provisional");
    expect(h.container.textContent).toContain(
      "Provisional — eligible only for qualified uses with disclosed limitations.",
    );
    cleanup(h);
  });

  it("renders excluded status with exclusion explanation", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      status: "excluded",
      evidenceClass: "exploratory",
      allowedUses: [],
      reasonCodes: ["candidate_missing_or_failed", "source_corrupt"],
    });

    const h = renderWithRouter(
      <EvidenceReceipt
        observation={obs}
        decision={decision}
        modelConfig={makeModelConfig()}
        defaultOpen
      />,
    );

    expect(h.container.textContent).toContain("Excluded");
    expect(h.container.textContent).toContain("Excluded — cannot support any evidence use.");
    cleanup(h);
  });
});

describe("EvidenceReceipt — All four evidence classes", () => {
  it("renders exploratory class description", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      status: "provisional",
      evidenceClass: "exploratory",
      allowedUses: ["task_descriptive"],
      reasonCodes: ["canonical_task_unresolved", "protocol_incomplete"],
    });

    const h = renderWithRouter(
      <EvidenceReceipt observation={obs} decision={decision} defaultOpen />,
    );

    expect(h.container.textContent).toContain("Exploratory");
    expect(h.container.textContent).toContain(
      "Exploratory evidence — visible and drillable, excluded from default model profiles.",
    );
    cleanup(h);
  });

  it("renders comparable class description", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      status: "eligible",
      evidenceClass: "comparable",
    });

    const h = renderWithRouter(
      <EvidenceReceipt observation={obs} decision={decision} defaultOpen />,
    );

    expect(h.container.textContent).toContain("Comparable");
    expect(h.container.textContent).toContain(
      "Comparable evidence — controlled foundations are in place.",
    );
    cleanup(h);
  });

  it("renders verified class description when deterministic verifier passed", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      status: "eligible",
      evidenceClass: "verified",
      reasonCodes: [
        "canonical_task_resolved",
        "instance_reconstructed",
        "candidate_selected_completed",
        "verifier_passed",
      ],
    });

    const h = renderWithRouter(
      <EvidenceReceipt observation={obs} decision={decision} defaultOpen />,
    );

    expect(h.container.textContent).toContain("Verified");
    expect(h.container.textContent).toContain(
      "Verified evidence — a frozen deterministic verifier passed (or authorized human verification was recorded).",
    );
    cleanup(h);
  });

  it("renders benchmark_anchor class description", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      status: "eligible",
      evidenceClass: "benchmark_anchor",
      allowedUses: [
        "task_descriptive",
        "within_model_profile",
        "paired_model_comparison",
        "task_set_standing",
        "benchmark_anchor_analysis",
      ],
      reasonCodes: [
        "canonical_task_resolved",
        "instance_reconstructed",
        "candidate_selected_completed",
        "anchor_designated",
      ],
    });

    const h = renderWithRouter(
      <EvidenceReceipt observation={obs} decision={decision} defaultOpen />,
    );

    expect(h.container.textContent).toContain("Benchmark anchor");
    expect(h.container.textContent).toContain(
      "Benchmark anchor — explicitly designated, fully covered, frozen-protocol evidence.",
    );
    cleanup(h);
  });
});

describe("EvidenceReceipt — Reason codes and plain-language explanations", () => {
  it("explains why results count with exact reason code texts", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      reasonCodes: [
        "canonical_task_resolved",
        "instance_reconstructed",
        "candidate_selected_completed",
        "assessment_selected_completed",
        "verifier_passed",
        "protocol_complete",
      ],
    });

    const h = renderWithRouter(
      <EvidenceReceipt observation={obs} decision={decision} defaultOpen />,
    );

    expect(h.container.textContent).toContain("This record resolves to a canonical Task identity.");
    expect(h.container.textContent).toContain("The concrete Task Instance input is reconstructable.");
    expect(h.container.textContent).toContain("An accepted completed candidate output exists for this cell.");
    expect(h.container.textContent).toContain("An accepted assessment exists for this output.");
    expect(h.container.textContent).toContain("The deterministic verifier passed.");
    expect(h.container.textContent).toContain("The execution protocol is fully recorded.");
    cleanup(h);
  });

  it("explains limitations when verifier failed or coverage is incomplete", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      status: "provisional",
      evidenceClass: "comparable",
      reasonCodes: [
        "canonical_task_resolved",
        "instance_reconstructed",
        "candidate_selected_completed",
        "verifier_failed",
        "incomplete_task_set_coverage",
      ],
    });

    const h = renderWithRouter(
      <EvidenceReceipt observation={obs} decision={decision} defaultOpen />,
    );

    expect(h.container.textContent).toContain(
      "The deterministic verifier failed — valid negative evidence, not a Verified result.",
    );
    expect(h.container.textContent).toContain("Some declared roster cells are missing evidence.");
    cleanup(h);
  });
});

describe("EvidenceReceipt — Allowed uses", () => {
  it("renders all allowed uses with explanations", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      allowedUses: [
        "task_descriptive",
        "within_model_profile",
        "paired_model_comparison",
        "task_set_standing",
        "benchmark_anchor_analysis",
      ],
    });

    const h = renderWithRouter(
      <EvidenceReceipt observation={obs} decision={decision} defaultOpen />,
    );

    expect(h.container.textContent).toContain("Describe outcomes for this Task, Version, and Instance.");
    expect(h.container.textContent).toContain("Contribute to this model configuration's profile.");
    expect(h.container.textContent).toContain("Compare paired models within one protocol cohort.");
    expect(h.container.textContent).toContain("Establish standing across the complete Task Set.");
    expect(h.container.textContent).toContain("Serve as a benchmark anchor for cross-model analysis.");
    cleanup(h);
  });

  it("indicates when no evidence uses are permitted", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      status: "excluded",
      allowedUses: [],
    });

    const h = renderWithRouter(
      <EvidenceReceipt observation={obs} decision={decision} defaultOpen />,
    );

    expect(h.container.textContent).toMatch(/no permitted.*use|cannot support any.*use/i);
    cleanup(h);
  });
});

describe("EvidenceReceipt — Missing coverage disclosures", () => {
  it("discloses missing paired cells and excluded comparison use", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      status: "provisional",
      reasonCodes: [
        "canonical_task_resolved",
        "instance_reconstructed",
        "candidate_selected_completed",
        "paired_cell_missing",
      ],
    });

    const h = renderWithRouter(
      <EvidenceReceipt observation={obs} decision={decision} defaultOpen />,
    );

    expect(h.container.textContent).toContain(
      "A declared paired cell is missing, so paired and standing comparisons are unavailable.",
    );
    cleanup(h);
  });

  it("handles missing cell without observation (e.g. no-attempt, no-score)", () => {
    const h = renderWithRouter(
      <EvidenceReceipt
        missingReason="no-accepted-attempt"
        taskId="task_sentiment_analysis"
        modelKey="gemini:gemini-1.5-pro"
        runId="run_456"
        defaultOpen
      />,
    );

    expect(h.container.textContent).toContain("No accepted attempt");
    expect(h.container.textContent).toMatch(/excluded|cannot support|no observation/i);
    cleanup(h);
  });
});

describe("EvidenceReceipt — Retry, reuse, and version warnings", () => {
  it("discloses reused candidate output without sample inflation", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      reasonCodes: [
        "canonical_task_resolved",
        "instance_reconstructed",
        "candidate_selected_completed",
        "reused_candidate_assessment",
      ],
    });

    const h = renderWithRouter(
      <EvidenceReceipt observation={obs} decision={decision} defaultOpen />,
    );

    expect(h.container.textContent).toContain(
      "This assessment reused an earlier candidate output — it is not a new response sample.",
    );
    cleanup(h);
  });

  it("discloses undeclared repeat execution", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      reasonCodes: [
        "canonical_task_resolved",
        "instance_reconstructed",
        "candidate_selected_completed",
        "undeclared_repeat",
      ],
    });

    const h = renderWithRouter(
      <EvidenceReceipt observation={obs} decision={decision} defaultOpen />,
    );

    expect(h.container.textContent).toContain(
      "This is a repeated execution that was not planned as a replicate before running.",
    );
    cleanup(h);
  });

  it("discloses unreported resolved model version", () => {
    const obs = makeObservation();
    const decision = makeDecision({
      reasonCodes: [
        "canonical_task_resolved",
        "instance_reconstructed",
        "candidate_selected_completed",
        "model_version_unreported",
      ],
    });
    const modelConfig = makeModelConfig({
      resolvedVersion: null,
      identityCompleteness: "partial",
    });

    const h = renderWithRouter(
      <EvidenceReceipt
        observation={obs}
        decision={decision}
        modelConfig={modelConfig}
        defaultOpen
      />,
    );

    expect(h.container.textContent).toContain(
      "The resolved model version was not reported — comparisons split cohorts on this.",
    );
    cleanup(h);
  });
});

describe("EvidenceReceipt — Exact Task, Observation, and Record links", () => {
  it("renders exact links to Task, Run/Record, and Rubric with proper hrefs", () => {
    const obs = makeObservation({
      taskId: "task_sentiment_analysis",
      taskVersion: 2,
      runId: "run_456",
      rubricRef: { id: "rubric_accuracy", version: 1 },
    });
    const decision = makeDecision();

    const h = renderWithRouter(
      <EvidenceReceipt observation={obs} decision={decision} defaultOpen />,
    );

    const taskLink = h.$("a[href*='/tasks/task_sentiment_analysis']");
    expect(taskLink).toBeTruthy();

    const runLink = h.$("a[href*='/runs/run_456']");
    expect(runLink).toBeTruthy();

    const rubricLink = h.$("a[href*='/evaluations/rubrics/rubric_accuracy']");
    expect(rubricLink).toBeTruthy();

    expect(h.container.textContent).toContain(VALID_OBS_ID);
    expect(h.container.textContent).toContain("inst_001");
    cleanup(h);
  });
});

describe("EvidenceReceipt — Loading and index-error states", () => {
  it("renders loading indicator when loading is true", () => {
    const h = renderWithRouter(<EvidenceReceipt loading defaultOpen />);

    expect(h.container.textContent).toMatch(/loading evidence receipt/i);
    cleanup(h);
  });

  it("renders index error details when index job has failed", () => {
    const indexJob = makeIndexJob({
      status: "error",
      errorKind: "storage_conflict",
      errorMessage: "Idempotent derivation conflict on duplicate source key.",
    });

    const h = renderWithRouter(
      <EvidenceReceipt indexJob={indexJob} runId="run_456" defaultOpen />,
    );

    expect(h.container.textContent).toMatch(/indexing error|derivation error/i);
    expect(h.container.textContent).toContain("storage_conflict");
    expect(h.container.textContent).toContain(
      "Idempotent derivation conflict on duplicate source key.",
    );
    cleanup(h);
  });
});

describe("EvidenceReceipt — Accessibility and screen-reader semantics", () => {
  it("does not convey meaning by badge or color alone and provides keyboard disclosure", async () => {
    const obs = makeObservation();
    const decision = makeDecision({
      status: "eligible",
      evidenceClass: "comparable",
    });

    // In compact mode, renders a button with accessible disclosure attributes
    const h = renderWithRouter(
      <EvidenceReceipt
        observation={obs}
        decision={decision}
        modelConfig={makeModelConfig()}
        compact
      />,
    );

    const trigger = h.$("button[aria-expanded]");
    expect(trigger).toBeTruthy();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger?.getAttribute("aria-label")).toMatch(/evidence receipt.*eligible.*comparable/i);

    // Click trigger to expand
    act(() => {
      trigger?.click();
    });
    await settle();

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(h.container.textContent).toContain("Eligible for all declared uses of its class.");
    cleanup(h);
  });

  it("has min 44px clickable touch target on the disclosure trigger", () => {
    const obs = makeObservation();
    const decision = makeDecision();

    const h = renderWithRouter(
      <EvidenceReceipt observation={obs} decision={decision} compact />,
    );

    const trigger = h.$("button[aria-expanded]");
    expect(trigger?.className).toContain("min-h-[44px]");
    cleanup(h);
  });
});

describe("EvidenceReceipt — Asynchronous repository resolution", () => {
  it("resolves observation, decision, and model configuration from EvidenceRepository", async () => {
    const repo = new InMemoryEvidenceRepository();
    const modelConfig = makeModelConfig();
    const baseObs = makeObservation({
      runId: "run_async_1",
      modelConfigurationId: modelConfig.id,
    });
    const obs = {
      ...baseObs,
      id: observationIdFor(baseObs),
    };
    const decision = makeDecision({
      observationId: obs.id,
    });
    await repo.putModelConfiguration(modelConfig);
    await repo.putObservation(obs);
    await repo.putDecision(decision);

    const h = renderWithRouter(
      <EvidenceReceipt
        runId="run_async_1"
        attemptId="att_judge_01"
        evidenceRepo={repo}
        defaultOpen
      />,
    );

    await settle();

    expect(h.container.textContent).toContain("Eligible");
    expect(h.container.textContent).toContain("Comparable");
    expect(h.container.textContent).toContain(obs.id);
    expect(h.container.textContent).toContain("gemini-1.5-pro");
    cleanup(h);
  });

  it("resolves observation when attemptId is an experiment task attempt id instead of judgeAttemptId (F2-blocker)", async () => {
    const repo = new InMemoryEvidenceRepository();
    const modelConfig = makeModelConfig();
    const baseObs = makeObservation({
      runId: "run_exp_1",
      taskId: "task_sentiment_analysis",
      candidateAttemptId: "att_cand_01",
      assessmentRef: {
        judgeAttemptId: "att_judge_99",
        judgeProviderId: "gemini",
        judgeModel: "gemini-1.5-pro",
        blindLabelMapping: { candidate_a: "slot_0" },
        candidateAttemptIdsByCandidateId: { slot_0: "att_cand_01" },
        rubricRef: { id: "rubric_accuracy", version: 1 },
        verifierRef: { id: "verifier_regex", version: 1 },
        verifierOutcome: {
          taskId: "task_sentiment_analysis",
          modelKey: "gemini:gemini-1.5-pro",
          passed: true,
          executedAt: 1700000000000,
        },
      },
      modelConfigurationId: modelConfig.id,
    });
    const obs = {
      ...baseObs,
      id: observationIdFor(baseObs),
    };
    const decision = makeDecision({
      observationId: obs.id,
    });
    await repo.putModelConfiguration(modelConfig);
    await repo.putObservation(obs);
    await repo.putDecision(decision);

    const h = renderWithRouter(
      <EvidenceReceipt
        runId="run_exp_1"
        taskId="task_sentiment_analysis"
        attemptId="exp_trial_attempt_01"
        modelKey="gemini:gemini-1.5-pro"
        evidenceRepo={repo}
        defaultOpen
      />,
    );

    await settle();

    expect(h.container.textContent).toContain("Eligible");
    expect(h.container.textContent).toContain("Comparable");
    expect(h.container.textContent).toContain(obs.id);
    expect(h.container.textContent).not.toContain("Excluded — No score");
    cleanup(h);
  });
});

describe("EvidenceReceipt — Index job pending and unindexed states (F3-concern)", () => {
  it("renders 'Derivation in progress' when index job is running and no observation exists", async () => {
    const repo = new InMemoryEvidenceRepository();
    const job = makeIndexJob({
      sourceResultId: "run_job_running",
      status: "running",
    });
    await repo.putIndexJob(job);

    const h = renderWithRouter(
      <EvidenceReceipt
        runId="run_job_running"
        taskId="task_x"
        evidenceRepo={repo}
        defaultOpen
      />,
    );

    await settle();

    expect(h.container.textContent).toContain("Derivation in progress");
    expect(h.container.textContent).not.toContain("Excluded — No score");
    expect(h.container.textContent).not.toContain("This cell produced no accepted score");
    cleanup(h);
  });

  it("renders 'Derivation in progress' when index job is queued and no observation exists", async () => {
    const repo = new InMemoryEvidenceRepository();
    const job = makeIndexJob({
      sourceResultId: "run_job_queued",
      status: "queued",
    });
    await repo.putIndexJob(job);

    const h = renderWithRouter(
      <EvidenceReceipt
        runId="run_job_queued"
        taskId="task_x"
        evidenceRepo={repo}
        defaultOpen
      />,
    );

    await settle();

    expect(h.container.textContent).toContain("Derivation in progress");
    expect(h.container.textContent).not.toContain("Excluded — No score");
    cleanup(h);
  });

  it("renders 'Not yet indexed' when no index job and no observation exists and no missingReason passed", async () => {
    const repo = new InMemoryEvidenceRepository();

    const h = renderWithRouter(
      <EvidenceReceipt
        runId="run_not_indexed"
        taskId="task_x"
        evidenceRepo={repo}
        defaultOpen
      />,
    );

    await settle();

    expect(h.container.textContent).toContain("Not yet indexed");
    expect(h.container.textContent).not.toContain("Excluded — No score");
    expect(h.container.textContent).not.toContain("This cell produced no accepted score");
    cleanup(h);
  });
});
