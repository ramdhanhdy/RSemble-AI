// =============================================================================
// AppRouter — route definitions for the three-workspace shell.
//
// RSemble wraps this in HashRouter (production) or MemoryRouter (tests).
// The routes render workspace content below the shared header. Compare
// content is rendered inline by RSemble via the CompareOutlet; Runs and
// Evaluations are separate workspace components.
//
// The reducer, controller refs, provider probes, and modals stay mounted
// in RSemble above this router so state persists across navigation.
// =============================================================================

import { Routes, Route, Navigate, Link } from "react-router-dom";
import { RunsWorkspace } from "./workspaces/RunsWorkspace";
import { EvaluationsWorkspace } from "./workspaces/EvaluationsWorkspace";

export function AppRoutes({ compareOutlet }: { compareOutlet: React.ReactNode }) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/compare" replace />} />
      <Route path="/compare" element={<CompareSlot>{compareOutlet}</CompareSlot>} />
      <Route path="/runs" element={<RunsWorkspace />} />
      <Route path="/evaluations" element={<EvaluationsWorkspace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function CompareSlot({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="font-mono text-sm uppercase tracking-[0.14em] text-text-muted">
        Not found
      </h1>
      <p className="max-w-sm text-sm text-text-secondary">
        This route does not exist.
      </p>
      <Link
        to="/compare"
        className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
      >
        Return to Compare
      </Link>
    </div>
  );
}
