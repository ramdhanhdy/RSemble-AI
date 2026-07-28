// =============================================================================
// RankResult — the RANK output surface.
//
// This is the decision Rank mode exists to produce. Four regions, per UI.md §4:
//   4.1  Recommendation callout (emerald) — the actual verdict.
//   4.2  Leaderboard — sorted by weightedScore, tier-colored bars.
//   4.3  Judge breakdown — consensus (zinc) + contradiction (amber) cards.
//   4.4  Historical callback — one-liner (optional, surfaced only here).
// =============================================================================

import { Crown, GitMerge, Columns2 } from "lucide-react";
import type { StudioState } from "../studio-engine";
import type { Candidate, ConsensusBreakdown } from "../studio-data";
import { isUsableCandidate } from "../lib/pipeline";
import { FailedCandidates } from "./FailedCandidates";
import { CandidateAnswer } from "./CandidateAnswer";
import { BrandAvatar } from "./brand-icons";

function tier(score: number): { bar: string; text: string; cell: string } {
  if (score >= 4.0) return { bar: "bg-success", text: "text-success", cell: "bg-success/10" };
  if (score >= 3.0) return { bar: "bg-accent", text: "text-accent", cell: "bg-accent/10" };
  return { bar: "bg-warning", text: "text-warning", cell: "bg-warning/10" };
}

export function RankResult({
  state,
  onFuse,
  onCompare,
}: {
  state: StudioState;
  /** Flip to Fuse mode and synthesize one merged answer from this run's
   *  candidates. Drives the existing fusion path — no new pipeline logic. */
  onFuse?: () => void;
  onCompare?: () => void;
}) {
  const ranked = [...state.candidates]
    .filter((c) => c.status === "done")
    .sort((a, b) => b.weightedScore - a.weightedScore);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  const breakdown = state.consensus;
  // The Fuse button is shown only when ≥2 candidates have genuine content
  // (matches the run-controller eligibility guard). An empty-content "done"
  // candidate does not count — clicking would be a silent no-op.
  const canFuse = onFuse != null && ranked.filter(isUsableCandidate).length >= 2 && !state.running;

  const margin = winner && runnerUp ? winner.weightedScore - runnerUp.weightedScore : null;
  const isCloseCall = margin != null && margin > 0 && margin <= 0.2;

  const hasScores = ranked.some((c) => Object.keys(c.scores ?? {}).length > 0);
  const criteria = hasScores
    ? Array.from(
        new Set(ranked.flatMap((c) => Object.keys(c.scores ?? {}))),
      )
    : [];

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* 4.1 Recommendation callout */}
      {winner ? (
        <Recommendation winner={winner} ranked={ranked} consensus={breakdown} />
      ) : (
        <NoRankedState />
      )}

      {/* Fuse action — the Rank→Fuse capability surfaced where the user is looking,
          not buried in the header toggle. Drives the same fusion path as the toggle. */}
      {canFuse && (
        <button
          type="button"
          onClick={onFuse}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/[0.06] py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/[0.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <GitMerge size={15} />
          Fuse these {ranked.length} candidates into one answer
        </button>
      )}

      {/* Compare view toggle */}
      {ranked.length >= 2 && onCompare && (
        <button
          type="button"
          onClick={onCompare}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-edge py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:bg-card-hover"
        >
          <Columns2 size={15} />
          Compare side-by-side
        </button>
      )}

      {/* 4.2 Leaderboard */}
      {ranked.length > 0 && <Leaderboard ranked={ranked} />}

      {/* 4.2b Close-call margin indicator */}
      {isCloseCall && (
        <p className="-mt-2 font-mono text-xs text-warning">
          Close call · {margin!.toFixed(1)} apart
        </p>
      )}

      {/* 4.2c Criterion matrix — models × criteria heat grid */}
      {hasScores && criteria.length > 0 && (
        <CriterionMatrix ranked={ranked} criteria={criteria} />
      )}

      {/* 4.3 Judge breakdown */}
      {breakdown && <Breakdown breakdown={breakdown} />}

      {/* 4.3b Full answers — each candidate's complete generated text, expandable */}
      {ranked.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="font-mono text-xs uppercase tracking-wider text-text-muted">
            Full answers · click to read
          </div>
          {ranked.map((c, i) => (
            <CandidateAnswer key={c.id} candidate={c} rank={i + 1} defaultOpen={i === 0} />
          ))}
        </div>
      )}

      {/* 4.4 Historical scorecard — deferred until persistent scorecard is implemented. */}

      {/* 4.5 Failed candidates — kept visible so a partial run is honest */}
      <FailedCandidates candidates={state.candidates} />
    </div>
  );
}

function Recommendation({
  winner,
  ranked,
  consensus,
}: {
  winner: Candidate;
  ranked: Candidate[];
  consensus: ConsensusBreakdown | null;
}) {
  const whyLine = buildWhyItWon(winner, ranked, consensus);
  return (
    <div className="rounded-lg border border-success/50 bg-success/[0.10] px-4 py-3">
      <div className="flex items-center gap-2">
        <BrandAvatar slug={winner.slug} size={18} className="rounded-sm" />
        <Crown size={13} className="text-success" />
        <span className="font-mono text-xs uppercase tracking-wider text-success">
          Recommend
        </span>
      </div>
      <p className="mt-1 text-sm text-text">
        Use <span className="font-semibold">{winner.model}</span> for this kind of task —{" "}
        <span className="text-text-secondary">{whyLine}</span>{" "}
        <span className={`font-mono ${tier(winner.weightedScore).text}`}>
          {winner.weightedScore.toFixed(1)}/5
        </span>
      </p>
    </div>
  );
}

function buildWhyItWon(
  winner: Candidate,
  ranked: Candidate[],
  consensus: ConsensusBreakdown | null,
): string {
  const winnerScores = winner.scores ?? {};
  const criteria = Object.keys(winnerScores);
  if (criteria.length === 0) {
    return consensus && consensus.consensus.length > 0
      ? "highest rubric fit · aligns with consensus"
      : "highest rubric fit";
  }

  let bestCriterion: string | null = null;
  let bestScore = -Infinity;
  for (const c of criteria) {
    const s = winnerScores[c];
    if (typeof s === "number" && s > bestScore) {
      bestScore = s;
      bestCriterion = c;
    }
  }

  let lostCriterion: string | null = null;
  let lostTo: Candidate | null = null;
  let lostMargin = -Infinity;
  for (const rival of ranked) {
    if (rival.id === winner.id) continue;
    const rivalScores = rival.scores ?? {};
    for (const c of criteria) {
      const w = winnerScores[c];
      const r = rivalScores[c];
      if (typeof w === "number" && typeof r === "number" && r > w) {
        const diff = r - w;
        if (diff > lostMargin) {
          lostMargin = diff;
          lostCriterion = c;
          lostTo = rival;
        }
      }
    }
  }

  const wonPart = bestCriterion
    ? `Won on ${bestCriterion} (${bestScore.toFixed(1)})`
    : "highest rubric fit";
  const lostPart =
    lostCriterion && lostTo
      ? `; lost ${lostCriterion} to ${lostTo.model}`
      : "";
  return `${wonPart}${lostPart}`;
}

function NoRankedState() {
  return (
    <div className="rounded-lg border border-dashed border-edge py-10 text-center text-sm text-text-muted">
      No candidates to rank yet.
    </div>
  );
}

// ---- 4.2 leaderboard --------------------------------------------------------

function Leaderboard({ ranked }: { ranked: Candidate[] }) {
  const top = ranked[0]?.weightedScore ?? 5;
  const allCriteria = Array.from(
    new Set(ranked.flatMap((c) => Object.keys(c.scores ?? {}))),
  );
  return (
    <div>
      <div className="mb-2 font-mono text-xs uppercase tracking-wider text-text-muted">
        Leaderboard
      </div>
      <div className="overflow-hidden rounded-lg border border-edge divide-y divide-edge">
        {ranked.map((c, i) => {
          const t = tier(c.weightedScore);
          const widthPct = Math.max(8, (c.weightedScore / 5) * 100);
          const isWinner = i === 0;
          const scores = c.scores ?? {};
          const hasMicro = allCriteria.length > 0;
          return (
            <div
              key={c.id}
              className={`flex items-center gap-3 px-3 py-3 ${
                isWinner
                  ? "bg-accent/[0.06] ring-1 ring-inset ring-accent/50 shadow-[0_0_12px_-2px] shadow-accent/30"
                  : ""
              }`}
            >
              <span className="w-4 font-mono text-xs text-text-muted">{i + 1}</span>
              <BrandAvatar slug={c.slug} size={28} className="rounded-md" />
              <span className="w-40 truncate font-mono text-sm" title={`${c.provider} · ${c.model}`}>
                {c.model}
              </span>
              <div className="flex flex-1 flex-col gap-1">
                <div className="relative h-2 overflow-hidden rounded-full bg-card-hover">
                  <div
                    className={`h-full ${t.bar}`}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                {hasMicro && (
                  <div className="flex flex-wrap gap-1">
                    {allCriteria.map((crit) => {
                      const s = scores[crit];
                      if (typeof s !== "number") return null;
                      const mt = tier(s);
                      const w = Math.max(6, (s / 5) * 100);
                      return (
                        <span
                          key={crit}
                          className="flex items-center gap-1"
                          title={`${crit}: ${s.toFixed(1)}`}
                        >
                          <span className="font-mono text-[11px] text-text-muted">{crit}</span>
                          <span className="relative inline-block h-1 w-12 overflow-hidden rounded-full bg-card-hover">
                            <span
                              className={`absolute inset-y-0 left-0 ${mt.bar}`}
                              style={{ width: `${w}%` }}
                            />
                          </span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <span className={`w-9 text-right font-mono text-sm ${t.text}`}>
                {c.weightedScore.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-1 font-mono text-sm text-text-muted">
        bars scaled to 5.0 · top score this run: {top.toFixed(1)}
      </p>
    </div>
  );
}

// ---- 4.2c criterion matrix — models × criteria heat grid --------------------

function CriterionMatrix({
  ranked,
  criteria,
}: {
  ranked: Candidate[];
  criteria: string[];
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-xs uppercase tracking-wider text-text-muted">
        Criterion matrix
      </div>
      <div className="overflow-x-auto rounded-lg border border-edge">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-card-hover">
              <th className="sticky left-0 z-10 bg-card-hover px-3 py-2 text-left font-mono text-xs uppercase tracking-wider text-text-muted">
                Model
              </th>
              {criteria.map((crit) => (
                <th
                  key={crit}
                  className="px-3 py-2 text-center font-mono text-xs uppercase tracking-wider text-text-muted"
                >
                  {crit}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((c, i) => {
              const scores = c.scores ?? {};
              const isWinner = i === 0;
              return (
                <tr key={c.id} className="border-t border-edge">
                  <td
                    className={`sticky left-0 z-10 bg-panel px-3 py-2 font-mono text-xs ${
                      isWinner ? "text-accent" : "text-text"
                    }`}
                  >
                    {c.model}
                  </td>
                  {criteria.map((crit) => {
                    const s = scores[crit];
                    if (typeof s !== "number") {
                      return (
                        <td
                          key={crit}
                          className="px-3 py-2 text-center font-mono text-xs text-text-muted"
                        >
                          —
                        </td>
                      );
                    }
                    const t = tier(s);
                    return (
                      <td
                        key={crit}
                        className={`px-3 py-2 text-center font-mono text-xs tabular-nums ${t.cell}`}
                      >
                        <span className={`inline-block rounded px-1.5 py-0.5 ${t.text}`}>
                          {s.toFixed(1)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
  const accent = tone === "amber" ? "text-warning" : "text-text-secondary";
  return (
    <div className="rounded-lg border border-edge p-3">
      <div className={`mb-2 font-mono text-xs uppercase tracking-wider ${accent}`}>
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-sm leading-relaxed text-text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-text">
              <span className={`mt-2 size-1 shrink-0 rounded-full ${tone === "amber" ? "bg-warning" : "bg-text-muted"}`} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
