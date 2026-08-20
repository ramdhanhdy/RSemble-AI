// =============================================================================
// MemberShelf — Fable §9 forward contract.
//
// One column per member in the rollup shelves layout. A present member renders
// its condensed profile (children); a member configuration deleted from local
// data renders a tombstone: "Member `mc-4f…` is not present in this database"
// — the manifest is immutable, the absence is shown, never silently dropped.
// No shelf ever shows a cross-member number.
// =============================================================================

import type { ReactNode } from "react";
import { COPY } from "./copy";

export interface MemberShelfMember {
  id: string;
  present: boolean;
}

interface MemberShelfProps {
  member: MemberShelfMember;
  children?: ReactNode;
}

export function MemberShelf({ member, children }: MemberShelfProps): ReactNode {
  if (!member.present) {
    return (
      <section
        data-member-shelf
        data-member-tombstone
        data-member-id={member.id}
        className="rounded-sm border border-dashed border-edge bg-card p-4"
      >
        <p className="text-sm text-text-secondary">
          {COPY.rollup.tombstone(member.id)}
        </p>
        <p className="honesty-note mt-1 text-xs text-text-muted">
          {COPY.rollup.immutability}
        </p>
      </section>
    );
  }
  return (
    <section
      data-member-shelf
      data-member-id={member.id}
      className="rounded-sm border border-edge bg-card p-4"
    >
      {children}
    </section>
  );
}
