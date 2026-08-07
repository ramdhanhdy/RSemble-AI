// =============================================================================
// useModelTelemetry — async telemetry from the repository (spec §8.5).
//
// Computes per-model win rate, average score, run count, and average latency
// from FullRunSummaryV2 records. Excludes experiment runs by default (ad hoc
// only). Same model ID across providers remains separate (keyed by
// providerId:slug). No cross-suite global "best model" is computed.
//
// Replaces the synchronous localStorage-based getModelTelemetryCached.
// =============================================================================

import { useMemo } from "react";
import type { RunRepository } from "../../lib/persistence/run-repository";
import type { FullRunSummaryV2 } from "../../lib/persistence/run-types";
import { useRunList } from "./useRunList";

export interface ModelTelemetry {
  winRate: number;
  avgScore: number;
  runCount: number;
  avgLatencyMs: number;
  avgCostUsd: number | null;
}

export function useModelTelemetry(
  repo: RunRepository | null,
  modelKey: string,
): ModelTelemetry | null {
  // Fetch ad hoc summaries only (experiment runs excluded by source filter).
  const { summaries } = useRunList(repo, { source: "adhoc", limit: 500 });

  return useMemo(() => {
    const matching = summaries.filter(
      (s): s is FullRunSummaryV2 => s.kind === "full" && s.modelKeys.includes(modelKey),
    );
    if (matching.length === 0) return null;

    let wins = 0;
    let scoreSum = 0;
    let scoredCount = 0;
    let latencySum = 0;
    let latencyCount = 0;

    for (const s of matching) {
      if (s.winnerKeys.includes(modelKey)) wins++;
      const score = s.scoresByModelKey[modelKey];
      if (score != null) {
        scoreSum += score;
        scoredCount++;
      }
      if (s.completedAt != null) {
        latencySum += s.completedAt - s.createdAt;
        latencyCount++;
      }
    }

    const scoreDenom = scoredCount > 0 ? scoredCount : 1;
    return {
      winRate: wins / matching.length,
      avgScore: scoreSum / scoreDenom,
      runCount: matching.length,
      avgLatencyMs: latencyCount > 0 ? latencySum / latencyCount : 0,
      avgCostUsd: null,
    };
  }, [summaries, modelKey]);
}
