import type { ExperimentRecord } from "../evaluations/evaluation-types";
import type { ExperimentControllerEvent } from "../evaluations/experiment-controller";
import type { ComparisonResultIndex } from "../compare/comparison-result-types";
import { queryComparisonAttention } from "./comparison-attention";
import { queryEvaluationAttention } from "./evaluation-attention";
import { mergeDeduplicateAndSortAttention, type AttentionQueryResult } from "./attention-query";

export interface AttentionServiceDeps {
  listExperiments: () => Promise<ExperimentRecord[]>;
  listComparisons?: () => Promise<ComparisonResultIndex[]>;
  subscribeComparisons?: (listener: () => void) => () => void;
  subscribeRuns?: (listener: () => void) => () => void;
  subscribeController?: (listener: (event: ExperimentControllerEvent) => void) => () => void;
  addVisibilityListener?: (listener: () => void) => () => void;
  addBroadcastListener?: (listener: (data: unknown) => void) => () => void;
  isDocumentHidden?: () => boolean;
  debounceMs?: number;
}

export interface AttentionService {
  start(): Promise<AttentionQueryResult>;
  getSnapshot(): AttentionQueryResult;
  subscribe(listener: (result: AttentionQueryResult) => void): () => void;
  dispose(): void;
}

const EMPTY: AttentionQueryResult = {
  items: [],
  visible: [],
  total: 0,
  overflowLabel: null,
};

export function createAttentionService(deps: AttentionServiceDeps): AttentionService {
  const debounceMs = deps.debounceMs ?? 50;
  const unsubscribers: Array<() => void> = [];
  const listeners = new Set<(result: AttentionQueryResult) => void>();
  let snapshot = EMPTY;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let token = 0;

  function publish(next: AttentionQueryResult): void {
    snapshot = next;
    for (const listener of listeners) listener(next);
  }

  async function recompute(mine: number): Promise<void> {
    const experiments = await deps.listExperiments();
    if (disposed || mine !== token) return;
    const comparisons = deps.listComparisons ? await deps.listComparisons() : [];
    if (disposed || mine !== token) return;
    const items = [
      ...experiments.flatMap((experiment) => queryEvaluationAttention({ experiment })),
      ...comparisons.flatMap((index) => queryComparisonAttention({ index })),
    ];
    publish(mergeDeduplicateAndSortAttention(items));
  }

  function schedule(): void {
    if (disposed) return;
    const mine = ++token;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void recompute(mine);
    }, debounceMs);
  }

  function scheduleIfVisible(): void {
    if (deps.isDocumentHidden?.()) return;
    schedule();
  }

  return {
    async start() {
      if (disposed) return snapshot;
      if (deps.subscribeComparisons)
        unsubscribers.push(deps.subscribeComparisons(scheduleIfVisible));
      if (deps.subscribeRuns) unsubscribers.push(deps.subscribeRuns(scheduleIfVisible));
      if (deps.subscribeController)
        unsubscribers.push(deps.subscribeController(() => scheduleIfVisible()));
      if (deps.addBroadcastListener)
        unsubscribers.push(deps.addBroadcastListener(() => scheduleIfVisible()));
      if (deps.addVisibilityListener) unsubscribers.push(deps.addVisibilityListener(schedule));
      const mine = ++token;
      await recompute(mine);
      return snapshot;
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      for (const stop of unsubscribers) stop();
      unsubscribers.length = 0;
      listeners.clear();
    },
  };
}
