import {
  Command,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";

export type RailItemId = "command";

interface RailItem {
  id: RailItemId;
  label: string;
  icon: LucideIcon;
  tooltip: string;
}

// Only the Command deck exists today. The spec's other rail destinations
// (Runs, History, Models, Judges, Settings) are future phases — shipping them
// as visible-but-inert buttons would be advertising no-op navigation, so they
// are intentionally not rendered. Re-add here when those surfaces land.
const ITEMS: RailItem[] = [
  { id: "command", label: "Command", icon: Command, tooltip: "Command deck" },
];

export function IconRail({
  activeId = "command",
  onSelect,
  focusMode = false,
  onToggleFocusMode,
}: {
  activeId?: RailItemId;
  onSelect?: (id: RailItemId) => void;
  focusMode?: boolean;
  onToggleFocusMode?: () => void;
}) {
  // Single-item rail for now (see ITEMS note above).
  return (
    <nav
      aria-label="Primary"
      className="hidden w-16 shrink-0 flex-col items-center border-r border-edge bg-shell py-2 lg:flex"
    >
      {ITEMS.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            aria-disabled={active ? undefined : true}
            title={item.tooltip}
            onClick={() => {
              if (active) onSelect?.(item.id);
            }}
            className={`relative flex min-h-[56px] w-full flex-col items-center justify-center gap-1 ${
              active ? "text-accent" : "cursor-not-allowed text-text-secondary opacity-60"
            }`}
          >
            {active && (
              <span className="absolute left-0 h-8 w-0.5 rounded-full bg-accent" aria-hidden="true" />
            )}
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-md ${
                active ? "border border-accent/60 glow-accent" : ""
              }`}
            >
              <item.icon size={18} />
            </span>
            <span className="hidden text-[11px] uppercase tracking-wider xl:block">{item.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        aria-label={focusMode ? "Exit focus mode" : "Focus mode"}
        aria-pressed={focusMode}
        title={focusMode ? "Exit focus mode ⌘\\" : "Focus mode ⌘\\"}
        onClick={onToggleFocusMode}
        className={`mt-auto flex h-11 w-11 items-center justify-center rounded-md transition-colors ease-out duration-150 ${
          focusMode
            ? "text-accent hover:bg-card"
            : "text-text-secondary hover:bg-card hover:text-text"
        }`}
      >
        {focusMode ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>
    </nav>
  );
}
