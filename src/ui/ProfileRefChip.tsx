// =============================================================================
// ProfileRefChip — the suite→profile relationship made visible (spec §5.3).
//
// One shared chip so suite rows, the suite editor header, and any future
// reference surface never diverge. Three states:
//   - pinned profile: link chip "⚖ <name> vN" → /evaluations/profiles/:id
//   - holistic evaluation: muted non-link "Holistic judging"
//   - pinned profile no longer exists: muted non-link "Rubric missing"
// =============================================================================

import { Link } from "react-router-dom";
import { Gauge, Scale } from "lucide-react";

interface Props {
  holistic?: boolean;
  missing?: boolean;
  name?: string;
  profileId?: string;
  version?: number;
}

// Shared chip shell. Below sm the chip collapses to icon-only (title/aria
// carry the full meaning) so the row's title column is never crushed on
// phones (Task 14 mobile finding).
const MUTED =
  "flex items-center gap-1 rounded-sm border border-edge bg-panel px-1 py-0.5 text-xs text-text-muted sm:px-1.5";

export function ProfileRefChip({ holistic, missing, name, profileId, version }: Props) {
  if (holistic) {
    return (
      <span className={MUTED} title="Holistic judging" aria-label="Holistic judging">
        <Gauge size={11} aria-hidden="true" />
        <span className="hidden sm:inline">Holistic judging</span>
      </span>
    );
  }
  if (missing || !profileId) {
    return (
      <span className={MUTED} title="Rubric missing" aria-label="Rubric missing">
        <Scale size={11} aria-hidden="true" />
        <span className="hidden sm:inline">Rubric missing</span>
      </span>
    );
  }
  return (
    <Link
      to={`/evaluations/profiles/${profileId}`}
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
