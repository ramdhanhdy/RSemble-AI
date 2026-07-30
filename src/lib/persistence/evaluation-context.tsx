// =============================================================================
// RSemble AI — Evaluation repository context
//
// Provides the EvaluationRepository to React components via context.
// Separate from RepositoryContext (which holds the RunRepository).
// =============================================================================

import { createContext, useContext } from "react";
import type { EvaluationRepository } from "./evaluation-repository";

export const EvaluationContext = createContext<EvaluationRepository | null>(null);

export function useEvaluationRepository(): EvaluationRepository | null {
  return useContext(EvaluationContext);
}
