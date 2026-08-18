// @vitest-environment happy-dom
// =============================================================================
// PolicyStudy execution & recovery tests — the in-progress, interrupted,
// failed, and archived lifecycle of a Policy Study detail (Fable §6.12, §7).
//
// Contract under test:
//  - in-progress studies show live progress (trials sealed / recorded, stage
//    progression) inside exactly one polite live region;
//  - an active run can be interrupted: sealed work is preserved, Resume
//    continues from the last sealed trial;
//  - an in-progress study loaded without an active session renders the
//    interrupted state (page reload mid-run);
//  - a rejected run fails the study with the exact error message, an Archive
//    action, and completed evidence still readable;
//  - archived studies render read-only with an explicit banner;
//  - no verdict is ever invented for unfinished studies;
//  - unknown ids render the honest not-found panel.
// =============================================================================
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { InMemoryStudyRepository } from "../../lib/persistence/study-repository";
import { fingerprintStudyValue } from "../../lib/studies/study-fingerprint";
import {
  POLICY_TRIAL_PAYLOAD_SCHEMA_VERSION,
  type PolicyKind,
  type PolicyStudyRecord,
  type PolicyStudyTrial,
  type PolicyTrialPayload,
} from "../../lib/studies/policy/policy-study-types";
import { PolicyStudyPage } from "./PolicyStudyPage";
import type { PolicyStudyRunner } from "./PolicyStudyView";
import { makeStudyRecord } from "./lab-test-fixtures";

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

function renderPage(
  studyRepo: InMemoryStudyRepository,
  studyId: string,
  runner?: PolicyStudyRunner | null,
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[`/lab/studies/${studyId}`]}>
        <Routes>
          <Route
            path="/lab/studies/:studyId"
            element={<PolicyStudyPage studyRepo={studyRepo} runner={runner} />}
          />
        </Routes>
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

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

afterEach(() => {
  document.body.innerHTML = "";
});

// --- Fixtures -------------------------------------------------------------------

const MC_A = `mc:sha256:${"0".repeat(64)}`;
const MC_B = `mc:sha256:${"1".repeat(64)}`;
const RECIPE_DIGEST = `sha256:${"a".repeat(64)}`;

function makeTrial(
  id: string,
  overrides: {
    stage?: "A" | "B" | "C";
    policy?: PolicyKind;
    status?: "in_progress" | "sealed";
    createdAt?: number;
  } = {},
): PolicyStudyTrial {
  const policy = overrides.policy ?? "fuse";
  const payload: PolicyTrialPayload = {
    policy,
    stage: overrides.stage ?? "A",
    candidateConfig: { members: [{ id: MC_A }, { id: MC_B }] },
    recipeRef:
      policy === "fuse"
        ? { recipeId: "recipe-1", version: 1, digest: RECIPE_DIGEST }
        : null,
    synthesizer: policy === "fuse" || policy === "refine" ? { id: MC_B } : null,
  };
  const status = overrides.status ?? "sealed";
  const createdAt = overrides.createdAt ?? 2_000;
  return {
    id,
    studyId: "study-1",
    payloadKind: "policy",
    payloadSchemaVersion: POLICY_TRIAL_PAYLOAD_SCHEMA_VERSION,
    payloadFingerprint: fingerprintStudyValue(payload),
    payload,
    status,
    sampleIndex: 0,
    artifactRefs: [],
    observationIds: [],
    policyCost: { tokensIn: 100, tokensOut: 50 },
    experimentalCost: { tokensIn: 200, tokensOut: 100 },
    createdAt,
    sealedAt: status === "sealed" ? createdAt + 500 : null,
  };
}

/** A deferred runner whose fate the test controls. */
function deferredRunner() {
  const calls: PolicyStudyRecord[] = [];
  let resolveRun: (() => void) | null = null;
  let rejectRun: ((err: Error) => void) | null = null;
  const runner: PolicyStudyRunner = {
    run: (study) => {
      calls.push(study);
      return new Promise<void>((resolve, reject) => {
        resolveRun = resolve;
        rejectRun = reject;
      });
    },
  };
  return {
    runner,
    calls,
    finish: () => resolveRun?.(),
    fail: (err: Error) => rejectRun?.(err),
  };
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// --- Interrupted state (no active session) ---------------------------------------

describe("PolicyStudy recovery — interrupted without an active session", () => {
  it("renders the interrupted banner with Resume and preserves sealed evidence", async () => {
    const repo = new InMemoryStudyRepository();
    await repo.createStudy(makeStudyRecord({ status: "in_progress" }));
    await repo.createTrial(makeTrial("trial-a1", { stage: "A", createdAt: 2_000 }));
    await repo.createTrial(makeTrial("trial-a2", { stage: "A", createdAt: 2_100 }));
    await repo.createTrial(
      makeTrial("trial-b1", { stage: "B", status: "in_progress", createdAt: 2_200 }),
    );
    const d = deferredRunner();
    const h = renderPage(repo, "study-1", d.runner);
    await settle();

    const banner = h.$("[data-testid='lifecycle-interrupted']");
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toMatch(/[Ii]nterrupted/);
    expect(banner?.textContent).toMatch(/sealed work is preserved/i);
    const resume = h.$("[data-action='resume-study']");
    expect(resume).toBeTruthy();
    // Sealed trials remain readable — evidence is not hidden.
    expect(h.text()).toMatch(/trial-a1/);
    // No verdict is invented for an unfinished study.
    expect(h.$("[data-testid='verdict-banner']")).toBeNull();
    cleanup(h);
  });

  it("resumes execution from the interrupted state through the runner", async () => {
    const repo = new InMemoryStudyRepository();
    await repo.createStudy(makeStudyRecord({ status: "in_progress" }));
    await repo.createTrial(makeTrial("trial-a1", { stage: "A" }));
    const d = deferredRunner();
    const h = renderPage(repo, "study-1", d.runner);
    await settle();

    click(h.$("[data-action='resume-study']") as HTMLElement);
    await settle();

    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.id).toBe("study-1");
    expect(h.$("[data-testid='lifecycle-running']")).toBeTruthy();
    expect(h.$("[data-testid='lifecycle-interrupted']")).toBeNull();
    cleanup(h);
  });
});

// --- Running state -----------------------------------------------------------------

describe("PolicyStudy execution — running", () => {
  it("shows stage progression and trials sealed/recorded in one polite live region", async () => {
    const repo = new InMemoryStudyRepository();
    await repo.createStudy(makeStudyRecord({ status: "in_progress" }));
    await repo.createTrial(makeTrial("trial-a1", { stage: "A", createdAt: 2_000 }));
    await repo.createTrial(makeTrial("trial-a2", { stage: "A", createdAt: 2_100 }));
    await repo.createTrial(
      makeTrial("trial-b1", { stage: "B", status: "in_progress", createdAt: 2_200 }),
    );
    const d = deferredRunner();
    const h = renderPage(repo, "study-1", d.runner);
    await settle();
    click(h.$("[data-action='resume-study']") as HTMLElement);
    await settle();

    const running = h.$("[data-testid='lifecycle-running']");
    expect(running).toBeTruthy();
    const progress = h.$("[data-testid='run-progress']");
    expect(progress?.textContent).toMatch(/Stage B/);
    expect(progress?.textContent).toMatch(/2 of 3/);
    // Exactly one polite live region for the whole study detail.
    const liveRegions = h.$$("[role='status']").filter(
      (el) => el.getAttribute("aria-live") !== "assertive",
    );
    expect(liveRegions).toHaveLength(1);
    expect(h.$("[data-action='interrupt-study']")).toBeTruthy();
    expect(h.$("[data-testid='verdict-banner']")).toBeNull();
    cleanup(h);
  });

  it("interrupt swaps to the interrupted banner and enables Resume", async () => {
    const repo = new InMemoryStudyRepository();
    await repo.createStudy(makeStudyRecord({ status: "in_progress" }));
    await repo.createTrial(makeTrial("trial-a1", { stage: "A" }));
    const d = deferredRunner();
    const h = renderPage(repo, "study-1", d.runner);
    await settle();
    click(h.$("[data-action='resume-study']") as HTMLElement);
    await settle();

    click(h.$("[data-action='interrupt-study']") as HTMLElement);
    await settle();

    expect(h.$("[data-testid='lifecycle-interrupted']")).toBeTruthy();
    expect(h.$("[data-testid='lifecycle-running']")).toBeNull();
    expect(h.$("[data-action='resume-study']")).toBeTruthy();
    cleanup(h);
  });
});

// --- Failed state ---------------------------------------------------------------------

describe("PolicyStudy recovery — failed", () => {
  it("marks the study failed with the exact error and keeps completed evidence readable", async () => {
    const repo = new InMemoryStudyRepository();
    await repo.createStudy(makeStudyRecord({ status: "in_progress" }));
    await repo.createTrial(makeTrial("trial-a1", { stage: "A" }));
    const d = deferredRunner();
    const h = renderPage(repo, "study-1", d.runner);
    await settle();
    click(h.$("[data-action='resume-study']") as HTMLElement);
    await settle();

    await act(async () => {
      d.fail(new Error("Stage B failed — judge evaluator returned 429 after 4 retries"));
      await flush();
    });
    await settle();

    const saved = await repo.getStudy("study-1");
    expect(saved?.status).toBe("failed");
    const banner = h.$("[data-testid='lifecycle-failed']");
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toMatch(/429 after 4 retries/);
    expect(h.$("[data-action='archive-study']")).toBeTruthy();
    // Completed Stage A evidence remains readable.
    expect(h.text()).toMatch(/trial-a1/);
    expect(h.$("[data-testid='verdict-banner']")).toBeNull();
    cleanup(h);
  });

  it("renders an honest failure state on fresh load without inventing a message", async () => {
    const repo = new InMemoryStudyRepository();
    await repo.createStudy(makeStudyRecord({ status: "in_progress" }));
    await repo.createTrial(makeTrial("trial-a1", { stage: "A" }));
    const failed = await repo.getStudy("study-1");
    await repo.failStudy("study-1", failed!.revision, 8_000);
    const h = renderPage(repo, "study-1", null);
    await settle();

    const banner = h.$("[data-testid='lifecycle-failed']");
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toMatch(/[Ff]ailed/);
    expect(h.$("[data-action='archive-study']")).toBeTruthy();
    expect(h.$("[data-testid='verdict-banner']")).toBeNull();
    cleanup(h);
  });

  it("archives a failed study into the read-only archived state", async () => {
    const repo = new InMemoryStudyRepository();
    await repo.createStudy(makeStudyRecord({ status: "failed" }));
    const h = renderPage(repo, "study-1", null);
    await settle();

    click(h.$("[data-action='archive-study']") as HTMLElement);
    await settle();

    const saved = await repo.getStudy("study-1");
    expect(saved?.status).toBe("archived");
    expect(saved?.archivedAt).not.toBeNull();
    expect(h.$("[data-testid='lifecycle-archived']")?.textContent).toMatch(
      /Archived — read-only/,
    );
    cleanup(h);
  });
});

// --- Archived + unknown id --------------------------------------------------------------

describe("PolicyStudy lifecycle — archived and unknown", () => {
  it("renders the archived read-only banner with resolvable links", async () => {
    const repo = new InMemoryStudyRepository();
    await repo.createStudy(
      makeStudyRecord({ status: "archived", archivedAt: 9_000, updatedAt: 9_000 }),
    );
    const h = renderPage(repo, "study-1", null);
    await settle();

    const banner = h.$("[data-testid='lifecycle-archived']");
    expect(banner?.textContent).toMatch(/Archived — read-only/);
    expect(banner?.textContent).toMatch(/links remain resolvable/i);
    // No lifecycle actions survive archival.
    expect(h.$("[data-action='resume-study']")).toBeNull();
    expect(h.$("[data-action='archive-study']")).toBeNull();
    expect(h.$("[data-action='interrupt-study']")).toBeNull();
    cleanup(h);
  });

  it("renders the honest not-found panel for an unknown study id", async () => {
    const repo = new InMemoryStudyRepository();
    const h = renderPage(repo, "study-x9", null);
    await settle();

    expect(h.text()).toMatch(/NOT FOUND/i);
    expect(h.text()).toMatch(/No policy study with id/);
    expect(h.text()).toMatch(/study-x9/);
    expect(h.$("a[href='/lab']")).toBeTruthy();
    cleanup(h);
  });
});
