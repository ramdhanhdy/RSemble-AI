import {
  AlertCircle,
  Award,
  BarChart3,
  Check,
  Crown,
  FileText,
  GitMerge,
  Loader2,
  Network,
  ShieldCheck,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import type { Mode } from "../studio-data";
import type { StudioState } from "../studio-engine";

export type RailStageStatus = "pending" | "active" | "done" | "error";

export interface RailStageState {
  status: RailStageStatus;
  caption?: string;
}

interface StageDef {
  title: string;
  idleCaption: string;
  icon: LucideIcon;
}

export function computeStages(state: StudioState): [RailStageState, RailStageState, RailStageState, RailStageState] {
  const hasRun = state.candidates.length > 0 || state.running;
  if (!hasRun) {
    return [
      { status: "pending" },
      { status: "pending" },
      { status: "pending" },
      { status: "pending" },
    ];
  }

  const fanoutDone = state.candidates.length > 0 && state.candidates.every((c) => c.status !== "pending");
  const fanoutStarted = state.candidates.length > 0;
  const doneCount = state.candidates.filter((c) => c.status === "done").length;
  const totalCount = state.candidates.length;

  const taskStage: RailStageState = fanoutStarted
    ? { status: "done" }
    : { status: "active" };

  const modelsStage: RailStageState = !fanoutStarted
    ? { status: "pending" }
    : fanoutDone
      ? { status: "done", caption: `${doneCount} of ${totalCount} done` }
      : { status: "active", caption: `${doneCount} of ${totalCount} done` };

  const judgeStage: RailStageState = !fanoutDone
    ? { status: "pending" }
    : state.judgeStatus === "error"
      ? { status: "error" }
      : state.judgeStatus === "done"
        ? { status: "done" }
        : { status: "active", caption: `Scoring ${doneCount} candidates` };

  const finalStage: RailStageState = !fanoutDone || state.judgeStatus !== "done"
    ? { status: "pending" }
    : state.mode === "fuse"
      ? state.fusionStatus === "error"
        ? { status: "error" }
        : state.fusionStatus === "done"
          ? { status: "done" }
          : { status: "active" }
      : { status: "done" };

  return [taskStage, modelsStage, judgeStage, finalStage];
}

export function PipelineRail({
  mode,
  stages,
}: {
  mode: Mode;
  stages?: [RailStageState, RailStageState, RailStageState, RailStageState];
}) {
  const defs: StageDef[] = [
    { title: "Task", idleCaption: "You describe what you need", icon: FileText },
    { title: "Models", idleCaption: "Multiple models generate responses", icon: Network },
    { title: "Judge", idleCaption: "Scores each response using your rubric", icon: ShieldCheck },
    mode === "rank"
      ? { title: "Rank", idleCaption: "Best response recommended", icon: Crown }
      : { title: "Fuse", idleCaption: "Merged into one answer", icon: GitMerge },
  ];

  const hasStages = stages != null;

  // Compact mobile rail (<sm): horizontal stepper with small circles instead of
  // the tall 140px cards — the full rail is ~300px tall and would push the
  // empty-state content (and later stages) below the fold at 390x844.
  return (
    <>
      <ol
        className="flex w-full items-center justify-center gap-1 sm:hidden"
        aria-label="Pipeline stages"
      >
        {defs.map((def, i) => {
          const stage = stages?.[i];
          const status = stage?.status ?? "pending";
          const active = status === "active";
          const done = status === "done";
          const errored = status === "error";
          return (
            <li key={def.title} className="flex items-center gap-1">
              {i > 0 && <span className="h-px w-3 bg-edge" aria-hidden="true" />}
              <span
                aria-current={active ? "step" : undefined}
                title={stage?.caption ?? def.idleCaption}
                className={`flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[11px] ${
                  active
                    ? "border-accent text-accent"
                    : done
                      ? "border-success/50 text-success"
                      : errored
                        ? "border-error/50 text-error"
                        : "border-edge text-text-muted"
                }`}
              >
                {done ? <Check size={12} /> : errored ? <AlertCircle size={12} /> : i + 1}
              </span>
              <span className={`text-xs ${active || done ? "text-text" : "text-text-muted"}`}>
                {def.title}
              </span>
            </li>
          );
        })}
      </ol>
    <div className="hidden flex-wrap items-center justify-center gap-y-3 sm:flex" role="list" aria-label="Pipeline stages">
      {defs.map((def, i) => {
        const stage = stages?.[i];
        const status = stage?.status ?? "pending";
        const nextUp = !hasStages && i === 0;
        const active = status === "active";
        const done = status === "done";
        const errored = status === "error";
        const highlighted = nextUp || active || done || errored;

        return (
          <div key={def.title} className="flex items-center" role="listitem">
            {i > 0 && (
              <div className="flex items-center gap-1.5 px-2" aria-hidden="true">
                <span className={`connector-node ${done ? "bg-success" : ""}`} />
                <span
                  className={`connector-dots w-10 ${active ? "animate-dash-march" : ""}`}
                  style={active ? { backgroundImage: "radial-gradient(circle, #22d3ee 1.25px, transparent 1.25px)" } : undefined}
                />
                <span className={`connector-node ${active || done ? "bg-accent" : ""}`} />
              </div>
            )}
            <div
              className={`flex min-h-[120px] w-[140px] flex-col gap-1.5 rounded-md border bg-card p-3 transition-[border-color,opacity] ease-out duration-150 ${
                active
                  ? "border-accent glow-accent"
                  : done
                    ? "border-success/40"
                    : errored
                      ? "border-error/50"
                      : nextUp
                        ? "border-accent/60"
                        : "border-edge opacity-60"
              }`}
            >
              <div className="flex items-center justify-between">
                {active ? (
                  <Loader2 size={14} className="animate-spin-ease text-accent" />
                ) : done ? (
                  <Check size={14} className="text-success" />
                ) : errored ? (
                  <AlertCircle size={14} className="text-error" />
                ) : (
                  <span className={`font-mono text-xs tabular-nums ${highlighted ? "text-accent" : "text-text-muted"}`}>
                    {i + 1}
                  </span>
                )}
                <def.icon size={16} className={highlighted ? (done ? "text-success" : errored ? "text-error" : "text-accent") : "text-text-muted"} />
              </div>
              <span className={`text-sm font-semibold ${highlighted ? "text-text" : "text-text-secondary"}`}>
                {def.title}
              </span>
              <span className={`text-xs leading-snug ${highlighted ? "text-text-secondary" : "text-text-muted"}`}>
                {stage?.caption ?? def.idleCaption}
              </span>
            </div>
          </div>
        );
      })}
    </div>
    </>
  );
}

export function LeaderboardPreviewCard() {
  const bars = [
    { label: "2", height: 28, winner: false },
    { label: "1", height: 40, winner: true },
    { label: "3", height: 22, winner: false },
  ];
  return (
    <div className="w-full max-w-xs rounded-md border border-edge bg-card p-4 text-left">
      <div className="flex items-center gap-2">
        <Trophy size={14} className="text-accent" />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Leaderboard preview
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-text-secondary">
        Every candidate scored against your rubric, ranked by weighted fit. Close calls are flagged, not hidden.
      </p>
      <div className="mt-4 flex items-end justify-center gap-2" aria-hidden="true">
        {bars.map((bar) => (
          <span
            key={bar.label}
            className={`flex w-10 items-end justify-center rounded-t-sm pb-1 font-mono text-xs tabular-nums ${
              bar.winner ? "bg-accent text-on-accent" : "bg-edge-bright text-text-secondary"
            }`}
            style={{ height: bar.height }}
          >
            {bar.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const BENEFITS: { icon: LucideIcon; title: string; caption: string }[] = [
  {
    icon: Trophy,
    title: "Ranked leaderboard",
    caption: "Every response scored against your rubric, sorted by weighted fit.",
  },
  {
    icon: BarChart3,
    title: "Side-by-side comparison",
    caption: "Read candidate answers in parallel with detailed scores.",
  },
  {
    icon: Award,
    title: "Smart recommendation",
    caption: "The judge names a winner and why — pick a model in one read.",
  },
];

export function WhatYouGetRow() {
  return (
    <div className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
      {BENEFITS.map((b) => (
        <div key={b.title} className="rounded-md border border-edge bg-card p-3 text-left">
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-accent/40 bg-accent/5 text-accent">
            <b.icon size={16} />
          </span>
          <p className="mt-2 text-sm font-semibold text-text">{b.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{b.caption}</p>
        </div>
      ))}
    </div>
  );
}
