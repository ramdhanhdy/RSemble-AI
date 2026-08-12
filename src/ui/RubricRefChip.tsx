// =============================================================================
// RubricRefChip — the suite→rubric relationship made visible (spec §5.3, §6.3).
//
// One shared chip so suite rows, the suite editor header, and any future
// reference surface never diverge. Three states:
//   - pinned rubric: link chip "⚖ <name> vN" → /evaluations/rubrics/:rubricId
//   - holistic evaluation: muted non-link "Holistic judging"
//   - pinned rubric no longer exists: muted non-link "Rubric missing"
//
// The link target is the canonical Rubric route (rubric-terminology spec §4).
// A missing legacy object renders a bounded compatibility warning and preserves
// the stored id rather than inventing a name (spec §6.3).
// =============================================================================

import { Link } from "react-router-dom";
import { Gauge, Scale } from "lucide-react";

interface Props {
  holistic?: boolean;
  missing?: boolean;
  name?: string;
  rubricId?: string;
  version?: number;
}

// Shared chip shell. Below sm the chip collapses to icon-only (title/aria
// carry the full meaning) so the row's title column is never crushed on
// phones (Task 14 mobile finding).
const MUTED =
  "flex items-center gap-1 rounded-sm border border-edge bg-panel px-1 py-0.5 text-xs text-text-muted sm:px-1.5";

export function RubricRefChip({ holistic, missing, name, rubricId, version }: Props) {
  if (holistic) {
    return (
      <span className={MUTED} title="Holistic judging" aria-label="Holistic judging">
        <Gauge size={11} aria-hidden="true" />
        <span className="hidden sm:inline">Holistic judging</span>
      </span>
    );
  }
  if (missing || !rubricId) {
    return (
      <span className={MUTED} title="Rubric missing" aria-label="Rubric missing">
        <Scale size={11} aria-hidden="true" />
        <span className="hidden sm:inline">Rubric missing</span>
      </span>
    );
  }
  return (
    <Link
      to={`/evaluations/rubrics/${rubricId}`}
      onClick={(e) => e.stopPropagation()}
      className="flex min-w-0 items-center gap-1 rounded-sm border border-edge bg-panel px-1 py-0.5 text-xs text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-1.5"
      aria-label={`Rubric ${name} v${version}`}
      title={`Rubric ${name} v${version}`}
    >
      <Scale size={11} aria-hidden="true" />
      <span className="hidden truncate sm:inline">
        {name} v{version}
      </span>
    </Link>
  );
}
