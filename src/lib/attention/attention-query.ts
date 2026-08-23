import type { AttentionItem, AttentionReasonCode } from "./attention-types";

export interface AttentionQueryResult {
  items: AttentionItem[];
  visible: AttentionItem[];
  total: number;
  overflowLabel: string | null;
}

const PRIORITY: Record<AttentionReasonCode, number> = {
  storage_write_failed: 0,
  storage_quota_blocked: 0,
  storage_unavailable: 0,
  evaluation_interrupted: 1,
  comparison_interrupted: 1,
  evaluation_tasks_incomplete: 2,
  evaluation_cells_repairable: 2,
  comparison_candidate_recoverable: 2,
  comparison_judge_recoverable: 2,
  comparison_fusion_recoverable: 2,
};

function compareItems(a: AttentionItem, b: AttentionItem): number {
  const pa = PRIORITY[a.reasonCode];
  const pb = PRIORITY[b.reasonCode];
  if (pa !== pb) return pa - pb;
  if (a.occurredAt !== b.occurredAt) return b.occurredAt - a.occurredAt;
  return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
}

export function mergeDeduplicateAndSortAttention(items: readonly AttentionItem[]): AttentionQueryResult {
  const newest = new Map<string, AttentionItem>();
  for (const item of items) {
    const prior = newest.get(item.supersessionKey);
    if (!prior || item.occurredAt >= prior.occurredAt) {
      newest.set(item.supersessionKey, item);
    }
  }
  const sorted = [...newest.values()].sort(compareItems);
  const total = sorted.length;
  const visible = sorted.slice(0, 5);
  let overflowLabel: string | null = null;
  if (total > 5) {
    overflowLabel = total > 9 ? "9+" : String(total);
  }
  return { items: sorted, visible, total, overflowLabel };
}
