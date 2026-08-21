// =============================================================================
// Header — identity · workspace nav · utility cluster · mobile drawer toggle.
// Child 08 spec §G.4 final composition: LEFT identity/menu, CENTER desktop
// WorkspaceNav, RIGHT palette · Records · Connections · Help. The Rank/Fuse
// toggle stays a Compare-interior control (spec §C.3) — never global chrome.
//
// Records utility (§G.4): History glyph + "Records" label at lg+, icon-only
// 44×44 at other widths, aria-label="Records" always. At >=1024px it opens
// the quick Records drawer (aria-haspopup="dialog" + aria-expanded); below
// 1024px it navigates directly to /records (§H.6 substitution). It renders at
// ALL widths — below md it is the only chrome route to the ledger — and is
// visually identical in weight to the palette trigger (secondary chrome).
//
// Responsive (DESIGN.md): on <768px the command pane collapses into a header
// drawer; `onOpenCommand` renders a hamburger button shown only on mobile.
// Palette/help stay hidden below md; readiness stays available at all widths.
// =============================================================================

import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { Dialog } from "@base-ui/react/dialog";
import { Command, HelpCircle, History, Menu } from "lucide-react";
import { HexCubeLogo } from "./brand-icons";
import { useMediaQuery } from "./useMediaQuery";
import { WorkspaceNav } from "./WorkspaceNav";

export type ConnectionState = "ready" | "running" | "degraded" | "offline" | "checking";

function DetachedDialogTrigger({
  handle,
  children,
}: {
  handle?: Dialog.Handle<unknown>;
  children: ReactElement;
}) {
  return handle ? <Dialog.Trigger handle={handle} render={children} /> : children;
}

function livePill(
  running: boolean,
  conn: ConnectionState,
): { label: string; dot: string; text: string } {
  if (running) {
    return { label: "Running", dot: "bg-accent animate-pulse-ease", text: "text-accent" };
  }
  if (conn === "checking") {
    return {
      label: "Checking",
      dot: "bg-text-muted animate-pulse-ease",
      text: "text-text-secondary",
    };
  }
  if (conn === "offline") {
    return { label: "No key", dot: "bg-error", text: "text-error" };
  }
  if (conn === "degraded") {
    return { label: "Degraded", dot: "bg-warning", text: "text-warning" };
  }
  return { label: "Live", dot: "bg-success", text: "text-success" };
}

function useRunElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) {
      setSeconds(0);
      return;
    }
    setSeconds(0);
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return seconds;
}

export function Header({
  running,
  onOpenCommand,
  onOpenConnections,
  onOpenPalette,
  onOpenHelp,
  commandDialogHandle,
  connectionsDialogHandle,
  cheatsheetDialogHandle,
  connectionState = "ready",
  recordsOpen = false,
  onOpenRecords,
}: {
  running: boolean;
  onOpenCommand?: () => void;
  onOpenConnections?: () => void;
  onOpenPalette?: () => void;
  onOpenHelp?: () => void;
  commandDialogHandle?: Dialog.Handle<unknown>;
  connectionsDialogHandle?: Dialog.Handle<unknown>;
  cheatsheetDialogHandle?: Dialog.Handle<unknown>;
  connectionState?: ConnectionState;
  /** Drawer open state at >=1024px; drives aria-expanded on the trigger. */
  recordsOpen?: boolean;
  /** >=1024px: open the quick Records drawer. Below 1024 the utility is a
   *  plain /records link instead (spec §H.6). */
  onOpenRecords?: () => void;
}) {
  const pill = livePill(running, connectionState);
  const elapsed = useRunElapsed(running);
  const pillLabel = running ? `Running · ${elapsed}s` : pill.label;
  const drawerCapable = useMediaQuery("(min-width: 1024px)");

  return (
    <header className="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-edge bg-shell px-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        {onOpenCommand && (
          <DetachedDialogTrigger handle={commandDialogHandle}>
            <button
              type="button"
              onClick={onOpenCommand}
              aria-label="Open command pane"
              className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-panel hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden"
            >
              <Menu size={18} aria-hidden="true" />
            </button>
          </DetachedDialogTrigger>
        )}
        <HexCubeLogo size={22} className="shrink-0 text-accent" />
        <span className="hidden text-base font-semibold tracking-tight sm:inline">RSemble AI</span>
      </div>

      <div className="hidden min-w-0 justify-self-center md:block">
        <WorkspaceNav />
      </div>

      <div className="flex min-w-0 items-center justify-self-end gap-2">
        <button
          type="button"
          aria-disabled={onOpenPalette ? undefined : true}
          onClick={onOpenPalette}
          aria-label="Command palette"
          title="Command palette (⌘K)"
          className={`hidden h-11 w-11 items-center justify-center rounded-md border border-edge bg-panel md:flex lg:hidden ${
            onOpenPalette
              ? "text-text-secondary hover:border-edge-bright"
              : "cursor-not-allowed text-text-secondary opacity-60"
          } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
        >
          <Command size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-disabled={onOpenPalette ? undefined : true}
          onClick={onOpenPalette}
          aria-label="Command palette"
          title="Command palette (⌘K)"
          className={`hidden min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 font-mono text-xs lg:flex ${
            onOpenPalette
              ? "text-text-secondary hover:border-edge-bright"
              : "cursor-not-allowed text-text-secondary opacity-60"
          } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
        >
          <kbd className="rounded-sm border border-edge bg-card px-1.5 py-0.5">⌘</kbd>
          <kbd className="rounded-sm border border-edge bg-card px-1.5 py-0.5">K</kbd>
        </button>
        {/* Records — secondary chrome at every width (spec §G.4). >=1024:
            drawer trigger; below: plain /records link. Same bordered grammar
            as the palette trigger, never accent-filled. */}
        {drawerCapable && onOpenRecords ? (
          <button
            type="button"
            onClick={onOpenRecords}
            aria-label="Records"
            title="Records"
            aria-haspopup="dialog"
            aria-expanded={recordsOpen}
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <History size={15} aria-hidden="true" />
            <span className="hidden lg:inline">Records</span>
          </button>
        ) : (
          <Link
            to="/records"
            aria-label="Records"
            title="Records"
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <History size={15} aria-hidden="true" />
            <span className="hidden lg:inline">Records</span>
          </Link>
        )}
        {onOpenConnections && (
          <DetachedDialogTrigger handle={connectionsDialogHandle}>
            <button
              type="button"
              onClick={onOpenConnections}
              aria-label={`Connection status: ${pillLabel}. Manage connections.`}
              title="Provider connections"
              className="flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-full border border-edge bg-panel px-3.5 font-mono text-xs hover:border-edge-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className={`size-2 rounded-full ${pill.dot}`} aria-hidden="true" />
              <span className={`hidden lg:inline ${pill.text}`} aria-live="polite">
                {pillLabel}
              </span>
            </button>
          </DetachedDialogTrigger>
        )}
        <DetachedDialogTrigger handle={cheatsheetDialogHandle}>
          <button
            type="button"
            aria-disabled={onOpenHelp ? undefined : true}
            onClick={onOpenHelp}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className={`hidden h-11 w-11 items-center justify-center rounded-md border border-edge bg-panel md:flex ${
              onOpenHelp
                ? "text-text-secondary hover:border-edge-bright"
                : "cursor-not-allowed text-text-secondary opacity-60"
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
          >
            <HelpCircle size={16} aria-hidden="true" />
          </button>
        </DetachedDialogTrigger>
      </div>
    </header>
  );
}
