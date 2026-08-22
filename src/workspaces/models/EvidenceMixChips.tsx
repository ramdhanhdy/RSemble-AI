// =============================================================================
// EvidenceMixChips — Fable §5.3.
//
// A row of up to four count chips, one per evidence class, in fixed order
// (Exploratory, Comparable, Verified, Benchmark anchor). Zero-count classes
// render dimmed (opacity-50) rather than disappearing — absence of a class is
// itself legible.
// =============================================================================

import { Fragment, type ReactNode } from "react";
import { COPY } from "./copy";

export interface EvidenceMixCounts {
  exploratory: number;
  comparable: number;
  verified: number;
  benchmark: number;
}

interface EvidenceMixChipsProps {
  counts: EvidenceMixCounts;
}

export function EvidenceMixChips({ counts }: EvidenceMixChipsProps): ReactNode {
  const order = COPY.evidenceMix.order;
  return (
    <div data-evidence-mix className="flex flex-wrap items-baseline gap-1">
      {order.map((cls, i) => {
        const count = counts[cls];
        const word = COPY.evidenceMix.words[cls];
        return (
          <Fragment key={cls}>
            {i > 0 && <span className="text-text-muted"> · </span>}
            <span
              data-evidence-class-chip={cls}
              data-evidence-class={cls}
              className={`font-mono text-xs ${count === 0 ? "opacity-50" : ""}`}
            >
              {count} {word}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
