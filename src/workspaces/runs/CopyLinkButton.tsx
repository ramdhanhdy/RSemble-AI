// =============================================================================
// CopyLinkButton — copy the current page URL to the clipboard (Slice 5).
//
// Uses the real browser URL (HashRouter deep link in production) and the
// clipboard API, with transient "Copied!" feedback. The default label makes
// the local-first scope explicit: a run link resolves against data on this
// device, not a cloud-hosted shared record. Copying remains a convenience and
// silently no-ops when the clipboard is unavailable.
// =============================================================================

import { useState } from "react";
import { Copy } from "lucide-react";

export function CopyLinkButton({ label = "Copy link — this device" }: { label?: string }) {
  const [copied, setCopied] = useState(false);
  // Polite live region text. Populated only after a successful clipboard write
  // so screen readers announce the copy without weakening the visible
  // device-local label or the silent-failure path (clipboard unavailable →
  // no announcement, no fabricated success state).
  const [announcement, setAnnouncement] = useState("");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setAnnouncement("Link copied to this run on this device");
      window.setTimeout(() => {
        setCopied(false);
        setAnnouncement("");
      }, 1500);
    } catch {
      /* clipboard unavailable — non-fatal, no announcement */
    }
  };

  return (
    <>
      <button
        type="button"
        data-action="copy-link"
        onClick={copy}
        aria-label={copied ? "Link copied" : "Copy link to this run on this device"}
        className="pressable flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
      >
        <Copy size={14} aria-hidden="true" />
        {copied ? "Copied!" : label}
      </button>
      <span data-action="copy-link-status" aria-live="polite" role="status" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
