// @vitest-environment happy-dom
// Child 08 Task 6 — quick Records drawer (spec §H).
//
// The drawer is secondary chrome at >=1024px: right-anchored 400px panel on
// the Base UI dialog authority (focus trap, inert background, Escape, focus
// restore are inherited — never reimplemented), five workspace groups capped
// at five recent rows each, safe search with an EXACT MATCH section, and a
// View-all footer with the ledger-scope honesty note. Read-only: no execution,
// export, or archive actions ever render here.
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordsRepository } from "../lib/records/records-repository";
import type { RecordReference } from "../lib/records/record-reference";
import { RecordsDrawer } from "./RecordsDrawer";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let idCounter = 0;
function base(partial: Partial<RecordReference> & { recordType: RecordReference["recordType"] }) {
  idCounter += 1;
  return {
    id: partial.id ?? `id-${idCounter}`,
    createdAt: partial.createdAt ?? 1_700_000_000_000 + idCounter * 1_000,
    updatedAt: partial.updatedAt ?? partial.createdAt ?? 1_700_000_000_000 + idCounter * 1_000,
    title: partial.title ?? `${partial.recordType} title ${idCounter}`,
    status: partial.status ?? null,
    mode: partial.mode ?? null,
    source: partial.source ?? null,
    modelKeys: partial.modelKeys ?? [],
    searchText: partial.searchText ?? "",
    ownerCrosswalk: partial.ownerCrosswalk ?? null,
    ...partial,
  } as RecordReference;
}

function comparison(id: string): RecordReference {
  return base({
    recordType: "comparison",
    id,
    status: "completed",
    mode: "rank",
    source: "adhoc",
    searchText: id,
  });
}

function taskExecution(
  id: string,
  runSource: "adhoc" | "experiment" | "policy-study",
): RecordReference {
  return base({
    recordType: "task-execution",
    id,
    status: "completed",
    mode: "rank",
    source: runSource === "experiment" ? "experiment" : "adhoc",
    searchText: id,
    ownerHint:
      runSource === "experiment"
        ? "in Evaluation · Task Set"
        : runSource === "policy-study"
          ? "in a Policy Study · Lab"
          : "in Compare · ad hoc task",
    runSource:
      runSource === "adhoc"
        ? { kind: "adhoc", comparisonId: null }
        : runSource === "experiment"
          ? { kind: "experiment", evaluationExecutionId: "exp-1", taskSetId: "set-1" }
          : { kind: "policy-study", studyId: "study-1" },
  } as unknown as RecordReference);
}

function evaluationExecution(id: string): RecordReference {
  return base({
    recordType: "evaluation",
    id,
    status: "running",
    source: "experiment",
    searchText: id,
    ownerHint: "in Frontend Reliability · Task Set v6",
  });
}

function policyStudy(id: string): RecordReference {
  return base({
    recordType: "policy-study",
    id,
    status: "completed",
    searchText: id,
    ownerHint: "in Lab · Policy Studies",
  });
}

function observation(id: string): RecordReference {
  return base({
    recordType: "observation",
    id,
    status: "completed",
    source: "adhoc",
    searchText: id,
    ownerHint: "in Compare · ad hoc task",
  });
}

function legacyRecord(id: string): RecordReference {
  return base({
    recordType: "legacy",
    id,
    source: "legacy",
    searchText: id,
    ownerHint: "Origin unresolved — preserved as imported",
  });
}

function repository(items: RecordReference[]): RecordsRepository {
  // The real repository returns the deterministic newest-first stream
  // (composeRecordReferences ordering); the fake preserves that contract.
  const sorted = [...items].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  return {
    list: vi.fn(async () => ({
      items: sorted,
      total: sorted.length,
      offset: 0,
      limit: sorted.length,
    })),
    getReference: vi.fn(async () => null),
    getTaskExecution: vi.fn(async () => null),
    getLegacySummary: vi.fn(async () => null),
    getPolicyStudyRecord: vi.fn(async () => null),
    getObservation: vi.fn(async () => null),
    getPolicyStudyChildren: vi.fn(async () => ({
      trialCount: 0,
      observationCount: 0,
      exactRunCount: 0,
      items: [],
    })),
  };
}

interface Harness {
  root: { render: (node: React.ReactNode) => void; unmount: () => void };
  container: HTMLDivElement;
  $: typeof document.querySelector;
  $$: (s: string) => Element[];
}
function cleanupRoot(container: HTMLDivElement, root: { unmount: () => void }) {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function renderDrawer(
  repo: RecordsRepository | null,
  props: { open?: boolean } = {},
): Promise<Harness> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let open = props.open ?? true;
  act(() => {
    root.render(
      <MemoryRouter>
        <RecordsDrawer
          open={open}
          onOpenChange={(v) => {
            open = v;
          }}
          repository={repo}
        />
      </MemoryRouter>,
    );
  });
  await flush();
  return {
    container,
    root,
    $: document.body.querySelector.bind(document.body),
    $$: (s) => [...document.body.querySelectorAll(s)],
  };
}

function mountControlledDrawer(
  repo: RecordsRepository,
  initialOpen = true,
  initialRoute = "/compare",
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const latest: { open: boolean; setOpen?: (v: boolean) => void } = { open: initialOpen };
  function DrawerHost() {
    const [open, setOpen] = useState(initialOpen);
    latest.open = open;
    latest.setOpen = setOpen;
    return <RecordsDrawer open={open} onOpenChange={(v) => setOpen(v)} repository={repo} />;
  }
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <DrawerHost />
      </MemoryRouter>,
    );
  });
  return { container, root, latest };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
  document.body.innerHTML = "";
}

function groupHeadings(): string[] {
  return [...document.body.querySelectorAll("[data-drawer-group-head]")].map(
    (el) => el.textContent?.trim() ?? "",
  );
}

describe("RecordsDrawer surface (Base UI authority)", () => {
  it("renders a right-anchored dialog labelled Records when open", async () => {
    const h = await renderDrawer(repository([comparison("cmp-1")]));
    const dialog = h.$('[role="dialog"]');
    expect(dialog).toBeTruthy();
    // Base UI resolves the accessible name from Dialog.Title
    // (aria-labelledby) and may drop a redundant aria-label attribute;
    // assert the resolved name itself.
    const name =
      dialog?.getAttribute("aria-label") ??
      document.getElementById(dialog?.getAttribute("aria-labelledby") ?? "")?.textContent;
    expect(name).toBe("Records");
    expect(dialog?.className).toContain("drawer-panel");
    expect(dialog?.className).toContain("w-[400px]");
    cleanup(h);
  });

  it("mounts nothing while closed", async () => {
    const h = await renderDrawer(repository([]), { open: false });
    expect(h.$('[role="dialog"]')).toBeNull();
    cleanup(h);
  });

  it("closes from the close button and reports the change", async () => {
    const mounted = mountControlledDrawer(repository([]));
    await flush();
    const close = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Close records"]',
    )!;
    expect(close).toBeTruthy();
    await act(async () => {
      close.click();
      await Promise.resolve();
    });
    expect(mounted.latest.open).toBe(false);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    cleanupRoot(mounted.container, mounted.root);
  });

  it("closes on Escape through the inherited dialog behavior", async () => {
    const mounted = mountControlledDrawer(repository([]));
    await flush();
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    expect(mounted.latest.open).toBe(false);
    cleanupRoot(mounted.container, mounted.root);
  });

  it("returns focus to the trigger element after closing", async () => {
    // The Base UI primitive's finalFocus hands focus back to the header
    // Records trigger, which sits outside this portal (not a Trigger).
    const trigger = document.createElement("button");
    trigger.textContent = "Records";
    document.body.appendChild(trigger);
    const finalFocus: { current: HTMLElement | null } = { current: trigger };
    const repo = repository([]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <MemoryRouter>
          <RecordsDrawer
            open={open}
            onOpenChange={setOpen}
            repository={repo}
            finalFocus={finalFocus}
          />
        </MemoryRouter>
      );
    }
    act(() => {
      root.render(<Host />);
    });
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    // Focus restoration is inherited from the Base UI dialog primitive —
    // the declared return target regains focus on close.
    expect(document.activeElement).toBe(trigger);
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("keeps the background inert behind the trapped drawer", async () => {
    const h = await renderDrawer(repository([]));
    const dialog = h.$('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    // Base UI's modal authority renders an internal inert backdrop inside
    // the portal and marks every node outside the popup aria-hidden, so
    // background content can neither take focus nor be read ahead of the
    // drawer. No bespoke trap exists anywhere in RecordsDrawer.
    expect(h.$("[data-base-ui-inert]")).toBeTruthy();
    await flush();
    expect(h.container.getAttribute("aria-hidden")).toBe("true");
    cleanup(h);
  });

  it("closes itself when navigation happens from a row", async () => {
    const mounted = mountControlledDrawer(repository([comparison("cmp-nav")]), true, "/compare");
    await flush();
    const row = document.body.querySelector<HTMLAnchorElement>("a[data-record-row-link]")!;
    expect(row).toBeTruthy();
    await act(async () => {
      row.click();
      await Promise.resolve();
    });
    await flush();
    expect(mounted.latest.open).toBe(false);
    cleanupRoot(mounted.container, mounted.root);
  });
});

describe("RecordsDrawer workspace groups", () => {
  it("renders exactly the five canonical groups in order", async () => {
    const h = await renderDrawer(
      repository([
        comparison("cmp-a"),
        evaluationExecution("exp-a"),
        policyStudy("study-a"),
        observation("obs-a"),
        legacyRecord("leg-a"),
        taskExecution("run-adhoc", "adhoc"),
        taskExecution("run-experiment", "experiment"),
        taskExecution("run-study", "policy-study"),
      ]),
    );
    expect(groupHeadings()).toEqual([
      "From Compare",
      "From Evaluations",
      "From the Lab",
      "Observations",
      "Legacy & Imported",
    ]);
    cleanup(h);
  });

  it("suppresses empty group headings entirely", async () => {
    const h = await renderDrawer(repository([comparison("cmp-b"), legacyRecord("leg-b")]));
    expect(groupHeadings()).toEqual(["From Compare", "Legacy & Imported"]);
    cleanup(h);
  });

  it("caps every group at its five most recent records before search", async () => {
    const adhoc = Array.from({ length: 7 }, (_, i) => taskExecution(`run-cap-${i}`, "adhoc"));
    const h = await renderDrawer(repository(adhoc));
    const compareGroup = [...document.body.querySelectorAll("[data-drawer-group]")].find(
      (el) => el.querySelector("[data-drawer-group-head]")?.textContent === "From Compare",
    )!;
    const rows = compareGroup.querySelectorAll("[data-record-row]");
    expect(rows.length).toBe(5);
    // Newest first: the two oldest must be cut by the cap.
    const ids = [...rows].map((r) => r.getAttribute("data-record-id"));
    expect(ids).not.toContain("run-cap-0");
    expect(ids).not.toContain("run-cap-1");
    cleanup(h);
  });

  it(">50 newer Compare records cannot hide an older Lab/Observation/Legacy group", async () => {
    // 60 globally-newer ad-hoc executions must not starve the other
    // workspace groups: pre-search grouping evaluates the complete loaded
    // stream, not just the globally newest 50.
    const now = Date.now();
    const flood = Array.from({ length: 60 }, (_, i) => taskExecution(`flood-${i}`, "adhoc")).map(
      (reference, index) => ({ ...reference, createdAt: now - index * 1_000 }),
    );
    const h = await renderDrawer(
      repository([
        ...flood,
        { ...policyStudy("study-old"), createdAt: now - 500_000 },
        { ...observation("obs-old"), createdAt: now - 600_000 },
        { ...legacyRecord("leg-old"), createdAt: now - 700_000 },
      ]),
    );
    expect(groupHeadings()).toEqual([
      "From Compare",
      "From the Lab",
      "Observations",
      "Legacy & Imported",
    ]);
    const ids = [...document.body.querySelectorAll("[data-record-row]")].map((r) =>
      r.getAttribute("data-record-id"),
    );
    expect(ids).toContain("study-old");
    expect(ids).toContain("obs-old");
    expect(ids).toContain("leg-old");
    cleanup(h);
  });
});

// A failing test must never leak its drawer DOM into later whole-document
// queries; wipe the body between tests (per-test cleanup still unmounts).
afterEach(() => {
  document.body.innerHTML = "";
});

describe("RecordsDrawer search", () => {
  async function type(harness: Harness, value: string) {
    const input = harness.$<HTMLInputElement>("input[data-drawer-search]")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    vi.useFakeTimers();
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();
    await flush();
  }

  it("preserves grouping while showing all matches", async () => {
    const h = await renderDrawer(
      repository([
        comparison("cmp-alpha"),
        comparison("cmp-beta"),
        taskExecution("run-alpha", "adhoc"),
        legacyRecord("leg-alpha"),
      ]),
    );
    await type(h, "alpha");
    expect(groupHeadings()).toEqual(["From Compare", "Legacy & Imported"]);
    const compareGroup = [...document.body.querySelectorAll("[data-drawer-group]")].find(
      (el) => el.querySelector("[data-drawer-group-head]")?.textContent === "From Compare",
    )!;
    expect(compareGroup.querySelectorAll("[data-record-row]").length).toBe(2);
    cleanup(h);
  });

  it("renders an exact ID hit first under EXACT MATCH", async () => {
    const h = await renderDrawer(
      repository([comparison("cmp-x"), taskExecution("run-exact-9b41", "adhoc")]),
    );
    await type(h, "run-exact-9b41");
    const heads = [...document.body.querySelectorAll("[data-drawer-group-head]")].map((el) =>
      el.textContent?.trim(),
    );
    expect(heads[0]).toBe("Exact Match");
    const firstRow = document.body.querySelector("[data-drawer-group] [data-record-row]")!;
    expect(firstRow.getAttribute("data-record-id")).toBe("run-exact-9b41");
    // The promoted exact record must not render a second time inside its
    // workspace group below.
    const occurrences = [...document.body.querySelectorAll("[data-record-row]")].filter(
      (r) => r.getAttribute("data-record-id") === "run-exact-9b41",
    );
    expect(occurrences).toHaveLength(1);
    cleanup(h);
  });

  it("search reaches a matching record beyond the global top 50", async () => {
    // 61 comparisons all match the query; the target is the OLDEST match,
    // so a default limit-50 evaluation would silently drop it.
    const now = Date.now();
    const matches = Array.from({ length: 60 }, (_, i) => comparison(`cmp-flood-${i}`)).map(
      (reference, index) => ({ ...reference, createdAt: now - index * 1_000 }),
    );
    const target = {
      ...comparison("cmp-flood-target"),
      createdAt: now - 1_000_000,
    };
    const h = await renderDrawer(repository([...matches, target]));
    await type(h, "cmp-flood");
    const ids = [...document.body.querySelectorAll("[data-record-row]")].map((r) =>
      r.getAttribute("data-record-id"),
    );
    expect(ids).toContain("cmp-flood-target");
    cleanup(h);
  });

  it("announces the result count once per surface while searching", async () => {
    const h = await renderDrawer(repository([comparison("cmp-q"), comparison("cmp-w")]));
    expect(document.body.querySelectorAll('[role="status"]').length).toBe(0);
    await type(h, "cmp");
    const statuses = document.body.querySelectorAll('[role="status"]');
    expect(statuses.length).toBe(1);
    expect(statuses[0].textContent).toContain("2");
    cleanup(h);
  });

  it("offers Clear search on no match and resets the view", async () => {
    const h = await renderDrawer(repository([comparison("cmp-present")]));
    await type(h, "nothing-matches-this");
    expect(document.body.textContent).toContain("No records match");
    const clear = document.body.querySelector<HTMLButtonElement>(
      'button[data-action="clear-search"]',
    )!;
    vi.useFakeTimers();
    await act(async () => {
      clear.click();
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();
    await flush();
    expect((h.$("input[data-drawer-search]") as HTMLInputElement).value).toBe("");
    expect(groupHeadings()).toEqual(["From Compare"]);
    cleanup(h);
  });

  it("adds a data-exact-link marker to trailing Exact siblings only", async () => {
    const h = await renderDrawer(
      repository([comparison("cmp-marks"), taskExecution("run-marks", "adhoc")]),
    );
    // Semantic rows: main anchor + marked trailing sibling. Exact rows:
    // main anchor only.
    expect(document.body.querySelectorAll("a[data-exact-link]").length).toBe(1);
    const exact = document.body.querySelector<HTMLAnchorElement>("a[data-exact-link]")!;
    expect(exact.getAttribute("href")).toBe("/records/comparison/cmp-marks");
    cleanup(h);
  });

  it("moves focus from search into rows with ArrowDown and back with ArrowUp", async () => {
    const h = await renderDrawer(
      repository([comparison("cmp-k1"), comparison("cmp-k2"), taskExecution("run-k3", "adhoc")]),
    );
    const search = h.$<HTMLInputElement>("input[data-drawer-search]")!;
    act(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute("data-record-row-link")).toBe("");
    // Newest record first: the drawer stream is newest-ordered.
    expect(focused.getAttribute("href")).toBe("/records/task-execution/run-k3");

    const stops = () => [
      ...document.body.querySelectorAll<HTMLElement>("a[data-record-row-link], a[data-exact-link]"),
    ];
    // Forward traversal walks every stop, including the trailing Exact link.
    let index = stops().indexOf(document.activeElement as HTMLElement);
    while (index < stops().length - 1) {
      act(() => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      });
      index += 1;
      expect(document.activeElement).toBe(stops()[index]);
    }
    // The final stop is the trailing Exact sibling of cmp-k2.
    expect((document.activeElement as HTMLElement).getAttribute("data-exact-link")).toBe("");

    // Backward traversal returns through the same stops, then to search.
    while (stops().indexOf(document.activeElement as HTMLElement) > 0) {
      act(() => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
        );
      });
    }
    act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(search);
    cleanup(h);
  });

  it("activates the focused record action with Enter (drawer closes on navigation)", async () => {
    const mounted = mountControlledDrawer(repository([comparison("cmp-enter")]), true, "/compare");
    await flush();
    const search = document.body.querySelector<HTMLInputElement>("input[data-drawer-search]")!;
    act(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement?.getAttribute("href")).toBe("/compare/results/cmp-enter");
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await Promise.resolve();
    });
    await flush();
    expect(mounted.latest.open).toBe(false);
    cleanupRoot(mounted.container, mounted.root);
  });
});

describe("RecordsDrawer row destinations (semantic vs exact)", () => {
  it("opens semantic rows on their owner and exact leaves beneath them", async () => {
    const h = await renderDrawer(
      repository([comparison("cmp-owner"), taskExecution("run-leaf", "adhoc")]),
    );
    const semanticMain = document.body.querySelector<HTMLAnchorElement>(
      'a[data-record-row-link][href="/compare/results/cmp-owner"]',
    );
    expect(semanticMain).toBeTruthy();
    const semanticExact = document.body.querySelector<HTMLAnchorElement>(
      'a[href="/records/comparison/cmp-owner"]',
    );
    expect(semanticExact).toBeTruthy();
    // One real anchor row plus a trailing sibling anchor — no nesting.
    expect(semanticMain?.querySelector("a")).toBeNull();

    const exactMain = document.body.querySelector<HTMLAnchorElement>(
      'a[data-record-row-link][href="/records/task-execution/run-leaf"]',
    );
    expect(exactMain).toBeTruthy();
    // Exact rows carry no trailing sibling.
    const exactWrapper = exactMain!.closest("[data-record-row]")!;
    expect(exactWrapper.querySelectorAll("a").length).toBe(1);
    cleanup(h);
  });

  it("links View all records to the full utility with the ledger-scope note", async () => {
    const h = await renderDrawer(repository([comparison("cmp-foot")]));
    const viewAll = document.body.querySelector<HTMLAnchorElement>(
      'a[data-action="view-all-records"]',
    );
    expect(viewAll?.getAttribute("href")).toBe("/records");
    expect(document.body.textContent).toContain("Records preserve exact execution provenance.");
    cleanup(h);
  });
});

describe("RecordsDrawer states", () => {
  it("shows bounded skeleton rows while the index loads", async () => {
    const slow = repository([]);
    (slow.list as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => undefined));
    const h = await renderDrawer(slow);
    const skeletons = document.body.querySelectorAll("[data-drawer-loading] > *");
    expect(skeletons.length).toBeGreaterThan(0);
    expect(skeletons.length).toBeLessThanOrEqual(3);
    expect(skeletons[0].className.includes("animate-pulse-ease")).toBe(true);
    expect(document.body.textContent).not.toContain("Loading…");
    cleanup(h);
  });

  it("renders the index error block with Retry and Open full records", async () => {
    const failing = repository([]);
    let calls = 0;
    (failing.list as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls += 1;
      throw new Error("storage closed");
    });
    const h = await renderDrawer(failing);
    expect(document.body.textContent).toContain("Records index unavailable.");
    expect(document.body.textContent).toContain("storage closed");
    const retry = document.body.querySelector<HTMLButtonElement>(
      'button[data-action="retry-records-index"]',
    )!;
    expect(retry).toBeTruthy();
    const openFull = document.body.querySelector<HTMLAnchorElement>(
      'a[data-action="open-full-records"]',
    )!;
    expect(openFull?.getAttribute("href")).toBe("/records");
    await act(async () => {
      retry.click();
      await Promise.resolve();
    });
    expect(calls).toBe(2);
    cleanup(h);
  });

  it("renders the bounded error grammar when the repository is unavailable", async () => {
    // A null repository must surface the existing "Records index
    // unavailable." block, never an endless skeleton.
    const h = await renderDrawer(null);
    expect(document.body.textContent).toContain("Records index unavailable.");
    expect(document.body.querySelector("[data-drawer-loading]")).toBeNull();
    expect(document.body.querySelector('button[data-action="retry-records-index"]')).toBeTruthy();
    cleanup(h);
  });

  it("teaches ownership on the empty ledger", async () => {
    const h = await renderDrawer(repository([]));
    expect(document.body.textContent).toContain("No records yet.");
    expect(document.body.textContent).toContain(
      "Every comparison, evaluation, and study leaves an exact record here automatically.",
    );
    cleanup(h);
  });

  it("adds no execution controls anywhere in the drawer", async () => {
    const h = await renderDrawer(
      repository([
        comparison("cmp-z"),
        taskExecution("run-z", "adhoc"),
        legacyRecord("leg-z"),
        observation("obs-z"),
        policyStudy("study-z"),
      ]),
    );
    const forbidden = [
      "retry execution",
      "resume",
      "re-judge",
      "re-fuse",
      "repair",
      "add model",
      "delete",
      "retention",
      "abort",
    ];
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const verb of forbidden) {
      expect(text).not.toContain(verb);
    }
    cleanup(h);
  });
});
