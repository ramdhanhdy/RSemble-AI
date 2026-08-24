// @vitest-environment happy-dom
// =============================================================================
// RED — Compare "Run with playbook" picker + cost preflight dialog
// (spec §8, Fable §6.9/D7, plan Task 10).
//
// Explicit-only semantics: the dialog lists sealed playbooks, evaluates
// compatibility against the CURRENT compare session, shows the recommended
// policy/configuration, claim level, policy vs baseline cost estimate, the
// predeclared MPID and pool-adequacy qualifier — and only an explicit confirm
// produces a run binding. Closing or cancelling never runs a playbook.
// =============================================================================
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { InMemoryStudyRepository } from "../../lib/persistence/study-repository";
import { InMemoryLabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import { InMemoryTaskSetRepository } from "../../lib/persistence/in-memory-task-set-repository";
import {
  DIGEST,
  makeDefinition,
  makePlaybook,
  makePoolRecord,
  makePoolVersion,
  makeRecipeRecord,
  makeRecipeVersion,
  makeStudyRecord,
} from "../lab/lab-test-fixtures";
import type { ModelSlot } from "../../studio-data";
import type { LabRecipeVersion } from "../../lib/studies/lab-recipe-types";
import type { ModelPoolVersion } from "../../lib/studies/model-pool-types";
import type {
  PolicyReportPayload,
  PolicyStudyRecord,
} from "../../lib/studies/policy/policy-study-types";
import type { TaskSetRecord, TaskSetVersion } from "../../lib/evaluations/task-set-types";
import {
  clearModelPricing,
  parseOpenRouterPricing,
  setModelPricing,
} from "../../lib/providers/pricing";
import type { PlaybookRunBinding } from "../../lib/compare/playbook-execution";
import { RunWithPlaybookDialog, type RunWithPlaybookDialogProps } from "./RunWithPlaybookDialog";

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
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await flush();
    });
  }
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const COMPATIBLE_SLOTS: ModelSlot[] = [
  {
    id: "ca",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "m-a",
    slug: "m-a",
    enabled: true,
  },
  { id: "cb", providerId: "umans", provider: "Umans", model: "m-b", slug: "m-b", enabled: true },
];

function makeTaskSetRecord(id = "ts1"): TaskSetRecord {
  return {
    id,
    latestVersion: 6,
    name: "Holdout workload",
    description: "",
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
    revision: 0,
    origin: "authored",
  };
}

function makeTaskSetVersion(taskSetId = "ts1", version = 6): TaskSetVersion {
  return {
    taskSetId,
    version,
    members: [
      {
        id: "mem-1",
        taskVersionRef: { taskId: "task-1", version: 3 },
        order: 0,
        role: "organic",
        stratum: null,
        weight: 1,
        rubricOverrideRef: null,
        executionOverrides: null,
        unresolved: null,
      },
    ],
    defaultRubricRef: null,
    defaultModelSlots: [],
    defaultJudge: { providerId: "openrouter", model: "judge" },
    repeatPolicy: { kind: "none" },
    missingnessPolicy: { kind: "strict" },
    protocolDefaults: {},
    createdAt: 1_000,
  };
}

interface WorldExtras {
  slots?: ModelSlot[];
  prompt?: string;
  running?: boolean;
}

interface SeededWorld {
  studyRepo: InMemoryStudyRepository;
  labAssetRepo: InMemoryLabAssetRepository;
  taskSetRepo: InMemoryTaskSetRepository;
  study: PolicyStudyRecord;
  playbook: PolicyReportPayload;
  pool: ModelPoolVersion;
  recipe: LabRecipeVersion;
}

async function seedWorld(): Promise<SeededWorld> {
  const studyRepo = new InMemoryStudyRepository();
  const labAssetRepo = new InMemoryLabAssetRepository();
  const taskSetRepo = new InMemoryTaskSetRepository();

  const pool = makePoolVersion("pool-1", 4, {
    core: [
      {
        id: "ca",
        providerId: "openrouter",
        provider: "OpenRouter",
        model: "m-a",
        slug: "m-a",
        enabled: true,
      },
      {
        id: "cb",
        providerId: "umans",
        provider: "Umans",
        model: "m-b",
        slug: "m-b",
        enabled: true,
      },
    ],
    challengers: [],
  });
  const recipe = makeRecipeVersion("recipe-1", 3);
  const definition = makeDefinition({
    modelPool: { poolId: pool.poolId, version: pool.version, digest: pool.digest },
    fusionRecipes: [{ recipeId: recipe.recipeId, version: recipe.version, digest: recipe.digest }],
  });
  const study = makeStudyRecord({
    id: "study-1",
    status: "completed",
    reportRef: "pb-1",
    definition,
  });
  const playbook = makePlaybook({
    studyId: study.id,
    definitionFingerprint: study.definitionFingerprint,
    recommendation: {
      kind: "adopt",
      policy: "fuse",
      configuration: "m-a × m-b · BlindRaw v3",
      rationale: "Fuse clears the predeclared MPID over best-fixed.",
    },
    poolAdequacy: {
      probed: true,
      outcome: "confirmed",
      note: "Challenger failed to beat the pool.",
    },
  });

  await labAssetRepo.createPoolRecord(makePoolRecord("pool-1"), makePoolVersion("pool-1", 1));
  let poolRev = 0;
  for (let v = 2; v <= 4; v++) {
    poolRev = await labAssetRepo.appendPoolVersion(
      makePoolVersion(
        "pool-1",
        v,
        v === 4 ? { core: pool.core, challengers: pool.challengers } : {},
      ),
      poolRev,
    );
  }
  await labAssetRepo.createRecipeRecord(
    makeRecipeRecord("recipe-1"),
    makeRecipeVersion("recipe-1", 1),
  );
  let recipeRev = 0;
  for (let v = 2; v <= 3; v++) {
    recipeRev = await labAssetRepo.appendRecipeVersion(makeRecipeVersion("recipe-1", v), recipeRev);
  }
  await studyRepo.createStudy(study);
  await studyRepo.createPlaybook("pb-1", playbook);
  await taskSetRepo.createTaskSet(
    { ...makeTaskSetRecord("ts1"), latestVersion: 1 },
    makeTaskSetVersion("ts1", 1),
  );
  let tsRev = 0;
  for (let v = 2; v <= 6; v++) {
    tsRev = await taskSetRepo.appendTaskSetVersion(
      { ...makeTaskSetRecord("ts1"), latestVersion: v, revision: tsRev },
      makeTaskSetVersion("ts1", v),
      tsRev,
    );
  }

  return { studyRepo, labAssetRepo, taskSetRepo, study, playbook, pool, recipe };
}

function renderDialog(
  repos: SeededWorld,
  onConfirmed: (binding: PlaybookRunBinding) => void,
  extras: WorldExtras = {},
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const props: RunWithPlaybookDialogProps = {
    open: true,
    onOpenChange: () => {},
    studyRepo: repos.studyRepo,
    labAssetRepo: repos.labAssetRepo,
    taskSetRepo: repos.taskSetRepo,
    slots: extras.slots ?? COMPATIBLE_SLOTS,
    critic: { providerId: "openrouter", model: "judge-model" },
    prompt: extras.prompt ?? "Which algorithm finds the shortest path?",
    taskBinding: null,
    taskSetContext: { taskSetId: "ts1", version: 6 },
    running: extras.running ?? false,
    onConfirmed,
  };
  act(() => {
    root.render(<RunWithPlaybookDialog {...props} />);
  });
  return {
    container,
    root,
    $: (s) => document.querySelector<HTMLElement>(s),
    $$: (s) => [...document.querySelectorAll<HTMLElement>(s)],
    text: () => document.body.textContent ?? "",
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

afterEach(() => {
  document.body.innerHTML = "";
  clearModelPricing();
});

describe("RunWithPlaybookDialog — explicit picker and preflight (spec §8)", () => {
  it("lists the sealed playbook with its claim level and recommendation", async () => {
    const repos = await seedWorld();
    const confirmed: PlaybookRunBinding[] = [];
    const h = renderDialog(repos, (b) => confirmed.push(b));
    await settle();

    expect(h.text()).toMatch(/Run with policy playbook|Policy Playbook/);
    // The completed study's playbook is offered; draft-only studies are not.
    expect(h.text()).toMatch(/Pair screening on holdout/);
    expect(h.text()).toMatch(/Exploratory/);
    expect(h.text()).toMatch(/Adopt Fuse/i);
    expect(h.text()).toMatch(/m-a × m-b · BlindRaw v3/);
    cleanup(h);
  });

  it("preflight shows recommended policy, claim level, policy vs baseline cost, MPID, and pool adequacy", async () => {
    const repos = await seedWorld();
    for (const slug of ["m-a", "judge-model", "acme/synth-1"]) {
      setModelPricing(
        parseOpenRouterPricing("openrouter", slug, { prompt: "1", completion: "2" }, 1)!,
      );
    }
    setModelPricing(parseOpenRouterPricing("umans", "m-b", { prompt: "1", completion: "2" }, 1)!);

    const h = renderDialog(repos, () => {});
    await settle();
    click(h.$("[data-testid='playbook-option-study-1']") as HTMLElement);
    await settle();

    const preflight = h.$("[data-testid='playbook-preflight']");
    expect(preflight).not.toBeNull();
    expect(preflight!.textContent).toMatch(/Recommended policy/i);
    expect(preflight!.textContent).toMatch(/Fuse/);
    expect(preflight!.textContent).toMatch(/Exploratory|Confirmed/);
    expect(preflight!.textContent).toMatch(/Estimated policy cost/i);
    expect(preflight!.textContent).toMatch(/Experimental baseline/i);
    expect(preflight!.textContent).toMatch(/MPID 0\.2/i);
    expect(preflight!.textContent).toMatch(/pool adequacy: confirmed/i);
    cleanup(h);
  });

  it("is honest when pricing is unavailable — no invented total", async () => {
    const repos = await seedWorld();
    const h = renderDialog(repos, () => {});
    await settle();
    click(h.$("[data-testid='playbook-option-study-1']") as HTMLElement);
    await settle();

    const preflight = h.$("[data-testid='playbook-preflight']");
    expect(preflight!.textContent).toMatch(/Estimated policy cost/i);
    // Unknown price surfaces as unknown — never a fabricated number.
    expect(preflight!.textContent).not.toMatch(/\$\d/);
    expect(preflight!.textContent).toMatch(/unknown|unavailable|partial/i);
    cleanup(h);
  });

  it("confirming produces an explicit binding with a preflight timestamp", async () => {
    const repos = await seedWorld();
    const confirmed: PlaybookRunBinding[] = [];
    const h = renderDialog(repos, (b) => confirmed.push(b));
    await settle();
    click(h.$("[data-testid='playbook-option-study-1']") as HTMLElement);
    await settle();

    const confirm = h.$("[data-action='confirm-playbook-run']") as HTMLElement;
    expect(confirm).not.toBeNull();
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    click(confirm);
    await settle();

    expect(confirmed).toHaveLength(1);
    const binding = confirmed[0];
    expect(binding.playbookId).toBe("pb-1");
    expect(binding.study.id).toBe("study-1");
    expect(binding.preflightConfirmedAt).toBeGreaterThan(0);
    expect(binding.compatibility.ok).toBe(true);
    expect(binding.playbook.recommendation).toMatchObject({ kind: "adopt", policy: "fuse" });
    cleanup(h);
  });

  it("closing or cancelling NEVER attaches or runs a playbook", async () => {
    const repos = await seedWorld();
    const confirmed: PlaybookRunBinding[] = [];
    const h = renderDialog(repos, (b) => confirmed.push(b));
    await settle();
    click(h.$("[data-testid='playbook-option-study-1']") as HTMLElement);
    await settle();

    click(h.$("[data-action='cancel-playbook-run']") as HTMLElement);
    await settle();
    expect(confirmed).toHaveLength(0);
    cleanup(h);
  });

  it("blocks confirmation with an honest reason when the current roster is not pool-compatible", async () => {
    const repos = await seedWorld();
    const outsideSlots: ModelSlot[] = [
      ...COMPATIBLE_SLOTS,
      {
        id: "cz",
        providerId: "gemini",
        provider: "Gemini",
        model: "m-z",
        slug: "m-z",
        enabled: true,
      },
    ];
    const confirmed: PlaybookRunBinding[] = [];
    const h = renderDialog(repos, (b) => confirmed.push(b), { slots: outsideSlots });
    await settle();
    click(h.$("[data-testid='playbook-option-study-1']") as HTMLElement);
    await settle();

    expect(h.text()).toMatch(/not.*pool|pool.*member/i);
    const confirm = h.$("[data-action='confirm-playbook-run']") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    cleanup(h);
    expect(confirmed).toHaveLength(0);
  });

  it("shows the playbook scope statement — never a global rule", async () => {
    const repos = await seedWorld();
    const h = renderDialog(repos, () => {});
    await settle();
    click(h.$("[data-testid='playbook-option-study-1']") as HTMLElement);
    await settle();
    expect(h.text()).toMatch(/never applies itself automatically/);
    cleanup(h);
  });
  it("blocks confirmation when the study adopts fusion but the recipe is unresolved", async () => {
    const repos = await seedWorld();
    const definitionWithoutRecipe = makeDefinition({
      modelPool: {
        poolId: repos.pool.poolId,
        version: repos.pool.version,
        digest: repos.pool.digest,
      },
      fusionRecipes: [{ recipeId: "recipe-missing", version: 1, digest: DIGEST }],
    });
    const study = makeStudyRecord({
      id: "study-no-recipe",
      status: "completed",
      reportRef: "pb-no-recipe",
      definition: definitionWithoutRecipe,
    });
    const playbook = makePlaybook({
      studyId: study.id,
      definitionFingerprint: study.definitionFingerprint,
      recommendation: {
        kind: "adopt",
        policy: "fuse",
        configuration: "m-a × m-b",
        rationale: "Fuse recommendation.",
      },
    });
    await repos.studyRepo.createStudy(study);
    await repos.studyRepo.createPlaybook("pb-no-recipe", playbook);

    const confirmed: PlaybookRunBinding[] = [];
    const h = renderDialog(repos, (b) => confirmed.push(b));
    await settle();
    click(h.$("[data-testid='playbook-option-study-no-recipe']") as HTMLElement);
    await settle();

    expect(h.text()).toMatch(/recipe unresolved/i);
    const confirm = h.$("[data-action='confirm-playbook-run']") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    click(confirm);
    await settle();
    expect(confirmed).toHaveLength(0);
    cleanup(h);
  });
});

describe("RunWithPlaybookDialog — design-system tokens and ClaimBadge reuse (F6, Fable §4.1/§6.9)", () => {
  const UNDEFINED_TOKENS = [
    "text-dim",
    "bg-surface",
    "bg-surface-elevated",
    "bg-muted",
    "hover:bg-surface",
    "hover:bg-surface-elevated",
    "bg-accent-hover",
  ];

  it("reuses ClaimBadge for the claim level instead of inline colored badge spans", async () => {
    const repos = await seedWorld();
    const h = renderDialog(repos, () => {});
    await settle();
    click(h.$("[data-testid='playbook-option-study-1']") as HTMLElement);
    await settle();

    const badges = h.$$("[data-testid='claim-badge']");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0]?.textContent).toMatch(/Exploratory|Confirmed/);
    cleanup(h);
  });

  it("uses only real design-system tokens — no undefined Tailwind tokens", async () => {
    const repos = await seedWorld();
    const h = renderDialog(repos, () => {});
    await settle();
    click(h.$("[data-testid='playbook-option-study-1']") as HTMLElement);
    await settle();

    const offenders: string[] = [];
    const all = document.body.querySelectorAll("*");
    for (const el of all) {
      const cls = el.getAttribute("class");
      if (!cls) continue;
      for (const tok of UNDEFINED_TOKENS) {
        if (cls.includes(tok)) offenders.push(`${tok}: "${cls}"`);
      }
    }
    expect(offenders).toEqual([]);
    cleanup(h);
  });
});
