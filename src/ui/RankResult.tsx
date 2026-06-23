// =============================================================================
// RankResult — the RANK output surface.
//
// This is the decision Rank mode exists to produce. Four regions, per UI.md §4:
//   4.1  Recommendation callout (emerald) — the actual verdict.
//   4.2  Leaderboard — sorted by weightedScore, tier-colored bars.
//   4.3  Judge breakdown — consensus (zinc) + contradiction (amber) cards.
//   4.4  Historical callback — one-liner (optional, surfaced only here).
// =============================================================================

import { Crown, GitMerge } from "lucide-react";
import type { StudioState } from "../studio-engine";
import type { Candidate } from "../studio-data";
import { FailedCandidates } from "./FailedCandidates";
import { CandidateAnswer } from "./CandidateAnswer";

function tier(score: number): { bar: string; text: string } {
  if (score >= 4.0) return { bar: "bg-emerald-400", text: "text-emerald-400" };
  if (score >= 3.0) return { bar: "bg-cyan-400", text: "text-cyan-400" };
  return { bar: "bg-amber-400", text: "text-amber-400" };
}

export function RankResult({
  state,
  onFuse,
}: {
  state: StudioState;
  /** Flip to Fuse mode and synthesize one merged answer from this run's
   *  candidates. Drives the existing fusion path — no new pipeline logic. */
  onFuse?: () => void;
}) {
  const ranked = [...state.candidates]
    .filter((c) => c.status === "done")
    .sort((a, b) => b.weightedScore - a.weightedScore);
  const winner = ranked[0];
  const breakdown = state.consensus;
  const canFuse = onFuse != null && ranked.length >= 2 && !state.running;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* 4.1 Recommendation callout */}
      {winner ? <Recommendation winner={winner} /> : <NoRankedState />}

      {/* Fuse action — the Rank→Fuse capability surfaced where the user is looking,
          not buried in the header toggle. Drives the same fusion path as the toggle. */}
      {canFuse && (
        <button
          type="button"
          onClick={onFuse}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/[0.06] py-3 text-sm font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/[0.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
        >
          <GitMerge size={15} />
          Fuse these {ranked.length} candidates into one answer
        </button>
      )}

      {/* 4.2 Leaderboard */}
      {ranked.length > 0 && <Leaderboard ranked={ranked} />}

      {/* 4.3 Judge breakdown */}
      {breakdown && <Breakdown breakdown={breakdown} />}

      {/* 4.3b Full answers — each candidate's complete generated text, expandable */}
      {ranked.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="font-mono text-xs uppercase tracking-wider text-zinc-500">
            Full answers · click to read
          </div>
          {ranked.map((c, i) => (
            <CandidateAnswer key={c.id} candidate={c} rank={i + 1} defaultOpen={i === 0} />
          ))}
        </div>
      )}

      {/* 4.4 Historical callback — surfaced only in Rank mode, one line */}
      {/* Deferred: persistent scorecard across runs. Remove stub until implemented. */}

      {/* 4.5 Failed candidates — kept visible so a partial run is honest */}
      <FailedCandidates candidates={state.candidates} />
    </div>
  );
}

// ---- 4.1 recommendation -----------------------------------------------------

function Recommendation({ winner }: { winner: Candidate }) {
  return (
    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.06] px-4 py-3">
      <div className="flex items-center gap-2">
        <Crown size={13} className="text-emerald-400" />
        <span className="font-mono text-xs uppercase tracking-wider text-emerald-400">
          Recommend
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-100">
        Use <span className="font-semibold">{winner.model}</span> for this kind of task —{" "}
        <span className="text-zinc-400">highest rubric fit</span>{" "}
        <span className={`font-mono ${tier(winner.weightedScore).text}`}>
          {winner.weightedScore.toFixed(1)}/5
        </span>
      </p>
    </div>
  );
}

function NoRankedState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 py-10 text-center text-sm text-zinc-500">
      No candidates to rank yet.
    </div>
  );
}

// ---- 4.2 leaderboard --------------------------------------------------------

function Leaderboard({ ranked }: { ranked: Candidate[] }) {
  const top = ranked[0]?.weightedScore ?? 5;
  return (
    <div>
      <div className="mb-2 font-mono text-xs uppercase tracking-wider text-zinc-500">
        Leaderboard
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-800 divide-y divide-zinc-800">
        {ranked.map((c, i) => {
          const t = tier(c.weightedScore);
          const widthPct = Math.max(8, (c.weightedScore / 5) * 100);
          const isWinner = i === 0;
          return (
            <div
              key={c.id}
              className={`flex items-center gap-3 px-3 py-3 ${
                isWinner ? "bg-emerald-500/[0.04] ring-1 ring-inset ring-emerald-500/30" : ""
              }`}
            >
              <span className="w-4 font-mono text-xs text-zinc-500">{i + 1}</span>
              <span className="w-44 truncate font-mono text-sm" title={`${c.provider} · ${c.model}`}>
                {c.model}
              </span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full ${t.bar} ${isWinner ? "shadow-[0_0_6px] shadow-emerald-400/40" : ""}`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <span className={`w-9 text-right font-mono text-sm ${t.text}`}>
                {c.weightedScore.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-1 font-mono text-sm text-zinc-600">
        bars scaled to 5.0 · top score this run: {top.toFixed(1)}
      </p>
    </div>
  );
}

// ---- 4.3 judge breakdown (consensus / contradiction) -------------------------

function Breakdown({
  breakdown,
}: {
  breakdown: NonNullable<StudioState["consensus"]>;
}) {
  const { consensus, contradictions } = breakdown;
  if (consensus.length === 0 && contradictions.length === 0) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <BreakdownCard
        tone="zinc"
        title="Consensus"
        items={consensus}
        empty="No shared points identified."
      />
      <BreakdownCard
        tone="amber"
        title="Contradiction"
        items={contradictions}
        empty="No direct disagreements."
      />
    </div>
  );
}

function BreakdownCard({
  tone,
  title,
  items,
  empty,
}: {
  tone: "zinc" | "amber";
  title: string;
  items: string[];
  empty: string;
}) {
  const accent = tone === "amber" ? "text-amber-400" : "text-zinc-400";
  return (
    <div className="rounded-lg border border-zinc-800 p-3">
      <div className={`mb-2 font-mono text-xs uppercase tracking-wider ${accent}`}>
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-sm leading-relaxed text-zinc-600">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-zinc-300">
              <span className={`mt-2 size-1 shrink-0 rounded-full ${tone === "amber" ? "bg-amber-400" : "bg-zinc-500"}`} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
