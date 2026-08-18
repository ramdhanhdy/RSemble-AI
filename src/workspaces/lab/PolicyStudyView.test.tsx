// @vitest-environment happy-dom
// =============================================================================
// PolicyStudyView dossier tests — the completed/confirmed study dossier
// (Fable §6, §8, §13).
//
// Contract under test:
//  - verdict banner with claim framing (never error role, even for
//    do_not_fuse), recommendation, rationale, mandatory claim copy, costs,
//    pool-adequacy qualifier;
//  - sealed-inputs grid with working/archived/unresolvable pinned refs;
//  - Stage A/B/C cards with aggregate tables (families, measured pairs,
//    sensitivity), no invented winner verdicts;
//  - the 7-column policy comparison table with recommendation marker, policy
//    cost, and trials/failures — plus its ≤768px card transformation;
//  - the Policy Playbook card: scope statement, qualifiers, split costs,
//    supporting evidence, Start confirmation study;
//  - the evidence boundary ledger with a real qualified-observation count;
//  - the raw records list (trials, attempts, observations) in a contained
//    scroll region;
//  - one-document dossier with anchor section nav, zero tabs.
// =============================================================================
import { afterEach, describe, expect, it } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { InMemoryStudyRepository } from "../../lib/persistence/study-repository";
import { InMemoryEvaluationRepository } from "../../lib/persistence/evaluation-repository";
import { InMemoryLabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import { InMemoryEvidenceRepository } from "../../lib/persistence/evidence-repository";
import { fingerprintStudyValue } from "../../lib/studies/study-fingerprint";
import type {
  EvaluationCriterion,
  EvaluationRubric,
  RubricRecord,
} from "../../lib/evaluations/evaluation-types";
import {
  POLICY_MEASUREMENT_SCHEMA_VERSION,
  POLICY_TRIAL_PAYLOAD_SCHEMA_VERSION,
  type PolicyPlaybookRow,
  type PolicyStudyObservation,
  type PolicyStudyRecord,
  type PolicyStudyTrial,
  type PolicyTrialPayload,
} from "../../lib/studies/policy/policy-study-types";
import type { StudyAttempt } from "../../lib/studies/study-types";
import {
  PolicyStudyView,
  type PolicyStudyLifecycle,
  type PolicyStudyViewProps,
} from "./PolicyStudyView";
import {
  DIGEST,
  makeDefinition,
  makePlaybook,
  makePoolRecord,
  makePoolVersion,
  makeRecipeRecord,
  makeRecipeVersion,
  makeStudyRecord,
} from "./lab-test-fixtures";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
  text: () => string;
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await flush();
    });
  }
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

afterEach(() => {
  document.body.innerHTML = "";
});

// --- Fixtures ---------------------------------------------------------------------

const MC_A = `mc:sha256:${"0".repeat(64)}`;
const MC_B = `mc:sha256:${"1".repeat(64)}`;
const MC_C = `mc:sha256:${"2".repeat(64)}`;
const MC_JUDGE = `mc:sha256:${"3".repeat(64)}`;

function makeTrial(
  id: string,
  overrides: {
    stage?: "A" | "B" | "C";
    policy?: PolicyTrialPayload["policy"];
    recipeId?: string;
    members?: string[];
    createdAt?: number;
    artifactRunId?: string;
    sampleIndex?: number;
  } = {},
): PolicyStudyTrial {
  const policy = overrides.policy ?? "fuse";
  const payload: PolicyTrialPayload = {
    policy,
    stage: overrides.stage ?? "A",
    candidateConfig: {
      members: (overrides.members ?? [MC_A, MC_B]).map((id) => ({ id })),
    },
    recipeRef:
      policy === "fuse"
        ? { recipeId: overrides.recipeId ?? "recipe-1", version: 1, digest: DIGEST }
        : null,
    synthesizer: policy === "fuse" || policy === "refine" ? { id: MC_C } : null,
  };
  const createdAt = overrides.createdAt ?? 2_000;
  return {
    id,
    studyId: "study-1",
    payloadKind: "policy",
    payloadSchemaVersion: POLICY_TRIAL_PAYLOAD_SCHEMA_VERSION,
    payloadFingerprint: fingerprintStudyValue(payload),
    payload,
    status: "sealed",
    sampleIndex: overrides.sampleIndex ?? 0,
    artifactRefs: overrides.artifactRunId
      ? [{ runId: overrides.artifactRunId, attemptId: `att-${id}`, contentHash: DIGEST }]
      : [],
    observationIds: [],
    policyCost: { tokensIn: 100, tokensOut: 50 },
    experimentalCost: { tokensIn: 200, tokensOut: 100 },
    createdAt,
    sealedAt: createdAt + 500,
  };
}

function makeObservation(
  id: string,
  trialId: string,
  score: number | null,
  failed = false,
): PolicyStudyObservation {
  return {
    id,
    studyId: "study-1",
    trialId,
    payloadKind: "policy_measurement",
    payloadSchemaVersion: POLICY_MEASUREMENT_SCHEMA_VERSION,
    payload: {
      judge: { id: MC_JUDGE },
      overallScore: score,
      tokensIn: 200,
      tokensOut: 100,
      error: failed ? { message: "judge evaluator returned 429" } : null,
    },
    status: failed ? "failed" : "completed",
    sourceRunId: null,
    createdAt: 3_000,
    finishedAt: 3_500,
  };
}

const FOUR_ROWS: PolicyPlaybookRow[] = [
  {
    policy: "best_fixed",
    configuration: "openrouter:acme/cand-1",
    meanOutcome: 0.7,
    lift: 0,
    costMultiplier: 1.0,
    confidence: "high",
  },
  {
    policy: "rank",
    configuration: "pair A×C",
    meanOutcome: 0.74,
    lift: 0.04,
    costMultiplier: 1.2,
    confidence: "medium",
  },
  {
    policy: "fuse",
    configuration: "Blind Raw v1 · pair A×C",
    meanOutcome: 0.81,
    lift: 0.11,
    costMultiplier: 2.6,
    confidence: "medium",
  },
  {
    policy: "refine",
    configuration: "Blind Raw v1 · winner",
    meanOutcome: 0.85,
    lift: 0.15,
    costMultiplier: 1.8,
    confidence: "high",
  },
];

const LIFECYCLE: PolicyStudyLifecycle = {
  phase: null,
  failureMessage: null,
  runnerAvailable: false,
  onResume: () => undefined,
  onInterrupt: () => undefined,
  onArchive: () => undefined,
};

interface Seeded {
  repo: InMemoryStudyRepository;
  evalRepo: InMemoryEvaluationRepository;
  labAssetRepo: InMemoryLabAssetRepository;
  evidenceRepo: InMemoryEvidenceRepository;
}

/** Seed a completed exploratory study with trials, observations, an attempt,
 *  and a four-row playbook. */
async function seedCompleted(playbookOverrides: Parameters<typeof makePlaybook>[0] = {}): Promise<Seeded> {
  const repo = new InMemoryStudyRepository();
  await repo.createStudy(makeStudyRecord());
  await repo.startStudy("study-1", 0, 1_500);
  await repo.createTrial(makeTrial("trial-a1", { stage: "A", recipeId: "recipe-1" }));
  await repo.createTrial(
    makeTrial("trial-a2", { stage: "A", recipeId: "recipe-2", createdAt: 2_100 }),
  );
  await repo.createTrial(
    makeTrial("trial-b1", { stage: "B", createdAt: 2_200, artifactRunId: "run-1" }),
  );
  await repo.createTrial(
    makeTrial("trial-c1", { stage: "C", policy: "refine", members: [MC_B], createdAt: 2_400 }),
  );
  await repo.appendObservation(makeObservation("obs-a1", "trial-a1", 0.8));
  await repo.appendObservation(makeObservation("obs-a2", "trial-a2", 0.6));
  await repo.appendObservation(makeObservation("obs-b1", "trial-b1", 0.81));
  await repo.appendObservation(makeObservation("obs-b1f", "trial-b1", null, true));
  await repo.appendObservation(makeObservation("obs-c1", "trial-c1", 0.85));
  // A treatment-changing retry: trial-b1's treatment was replaced by trial-b2
  // (spec §4.3). createAttempt persists both the lineage row and the successor.
  const attempt: StudyAttempt = {
    id: "attempt-1",
    studyId: "study-1",
    fromTrialId: "trial-b1",
    toTrialId: "trial-b2",
    reason: "Treatment regenerated after pool correction.",
    createdAt: 2_250,
  };
  await repo.createAttempt(
    attempt,
    makeTrial("trial-b2", {
      stage: "B",
      policy: "rank",
      members: [MC_A],
      createdAt: 2_300,
      sampleIndex: 1,
    }),
  );
  const playbook = makePlaybook({
    rows: FOUR_ROWS,
    recommendation: {
      kind: "adopt",
      policy: "refine",
      configuration: "Blind Raw v1 · winner",
      rationale:
        "Refine exceeds the predeclared MPID on holdout tasks at 1.8× policy cost; Fuse remains within uncertainty and is not justified.",
    },
    ...playbookOverrides,
  });
  await repo.createPlaybook("pb-1", playbook);
  await repo.sealStudy("study-1", 1, "pb-1", 4_000);

  const evalRepo = new InMemoryEvaluationRepository();
  const rubricRecord: RubricRecord = {
    id: "rub1",
    revision: 1,
    latestVersion: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
  };
  const criterion: EvaluationCriterion = {
    kind: "graded",
    id: "c-1",
    name: "Correctness",
    description: "Correctness description",
    weight: 1,
    anchors: { one: "poor", two: "weak", three: "ok", four: "good", five: "great" },
  };
  const rubricBase: EvaluationRubric = {
    id: "rub1",
    version: 1,
    name: "Reliability Rubric",
    description: "",
    judgeInstruction: "Judge fairly.",
    criteria: [criterion],
    createdAt: 1_000,
    updatedAt: 1_000,
  };
  await evalRepo.createRubric(rubricRecord, rubricBase);
  await evalRepo.appendRubricVersion(
    rubricRecord,
    { ...rubricBase, version: 2 },
    rubricRecord.revision,
  );
  const labAssetRepo = new InMemoryLabAssetRepository();
  await labAssetRepo.createRecipeRecord(makeRecipeRecord("recipe-1"), makeRecipeVersion("recipe-1", 1));
  await labAssetRepo.createRecipeRecord(
    makeRecipeRecord("recipe-2", { name: "Analysis Scores" }),
    makeRecipeVersion("recipe-2", 1),
  );
  await labAssetRepo.createPoolRecord(makePoolRecord("pool-1"), makePoolVersion("pool-1", 1));
  for (const v of [2, 3, 4]) {
    const record = await labAssetRepo.getPoolRecord("pool-1");
    if (!record) throw new Error("pool record missing");
    await labAssetRepo.appendPoolVersion(makePoolVersion("pool-1", v), record.revision);
  }
  const evidenceRepo = new InMemoryEvidenceRepository();
  return { repo, evalRepo, labAssetRepo, evidenceRepo };
}

function renderView(seeded: Seeded, overrides: Partial<PolicyStudyViewProps> = {}): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <ViewWithStudy seeded={seeded} overrides={overrides} />
      </MemoryRouter>,
    );
  });
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
    text: () => container.textContent ?? "",
  };
}

function ViewWithStudy({
  seeded,
  overrides,
}: {
  seeded: Seeded;
  overrides: Partial<PolicyStudyViewProps>;
}) {
  const [study, setStudy] = useState<PolicyStudyRecord | null>(null);
  useEffect(() => {
    void seeded.repo.getStudy("study-1").then(setStudy);
  }, [seeded.repo]);
  if (!study) return null;
  return (
    <PolicyStudyView
      studyRepo={seeded.repo}
      evalRepo={seeded.evalRepo}
      labAssetRepo={seeded.labAssetRepo}
      evidenceRepo={seeded.evidenceRepo}
      study={study}
      lifecycle={LIFECYCLE}
      {...overrides}
    />
  );
}

// --- Verdict banner -----------------------------------------------------------------

describe("PolicyStudyView — verdict banner", () => {
  it("renders the adopt recommendation with claim framing, costs, and adequacy", async () => {
    const seeded = await seedCompleted();
    const h = renderView(seeded);
    await settle();

    const banner = h.$("[data-testid='verdict-banner']");
    expect(banner).toBeTruthy();
    expect(banner?.className).toMatch(/border-dashed/);
    expect(banner?.className).toMatch(/border-warning/);
    expect(banner?.getAttribute("role")).toBeNull();
    expect(banner?.textContent).toMatch(/Exploratory/);
    expect(banner?.textContent).toMatch(/RECOMMENDATION/);
    expect(banner?.textContent).toMatch(/Adopt Refine/);
    expect(banner?.textContent).toMatch(/Refine exceeds the predeclared MPID/);
    expect(banner?.textContent).toMatch(
      /Exploratory finding — confirm on a fresh Task Set Version before adopting\./,
    );
    expect(banner?.textContent).toMatch(/policy cost 1\.8×/);
    expect(banner?.textContent).toMatch(/pool adequacy: met/);
    expect(banner?.querySelector("a[href='#playbook']")).toBeTruthy();
    cleanup(h);
  });

  it("renders do_not_fuse with claim framing — never the error role — and no Recommended on Fuse", async () => {
    const seeded = await seedCompleted({
      recommendation: {
        kind: "do_not_fuse",
        rationale: "Rank matches Fuse within MPID at lower cost.",
      },
    });
    const h = renderView(seeded);
    await settle();

    const banner = h.$("[data-testid='verdict-banner']");
    expect(banner?.textContent).toMatch(/Do not fuse/);
    expect(banner?.textContent).toMatch(/Rank matches Fuse within MPID/);
    expect(banner?.getAttribute("role")).not.toBe("alert");
    expect(banner?.className).not.toMatch(/border-error/);

    const table = h.$("[data-testid='policy-table']");
    expect(table).toBeTruthy();
    const rows = [...(table?.querySelectorAll("tbody tr") ?? [])];
    const fuseRow = rows.find((r) => r.textContent?.includes("Fuse"));
    expect(fuseRow?.textContent).not.toMatch(/Recommended/);
    const bestRow = rows.find((r) => r.textContent?.includes("Best fixed"));
    expect(bestRow?.textContent).toMatch(/Recommended/);
    cleanup(h);
  });

  it("frames a confirmed study with the solid success frame and confirmed copy", async () => {
    const seeded = await seedCompleted();
    // Re-seed as a confirmed study linked to an exploratory source.
    const repo = new InMemoryStudyRepository();
    await repo.createStudy(makeStudyRecord({ id: "study-0", status: "completed", reportRef: "pb-0" }));
    const confirmedDefinition = makeDefinition({ claimPlan: "confirmation" });
    await repo.createStudy(
      makeStudyRecord({
        id: "study-1",
        claimLevel: "confirmed",
        confirmationOf: "study-0",
        definition: confirmedDefinition,
      }),
    );
    await repo.startStudy("study-1", 0, 1_500);
    await repo.createTrial(makeTrial("trial-a1", { stage: "A" }));
    await repo.appendObservation(makeObservation("obs-a1", "trial-a1", 0.8));
    await repo.createPlaybook(
      "pb-1",
      makePlaybook({
        rows: FOUR_ROWS,
        claimLevel: "confirmed",
        definitionFingerprint: fingerprintStudyValue(confirmedDefinition),
      }),
    );
    await repo.sealStudy("study-1", 1, "pb-1", 4_000);
    seeded.repo = repo;

    const h = renderView(seeded);
    await settle();
    const banner = h.$("[data-testid='verdict-banner']");
    expect(banner?.className).toMatch(/border-solid/);
    expect(banner?.className).toMatch(/border-success/);
    expect(banner?.textContent).toMatch(/Confirmed/);
    expect(banner?.textContent).toMatch(/Confirmed on Task Set v6 \(fresh holdout\)/);
    // Lineage chip links back to the exploratory source.
    expect(h.$("a[href='/lab/studies/study-0']")?.textContent).toMatch(/Confirms study-0/);
    cleanup(h);
  });
});

// --- Sealed inputs ----------------------------------------------------------------------

describe("PolicyStudyView — sealed inputs", () => {
  it("renders the pinned refs as working link chips with digests and blind judges", async () => {
    const seeded = await seedCompleted();
    const h = renderView(seeded);
    await settle();

    const inputs = h.$("#inputs");
    expect(inputs).toBeTruthy();
    expect(inputs?.textContent).toMatch(/Sealed/);
    expect(inputs?.textContent).toMatch(/fingerprint/);
    expect(h.$("a[href='/evaluations/sets/ts1']")).toBeTruthy();
    expect(h.$("a[href='/lab/model-pools/pool-1/versions/4']")).toBeTruthy();
    expect(h.$("a[href='/lab/recipes/recipe-1/versions/3']")).toBeTruthy();
    expect(h.$("a[href='/evaluations/rubrics/rub1']")).toBeTruthy();
    expect(inputs?.textContent).toMatch(/[Bb]lind/);
    expect(inputs?.textContent).toMatch(/MPID 0\.2/);
    expect(inputs?.textContent).toMatch(/claim plan: exploration/);
    // No form affordances after sealing.
    expect(inputs?.querySelector("input, select")).toBeNull();
    cleanup(h);
  });

  it("marks archived assets and unresolvable refs honestly", async () => {
    const seeded = await seedCompleted();
    // Archive the pool record; drop the recipe record entirely.
    await seeded.labAssetRepo.archivePoolRecord("pool-1", 0, 9_000);
    const definition = makeDefinition({
      fusionRecipes: [{ recipeId: "recipe-77", version: 4, digest: DIGEST }],
    });
    const repo = new InMemoryStudyRepository();
    await repo.createStudy(makeStudyRecord({ definition }));
    await repo.startStudy("study-1", 0, 1_500);
    await repo.createPlaybook("pb-1", makePlaybook({ rows: FOUR_ROWS, definitionFingerprint: fingerprintStudyValue(definition) }));
    await repo.sealStudy("study-1", 1, "pb-1", 4_000);
    seeded.repo = repo;

    const h = renderView(seeded);
    await settle();
    const inputs = h.$("#inputs");
    expect(inputs?.textContent).toMatch(/archived/i);
    expect(inputs?.textContent).toMatch(/recipe-77 v4 — not found in this database/);
    cleanup(h);
  });
});

// --- Stage sections -----------------------------------------------------------------------

describe("PolicyStudyView — stage sections", () => {
  it("renders Stage A family aggregates with the no-winner closing line", async () => {
    const seeded = await seedCompleted();
    const h = renderView(seeded);
    await settle();

    const stageA = h.$("#stage-a");
    expect(stageA).toBeTruthy();
    expect(stageA?.textContent).toMatch(/Eliminates recipe families/);
    expect(stageA?.textContent).toMatch(/Blind Raw/);
    expect(stageA?.textContent).toMatch(/Analysis Scores/);
    expect(stageA?.textContent).toMatch(/Stage A never selects a winning policy/);
    const region = stageA?.querySelector("[role='region']");
    expect(region?.getAttribute("aria-label")).toMatch(/— scrollable$/);
    expect(region?.getAttribute("tabindex")).toBe("0");
    cleanup(h);
  });

  it("renders the Stage B measured-pair table with real counts and adequacy qualifier", async () => {
    const seeded = await seedCompleted();
    const h = renderView(seeded);
    await settle();

    const stageB = h.$("#stage-b");
    expect(stageB).toBeTruthy();
    const pairs = stageB?.querySelector("[data-testid='pair-table']");
    expect(pairs).toBeTruthy();
    expect(pairs?.textContent).toMatch(/1 pair measured/);
    // Failure counts are real: trial-b1 carried one failed observation.
    expect(stageB?.textContent).toMatch(/1 failed/);
    expect(stageB?.textContent).toMatch(/pool adequacy: met/i);
    // Uncertainty & MPID block with paired verdicts.
    expect(stageB?.textContent).toMatch(/MPID \(predeclared\): 0\.2/);
    expect(stageB?.textContent).toMatch(/exceeds MPID/);
    expect(stageB?.textContent).toMatch(
      /paired on identical holdout tasks; dependency-aware; retries never add samples/,
    );
    cleanup(h);
  });

  it("renders Stage C with the recipe-sensitivity finding", async () => {
    const seeded = await seedCompleted();
    const h = renderView(seeded);
    await settle();

    const stageC = h.$("#stage-c");
    expect(stageC).toBeTruthy();
    expect(stageC?.textContent).toMatch(/Stable across prompt variants/);
    cleanup(h);
  });
});

// --- Policy table ---------------------------------------------------------------------------

describe("PolicyStudyView — policy comparison table", () => {
  it("renders all four policies in fixed order with seven columns and the recommendation marker", async () => {
    const seeded = await seedCompleted();
    const h = renderView(seeded);
    await settle();

    const table = h.$("[data-testid='policy-table']");
    expect(table).toBeTruthy();
    expect(table?.querySelectorAll("thead th")).toHaveLength(7);
    const rows = [...(table?.querySelectorAll("tbody tr") ?? [])];
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Best fixed"),
      expect.stringContaining("Rank"),
      expect.stringContaining("Fuse"),
      expect.stringContaining("Refine"),
    ]);
    const refineRow = rows[3]!;
    expect(refineRow.textContent).toMatch(/Recommended/);
    expect(refineRow.className).toMatch(/bg-accent\/5/);
    // Δ vs best fixed is em-dash on the baseline row, signed elsewhere.
    expect(rows[0]?.textContent).toContain("—");
    expect(rows[3]?.textContent).toMatch(/\+0\.15/);
    // Trials/failures per policy come from real trial data.
    expect(rows[3]?.textContent).toMatch(/1 · 0 failed/);
    expect(rows[1]?.textContent).toMatch(/1 · 0 failed/);
    // Caption carries scope + predeclared MPID.
    expect(h.text()).toMatch(/MPID 0\.2 predeclared/);
    // ≤768px card transformation is present as a role=list with fixed order.
    const cards = h.$("[data-testid='policy-cards']");
    expect(cards?.getAttribute("role")).toBe("list");
    expect(cards?.querySelectorAll("[role='listitem']")).toHaveLength(4);
    cleanup(h);
  });
});

// --- Playbook, boundary, records -------------------------------------------------------------

describe("PolicyStudyView — playbook, boundary, records", () => {
  it("renders the immutable playbook card with scope statement, split costs, and evidence links", async () => {
    const seeded = await seedCompleted();
    const h = renderView(seeded);
    await settle();

    const playbook = h.$("#playbook");
    expect(playbook).toBeTruthy();
    expect(playbook?.textContent).toMatch(/POLICY PLAYBOOK/);
    expect(playbook?.textContent).toMatch(
      /This playbook describes evidence for one pinned policy configuration and workload scope\./,
    );
    expect(playbook?.textContent).toMatch(/never applies itself automatically/);
    // Policy cost and experimental cost are separate cells, never one figure.
    expect(playbook?.textContent).toMatch(/Policy cost/);
    expect(playbook?.textContent).toMatch(/Experimental cost/);
    // Supporting evidence refs are exact ids.
    expect(playbook?.textContent).toMatch(/trial-a1/);
    expect(playbook?.textContent).toMatch(/obs-a1/);
    // Exploratory footer action.
    expect(playbook?.querySelector("[data-action='start-confirmation']")?.textContent).toMatch(
      /Start confirmation study/,
    );
    cleanup(h);
  });

  it("renders the evidence boundary ledger with an honest qualified count", async () => {
    const seeded = await seedCompleted();
    const h = renderView(seeded);
    await settle();

    const boundary = h.$("#boundary");
    expect(boundary).toBeTruthy();
    expect(boundary?.textContent).toMatch(/Stays in the Lab — policy evidence/);
    expect(boundary?.textContent).toMatch(/May leave the Lab — via ordinary eligibility/);
    expect(boundary?.textContent).toMatch(/Never attributed/);
    // One artifact run referenced; evidence store holds no canonical
    // observations for it — the count is honestly zero.
    expect(boundary?.textContent).toMatch(/0 qualified/);
    // Every model label inside policy-evidence tables carries the chip.
    const chips = h.$$("[data-testid='policy-evidence-chip']");
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0]?.getAttribute("aria-label")).toBe(
      "This result is policy evidence about the configuration, not evidence about this model.",
    );
    cleanup(h);
  });

  it("lists trials, attempts, and observations in a contained-scroll records region", async () => {
    const seeded = await seedCompleted();
    const h = renderView(seeded);
    await settle();

    const records = h.$("#records");
    expect(records).toBeTruthy();
    expect(records?.textContent).toMatch(/11 records · 1 failed · 1 treatment-changing retry/);
    expect(records?.textContent).toMatch(/trial-a1/);
    expect(records?.textContent).toMatch(/obs-b1f/);
    expect(records?.textContent).toMatch(/attempt-1/);
    expect(records?.textContent).toMatch(/trial-b1 → trial-b2/);
    const region = records?.querySelector("[role='region']");
    expect(region?.className).toMatch(/max-h-96/);
    expect(region?.className).toMatch(/overflow/);
    cleanup(h);
  });
});

// --- Dossier composition -----------------------------------------------------------------------

describe("PolicyStudyView — one-document dossier", () => {
  it("renders a section nav with anchors and zero tabs", async () => {
    const seeded = await seedCompleted();
    const h = renderView(seeded);
    await settle();

    expect(h.$$("[role='tab']")).toHaveLength(0);
    const nav = h.$("nav[aria-label='Study sections']");
    expect(nav).toBeTruthy();
    for (const anchor of ["#verdict", "#inputs", "#stage-a", "#stage-b", "#stage-c", "#playbook", "#boundary", "#records"]) {
      expect(nav?.querySelector(`a[href='${anchor}']`)).toBeTruthy();
    }
    expect(h.$("#verdict")).toBeTruthy();
    cleanup(h);
  });
});
