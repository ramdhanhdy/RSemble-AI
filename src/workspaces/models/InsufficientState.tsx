// =============================================================================
// InsufficientState — Fable §5.5.
//
// The single designed state for unitCount < 5: muted text, static, no
// animation. It occupies the same slot an interval would occupy so the layout
// never reflows when coverage crosses the threshold. The same component renders
// the non_aggregatable states with their reason sentence. No ±, no interval
// digits, no substitute error bar.
// =============================================================================

import type { ReactNode } from "react";
import { CircleDashed } from "lucide-react";
import { COPY } from "./copy";

export type InsufficientStateProps =
  | {
      kind: "insufficient";
      unitCount: number;
      required: number;
      resolverVersion?: string;
      digest?: string;
    }
  | {
      kind: "non_aggregatable";
      reason: string;
    };

export function InsufficientState(props: InsufficientStateProps): ReactNode {
  if (props.kind === "non_aggregatable") {
    return (
      <div
        data-insufficient-state
        data-insufficient-kind="non_aggregatable"
        className="text-xs text-text-muted"
      >
        {props.reason}
      </div>
    );
  }
  const { unitCount, required, resolverVersion, digest } = props;
  return (
    <div
      data-insufficient-state
      data-insufficient-kind="insufficient"
      className="flex items-start gap-1 text-xs text-text-muted"
    >
      <CircleDashed size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div>
        <div>{COPY.insufficient.title}</div>
        <div className="font-mono">
          {COPY.insufficient.insufficientLine(
            unitCount,
            required,
            resolverVersion ?? "v1",
            digest ?? "",
          )}
        </div>
      </div>
    </div>
  );
}
