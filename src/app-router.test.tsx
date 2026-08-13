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
  useLocation,
  useNavigate,
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
import "./workspaces/tasks/TaskCatalog";
import "./workspaces/tasks/TaskRoute";
import { AppRoutes } from "./app-router";
import { RepositoryContext } from "./lib/persistence/repository-context";
import { InMemoryEvaluationRepository } from "./lib/persistence/evaluation-repository";
import { InMemoryTaskRepository } from "./lib/persistence/in-memory-task-repository";
import type { TaskRepository } from "./lib/persistence/task-repository";
import type { TaskRecord, TaskVersion } from "./lib/tasks/task-types";
import type {
  EvaluationCriterion,
  EvaluationRubric,
  RubricRecord,
} from "./lib/evaluations/evaluation-types";

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
}

interface RenderOptions {
  initialEntries: (string | { pathname: string; state?: unknown })[];
  repo?: InMemoryEvaluationRepository;
  taskRepo?: TaskRepository | null;
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
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const loc: { current: CapturedLocation | null } = { current: null };
  const nav: { current: NavigateFunction | null } = { current: null };

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

  act(() => {
    root.render(
      <MemoryRouter initialEntries={opts.initialEntries}>
        <RepositoryContext.Provider
          value={{
            taskRepo,
            runRepo: null,
            evalRepo: repo,
            fusionRepo: null,
            db: null,
            storageState: "ready",
            retry: () => undefined,
          }}
        >
          <AppRoutes compareOutlet={null} models={[]} />
          <NavProbe />
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

  it("direct-loads /tasks/:taskId and renders the detail shell", async () => {
    const taskRepo = new InMemoryTaskRepository();
    await seedCatalogTask(taskRepo, "t-1", "Summarize a report");
    const h = await renderRouterAsync({ initialEntries: ["/tasks/t-1"], taskRepo });
    expect(h.$("[data-task-detail='t-1']")).toBeTruthy();
    cleanup(h);
  });

  it("direct-loads /tasks/:taskId/versions/:version and renders the version shell", async () => {
    const taskRepo = new InMemoryTaskRepository();
    await seedCatalogTask(taskRepo, "t-1", "Summarize a report");
    const h = await renderRouterAsync({ initialEntries: ["/tasks/t-1/versions/1"], taskRepo });
    expect(h.$("[data-task-version='t-1@1']")).toBeTruthy();
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
