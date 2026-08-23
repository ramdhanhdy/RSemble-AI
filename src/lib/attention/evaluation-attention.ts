import type { ExperimentRecord } from "../evaluations/evaluation-types";
import type { ExperimentAggregation } from "../evaluations/experiment-aggregation";
import { planMissingCellRepair } from "../evaluations/experiment-repair";
import { isRetryIncompleteEligible } from "../evaluations/experiment-engine";
import type { RunRecordV2 } from "../persistence/run-types";
import {
  ATTENTION_REASON_COPY,
  parseAttentionItem,
  type AttentionItem,
  type AttentionReasonCode,
} from "./attention-types";

export interface EvaluationAttentionSource {
  experiment: ExperimentRecord;
  aggregation?: ExperimentAggregation;
  resolveRunRecord?: (runId: string) => RunRecordV2 | null;
  declaredPartialWorkload?: boolean;
}

function ownerHref(id: string): string {
  return `/evaluations/results/${id}`;
}

function hasRepairableCell(source: EvaluationAttentionSource): boolean {
  const { experiment, aggregation, resolveRunRecord } = source;
  if (!aggregation || !resolveRunRecord) return false;
  for (let taskIdx = 0; taskIdx < aggregation.cells.length; taskIdx += 1) {
    const taskId = aggregation.taskIds[taskIdx];
    const row = aggregation.cells[taskIdx];
    for (let modelIdx = 0; modelIdx < row.length; modelIdx += 1) {
      const cell = row[modelIdx];
      if (cell.kind !== "missing" || cell.reason !== "no-score") continue;
      const result = planMissingCellRepair({
        experiment,
        aggregation,
        request: { taskId, modelKeys: [aggregation.modelKeys[modelIdx]] },
        resolveRunRecord,
      });
      if (result.ok) return true;
    }
  }
  return false;
}

function item(experiment: ExperimentRecord, reasonCode: AttentionReasonCode): AttentionItem {
  const copy = ATTENTION_REASON_COPY[reasonCode];
  return parseAttentionItem({
    key: `evaluation:${experiment.id}:${reasonCode}`,
    kind: "evaluation_recovery",
    sourceId: experiment.id,
    ownerHref: ownerHref(experiment.id),
    title: copy.label,
    summary: copy.summary,
    reasonCode,
    severity: "actionable",
    occurredAt: experiment.updatedAt,
    supersessionKey: `evaluation:${experiment.id}`,
  });
}

export function queryEvaluationAttention(source: EvaluationAttentionSource): AttentionItem[] {
  const experiment = source.experiment;
  if (!experiment?.id) return [];
  const retry = isRetryIncompleteEligible(experiment);
  const repairable = hasRepairableCell(source);

  if (experiment.status === "interrupted" && retry) {
    return [item(experiment, "evaluation_interrupted")];
  }
  if (repairable) {
    return [item(experiment, "evaluation_cells_repairable")];
  }
  if (retry) {
    return [item(experiment, "evaluation_tasks_incomplete")];
  }
  return [];
}
