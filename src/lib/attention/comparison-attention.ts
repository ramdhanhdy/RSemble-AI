import type { ComparisonResultIndex } from "../compare/comparison-result-types";
import type { AttentionItem } from "./attention-types";

/**
 * Persisted Compare results have no owner-route recovery action.
 * Live `/compare` can retry/re-judge/re-fuse; `/compare/results/:id` cannot.
 * Child 09 Task 0: EXCLUDE every comparison row until that action exists.
 */
export interface ComparisonAttentionSource {
  index: ComparisonResultIndex;
  candidateFailed?: boolean;
  judgeFailed?: boolean;
  fusionFailed?: boolean;
  liveRetryAvailable?: boolean;
  exploratoryOnly?: boolean;
  modelLost?: boolean;
}

export function queryComparisonAttention(_source: ComparisonAttentionSource): AttentionItem[] {
  return [];
}
