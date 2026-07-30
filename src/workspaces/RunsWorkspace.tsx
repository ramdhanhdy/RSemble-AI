// =============================================================================
// RunsWorkspace — honest placeholder. The Runs feature is not yet implemented.
// This component clearly states that and provides no fake controls.
// Phase 3 will replace this with the searchable Runs list and run detail.
// =============================================================================

import { GitCompare } from "lucide-react";
import { Link } from "react-router-dom";

export function RunsWorkspace() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="font-mono text-sm uppercase tracking-[0.14em] text-text-muted">
        Runs
      </h1>
      <p className="max-w-sm text-sm text-text-secondary">
        Run history is not yet implemented. Completed, partial, failed, aborted,
        and interrupted runs will be searchable here with full evidence.
      </p>
      <Link
        to="/compare"
        className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
      >
        <GitCompare size={15} aria-hidden="true" />
        Go to Compare
      </Link>
    </div>
  );
}
