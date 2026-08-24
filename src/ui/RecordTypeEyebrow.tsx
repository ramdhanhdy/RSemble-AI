import {
  Archive,
  FileSearch,
  FlaskConical,
  GitCompare,
  History,
  TestTubes,
  type LucideIcon,
} from "lucide-react";
import type { RecordType } from "../lib/records/record-reference";

const RECORD_TYPE_IDENTITY: Record<
  RecordType,
  { label: string; icon: LucideIcon; definition: string }
> = {
  comparison: {
    label: "Comparison",
    icon: GitCompare,
    definition: "A meaningful comparison result owned by Compare.",
  },
  evaluation: {
    label: "Evaluation",
    icon: FlaskConical,
    definition: "An evaluation execution owned by its Task Set.",
  },
  "policy-study": {
    label: "Policy Study",
    icon: TestTubes,
    definition: "A pinned policy study owned by the Lab.",
  },
  "task-execution": {
    label: "Task Execution",
    icon: History,
    definition: "One exact execution with preserved provenance and evidence.",
  },
  observation: {
    label: "Observation",
    icon: FileSearch,
    definition: "A derived evidence reference linked to exact source records.",
  },
  legacy: {
    label: "Legacy",
    icon: Archive,
    definition: "An imported summary whose unavailable history is not fabricated.",
  },
};

export function RecordTypeEyebrow({ recordType }: { recordType: RecordType }) {
  const identity = RECORD_TYPE_IDENTITY[recordType];
  const Icon = identity.icon;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
      title={identity.definition}
    >
      <Icon size={11} aria-hidden="true" />
      <span>{identity.label}</span>
    </span>
  );
}

export function recordTypeLabel(recordType: RecordType): string {
  return RECORD_TYPE_IDENTITY[recordType].label;
}
