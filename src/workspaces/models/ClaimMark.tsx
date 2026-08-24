// =============================================================================
// ClaimMark — Fable §5.6.
//
// One deterministic claim: icon + word label (§4.2) + the claim sentence as a
// link button. Clicking applies the claim's source narrowing to the evidence
// table. Each mark carries a title describing its boundary reference. Missing
// marks are not links. Weakest-supported uses the error role (D5).
// =============================================================================

import type { ReactNode } from "react";
import { FileText, Minus, ShieldAlert, ShieldCheck, Split, type LucideIcon } from "lucide-react";
import type { ClaimLabel, ClaimSentence } from "../../lib/model-profiles/profile-claims";
import { COPY } from "./copy";

interface ClaimMarkProps {
  label: ClaimLabel;
  sentence: ClaimSentence;
  /** Full boundary reference string, e.g. "rubric rub-eval@2". */
  boundaryRef?: string;
  onApply?: (sentence: ClaimSentence) => void;
}

interface ClaimVisual {
  icon: LucideIcon;
  roleClass: string;
}

const CLAIM_VISUALS: Record<ClaimLabel, ClaimVisual> = {
  strongest_supported: { icon: ShieldCheck, roleClass: "text-success" },
  weakest_supported: { icon: ShieldAlert, roleClass: "text-error" },
  mixed: { icon: Split, roleClass: "text-warning" },
  descriptive_only: { icon: FileText, roleClass: "text-text-secondary" },
  missing: { icon: Minus, roleClass: "text-text-muted" },
};

export function ClaimMark({ label, sentence, boundaryRef, onApply }: ClaimMarkProps): ReactNode {
  const visual = CLAIM_VISUALS[label];
  const Icon = visual.icon;
  const word = COPY.claim.words[label];
  const isLink = label !== "missing";
  const title = boundaryRef ? COPY.claim.boundaryTitle(boundaryRef) : undefined;

  return (
    <span
      data-claim-mark
      data-claim-label={label}
      className={`inline-flex items-center gap-1 text-xs ${visual.roleClass}`}
      title={title}
    >
      <Icon size={13} aria-hidden="true" />
      <span className="font-semibold">{word}</span>
      {isLink ? (
        <button
          type="button"
          data-claim-sentence
          className="pressable text-left underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          onClick={() => onApply?.(sentence)}
        >
          {sentence.text}
        </button>
      ) : (
        <span data-claim-sentence>{sentence.text}</span>
      )}
    </span>
  );
}
