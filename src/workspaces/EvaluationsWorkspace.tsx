// =============================================================================
// EvaluationsWorkspace — honest placeholder. The Evaluations feature is not yet
// implemented. This component clearly states that and provides no fake controls.
// Phase 5+ will replace this with suites, profiles, and experiment execution.
// =============================================================================

import { GitCompare } from "lucide-react";
import { Link } from "react-router-dom";

export function EvaluationsWorkspace() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-3 p-8 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 className="font-mono text-sm uppercase tracking-[0.14em] text-text-muted">
          Evaluations
        </h1>
        <p className="max-w-sm text-sm text-text-secondary">
          Evaluation suites are not yet implemented. Versioned suites of multiple
          tasks, executed one at a time through the comparison pipeline, will be
          available here with a model-by-task result matrix.
        </p>
        <Link
          to="/compare"
          className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
        >
          <GitCompare size={15} aria-hidden="true" />
          Go to Compare
        </Link>
      </div>
    </div>
  );
}
