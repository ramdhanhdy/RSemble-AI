// =============================================================================
// ClaimBadge — the exploratory/confirmed claim marker (Fable §6.2, §17).
//
// Three redundant channels so the claim level never rides on color alone:
// hue (warning vs success), border style (dashed vs solid), and icon + word
// (TestTubeDiagonal "Exploratory" vs ShieldCheck "Confirmed"). The badge
// never renders icon-only. "Confirmed" is a claim, not a status — it lives
// here, never in a StatusMark.
// =============================================================================

import { ShieldCheck, TestTubeDiagonal } from "lucide-react";
import type { StudyClaimLevel } from "../lib/studies/study-types";

export function ClaimBadge({ level }: { level: StudyClaimLevel }) {
  const confirmed = level === "confirmed";
  const Icon = confirmed ? ShieldCheck : TestTubeDiagonal;
  return (
    <span
      data-testid="claim-badge"
      className={`inline-flex min-h-[24px] items-center gap-1 rounded-sm border px-2 text-xs font-semibold ${
        confirmed
          ? "border-solid border-success/50 bg-success/10 text-success"
          : "border-dashed border-warning/50 bg-warning/10 text-warning"
      }`}
    >
      <Icon size={12} aria-hidden="true" />
      {confirmed ? "Confirmed" : "Exploratory"}
    </span>
  );
}
