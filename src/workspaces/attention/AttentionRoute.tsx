import { useEffect, useState } from "react";
import {
  useEvaluationRepository,
  useRunRepository,
} from "../../lib/persistence/repository-context";
import { createAttentionService } from "../../lib/attention/attention-service";
import type { AttentionQueryResult } from "../../lib/attention/attention-query";
import { AttentionWorkspace } from "./AttentionWorkspace";

export function AttentionRoute() {
  const evalRepo = useEvaluationRepository();
  const runRepo = useRunRepository();
  const [snapshot, setSnapshot] = useState<AttentionQueryResult | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!evalRepo) {
      setLoading(false);
      setError("Records index unavailable.");
      return;
    }
    const service = createAttentionService({
      listExperiments: () => evalRepo.listExperiments(),
      subscribeRuns: runRepo ? (listener) => runRepo.subscribe(listener) : undefined,
      addVisibilityListener: (listener) => {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      },
      isDocumentHidden: () => document.hidden,
    });
    const stop = service.subscribe((next) => {
      setSnapshot(next);
      setLoading(false);
      setError(null);
    });
    void service
      .start()
      .then((next) => {
        setSnapshot(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Attention query failed.");
        setLoading(false);
      });
    return () => {
      stop();
      service.dispose();
    };
  }, [evalRepo, runRepo]);

  return <AttentionWorkspace snapshot={snapshot} loading={loading} error={error} />;
}
