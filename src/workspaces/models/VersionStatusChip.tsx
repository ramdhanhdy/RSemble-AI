// =============================================================================
// VersionStatusChip — Fable §5.2.
//
// inline-flex min-h-[24px] chip with the version-status word and a redundant
// icon channel for rolling alias / partial identity. Exact carries no icon.
// Rolling alias always carries its window; partial identity carries the missing
// dimension. The chip never renders icon-only.
// =============================================================================

import type { ReactNode } from "react";
import { CircleAlert, Repeat } from "lucide-react";
import { COPY } from "./copy";

export type VersionStatus = "exact" | "rolling_alias" | "partial_identity";

interface VersionStatusChipProps {
  status: VersionStatus;
  /** Observed window for rolling alias, e.g. "May–Aug 2026". */
  window?: string;
  /** Missing dimension for partial identity, e.g. "no resolved version". */
  missingDimension?: string;
}

const CHIP_CLASS =
  "inline-flex min-h-[24px] items-center gap-1 rounded-sm px-2 text-xs font-semibold";

export function VersionStatusChip({
  status,
  window,
  missingDimension,
}: VersionStatusChipProps): ReactNode {
  if (status === "rolling_alias") {
    return (
      <span data-version-status="rolling_alias" className={`${CHIP_CLASS} text-warning`}>
        <Repeat size={13} aria-hidden="true" />
        {COPY.versionStatus.rollingAliasWindow(window ?? "")}
      </span>
    );
  }
  if (status === "partial_identity") {
    return (
      <span data-version-status="partial_identity" className={`${CHIP_CLASS} text-warning`}>
        <CircleAlert size={13} aria-hidden="true" />
        {COPY.versionStatus.partialIdentityDimension(missingDimension ?? "")}
      </span>
    );
  }
  return (
    <span data-version-status="exact" className={`${CHIP_CLASS} text-text-secondary`}>
      {COPY.versionStatus.exact}
    </span>
  );
}
