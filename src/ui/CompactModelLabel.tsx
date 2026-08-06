// =============================================================================
// CompactModelLabel — shared provider-scoped model identity (spec §6.2).
//
// One formatter used in ModelList, run rows/details, leaderboards, suite rosters,
// and result matrices. Visual form: short provider chip + bounded slug using
// middle ellipsis while preserving the distinguishing tail.
//
// The full opaque `providerId:modelSlug` identity is available in accessible
// text and a focusable/clickable detail disclosure. A hover-only title is
// supplementary, never the only full identity.
// =============================================================================

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { PROVIDER_LABELS } from "./ProviderTabs";
import type { ProviderId } from "../lib/providers/types";

/** Maximum visible slug characters before middle ellipsis kicks in. */
const MAX_SLUG_CHARS = 28;
/** Characters to preserve from the tail (the distinguishing part). */
const TAIL_CHARS = 16;

function formatSlug(slug: string): { display: string; truncated: boolean } {
  if (slug.length <= MAX_SLUG_CHARS) {
    return { display: slug, truncated: false };
  }
  const head = slug.slice(0, MAX_SLUG_CHARS - TAIL_CHARS - 1);
  const tail = slug.slice(-TAIL_CHARS);
  return { display: `${head}…${tail}`, truncated: true };
}

export function CompactModelLabel({ providerId, slug }: { providerId: string; slug: string }) {
  const [expanded, setExpanded] = useState(false);
  const providerLabel = PROVIDER_LABELS[providerId as ProviderId] ?? providerId;
  const { display } = formatSlug(slug);
  const fullId = `${providerId}:${slug}`;

  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="font-mono text-text-muted">{providerLabel}</span>
      <span className="text-text-muted" aria-hidden="true">
        ·
      </span>
      <span className="font-mono text-text tabular-nums">{expanded ? slug : display}</span>
      <span data-full-id={fullId} className="sr-only">
        {fullId}
      </span>
      <button
        type="button"
        data-full-id-disclosure=""
        aria-label={`Full model identity: ${fullId}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
        className="flex min-h-[44px] items-center gap-0.5 rounded-sm px-1 text-text-muted transition-colors duration-150 hover:text-text focus-visible:text-accent"
      >
        <ChevronDown
          size={12}
          className={
            expanded
              ? "rotate-180 transition-transform duration-150"
              : "transition-transform duration-150"
          }
          aria-hidden="true"
        />
      </button>
    </span>
  );
}
