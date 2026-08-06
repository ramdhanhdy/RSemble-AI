import { forwardRef } from "react";
import {
  BadgeCheck,
  Check,
  CircleDashed,
  CirclePlay,
  FilePenLine,
  Loader2,
  Pause,
  AlertTriangle,
  Square,
  Unplug,
  XCircle,
  type LucideIcon,
} from "lucide-react";

// --- Status types ------------------------------------------------------------
// These cover RunStatus (§7.5) plus the stage/suite statuses that reuse the
// closest token rather than inventing another palette.

export type StatusMarkStatus =
  | "draft"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "completed_with_failures"
  | "partial"
  | "failed"
  | "aborted"
  | "interrupted"
  | "ready"
  | "reusable";

interface StatusConfig {
  label: string;
  icon: LucideIcon;
  color: string; // text color
  spin: boolean; // rotate the icon?
}
/** Hollow circle — the one icon lucide doesn't have as a named export
 *  that matches the spec's "hollow circle" for queued. Wrapped in forwardRef
 *  so it structurally satisfies LucideIcon (ForwardRefExoticComponent). */
const HollowCircle = forwardRef<SVGSVGElement, { size?: string | number; className?: string }>(
  function HollowCircle({ size = 14, className }, ref) {
    return (
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className={className}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="8" />
      </svg>
    );
  },
);

const STATUS_MAP: Record<StatusMarkStatus, StatusConfig> = {
  draft: { label: "Draft", icon: FilePenLine, color: "text-text-muted", spin: false },
  queued: { label: "Queued", icon: HollowCircle, color: "text-text-muted", spin: false },
  running: { label: "Running", icon: Loader2, color: "text-accent", spin: true },
  paused: { label: "Paused", icon: Pause, color: "text-text-muted", spin: false },
  completed: { label: "Completed", icon: Check, color: "text-success", spin: false },
  completed_with_failures: {
    label: "Completed with failures",
    icon: AlertTriangle,
    color: "text-warning",
    spin: false,
  },
  partial: { label: "Partial", icon: CircleDashed, color: "text-warning", spin: false },
  failed: { label: "Failed", icon: XCircle, color: "text-error", spin: false },
  aborted: { label: "Aborted", icon: Square, color: "text-text-muted", spin: false },
  interrupted: { label: "Interrupted", icon: Unplug, color: "text-warning", spin: false },
  ready: { label: "Ready", icon: CirclePlay, color: "text-accent", spin: false },
  reusable: { label: "Reusable", icon: BadgeCheck, color: "text-text-muted", spin: false },
};

export function StatusMark({
  status,
  reducedMotion = false,
  size = 13,
}: {
  status: StatusMarkStatus;
  reducedMotion?: boolean;
  /** Icon size in px. Defaults to 13 (matches body text). */
  size?: number;
}) {
  const cfg = STATUS_MAP[status];
  const Icon = cfg.icon;
  const shouldSpin = cfg.spin && !reducedMotion;

  return (
    <span
      data-status-mark=""
      className={`motion-state inline-flex items-center gap-1.5 text-sm ${cfg.color}`}
    >
      <span data-status-icon="" className="flex size-4 shrink-0 items-center justify-center">
        <Icon size={size} className={shouldSpin ? "animate-spin-ease" : undefined} />
      </span>
      <span className="tabular-nums">{cfg.label}</span>
    </span>
  );
}
