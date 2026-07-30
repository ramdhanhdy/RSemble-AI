// =============================================================================
// EvaluationsWorkspace — segmented nav (Suites | Profiles) + Outlet.
//
// The Evaluations workspace has a local secondary navigation with Suites and
// Profiles. It is a compact segmented route control using real links with
// aria-current; it is visually subordinate to the primary header and never
// spans the full shell width like a second global nav (spec §9.2).
//
// Provides the EvaluationRepository to all child routes via EvaluationContext,
// sourced from RepositoryContext (which owns the evalRepo).
// =============================================================================

import { NavLink, Outlet } from "react-router-dom";
import { EvaluationContext } from "../lib/persistence/evaluation-context";
import { useEvaluationRepository } from "../lib/persistence/repository-context";

interface SegNavEntry {
  to: string;
  label: string;
  /** End match so /evaluations is active only on the exact index. */
  end?: boolean;
}

const SEG_NAV: readonly SegNavEntry[] = [
  { to: "/evaluations", label: "Suites", end: true },
  { to: "/evaluations/profiles", label: "Profiles" },
] as const;

export function EvaluationsWorkspace() {
  // evalRepo comes from RepositoryContext (the shared DB provider). We feed it
  // into EvaluationContext so child routes can call useEvaluationRepository()
  // from evaluation-context.tsx without depending on RepositoryContext.
  const evalRepo = useEvaluationRepository();

  return (
    <EvaluationContext.Provider value={evalRepo}>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Compact segmented nav — subordinate to the primary header. */}
        <nav aria-label="Evaluations" className="flex shrink-0 items-center gap-0.5 border-b border-edge p-2">
          {SEG_NAV.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-current="page"
              className={({ isActive }) =>
                `flex min-h-[44px] items-center rounded-md px-4 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isActive
                    ? "bg-accent/15 text-accent"
                    : "text-text-secondary hover:bg-panel hover:text-text"
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Routed content. The index route (/evaluations) renders SuiteList
            inline so it has the segmented nav above it; deeper routes render
            through <Outlet />. */}
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-3">
          <Outlet />
        </div>
      </div>
    </EvaluationContext.Provider>
  );
}
