// =============================================================================
// OutputPane — the right-pane router (Phase 3.1).
//
// Mode-conditioned: renders RankResult or FuseResult based on state.mode. Handles
// the shared chrome (the 02 / Output label), plus empty / running / error states
// that apply before the mode-specific result. Per UI.md §1, only the right pane
// changes when the toggle flips — the command pane is unaffected.
// =============================================================================

import { Loader2, RotateCcw } from "lucide-react";
import type { StudioState } from "../studio-engine";
import type { Candidate } from "../studio-data";
import { RankResult } from "./RankResult";
import { FuseResult } from "./FuseResult";

export function OutputPane({ state }: { state: StudioState }) {
  const hasRun = state.candidates.length > 0 || state.running;
  const hint = state.mode === "rank" ? "leaderboard + recommendation" : "merged answer";

  const stageError =
    state.mode === "rank"
      ? state.judgeStatus === "error"
      : state.fusionStatus === "error";

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <PaneLabel index="02" title="Output" hint={hint} />

      {!hasRun && <EmptyState mode={state.mode} />}

      {hasRun && state.running && (
        <div className="flex flex-1 flex-col gap-3">
          {/* Stage progress strip — at-a-glance read of where the pipeline is.
              Generating → Judging → (Fusing, fuse mode only). */}
          <StageProgress state={state} />
          {/* Live candidate stream — transparent during the run, not a black box.
              Each model shows its real-time status and, once done, its summary +
              a truncated excerpt so you can see what it actually generated. */}
          <ul className="flex flex-1 flex-col gap-2 overflow-y-auto scroll-thin">
            {state.candidates.map((c) => (
              <LiveCandidateCard key={c.id} candidate={c} />
            ))}
          </ul>
        </div>
      )}

      {hasRun && !state.running && stageError && (
        <ErrorState
          message={
            state.mode === "rank"
              ? state.judgeError ?? "Judge failed."
              : state.fusionError ?? "Fusion failed."
          }
        />
      )}

      {hasRun && !state.running && !stageError && state.mode === "rank" && <RankResult state={state} />}
      {hasRun && !state.running && !stageError && state.mode === "fuse" && <FuseResult state={state} />}
    </div>
  );
}

// ---- shared chrome ----------------------------------------------------------

/** Three-step pipeline progress indicator (Generating → Judging → [Fusing]). */
function StageProgress({ state }: { state: StudioState }) {
  const fanoutDone = state.candidates.length > 0 && state.candidates.every((c) => c.status !== "pending");
  const judging = state.judgeStatus === "running" || (fanoutDone && state.judgeStatus === "idle");
  const fusing = state.mode === "fuse" && state.fusionStatus === "running";

  type Step = { label: string; state: "done" | "active" | "pending" };
  const steps: Step[] = [
    { label: "Generating", state: fanoutDone && !judging ? "done" : !fanoutDone ? "active" : "done" },
    {
      label: "Judging",
      state: judging ? "active" : state.judgeStatus === "done" ? "done" : "pending",
    },
  ];
  if (state.mode === "fuse") {
    steps.push({
      label: "Fusing",
      state: fusing ? "active" : state.fusionStatus === "done" ? "done" : "pending",
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-zinc-700">→</span>}
          <span
            className={`flex items-center gap-1.5 rounded px-2 py-1 font-mono text-xs ${
              step.state === "active"
                ? "bg-cyan-500/15 text-cyan-300"
                : step.state === "done"
                  ? "text-emerald-400"
                  : "text-zinc-600"
            }`}
          >
            {step.state === "active" && <Loader2 size={11} className="animate-spin" />}
            {step.state === "done" && <span className="size-1.5 rounded-full bg-emerald-400" />}
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One card in the live candidate stream during a run. */
function LiveCandidateCard({ candidate }: { candidate: Candidate }) {
  const excerpt =
    candidate.segments.length > 0
      ? candidate.segments[0].text
      : candidate.summary || "";
  return (
    <li className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2">
      <div className="flex items-center gap-2">
        {candidate.status === "pending" && <Loader2 size={12} className="animate-spin text-zinc-500" />}
        {candidate.status === "done" && <span className="size-1.5 rounded-full bg-emerald-400" />}
        {candidate.status === "error" && <span className="size-1.5 rounded-full bg-rose-400" />}
        <span className="flex-1 truncate font-mono text-sm text-zinc-200" title={candidate.provider}>
          {candidate.model}
        </span>
        <span
          className={`font-mono text-xs uppercase tracking-wider ${
            candidate.status === "done"
              ? "text-emerald-400"
              : candidate.status === "error"
                ? "text-rose-400"
                : "text-zinc-500"
          }`}
        >
          {candidate.status === "pending" ? "generating" : candidate.status}
        </span>
      </div>
      {candidate.status === "done" && excerpt.length > 0 && (
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-zinc-400">{excerpt}</p>
      )}
      {candidate.status === "error" && candidate.errorMessage && (
        <p className="mt-1.5 text-sm leading-relaxed text-rose-400/80">{candidate.errorMessage}</p>
      )}
    </li>
  );
}

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

function EmptyState({ mode }: { mode: "rank" | "fuse" }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-md border border-dashed border-zinc-800 py-16 text-center">
      <RotateCcw size={20} className="text-zinc-700" />
      <p className="mt-3 text-sm text-zinc-500">
        {mode === "rank"
          ? "Run the pipeline to see the ranking."
          : "Run the pipeline to fuse a merged answer."}
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/[0.04] py-10 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-wider text-rose-400">Error</p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-300">{message}</p>
      <p className="mt-2 font-mono text-sm text-zinc-600">
        Fix the issue and re-run from the command pane.
      </p>
    </div>
  );
}
