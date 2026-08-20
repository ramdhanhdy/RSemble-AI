// =============================================================================
// KindEyebrow — entity identity eyebrow (identity spec §5.1).
//
// One consistent grammar across every Evaluations surface: Suite = Workload,
// Rubric = Rubric. The 11px uppercase-tracked eyebrow carries a glyph plus
// the kind word — never shape or color alone (DESIGN.md). The one-line
// definition is exposed as a title tooltip for first-contact learning.
// =============================================================================

import {
  Boxes,
  Combine,
  Cpu,
  FileSearch,
  FlaskConical,
  Layers,
  ListChecks,
  Scale,
  type LucideIcon,
} from "lucide-react";

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
  study: {
    word: "Policy Study",
    icon: FlaskConical,
    def: "A pinned policy comparison that ends in a Policy Playbook.",
  },
  recipe: {
    word: "Fusion Recipe",
    icon: Combine,
    def: "An immutable description of how synthesis is performed.",
  },
  pool: {
    word: "Model Pool",
    icon: Boxes,
    def: "An experimental selection manifest of exact model configurations.",
  },
  "model-configuration": {
    word: "Model Configuration",
    icon: Cpu,
    def: "An exact provider, model, and reasoning configuration under test.",
  },
  observation: {
    word: "Observation",
    icon: FileSearch,
    def: "One recorded model response with its evidence class and eligibility.",
  },
  rollup: {
    word: "Rollup",
    icon: Layers,
    def: "A pinned list of exact configurations shown side by side, never pooled.",
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
      {/* Icon-only below sm: the glyph keeps the kind grammar on phones where
          the row cannot afford the word (Task 14 mobile finding). */}
      <span className="hidden sm:inline">{k.word}</span>
    </span>
  );
}
