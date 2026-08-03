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
import { Scale } from "lucide-react";

interface Props {
  holistic?: boolean;
  missing?: boolean;
  name?: string;
  profileId?: string;
  version?: number;
}

const MUTED =
  "rounded-sm border border-edge bg-panel px-1.5 py-0.5 text-xs text-text-muted";

export function ProfileRefChip({ holistic, missing, name, profileId, version }: Props) {
  if (holistic) {
    return <span className={MUTED}>Holistic judging</span>;
  }
  if (missing || !profileId) {
    return <span className={MUTED}>Rubric missing</span>;
  }
  return (
    <Link
      to={`/evaluations/profiles/${profileId}`}
      onClick={(e) => e.stopPropagation()}
      className="flex min-w-0 items-center gap-1 rounded-sm border border-edge bg-panel px-1.5 py-0.5 text-xs text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={`Rubric ${name} v${version}`}
    >
      <Scale size={11} aria-hidden="true" />
      <span className="truncate">
        {name} v{version}
      </span>
    </Link>
  );
}
