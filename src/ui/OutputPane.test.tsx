// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { OutputPane, LiveCandidateCard, scrollLiveTranscriptToEnd, InsufficientState } from "./OutputPane";
import { initialState, type StudioState } from "../studio-engine";
import type { Candidate } from "../studio-data";
import { HOLISTIC_EVALUATION } from "../lib/evaluations/evaluation-profile-adhoc";

const candidate: Candidate = {
  id: "live-1",
  model: "Test model",
  provider: "Test provider",
  providerId: "openrouter",
  slug: "test/model",
  accent: "sky",
  strategy: "",
  summary: "",
  scores: {},
  weightedScore: 0,
  segments: [],
  status: "pending",
  streamingText: "Line one\nLine two\nLine three\nLine four\nLine five\nLine six",
  startedAt: 1,
};

describe("LiveCandidateCard streaming transcript", () => {
  it("shows live text without a fade mask or three-line clamp", () => {
    const html = renderToStaticMarkup(<LiveCandidateCard candidate={candidate} now={2_000} />);

    expect(html).toContain("Line six");
    expect(html).not.toContain("fade-mask-bottom");
    expect(html).not.toContain("line-clamp-3");
    expect(html).toContain("overflow-y-auto");
  });

  it("follows the newest generated content", () => {
    const transcript = { scrollTop: 12, scrollHeight: 900 };
    scrollLiveTranscriptToEnd(transcript);
    expect(transcript.scrollTop).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// Step 1 — done card shows the FULL joined segments text, not a 2-line clamp.
// ---------------------------------------------------------------------------

describe("LiveCandidateCard — done card renders full text (no line-clamp)", () => {
  it("shows every paragraph including the last, with no line-clamp-2 class", () => {
    const doneWithParagraphs: Candidate = {
      id: "done-full",
      model: "Done Model",
      provider: "Test",
      providerId: "openrouter",
      slug: "test/done",
      accent: "emerald",
      strategy: "",
      summary: "",
      scores: {},
      weightedScore: 0,
      segments: [
        { id: "s1", text: "First paragraph with opening thoughts." },
        { id: "s2", text: "Second paragraph elaborating the argument." },
        { id: "s3", text: "Third paragraph with the conclusion and final remarks." },
      ],
      status: "done",
      startedAt: 100,
      finishedAt: 200,
      tokensOut: 318,
    };
    const html = renderToStaticMarkup(<LiveCandidateCard candidate={doneWithParagraphs} now={200} />);

    expect(html).toContain("Third paragraph with the conclusion");
    expect(html).toContain("First paragraph with opening thoughts");
    expect(html).not.toContain("line-clamp-2");
    expect(html).toContain("overflow-y-auto");
  });
});

// ---------------------------------------------------------------------------
// Step 1 — streaming card shows the FIRST and LAST chars (no 600-char tail
// truncation, no leading ellipsis).
// ---------------------------------------------------------------------------

describe("LiveCandidateCard — streaming card shows full text (no tail window)", () => {
  it("renders the first and last characters of a 2000-char stream with no ellipsis prefix", () => {
    const head = "STARTMARKER" + "A".repeat(989);
    const tail = "B".repeat(989) + "ENDMARKER";
    const streaming2k: Candidate = {
      ...candidate,
      id: "stream-2k",
      streamingText: head + tail,
    };
    const html = renderToStaticMarkup(<LiveCandidateCard candidate={streaming2k} now={2_000} />);

    expect(html).toContain("STARTMARKER");
    expect(html).toContain("ENDMARKER");
    // No leading ellipsis from the old tail-window slice.
    expect(html).not.toContain("\u2026");
  });
});

// ---------------------------------------------------------------------------
// Step 3 — active candidate with no text shows a waiting caption; with text
// it does not.
// ---------------------------------------------------------------------------

describe("LiveCandidateCard — waiting state", () => {
  it("shows a 'waiting for first token' caption when active with no text", () => {
    const waiting: Candidate = {
      ...candidate,
      id: "waiting-1",
      streamingText: "",
      segments: [],
      status: "pending",
      startedAt: 1000,
    };
    const html = renderToStaticMarkup(<LiveCandidateCard candidate={waiting} now={2_000} />);
    expect(html).toContain("waiting for first token");
  });

  it("does not show the waiting caption when active with text", () => {
    const html = renderToStaticMarkup(<LiveCandidateCard candidate={candidate} now={2_000} />);
    expect(html).not.toContain("waiting for first token");
  });

  it("swaps to the 'still waiting' caption after the patience threshold", () => {
    const waiting: Candidate = {
      ...candidate,
      id: "waiting-slow",
      streamingText: "",
      segments: [],
      status: "pending",
      startedAt: 1000,
    };
    // 16s elapsed → past the 15s FIRST_TOKEN_PATIENCE_MS threshold.
    const html = renderToStaticMarkup(<LiveCandidateCard candidate={waiting} now={17_000} />);
    expect(html).toContain("still waiting");
    expect(html).not.toContain("waiting for first token");
  });
});

// ---------------------------------------------------------------------------
// InsufficientState — terminal 2→1 state must show WHICH model failed and WHY,
// not just an aggregate count. Each failed candidate's model name and error
// message must be visible, and a per-candidate retry must be available.
// ---------------------------------------------------------------------------

function makeFailedCandidate(id: string, model: string, error: string): Candidate {
  return {
    id,
    model,
    provider: "Test",
    providerId: "openrouter",
    slug: `slug-${id}`,
    accent: "rose",
    strategy: "Parallel model",
    summary: "",
    scores: {},
    weightedScore: 0,
    segments: [],
    status: "error",
    errorMessage: error,
    startedAt: 100,
    finishedAt: 200,
  };
}

function makeDoneCandidate(id: string, model: string): Candidate {
  return {
    id,
    model,
    provider: "Test",
    providerId: "openrouter",
    slug: `slug-${id}`,
    accent: "emerald",
    strategy: "Parallel model",
    summary: "good answer",
    scores: {},
    weightedScore: 0,
    segments: [{ id: `${id}-s0`, text: "real answer content" }],
    status: "done",
    startedAt: 100,
    finishedAt: 200,
  };
}

describe("InsufficientState — failed candidate visibility", () => {
  it("shows the failed model name and error message (not just an aggregate count)", () => {
    const failed = makeFailedCandidate("c1", "GPT-5", "rate limit exceeded");
    const html = renderToStaticMarkup(
      <InsufficientState done={1} failed={1} mode="fuse" candidates={[makeDoneCandidate("c2", "Claude"), failed]} />,
    );
    expect(html).toContain("GPT-5");
    expect(html).toContain("rate limit exceeded");
  });

  it("shows multiple failed candidates with their respective model names and errors", () => {
    const failed1 = makeFailedCandidate("c1", "GPT-5", "rate limit exceeded");
    const failed2 = makeFailedCandidate("c2", "Claude", "server error");
    const html = renderToStaticMarkup(
      <InsufficientState done={0} failed={2} mode="rank" candidates={[failed1, failed2]} />,
    );
    expect(html).toContain("GPT-5");
    expect(html).toContain("rate limit exceeded");
    expect(html).toContain("Claude");
    expect(html).toContain("server error");
  });

  it("renders a retry button for each failed candidate when onRetryCandidate is provided", () => {
    const failed = makeFailedCandidate("c1", "GPT-5", "rate limit exceeded");
    const html = renderToStaticMarkup(
      <InsufficientState
        done={1}
        failed={1}
        mode="fuse"
        candidates={[makeDoneCandidate("c2", "Claude"), failed]}
        onRetryCandidate={() => {}}
      />,
    );
    // Retry button must be present and reference the failed model.
    expect(html).toContain("Retry");
    expect(html).toContain("GPT-5");
  });

  it("does not render a retry button when no onRetryCandidate callback is provided", () => {
    const failed = makeFailedCandidate("c1", "GPT-5", "rate limit exceeded");
    const html = renderToStaticMarkup(
      <InsufficientState done={1} failed={1} mode="fuse" candidates={[makeDoneCandidate("c2", "Claude"), failed]} />,
    );
    expect(html).not.toContain("Retry");
  });
});

// ---------------------------------------------------------------------------
// Empty/unusable candidate visibility — a done candidate with empty content
// must be visibly unusable, not silently treated as a successful completion.
// ---------------------------------------------------------------------------

describe("LiveCandidateCard — empty done candidate is visibly unusable", () => {
  it("shows an 'unusable' indicator for a done candidate with empty content", () => {
    const emptyDone: Candidate = {
      ...makeDoneCandidate("c1", "GPT-5"),
      segments: [],
      summary: "",
    };
    const html = renderToStaticMarkup(<LiveCandidateCard candidate={emptyDone} now={200} />);
    // The card must NOT show a success indicator for an empty done candidate.
    // It must show an unusable/empty indicator instead.
    expect(html).toContain("unusable");
  });
});

// ---------------------------------------------------------------------------
// InsufficientState — terminal insufficient state must show EVERY non-usable
// candidate, including done-but-empty ones, with model identity, a truthful
// reason, and an actionable retry where supported. The legacy behaviour built
// the per-candidate detail/retry list only from status=error, so an empty
// status=done candidate was silently omitted from the actionable list.
// Regression scenario: 2 configured -> one text success + one empty done.
// ---------------------------------------------------------------------------

function makeEmptyDoneCandidate(id: string, model: string): Candidate {
  return {
    id,
    model,
    provider: "Test",
    providerId: "openrouter",
    slug: `slug-${id}`,
    accent: "amber",
    strategy: "Parallel model",
    summary: "",
    scores: {},
    weightedScore: 0,
    segments: [],
    status: "done",
    startedAt: 100,
    finishedAt: 200,
  };
}

describe("InsufficientState — empty done candidate visibility (2 configured -> 1 success + 1 empty done)", () => {
  it("shows the empty-done candidate with model name and a truthful empty-output reason", () => {
    const success = makeDoneCandidate("c1", "Claude");
    const empty = makeEmptyDoneCandidate("c2", "GPT-5");
    const html = renderToStaticMarkup(
      <InsufficientState done={1} failed={1} mode="fuse" candidates={[success, empty]} />,
    );
    // The empty-done candidate must appear in the actionable list, identified by
    // its model name (not silently omitted because status !== "error").
    expect(html).toContain("GPT-5");
    // A truthful reason for the non-usable state must be shown — something that
    // communicates empty/no content, not a generic "check slugs" hint alone.
    expect(html).toMatch(/empty|no content|unusable|truncated/i);
  });

  it("renders a retry button for the empty-done candidate when onRetryCandidate is provided", () => {
    const success = makeDoneCandidate("c1", "Claude");
    const empty = makeEmptyDoneCandidate("c2", "GPT-5");
    const html = renderToStaticMarkup(
      <InsufficientState
        done={1}
        failed={1}
        mode="fuse"
        candidates={[success, empty]}
        onRetryCandidate={() => {}}
      />,
    );
    expect(html).toContain("Retry");
    expect(html).toContain("GPT-5");
    // The retry button must reference the empty-done model so it is actionable.
    expect(html).toContain('aria-label="Retry GPT-5"');
  });

  it("does not render a retry button for the empty-done candidate when no callback is provided", () => {
    const success = makeDoneCandidate("c1", "Claude");
    const empty = makeEmptyDoneCandidate("c2", "GPT-5");
    const html = renderToStaticMarkup(
      <InsufficientState done={1} failed={1} mode="fuse" candidates={[success, empty]} />,
    );
    expect(html).not.toContain("Retry");
  });
});

// ---------------------------------------------------------------------------
// OutputPane — Judge-only retry action in the error state (run-recovery spec §5.5)
// ---------------------------------------------------------------------------

// React 18 uses this global to decide whether act() warnings are suppressed.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function makeOutputPaneState(overrides: Partial<StudioState> = {}): StudioState {
  return {
    ...initialState,
    mode: "rank",
    running: false,
    judgeStatus: "error",
    judgeError: "The AI judge could not be reached.",
    candidates: [makeDoneCandidate("c1", "Model A"), makeDoneCandidate("c2", "Model B")],
    runContext: { prompt: "original task", evaluation: HOLISTIC_EVALUATION },
    ...overrides,
  };
}

describe("OutputPane — Judge-only retry action", () => {
  it("renders a Retry Judge action when the Judge failed with two usable candidates", () => {
    const html = renderToStaticMarkup(
      <OutputPane state={makeOutputPaneState()} onRetryJudge={() => {}} />,
    );
    expect(html).toContain("Retry Judge");
    expect(html).toContain('aria-label="Retry Judge using completed candidates"');
  });

  it("helper copy says completed candidates are reused and the Judge model can change", () => {
    const html = renderToStaticMarkup(
      <OutputPane state={makeOutputPaneState()} onRetryJudge={() => {}} />,
    );
    expect(html).toMatch(/reuse/i);
    expect(html).toMatch(/completed candidate/i);
    expect(html).toMatch(/change the judge model/i);
  });

  it("does not tell an eligible Judge failure to rerun the full pipeline", () => {
    const html = renderToStaticMarkup(
      <OutputPane state={makeOutputPaneState()} onRetryJudge={() => {}} />,
    );
    expect(html).not.toMatch(/re-run from the command pane/i);
  });

  it("states that candidate generation succeeded and only the Judge failed", () => {
    const html = renderToStaticMarkup(
      <OutputPane state={makeOutputPaneState()} onRetryJudge={() => {}} />,
    );
    expect(html).toMatch(/generation succeeded|only the judge failed/i);
  });

  it("the Retry Judge button meets the 44px touch target", () => {
    const html = renderToStaticMarkup(
      <OutputPane state={makeOutputPaneState()} onRetryJudge={() => {}} />,
    );
    // The button markup must carry the 44px minimum-height class used across the app.
    expect(html).toContain("min-h-[44px]");
  });

  it("invokes onRetryJudge once when the button is activated", () => {
    const calls: number[] = [];
    const onRetryJudge = () => calls.push(1);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => {
        root.render(<OutputPane state={makeOutputPaneState()} onRetryJudge={onRetryJudge} />);
      });
      const btn = container.querySelector(
        '[aria-label="Retry Judge using completed candidates"]',
      ) as HTMLButtonElement | null;
      expect(btn).not.toBeNull();
      act(() => {
        btn!.click();
      });
      expect(calls).toHaveLength(1);
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("does not offer per-candidate retry buttons for successful candidates in the error state", () => {
    const html = renderToStaticMarkup(
      <OutputPane
        state={makeOutputPaneState()}
        onRetryJudge={() => {}}
        onRetryCandidate={() => {}}
      />,
    );
    // The two done candidates must not carry per-candidate retry aria-labels.
    expect(html).not.toContain('aria-label="Retry Model A"');
    expect(html).not.toContain('aria-label="Retry Model B"');
  });

  it("does not offer Judge retry when fewer than two candidates are usable", () => {
    const state = makeOutputPaneState({
      candidates: [makeDoneCandidate("c1", "Model A"), makeFailedCandidate("c2", "Model B", "boom")],
    });
    const html = renderToStaticMarkup(
      <OutputPane state={state} onRetryJudge={() => {}} />,
    );
    expect(html).not.toContain("Retry Judge");
    expect(html).not.toContain('aria-label="Retry Judge using completed candidates"');
  });

  it("does not mislabel a Fusion-only error as a Judge retry", () => {
    const state = makeOutputPaneState({
      mode: "fuse",
      judgeStatus: "done",
      judgeError: null,
      fusionStatus: "error",
      fusionError: "fusion exploded",
    });
    const html = renderToStaticMarkup(
      <OutputPane state={state} onRetryJudge={() => {}} />,
    );
    // A fusion failure (Judge succeeded) must not expose Judge-only retry.
    expect(html).not.toContain("Retry Judge");
    expect(html).toContain("fusion exploded");
  });

  it("does not offer the action while a stage is running", () => {
    const state = makeOutputPaneState({ running: true });
    const html = renderToStaticMarkup(
      <OutputPane state={state} onRetryJudge={() => {}} />,
    );
    expect(html).not.toContain("Retry Judge");
  });

  it("does not offer the action when the run was aborted", () => {
    const state = makeOutputPaneState({ aborted: true });
    const html = renderToStaticMarkup(
      <OutputPane state={state} onRetryJudge={() => {}} />,
    );
    expect(html).not.toContain("Retry Judge");
  });
});
// ---------------------------------------------------------------------------
// Recent runs — links to /runs/:runId (Phase 3 Task 3.5)
// ---------------------------------------------------------------------------

import { MemoryRouter } from "react-router-dom";
import { InMemoryRunRepository } from "../lib/persistence/run-repository";
import { RepositoryContext } from "../lib/persistence/repository-context";
import type { RunRecordV2, FullRunSummaryV2 } from "../lib/persistence/run-types";

function makeRecentSummary(id: string, createdAt: number): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 1,
    createdAt,
    completedAt: createdAt + 1000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    taskTitle: `Task ${id}`,
    taskExcerpt: `Task ${id} excerpt`,
    modelKeys: ["openrouter:gpt-4o"],
    winnerKeys: ["openrouter:gpt-4o"],
    scoresByModelKey: { "openrouter:gpt-4o": 4.5 },
    judgeModelKey: "openrouter:judge",
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: `task ${id}`,
  };
}

function makeRecentRecord(id: string, createdAt: number): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt,
    updatedAt: createdAt + 1000,
    completedAt: createdAt + 1000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: `Task ${id}`, prompt: "do it", systemPrompt: "helpful", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [],
    judge: { status: "idle", acceptedAttemptId: null, report: null, consensus: null, attempts: [] },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

async function seedRecent(repo: InMemoryRunRepository, entries: Array<[string, number]>) {
  for (const [id, createdAt] of entries) {
    await repo.create(makeRecentRecord(id, createdAt), makeRecentSummary(id, createdAt));
  }
}

async function settleRecent() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("OutputPane recent runs", () => {
  it("View all runs links to /runs", async () => {
    const repo = new InMemoryRunRepository();
    await seedRecent(repo, [["run-1", 1000]]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <RepositoryContext.Provider value={{ runRepo: repo, evalRepo: null, fusionRepo: null, db: null, storageState: "ready", retry: () => {} }}>
          <MemoryRouter><OutputPane state={initialState} /></MemoryRouter>
        </RepositoryContext.Provider>,
      );
    });
    await settleRecent();
    const link = container.querySelector<HTMLAnchorElement>("a[href='/runs']");
    expect(link).toBeTruthy();
    expect(link?.textContent).toMatch(/view all runs/i);
    act(() => root.unmount());
    container.remove();
  });

  it("each recent row links to /runs/:runId", async () => {
    const repo = new InMemoryRunRepository();
    await seedRecent(repo, [["run-1", 1000], ["run-2", 2000]]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <RepositoryContext.Provider value={{ runRepo: repo, evalRepo: null, fusionRepo: null, db: null, storageState: "ready", retry: () => {} }}>
          <MemoryRouter><OutputPane state={initialState} /></MemoryRouter>
        </RepositoryContext.Provider>,
      );
    });
    await settleRecent();
    const links = [...container.querySelectorAll<HTMLAnchorElement>("a[href^='/runs/']")];
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links.some((l) => l.getAttribute("href") === "/runs/run-1")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/runs/run-2")).toBe(true);
    act(() => root.unmount());
    container.remove();
  });
});
