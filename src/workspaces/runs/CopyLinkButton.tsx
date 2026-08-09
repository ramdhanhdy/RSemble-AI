// =============================================================================
// CopyLinkButton — copy the current page URL to the clipboard (Slice 5).
//
// Uses the real browser URL (HashRouter deep link in production) and the
// clipboard API, with transient "Copied!" feedback. Silently no-ops when the
// clipboard is unavailable — copying is a convenience, never a gate.
// =============================================================================

import { useState } from "react";
import { Copy } from "lucide-react";

export function CopyLinkButton({ label = "Copy link" }: { label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — non-fatal */
    }
  };

  return (
    <button
      type="button"
      data-action="copy-link"
      onClick={copy}
      aria-label={copied ? "Link copied" : "Copy link to this run"}
      className="pressable flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
    >
      <Copy size={14} aria-hidden="true" />
      {copied ? "Copied!" : label}
    </button>
  );
}
