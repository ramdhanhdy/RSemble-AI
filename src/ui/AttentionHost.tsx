import { useEffect, useState } from "react";
import { useEvaluationRepository, useRunRepository } from "../lib/persistence/repository-context";
import { createAttentionService } from "../lib/attention/attention-service";
import type { AttentionQueryResult } from "../lib/attention/attention-query";
import { AttentionPopover } from "./AttentionPopover";

const EMPTY: AttentionQueryResult = {
  items: [],
  visible: [],
  total: 0,
  overflowLabel: null,
};

export function AttentionHost({ snapshot }: { snapshot?: AttentionQueryResult }) {
  const evalRepo = useEvaluationRepository();
  const runRepo = useRunRepository();
  const [live, setLive] = useState<AttentionQueryResult>(EMPTY);

  useEffect(() => {
    if (snapshot || !evalRepo) return;
    const service = createAttentionService({
      listExperiments: () => evalRepo.listExperiments(),
      subscribeRuns: runRepo ? (listener) => runRepo.subscribe(listener) : undefined,
      addVisibilityListener: (listener) => {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      },
      isDocumentHidden: () => document.hidden,
    });
    const stop = service.subscribe(setLive);
    void service.start().then(setLive);
    return () => {
      stop();
      service.dispose();
    };
  }, [evalRepo, runRepo, snapshot]);

  return <AttentionPopover snapshot={snapshot ?? live} />;
}
