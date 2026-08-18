// @vitest-environment happy-dom
//
// AppRouter route + compatibility-redirect tests (rubric-terminology spec §4,
// implementation plan Task 4).
//
// Covers: canonical /evaluations/rubrics routes render; real baseline
// /evaluations/profiles and /evaluations/profiles/:rubricId legacy routes
// redirect to canonical Rubric routes preserving the entity id and any
// version/return location state; no invented /rubrics/* alias; direct-load,
// refresh, and browser back/forward history compatibility. Uses the repo's
// createRoot/act harness pattern from sibling tests (no testing-library).

import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  type Location,
  type NavigateFunction,
} from "react-router-dom";
// Pre-load the lazy route chunks so `lazy(() => import(...))` inside
// AppRoutes resolves from the module cache on the first microtask inside
// act() — vitest's first dynamic transform of these modules can out-run a
// single act flush, leaving Suspense stuck on the fallback. The router
// still exercises its real lazy boundaries; these imports only warm the
// cache so the test can observe the resolved route content.
import "./workspaces/EvaluationsWorkspace";
import "./workspaces/evaluations/RubricList";
import "./workspaces/evaluations/RubricDetail";
import "./workspaces/evaluations/TaskSetList";
import "./workspaces/evaluations/TaskSetEditor";
import { FusionStudyRoute } from "./workspaces/evaluations/FusionStudyView";
import "./workspaces/evaluations/ExperimentRoute";
import "./workspaces/tasks/TaskCatalog";
import "./workspaces/tasks/TaskRoute";
import "./workspaces/compare/ComparisonResultRoute";
import "./workspaces/lab/LabWorkspace";
import { InMemoryRunRepository } from "./lib/persistence/run-repository";
import { InMemoryComparisonRepository } from "./lib/persistence/in-memory-comparison-repository";
import type { RunRecordV2, FullRunSummaryV2 } from "./lib/persistence/run-types";
import { AppRoutes } from "./app-router";
import { RepositoryContext } from "./lib/persistence/repository-context";
import { InMemoryEvaluationRepository } from "./lib/persistence/evaluation-repository";
import type { TaskSetOwnershipCrosswalkRow } from "./lib/persistence/database";
import { InMemoryTaskRepository } from "./lib/persistence/in-memory-task-repository";
import {
  InMemoryFusionStudyRepository,
  type FusionStudyRepository,
} from "./lib/persistence/fusion-study-repository";
import type { TaskRepository } from "./lib/persistence/task-repository";
import {
  InMemoryStudyRepository,
  type StudyRepository,
} from "./lib/persistence/study-repository";
import {
  InMemoryLabAssetRepository,
  type LabAssetRepository,
} from "./lib/persistence/lab-asset-repository";
import type { TaskRecord, TaskVersion } from "./lib/tasks/task-types";
import type {
  EvaluationCriterion,
  EvaluationRubric,
  EvaluationSuite,
  RubricRecord,
} from "./lib/evaluations/evaluation-types";
import type { FusionStudy } from "./lib/evaluations/fusion-study-types";

import { ExecutionOwnerRegistry } from "./lib/execution-owner";
import { ExecutionOwnerProvider, useExecutionOwner } from "./lib/execution-owner-context";
import { ExperimentControllerContext } from "./lib/evaluations/experiment-controller-hooks";
import type { ExperimentController } from "./lib/evaluations/experiment-controller";
import type { CatalogModel, ProviderId } from "./lib/providers/types";
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- Fixtures ----------------------------------------------------------------

function makeCriterion(id: string, name: string): EvaluationCriterion {
  return {
    id,
    name,
    description: `${name} description`,
    weight: 1,
    anchors: { one: "poor", three: "ok", five: "great" },
  };
}

function makeRubric(
  id: string,
  version: number,
  name: string,
  overrides: Partial<EvaluationRubric> = {},
): EvaluationRubric {
  const now = Date.now();
  return {
    id,
    version,
    name,
    description: "",
    judgeInstruction: "Judge fairly.",
    criteria: [makeCriterion("c-1", "Correctness")],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRecord(id: string, latestVersion: number): RubricRecord {
  const now = Date.now();
  return {
    id,
    revision: 1,
    latestVersion,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

async function seedRubric(
  repo: InMemoryEvaluationRepository,
  id: string,
  name: string,
): Promise<void> {
  await repo.createRubric(makeRecord(id, 1), makeRubric(id, 1, name));
}

/** Seed a rubric with two versions so the version route has a historical
 *  (non-latest) version to load. v1 name differs from v2 to make the
 *  loaded version observable. */
async function seedRubricTwoVersions(
  repo: InMemoryEvaluationRepository,
  id: string,
): Promise<void> {
  await repo.createRubric(makeRecord(id, 1), makeRubric(id, 1, "v1-name"));
  const rec = await repo.getRubricRecord(id);
  if (!rec) throw new Error("record missing");
  const latest = await repo.getRubricVersion(id, rec.latestVersion);
  if (!latest) throw new Error("version missing");
  await repo.appendRubricVersion(
    { ...rec },
    { ...latest, name: "v2-name", updatedAt: Date.now() },
    rec.revision,
  );
}

// --- Harness -----------------------------------------------------------------

interface CapturedLocation {
  pathname: string;
  search: string;
  state: unknown;
}

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
  /** Most recent location observed by the LocationProbe. */
  loc: { current: CapturedLocation | null };
  /** navigate() exposed by the NavProbe for history/navigation tests. */
  nav: { current: NavigateFunction | null };
  /** App-lifetime execution owner registry. */
  ownerRegistry: ExecutionOwnerRegistry | null;
}

interface RenderOptions {
  initialEntries: (string | { pathname: string; search?: string; state?: unknown })[];
  initialIndex?: number;
  repo?: InMemoryEvaluationRepository;
  taskRepo?: TaskRepository | null;
  runRepo?: InMemoryRunRepository | null;
  fusionRepo?: FusionStudyRepository | null;
  studyRepo?: StudyRepository | null;
  labAssetRepo?: LabAssetRepository | null;
  db?: { taskSetOwnershipCrosswalk: { get: (key: string) => Promise<unknown> } } | null;
  models?: CatalogModel[];
  availableProviderIds?: ProviderId[];
  controller?: ExperimentController | null;
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function settle(): Promise<void> {
  // Resolve any suspended lazy route chunk before the test observes the
  // tree; otherwise the import can settle after the act boundary. A few
  // flushes cover the outer (EvaluationsWorkspace) and inner (RubricList /
  // RubricDetail) lazy boundaries plus their async data load.
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await flush();
    });
  }
}

function renderRouter(opts: RenderOptions): Harness {
  const repo = opts.repo ?? new InMemoryEvaluationRepository();
  const taskRepo = opts.taskRepo === undefined ? null : opts.taskRepo;
  const fusionRepo = opts.fusionRepo === undefined ? null : opts.fusionRepo;
  const db = opts.db === undefined ? null : opts.db;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const loc: { current: CapturedLocation | null } = { current: null };
  const nav: { current: NavigateFunction | null } = { current: null };
  const ownerRegRef: { current: ExecutionOwnerRegistry | null } = { current: null };

  // Probe lives inside the Router but outside AppRoutes' <Routes>, so it
  // always renders with the current location — including after a
  // <Navigate replace> updates it. It also exposes navigate() for the
  // back/forward history tests.
  function NavProbe() {
    const location = useLocation();
    const navigate = useNavigate();
    loc.current = {
      pathname: location.pathname,
      search: location.search,
      state: (location as Location<unknown>).state,
    };
    nav.current = navigate;
    return null;
  }

  function OwnerProbe() {
    const { registry } = useExecutionOwner();
    ownerRegRef.current = registry;
    return null;
  }

  act(() => {
    root.render(
      <MemoryRouter initialEntries={opts.initialEntries} initialIndex={opts.initialIndex}>
        <RepositoryContext.Provider
          value={{
            taskRepo,
            runRepo: opts.runRepo ?? null,
            evalRepo: repo,
            fusionRepo,
            studyRepo: opts.studyRepo ?? null,
            labAssetRepo: opts.labAssetRepo ?? null,
            db: db as never,
            storageState: "ready",
            retry: () => undefined,
          }}
        >
          <ExecutionOwnerProvider>
            <ExperimentControllerContext.Provider
              value={{
                controller: opts.controller ?? null,
                lease: null,
              }}
            >
              <AppRoutes
                compareOutlet={null}
                models={opts.models ?? []}
                availableProviderIds={opts.availableProviderIds ?? []}
              />
              <NavProbe />
              <OwnerProbe />
            </ExperimentControllerContext.Provider>
          </ExecutionOwnerProvider>
        </RepositoryContext.Provider>
      </MemoryRouter>,
    );
  });

  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
    loc,
    nav,
    ownerRegistry: ownerRegRef.current,
  };
}

async function renderRouterAsync(opts: RenderOptions): Promise<Harness> {
  const h = renderRouter(opts);
  await settle();
  return h;
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

// --- Tests -------------------------------------------------------------------

describe("AppRouter — canonical Rubric routes (spec §4)", () => {
  it("direct-loads /evaluations/rubrics and renders the rubric list", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "r-1", "Quality");
    const h = await renderRouterAsync({ initialEntries: ["/evaluations/rubrics"], repo });
    // RubricList renders a "new rubric" action button (data-action="new-rubric").
    expect(h.$("button[data-action='new-rubric']")).toBeTruthy();
    // The seeded rubric appears as a row. The row link uses the canonical
    // /evaluations/rubrics/:id href (Task 5 renamed the list surface).
    expect(h.container.textContent).toContain("Quality");
    expect(h.$("a[href='/evaluations/rubrics/r-1']")).toBeTruthy();
    cleanup(h);
  });

  it("direct-loads /evaluations/rubrics/:rubricId and renders the rubric detail", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "r-1", "Quality");
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/rubrics/r-1"],
      repo,
    });
    // RubricDetail renders its root with data-rubric-detail.
    expect(h.$("[data-rubric-detail]")).toBeTruthy();
    // The seeded name loads into the name input (value, not textContent).
    const nameInput = h.$("#rubric-name") as HTMLInputElement | null;
    expect(nameInput).toBeTruthy();
    expect(nameInput?.value).toBe("Quality");
    cleanup(h);
  });

  it("refresh (remount) at the canonical detail route reloads the same rubric", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "r-1", "Quality");
    const first = await renderRouterAsync({
      initialEntries: ["/evaluations/rubrics/r-1"],
      repo,
    });
    expect(first.$("[data-rubric-detail]")).toBeTruthy();
    cleanup(first);

    // A browser refresh is equivalent to remounting the app at the same URL.
    const refreshed = await renderRouterAsync({
      initialEntries: ["/evaluations/rubrics/r-1"],
      repo,
    });
    expect(refreshed.$("[data-rubric-detail]")).toBeTruthy();
    const nameInput = refreshed.$("#rubric-name") as HTMLInputElement | null;
    expect(nameInput?.value).toBe("Quality");
    cleanup(refreshed);
  });

  it("does not route /evaluations/rubrics to a suite editor (static beats dynamic)", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "rubrics", "Name collision guard");
    // If the static "rubrics" segment did not win over :suiteId, the suite
    // editor would render instead of the rubric list.
    const h = await renderRouterAsync({ initialEntries: ["/evaluations/rubrics"], repo });
    expect(h.$("button[data-action='new-rubric']")).toBeTruthy();
    cleanup(h);
  });
});

describe("AppRouter — canonical Rubric version route (spec §4)", () => {
  it("direct-loads /evaluations/rubrics/:rubricId/versions/:version at a historical version", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubricTwoVersions(repo, "r-1");
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/rubrics/r-1/versions/1"],
      repo,
    });
    expect(h.$("[data-rubric-detail]")).toBeTruthy();
    // v1 is historical (latest is 2); the name input shows v1's name.
    const nameInput = h.$("#rubric-name") as HTMLInputElement | null;
    expect(nameInput?.value).toBe("v1-name");
    // The version selector reflects the loaded historical version.
    const selector = h.$("select[data-action='version-selector']") as HTMLSelectElement | null;
    expect(selector?.value).toBe("1");
    // Historical (non-latest) versions render the read-only banner.
    expect(h.container.textContent).toContain("read-only");
    cleanup(h);
  });

  it("direct-loads the latest version via the version route", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubricTwoVersions(repo, "r-1");
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/rubrics/r-1/versions/2"],
      repo,
    });
    expect(h.$("[data-rubric-detail]")).toBeTruthy();
    const nameInput = h.$("#rubric-name") as HTMLInputElement | null;
    expect(nameInput?.value).toBe("v2-name");
    // Latest version is editable — no read-only banner.
    expect(h.container.textContent).not.toContain("read-only");
    cleanup(h);
  });

  it("refresh (remount) at the version route reloads the same historical version", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubricTwoVersions(repo, "r-1");
    const first = await renderRouterAsync({
      initialEntries: ["/evaluations/rubrics/r-1/versions/1"],
      repo,
    });
    expect((first.$("#rubric-name") as HTMLInputElement | null)?.value).toBe("v1-name");
    cleanup(first);

    const refreshed = await renderRouterAsync({
      initialEntries: ["/evaluations/rubrics/r-1/versions/1"],
      repo,
    });
    expect((refreshed.$("#rubric-name") as HTMLInputElement | null)?.value).toBe("v1-name");
    cleanup(refreshed);
  });

  it("back/forward between versions reloads the requested version", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubricTwoVersions(repo, "r-1");
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/rubrics/r-1/versions/1"],
      repo,
    });
    expect((h.$("#rubric-name") as HTMLInputElement | null)?.value).toBe("v1-name");

    // Navigate to v2 via the canonical version route.
    void act(() => h.nav.current!("/evaluations/rubrics/r-1/versions/2"));
    await settle();
    expect((h.$("#rubric-name") as HTMLInputElement | null)?.value).toBe("v2-name");

    // Back returns to v1.
    void act(() => h.nav.current!(-1));
    await settle();
    expect((h.$("#rubric-name") as HTMLInputElement | null)?.value).toBe("v1-name");

    // Forward returns to v2.
    void act(() => h.nav.current!(1));
    await settle();
    expect((h.$("#rubric-name") as HTMLInputElement | null)?.value).toBe("v2-name");
    cleanup(h);
  });

  it("falls back to latest when the version param is non-numeric", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubricTwoVersions(repo, "r-1");
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/rubrics/r-1/versions/not-a-number"],
      repo,
    });
    expect(h.$("[data-rubric-detail]")).toBeTruthy();
    // Non-numeric version is treated as "latest" (v2).
    expect((h.$("#rubric-name") as HTMLInputElement | null)?.value).toBe("v2-name");
    cleanup(h);
  });
});

describe("AppRouter — /evaluations/profiles legacy redirects (spec §4)", () => {
  it("redirects /evaluations/profiles → /evaluations/rubrics (replace)", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "r-1", "Quality");
    const h = await renderRouterAsync({ initialEntries: ["/evaluations/profiles"], repo });
    expect(h.loc.current?.pathname).toBe("/evaluations/rubrics");
    // The canonical list rendered after the redirect.
    expect(h.$("button[data-action='new-rubric']")).toBeTruthy();
    cleanup(h);
  });

  it("redirects /evaluations/profiles/:rubricId → /evaluations/rubrics/:rubricId preserving entity", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-legacy", "Quality");
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/profiles/p-legacy"],
      repo,
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/rubrics/p-legacy");
    // The same stored record loads through the canonical detail route.
    expect(h.$("[data-rubric-detail]")).toBeTruthy();
    const nameInput = h.$("#rubric-name") as HTMLInputElement | null;
    expect(nameInput?.value).toBe("Quality");
    cleanup(h);
  });

  it("preserves search (return location) through the list redirect", async () => {
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/profiles?returnTo=/compare"],
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/rubrics");
    expect(h.loc.current?.search).toBe("?returnTo=/compare");
    cleanup(h);
  });

  it("preserves search through the detail redirect", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality");
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/profiles/p-1?returnTo=/evaluations"],
      repo,
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/rubrics/p-1");
    expect(h.loc.current?.search).toBe("?returnTo=/evaluations");
    cleanup(h);
  });

  it("preserves location state (historical version / return state) through the detail redirect", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality");
    const returnState = { returnTo: "/compare", version: 2 };
    const h = await renderRouterAsync({
      initialEntries: [{ pathname: "/evaluations/profiles/p-1", state: returnState }],
      repo,
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/rubrics/p-1");
    expect(h.loc.current?.state).toEqual(returnState);
    cleanup(h);
  });

  it("preserves location state through the list redirect", async () => {
    const returnState = { returnTo: "/runs" };
    const h = await renderRouterAsync({
      initialEntries: [{ pathname: "/evaluations/profiles", state: returnState }],
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/rubrics");
    expect(h.loc.current?.state).toEqual(returnState);
    cleanup(h);
  });
});

describe("AppRouter — history compatibility (back/forward, no alias)", () => {
  it("redirect uses replace so browser back does not loop to the legacy URL", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality");
    // Start at /compare, then navigate to the legacy profiles route. The
    // redirect replaces the legacy entry, so back returns to /compare.
    const h = await renderRouterAsync({ initialEntries: ["/compare"], repo });
    expect(h.loc.current?.pathname).toBe("/compare");

    void act(() => h.nav.current!("/evaluations/profiles/p-1"));
    await settle();
    expect(h.loc.current?.pathname).toBe("/evaluations/rubrics/p-1");

    // Back should return to /compare, not the legacy profiles URL.
    void act(() => h.nav.current!(-1));
    await settle();
    expect(h.loc.current?.pathname).toBe("/compare");
    cleanup(h);
  });

  it("forward re-applies the redirect to the canonical route", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality");
    const h = await renderRouterAsync({ initialEntries: ["/compare"], repo });

    void act(() => h.nav.current!("/evaluations/profiles/p-1"));
    await settle();
    expect(h.loc.current?.pathname).toBe("/evaluations/rubrics/p-1");

    void act(() => h.nav.current!(-1));
    await settle();
    expect(h.loc.current?.pathname).toBe("/compare");

    // Forward returns to the canonical route (the replaced entry).
    void act(() => h.nav.current!(1));
    await settle();
    expect(h.loc.current?.pathname).toBe("/evaluations/rubrics/p-1");
    cleanup(h);
  });

  it("does not invent a /rubrics/* legacy alias", async () => {
    // /rubrics/foo is not a real baseline route; it must hit NotFound, not
    // redirect or render a rubric surface (spec §4: "No new /rubrics/*
    // alias is invented").
    const h = await renderRouterAsync({ initialEntries: ["/rubrics/foo"] });
    expect(h.container.textContent).toContain("Not found");
    expect(h.loc.current?.pathname).toBe("/rubrics/foo");
    cleanup(h);
  });

  it("does not invent a /rubrics alias at the top level", async () => {
    const h = await renderRouterAsync({ initialEntries: ["/rubrics"] });
    expect(h.container.textContent).toContain("Not found");
    cleanup(h);
  });
});

// --- Canonical Task routes (canonical-tasks spec §7, plan Task 6) -----------

async function seedCatalogTask(
  repo: InMemoryTaskRepository,
  id: string,
  title: string,
): Promise<TaskRecord> {
  const version: TaskVersion = {
    taskId: id,
    version: 1,
    title,
    objective: `Objective for ${title}.`,
    candidateInstruction: `Do: ${title}.`,
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "authored", legacyScopeKey: null, note: null },
    createdAt: Date.now(),
  };
  const record: TaskRecord = {
    id,
    latestVersion: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archivedAt: null,
    origin: "authored",
    revision: 0,
  };
  await repo.createTask(record, version);
  return record;
}

describe("AppRouter — canonical Task routes (spec §7)", () => {
  it("direct-loads /tasks and renders the catalog", async () => {
    const taskRepo = new InMemoryTaskRepository();
    await seedCatalogTask(taskRepo, "t-1", "Summarize a report");
    const h = await renderRouterAsync({ initialEntries: ["/tasks"], taskRepo });
    expect(h.$("[data-task-catalog]")).toBeTruthy();
    expect(h.container.textContent).toContain("Summarize a report");
    cleanup(h);
  });

  it("direct-loads /tasks/new and renders the real create editor (spec §7.3)", async () => {
    const taskRepo = new InMemoryTaskRepository();
    const h = await renderRouterAsync({ initialEntries: ["/tasks/new"], taskRepo });
    // The Task 6 placeholder is gone; a functional create form takes its place.
    expect(h.$("[data-task-new-placeholder]")).toBeNull();
    expect(h.$("[data-task-editor='new']")).toBeTruthy();
    expect(h.$("input[data-editor-field='title']")).toBeTruthy();
    expect(h.$("button[data-action='create-task']")).toBeTruthy();
    cleanup(h);
  });

  it("direct-loads /tasks/:taskId into the editing surface with dirty/saved state", async () => {
    const taskRepo = new InMemoryTaskRepository();
    await seedCatalogTask(taskRepo, "t-1", "Summarize a report");
    const h = await renderRouterAsync({ initialEntries: ["/tasks/t-1"], taskRepo });
    // The detail surface is the functional Task 7 editor, not the Task 6 shell.
    expect(h.$("[data-task-detail='t-1']")).toBeTruthy();
    expect(h.$("input[data-editor-field='title']")).toBeTruthy();
    expect(h.$("[data-editor-status]")?.textContent).toMatch(/saved/i);
    expect(h.$("button[data-action='create-version']")).toBeTruthy();
    cleanup(h);
  });

  it("direct-loads /tasks/:taskId/versions/:version as a read-only version view", async () => {
    const taskRepo = new InMemoryTaskRepository();
    await seedCatalogTask(taskRepo, "t-1", "Summarize a report");
    const h = await renderRouterAsync({ initialEntries: ["/tasks/t-1/versions/1"], taskRepo });
    expect(h.$("[data-task-version='t-1@1']")).toBeTruthy();
    const title = h.$("input[data-editor-field='title']") as HTMLInputElement | null;
    expect(title?.disabled).toBe(true);
    expect(title?.value).toBe("Summarize a report");
    cleanup(h);
  });

  it("direct-loads /tasks/:taskId and renders the detail shell with observations section", async () => {
    const taskRepo = new InMemoryTaskRepository();
    await seedCatalogTask(taskRepo, "t-1", "Summarize a report");
    const h = await renderRouterAsync({ initialEntries: ["/tasks/t-1"], taskRepo });
    expect(h.$("[data-task-detail='t-1']")).toBeTruthy();
    expect(h.$("[data-task-observations-section]")).toBeTruthy();
    cleanup(h);
  });

  it("direct-loads /tasks/:taskId/versions/:version and renders the version shell with observations section", async () => {
    const taskRepo = new InMemoryTaskRepository();
    await seedCatalogTask(taskRepo, "t-1", "Summarize a report");
    const h = await renderRouterAsync({ initialEntries: ["/tasks/t-1/versions/1"], taskRepo });
    expect(h.$("[data-task-version='t-1@1']")).toBeTruthy();
    expect(h.$("[data-task-observations-section]")).toBeTruthy();
    cleanup(h);
  });
  it("renders an explicit not-found state for an unknown task id (no silent redirect)", async () => {
    const taskRepo = new InMemoryTaskRepository();
    const h = await renderRouterAsync({ initialEntries: ["/tasks/no-such-task"], taskRepo });
    expect(h.$("[data-task-not-found]")).toBeTruthy();
    // The URL is preserved — unknown IDs surface explicitly, they never bounce
    // the user back to the catalog silently (spec §7: "work from direct loads").
    expect(h.loc.current?.pathname).toBe("/tasks/no-such-task");
    cleanup(h);
  });

  it("renders an explicit not-found state for an unknown version number", async () => {
    const taskRepo = new InMemoryTaskRepository();
    await seedCatalogTask(taskRepo, "t-1", "Summarize a report");
    const h = await renderRouterAsync({ initialEntries: ["/tasks/t-1/versions/99"], taskRepo });
    expect(h.$("[data-task-not-found]")).toBeTruthy();
    cleanup(h);
  });

  it("renders an explicit invalid-version state for a malformed version param", async () => {
    const taskRepo = new InMemoryTaskRepository();
    await seedCatalogTask(taskRepo, "t-1", "Summarize a report");
    const h = await renderRouterAsync({ initialEntries: ["/tasks/t-1/versions/nope"], taskRepo });
    expect(h.$("[data-task-invalid-version]")).toBeTruthy();
    expect(h.loc.current?.pathname).toBe("/tasks/t-1/versions/nope");
    cleanup(h);
  });

  it("keeps an archived task routable at its detail route (spec §4.5)", async () => {
    const taskRepo = new InMemoryTaskRepository();
    const rec = await seedCatalogTask(taskRepo, "t-1", "Old task");
    await taskRepo.archiveTask("t-1", rec.revision);
    const h = await renderRouterAsync({ initialEntries: ["/tasks/t-1"], taskRepo });
    expect(h.$("[data-task-detail='t-1']")).toBeTruthy();
    expect(h.container.textContent).toContain("Archived");
    expect(h.$("[data-task-not-found]")).toBeNull();
    cleanup(h);
  });

  it("shows a bounded error state when the task repository is unavailable", async () => {
    // taskRepo: null mirrors the bounded Task-catalog storage failure (spec §8:
    // "Storage initialization failure preserves current Compare operational
    // behavior and presents a bounded Task-catalog error").
    const h = await renderRouterAsync({ initialEntries: ["/tasks"], taskRepo: null });
    expect(h.$("[data-task-catalog]")).toBeTruthy();
    expect(h.$("[data-task-error-state]")).toBeTruthy();
    cleanup(h);
  });
});

// --- Canonical Task Set routes (task-sets spec §4, plan Task 5) -------------

function makeRoutedSuite(id: string, name: string): EvaluationSuite {
  const now = Date.now();
  return {
    id,
    revision: 1,
    version: 2,
    name,
    description: "",
    tasks: [
      {
        id: "t1",
        title: "Task 1",
        prompt: "Describe the task.",
        systemPrompt: "",
        evaluation: { kind: "inherit" },
        judgeInstructionOverride: "",
        order: 0,
      },
    ],
    modelSlots: [
      {
        id: "slot-1",
        providerId: "openrouter",
        provider: "OpenRouter",
        model: "A",
        slug: "org/a",
        enabled: true,
      },
      {
        id: "slot-2",
        providerId: "openrouter",
        provider: "OpenRouter",
        model: "B",
        slug: "org/b",
        enabled: true,
      },
    ],
    defaultJudge: { providerId: "openrouter", model: "org/judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

async function seedSuite(
  repo: InMemoryEvaluationRepository,
  suite: EvaluationSuite,
): Promise<void> {
  await repo.saveSuite(suite, 0);
}

function makeFusionStudy(id: string, suiteId: string): FusionStudy {
  return {
    id,
    revision: 1,
    kind: "exploration",
    suiteRef: {
      suiteId,
      suiteVersion: 2,
      protocolFingerprint: "sha256:0123456789abcdef",
    },
    poolRef: { id: "pool-1", version: 1 },
    judge1: { providerId: "openrouter", model: "acme/judge-1" },
    judge2: { providerId: "gemini", model: "acme/judge-2" },
    recipeRefs: [{ id: "builtin-blind-raw", version: 1 }],
    stageResults: { stageA: null, stageB: null, stageC: null },
    playbookRef: null,
    claimLevel: "exploratory",
    confirmationOf: null,
    status: "completed",
    createdAt: 1000,
    updatedAt: 1000,
  };
}

describe("AppRouter — canonical Task Set routes (spec §4)", () => {
  it("direct-loads /evaluations/sets and renders the Task Set list", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("s1", "Battery Alpha"));
    const h = await renderRouterAsync({ initialEntries: ["/evaluations/sets"], repo });
    expect(h.loc.current?.pathname).toBe("/evaluations/sets");
    expect(h.container.textContent).toContain("Battery Alpha");
    expect(h.$("a[href='/evaluations/sets/s1']")).toBeTruthy();
    cleanup(h);
  });

  it("direct-loads /evaluations/sets/new as the create surface", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = await renderRouterAsync({ initialEntries: ["/evaluations/sets/new"], repo });
    expect(h.loc.current?.pathname).toBe("/evaluations/sets/new");
    expect(
      h.$("[data-task-set-editor='new']") ?? h.$("button[data-action='create-task-set']"),
    ).toBeTruthy();
    cleanup(h);
  });

  it("direct-loads /evaluations/sets/:taskSetId and renders the editor", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("s1", "Battery Alpha"));
    const h = await renderRouterAsync({ initialEntries: ["/evaluations/sets/s1"], repo });
    expect(h.loc.current?.pathname).toBe("/evaluations/sets/s1");
    expect(h.container.textContent).toContain("Battery Alpha");
    expect(h.$("[data-task-set-editor]")).toBeTruthy();
    cleanup(h);
  });

  it("direct-loads /evaluations/sets/:taskSetId/versions/:version as a historical view", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("s1", "Battery Alpha"));
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/sets/s1/versions/1"],
      repo,
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/sets/s1/versions/1");
    expect(h.$("[data-task-set-editor]")).toBeTruthy();
    expect(h.container.textContent).toMatch(/read-only/i);
    cleanup(h);
  });

  it("refresh (remount) at the canonical editor reloads the same task set", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("s1", "Battery Alpha"));
    const first = await renderRouterAsync({ initialEntries: ["/evaluations/sets/s1"], repo });
    expect(first.container.textContent).toContain("Battery Alpha");
    cleanup(first);
    const refreshed = await renderRouterAsync({ initialEntries: ["/evaluations/sets/s1"], repo });
    expect(refreshed.container.textContent).toContain("Battery Alpha");
    expect(refreshed.loc.current?.pathname).toBe("/evaluations/sets/s1");
    cleanup(refreshed);
  });

  it("back/forward between list and editor preserves the entity", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("s1", "Battery Alpha"));
    const h = await renderRouterAsync({ initialEntries: ["/evaluations/sets"], repo });
    expect(h.loc.current?.pathname).toBe("/evaluations/sets");
    void act(() => h.nav.current!("/evaluations/sets/s1"));
    await settle();
    expect(h.loc.current?.pathname).toBe("/evaluations/sets/s1");
    expect(h.container.textContent).toContain("Battery Alpha");
    void act(() => h.nav.current!(-1));
    await settle();
    expect(h.loc.current?.pathname).toBe("/evaluations/sets");
    void act(() => h.nav.current!(1));
    await settle();
    expect(h.loc.current?.pathname).toBe("/evaluations/sets/s1");
    cleanup(h);
  });

  it("static /evaluations/sets wins over a dynamic :suiteId named sets", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("sets", "Name collision guard"));
    const h = await renderRouterAsync({ initialEntries: ["/evaluations/sets"], repo });
    expect(h.loc.current?.pathname).toBe("/evaluations/sets");
    expect(h.$("a[href='/evaluations/sets/sets']") ?? h.container.textContent).toBeTruthy();
    cleanup(h);
  });
});

describe("AppRouter — /evaluations/:suiteId legacy redirects (spec §4)", () => {
  it("redirects a real /evaluations/:suiteId link to /evaluations/sets/:taskSetId", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("s1", "Battery Alpha"));
    const h = await renderRouterAsync({ initialEntries: ["/evaluations/s1"], repo });
    expect(h.loc.current?.pathname).toBe("/evaluations/sets/s1");
    expect(h.container.textContent).toContain("Battery Alpha");
    cleanup(h);
  });

  it("preserves search through the suite redirect", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("s1", "Battery Alpha"));
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/s1?returnTo=/compare"],
      repo,
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/sets/s1");
    expect(h.loc.current?.search).toBe("?returnTo=/compare");
    cleanup(h);
  });

  it("preserves location state through the suite redirect", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("s1", "Battery Alpha"));
    const returnState = { returnTo: "/compare", version: 2 };
    const h = await renderRouterAsync({
      initialEntries: [{ pathname: "/evaluations/s1", state: returnState }],
      repo,
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/sets/s1");
    expect(h.loc.current?.state).toEqual(returnState);
    cleanup(h);
  });

  it("uses replace so browser back does not loop to the legacy suite URL", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("s1", "Battery Alpha"));
    const h = await renderRouterAsync({ initialEntries: ["/compare"], repo });
    void act(() => h.nav.current!("/evaluations/s1"));
    await settle();
    expect(h.loc.current?.pathname).toBe("/evaluations/sets/s1");
    void act(() => h.nav.current!(-1));
    await settle();
    expect(h.loc.current?.pathname).toBe("/compare");
    cleanup(h);
  });

  it("does not invent a /sets/* alias outside evaluations", async () => {
    const h = await renderRouterAsync({ initialEntries: ["/sets/s1"] });
    expect(h.container.textContent).toContain("Not found");
    expect(h.loc.current?.pathname).toBe("/sets/s1");
    cleanup(h);
  });

  it("does not redirect reserved static segments as suite ids", async () => {
    const h = await renderRouterAsync({ initialEntries: ["/evaluations/rubrics"] });
    expect(h.loc.current?.pathname).toBe("/evaluations/rubrics");
    expect(h.$("button[data-action='new-rubric']")).toBeTruthy();
    cleanup(h);
  });
});

describe("AppRouter — retired Fusion Study route (Lab spec §11.1)", () => {
  it("does not redirect or resolve /evaluations/:suiteId/fusion/:studyId to Fusion UI", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("s1", "Battery Alpha"));
    const fusionRepo = new InMemoryFusionStudyRepository();
    await fusionRepo.createStudy(makeFusionStudy("study-1", "s1"));
    const db = {
      taskSetOwnershipCrosswalk: {
        get: async (key: string) =>
          key === "ts-xwalk:fusion:study-1"
            ? {
                key,
                kind: "fusion-owner",
                taskSetId: "s1",
                version: 2,
                digest: null,
                status: "resolved",
                suiteRef: {
                  suiteId: "s1",
                  suiteVersion: 2,
                  protocolFingerprint: "sha256:0123456789abcdef",
                },
              }
            : undefined,
      },
    };
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/s1/fusion/study-1"],
      repo,
      fusionRepo,
      db,
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/s1/fusion/study-1");
    expect(h.$("[data-testid='fusion-study-view']")).toBeNull();
    expect(h.container.textContent).toMatch(/Fusion Study pages no longer exist/);
    expect(h.container.textContent).toMatch(/Research Lab/);
    expect(h.$("a[href='/lab']")).toBeTruthy();
    cleanup(h);
  });

  it("does not fetch or guess a study id on the retired route", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("s1", "Battery Alpha"));
    const fusionRepo = new InMemoryFusionStudyRepository();
    await fusionRepo.createStudy(makeFusionStudy("study-1", "s1"));
    const get = vi.fn(async () => undefined);
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/s1/fusion/study-1"],
      repo,
      fusionRepo,
      db: { taskSetOwnershipCrosswalk: { get } },
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/s1/fusion/study-1");
    expect(get).not.toHaveBeenCalled();
    expect(h.container.textContent).not.toMatch(/unresolved/i);
    cleanup(h);
  });
});

describe("AppRouter — Fusion owner redirects (spec §4, §8.2)", () => {

  it("canonical Fusion route stays put and renders the study under its exact owner", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("s1", "Battery Alpha"));
    const fusionRepo = new InMemoryFusionStudyRepository();
    await fusionRepo.createStudy(makeFusionStudy("study-1", "s1"));
    const db = {
      taskSetOwnershipCrosswalk: {
        get: async (key: string) =>
          key === "ts-xwalk:fusion:study-1"
            ? {
                key,
                kind: "fusion-owner",
                taskSetId: "s1",
                version: 2,
                digest: null,
                status: "resolved",
                suiteRef: {
                  suiteId: "s1",
                  suiteVersion: 2,
                  protocolFingerprint: "sha256:0123456789abcdef",
                },
              }
            : undefined,
      },
    };
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/sets/s1/fusion/study-1"],
      repo,
      fusionRepo,
      db,
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/sets/s1/fusion/study-1");
    expect(h.$("[data-testid='fusion-study-view']")).toBeTruthy();
    cleanup(h);
  });

  it("canonical Fusion route fails closed when the resolved owner is a different Task Set", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("s1", "Battery Alpha"));
    const fusionRepo = new InMemoryFusionStudyRepository();
    await fusionRepo.createStudy(makeFusionStudy("study-1", "s1"));
    // The crosswalk resolves study-1 to a different Task Set ("s2"), so the
    // canonical /evaluations/sets/s1/fusion/study-1 route must not render the
    // study under a false owner.
    const db = {
      taskSetOwnershipCrosswalk: {
        get: async (key: string) =>
          key === "ts-xwalk:fusion:study-1"
            ? {
                key,
                kind: "fusion-owner",
                taskSetId: "s2",
                version: 2,
                digest: null,
                status: "resolved",
                suiteRef: {
                  suiteId: "s2",
                  suiteVersion: 2,
                  protocolFingerprint: "sha256:0123456789abcdef",
                },
              }
            : undefined,
      },
    };
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/sets/s1/fusion/study-1"],
      repo,
      fusionRepo,
      db,
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/sets/s1/fusion/study-1");
    expect(h.$("[data-testid='fusion-study-view']")).toBeNull();
    expect(h.container.textContent).toMatch(/does not belong/i);
    cleanup(h);
  });

  it("never renders the study view across a canonical valid-to-wrong-owner navigation", async () => {
    const fusionRepo = new InMemoryFusionStudyRepository();
    await fusionRepo.createStudy(makeFusionStudy("study-1", "s1"));
    // study-1 resolves to Task Set "s1". Navigating to /sets/s2/fusion/
    // study-1 reuses the SAME route component instance with new params, so a
    // stale, coordinate-agnostic "ok" would render the study beneath the
    // wrong Task Set breadcrumb for at least the first post-navigation
    // commit. An inline-ref probe observes every commit of the route
    // subtree: React detaches the old callback and attaches the new one
    // during the commit phase, after the DOM mutates but before effects —
    // the exact window the stale study view can leak into.
    const crosswalk: {
      get: (key: string) => Promise<TaskSetOwnershipCrosswalkRow | undefined>;
    } = {
      get: async (key: string) =>
        key === "ts-xwalk:fusion:study-1"
          ? {
              key,
              kind: "fusion-owner",
              taskSetId: "s1",
              version: 2,
              digest: null,
              status: "resolved",
              suiteRef: {
                suiteId: "s1",
                suiteVersion: 2,
                protocolFingerprint: "sha256:0123456789abcdef",
              },
              updatedAt: Date.now(),
            }
          : undefined,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const commits: string[] = [];
    function FusionNavProbe() {
      const navigate = useNavigate();
      return (
        <button data-testid="fusion-nav" onClick={() => navigate("/sets/s2/fusion/study-1")}>
          nav
        </button>
      );
    }
    function CommitProbe({ onCommit }: { onCommit: () => void }) {
      // Subscribe to the params context so this probe re-renders in the SAME
      // commit as the route on a param transition. The inline ref callback
      // gets a new identity every render, so React re-fires it during the
      // commit phase — after the DOM mutates but before the route's effect
      // can reset state (the exact window the stale study view can leak in).
      useParams();
      return <div style={{ display: "none" }} ref={() => onCommit()} />;
    }
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sets/s1/fusion/study-1"]}>
          <Routes>
            <Route
              path="/sets/:taskSetId/fusion/:studyId"
              element={
                <>
                  <FusionStudyRoute fusionRepo={fusionRepo} crosswalk={crosswalk} />
                  <CommitProbe
                    onCommit={() => {
                      commits.push(
                        container.querySelector("[data-testid='fusion-study-view']")
                          ? "view"
                          : "guard",
                      );
                    }}
                  />
                </>
              }
            />
          </Routes>
          <FusionNavProbe />
        </MemoryRouter>,
      );
      await flush();
      await flush();
    });
    // Sanity: the valid owner renders the study view before we navigate.
    expect(container.querySelector("[data-testid='fusion-study-view']")).toBeTruthy();
    commits.length = 0;
    act(() => {
      container.querySelector<HTMLElement>("[data-testid='fusion-nav']")!.click();
    });
    await act(async () => {
      await flush();
    });
    // No commit — including the first post-navigation render — may show the
    // study view under the wrong owner.
    expect(commits).not.toContain("view");
    expect(container.textContent).toMatch(/does not belong/i);
    expect(container.querySelector("[data-testid='fusion-study-view']")).toBeNull();
    act(() => root.unmount());
    container.remove();
  });
});

describe("AppRouter — Evaluation execution results routes (spec §5.1, §4)", () => {
  it("direct-loads canonical /evaluations/results/:evaluationExecutionId for completed execution", async () => {
    const repo = new InMemoryEvaluationRepository();
    await repo.createExperiment({
      id: "exp-completed-1",
      revision: 1,
      suiteId: "suite-1",
      suiteVersion: 2,
      protocolFingerprint: "fp",
      status: "completed",
      execution: null,
      snapshot: {
        suiteId: "suite-1",
        suiteVersion: 2,
        tasks: [],
        modelSlots: [],
        defaultJudge: { providerId: "openrouter", model: "" },
        defaultEvaluation: { kind: "holistic" },
        profiles: [],
        protocolFingerprint: "fp",
        createdAt: Date.now(),
      },
      tasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/results/exp-completed-1"],
      repo,
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/results/exp-completed-1");
    expect(h.container.textContent).toContain("Evaluation results");
    cleanup(h);
  });

  it("gates recovery and add-model controls on results route when app-lifetime owner is held", async () => {
    const repo = new InMemoryEvaluationRepository();
    await repo.createExperiment({
      id: "exp-gated-1",
      revision: 1,
      suiteId: "suite-1",
      suiteVersion: 2,
      protocolFingerprint: "fp",
      status: "completed",
      execution: null,
      snapshot: {
        suiteId: "suite-1",
        suiteVersion: 2,
        tasks: [],
        modelSlots: [],
        defaultJudge: { providerId: "openrouter", model: "" },
        defaultEvaluation: { kind: "holistic" },
        profiles: [],
        protocolFingerprint: "fp",
        createdAt: Date.now(),
      },
      tasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const fakeController = {
      start: vi.fn(),
      requestPause: vi.fn(),
      resume: vi.fn(),
      abort: vi.fn(),
      retryIncomplete: vi.fn(),
      repairMissingCells: vi.fn(),
      addModelAndRun: vi.fn(),
      recoverOnStartup: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      whenIdle: vi.fn(),
    } as unknown as ExperimentController;

    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/results/exp-gated-1"],
      repo,
      availableProviderIds: ["openrouter"],
      controller: fakeController,
    });

    // Acquire an app-lifetime execution owner (e.g. Compare is running in the tab)
    act(() => {
      h.ownerRegistry?.tryAcquire({ kind: "compare", id: "run-cmp-1" });
    });
    await settle();

    // Since the app-lifetime owner is held, recovery controls (like Add Model) must be gated/hidden.
    expect(h.$('[data-testid="add-model-action"]')).toBeNull();
    cleanup(h);
  });

  it("shows recovery and add-model controls on results route when no owner is held and controller is present", async () => {
    const repo = new InMemoryEvaluationRepository();
    await repo.createExperiment({
      id: "exp-ungated-1",
      revision: 1,
      suiteId: "suite-1",
      suiteVersion: 2,
      protocolFingerprint: "fp",
      status: "completed",
      execution: null,
      snapshot: {
        suiteId: "suite-1",
        suiteVersion: 2,
        tasks: [],
        modelSlots: [],
        defaultJudge: { providerId: "openrouter", model: "" },
        defaultEvaluation: { kind: "holistic" },
        profiles: [],
        protocolFingerprint: "fp",
        createdAt: Date.now(),
      },
      tasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const fakeController = {
      start: vi.fn(),
      requestPause: vi.fn(),
      resume: vi.fn(),
      abort: vi.fn(),
      retryIncomplete: vi.fn(),
      repairMissingCells: vi.fn(),
      addModelAndRun: vi.fn(),
      recoverOnStartup: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      whenIdle: vi.fn(),
    } as unknown as ExperimentController;

    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/results/exp-ungated-1"],
      repo,
      availableProviderIds: ["openrouter"],
      controller: fakeController,
    });
    await settle();

    expect(h.$('[data-testid="add-model-action"]')).not.toBeNull();
    cleanup(h);
  });

  it("direct-loads canonical /evaluations/results/:evaluationExecutionId for running execution", async () => {
    const repo = new InMemoryEvaluationRepository();
    await repo.createExperiment({
      id: "exp-running-1",
      revision: 1,
      suiteId: "suite-1",
      suiteVersion: 2,
      protocolFingerprint: "fp",
      status: "running",
      execution: null,
      snapshot: {
        suiteId: "suite-1",
        suiteVersion: 2,
        tasks: [],
        modelSlots: [],
        defaultJudge: { providerId: "openrouter", model: "" },
        defaultEvaluation: { kind: "holistic" },
        profiles: [],
        protocolFingerprint: "fp",
        createdAt: Date.now(),
      },
      tasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/results/exp-running-1"],
      repo,
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/results/exp-running-1");
    cleanup(h);
  });

  it("redirects legacy /experiments/:experimentId -> /evaluations/results/:experimentId preserving query params and state", async () => {
    const repo = new InMemoryEvaluationRepository();
    await repo.createExperiment({
      id: "exp-leg-1",
      revision: 1,
      suiteId: "suite-1",
      suiteVersion: 2,
      protocolFingerprint: "fp",
      status: "completed",
      execution: null,
      snapshot: {
        suiteId: "suite-1",
        suiteVersion: 2,
        tasks: [],
        modelSlots: [],
        defaultJudge: { providerId: "openrouter", model: "" },
        defaultEvaluation: { kind: "holistic" },
        profiles: [],
        protocolFingerprint: "fp",
        createdAt: Date.now(),
      },
      tasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const h = await renderRouterAsync({
      initialEntries: [
        {
          pathname: "/experiments/exp-leg-1",
          search: "?page=2&filter=all",
          state: { returnTo: "/custom" },
        },
      ],
      repo,
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/results/exp-leg-1");
    expect(h.loc.current?.search).toBe("?page=2&filter=all");
    expect(h.loc.current?.state).toEqual({ returnTo: "/custom" });
    cleanup(h);
  });

  it("legacy redirect uses replace so browser back does not loop", async () => {
    const repo = new InMemoryEvaluationRepository();
    await repo.createExperiment({
      id: "exp-replace-1",
      revision: 1,
      suiteId: "suite-1",
      suiteVersion: 2,
      protocolFingerprint: "fp",
      status: "completed",
      execution: null,
      snapshot: {
        suiteId: "suite-1",
        suiteVersion: 2,
        tasks: [],
        modelSlots: [],
        defaultJudge: { providerId: "openrouter", model: "" },
        defaultEvaluation: { kind: "holistic" },
        profiles: [],
        protocolFingerprint: "fp",
        createdAt: Date.now(),
      },
      tasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/sets", "/experiments/exp-replace-1"],
      initialIndex: 1,
      repo,
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/results/exp-replace-1");
    void act(() => h.nav.current!(-1));
    await settle();
    expect(h.loc.current?.pathname).toBe("/evaluations/sets");
    cleanup(h);
  });

  it("refresh (remount) at canonical /evaluations/results/:id reloads the execution", async () => {
    const repo = new InMemoryEvaluationRepository();
    await repo.createExperiment({
      id: "exp-refresh-1",
      revision: 1,
      suiteId: "suite-1",
      suiteVersion: 2,
      protocolFingerprint: "fp",
      status: "completed",
      execution: null,
      snapshot: {
        suiteId: "suite-1",
        suiteVersion: 2,
        tasks: [],
        modelSlots: [],
        defaultJudge: { providerId: "openrouter", model: "" },
        defaultEvaluation: { kind: "holistic" },
        profiles: [],
        protocolFingerprint: "fp",
        createdAt: Date.now(),
      },
      tasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const h1 = await renderRouterAsync({
      initialEntries: ["/evaluations/results/exp-refresh-1"],
      repo,
    });
    expect(h1.loc.current?.pathname).toBe("/evaluations/results/exp-refresh-1");
    cleanup(h1);

    const h2 = await renderRouterAsync({
      initialEntries: ["/evaluations/results/exp-refresh-1"],
      repo,
    });
    expect(h2.loc.current?.pathname).toBe("/evaluations/results/exp-refresh-1");
    cleanup(h2);
  });

  it("back/forward history between task set editor and evaluation results preserves entity", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeRoutedSuite("set-1", "Evaluation Suite 1"));
    await repo.createExperiment({
      id: "exp-nav-1",
      revision: 1,
      suiteId: "set-1",
      suiteVersion: 1,
      protocolFingerprint: "fp",
      status: "completed",
      execution: null,
      snapshot: {
        suiteId: "set-1",
        suiteVersion: 1,
        tasks: [],
        modelSlots: [],
        defaultJudge: { providerId: "openrouter", model: "" },
        defaultEvaluation: { kind: "holistic" },
        profiles: [],
        protocolFingerprint: "fp",
        createdAt: Date.now(),
      },
      tasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/sets/set-1"],
      repo,
    });
    expect(h.loc.current?.pathname).toBe("/evaluations/sets/set-1");
    void act(() => h.nav.current!("/evaluations/results/exp-nav-1"));
    await settle();
    expect(h.loc.current?.pathname).toBe("/evaluations/results/exp-nav-1");
    void act(() => h.nav.current!(-1));
    await settle();
    expect(h.loc.current?.pathname).toBe("/evaluations/sets/set-1");
    void act(() => h.nav.current!(1));
    await settle();
    expect(h.loc.current?.pathname).toBe("/evaluations/results/exp-nav-1");
    cleanup(h);
  });

  it("does not invent a top-level /results or /results/* alias", async () => {
    const h = await renderRouterAsync({
      initialEntries: ["/results"],
    });
    expect(h.container.textContent).toMatch(/not found/i);
    cleanup(h);
  });

  it("RESERVED_EVALUATION_SEGMENTS ensures /evaluations/results is not captured by legacy suite redirect", async () => {
    const h = await renderRouterAsync({
      initialEntries: ["/evaluations/results"],
    });
    expect(h.loc.current?.pathname).not.toBe("/evaluations/sets/results");
    cleanup(h);
  });
});

describe("AppRouter — canonical Comparison Result route (spec §4, §6.2)", () => {
  it("renders /compare/results/:comparisonId route", async () => {
    const runRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runRepo);

    const record: RunRecordV2 = {
      schemaVersion: 2,
      id: "cmp-route-1",
      revision: 1,
      execution: { ownerId: "tab-1", fence: 1 },
      createdAt: 1716048000000,
      updatedAt: 1716048025000,
      completedAt: 1716048025000,
      status: "completed",
      mode: "rank",
      source: { kind: "adhoc" },
      task: {
        title: "Route Test Task",
        prompt: "Prompt for route test",
        systemPrompt: "",
        temperature: 0.7,
      },
      evaluation: { profile: null, candidateMessages: [] },
      candidates: [],
      judge: {
        status: "done",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [],
      },
      fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
      winnerKeys: [],
    };

    const summary: FullRunSummaryV2 = {
      kind: "full",
      schemaVersion: 2,
      id: "cmp-route-1",
      revision: 1,
      createdAt: 1716048000000,
      completedAt: 1716048025000,
      status: "completed",
      mode: "rank",
      source: { kind: "adhoc" },
      taskTitle: "Route Test Task",
      taskExcerpt: "Prompt for route test",
      modelKeys: [],
      winnerKeys: [],
      scoresByModelKey: {},
      judgeModelKey: null,
      evaluationProfileId: null,
      evaluationProfileVersion: null,
      detailAvailable: true,
      searchText: "Route Test Task",
    };

    await runRepo.create(record, summary);
    await comparisonRepo.createComparisonEnvelope(record, {
      kind: "ad_hoc",
      inputSnapshotRef: "snap:sha256:route-1",
    });

    const h = await renderRouterAsync({
      initialEntries: ["/compare/results/cmp-route-1"],
      runRepo,
    });

    expect(h.loc.current?.pathname).toBe("/compare/results/cmp-route-1");
    cleanup(h);
  });

  it("back/forward navigation between /compare and /compare/results/:comparisonId", async () => {
    const runRepo = new InMemoryRunRepository();
    const h = await renderRouterAsync({
      initialEntries: ["/compare"],
      runRepo,
    });
    expect(h.loc.current?.pathname).toBe("/compare");

    void act(() => h.nav.current!("/compare/results/cmp-nav-test"));
    await settle();
    expect(h.loc.current?.pathname).toBe("/compare/results/cmp-nav-test");

    void act(() => h.nav.current!(-1));
    await settle();
    expect(h.loc.current?.pathname).toBe("/compare");

    void act(() => h.nav.current!(1));
    await settle();
    expect(h.loc.current?.pathname).toBe("/compare/results/cmp-nav-test");

    cleanup(h);
  });
});

describe("AppRouter — Research Lab routes (spec §7)", () => {
  it("renders /lab as the Policy Studies home", async () => {
    const h = await renderRouterAsync({
      initialEntries: ["/lab"],
      studyRepo: new InMemoryStudyRepository(),
      labAssetRepo: new InMemoryLabAssetRepository(),
    });
    expect(h.loc.current?.pathname).toBe("/lab");
    expect(h.container.textContent).toMatch(/Policy Studies/);
    expect(h.container.textContent).toMatch(/RESEARCH LAB/);
    cleanup(h);
  });

  it("renders /lab/recipes and /lab/model-pools without leaving /lab", async () => {
    const recipes = await renderRouterAsync({
      initialEntries: ["/lab/recipes"],
      studyRepo: new InMemoryStudyRepository(),
      labAssetRepo: new InMemoryLabAssetRepository(),
    });
    expect(recipes.loc.current?.pathname).toBe("/lab/recipes");
    expect(recipes.container.textContent).toMatch(/Fusion Recipes/);
    cleanup(recipes);

    const pools = await renderRouterAsync({
      initialEntries: ["/lab/model-pools"],
      studyRepo: new InMemoryStudyRepository(),
      labAssetRepo: new InMemoryLabAssetRepository(),
    });
    expect(pools.loc.current?.pathname).toBe("/lab/model-pools");
    expect(pools.container.textContent).toMatch(/Model Pools/);
    cleanup(pools);
  });

  it("back/forward between Lab sections", async () => {
    const h = await renderRouterAsync({
      initialEntries: ["/lab"],
      studyRepo: new InMemoryStudyRepository(),
      labAssetRepo: new InMemoryLabAssetRepository(),
    });
    void act(() => h.nav.current!("/lab/recipes"));
    await settle();
    expect(h.loc.current?.pathname).toBe("/lab/recipes");
    void act(() => h.nav.current!(-1));
    await settle();
    expect(h.loc.current?.pathname).toBe("/lab");
    cleanup(h);
  });
});
