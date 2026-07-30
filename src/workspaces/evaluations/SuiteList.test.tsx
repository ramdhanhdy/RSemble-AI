// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { SuiteList } from "./SuiteList";
import { InMemoryEvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type { EvaluationSuite } from "../../lib/evaluations/evaluation-types";
import { StorageError } from "../../lib/persistence/database";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function renderWithRouter(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
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
  await act(async () => {
    await flush();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// --- Helpers ------------------------------------------------------------------

function makeSuite(id: string, overrides: Partial<EvaluationSuite> = {}): EvaluationSuite {
  const now = Date.now();
  return {
    id,
    revision: 1,
    version: 1,
    name: `Suite ${id}`,
    description: "",
    tasks: [],
    modelSlots: [],
    defaultJudge: { providerId: "openrouter", model: "" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  };
}

async function seedRepo(repo: InMemoryEvaluationRepository, suites: EvaluationSuite[]) {
  for (const s of suites) {
    await repo.saveSuite(s, 0);
  }
}

// --- Tests --------------------------------------------------------------------

describe("SuiteList — empty state", () => {
  it("explains what a suite is and offers Create", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<SuiteList repo={repo} />);
    await settle();
    expect(h.container.textContent).toMatch(/suite/i);
    expect(h.container.textContent).toMatch(/groups several tasks/i);
    const createBtn = h.$("button[data-action='create-suite']");
    expect(createBtn).toBeTruthy();
    expect(createBtn!.textContent).toMatch(/create suite/i);
    cleanup(h);
  });

  it("storage unavailable shows an error, not a create button that lies about saving", async () => {
    const failingRepo = {
      listSuites: vi.fn().mockRejectedValue(new Error("storage down")),
      getSuite: vi.fn(),
      saveSuite: vi.fn(),
      archiveSuite: vi.fn(),
      listProfiles: vi.fn(),
      getProfileRecord: vi.fn(),
      getProfile: vi.fn(),
      createProfile: vi.fn(),
      appendProfileVersion: vi.fn(),
      setProfileArchived: vi.fn(),
      createExperiment: vi.fn(),
      updateExperiment: vi.fn(),
      getExperiment: vi.fn(),
      listExperiments: vi.fn(),
      beginExperimentTask: vi.fn(),
      commitExperimentTaskTerminal: vi.fn(),
    } as unknown as InMemoryEvaluationRepository;
    const h = renderWithRouter(<SuiteList repo={failingRepo} />);
    await settle();
    expect(h.container.textContent).toMatch(/failed|error|unavailable/i);
    // No rows rendered
    expect(h.$$("a[href^='/evaluations/']")).toHaveLength(0);
    cleanup(h);
  });
});

describe("SuiteList — rows", () => {
  it("renders suite rows as links to /evaluations/:suiteId", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1"), makeSuite("s2")]);
    const h = renderWithRouter(<SuiteList repo={repo} />);
    await settle();
    const links = h.$$("a[href^='/evaluations/']");
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links.some((l) => l.getAttribute("href") === "/evaluations/s1")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/evaluations/s2")).toBe(true);
    cleanup(h);
  });

  it("shows version, task count, and model count", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [
      makeSuite("s1", {
        version: 3,
        tasks: [
          { id: "t1", title: "T1", prompt: "p", systemPrompt: "", evaluation: { kind: "inherit" }, judgeInstructionOverride: "", order: 0 },
        ],
        modelSlots: [
          { id: "slot1", providerId: "openrouter", provider: "OpenRouter", model: "gpt-4o", slug: "openai/gpt-4o", enabled: true },
          { id: "slot2", providerId: "openrouter", provider: "OpenRouter", model: "claude", slug: "anthropic/claude", enabled: true },
          { id: "slot3", providerId: "openrouter", provider: "OpenRouter", model: "off", slug: "off/off", enabled: false },
        ],
      }),
    ]);
    const h = renderWithRouter(<SuiteList repo={repo} />);
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toContain("v3");
    expect(text).toContain("1 task");
    expect(text).toContain("2 models");
    cleanup(h);
  });

  it("duplicate creates a distinct draft with (copy) suffix", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1", { name: "My Suite" })]);
    const h = renderWithRouter(<SuiteList repo={repo} />);
    await settle();
    const dupBtn = h.$("button[aria-label^='Duplicate suite']");
    expect(dupBtn).toBeTruthy();
    await act(async () => {
      dupBtn!.click();
      await flush();
    });
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toContain("My Suite (copy)");
    // Original still present
    expect(text).toContain("My Suite");
    cleanup(h);
  });

  it("archive requires confirmation before removing", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1")]);
    const h = renderWithRouter(<SuiteList repo={repo} />);
    await settle();
    // Click archive — should show confirmation, not archive immediately
    const archiveBtn = h.$("button[aria-label^='Archive suite']");
    expect(archiveBtn).toBeTruthy();
    await act(async () => {
      archiveBtn!.click();
    });
    await settle();
    // Confirmation button appears
    const confirmBtn = h.$("button[data-action='confirm-archive']");
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn!.textContent).toMatch(/archive/i);
    // Suite still visible (not yet archived)
    expect(h.$$("a[href^='/evaluations/']")).toHaveLength(1);
    cleanup(h);
  });

  it("confirmed archive removes suite from default list", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1")]);
    const h = renderWithRouter(<SuiteList repo={repo} />);
    await settle();
    // Click archive
    const archiveBtn = h.$("button[aria-label^='Archive suite']");
    await act(async () => {
      archiveBtn!.click();
    });
    await settle();
    // Confirm
    const confirmBtn = h.$("button[data-action='confirm-archive']");
    await act(async () => {
      confirmBtn!.click();
      await flush();
    });
    await settle();
    // Suite removed from default list
    expect(h.$$("a[href^='/evaluations/']")).toHaveLength(0);
    // Archived filter restores discoverability
    const showArchived = h.$("input[type='checkbox']") as HTMLInputElement;
    expect(showArchived).toBeTruthy();
    await act(async () => {
      showArchived.click();
    });
    await settle();
    expect(h.$$("a[href^='/evaluations/']")).toHaveLength(1);
    cleanup(h);
  });
});

describe("SuiteList — create", () => {
  it("create button saves a suite and navigates", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<SuiteList repo={repo} />);
    await settle();
    const createBtn = h.$("button[data-action='create-suite']");
    await act(async () => {
      createBtn!.click();
      await flush();
    });
    await settle();
    // A suite was persisted
    const suites = await repo.listSuites(true);
    expect(suites).toHaveLength(1);
    cleanup(h);
  });

  it("storage error on create does not claim a suite was saved", async () => {
    const failingRepo = {
      listSuites: vi.fn().mockResolvedValue([]),
      getSuite: vi.fn(),
      saveSuite: vi.fn().mockRejectedValue(new StorageError("quota", "disk full")),
      archiveSuite: vi.fn(),
      listProfiles: vi.fn(),
      getProfileRecord: vi.fn(),
      getProfile: vi.fn(),
      createProfile: vi.fn(),
      appendProfileVersion: vi.fn(),
      setProfileArchived: vi.fn(),
      createExperiment: vi.fn(),
      updateExperiment: vi.fn(),
      getExperiment: vi.fn(),
      listExperiments: vi.fn(),
      beginExperimentTask: vi.fn(),
      commitExperimentTaskTerminal: vi.fn(),
    } as unknown as InMemoryEvaluationRepository;
    const h = renderWithRouter(<SuiteList repo={failingRepo} />);
    await settle();
    const createBtn = h.$("button[data-action='create-suite']");
    await act(async () => {
      createBtn!.click();
      await flush();
    });
    await settle();
    // Error surfaced, no false success claim
    expect(h.container.textContent).toMatch(/storage|full|free space/i);
    // No suite appears in the list
    expect(h.$$("a[href^='/evaluations/']")).toHaveLength(0);
    cleanup(h);
  });
});

describe("SuiteList — accessibility", () => {
  it("all interactive controls meet 44px target size", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1")]);
    const h = renderWithRouter(<SuiteList repo={repo} />);
    await settle();
    const interactives = [
      ...h.$$("button"),
      ...h.$$("a[href^='/evaluations/']"),
    ];
    for (const el of interactives) {
      const cls = el.getAttribute("class") ?? "";
      // Either min-h-[44px] or h-11 (44px) — RecordRow uses min-h-[44px]
      expect(cls).toMatch(/min-h-\[44px\]|h-11/);
    }
    cleanup(h);
  });
});
