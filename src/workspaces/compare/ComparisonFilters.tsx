import type { RunStatus } from "../../lib/persistence/run-types";
import type { ComparisonMode } from "../../lib/compare/comparison-result-types";

export interface ComparisonFiltersValue {
  text: string;
  modelKey: string;
  status: RunStatus | "";
  mode: ComparisonMode | "";
  bindingKind: "ad_hoc" | "canonical" | "";
  taskId: string;
  createdFrom?: number;
  createdTo?: number;
}

export const EMPTY_COMPARISON_FILTERS: ComparisonFiltersValue = {
  text: "",
  modelKey: "",
  status: "",
  mode: "",
  bindingKind: "",
  taskId: "",
  createdFrom: undefined,
  createdTo: undefined,
};

export function ComparisonFilters(_props: {
  value: ComparisonFiltersValue;
  onChange: (value: ComparisonFiltersValue) => void;
  modelKeys?: string[];
}) {
  return <div data-stub="comparison-filters" />;
}
