// =============================================================================
// RollupBanner — Fable §9 forward contract.
//
// A full-width panel that always precedes all member content in DOM order. It
// carries the SAVED ROLLUP eyebrow, the rollup name + pinned version (mono),
// and the stratified-only policy block. The repository/route ships later
// (Child 08 / T11); this primitive is the unrouted forward contract.
// =============================================================================

import type { ReactNode } from "react";
import { COPY } from "./copy";

interface RollupBannerProps {
  name: string;
  version: number;
  memberCount: number;
  pinnedDate: string;
  manifestDigest: string;
  archived?: boolean;
}

export function RollupBanner({
  name,
  version,
  memberCount,
  pinnedDate,
  manifestDigest,
  archived = false,
}: RollupBannerProps): ReactNode {
  return (
    <section data-rollup-banner className="w-full rounded-sm border border-edge bg-panel p-4">
      <div
        data-rollup-eyebrow
        className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
      >
        {COPY.rollup.eyebrow}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <h2 data-rollup-name className="text-base font-semibold text-text">
          {name}
        </h2>
        <span data-rollup-version className="font-mono text-sm text-text-secondary">
          v{version}
        </span>
      </div>
      <p className="mt-2 text-sm text-text">{COPY.rollup.policy}</p>
      <p className="mt-1 text-xs text-text-secondary">
        {COPY.rollup.membersLine(memberCount, pinnedDate, manifestDigest)}
      </p>
      {archived ? (
        <p data-rollup-archived className="honesty-note mt-2 text-xs text-warning">
          Archived rollup — this pinned version remains readable and its member links stay intact.
        </p>
      ) : null}
      <p className="honesty-note mt-2 text-xs text-text-muted">{COPY.rollup.immutability}</p>
    </section>
  );
}
