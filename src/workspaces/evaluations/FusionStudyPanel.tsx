// =============================================================================
// FusionStudyPanel — Fusion Study section inside the suite editor.
//
// Lists the suite's Fusion Studies (claim level + status), creates new
// exploration studies (pool manifest from the suite roster, Judge 1 from the
// suite default, Judge 2 picked by the user, the three built-in v1 recipes),
// and runs them end-to-end through the orchestration driver. Every route
// stays under Evaluations — no new top-level navigation (spec §9).
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, FlaskConical, Play } from "lucide-react";
import type { FusionStudyRepository } from "../../lib/persistence/fusion-study-repository";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type {
  EvaluationSuite,
  EvaluationProfileSnapshot,
} from "../../lib/evaluations/evaluation-types";
import type { CatalogModel, CriticRef } from "../../lib/providers/types";
import type { FusionStudy, PoolManifestVersion } from "../../lib/evaluations/fusion-study-types";
import { BUILTIN_FUSION_RECIPES } from "../../lib/evaluations/fusion-recipes";
import { computeProtocolFingerprint } from "../../lib/evaluations/protocol-fingerprint";
import type {
  EvaluationProfile,
  EvaluationProfileRef,
} from "../../lib/evaluations/evaluation-types";
import {
  validateJudgePair,
  validatePoolManifest,
  validateStudy,
} from "../../lib/evaluations/fusion-study-validation";
import {
  createFusionStudyController,
  type FusionPolicyExecutor,
} from "../../lib/evaluations/fusion-study-controller";
import { createLiveFusionExecutor } from "../../lib/evaluations/fusion-live-executor";
import {
  DEFAULT_SHORTLIST_RULE,
  runFusionStudy,
} from "../../lib/evaluations/fusion-study-orchestration";
import { runConfirmationStudy } from "../../lib/evaluations/fusion-confirmation";
import { ClaimBadge } from "./FusionStudyView";

export interface FusionStudyPanelProps {
  fusionRepo: FusionStudyRepository | null;
  evalRepo: EvaluationRepository | null;
  suite: EvaluationSuite;
  models: CatalogModel[];
  /** Test seam: inject a mock executor instead of live providers. */
  executor?: FusionPolicyExecutor;
}

export function FusionStudyPanel({
  fusionRepo,
  evalRepo,
  suite,
  models,
  executor,
}: FusionStudyPanelProps) {
  const [studies, setStudies] = useState<FusionStudy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createErrors, setCreateErrors] = useState<string[]>([]);
  const [judge2Key, setJudge2Key] = useState<string>("");
  const [busyStudyId, setBusyStudyId] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!fusionRepo) return;
    void fusionRepo
      .listStudies(suite.id)
      .then(setStudies)
      .catch(() => setError("Failed to load studies."));
  }, [fusionRepo, suite.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const enabledSlots = suite.modelSlots.filter((s) => s.enabled);
  const poolReady = enabledSlots.length >= 6;

  // Judge 2 must differ from Judge 1 AND from every synthesizer the study
  // will use (anti-circularity, spec §5.3) — the picker enforces this at
  // creation time so trials never fail the seal check after spend.
  const synthesizerKeys = new Set(
    BUILTIN_FUSION_RECIPES.map((r) => `${r.synthesizer.providerId}:${r.synthesizer.model}`),
  );
  const judge2Options = models.filter(
    (m) =>
      !(m.providerId === suite.defaultJudge.providerId && m.id === suite.defaultJudge.model) &&
      !synthesizerKeys.has(`${m.providerId}:${m.id}`),
  );

  async function createStudy() {
    if (!fusionRepo) return;
    setCreateErrors([]);
    setError(null);
    try {
      const judge2Model =
        judge2Options.find((m) => `${m.providerId}:${m.id}` === judge2Key) ?? judge2Options[0];
      if (!judge2Model) {
        setCreateErrors([
          "A holdout judge (Judge 2) is required — configure a second judge model.",
        ]);
        return;
      }
      const judge2: CriticRef = { providerId: judge2Model.providerId, model: judge2Model.id };

      const core = enabledSlots.slice(0, 8);
      const challengers = enabledSlots.slice(8, 10);
      const poolId = `pool-${suite.id}`;
      const latest = await fusionRepo.getLatestPoolManifest(poolId);
      const manifest: PoolManifestVersion = {
        id: poolId,
        version: (latest?.version ?? 0) + 1,
        core,
        challengers,
        diversityChecklist: ["suite roster (predeclared)"],
        rationale: `Pool declared from suite ${suite.name} v${suite.version} roster.`,
        supersedesVersion: latest?.version ?? null,
        createdAt: Date.now(),
      };
      const poolValidation = validatePoolManifest(manifest);
      if (!poolValidation.valid) {
        setCreateErrors(poolValidation.errors.map((e) => e.message));
        return;
      }

      const fingerprint = await computeFingerprint();
      const study: FusionStudy = {
        id: `fusion-${crypto.randomUUID()}`,
        revision: 0,
        kind: "exploration",
        suiteRef: {
          suiteId: suite.id,
          suiteVersion: suite.version,
          protocolFingerprint: fingerprint,
        },
        poolRef: { id: manifest.id, version: manifest.version },
        judge1: suite.defaultJudge,
        judge2,
        recipeRefs: BUILTIN_FUSION_RECIPES.map((r) => ({ id: r.id, version: r.version })),
        stageResults: { stageA: null, stageB: null, stageC: null },
        playbookRef: null,
        claimLevel: "exploratory",
        confirmationOf: null,
        status: "in_progress",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const studyValidation = validateStudy(study);
      if (!studyValidation.valid) {
        setCreateErrors(studyValidation.errors.map((e) => e.message));
        return;
      }
      // Defense in depth: the picker already excludes synthesizers, but the
      // judge pair must pass the anti-circularity rule for every recipe.
      for (const recipe of BUILTIN_FUSION_RECIPES) {
        const pairValidation = validateJudgePair(study.judge1, study.judge2, recipe.synthesizer);
        if (!pairValidation.valid) {
          setCreateErrors(pairValidation.errors.map((e) => e.message));
          return;
        }
      }

      for (const recipe of BUILTIN_FUSION_RECIPES) {
        if (!(await fusionRepo.getRecipe(recipe.id, recipe.version))) {
          await fusionRepo.createRecipe(recipe);
        }
      }
      await fusionRepo.createPoolManifest(manifest);
      await fusionRepo.createStudy(study);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the study.");
    }
  }

  /** Protocol fingerprint over the suite and its pinned profiles (spec §11.1). */
  async function computeFingerprint(): Promise<string> {
    const refs: EvaluationProfileRef[] = [];
    if (suite.defaultEvaluation.kind === "profile") refs.push(suite.defaultEvaluation.profile);
    for (const task of suite.tasks) {
      if (task.evaluation.kind === "profile") refs.push(task.evaluation.profile);
    }
    const unique = new Map(refs.map((r) => [`${r.id}@${r.version}`, r]));
    const profiles: EvaluationProfile[] = [];
    if (evalRepo) {
      for (const ref of unique.values()) {
        const profile = await evalRepo.getProfile(ref.id, ref.version);
        if (profile) profiles.push(profile);
      }
    }
    return computeProtocolFingerprint(suite, profiles);
  }

  async function resolveProfile(): Promise<EvaluationProfileSnapshot | null> {
    if (!evalRepo) return null;
    if (suite.defaultEvaluation.kind === "profile") {
      return evalRepo.getProfile(
        suite.defaultEvaluation.profile.id,
        suite.defaultEvaluation.profile.version,
      );
    }
    return null;
  }

  /**
   * Confirmation lifecycle (spec §7.5): a completed exploratory study can be
   * confirmed only on a NEW suite version — the confirmation study evaluates
   * the preselected configuration on fresh tasks without re-selection.
   */
  async function confirmStudy(sourceStudy: FusionStudy) {
    if (!fusionRepo) return;
    setBusyStudyId(sourceStudy.id);
    setError(null);
    try {
      const controller = createFusionStudyController({ repo: fusionRepo });
      const exec = executor ?? createLiveFusionExecutor();
      const profile = await resolveProfile();
      const fingerprint = await computeFingerprint();
      const confirmation: FusionStudy = {
        id: `fusion-conf-${crypto.randomUUID()}`,
        revision: 0,
        kind: "confirmation",
        suiteRef: {
          suiteId: suite.id,
          suiteVersion: suite.version,
          protocolFingerprint: fingerprint,
        },
        poolRef: sourceStudy.poolRef,
        judge1: sourceStudy.judge1,
        judge2: sourceStudy.judge2,
        recipeRefs: sourceStudy.recipeRefs,
        stageResults: { stageA: null, stageB: null, stageC: null },
        playbookRef: null,
        claimLevel: "exploratory",
        confirmationOf: sourceStudy.id,
        status: "in_progress",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await fusionRepo.createStudy(confirmation);
      await runConfirmationStudy(
        { controller, executor: exec, repo: fusionRepo },
        {
          sourceStudyId: sourceStudy.id,
          confirmationStudyId: confirmation.id,
          suite,
          profile,
          tasksPerPair: Math.min(3, suite.tasks.length),
          mpid: 0.2,
        },
      );
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The confirmation run failed.");
    } finally {
      setBusyStudyId(null);
    }
  }

  async function runStudy(studyId: string) {
    if (!fusionRepo) return;
    setBusyStudyId(studyId);
    setError(null);
    try {
      const controller = createFusionStudyController({ repo: fusionRepo });
      const exec = executor ?? createLiveFusionExecutor();
      const profile = await resolveProfile();
      await runFusionStudy(
        { controller, executor: exec, repo: fusionRepo },
        {
          studyId,
          suite,
          profile,
          stratificationTasks: 3,
          tasksPerPairA: 2,
          tasksPerPairB: Math.min(3, suite.tasks.length),
          tasksPerPairC: 2,
          shortlistRule: DEFAULT_SHORTLIST_RULE,
          sequentialPairs: 2,
          mpid: 0.2,
        },
      );
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The study run failed.");
    } finally {
      setBusyStudyId(null);
    }
  }

  return (
    <section aria-label="Fusion Study" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text">
          <FlaskConical size={14} className="text-accent" /> Fusion Study
        </h2>
        <button
          type="button"
          onClick={() => void createStudy()}
          disabled={!fusionRepo || !poolReady}
          title={
            poolReady
              ? "Create a Fusion Study on this suite version"
              : `Fusion Study requires 6–8 enabled models in the roster (${enabledSlots.length} enabled)`
          }
          className="min-h-[44px] rounded-md bg-accent/15 px-3 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          New study
        </button>
      </div>
      {!poolReady && (
        <p className="text-xs text-text-muted">
          Fusion Study needs a pool of 6–8 enabled models (plus up to 2 challengers); this suite has{" "}
          {enabledSlots.length} enabled.
        </p>
      )}
      {poolReady && judge2Options.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <span className="shrink-0">Judge 2 (holdout)</span>
          <select
            value={judge2Key || `${judge2Options[0].providerId}:${judge2Options[0].id}`}
            onChange={(e) => setJudge2Key(e.target.value)}
            className="min-h-[44px] min-w-0 flex-1 rounded-md border border-edge bg-panel px-2 text-xs text-text"
          >
            {judge2Options.map((m) => (
              <option key={`${m.providerId}:${m.id}`} value={`${m.providerId}:${m.id}`}>
                {m.name} ({m.providerId})
              </option>
            ))}
          </select>
        </label>
      )}
      {createErrors.length > 0 && (
        <ul
          className="flex flex-col gap-0.5 text-xs text-red-400"
          data-testid="fusion-create-errors"
        >
          {createErrors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {error && (
        <p className="flex items-center gap-1 text-xs text-red-400">
          <AlertCircle size={12} /> {error}
        </p>
      )}
      {studies === null ? (
        <p className="text-xs text-text-muted">Loading…</p>
      ) : studies.length === 0 ? (
        <p className="text-xs text-text-muted">
          No Fusion Studies yet. A study discovers which execution policy — best-fixed, Rank, Fuse,
          or Refine — fits this suite.
        </p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="fusion-study-list">
          {studies.map((study) => (
            <li
              key={study.id}
              className="flex items-center justify-between gap-2 rounded-md border border-edge/60 px-2 py-1.5"
            >
              <Link
                to={`/evaluations/${suite.id}/fusion/${study.id}`}
                className="flex min-w-0 items-center gap-2 text-sm text-text hover:text-accent"
              >
                <span className="truncate">Study · pool v{study.poolRef.version}</span>
                <ClaimBadge level={study.claimLevel} />
                <span className="text-xs text-text-muted">
                  {study.status === "completed" ? "Completed" : "In progress"}
                </span>
              </Link>
              {study.status !== "completed" && (
                <button
                  type="button"
                  onClick={() => void runStudy(study.id)}
                  disabled={busyStudyId !== null}
                  className="flex min-h-[44px] items-center gap-1 rounded-md bg-panel px-2 text-xs font-medium text-text-secondary hover:text-text disabled:opacity-50"
                >
                  <Play size={12} />
                  {busyStudyId === study.id ? "Running…" : "Run"}
                </button>
              )}
              {study.status === "completed" &&
                study.kind === "exploration" &&
                study.suiteRef.suiteVersion !== suite.version && (
                  <button
                    type="button"
                    onClick={() => void confirmStudy(study)}
                    disabled={busyStudyId !== null}
                    title={`Confirm on fresh tasks in suite v${suite.version} (no re-selection)`}
                    className="flex min-h-[44px] items-center gap-1 rounded-md bg-panel px-2 text-xs font-medium text-text-secondary hover:text-text disabled:opacity-50"
                  >
                    <Play size={12} />
                    {busyStudyId === study.id ? "Confirming…" : "Confirm"}
                  </button>
                )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
