// =============================================================================
// Adaptive Fusion — root component (Split Workspace shell, Variation B)
//
// See PRODUCT.md (source of truth) and UI.md (interaction spec).
//
// Phase 1 scope: the shell + header + the Rank/Fuse toggle (the sole switch).
// The left Command pane and right Output pane are wired in as placeholders for
// this phase; their full implementations land in later phases (TODOS.md
// Phase 2 & 3). The pipeline orchestration (runFanout/runJudge/runFusion) is
// lifted verbatim from the prior component and reused unchanged — only the UI
// around it is new.
// =============================================================================

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { type Candidate, type Mode } from "./studio-data";
import {
  chatCompletion,
  errorMessage,
  hasApiKey,
  listModels,
} from "./lib/openrouter";
import {
  buildFanoutJobs,
  draftMessages,
  fusionMessages,
  judgeMessages,
  parseJudge,
  splitSegments,
  summarize,
} from "./lib/pipeline";
import {
  type Action,
  type StudioState,
  initialState,
  reducer,
} from "./studio-engine";
import { Header } from "./ui/Header";
import { ModeToggle } from "./ui/ModeToggle";
import { ModelList } from "./ui/ModelList";
import { RubricDisclosure } from "./ui/RubricDisclosure";
import { TaskInput } from "./ui/TaskInput";
import { RunButton } from "./ui/RunButton";
import { JudgeConfig } from "./ui/JudgeConfig";
import { OutputPane } from "./ui/OutputPane";

// =============================================================================
// Root
// =============================================================================

export default function AdaptiveFusion() {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Mobile command drawer (<768px). On md+ the command pane is inline, so this
  // stays closed. Per DESIGN.md: output is primary full-screen on mobile, command
  // opens as a drawer/sheet from the header.
  const [commandOpen, setCommandOpen] = useState(false);

  // Keep a live ref to state so async orchestration reads the latest values.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const apiKeyPresent = hasApiKey();

  // Load the live OpenRouter model catalog once (if a key is configured).
  useEffect(() => {
    if (!apiKeyPresent) return;
    const ctrl = new AbortController();
    listModels(ctrl.signal)
      .then((models) => dispatch({ type: "SET_MODELS", models }))
      .catch(() => {
        /* non-fatal: the curated catalog still works */
      });
    return () => ctrl.abort();
  }, [apiKeyPresent]);

  // ---- pipeline orchestration (reused verbatim from the prior component) ----

  const runFanout = useCallback(async () => {
    const s = stateRef.current;
    const jobs = buildFanoutJobs(s.slots);
    if (jobs.length === 0) {
      return;
    }
    const placeholders: Candidate[] = jobs.map((j) => ({
      id: j.id,
      model: j.displayName,
      provider: j.provider,
      accent: j.accent,
      strategy: j.strategyLabel,
      summary: "",
      scores: {},
      weightedScore: 0,
      segments: [],
      status: "pending",
    }));
    dispatch({ type: "FANOUT_START", candidates: placeholders });

    // Materialize results locally as they land. We CANNOT re-read stateRef here to
    // find the "done" candidates — React 18 batches the final CANDIDATE_RESULT
    // dispatches, so the ref is stale at the moment we need it, and the
    // last-finishing candidate would be filtered out (it stayed "pending" in the
    // ref) → the judge never sees it → it scores 0.0. Threading the real results
    // through directly closes the race.
    const results = await Promise.all(
      jobs.map(async (job): Promise<Candidate | null> => {
        try {
          const content = await chatCompletion({
            model: job.slug,
            messages: draftMessages({
              systemPrompt: s.systemPrompt,
              prompt: s.prompt,
              rubric: s.rubric,
            }),
            temperature: s.temperature,
          });
          const segments = splitSegments(content, job.id);
          const summary = summarize(content);
          dispatch({ type: "CANDIDATE_RESULT", id: job.id, segments, summary });
          return {
            ...placeholders.find((p) => p.id === job.id)!,
            status: "done",
            segments,
            summary,
          };
        } catch (err) {
          dispatch({ type: "CANDIDATE_FAILED", id: job.id, error: errorMessage(err) });
          return null;
        }
      })
    );
    const done = results.filter((r): r is Candidate => r !== null);
    dispatch({ type: "FANOUT_END", count: done.length });

    if (done.length === 0) return;

    // Auto-advance to Judge, then to Fusion when in Fuse mode. Pass the materialized
    // `done` candidates directly — do not re-read stateRef for them.
    await runJudge(done, s);
    if (stateRef.current.mode === "fuse") {
      await runFusion(done, s);
    }
  }, []);

  // NOTE: runJudge/runFusion take their inputs as arguments rather than reading
  // stateRef, because the ref can be stale immediately after the fanout dispatches
  // settle (see the note in runFanout). The `seed` carries prompt/rubric/criticModel
  // which are read-only during a run, so the ref is safe for those.
  const runJudge = useCallback(async (done: Candidate[], seed: StudioState) => {
    if (done.length === 0) return;
    dispatch({ type: "JUDGE_START" });
    try {
      const content = await chatCompletion({
        model: seed.criticModel,
        messages: judgeMessages(seed.prompt, seed.rubric, done),
        temperature: 0.1,
      });
      const { breakdown, scoresById, unmatchedScores } = parseJudge(content, done);
      if (unmatchedScores.length > 0) {
        console.warn(
          "[Adaptive Fusion] judge returned scores whose labels could not be matched to candidates:",
          unmatchedScores,
          "Matched scores:",
          scoresById
        );
      }
      dispatch({ type: "JUDGE_RESULT", consensus: breakdown, scoresById });
    } catch (err) {
      dispatch({ type: "JUDGE_FAILED", error: errorMessage(err) });
    }
  }, []);

  const runFusion = useCallback(async (done: Candidate[], seed: StudioState) => {
    if (done.length === 0) return;
    dispatch({ type: "FUSION_START" });
    try {
      const content = await chatCompletion({
        model: seed.criticModel,
        messages: fusionMessages({
          prompt: seed.prompt,
          rubric: seed.rubric,
          candidates: done,
        }),
        temperature: 0.3,
      });
      dispatch({ type: "FUSION_RESULT", text: content });
    } catch (err) {
      dispatch({ type: "FUSION_FAILED", error: errorMessage(err) });
    }
  }, []);

  const enabledCount = state.slots.filter((s) => s.enabled).length;
  const canRun = apiKeyPresent && !state.running && state.prompt.trim().length > 0 && enabledCount > 0;

  // ---- Rank/Fuse toggle behavior (UI.md §6) ---------------------------------
  // Flipping to Rank never costs a call (Judge already ran). Flipping to Fuse
  // after a completed run triggers a synthesizer pass the first time only —
  // re-switching is free for that run because fusionStatus is then "done".
  const handleModeChange = useCallback(
    (mode: Mode) => {
      dispatch({ type: "SET_MODE", mode });
      if (mode === "fuse") {
        const s = stateRef.current;
        // The toggle fires AFTER a run completes, so stateRef has fully synced —
        // safe to read the done candidates here (unlike the post-fanout path).
        const done = s.candidates.filter((c) => c.status === "done");
        if (done.length > 0 && !s.running && s.fusionStatus === "idle") {
          void runFusion(done, s);
        }
      }
    },
    [runFusion]
  );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100 antialiased">
      <Header state={state} onOpenCommand={() => setCommandOpen(true)}>
        <ModeToggle mode={state.mode} onChange={handleModeChange} />
      </Header>

      {!apiKeyPresent && <NoKeyBanner />}

      {/*
        Responsive workspace (DESIGN.md):
        - lg (≥1024px): two panes side-by-side, 50/50. Command left, output right.
        - md (768–1023px): panes stack — command on top, output below; output gets
          priority height since it's the deliverable.
        - <md (<768px): output is primary (full viewport); command opens as a
          right-side drawer from the header hamburger.
      */}
      <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] lg:grid-cols-2 lg:grid-rows-1">
        {/*
          Command pane — inline only at md+ (tablet stack + desktop split).
          On mobile (<md) it is hidden here and rendered as a drawer below.
        */}
        <section
          aria-label="Command"
          className="hidden min-h-0 overflow-y-auto border-b border-zinc-800 lg:border-b-0 lg:border-r md:block"
        >
          <CommandPane state={state} dispatch={dispatch} canRun={canRun} onRun={runFanout} />
        </section>

        <section aria-label="Output" className="min-h-0 overflow-y-auto">
          <OutputPane state={state} />
        </section>
      </div>

      {/* Mobile command drawer (<768px). Slides over the output; backdrop closes it. */}
      {commandOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            aria-hidden="true"
            onClick={() => setCommandOpen(false)}
          />
          <aside
            aria-label="Command (drawer)"
            className="fixed inset-y-0 left-0 z-50 w-[85%] max-w-sm overflow-y-auto border-r border-zinc-800 bg-zinc-950 shadow-2xl md:hidden"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <span className="font-mono text-xs uppercase tracking-wider text-zinc-500">Command</span>
              <button
                type="button"
                onClick={() => setCommandOpen(false)}
                aria-label="Close command pane"
                className="flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <CloseIcon />
              </button>
            </div>
            <CommandPane
              state={state}
              dispatch={dispatch}
              canRun={canRun}
              onRun={() => {
                runFanout();
                setCommandOpen(false);
              }}
            />
          </aside>
        </>
      )}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

// =============================================================================
// Command pane — full implementation (Phase 2). Composes the four command
// components: TaskInput · ModelList · RubricDisclosure · RunButton.
// =============================================================================

function CommandPane({
  state,
  dispatch,
  canRun,
  onRun,
}: {
  state: StudioState;
  dispatch: React.Dispatch<Action>;
  canRun: boolean;
  onRun: () => void;
}) {
  const enabledCount = state.slots.filter((s) => s.enabled).length;
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <PaneLabel index="01" title="Command" hint="identical in Rank & Fuse" />

      <TaskInput prompt={state.prompt} dispatch={dispatch} />
      <ModelList slots={state.slots} models={state.models} dispatch={dispatch} />
      <RubricDisclosure rubric={state.rubric} dispatch={dispatch} />
      <JudgeConfig criticModel={state.criticModel} models={state.models} dispatch={dispatch} />

      <RunButton
        running={state.running}
        canRun={canRun}
        enabledCount={enabledCount}
        onClick={onRun}
      />
    </div>
  );
}

// ---- small presentational helpers ----

function PaneLabel({ index, title, hint }: { index: string; title: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-zinc-600">{index}</span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <span className="font-mono text-xs uppercase tracking-wider text-zinc-600">{hint}</span>
    </div>
  );
}

// =============================================================================
// Helpers / banner
// =============================================================================

function NoKeyBanner() {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/[0.06] px-4 py-2 text-xs text-amber-300">
      <span>
        <span className="font-semibold">No OpenRouter API key detected.</span> Create a{" "}
        <code className="rounded bg-amber-500/10 px-1">.env</code> file with{" "}
        <code className="rounded bg-amber-500/10 px-1">VITE_OPENROUTER_KEY=sk-or-…</code> and restart the dev server
        to enable live runs.
      </span>
    </div>
  );
}
