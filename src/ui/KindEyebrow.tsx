// =============================================================================
// KindEyebrow — entity identity eyebrow (identity spec §5.1).
//
// One consistent grammar across every Evaluations surface: Suite = Workload,
// Profile = Rubric. The 11px uppercase-tracked eyebrow carries a glyph plus
// the kind word — never shape or color alone (DESIGN.md). The one-line
// definition is exposed as a title tooltip for first-contact learning.
// =============================================================================

import { ListChecks, Scale, type LucideIcon } from "lucide-react";

const KINDS = {
  suite: {
    word: "Workload",
    icon: ListChecks,
    def: "A versioned set of tasks, models, and a judge. You run it.",
  },
  profile: {
    word: "Rubric",
    icon: Scale,
    def: "Scoring criteria with 1/3/5 anchors. It judges, it does not run.",
  },
} as const;

export type EntityKind = keyof typeof KINDS;

export function KindEyebrow({ kind }: { kind: EntityKind }) {
  const k = KINDS[kind];
  const Icon: LucideIcon = k.icon;
  return (
    <span
      className="flex shrink-0 items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
      title={k.def}
    >
      <Icon size={11} aria-hidden="true" />
      {k.word}
    </span>
  );
}
