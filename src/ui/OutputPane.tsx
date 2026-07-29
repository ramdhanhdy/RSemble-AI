// =============================================================================
// OutputPane — the right-pane router (Phase 3.1).
//
// Mode-conditioned: renders RankResult or FuseResult based on state.mode. Handles
// the shared chrome (the 02 / Output label), plus empty / running / error states
// that apply before the mode-specific result. Per UI.md §1, only the right pane
// changes when the toggle flips — the command pane is unaffected.
// =============================================================================

import { memo, useState } from "react";
import { AlertCircle, ArrowDown, Check, Copy, Loader2, RotateCw } from "lucide-react";
import type { StudioState } from "../studio-engine";
import { BrandAvatar } from "./brand-icons";
import type { Candidate } from "../studio-data";
import { isUsableCandidate } from "../lib/pipeline";
import { RankResult } from "./RankResult";
import { CompareView } from "./CompareView";
import { FuseResult } from "./FuseResult";
import { LeaderboardPreviewCard, PipelineRail, WhatYouGetRow, computeStages } from "./PipelineRail";
import { useRunClock, elapsedSeconds } from "./useRunClock";
import { useStickToBottom } from "./useStickToBottom";

import { getRunCountCached, getRunsCached, type RunHistoryEntry } from "../lib/history-cache";

export function scrollLiveTranscriptToEnd(transcript: { scrollTop: number; readonly scrollHeight: number }): void {
  transcript.scrollTop = transcript.scrollHeight;
}

/** Extract the slug portion from a composite key ("providerId:slug" → "slug").
 *  Tolerates legacy bare-slug keys (no colon → returns as-is). */
function slugFromKey(key: string): string {
  const idx = key.indexOf(":");
  return idx >= 0 ? key.slice(idx + 1) : key;
}

/** After this many ms with no text, the waiting caption adopts a warning tone. */
const FIRST_TOKEN_PATIENCE_MS = 15_000;

export function OutputPane({
  state,
  onFuse,
  onRefuse,
  onRetryCandidate,
  onRetryJudge,
}: {
  state: StudioState;
  /** Pass-through from AdaptiveFusion: fuse the current run's candidates. */
  onFuse?: () => void;
  /** Re-run fusion on the current run's candidates (Re-fuse action). */
  onRefuse?: () => void;
  onRetryCandidate?: (candidate: Candidate) => void;
  /** Judge-only retry: re-judge the retained candidate outputs after a Judge
   *  failure, without regenerating candidates (run-recovery spec §5). */
  onRetryJudge?: () => void;
}) {
  const [compareMode, setCompareMode] = useState(false);
  const hasRun = state.candidates.length > 0 || state.running;
  const hint = state.mode === "rank" ? "leaderboard + recommendation" : "merged answer";
  const liveNow = useRunClock(state.running);

  // In fuse mode, a judge failure is also a terminal error — the pipeline
  // stopped before fusion ran. Surface judge errors alongside fusion errors.
  const stageError =
    state.mode === "rank"
      ? state.judgeStatus === "error"
      : state.judgeStatus === "error" || state.fusionStatus === "error";
  const stageErrorMessage =
    state.mode === "rank"
      ? state.judgeError ?? "Judge failed."
      : state.judgeStatus === "error"
        ? state.judgeError ?? "Judge failed."
        : state.fusionError ?? "Fusion failed.";

  // Judge-only retry availability (spec §5.1): a terminal Judge failure, no
  // stage active, run not aborted, ≥2 usable candidates, and the frozen run
  // context still present. A Fusion-only failure (Judge succeeded) is excluded
  // — retrying the Judge there would be meaningless.
  const judgeRetryEligible =
    state.judgeStatus === "error" &&
    !state.running &&
    !state.aborted &&
    state.candidates.filter(isUsableCandidate).length >= 2 &&
    state.runContext != null;

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-5">
      <PaneLabel index="02" title="Output" hint={hint} />

      {!hasRun && <EmptyState mode={state.mode} />}

      {hasRun && state.running && (
        <div className="flex flex-1 flex-col gap-3">
          {/* Stage progress strip — at-a-glance read of where the pipeline is.
              Generating → Judging → (Fusing, fuse mode only). */}
          <PipelineRail mode={state.mode} stages={computeStages(state)} />
          {/* When the judge/fusion stage is active, show a richer banner: a live
              timer + what's being compared. Turns the wait into intentional UI. */}
          <StageBanner state={state} />
          {/* Live candidate stream — transparent during the run, not a black box.
              Each model shows its full real-time transcript (scrollable) while
              streaming and after completion. min-h-0 lets the grid flex item
              shrink so each card gets a bounded, scrollable body. */}
          <ul className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto scroll-thin xl:grid-cols-2 2xl:grid-cols-3">
            {state.candidates.map((c) => (
              <LiveCandidateCard key={c.id} candidate={c} onRetry={state.running ? undefined : onRetryCandidate} now={liveNow} />
            ))}
          </ul>
        </div>
      )}

      {hasRun && !state.running && state.insufficient && (
        <InsufficientState
          done={state.insufficient.done}
          failed={state.insufficient.failed}
          mode={state.mode}
          candidates={state.candidates}
          onRetryCandidate={onRetryCandidate}
        />
      )}

      {hasRun && !state.running && !state.insufficient && stageError && (
        <ErrorState
          message={stageErrorMessage}
          candidates={state.candidates}
          onRetryCandidate={onRetryCandidate}
          onRetryJudge={onRetryJudge}
          judgeRetryEligible={judgeRetryEligible}
          retryActive={state.running}
        />
      )}
      {hasRun &&
        !state.running &&
        !state.insufficient &&
        !stageError &&
        !state.aborted &&
        state.mode === "rank" && (
          compareMode ? (
            <CompareView
              candidates={state.candidates}
              rubric={state.rubric}
              onClose={() => setCompareMode(false)}
            />
          ) : (
            <RankResult state={state} onFuse={onFuse} onCompare={() => setCompareMode(true)} />
          )
        )}
      {hasRun &&
        !state.running &&
        !state.insufficient &&
        !stageError &&
        !state.aborted &&
        state.mode === "fuse" && <FuseResult state={state} onRefuse={onRefuse} />}

      {hasRun && !state.running && state.aborted && (
        <AbortedState candidates={state.candidates} />
      )}
    </div>
  );
}

/** Terminal state when too few candidates survived to rank or fuse.
 *  Shows WHICH candidates were non-usable (model name + truthful reason), not
 *  just an aggregate count, and offers per-candidate retry when a callback is
 *  available. A candidate is non-usable when it errored during generation OR
 *  completed the transport (status "done") but produced empty/whitespace
 *  content (truncated/aborted return). Both classes must be shown so the user
 *  can act on every unusable model, not just the errored ones. */
export function InsufficientState({
  done,
  failed,
  mode,
  candidates,
  onRetryCandidate,
}: {
  done: number;
  failed: number;
  mode: "rank" | "fuse";
  candidates: Candidate[];
  onRetryCandidate?: (candidate: Candidate) => void;
}) {
  const verb = mode === "fuse" ? "fuse" : "rank";
  // Non-usable = errored candidates AND done-but-empty candidates. The legacy
  // behaviour filtered on status==="error" only, silently omitting empty done
  // candidates from the actionable per-candidate list.
  const nonUsable = candidates.filter((c) => !isUsableCandidate(c));
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-md border border-warning/40 bg-warning/[0.08] py-10 px-6 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-warning">Stopped</p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-text-secondary">
        Only <span className="font-semibold text-text">{done} of {done + failed}</span> candidate(s)
        succeeded — need at least <span className="font-semibold text-text">2</span> to {verb}.
      </p>
      {failed > 0 && (
        <p className="mt-1 font-mono text-sm text-text-muted">
          {failed} candidate{failed === 1 ? "" : "s"} failed during generation.
        </p>
      )}
      {/* Per-candidate failure detail — model name + truthful reason, not just a
          count. This is the core fix: the aggregate count hid WHICH model was
          non-usable and WHY, leaving the user unable to act on the specific
          failure. Both errored and empty-done candidates are listed here. */}
      {nonUsable.length > 0 && (
        <ul className="mt-4 flex w-full max-w-md flex-col gap-2 text-left">
          {nonUsable.map((c) => {
            const isEmptyDone = c.status === "done";
            const reason = isEmptyDone
              ? "Completed but produced no content — response was empty or truncated."
              : c.errorMessage || "Candidate failed during generation.";
            return (
              <li key={c.id} className="flex items-start gap-2 rounded-sm border border-error/30 bg-error/[0.06] px-3 py-2">
                <span className="mt-1 size-2 shrink-0 rounded-full bg-error" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <BrandAvatar slug={c.slug} size={18} />
                    <span className="truncate font-mono text-sm text-text" title={c.provider}>{c.model}</span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-error/80">{reason}</p>
                </div>
                {onRetryCandidate && (
                  <button
                    type="button"
                    onClick={() => onRetryCandidate(c)}
                    aria-label={`Retry ${c.model}`}
                    className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-sm border border-edge px-3 font-mono text-xs text-text-secondary hover:border-accent/50 hover:text-accent"
                  >
                    <RotateCw size={13} /> Retry
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 font-mono text-sm text-text-muted">
        Check the model slugs in the command pane and re-run.
      </p>
    </div>
  );
}

// ---- shared chrome ----------------------------------------------------------

/** Three-step pipeline progress indicator (Generating → Judging → [Fusing]). */
/**
 * Banner shown when the Judge or Fusion stage is active. Gives the wait meaning:
 * a live elapsed timer + a plain-language sentence about what's happening. The
 * judge's output is JSON, so we don't stream it (unreadable mid-stream) — the
 * timer + context is the liveness signal.
 */
function StageBanner({ state }: { state: StudioState }) {
  const fanoutDone =
    state.candidates.length > 0 && state.candidates.every((c) => c.status !== "pending");
  const judging = state.judgeStatus === "running" || (fanoutDone && state.judgeStatus === "idle");
  const fusing = state.mode === "fuse" && state.fusionStatus === "running";
  const active = judging || fusing;
  const now = useRunClock(active);
  const stageStart = state.candidates[0]?.startedAt;
  const seconds = active ? elapsedSeconds(stageStart, now) : 0;

  if (!active) return null;

  const doneCount = state.candidates.filter((c) => c.status === "done").length;
  const stage = fusing ? "Fusing" : "Judging";
  const verb = fusing
    ? "merging the strongest material from all candidates into one answer"
    : `comparing ${doneCount} candidate${doneCount === 1 ? "" : "s"} against the rubric and scoring each`;

  return (
    <div className="flex items-center gap-2 rounded-md border border-accent/20 bg-accent/[0.04] px-3 py-2">
      <Loader2 size={13} className="animate-spin-ease text-accent" />
      <span className="text-sm text-text-secondary">
        <span className="font-mono text-accent">{stage}</span> · {verb}.
      </span>
      <span className="ml-auto font-mono text-sm tabular-nums text-text-muted">{seconds}s</span>
    </div>
  );
}

export const LiveCandidateCard = memo(function LiveCandidateCard({
  candidate,
  onRetry,
  now = Date.now(),
}: {
  candidate: Candidate;
  onRetry?: (candidate: Candidate) => void;
  /** Shared run clock timestamp. Only consulted for in-flight candidates; done
   *  or errored cards use finishedAt. Defaults to render time for terminal cards. */
  now?: number;
}) {
  // Single continuous source: segments once CANDIDATE_RESULT fires (streamingText
  // is cleared at that same moment), otherwise the accumulated stream. Continuous
  // across completion — no flicker, no content loss, no tail window.
  const liveText =
    candidate.segments.length > 0
      ? candidate.segments.map((s) => s.text).join("\n\n")
      : (candidate.streamingText ?? "");
  const elapsed = candidate.startedAt
    ? candidate.finishedAt
      ? Math.round((candidate.finishedAt - candidate.startedAt) / 1000)
      : elapsedSeconds(candidate.startedAt, now)
    : 0;
  const active = candidate.status === "pending";
  // A done candidate with no content is unusable — it completed the transport
  // (status "done") but produced empty/truncated text. Show it honestly as
  // unusable rather than a silent success.
  const unusable = candidate.status === "done" && !isUsableCandidate(candidate);
  const showTranscript = liveText.length > 0 && !unusable;
  const waiting = active && liveText.length === 0;
  const elapsedMs = candidate.startedAt ? (candidate.finishedAt ?? now) - candidate.startedAt : 0;
  const impatient = waiting && elapsedMs >= FIRST_TOKEN_PATIENCE_MS;

  const { ref: transcriptRef, onScroll, pinned, jumpToLatest } =
    useStickToBottom<HTMLParagraphElement>(liveText);
  const [copied, setCopied] = useState(false);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(liveText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <li className={`relative flex min-h-0 flex-col rounded-md border bg-card px-3 py-2 ${
      candidate.status === "error" || unusable ? "border-warning/40" : "border-edge"
    }`}>
      <div className="flex items-center gap-2">
        {active && <Loader2 size={12} className="animate-spin-ease text-accent" />}
        {candidate.status === "done" && !unusable && <span className="size-2 rounded-full bg-success" />}
        {candidate.status === "error" && <span className="size-2 rounded-full bg-error" />}
        {unusable && <AlertCircle size={12} className="text-warning" />}
        <BrandAvatar slug={candidate.slug} size={24} />
        <span className="flex-1 truncate font-mono text-sm text-text" title={candidate.provider}>
          {candidate.model}
        </span>
        {candidate.tokensOut != null && candidate.tokensOut > 0 && (
          <span className="font-mono text-xs tabular-nums text-text-muted">{candidate.tokensOut} tok</span>
        )}
        <span className="font-mono text-xs tabular-nums text-text-muted">{elapsed}s</span>
        <span
          className={`font-mono text-[11px] uppercase tracking-wider ${
            unusable
              ? "text-warning"
              : candidate.status === "done"
                ? "text-success"
                : candidate.status === "error"
                  ? "text-error"
                  : "text-text-secondary"
          }`}
        >
          {active ? "generating" : unusable ? "unusable" : candidate.status}
        </span>
      </div>

      {/* Full-text scrollable transcript — streaming and done share one body so
          completion doesn't shrink the visible text. Stick-to-bottom only while
          the user is already at the end; scroll up to read mid-stream. */}
      {showTranscript && (
        <p
          ref={transcriptRef}
          onScroll={onScroll}
          className="mt-2 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-text-secondary scroll-thin"
        >
          {liveText}
          {active && (
            <span className="ml-1 inline-block h-4 w-2 animate-pulse-ease bg-accent/70 align-middle" />
          )}
        </p>
      )}

      {/* Jump-to-latest — only while streaming and the user has scrolled away. */}
      {active && showTranscript && !pinned && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-2 right-2 flex items-center gap-1 rounded-sm border border-edge bg-card px-2 py-1 font-mono text-xs text-text-secondary shadow-sm hover:border-accent/50 hover:text-accent"
        >
          <ArrowDown size={12} /> Jump to latest
        </button>
      )}

      {/* Pre-first-token waiting state — an explicit signal, not a blank card. */}
      {waiting && (
        <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1.5">
          <div className="h-3 w-full animate-pulse rounded-sm bg-edge/30" />
          <div className="h-3 w-4/5 animate-pulse rounded-sm bg-edge/30" />
          <div className="h-3 w-3/5 animate-pulse rounded-sm bg-edge/30" />
          <p className="mt-auto pt-2 font-mono text-xs text-text-muted">
            {impatient
              ? "still waiting — model may be thinking before it emits text"
              : `waiting for first token · ${elapsed}s`}
          </p>
        </div>
      )}

      {/* Done footer — copy affordance so a finished answer can be lifted during
          the judge stage without waiting for the run to end. */}
      {candidate.status === "done" && !unusable && (
        <div className="mt-2 flex items-center justify-end">
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? "Copied" : `Copy ${candidate.model} answer`}
            className="flex min-h-[36px] items-center gap-1 rounded-sm px-2 font-mono text-xs text-text-secondary hover:text-text"
          >
            {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            {copied ? "copied" : "copy"}
          </button>
        </div>
      )}

      {unusable && (
        <div className="mt-2 flex items-center gap-2">
          <p className="flex-1 text-sm leading-relaxed text-warning/80">
            Completed but produced no content — response was empty or truncated.
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(candidate)}
              aria-label={`Retry ${candidate.model}`}
              className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-sm border border-edge px-3 font-mono text-xs text-text-secondary hover:border-accent/50 hover:text-accent"
            >
              <RotateCw size={13} /> Retry
            </button>
          )}
        </div>
      )}
      {candidate.status === "error" && candidate.errorMessage && (
        <div className="mt-2 flex items-center gap-2">
          <p className="flex-1 text-sm leading-relaxed text-error/80">{candidate.errorMessage}</p>
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(candidate)}
              aria-label={`Retry ${candidate.model}`}
              className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-sm border border-edge px-3 font-mono text-xs text-text-secondary hover:border-accent/50 hover:text-accent"
            >
              <RotateCw size={13} /> Retry
            </button>
          )}
        </div>
      )}
    </li>
  );
});

function PaneLabel({ index, title, hint }: { index: string; title: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xs font-semibold tabular-nums text-accent">{index}</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">{title}</span>
      </div>
      <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">{hint}</span>
    </div>
  );
}

function EmptyState({ mode }: { mode: "rank" | "fuse" }) {
  const hasHistory = getRunCountCached() > 0;
  return (
    // On mobile the content is taller than the viewport, so start at the top of
    // the scroll origin (justify-start) instead of centering content above it.
    // sm+ has room to center.
    <div className="flex flex-1 flex-col items-center justify-start gap-6 overflow-y-auto px-4 py-6 text-center scroll-thin sm:justify-center sm:gap-8 sm:px-6 sm:py-10">
      <PipelineRail mode={mode} />
      <p className="max-w-sm text-sm leading-relaxed text-text-secondary">
        Compare responses from multiple models side-by-side, then{" "}
        <span className="font-semibold text-text">
          {mode === "rank" ? "pick the best" : "merge them into one"}
        </span>
        .
      </p>
      {/* The static preview/benefit cards are desktop space-fillers — hide on
          mobile so the rail + guidance fit the first viewport without scrolling. */}
      <div className="hidden sm:contents">
        <LeaderboardPreviewCard />
        {hasHistory ? <RecentRuns /> : <WhatYouGetRow />}
      </div>
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
        Configure the command pane, then Run pipeline
      </p>
    </div>
  );
}

/** Recent runs list — shown once the user has at least one completed run in
 *  history. Replaces the static "What you get" 3-up row so the empty state
 *  becomes a live surface: the rail + preview stay, but the bottom half now
 *  reflects actual past activity. Rows are read-only (config reload is a
 *  future phase, so there is intentionally no click affordance). */
function RecentRuns() {
  const runs = getRunsCached(3);
  return (
    <div className="w-full max-w-3xl rounded-md border border-edge bg-card p-3 text-left">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Recent runs
        </span>
        <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
          {runs.length} of {getRunCountCached()}
        </span>
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {runs.map((run) => (
          <RecentRunRow key={`${run.timestamp}`} run={run} />
        ))}
      </ul>
    </div>
  );
}

function RecentRunRow({ run }: { run: RunHistoryEntry }) {
  const winnerStats = run.stats[run.winner];
  const score = winnerStats?.score;
  // Read-only history row. Config reload is not implemented, so this is NOT a
  // button — a clickable affordance that does nothing on activation is a no-op
  // control (and fails "no advertised action is a no-op").
  return (
    <li
      className="flex w-full min-h-[44px] items-center gap-3 rounded-sm px-2 py-1.5"
      title={run.taskExcerpt}
    >
      <BrandAvatar slug={slugFromKey(run.winner)} size={24} />
      <span className="flex-1 truncate text-sm text-text">{run.taskExcerpt}</span>
      {score != null && (
        <span className="font-mono text-sm tabular-nums text-accent">{score.toFixed(1)}/5</span>
      )}
      <span className="font-mono text-xs tabular-nums text-text-muted">{formatRelativeTime(run.timestamp)}</span>
    </li>
  );
}

/** Compact relative-time formatter: "2m ago", "1h ago", "3d ago". Falls back
 *  to a date string for anything older than a week. */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  return new Date(timestamp).toLocaleDateString();
}

function ErrorState({
  message,
  candidates,
  onRetryCandidate,
  onRetryJudge,
  judgeRetryEligible,
  retryActive,
}: {
  message: string;
  candidates: Candidate[];
  onRetryCandidate?: (candidate: Candidate) => void;
  /** Judge-only recovery action (run-recovery spec §5.5). Rendered only when
   *  the failure was a Judge error with ≥2 usable candidates retained. */
  onRetryJudge?: () => void;
  judgeRetryEligible?: boolean;
  retryActive?: boolean;
}) {
  const done = candidates.filter((c) => c.status === "done");
  const failed = candidates.filter((c) => c.status === "error");
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto scroll-thin">
      <div className="flex flex-col items-center justify-center rounded-md border border-error/40 bg-error/[0.08] py-8 px-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-error">Error</p>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-text-secondary">{message}</p>
        {judgeRetryEligible ? (
          <p className="mt-2 font-mono text-sm text-text-muted">
            Fix the Judge settings or retry the retained candidates below.
          </p>
        ) : (
          <p className="mt-2 font-mono text-sm text-text-muted">
            Fix the issue and re-run from the command pane.
          </p>
        )}
        {judgeRetryEligible && onRetryJudge && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="text-sm leading-relaxed text-text-secondary">
              Candidate generation succeeded — only the Judge failed.
            </p>
            <button
              type="button"
              onClick={onRetryJudge}
              disabled={retryActive}
              aria-label="Retry Judge using completed candidates"
              className="flex min-h-[44px] items-center gap-2 rounded-md border border-accent/50 bg-accent/[0.08] px-4 font-mono text-sm text-accent hover:bg-accent/[0.14] disabled:opacity-50"
            >
              <RotateCw size={14} /> Retry Judge
            </button>
            <p className="text-xs leading-relaxed text-text-muted">
              Reuses the completed candidate outputs. You can change the Judge model first.
            </p>
          </div>
        )}
      </div>
      {done.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
            Generated candidates · {done.length} completed
          </div>
          <ul className="grid grid-cols-1 gap-2 xl:grid-cols-2 2xl:grid-cols-3">
            {done.map((c) => (
              <LiveCandidateCard key={c.id} candidate={c} />
            ))}
          </ul>
        </div>
      )}
      {failed.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
            Failed candidates · {failed.length} errored
          </div>
          <ul className="grid grid-cols-1 gap-2 xl:grid-cols-2 2xl:grid-cols-3">
            {failed.map((c) => (
              <LiveCandidateCard key={c.id} candidate={c} onRetry={onRetryCandidate} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AbortedState({ candidates }: { candidates: import("../studio-data").Candidate[] }) {
  const done = candidates.filter((c) => c.status === "done");
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-md border border-edge bg-card py-10 px-6 text-center">
      <AlertCircle size={24} className="text-text-secondary" />
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary">Aborted</p>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-text-secondary">
          Run stopped. {done.length > 0
            ? `${done.length} candidate${done.length === 1 ? "" : "s"} completed before abort — partial results are preserved below.`
            : "No candidates completed before abort."}
        </p>
      </div>
      {done.length > 0 && (
        <ul className="w-full max-w-md space-y-1 text-left">
          {done.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-sm border border-edge bg-panel px-3 py-2">
              <span className="size-2 shrink-0 rounded-full bg-success" />
              <span className="flex-1 truncate font-mono text-sm text-text" title={c.model}>{c.model}</span>
              <span className="font-mono text-xs text-text-muted">{c.summary.slice(0, 60)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="font-mono text-sm text-text-muted">
        Run again from the command pane to start fresh.
      </p>
    </div>
  );
}
