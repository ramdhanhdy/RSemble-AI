// =============================================================================
// MobileWorkspaceNav — fixed four-item bottom navigation (<768px). Child 08
// spec §G.6: exactly the same four destinations as the desktop nav, in the
// same order with the same icons. Each item has an icon + visible text, is
// >=44px high, uses aria-current="page", and accounts for safe-area insets.
// The active item keeps text-accent plus a static 2px TOP accent bar (mirror
// of the desktop bottom bar, since this nav sits at the screen bottom).
// Records is never a bottom-nav item — it is reached via the header utility.
// =============================================================================

import { NavLink } from "react-router-dom";
import { Cpu, FlaskConical, GitCompare, TestTubes, type LucideIcon } from "lucide-react";

interface WorkspaceLink {
  to: string;
  label: string;
  icon: LucideIcon;
}

const WORKSPACES: readonly WorkspaceLink[] = [
  { to: "/compare", label: "Compare", icon: GitCompare },
  { to: "/evaluations", label: "Evaluations", icon: FlaskConical },
  { to: "/lab", label: "Lab", icon: TestTubes },
  { to: "/models", label: "Models", icon: Cpu },
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
              isActive ? "text-accent shadow-[inset_0_2px_0_0_#00e5ff]" : "text-text-secondary"
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
