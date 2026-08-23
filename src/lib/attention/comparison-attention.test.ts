import { describe, expect, it } from "vitest";
import type { ComparisonResultIndex } from "../compare/comparison-result-types";
import type { RunStatus } from "../persistence/run-types";
import { queryComparisonAttention } from "./comparison-attention";

function index(overrides: Partial<ComparisonResultIndex> & { status: RunStatus }): ComparisonResultIndex {
  return {
    id: "cmp-1",
    runId: "cmp-1",
    createdAt: 1,
    updatedAt: 2,
    mode: "rank",
    title: "A comparison",
    taskBinding: { kind: "ad_hoc", inputSnapshotRef: "snap-1" },
    taskInstanceId: null,
    activeObservationIds: [],
    evidenceReceiptRevision: 1,
    lineage: { repeatedFrom: null },
    revision: 1,
    ...overrides,
  };
}

const STATUSES: RunStatus[] = ["running", "completed", "partial", "failed", "aborted", "interrupted"];

describe("queryComparisonAttention", () => {
  it.each(STATUSES)("excludes persisted comparison status %s", (status) => {
    expect(queryComparisonAttention({ index: index({ status }) })).toEqual([]);
  });

  it("excludes aborted comparison even when reusable candidate/judge/fusion progress exists", () => {
    expect(
      queryComparisonAttention({
        index: index({ status: "aborted" }),
        candidateFailed: true,
        judgeFailed: true,
        fusionFailed: true,
        liveRetryAvailable: true,
      }),
    ).toEqual([]);
  });

  it("excludes interrupted comparison even when live retry exists on /compare", () => {
    expect(
      queryComparisonAttention({
        index: index({ status: "interrupted" }),
        liveRetryAvailable: true,
      }),
    ).toEqual([]);
  });

  it("excludes completed exploratory evidence and losing models", () => {
    expect(
      queryComparisonAttention({
        index: index({ status: "completed", mode: "fuse" }),
        exploratoryOnly: true,
        modelLost: true,
      }),
    ).toEqual([]);
  });

  it("excludes repeatedFrom lineage as if it were supersession", () => {
    expect(
      queryComparisonAttention({
        index: index({
          status: "interrupted",
          lineage: { repeatedFrom: "cmp-older" },
        }),
      }),
    ).toEqual([]);
  });

  it("excludes active running comparison", () => {
    expect(queryComparisonAttention({ index: index({ status: "running" }) })).toEqual([]);
  });
});
