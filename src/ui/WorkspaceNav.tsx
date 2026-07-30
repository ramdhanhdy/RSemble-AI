// =============================================================================
// WorkspaceNav — desktop primary navigation (Compare · Runs · Evaluations).
// See UI.md §2 and spec §5.2. Rendered inside the Header at md+ (>=768px).
// Real links with aria-current="page" on the active route. The active state
// uses the cyan accent sparingly per DESIGN.md.
// =============================================================================

import { NavLink } from "react-router-dom";
import { GitCompare, History, FlaskConical, type LucideIcon } from "lucide-react";

interface WorkspaceLink {
  to: string;
  label: string;
  icon: LucideIcon;
}

const WORKSPACES: readonly WorkspaceLink[] = [
  { to: "/compare", label: "Compare", icon: GitCompare },
  { to: "/runs", label: "Runs", icon: History },
  { to: "/evaluations", label: "Evaluations", icon: FlaskConical },
] as const;

export function WorkspaceNav() {
  return (
    <nav aria-label="Primary" className="flex items-center gap-0.5">
      {WORKSPACES.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          aria-current="page"
          className={({ isActive }) =>
            `flex min-h-[44px] items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-150 ${
              isActive
                ? "text-accent"
                : "text-text-secondary hover:bg-panel hover:text-text"
            }`
          }
        >
          <Icon size={15} className="hidden lg:block" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
