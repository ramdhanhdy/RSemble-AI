// =============================================================================
// PolicyStudyPage — route controller for /lab/studies/:studyId.
//
// Loads the study, then dispatches: draft → PolicyStudyEditor (Fable §10);
// every other status → PolicyStudyView dossier (Fable §6/§6.12). Owns the
// tab-local execution session: sealing a draft starts the run immediately
// ("Seal & start"), a rejected run marks the study failed with the exact
// error, and an in-progress study without a live session renders the
// interrupted state with Resume.
//
// Unknown ids render the §6.12 not-found panel — never an empty skeleton.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, Loader2 } from "lucide-react";
import type { StudyRepository } from "../../lib/persistence/study-repository";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type { LabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import type { RunRepository } from "../../lib/persistence/run-repository";
import type { EvidenceRepository } from "../../lib/persistence/evidence-repository";
import {
  useEvaluationRepository,
  useEvidenceRepository,
  useLabAssetRepository,
  useRunRepository,
  useStudyRepository,
} from "../../lib/persistence/repository-context";
import { createLiveFusionExecutor } from "../../lib/evaluations/fusion-live-executor";
import { PolicyStudyAdapter } from "../../lib/studies/policy/policy-study-adapter";
import type { PolicyStudyRecord } from "../../lib/studies/policy/policy-study-types";
import type { CriticRef } from "../../lib/providers/types";
import { PREDECLARED_MPID, exactModelConfigRefFor } from "./lab-draft";
import { PolicyStudyEditor } from "./PolicyStudyEditor";
import {
  PolicyStudyView,
  type PolicyStudyRunner,
  type PolicyStudySessionPhase,
} from "./PolicyStudyView";

interface PolicyStudyPageProps {
  studyRepo?: StudyRepository | null;
  evalRepo?: EvaluationRepository | null;
  labAssetRepo?: LabAssetRepository | null;
  evidenceRepo?: EvidenceRepository | null;
  /** Test seam: inject a deterministic runner instead of the live adapter. */
  runner?: PolicyStudyRunner | null;
}

/**
 * Build the production runner over the PolicyStudyAdapter. Judge and
 * model-configuration resolution come from the pinned Task Set roster — the
 * same identity hashing the draft editor used to pin the judges, so the refs
 * round-trip exactly. No provider call happens before this runner is invoked
 * (the seal dialog is the paid-execution boundary).
 */
function createAdapterRunner(deps: {
  studyRepo: StudyRepository;
  labAssetRepo: LabAssetRepository;
  evalRepo: EvaluationRepository;
  runRepo: RunRepository | null;
}): PolicyStudyRunner {
  return {
    async run(study) {
      const def = study.definition;
      if (def.claimPlan === "confirmation") {
        throw new Error(
          "Confirmation execution requires the source study's in-session methodology state, which is not persisted; this confirmation study cannot be run from a cold session.",
        );
      }
      const suite = await deps.evalRepo.getSuite(def.workload.taskSetId);
      if (!suite) {
        throw new Error(`Task Set ${def.workload.taskSetId} is not available in this database.`);
      }
      const rubric =
        def.rubric.rubricId === "unspecified"
          ? null
          : await deps.evalRepo.getRubricVersion(def.rubric.rubricId, def.rubric.version);
      const roster: CriticRef[] = [
        suite.defaultJudge,
        ...suite.modelSlots.map((s) => ({ providerId: s.providerId, model: s.model })),
      ];
      const byMcId = new Map(roster.map((c) => [exactModelConfigRefFor(c).id, c] as const));
      const adapter = new PolicyStudyAdapter({
        studyRepo: deps.studyRepo,
        labAssetRepo: deps.labAssetRepo,
        judgeResolver: (ref) => {
          const found = byMcId.get(ref.id);
          if (!found) {
            throw new Error(
              `Judge configuration ${ref.id} is not on the pinned Task Set roster.`,
            );
          }
          return found;
        },
        executor: createLiveFusionExecutor(),
        modelConfigResolver: (critic) => exactModelConfigRefFor(critic),
        runResolver: deps.runRepo
          ? { getRun: (id) => deps.runRepo!.get(id) }
          : undefined,
      });
      const record = study.status === "in_progress" ? study : await adapter.startStudy(study);
      await adapter.runExplorationStudy({
        record,
        suite,
        rubric,
        stratificationTasks: 3,
        tasksPerPairA: 2,
        tasksPerPairB: Math.min(3, suite.tasks.length),
        tasksPerPairC: 2,
        sequentialPairs: 2,
        mpid: PREDECLARED_MPID,
      });
    },
  };
}

export function PolicyStudyPage({
  studyRepo: studyRepoProp,
  evalRepo: evalRepoProp,
  labAssetRepo: labAssetRepoProp,
  evidenceRepo: evidenceRepoProp,
  runner: runnerProp,
}: PolicyStudyPageProps) {
  const ctx = useStudyRepository();
  const ctxEval = useEvaluationRepository();
  const ctxAssets = useLabAssetRepository();
  const ctxEvidence = useEvidenceRepository();
  const ctxRuns = useRunRepository();
  const studyRepo = studyRepoProp !== undefined ? studyRepoProp : ctx;
  const evalRepo = evalRepoProp !== undefined ? evalRepoProp : ctxEval;
  const labAssetRepo = labAssetRepoProp !== undefined ? labAssetRepoProp : ctxAssets;
  const evidenceRepo = evidenceRepoProp !== undefined ? evidenceRepoProp : ctxEvidence;
  const navigate = useNavigate();
  const { studyId = "" } = useParams<{ studyId: string }>();
  const [study, setStudy] = useState<PolicyStudyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<PolicyStudySessionPhase>(null);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

  const runner =
    runnerProp !== undefined
      ? runnerProp
      : studyRepo && labAssetRepo && evalRepo
        ? createAdapterRunner({ studyRepo, labAssetRepo, evalRepo, runRepo: ctxRuns })
        : null;
  const runnerRef = useRef(runner);
  runnerRef.current = runner;

  const reload = useCallback(async () => {
    if (!studyRepo) return;
    const row = await studyRepo.getStudy(studyId);
    setStudy(row);
  }, [studyRepo, studyId]);

  useEffect(() => {
    let cancelled = false;
    if (!studyRepo) {
      setError("Study storage is unavailable.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setPhase(null);
    setFailureMessage(null);
    void studyRepo
      .getStudy(studyId)
      .then((row) => {
        if (!cancelled) setStudy(row);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load study.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studyId, studyRepo]);

  const startRun = useCallback(
    (target: PolicyStudyRecord) => {
      const active = runnerRef.current;
      if (!active || !studyRepo) return;
      setFailureMessage(null);
      setPhase("running");
      void active.run(target).then(
        () => {
          // The methodology sealed the study — reload reveals the dossier.
          setPhase(null);
          void reload();
        },
        (err: unknown) => {
          const message = err instanceof Error ? err.message : "The study run failed.";
          setPhase(null);
          setFailureMessage(message);
          void (async () => {
            try {
              const fresh = await studyRepo.getStudy(target.id);
              if (fresh && fresh.status === "in_progress") {
                await studyRepo.failStudy(target.id, fresh.revision, Date.now());
              }
            } catch {
              // The status transition is best-effort; the reload below shows
              // the repository's truth either way.
            }
            await reload();
          })();
        },
      );
    },
    [studyRepo, reload],
  );

  const archive = useCallback(async () => {
    if (!studyRepo || !study) return;
    try {
      await studyRepo.archiveStudy(study.id, study.revision, Date.now());
      await reload();
    } catch (err) {
      setFailureMessage(err instanceof Error ? err.message : "Failed to archive the study.");
    }
  }, [studyRepo, study, reload]);

  if (loading) {
    return (
      <div className="flex min-h-[140px] items-center justify-center gap-2 text-sm text-text-secondary">
        <Loader2 size={16} className="animate-spin-ease text-accent" aria-hidden="true" />
        Loading study…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center">
        <AlertCircle className="text-error" size={18} aria-hidden="true" />
        <p className="text-sm text-error">{error}</p>
      </div>
    );
  }

  if (!study) {
    return (
      <div className="flex flex-col gap-3 p-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Not found
        </p>
        <h1 className="text-lg font-semibold text-text">
          No policy study with id <span className="font-mono">{studyId}</span> exists in this
          database.
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/lab"
            className="flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Open Policy Studies
          </Link>
          <Link
            to="/runs"
            className="flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Search Records
          </Link>
        </div>
      </div>
    );
  }

  if (study.status === "draft") {
    return (
      <div className="flex flex-col gap-4">
        <nav className="text-xs text-text-secondary">
          <Link
            to="/lab"
            className="text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Lab
          </Link>
          {" / "}
          Policy Studies
        </nav>
        <PolicyStudyEditor
          studyRepo={studyRepo}
          evalRepo={evalRepo}
          labAssetRepo={labAssetRepo}
          study={study}
          onSealed={(started) => {
            setStudy(started);
            // "Seal & start" — the seal dialog is the paid-execution boundary;
            // the run begins immediately after it.
            startRun(started);
          }}
          onDeleted={() => void navigate("/lab")}
        />
      </div>
    );
  }

  return (
    <PolicyStudyView
      studyRepo={studyRepo}
      labAssetRepo={labAssetRepo}
      evalRepo={evalRepo}
      evidenceRepo={evidenceRepo}
      study={study}
      lifecycle={{
        phase,
        failureMessage,
        runnerAvailable: runner !== null,
        onResume: () => startRun(study),
        onInterrupt: () => setPhase("interrupted"),
        onArchive: () => void archive(),
      }}
    />
  );
}
