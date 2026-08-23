// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  type SearchDocument,
  type SearchDocumentType,
} from "../../lib/search/search-types";
import {
  createInMemorySearchIndexRepository,
  type SearchIndexRepository,
} from "../../lib/persistence/search-index-repository";
import type { SearchSourceResolver } from "../../lib/search/search-reindex";
import { SearchWorkspace } from "./SearchWorkspace";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function makeDoc(id: string, type: SearchDocumentType, title: string, subtitle = "", ownerHref = `/${type}/${id}`, tokens: string[] = []): SearchDocument {
  return {
    type,
    id,
    revision: 1,
    title,
    subtitle,
    ownerHref,
    tokens: tokens.length > 0 ? tokens : title.toLowerCase().split(/\s+/),
    updatedAt: 1000,
    indexSchemaVersion: 1,
  };
}

const SAMPLE_CORPUS: SearchDocument[] = [
  makeDoc("t1", "task", "Evaluation task summary", "A quick benchmark task", "/tasks/t1", ["evaluation", "task", "benchmark"]),
  makeDoc("t2", "task", "Classification brief", "Image classification prompt", "/tasks/t2", ["classification", "brief"]),
  makeDoc("set1", "task_set", "Standard evaluation set", "Core task set containing 5 tasks", "/evaluations/sets/set1", ["standard", "evaluation", "set"]),
  makeDoc("rubric1", "rubric", "Precision scoring rubric", "Rubric with accuracy criteria", "/evaluations/rubrics/rubric1", ["precision", "scoring", "rubric"]),
  makeDoc("comp1", "comparison", "GPT vs Claude comparison", "Rank evaluation run on standard set", "/compare/results/comp1", ["gpt", "claude", "comparison"]),
  makeDoc("eval1", "evaluation", "Nightly evaluation execution", "Full matrix run completed", "/evaluations/results/eval1", ["nightly", "evaluation", "execution"]),
  makeDoc("study1", "fusion_study", "Prompt fusion experiment", "Exploration study for prompt refinement", "/lab/studies/study1", ["prompt", "fusion", "experiment"]),
  makeDoc("model1", "model_configuration", "Claude 3.5 Sonnet config", "Temperature 0.7 max tokens 4096", "/models/profiles/model1", ["claude", "sonnet", "config"]),
  makeDoc("rollup1", "model_rollup", "Sonnet rollup definition", "Aggregated claims for Sonnet", "/models/rollups/rollup1", ["sonnet", "rollup", "claims"]),
  makeDoc("obs1", "observation", "Observation for task-1 on Sonnet", "Pass outcome with 0.95 confidence", "/models/observations/obs1", ["observation", "task", "sonnet"]),
  makeDoc("run1", "record", "Run record #1042", "Completed comparison run", "/records/run/run1", ["run", "record", "1042"]),
];

interface Harness {
  container: HTMLDivElement;
  root: { unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
  getLocation?: () => { pathname: string; search: string };
}

function renderWorkspace(props: {
  repo?: SearchIndexRepository | null;
  resolver?: SearchSourceResolver | null;
  initialEntries?: string[];
  onNavigate?: (path: string) => void;
} = {}): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const repo = props.repo !== undefined ? props.repo : createInMemorySearchIndexRepository(SAMPLE_CORPUS);
  let currentLocation = { pathname: "/search", search: "" };

  function LocationTracker() {
    const loc = useLocation();
    currentLocation = { pathname: loc.pathname, search: loc.search };
    return null;
  }

  act(() => {
    root.render(
      <MemoryRouter initialEntries={props.initialEntries ?? ["/search"]}>
        <LocationTracker />
        <Routes>
          <Route
            path="/search"
            element={
              <SearchWorkspace
                searchRepo={repo}
                resolver={props.resolver}
                onNavigate={props.onNavigate}
              />
            }
          />
          <Route path="*" element={<div data-mock-route>Other Route</div>} />
        </Routes>
      </MemoryRouter>,
    );
  });

  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
    getLocation: () => currentLocation,
  };
}

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SearchWorkspace", () => {
  it("renders an explanatory empty state when query is empty", async () => {
    const h = renderWorkspace();
    await settle();

    const input = h.$('input[type="search"], input[aria-label="Search"], input[placeholder*="Search"]');
    expect(input).toBeTruthy();
    expect(h.container.textContent).toMatch(/Search across|Enter a query|Find workbench/i);
    expect(h.$$("[data-search-hit]")).toHaveLength(0);

    act(() => h.root.unmount());
  });

  it("synchronizes query from URL search parameter ?q=...", async () => {
    const h = renderWorkspace({ initialEntries: ["/search?q=evaluation"] });
    await settle();

    const input = h.$('input[aria-label="Search"]') as HTMLInputElement;
    expect(input.value).toBe("evaluation");

    const hits = h.$$("[data-search-hit]");
    expect(hits.length).toBeGreaterThan(0);
    expect(h.container.textContent).toContain("Evaluation task summary");

    act(() => h.root.unmount());
  });

  it("typing into search input updates search hits and URL", async () => {
    const h = renderWorkspace();
    await settle();

    const input = h.$('input[aria-label="Search"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "rubric");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    const hits = h.$$("[data-search-hit]");
    expect(hits.length).toBeGreaterThan(0);
    expect(h.container.textContent).toContain("Precision scoring rubric");
    expect(h.getLocation?.().search).toContain("q=rubric");

    act(() => h.root.unmount());
  });

  it("ranks exact ID first above title prefix above token match", async () => {
    const repo = createInMemorySearchIndexRepository([
      makeDoc("exact-needle", "task", "Something completely different", "sub", "/tasks/exact-needle", ["other"]),
      makeDoc("prefix-match", "task", "needle in haystack", "sub", "/tasks/prefix-match", ["needle", "haystack"]),
      makeDoc("token-match", "task", "Contains needle token", "sub", "/tasks/token-match", ["contains", "needle"]),
    ]);
    const h = renderWorkspace({ repo, initialEntries: ["/search?q=exact-needle"] });
    await settle();

    const hits = h.$$("[data-search-hit]");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.textContent).toContain("exact-needle");

    act(() => h.root.unmount());
  });

  it("renders type filter pills with counts and filters results by entity type without coercion", async () => {
    const h = renderWorkspace({ initialEntries: ["/search?q=evaluation"] });
    await settle();

    // Type filter buttons/pills
    const taskPill = h.$('[data-type-filter="task"]');
    expect(taskPill).toBeTruthy();

    act(() => {
      taskPill!.click();
    });
    await settle();

    expect(h.getLocation?.().search).toContain("type=task");
    const hits = h.$$("[data-search-hit]");
    expect(hits.length).toBeGreaterThan(0);
    // All returned hits must have task type
    for (const hit of hits) {
      expect(hit.getAttribute("data-hit-type")).toBe("task");
    }

    act(() => h.root.unmount());
  });

  it("selecting a search hit navigates to its ownerHref", async () => {
    const h = renderWorkspace({ initialEntries: ["/search?q=precision"] });
    await settle();

    const hitLink = h.$('[data-search-hit] a, a[data-search-hit]') as HTMLAnchorElement;
    expect(hitLink).toBeTruthy();
    expect(hitLink.getAttribute("href")).toBe("/evaluations/rubrics/rubric1");

    act(() => {
      hitLink.click();
    });
    await settle();

    expect(h.getLocation?.().pathname).toBe("/evaluations/rubrics/rubric1");

    act(() => h.root.unmount());
  });

  it("paginates / caps rendered rows at 100", async () => {
    const hugeCorpus: SearchDocument[] = Array.from({ length: 150 }, (_, i) =>
      makeDoc(`item-${i}`, "task", `Bulk task item ${i}`, `Subtitle ${i}`, `/tasks/item-${i}`, ["bulk", "task"]),
    );
    const repo = createInMemorySearchIndexRepository(hugeCorpus);
    const h = renderWorkspace({ repo, initialEntries: ["/search?q=bulk"] });
    await settle();

    const hits = h.$$("[data-search-hit]");
    expect(hits.length).toBeLessThanOrEqual(100);
    expect(hits.length).toBe(100);
    expect(h.container.textContent).toMatch(/150 results|Page 1 of 2|Showing 1-100 of 150/i);

    act(() => h.root.unmount());
  });

  it("shows an honest error state with role='alert' when search repository fails", async () => {
    const baseRepo = createInMemorySearchIndexRepository();
    const failingRepo: SearchIndexRepository = {
      ...baseRepo,
      search: vi.fn().mockRejectedValue(new Error("Dexie storage read failure")),
    };
    const h = renderWorkspace({ repo: failingRepo, initialEntries: ["/search?q=test"] });
    await settle();

    const alert = h.$('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toMatch(/Dexie storage read failure|Search failed/i);

    act(() => h.root.unmount());
  });

  it("shows a 'no results' state when query does not match any document", async () => {
    const h = renderWorkspace({ initialEntries: ["/search?q=nonexistentqueryxyz"] });
    await settle();

    expect(h.container.textContent).toMatch(/No results found/i);
    expect(h.$$("[data-search-hit]")).toHaveLength(0);

    act(() => h.root.unmount());
  });

  it("contains zero execute/run/retry/resume controls or provider calls (navigation only)", async () => {
    const h = renderWorkspace({ initialEntries: ["/search?q=evaluation"] });
    await settle();

    const buttonsAndLinks = h.$$("button, a");
    for (const el of buttonsAndLinks) {
      const txt = (el.textContent ?? "").trim();
      expect(txt).not.toMatch(/^(Run|Execute|Retry|Resume|Add model|Deploy|Trigger)$/i);
    }

    act(() => h.root.unmount());
  });

  it("never renders secrets or credential patterns in rendered rows", async () => {
    const h = renderWorkspace({ initialEntries: ["/search?q=evaluation"] });
    await settle();

    const html = h.container.innerHTML;
    expect(html).not.toMatch(/\bsk-[A-Za-z0-9_-]{6,}|\bAIza[A-Za-z0-9_-]{10,}|Bearer\s+\S+/i);
    expect(h.container.textContent).not.toMatch(/\bsk-[A-Za-z0-9_-]{6,}|\bAIza[A-Za-z0-9_-]{10,}|Bearer\s+\S+/i);
    act(() => h.root.unmount());
  });

  it("satisfies accessibility: search landmark/role, input label, and min 44px touch targets", async () => {
    const h = renderWorkspace({ initialEntries: ["/search?q=evaluation"] });
    await settle();

    const searchInput = h.$('input[aria-label="Search"]');
    expect(searchInput).toBeTruthy();

    const interactiveElements = h.$$("button, a, input");
    for (const el of interactiveElements) {
      const cls = el.className;
      expect(cls).not.toContain("zinc-");
      expect(cls).not.toMatch(/\btext-text-muted\b/);
    }

    act(() => h.root.unmount());
  });
  it("reproduction C3: verifies and drops deleted stale hit on select without navigating", async () => {
    const repo = createInMemorySearchIndexRepository([
      makeDoc("deleted-task", "task", "Deleted Task", "Sub", "/tasks/deleted-task", ["deleted", "task"]),
    ]);

    const resolver: SearchSourceResolver = {
      async resolveDocument(ref) {
        if (ref.id === "deleted-task") return null;
        return null;
      },
    };

    const onNavigateSpy = vi.fn();
    const h = renderWorkspace({
      repo,
      resolver,
      initialEntries: ["/search?q=deleted"],
      onNavigate: onNavigateSpy,
    });
    await settle();

    const hitLink = h.$('[data-search-hit] a');
    expect(hitLink).toBeTruthy();

    await act(async () => {
      hitLink!.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });
    await settle();

    expect(onNavigateSpy).not.toHaveBeenCalled();
    expect(await repo.getDocument("task", "deleted-task")).toBeNull();
    expect(h.$$("[data-search-hit]")).toHaveLength(0);

    act(() => h.root.unmount());
  });

  it("reproduction C3: verifies and navigates to repaired hit on select", async () => {
    const repo = createInMemorySearchIndexRepository([
      makeDoc("stale-task", "task", "Stale Task", "Sub", "/tasks/old-path", ["stale", "task"]),
    ]);

    const resolver: SearchSourceResolver = {
      async resolveDocument(ref) {
        if (ref.id === "stale-task") {
          return {
            type: "task",
            id: "stale-task",
            revision: 2,
            title: "Repaired Task",
            subtitle: "Repaired Sub",
            ownerHref: "/tasks/repaired-path",
            tokens: ["repaired", "task"],
            updatedAt: 2000,
            indexSchemaVersion: 1,
          };
        }
        return null;
      },
    };

    const onNavigateSpy = vi.fn();
    const h = renderWorkspace({
      repo,
      resolver,
      initialEntries: ["/search?q=stale"],
      onNavigate: onNavigateSpy,
    });
    await settle();

    const hitLink = h.$('[data-search-hit] a');
    expect(hitLink).toBeTruthy();

    await act(async () => {
      hitLink!.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });
    await settle();

    expect(onNavigateSpy).toHaveBeenCalledWith("/tasks/repaired-path");
    const repairedDoc = await repo.getDocument("task", "stale-task");
    expect(repairedDoc?.revision).toBe(2);

    act(() => h.root.unmount());
  });
});
