// =============================================================================
// WorkspaceNav — desktop primary navigation (Compare · Evaluations · Lab ·
// Models). Child 08 spec §G.5: the four meaning-ordered destinations are the
// only primary navigation; Runs lives on as the Records utility and legacy
// routes. Real links with aria-current="page" on the active route; the active
// item adds a static 2px bottom accent bar (non-hue-only signal). No sliding
// indicator, no Records entry — Records is secondary chrome (§C.2).
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
                ? "text-accent shadow-[inset_0_-2px_0_0_#00e5ff]"
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
