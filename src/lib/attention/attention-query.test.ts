import { describe, expect, it } from "vitest";
import type { AttentionItem } from "./attention-types";
import { mergeDeduplicateAndSortAttention } from "./attention-query";

function item(
  partial: Partial<AttentionItem> & Pick<AttentionItem, "key" | "reasonCode" | "sourceId">,
): AttentionItem {
  return {
    kind: "evaluation_recovery",
    ownerHref: `/evaluations/results/${partial.sourceId}`,
    title: partial.reasonCode,
    summary: "safe",
    severity: "actionable",
    occurredAt: 100,
    supersessionKey: partial.sourceId,
    ...partial,
  };
}

describe("mergeDeduplicateAndSortAttention", () => {
  it("returns no phantom item when the set is empty", () => {
    const result = mergeDeduplicateAndSortAttention([]);
    expect(result.items).toEqual([]);
    expect(result.visible).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.overflowLabel).toBeNull();
  });

  it("orders interruption before incomplete repair, then newest, then source id", () => {
    const result = mergeDeduplicateAndSortAttention([
      item({
        key: "b",
        sourceId: "exp-b",
        reasonCode: "evaluation_cells_repairable",
        occurredAt: 300,
      }),
      item({
        key: "a2",
        sourceId: "exp-a2",
        reasonCode: "evaluation_interrupted",
        occurredAt: 100,
      }),
      item({
        key: "a1",
        sourceId: "exp-a1",
        reasonCode: "evaluation_interrupted",
        occurredAt: 200,
      }),
    ]);
    expect(result.items.map((row) => row.sourceId)).toEqual(["exp-a1", "exp-a2", "exp-b"]);
  });

  it("keeps the newest representative per supersessionKey", () => {
    const result = mergeDeduplicateAndSortAttention([
      item({
        key: "old",
        sourceId: "exp-1",
        reasonCode: "evaluation_tasks_incomplete",
        occurredAt: 10,
        supersessionKey: "evaluation:exp-1",
      }),
      item({
        key: "new",
        sourceId: "exp-1",
        reasonCode: "evaluation_interrupted",
        occurredAt: 50,
        supersessionKey: "evaluation:exp-1",
      }),
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].key).toBe("new");
    expect(result.items[0].reasonCode).toBe("evaluation_interrupted");
  });

  it("caps visible at five and reports 9+ when total exceeds nine", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      item({
        key: `k${i}`,
        sourceId: `exp-${String(i).padStart(2, "0")}`,
        reasonCode: "evaluation_tasks_incomplete",
        occurredAt: 100 + i,
      }),
    );
    const result = mergeDeduplicateAndSortAttention(rows);
    expect(result.total).toBe(12);
    expect(result.visible).toHaveLength(5);
    expect(result.overflowLabel).toBe("9+");
  });

  it("reports the exact count when total is between 6 and 9", () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      item({
        key: `k${i}`,
        sourceId: `exp-${i}`,
        reasonCode: "evaluation_tasks_incomplete",
        occurredAt: i,
      }),
    );
    const result = mergeDeduplicateAndSortAttention(rows);
    expect(result.visible).toHaveLength(5);
    expect(result.overflowLabel).toBe("7");
  });
});
