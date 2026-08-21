// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import {
  ClipboardList,
  CornerDownLeft,
  Cpu,
  FlaskConical,
  Gauge,
  GitCompare,
  History,
  Layers,
  Link2,
  ListChecks,
  Maximize2,
  Plus,
  Power,
  Search,
  TestTubes,
} from "lucide-react";
import type { WorkspaceKind } from "./useActionShortcuts";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onRun: () => void;
  onAbort: () => void;
  onToggleMode: () => void;
  onAddModel: () => void;
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
  /** Focus the Records search surface: drawer at >=1024, /records below. */
  onFindRecord?: () => void;
}

interface Command {
  id: string;
  label: string;
  group: string;
  icon: typeof Power;
  hint?: string[];
  disabled?: boolean;
  /** Extra search keywords (cmdk matches these beyond the label). */
  keywords?: string[];
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onRun,
  onAbort,
  onToggleMode,
  onAddModel,
  onOpenConnections,
  onToggleFocusMode,
  onExport,
  running,
  canRun,
  workspace = "compare",
  onNavigate,
  onFindRecord,
  activeExperimentId = null,
  onViewExperiment,
  onAbortExperiment,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    // Child 08 §G.7: Navigate is exactly these six destinations in this
    // order. "Go to Records" carries the old Runs muscle-memory keywords;
    // there is no "Go to Runs" command anywhere.
    const navigateCommands: Command[] = [
      {
        id: "nav-compare",
        label: "Go to Compare",
        group: "Navigate",
        icon: GitCompare,
        run: () => onNavigate?.("/compare"),
      },
      {
        id: "nav-evaluations",
        label: "Go to Evaluations",
        group: "Navigate",
        icon: FlaskConical,
        run: () => onNavigate?.("/evaluations"),
      },
      {
        id: "nav-lab",
        label: "Go to Lab",
        group: "Navigate",
        icon: TestTubes,
        run: () => onNavigate?.("/lab"),
      },
      {
        id: "nav-models",
        label: "Go to Models",
        group: "Navigate",
        icon: Cpu,
        run: () => onNavigate?.("/models"),
      },
      {
        id: "nav-records",
        label: "Go to Records",
        group: "Navigate",
        icon: History,
        keywords: ["runs", "history", "ledger", "audit"],
        run: () => onNavigate?.("/records"),
      },
      {
        // Canonical Tasks are a secondary workspace (canonical-tasks spec §7):
        // reachable here, never from primary navigation.
        id: "nav-tasks",
        label: "Go to Tasks",
        group: "Navigate",
        icon: ListChecks,
        run: () => onNavigate?.("/tasks"),
      },
    ];
    const findRecordCommands: Command[] = [
      {
        // §G.7: focus the Records search — drawer (>=1024) or /records with
        // its filter focused (<1024). No Child 09 global search.
        id: "find-record",
        label: "Find record by ID…",
        group: "Records",
        icon: Search,
        run: () => onFindRecord?.(),
      },
    ];
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
          ]
        : [];
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
      ...findRecordCommands,
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
    onOpenConnections,
    onExport,
    workspace,
    onNavigate,
    onFindRecord,
    activeExperimentId,
    onViewExperiment,
    onAbortExperiment,
  ]);

  const groups = useMemo(() => {
    const entries = new Map<string, Command[]>();
    for (const command of commands) {
      const group = entries.get(command.group) ?? [];
      group.push(command);
      entries.set(command.group, group);
    }
    return entries;
  }, [commands]);

  const execute = (command: Command) => {
    if (command.disabled) return;
    onClose();
    command.run();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      label="Command palette"
      loop
      overlayClassName="fixed inset-0 z-[60] bg-black/70"
      contentClassName="fixed left-1/2 top-[12vh] z-[61] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border border-edge-bright bg-raised shadow-popover"
    >
      <div className="flex items-center gap-2.5 border-b border-edge px-4 py-3">
        <Search size={16} className="shrink-0 text-text-muted" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Type a command…"
          aria-label="Search commands"
          className="min-h-[44px] flex-1 bg-transparent font-mono text-sm text-text placeholder-text-muted outline-none"
        />
        <kbd className="shrink-0 rounded-sm border border-edge bg-card px-1.5 py-0.5 font-mono text-xs text-text-muted">
          Esc
        </kbd>
      </div>

      <Command.List className="max-h-[50vh] overflow-y-auto p-2 scroll-thin">
        <Command.Empty className="px-3 py-8 text-center font-mono text-xs text-text-muted">
          No matching commands
        </Command.Empty>
        {[...groups.entries()].map(([group, items]) => (
          <Command.Group
            key={group}
            heading={group}
            className="mb-1 last:mb-0 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-text-muted"
          >
            {items.map((command) => {
              const Icon = command.icon;
              return (
                <Command.Item
                  key={command.id}
                  value={command.label}
                  keywords={[command.group, ...(command.keywords ?? [])]}
                  disabled={command.disabled}
                  onSelect={() => execute(command)}
                  className="flex min-h-[44px] w-full items-center gap-3 rounded-md px-2.5 py-2 text-left data-[selected=true]:bg-card-hover data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50"
                >
                  <Icon size={16} className="shrink-0 text-text-secondary" />
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{command.label}</span>
                  {command.hint && (
                    <span className="flex shrink-0 items-center gap-1">
                      {command.hint.map((key) => (
                        <kbd
                          key={key}
                          className="rounded-sm border border-edge bg-card px-1.5 py-0.5 font-mono text-xs text-text-muted"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  )}
                </Command.Item>
              );
            })}
          </Command.Group>
        ))}
      </Command.List>

      <div className="flex items-center justify-between border-t border-edge px-4 py-2 font-mono text-xs text-text-muted">
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
    </Command.Dialog>
  );
}
