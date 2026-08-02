// =============================================================================
// Header — identity · workspace nav · run status · (children: the ModeToggle) ·
// mobile drawer toggle. See UI.md §2. The Rank/Fuse toggle is passed as
// children so it sits inline here, always visible — it is the sole switch in
// the product and appears only on Compare.
//
// Responsive (DESIGN.md): on <768px the command pane collapses into a header
// drawer; `onOpenCommand` renders a hamburger button shown only on mobile.
// At 768–1023px palette/help labels collapse to icon-only, then connection
// text compacts to a status dot, preserving identity, workspace labels,
// execution status, and Compare-only Rank/Fuse.
// =============================================================================

import { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Command, HelpCircle, Menu } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { HexCubeLogo } from "./brand-icons";
import { WorkspaceNav } from "./WorkspaceNav";

export type ConnectionState = "ready" | "running" | "degraded" | "offline";

function DetachedDialogTrigger({
  handle,
  children,
}: {
  handle?: Dialog.Handle<unknown>;
  children: ReactElement;
}) {
  return handle ? <Dialog.Trigger handle={handle} render={children} /> : children;
}

function livePill(running: boolean, conn: ConnectionState): { label: string; dot: string; text: string } {
  if (running) {
    return { label: "Running", dot: "bg-accent animate-pulse-ease", text: "text-accent" };
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
  children,
  onOpenCommand,
  onOpenConnections,
  onOpenPalette,
  onOpenHelp,
  commandDialogHandle,
  connectionsDialogHandle,
  cheatsheetDialogHandle,
  connectionState = "ready",
  showToggle = true,
}: {
  running: boolean;
  children: ReactNode;
  onOpenCommand?: () => void;
  onOpenConnections?: () => void;
  onOpenPalette?: () => void;
  onOpenHelp?: () => void;
  commandDialogHandle?: Dialog.Handle<unknown>;
  connectionsDialogHandle?: Dialog.Handle<unknown>;
  cheatsheetDialogHandle?: Dialog.Handle<unknown>;
  connectionState?: ConnectionState;
  showToggle?: boolean;
}) {
  const pill = livePill(running, connectionState);
  const elapsed = useRunElapsed(running);
  const pillLabel = running ? `Running · ${elapsed}s` : pill.label;

  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between gap-2 border-b border-edge bg-shell px-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        {onOpenCommand && (
          <DetachedDialogTrigger handle={commandDialogHandle}>
            <button
              type="button"
              onClick={onOpenCommand}
              aria-label="Open command pane"
              className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-panel hover:text-text md:hidden"
            >
              <Menu size={18} />
            </button>
          </DetachedDialogTrigger>
        )}
        <HexCubeLogo size={22} className="shrink-0 text-accent" />
        {/* App name is redundant chrome on tight viewports — the logo carries
            identity. Keep it from sm up so the header never clips at 390px. */}
        <span className="hidden text-base font-semibold tracking-tight sm:inline">RSemble AI</span>
      </div>

      {/* Desktop primary navigation — hidden on mobile (<768px) where the
          fixed bottom MobileWorkspaceNav is used instead. */}
      <div className="hidden md:block">
        <WorkspaceNav />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onOpenConnections && (
          <DetachedDialogTrigger handle={connectionsDialogHandle}>
            <button
              type="button"
              onClick={onOpenConnections}
              aria-label={`Connection status: ${pillLabel}. Manage connections.`}
              title="Provider connections"
              className="flex min-h-[44px] items-center gap-2 rounded-full border border-edge bg-panel px-3.5 font-mono text-xs hover:border-edge-bright"
            >
              <span className={`size-2 rounded-full ${pill.dot}`} aria-hidden="true" />
              <span className={`hidden lg:inline ${pill.text}`} aria-live="polite">
                {pillLabel}
              </span>
            </button>
          </DetachedDialogTrigger>
        )}
        {/* Palette — two treatments: icon-only at md (768–1023px), full ⌘K
            keycaps at lg+. The icon-only button keeps its accessible name. */}
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
          }`}
        >
          <Command size={16} />
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
          }`}
        >
          <kbd className="rounded-sm border border-edge bg-card px-1.5 py-0.5">⌘</kbd>
          <kbd className="rounded-sm border border-edge bg-card px-1.5 py-0.5">K</kbd>
        </button>
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
            }`}
          >
            <HelpCircle size={16} />
          </button>
        </DetachedDialogTrigger>
        {showToggle && children}
      </div>

    </header>
  );
}
