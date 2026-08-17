import type { ComparisonRepository } from "../../lib/persistence/comparison-repository";

export interface ComparisonListProps {
  repo: ComparisonRepository | null;
  selectedId?: string | null;
  onNewComparison?: () => void;
  modelKeys?: string[];
  className?: string;
}

export function ComparisonList(_props: ComparisonListProps) {
  return <div data-stub="comparison-list" />;
}
