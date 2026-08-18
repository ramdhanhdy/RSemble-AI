// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { InMemoryStudyRepository } from "../../lib/persistence/study-repository";
import { InMemoryEvaluationRepository } from "../../lib/persistence/evaluation-repository";
import { StorageError } from "../../lib/persistence/database";
import type { EvaluationSuite } from "../../lib/evaluations/evaluation-types";
import { PolicyStudyList } from "./PolicyStudyList";
import { makePlaybook, makeStudyRecord } from "./lab-test-fixtures";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
  pathname: { current: string };
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

function makeSuite(id: string, version = 6): EvaluationSuite {
  const now = Date.now();
  return {
    id,
    revision: 1,
    version,
    name: `Suite ${id}`,
    description: "",
    tasks: [],
    modelSlots: [],
    defaultJudge: { providerId: "openrouter", model: "" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

function renderList(
  studyRepo: InMemoryStudyRepository | null,
  evalRepo: InMemoryEvaluationRepository | null = null,
  initialEntry = "/lab",
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const pathname = { current: initialEntry.split("?")[0] ?? initialEntry };
  function Loc() {
    const loc = useLocation();
    pathname.current = loc.pathname;
    return null;
  }
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Loc />
        <Routes>
          <Route
            path="/lab"
            element={<PolicyStudyList studyRepo={studyRepo} evalRepo={evalRepo} />}
          />
          <Route path="/lab/studies/:studyId" element={<div data-study-detail="" />} />
          <Route path="/evaluations/sets" element={<div data-evaluations="" />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
    pathname,
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

function typeInto(input: HTMLInputElement, value: string) {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  proto?.set?.call(input, value);
  act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PolicyStudyList — empty, error, summary", () => {
  it("renders first-use empty copy and the New Policy Study action", async () => {
    const h = renderList(new InMemoryStudyRepository());
    await settle();
    expect(h.container.textContent).toMatch(/No policy studies yet/);
    expect(h.container.textContent).toMatch(/Policy Playbook/);
    expect(h.container.textContent).toMatch(/fusing is not worth it/);
    expect(h.$("[data-action='new-policy-study']")?.textContent).toMatch(/New Policy Study/);
    expect(h.$("a[href='/evaluations/sets']")?.textContent).toMatch(
      /Open Evaluations to build a Task Set first/,
    );
    cleanup(h);
  });

  it("shows Active / Findings / Confirmed counts and no extra summary cells", async () => {
    const repo = new InMemoryStudyRepository();
    await repo.createStudy(makeStudyRecord({ id: "d1", status: "draft", title: "Draft A" }));
    await repo.createStudy(
      makeStudyRecord({
        id: "p1",
        status: "in_progress",
        title: "Running B",
        updatedAt: 2_000,
      }),
    );
    await repo.createStudy(
      makeStudyRecord({
        id: "c1",
        status: "completed",
        title: "Done C",
        reportRef: "pb:c1",
        updatedAt: 3_000,
      }),
    );
    await repo.createPlaybook("pb:c1", makePlaybook({ studyId: "c1", claimLevel: "confirmed" }));
    const h = renderList(repo);
    await settle();
    expect(h.$("[data-summary='active']")?.textContent).toMatch(/2/);
    expect(h.$("[data-summary='findings']")?.textContent).toMatch(/1/);
    expect(h.$("[data-summary='confirmed']")?.textContent).toMatch(/1/);
    expect(h.$$("[data-summary]")).toHaveLength(3);
    cleanup(h);
  });

  it("orders rows by updatedAt descending and links to /lab/studies/:id", async () => {
    const repo = new InMemoryStudyRepository();
    await repo.createStudy(makeStudyRecord({ id: "old", title: "Older", updatedAt: 1_000 }));
    await repo.createStudy(makeStudyRecord({ id: "new", title: "Newer", updatedAt: 5_000 }));
    const h = renderList(repo);
    await settle();
    const titles = h.$$("[data-record-row]").map((el) => el.textContent ?? "");
    expect(titles[0]).toMatch(/Newer/);
    expect(titles[1]).toMatch(/Older/);
    expect(h.$("a[href='/lab/studies/new']")).toBeTruthy();
    expect(h.$("a[href='/lab/studies/old']")).toBeTruthy();
    cleanup(h);
  });

  it("uses honest draft copy and the playbook conclusion when present", async () => {
    const repo = new InMemoryStudyRepository();
    await repo.createStudy(makeStudyRecord({ id: "draft-1", status: "draft", title: "Draft row" }));
    await repo.createStudy(
      makeStudyRecord({
        id: "done-1",
        status: "completed",
        title: "Done row",
        reportRef: "pb:done-1",
        updatedAt: 4_000,
      }),
    );
    await repo.createPlaybook(
      "pb:done-1",
      makePlaybook({
        studyId: "done-1",
        conclusion: "Rank A+C when cost matters; do not use fusion for routine runs.",
      }),
    );
    const h = renderList(repo);
    await settle();
    expect(h.container.textContent).toMatch(/Draft — inputs not sealed/);
    expect(h.container.textContent).toMatch(/Rank A\+C when cost matters/);
    cleanup(h);
  });

  it("hides archived studies until Show archived is toggled", async () => {
    const repo = new InMemoryStudyRepository();
    await repo.createStudy(makeStudyRecord({ id: "live", title: "Live study" }));
    await repo.createStudy(
      makeStudyRecord({
        id: "parked",
        title: "Parked study",
        status: "archived",
        archivedAt: 8_000,
      }),
    );
    const h = renderList(repo);
    await settle();
    expect(h.container.textContent).toMatch(/Live study/);
    expect(h.container.textContent).not.toMatch(/Parked study/);
    const toggle = h.$("[data-action='show-archived']") as HTMLInputElement;
    expect(toggle).toBeTruthy();
    expect(h.container.textContent).toMatch(/Show archived \(1\)/);
    act(() => {
      toggle.click();
    });
    await settle();
    expect(h.container.textContent).toMatch(/Parked study/);
    expect(h.container.textContent).toMatch(/Archived/);
    cleanup(h);
  });

  it("omits filters at 8 studies and shows them above 8", async () => {
    const eight = new InMemoryStudyRepository();
    for (let i = 0; i < 8; i++) {
      await eight.createStudy(makeStudyRecord({ id: `s${i}`, title: `Study ${i}` }));
    }
    const h8 = renderList(eight);
    await settle();
    expect(h8.$("[data-lab-filters]")).toBeNull();
    cleanup(h8);

    const nine = new InMemoryStudyRepository();
    for (let i = 0; i < 9; i++) {
      await nine.createStudy(makeStudyRecord({ id: `s${i}`, title: `Study ${i}` }));
    }
    const h9 = renderList(nine);
    await settle();
    expect(h9.$("[data-lab-filters]")).toBeTruthy();
    cleanup(h9);
  });

  it("shows no-match state and clears filters", async () => {
    const repo = new InMemoryStudyRepository();
    for (let i = 0; i < 9; i++) {
      await repo.createStudy(makeStudyRecord({ id: `s${i}`, title: `Alpha ${i}` }));
    }
    const h = renderList(repo);
    await settle();
    const search = h.$("[data-lab-filters] input") as HTMLInputElement;
    typeInto(search, "zzzz-no-match");
    await settle();
    expect(h.container.textContent).toMatch(/No matching studies/);
    act(() => {
      h.$("[data-action='clear-filters']")!.click();
    });
    await settle();
    expect(h.container.textContent).toMatch(/Alpha 0/);
    cleanup(h);
  });

  it("renders load failure with Retry", async () => {
    const repo = new InMemoryStudyRepository();
    vi.spyOn(repo, "listStudies").mockRejectedValue(new StorageError("unavailable", "disk full"));
    const h = renderList(repo);
    await settle();
    expect(h.container.textContent).toMatch(/Failed to load studies/);
    expect(h.container.textContent).toMatch(/disk full/);
    expect(h.$("[data-action='retry-studies']")).toBeTruthy();
    cleanup(h);
  });
});

describe("PolicyStudyList — create and Task Set prefill", () => {
  it("creates a draft and routes to /lab/studies/:id", async () => {
    const studyRepo = new InMemoryStudyRepository();
    const evalRepo = new InMemoryEvaluationRepository();
    await evalRepo.saveSuite(makeSuite("ts1", 6), 0);
    const h = renderList(studyRepo, evalRepo);
    await settle();
    await act(async () => {
      h.$("[data-action='new-policy-study']")!.click();
      await flush();
    });
    await settle();
    expect(h.pathname.current).toMatch(/^\/lab\/studies\//);
    const created = await studyRepo.listStudies(true);
    expect(created).toHaveLength(1);
    expect(created[0]?.status).toBe("draft");
    cleanup(h);
  });

  it("prefills an exact Task Set Version from the Start Policy Study deep link", async () => {
    const studyRepo = new InMemoryStudyRepository();
    const evalRepo = new InMemoryEvaluationRepository();
    await evalRepo.saveSuite(makeSuite("battery-alpha", 6), 0);
    const h = renderList(
      studyRepo,
      evalRepo,
      "/lab?startPolicyStudy=1&taskSetId=battery-alpha&version=6",
    );
    await settle();
    const created = await studyRepo.listStudies(true);
    expect(created).toHaveLength(1);
    expect(created[0]?.definition.workload).toMatchObject({
      taskSetId: "battery-alpha",
      version: 6,
    });
    expect(h.pathname.current).toBe(`/lab/studies/${created[0]?.id}`);
    cleanup(h);
  });
});
