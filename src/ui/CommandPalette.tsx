// =============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  CornerDownLeft,
  FlaskConical,
  Gauge,
  GitCompare,
  History,
  Layers,
  Link2,
  Maximize2,
  Plus,
  PlusCircle,
  Power,
  Search,
} from "lucide-react";
import type { WorkspaceKind } from "./useActionShortcuts";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onRun: () => void;
  onAbort: () => void;
  onToggleMode: () => void;
  onAddModel: () => void;
  onAddCriterion: () => void;
  onOpenConnections: () => void;
  onToggleFocusMode: () => void;
  onExport: () => void;
  running: boolean;
  /** Global run gate (prompt non-empty, ≥1 enabled slot, providers ready).
   *  The "Run pipeline" command is disabled when this is false so the palette
   *  never advertises a no-op action. */
  canRun: boolean;
  /** Active workspace — Compare-only commands are rendered only on "compare".
   *  Defaults to "compare" so pre-workspace callers compile unchanged. */
  workspace?: WorkspaceKind;
  /** Route navigation for the Navigate command group. */
  onNavigate?: (path: string) => void;
  /** Non-null while an experiment owns execution — exposes View/Abort. */
  activeExperimentId?: string | null;
  onViewExperiment?: () => void;
  onAbortExperiment?: () => void;
}

interface Command {
  id: string;
  label: string;
  group: string;
  icon: typeof Power;
  hint?: string[];
  disabled?: boolean;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onRun,
  onAbort,
  onToggleMode,
  onAddModel,
  onAddCriterion,
  onOpenConnections,
  onToggleFocusMode,
  onExport,
  running,
  canRun,
  workspace = "compare",
  onNavigate,
  activeExperimentId = null,
  onViewExperiment,
  onAbortExperiment,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement;
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);
  useEffect(() => {
    if (!open) {
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    if (!node) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = node.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    node.addEventListener("keydown", handler);
    return () => node.removeEventListener("keydown", handler);
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    // Navigate group first — global routing commands, present on every
    // workspace (navigating to the current workspace is an idempotent no-op).
    const navigateCommands: Command[] = [
      {
        id: "nav-compare",
        label: "Go to Compare",
        group: "Navigate",
        icon: GitCompare,
        run: () => onNavigate?.("/compare"),
      },
      {
        id: "nav-runs",
        label: "Go to Runs",
        group: "Navigate",
        icon: History,
        run: () => onNavigate?.("/runs"),
      },
      {
        id: "nav-evaluations",
        label: "Go to Evaluations",
        group: "Navigate",
        icon: FlaskConical,
        run: () => onNavigate?.("/evaluations"),
      },
    ];
    // Compare-only commands are ABSENT (not disabled-with-reason) outside the
    // Compare workspace — plan 8.2 allows either; absent keeps other
    // workspaces free of dead Compare actions.
    const compareCommands: Command[] =
      workspace === "compare"
        ? [
            {
              id: "run",
              label: running ? "Abort run" : "Run pipeline",
              group: "Pipeline",
              icon: running ? Power : Gauge,
              hint: ["⌘", "↵"],
              disabled: !running && !canRun,
              run: running ? onAbort : onRun,
            },
            {
              id: "toggle-mode",
              label: "Toggle Rank ↔ Fuse",
              group: "Pipeline",
              icon: Layers,
              hint: ["⌘", "/"],
              run: onToggleMode,
            },
            {
              id: "toggle-focus",
              label: "Toggle focus mode",
              group: "Pipeline",
              icon: Maximize2,
              hint: ["⌘", "\\"],
              run: onToggleFocusMode,
            },
            {
              id: "add-model",
              label: "Add a model",
              group: "Configure",
              icon: Plus,
              run: onAddModel,
            },
            {
              id: "add-criterion",
              label: "Add evaluation criterion",
              group: "Configure",
              icon: PlusCircle,
              run: onAddCriterion,
            },
          ]
        : [];
    // Experiment commands appear only while an experiment owns execution.
    // "Abort experiment" shares the destructive treatment of "Abort run"
    // (Power icon, standard row) — consistent with the existing abort command.
    const experimentCommands: Command[] =
      activeExperimentId !== null
        ? [
            {
              id: "view-experiment",
              label: "View experiment",
              group: "Experiment",
              icon: ClipboardList,
              run: () => onViewExperiment?.(),
            },
            {
              id: "abort-experiment",
              label: "Abort experiment",
              group: "Experiment",
              icon: Power,
              run: () => onAbortExperiment?.(),
            },
          ]
        : [];
    const exportCommands: Command[] =
      workspace === "compare"
        ? [
            {
              id: "export",
              label: "Export result",
              group: "Result",
              icon: CornerDownLeft,
              run: onExport,
            },
          ]
        : [];
    return [
      ...navigateCommands,
      ...compareCommands,
      // Open connections stays global across all workspaces.
      {
        id: "open-connections",
        label: "Open connections",
        group: "Configure",
        icon: Link2,
        run: onOpenConnections,
      },
      ...exportCommands,
      ...experimentCommands,
    ];
  }, [
    running,
    canRun,
    onRun,
    onAbort,
    onToggleMode,
    onToggleFocusMode,
    onAddModel,
    onAddCriterion,
    onOpenConnections,
    onExport,
    workspace,
    onNavigate,
    activeExperimentId,
    onViewExperiment,
    onAbortExperiment,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) => {
      const label = cmd.label.toLowerCase();
      let qi = 0;
      for (let i = 0; i < label.length && qi < q.length; i++) {
        if (label[i] === q[qi]) qi++;
      }
      return qi === q.length;
    });
  }, [commands, query]);

  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered, active]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const execute = (cmd: Command | undefined) => {
    if (!cmd || cmd.disabled) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (filtered.length ? (a + 1) % filtered.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (filtered.length ? (a - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      execute(filtered[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const groups = useMemo(() => {
    const map = new Map<string, { cmd: Command; idx: number }[]>();
    filtered.forEach((cmd, idx) => {
      const list = map.get(cmd.group) ?? [];
      list.push({ cmd, idx });
      map.set(cmd.group, list);
    });
    return map;
  }, [filtered]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70 p-4 pt-[12vh] backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-edge-bright bg-raised shadow-popover motion-safe:animate-cmd-pop"
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 border-b border-edge px-4 py-3">
          <Search size={16} className="shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a command…"
            aria-label="Search commands"
            aria-controls="cmd-list"
            aria-activedescendant={filtered[active] ? `cmd-${filtered[active].id}` : undefined}
            className="min-h-[44px] flex-1 bg-transparent font-mono text-sm text-text placeholder-text-muted focus:outline-none"
          />
          <kbd className="shrink-0 rounded-sm border border-edge bg-card px-1.5 py-0.5 font-mono text-xs text-text-muted">
            Esc
          </kbd>
        </div>

        {/* Command list */}
        <div
          ref={listRef}
          id="cmd-list"
          role="listbox"
          aria-label="Commands"
          className="max-h-[50vh] overflow-y-auto p-2 scroll-thin"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center font-mono text-xs text-text-muted">
              No matching commands
            </div>
          ) : (
            Array.from(groups.entries()).map(([group, items]) => (
              <div key={group} className="mb-1 last:mb-0">
                <div className="px-2 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted">
                  {group}
                </div>
                {items.map(({ cmd, idx }) => {
                  const Icon = cmd.icon;
                  const isActive = idx === active;
                  return (
                    <button
                      key={cmd.id}
                      id={`cmd-${cmd.id}`}
                      data-idx={idx}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      aria-disabled={cmd.disabled ? true : undefined}
                      onMouseMove={() => setActive(idx)}
                      onClick={() => execute(cmd)}
                      className={`flex w-full min-h-[44px] items-center gap-3 rounded-md px-2.5 py-2 text-left ${
                        cmd.disabled
                          ? "cursor-not-allowed opacity-50"
                          : isActive
                            ? "bg-card-hover"
                            : "hover:bg-card-hover/50"
                      }`}
                    >
                      <Icon size={16} className="shrink-0 text-text-secondary" />
                      <span className="min-w-0 flex-1 truncate text-sm text-text">{cmd.label}</span>
                      {cmd.hint && (
                        <span className="flex shrink-0 items-center gap-1">
                          {cmd.hint.map((k) => (
                            <kbd
                              key={k}
                              className="rounded-sm border border-edge bg-card px-1.5 py-0.5 font-mono text-xs text-text-muted"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-edge px-4 py-2 font-mono text-[11px] text-text-muted">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded-sm border border-edge bg-card px-1 py-0.5">↑</kbd>
            <kbd className="rounded-sm border border-edge bg-card px-1 py-0.5">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded-sm border border-edge bg-card px-1 py-0.5">↵</kbd>
            select
          </span>
        </div>
      </div>
    </div>
  );
}
