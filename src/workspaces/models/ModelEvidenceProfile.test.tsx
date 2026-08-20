// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, cleanup } from "./models-test-harness";
import { ModelEvidenceProfile, type ProfileData } from "./ModelEvidenceProfile";

function makeProfileData(): ProfileData {
  return {
    identity: {
      modelConfigurationId:
        "mc:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      providerId: "openai",
      requestedModel: "gpt-5.6-sol",
      resolvedModel: "gpt-5.6-sol",
      resolvedVersion: "gpt-5.6-sol",
      versionStatus: "exact",
      reasoningEffective: "high",
      toolScaffoldSignature: "t-7f2c",
      observedFrom: 1714867200000,
      observedTo: 1722470400000,
      rubricVersionCount: 3,
      evaluatorConfigCount: 2,
      comparabilityCohortCount: 2,
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
      inMetricsEligibilityStatusSplit: {
        eligible: 14,
        provisional: 3,
        excluded: 6,
      },
      consideredEligibilityStatusSplit: {
        eligible: 14,
        provisional: 3,
        excluded: 6,
      },
      sourceKindSplit: {
        comparison: 61,
        evaluation: 51,
      },
      identityCompleteness: "exact",
      limitationReasons: {},
    },
    narrative: [
      {
        text: "Verified on 8 of 10 code-transformation Tasks under verifier cohort X.",
        sourceMetricKey: "coverage:code-transformation:verified",
      },
    ],
    claims: [],
    families: [],
    verifiedOutcomes: [],
    evidenceRows: [
      {
        observationId: "obs-1",
        taskId: "task-1",
        taskName: "Task 1",
        version: 2,
        instanceId: "i-1",
        familyId: "code",
        familyName: "Code Transformation",
        outcome: "pass",
        evidenceClass: "verified",
        eligibility: "eligible",
        observedDate: "2026-08-15",
        sourceKind: "comparison",
        supporting: true,
      },
    ],
    protocolCohorts: [{ ref: "Rubric v3 · rub-eval@2", taskCount: 10, groupId: "group-1" }],
    evaluatorConfigs: [
      {
        kind: "model_judge",
        modelRef: "gpt-5.6-sol",
        instructionDigest: "abc123",
        observationCount: 48,
      },
    ],
    uncertaintyReceipt: {
      unitKind: "task_identity",
      resolvedCount: 6,
      fallbackAssumption:
        "No higher-order dependency is encoded; Task identity is the resampling unit.",
      resolverVersion: "v1",
      aggregationVersion: "v1",
      seed: "abcdef12",
      assignmentDigest: "9a2f4c",
      resamples: 2000,
    },
    limitations: [
      { code: "unknown_version", reason: "Provider version was not reported for 14 observations." },
    ],
  };
}

function renderProfile(data?: ProfileData | null, notFound?: boolean, computing?: boolean) {
  return render(
    <MemoryRouter initialEntries={["/models/mc-test"]}>
      <Routes>
        <Route
          path="/models/:modelConfigurationId"
          element={<ModelEvidenceProfile data={data} notFound={notFound} computing={computing} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ModelEvidenceProfile — Fable §7", () => {
  it("renders the identity header with provider and requested model", () => {
    const h = renderProfile(makeProfileData());
    expect(h.text()).toContain("openai");
    expect(h.text()).toContain("gpt-5.6-sol");
    expect(h.text()).toContain("MODEL CONFIGURATION");
    cleanup(h);
  });

  it("renders the VersionStatusChip for exact version", () => {
    const h = renderProfile(makeProfileData());
    expect(h.$("[data-version-status=exact]")).not.toBeNull();
    cleanup(h);
  });

  it("renders the receipt line with rule versions", () => {
    const h = renderProfile(makeProfileData());
    expect(h.text()).toContain("aggregation v1");
    expect(h.text()).toContain("uncertainty v1");
    expect(h.text()).toContain("eligibility v1");
    cleanup(h);
  });

  it("renders D2 DeterministicNarrative immediately below the header", () => {
    const h = renderProfile(makeProfileData());
    expect(h.$("[data-deterministic-narrative]")).not.toBeNull();
    expect(h.text()).toContain("Verified on 8 of 10");
    cleanup(h);
  });

  it("renders Section 2 CoverageGrid", () => {
    const h = renderProfile(makeProfileData());
    expect(h.$("[data-section=coverage]")).not.toBeNull();
    expect(h.$("[data-coverage-grid]")).not.toBeNull();
    cleanup(h);
  });

  it("renders Section 6 EvidenceTable always", () => {
    const h = renderProfile(makeProfileData());
    expect(h.$("[data-section=evidence-table]")).not.toBeNull();
    cleanup(h);
  });

  it("renders Section 7 protocols, evaluators, uncertainty receipt, limitations", () => {
    const h = renderProfile(makeProfileData());
    expect(h.$("[data-section=protocols]")).not.toBeNull();
    expect(h.text()).toContain("Protocol");
    expect(h.text()).toContain("Evaluator");
    expect(h.text()).toContain("Uncertainty receipt");
    expect(h.text()).toContain("Limitations");
    cleanup(h);
  });

  it("renders the saved rollups empty state with honesty note", () => {
    const h = renderProfile(makeProfileData());
    expect(h.text()).toContain("Saved rollups");
    expect(h.text()).toContain("never pools evidence");
    cleanup(h);
  });

  it("renders the section nav at desktop (hidden below 1280px)", () => {
    const h = renderProfile(makeProfileData());
    expect(h.$("[data-section-nav]")).not.toBeNull();
    expect(h.$("[data-anchor-row]")).not.toBeNull();
    cleanup(h);
  });

  it("renders the not-found state for unknown ID", () => {
    const h = renderProfile(null, true, false);
    expect(h.$("[data-profile-state=not-found]")).not.toBeNull();
    expect(h.text()).toContain("No model configuration");
    expect(h.$("[data-action=open-models]")).not.toBeNull();
    expect(h.$("[data-action=open-records]")).not.toBeNull();
    cleanup(h);
  });

  it("renders the computing state with Cancel button", () => {
    const h = renderProfile(null, false, true);
    expect(h.$("[data-profile-state=computing]")).not.toBeNull();
    expect(h.$("[role=status]")).not.toBeNull();
    expect(h.$("[data-action=cancel]")).not.toBeNull();
    cleanup(h);
  });

  it("renders exploratory-only honesty note when flagged", () => {
    const data = makeProfileData();
    data.isExploratoryOnly = true;
    const h = renderProfile(data);
    expect(h.text()).toContain("exploratory");
    expect(h.text()).toContain("claims are not yet supported");
    cleanup(h);
  });

  it("renders unknown version limitation when flagged", () => {
    const data = makeProfileData();
    data.isUnknownVersion = true;
    const h = renderProfile(data);
    expect(h.text()).toContain("Provider version was not reported");
    cleanup(h);
  });

  it("renders rolling alias disclosure when versionStatus is rolling_alias", () => {
    const data = makeProfileData();
    data.identity.versionStatus = "rolling_alias";
    data.identity.versionWindow = "May–Aug 2026";
    const h = renderProfile(data);
    expect(h.$("[data-version-status=rolling_alias]")).not.toBeNull();
    expect(h.text()).toContain("Provider alias without a reported version");
    cleanup(h);
  });

  it("renders partial identity disclosure when versionStatus is partial_identity", () => {
    const data = makeProfileData();
    data.identity.versionStatus = "partial_identity";
    data.identity.missingDimension = "no resolved version";
    const h = renderProfile(data);
    expect(h.$("[data-version-status=partial_identity]")).not.toBeNull();
    expect(h.text()).toContain("no resolved version");
    cleanup(h);
  });

  it("renders the breadcrumb link back to Models", () => {
    const h = renderProfile(makeProfileData());
    expect(h.text()).toContain("Models");
    cleanup(h);
  });

  it("omits Section 4 VerifiedOutcomes when no verifier evidence", () => {
    const h = renderProfile(makeProfileData());
    expect(h.$("[data-section=verified-outcomes]")).toBeNull();
    cleanup(h);
  });

  it("renders Section 4 VerifiedOutcomes when verifier evidence exists", () => {
    const data = makeProfileData();
    data.verifiedOutcomes = [
      {
        cohortRef: "Verifier X",
        verifiedTasks: "8 of 10",
        passRate: { state: "available", value: 0.8, unitCount: 8 },
        interval: {
          level: 95,
          lower: 0.62,
          upper: 0.94,
          unitCount: 8,
          unitKind: "task-cluster",
        },
        failureCount: 2,
      },
    ];
    const h = renderProfile(data);
    expect(h.$("[data-section=verified-outcomes]")).not.toBeNull();
    cleanup(h);
  });

  it("renders the page heading with tabindex=-1 for focus management", () => {
    const h = renderProfile(makeProfileData());
    const heading = h.$("#profile-heading");
    expect(heading).not.toBeNull();
    expect(heading!.getAttribute("tabindex")).toBe("-1");
    cleanup(h);
  });
});
