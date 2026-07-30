// =============================================================================
// MobileWorkspaceNav — fixed three-item bottom navigation (<768px).
// See spec §5.3. Each item has an icon + visible text, is >=44px high, uses
// aria-current="page", and accounts for safe-area insets. Workspace content
// reserves bottom padding so controls are not obscured.
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

export function MobileWorkspaceNav() {
  return (
    <nav
      aria-label="Workspace navigation"
      data-mobile="true"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-edge bg-shell md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {WORKSPACES.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          aria-current="page"
          data-testid="mobile-nav-item"
          className={({ isActive }) =>
            `flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-1 text-xs font-medium transition-colors duration-150 ${
              isActive ? "text-accent" : "text-text-secondary"
            }`
          }
        >
          <Icon size={18} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
