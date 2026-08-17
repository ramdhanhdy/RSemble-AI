import type { CatalogModel } from "../../lib/providers/types";
import type { ComparisonRepository } from "../../lib/persistence/comparison-repository";
import type { RunRepository } from "../../lib/persistence/run-repository";
import type { RunConfigPreload } from "../../lib/runs/run-config-preload";

export interface ComparisonResultRouteProps {
  comparisonId: string;
  comparisonRepo?: ComparisonRepository | null;
  runRepo?: RunRepository | null;
  models?: CatalogModel[];
  onOpenInCompare?: (runId: string, config: RunConfigPreload) => void;
}

export function ComparisonResultRoute(_props: ComparisonResultRouteProps) {
  return <div data-stub="not-implemented">ComparisonResultRoute stub</div>;
}
