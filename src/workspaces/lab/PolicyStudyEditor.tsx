// =============================================================================
// PolicyStudyEditor — the routed draft editor for a Policy Study (Fable §10).
//
// A draft is created upstream (Lab list, Task Set handoff, or confirmation
// handoff) and edited here in place. The dossier skeleton shows only the
// identity header plus a six-part Define Inputs form:
//
//   1. Title & question (the only free text)
//   2. Workload — exact Task Set Version picker (manifest digest shown)
//   3. Model Pool — exact pool version picker + inline New Model Pool dialog
//   4. Fusion Recipes — multi-select of exact recipe versions
//   5. Judges & Rubric — two blind exact-configuration pickers (Judge 1/2,
//      anti-circularity enforced) + rubric version picker
//   6. Protocol & claim plan — fixed four policies (Decision D2), predeclared
//      MPID display, claim plan radio cards
//
// Every edit persists through the StudyRepository CAS revision counter
// ("Saved · revision N"). Sealing opens a DialogSurface confirmation that
// restates every pinned ref with digests; "Seal & start" is the paid
// execution boundary — zero provider calls occur before it.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type { LabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import type { StudyRepository } from "../../lib/persistence/study-repository";
import type {
  EvaluationRubric,
  EvaluationSuite,
  RubricVersionRef,
} from "../../lib/evaluations/evaluation-types";
import { computeProtocolFingerprint } from "../../lib/evaluations/protocol-fingerprint";
import type { CriticRef } from "../../lib/providers/types";
import type {
  ExactModelConfigurationRef,
  PolicyStudyDefinition,
  PolicyStudyRecord,
} from "../../lib/studies/policy/policy-study-types";
import { ClaimBadge } from "../../ui/ClaimBadge";
import { DialogSurface } from "../../ui/DialogSurface";
import { KindEyebrow } from "../../ui/KindEyebrow";
import { StatusMark } from "../../ui/StatusMark";
import { ModelPoolForm } from "./ModelPoolForm";
import {
  PLACEHOLDER_MC_1,
  PLACEHOLDER_MC_2,
  PREDECLARED_MPID,
  exactModelConfigRefFor,
} from "./lab-draft";

// --- Option models ---------------------------------------------------------------

interface WorkloadOption {
  key: string;
  taskSetId: string;
  taskSetName: string;
  version: number;
  current: boolean;
}

interface PoolOption {
  key: string;
  poolId: string;
  poolName: string;
  version: number;
  digest: string;
  configCount: number;
}

interface RecipeOption {
  key: string;
  recipeId: string;
  recipeName: string;
  version: number;
  digest: string;
  synthesizer: CriticRef;
}

interface RubricOption {
  key: string;
  rubricId: string;
  rubricName: string;
  version: number;
}

interface JudgeOption {
  key: string;
  label: string;
  ref: ExactModelConfigurationRef;
}

interface FieldError {
  field: "title" | "workload" | "pool" | "recipes" | "judges" | "rubric" | "freshness";
  message: string;
}

// --- Helpers -------------------------------------------------------------------

function criticKey(critic: CriticRef): string {
  return `${critic.providerId}:${critic.model}`;
}

function shortDigest(digest: string): string {
  const hex = digest.startsWith("sha256:") ? digest.slice(7) : digest;
  return `${hex.slice(0, 8)}…`;
}

function shortMc(id: string): string {
  const hex = id.startsWith("mc:sha256:") ? id.slice(10) : id;
  return `mc:${hex.slice(0, 8)}…`;
}

/** Judge choices come from the pinned Task Set roster: its default judge plus
 *  every enabled model slot, deduplicated by provider/model identity. */
function judgeOptionsFor(suite: EvaluationSuite | null): JudgeOption[] {
  if (!suite) return [];
  const critics: CriticRef[] = [suite.defaultJudge];
  for (const slot of suite.modelSlots) {
    if (slot.enabled) critics.push({ providerId: slot.providerId, model: slot.model });
  }
  const seen = new Set<string>();
  const options: JudgeOption[] = [];
  for (const critic of critics) {
    if (critic.model.trim().length === 0) continue;
    const key = criticKey(critic);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ key, label: key, ref: exactModelConfigRefFor(critic) });
  }
  return options;
}

// --- Component -----------------------------------------------------------------

export interface PolicyStudyEditorProps {
  studyRepo: StudyRepository | null;
  evalRepo?: EvaluationRepository | null;
  labAssetRepo?: LabAssetRepository | null;
  study: PolicyStudyRecord;
  /** Called after the seal dialog confirms and the draft transitions to
   *  in_progress (the paid-execution boundary). */
  onSealed?: (started: PolicyStudyRecord) => void;
  onDeleted?: () => void;
}

export function PolicyStudyEditor({
  studyRepo,
  evalRepo = null,
  labAssetRepo = null,
  study,
  onSealed,
  onDeleted,
}: PolicyStudyEditorProps) {
  const [title, setTitle] = useState(study.title);
  const [def, setDef] = useState<PolicyStudyDefinition>(study.definition);
  const [revision, setRevision] = useState(study.revision);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sealErrors, setSealErrors] = useState<FieldError[]>([]);
  const [sealOpen, setSealOpen] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [poolDialogOpen, setPoolDialogOpen] = useState(false);

  const [suites, setSuites] = useState<EvaluationSuite[]>([]);
  const [workloadOptions, setWorkloadOptions] = useState<WorkloadOption[]>([]);
  const [poolOptions, setPoolOptions] = useState<PoolOption[]>([]);
  const [recipeOptions, setRecipeOptions] = useState<RecipeOption[]>([]);
  const [rubricOptions, setRubricOptions] = useState<RubricOption[]>([]);
  const [sourceStudy, setSourceStudy] = useState<PolicyStudyRecord | null>(null);
  const [sourceRecommendation, setSourceRecommendation] = useState<string | null>(null);

  const revisionRef = useRef(study.revision);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  // --- Option loading -----------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (evalRepo) {
        const suiteList = (await evalRepo.listSuites()).filter((s) => s.archivedAt === null);
        if (cancelled) return;
        setSuites(suiteList);
        const options: WorkloadOption[] = [];
        for (const suite of suiteList) {
          options.push({
            key: `${suite.id}@${suite.version}`,
            taskSetId: suite.id,
            taskSetName: suite.name,
            version: suite.version,
            current: true,
          });
          const materializations = await evalRepo.listTaskSetMaterializations(suite.id);
          if (cancelled) return;
          for (const m of materializations) {
            if (m.taskSetVersion === suite.version) continue;
            options.push({
              key: `${suite.id}@${m.taskSetVersion}`,
              taskSetId: suite.id,
              taskSetName: suite.name,
              version: m.taskSetVersion,
              current: false,
            });
          }
        }
        setWorkloadOptions(options);

        const rubricRecords = await evalRepo.listRubrics();
        if (cancelled) return;
        const rubrics: RubricOption[] = [];
        for (const record of rubricRecords) {
          if (record.archivedAt !== null) continue;
          for (let v = 1; v <= record.latestVersion; v++) {
            const rubric = await evalRepo.getRubricVersion(record.id, v);
            if (cancelled) return;
            if (!rubric) continue;
            rubrics.push({
              key: `${record.id}@${v}`,
              rubricId: record.id,
              rubricName: rubric.name,
              version: v,
            });
          }
        }
        setRubricOptions(rubrics);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [evalRepo]);

  const loadAssetOptions = async (cancelled: () => boolean) => {
    if (!labAssetRepo) return;
    const poolRecords = await labAssetRepo.listPoolRecords();
    if (cancelled()) return;
    const pools: PoolOption[] = [];
    for (const record of poolRecords) {
      if (record.archivedAt !== null) continue;
      const versions = await labAssetRepo.listPoolVersions(record.id);
      if (cancelled()) return;
      for (const version of versions) {
        pools.push({
          key: `${record.id}@${version.version}`,
          poolId: record.id,
          poolName: record.name,
          version: version.version,
          digest: version.digest,
          configCount: version.core.length + version.challengers.length,
        });
      }
    }
    setPoolOptions(pools);

    const recipeRecords = await labAssetRepo.listRecipeRecords();
    if (cancelled()) return;
    const recipes: RecipeOption[] = [];
    for (const record of recipeRecords) {
      if (record.archivedAt !== null) continue;
      const versions = await labAssetRepo.listRecipeVersions(record.id);
      if (cancelled()) return;
      for (const version of versions) {
        recipes.push({
          key: `${record.id}@${version.version}`,
          recipeId: record.id,
          recipeName: record.name,
          version: version.version,
          digest: version.digest,
          synthesizer: version.synthesizer,
        });
      }
    }
    setRecipeOptions(recipes);
  };

  useEffect(() => {
    let cancelled = false;
    void loadAssetOptions(() => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labAssetRepo]);

  // Confirmation lineage: load the source study + its inherited recommendation.
  useEffect(() => {
    let cancelled = false;
    if (!studyRepo || study.confirmationOf === null) return;
    void (async () => {
      const source = await studyRepo.getStudy(study.confirmationOf as string);
      if (cancelled || !source) return;
      setSourceStudy(source);
      const found = await studyRepo.getPlaybookForStudy(source.id);
      if (cancelled) return;
      const rec = found?.playbook.recommendation;
      setSourceRecommendation(
        rec?.kind === "adopt" ? `${rec.policy} · ${rec.configuration}` : null,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [studyRepo, study.confirmationOf]);

  // --- Derived state -------------------------------------------------------------

  const pinnedSuite = useMemo(
    () => suites.find((s) => s.id === def.workload.taskSetId) ?? null,
    [suites, def.workload.taskSetId],
  );
  const judgeOptions = useMemo(() => judgeOptionsFor(pinnedSuite), [pinnedSuite]);
  const selectedRecipeKeys = new Set(
    def.fusionRecipes.map((r) => `${r.recipeId}@${r.version}`),
  );
  const selectedRecipes = recipeOptions.filter((o) => selectedRecipeKeys.has(o.key));
  const synthesizerKeys = new Set(selectedRecipes.map((o) => criticKey(o.synthesizer)));
  const synthesizerMcIds = new Set(
    selectedRecipes.map((o) => exactModelConfigRefFor(o.synthesizer).id),
  );
  const judge2Options = judgeOptions.filter(
    (o) => !synthesizerKeys.has(o.key) && o.ref.id !== def.judge1.id,
  );
  const judge1Options = judgeOptions.filter((o) => !synthesizerKeys.has(o.key));
  const selectedPool = poolOptions.find(
    (o) => o.poolId === def.modelPool.poolId && o.version === def.modelPool.version,
  );
  const isConfirmation = def.claimPlan === "confirmation";

  // --- CAS persistence -----------------------------------------------------------

  function persist(nextDef: PolicyStudyDefinition, nextTitle: string) {
    if (!studyRepo) return;
    if (nextTitle.trim().length === 0) return; // blank titles stay local; seal validation flags them
    chainRef.current = chainRef.current
      .then(async () => {
        const nextRevision = await studyRepo.updateDraftStudy(
          study.id,
          revisionRef.current,
          { definition: nextDef, title: nextTitle },
          Date.now(),
        );
        revisionRef.current = nextRevision;
        setRevision(nextRevision);
        setSaveError(null);
      })
      .catch((err: unknown) => {
        setSaveError(err instanceof Error ? err.message : "Failed to save the draft.");
      });
  }

  function applyChange(nextDef: PolicyStudyDefinition, nextTitle: string) {
    setDef(nextDef);
    setTitle(nextTitle);
    persist(nextDef, nextTitle);
  }

  // --- Field handlers -------------------------------------------------------------

  async function handleWorkloadChange(key: string) {
    const option = workloadOptions.find((o) => o.key === key);
    if (!option || !evalRepo) return;
    const suite = suites.find((s) => s.id === option.taskSetId);
    if (!suite) return;
    let manifestDigest: string | null = null;
    const materializations = await evalRepo.listTaskSetMaterializations(suite.id);
    const materialized = materializations.find((m) => m.taskSetVersion === option.version);
    if (materialized) {
      manifestDigest = materialized.protocolFingerprint;
    } else if (option.version === suite.version) {
      const refs: RubricVersionRef[] = [];
      if (suite.defaultEvaluation.kind === "profile") refs.push(suite.defaultEvaluation.profile);
      for (const task of suite.tasks) {
        if (task.evaluation.kind === "profile") refs.push(task.evaluation.profile);
      }
      const unique = new Map(refs.map((r) => [`${r.id}@${r.version}`, r]));
      const rubrics: EvaluationRubric[] = [];
      for (const ref of unique.values()) {
        const rubric = await evalRepo.getRubricVersion(ref.id, ref.version);
        if (rubric) rubrics.push(rubric);
      }
      manifestDigest = computeProtocolFingerprint(suite, rubrics);
    }
    if (!manifestDigest) return; // no honest digest for this version — do not pin
    applyChange(
      {
        ...def,
        workload: {
          taskSetId: option.taskSetId,
          version: option.version,
          manifestDigest,
        },
      },
      title,
    );
  }

  function handlePoolChange(key: string) {
    const option = poolOptions.find((o) => o.key === key);
    if (!option) return;
    applyChange(
      {
        ...def,
        modelPool: { poolId: option.poolId, version: option.version, digest: option.digest },
      },
      title,
    );
  }

  function handleRecipeToggle(option: RecipeOption, checked: boolean) {
    const current = def.fusionRecipes.filter((r) => r.recipeId !== "unspecified");
    const next = checked
      ? [...current, { recipeId: option.recipeId, version: option.version, digest: option.digest }]
      : current.filter((r) => !(r.recipeId === option.recipeId && r.version === option.version));
    if (next.length === 0) {
      // Structural validity requires ≥1 recipe; keep the placeholder so the
      // draft stays persistable and seal validation reports the gap.
      applyChange({ ...def, fusionRecipes: def.fusionRecipes.filter((r) => r.recipeId === "unspecified").length > 0
        ? def.fusionRecipes.filter((r) => r.recipeId === "unspecified")
        : [{ recipeId: "unspecified", version: 1, digest: def.fusionRecipes[0]?.digest ?? "" }] }, title);
      return;
    }
    applyChange({ ...def, fusionRecipes: next }, title);
  }

  function handleRubricChange(key: string) {
    const option = rubricOptions.find((o) => o.key === key);
    if (!option) return;
    applyChange(
      { ...def, rubric: { rubricId: option.rubricId, version: option.version } },
      title,
    );
  }

  // --- Validation -------------------------------------------------------------------

  function validate(): FieldError[] {
    const errors: FieldError[] = [];
    if (title.trim().length === 0) {
      errors.push({ field: "title", message: "A title is required." });
    }
    if (def.workload.taskSetId === "unspecified") {
      errors.push({ field: "workload", message: "Pin an exact Task Set Version." });
    }
    if (def.modelPool.poolId === "unspecified") {
      errors.push({ field: "pool", message: "Pin a Model Pool version." });
    }
    if (
      def.fusionRecipes.length === 0 ||
      def.fusionRecipes.some((r) => r.recipeId === "unspecified")
    ) {
      errors.push({ field: "recipes", message: "Select at least one Fusion Recipe version." });
    }
    if (def.judge1.id === PLACEHOLDER_MC_1) {
      errors.push({ field: "judges", message: "Pin Judge 1 (exact model configuration)." });
    }
    if (def.judge2.id === PLACEHOLDER_MC_2) {
      errors.push({ field: "judges", message: "Pin Judge 2 (exact model configuration)." });
    }
    if (
      def.judge1.id !== PLACEHOLDER_MC_1 &&
      def.judge2.id !== PLACEHOLDER_MC_2 &&
      def.judge1.id === def.judge2.id
    ) {
      errors.push({ field: "judges", message: "Judge 1 and Judge 2 must differ." });
    }
    if (synthesizerMcIds.has(def.judge1.id) || synthesizerMcIds.has(def.judge2.id)) {
      errors.push({
        field: "judges",
        message: "Judges must differ from every recipe synthesizer.",
      });
    }
    if (def.rubric.rubricId === "unspecified") {
      errors.push({ field: "rubric", message: "Pin a Rubric version." });
    }
    if (
      isConfirmation &&
      sourceStudy !== null &&
      def.workload.taskSetId === sourceStudy.definition.workload.taskSetId &&
      def.workload.version === sourceStudy.definition.workload.version
    ) {
      errors.push({
        field: "freshness",
        message:
          "Confirmation requires a fresh Task Set Version that differs from the source study's pinned version.",
      });
    }
    return errors;
  }

  const fieldError = (field: FieldError["field"]) =>
    sealErrors.find((e) => e.field === field)?.message ?? null;

  // --- Seal / delete -----------------------------------------------------------------

  function handleSealPress() {
    const errors = validate();
    setSealErrors(errors);
    if (errors.length === 0) setSealOpen(true);
  }

  async function handleConfirmSeal() {
    if (!studyRepo) return;
    setSealing(true);
    try {
      await studyRepo.startStudy(study.id, revisionRef.current, Date.now());
      const saved = await studyRepo.getStudy(study.id);
      setSealOpen(false);
      if (saved) onSealed?.(saved);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to seal the study.");
    } finally {
      setSealing(false);
    }
  }

  async function handleDelete() {
    if (!studyRepo) return;
    try {
      await studyRepo.deleteStudy(study.id, revisionRef.current);
      onDeleted?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to delete the draft.");
    }
  }

  // --- Render -------------------------------------------------------------------------

  const fieldsetClass = "flex flex-col gap-2 rounded-md border border-edge bg-panel p-3";
  const legendClass =
    "font-mono text-xs font-semibold uppercase tracking-wider text-text-muted";
  const selectClass =
    "min-h-[44px] w-full rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const inlineError = (message: string | null) =>
    message === null ? null : (
      <p className="flex items-center gap-1 text-xs text-error">
        <AlertTriangle size={12} aria-hidden="true" />
        {message}
      </p>
    );

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="policy-study-editor">
      {/* Identity header */}
      <header className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <KindEyebrow kind="study" />
          <ClaimBadge level={study.claimLevel} />
          <StatusMark status="draft" />
        </div>
        <h1 className="text-lg font-semibold text-text">Define this Policy Study</h1>
        <p className="font-mono text-xs text-text-muted">
          {study.id} · schema v{study.definitionSchemaVersion}
        </p>
        {study.confirmationOf !== null && (
          <p className="font-mono text-xs">
            <a
              href={`#/lab/studies/${study.confirmationOf}`}
              className="text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Confirms {study.confirmationOf} →
            </a>
          </p>
        )}
      </header>

      {/* 1. Title & question */}
      <fieldset className={fieldsetClass}>
        <legend className={legendClass}>1 · Title &amp; question</legend>
        <input
          type="text"
          aria-label="Title & research question"
          value={title}
          onChange={(e) => applyChange(def, e.target.value)}
          placeholder="What should this study decide?"
          className="min-h-[44px] w-full rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {inlineError(fieldError("title"))}
      </fieldset>

      {/* 2. Workload */}
      <fieldset className={fieldsetClass}>
        <legend className={legendClass}>2 · Workload</legend>
        <select
          aria-label="Task Set Version"
          value={
            def.workload.taskSetId === "unspecified"
              ? ""
              : `${def.workload.taskSetId}@${def.workload.version}`
          }
          onChange={(e) => void handleWorkloadChange(e.target.value)}
          className={selectClass}
        >
          <option value="" disabled>
            Select an exact Task Set Version
          </option>
          {workloadOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.taskSetName} · Task Set v{o.version}
              {o.current ? " (current)" : ""}
            </option>
          ))}
        </select>
        {def.workload.taskSetId !== "unspecified" && (
          <p className="font-mono text-xs text-text-muted">
            manifest {shortDigest(def.workload.manifestDigest)}
          </p>
        )}
        {inlineError(fieldError("workload"))}
        {inlineError(fieldError("freshness"))}
      </fieldset>

      {/* 3. Model Pool */}
      <fieldset className={fieldsetClass}>
        <legend className={legendClass}>3 · Model Pool</legend>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Model Pool"
            value={
              def.modelPool.poolId === "unspecified"
                ? ""
                : `${def.modelPool.poolId}@${def.modelPool.version}`
            }
            onChange={(e) => handlePoolChange(e.target.value)}
            className={`${selectClass} min-w-0 flex-1`}
          >
            <option value="" disabled>
              Select a pool version
            </option>
            {poolOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.poolName} · Pool v{o.version} · {o.configCount} configs
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setPoolDialogOpen(true)}
            disabled={!labAssetRepo}
            className="flex min-h-[44px] min-w-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Plus size={14} aria-hidden="true" />
            New Model Pool
          </button>
        </div>
        {selectedPool && (
          <p className="font-mono text-xs text-text-muted">digest {shortDigest(selectedPool.digest)}</p>
        )}
        {inlineError(fieldError("pool"))}
      </fieldset>

      {/* 4. Fusion Recipes */}
      <fieldset className={fieldsetClass}>
        <legend className={legendClass}>4 · Fusion Recipes</legend>
        <div className="flex flex-wrap gap-2">
          {recipeOptions.length === 0 && (
            <p className="text-sm text-text-secondary">
              No Fusion Recipes in the Lab yet — create one under Recipes first.
            </p>
          )}
          {recipeOptions.map((o) => {
            const checked = selectedRecipeKeys.has(o.key);
            return (
              <label
                key={o.key}
                data-testid={`recipe-option-${o.recipeId}-v${o.version}`}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border px-3 text-sm focus-within:ring-2 focus-within:ring-accent ${
                  checked
                    ? "border-accent/50 bg-accent/5 text-text"
                    : "border-edge bg-panel text-text-secondary"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => handleRecipeToggle(o, e.target.checked)}
                  className="accent-current"
                />
                {o.recipeName} v{o.version}
              </label>
            );
          })}
        </div>
        {inlineError(fieldError("recipes"))}
      </fieldset>

      {/* 5. Judges & Rubric */}
      <fieldset className={fieldsetClass}>
        <legend className={legendClass}>5 · Judges &amp; Rubric</legend>
        <p className="text-xs text-text-secondary">
          Judges are blind: candidate identities stay hidden until judging completes. Judge
          choices come from the pinned Task Set roster.
        </p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <select
              aria-label="Judge 1"
              value={def.judge1.id === PLACEHOLDER_MC_1 ? "" : def.judge1.id}
              onChange={(e) => {
                const option = judge1Options.find((o) => o.ref.id === e.target.value);
                if (option) applyChange({ ...def, judge1: option.ref }, title);
              }}
              disabled={judge1Options.length === 0}
              className={selectClass}
            >
              <option value="" disabled>
                {pinnedSuite ? "Select Judge 1" : "Pin a Task Set Version first"}
              </option>
              {judge1Options.map((o) => (
                <option key={o.key} value={o.ref.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="font-mono text-xs text-text-muted">Judge 1 · blind</span>
          </div>
          <div className="flex flex-col gap-1">
            <select
              aria-label="Judge 2"
              value={def.judge2.id === PLACEHOLDER_MC_2 ? "" : def.judge2.id}
              onChange={(e) => {
                const option = judge2Options.find((o) => o.ref.id === e.target.value);
                if (option) applyChange({ ...def, judge2: option.ref }, title);
              }}
              disabled={judge2Options.length === 0}
              className={selectClass}
            >
              <option value="" disabled>
                {pinnedSuite ? "Select Judge 2" : "Pin a Task Set Version first"}
              </option>
              {judge2Options.map((o) => (
                <option key={o.key} value={o.ref.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="font-mono text-xs text-text-muted">Judge 2 · blind</span>
          </div>
        </div>
        <select
          aria-label="Rubric"
          value={
            def.rubric.rubricId === "unspecified" ? "" : `${def.rubric.rubricId}@${def.rubric.version}`
          }
          onChange={(e) => handleRubricChange(e.target.value)}
          className={selectClass}
        >
          <option value="" disabled>
            Select a Rubric version
          </option>
          {rubricOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.rubricName} · Rubric v{o.version}
            </option>
          ))}
        </select>
        {inlineError(fieldError("judges"))}
        {inlineError(fieldError("rubric"))}
      </fieldset>

      {/* 6. Protocol & claim plan */}
      <fieldset className={fieldsetClass}>
        <legend className={legendClass}>6 · Protocol &amp; claim plan</legend>
        <div className="flex flex-wrap gap-2">
          {(["Best fixed", "Rank", "Fuse", "Refine"] as const).map((policy) => (
            <span
              key={policy}
              className="rounded-sm border border-edge bg-panel px-2 py-1 text-xs text-text-secondary"
            >
              {policy}
            </span>
          ))}
        </div>
        <p className="text-xs text-text-secondary">
          All four policies are compared — fixed protocol. MPID {PREDECLARED_MPID.toFixed(1)}{" "}
          (predeclared) · stage protocol v{def.stageProtocolVersion} · protocol{" "}
          <span className="font-mono">{shortDigest(def.protocolFingerprint)}</span>
        </p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2" role="radiogroup" aria-label="Claim plan">
          <label
            data-testid="claim-plan-exploration"
            className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-md border border-dashed border-warning/50 bg-warning/10 p-3 text-sm ${
              isConfirmation ? "cursor-not-allowed opacity-60" : ""
            }`}
          >
            <input
              type="radio"
              name="claim-plan"
              checked={!isConfirmation}
              disabled={isConfirmation}
              readOnly
              className="mt-1 accent-current"
            />
            <span>
              <span className="font-semibold text-warning">Exploration</span>
              <span className="block text-xs text-text-secondary">
                Find whether a policy is worth confirming. Findings will be marked Exploratory.
              </span>
              {isConfirmation && (
                <span className="block text-xs text-text-muted">
                  This draft is a confirmation study — the claim plan is fixed.
                </span>
              )}
            </span>
          </label>
          <label
            data-testid="claim-plan-confirmation"
            className={`flex min-h-[44px] items-start gap-2 rounded-md border border-solid border-success/50 bg-success/10 p-3 text-sm ${
              study.confirmationOf === null ? "cursor-not-allowed opacity-60" : ""
            }`}
          >
            <input
              type="radio"
              name="claim-plan"
              checked={isConfirmation}
              disabled={study.confirmationOf === null}
              readOnly
              className="mt-1 accent-current"
            />
            <span>
              <span className="font-semibold text-success">Confirmation</span>
              <span className="block text-xs text-text-secondary">
                Confirm an exploratory finding on a fresh Task Set Version. Findings will be
                marked Confirmed.
              </span>
              {study.confirmationOf === null && (
                <span className="block text-xs text-text-muted">
                  Requires a completed exploratory study — start one from its playbook.
                </span>
              )}
              {isConfirmation && sourceRecommendation !== null && (
                <span className="mt-1 block font-mono text-xs text-text-muted">
                  Inherited: {sourceRecommendation}
                </span>
              )}
            </span>
          </label>
        </div>
      </fieldset>

      {/* Footer bar */}
      <div className="sticky bottom-0 z-10 flex flex-col gap-2 rounded-md border border-edge bg-panel p-3 md:static">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-xs text-text-secondary">
            {saveError ? `Save failed — ${saveError}` : `Saved · revision ${revision}`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {revision === 0 && (
              <button
                type="button"
                data-action="delete-draft"
                onClick={() => void handleDelete()}
                className="min-h-[44px] min-w-[44px] rounded-md border border-edge bg-panel px-3 text-sm text-error hover:border-edge-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Delete draft
              </button>
            )}
            <button
              type="button"
              data-action="seal-study"
              onClick={handleSealPress}
              className="min-h-[44px] min-w-[44px] rounded-md bg-accent px-3 text-sm font-semibold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Seal inputs &amp; start study
            </button>
          </div>
        </div>
        {sealErrors.length > 0 && (
          <ul data-testid="seal-requirements" className="flex flex-col gap-1 text-xs text-error">
            {sealErrors.map((e) => (
              <li key={e.message} className="flex items-center gap-1">
                <AlertTriangle size={12} aria-hidden="true" />
                {e.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Seal confirmation dialog */}
      <DialogSurface
        open={sealOpen}
        onOpenChange={setSealOpen}
        title="Seal inputs & start study"
        className="max-w-lg"
      >
        <div className="flex flex-col gap-3 p-6">
          <h2 className="text-base font-semibold text-text">Seal inputs &amp; start study</h2>
          <div className="flex items-center gap-2">
            <ClaimBadge level={study.claimLevel} />
            <span className="text-xs text-text-secondary">
              claim plan: {def.claimPlan}
            </span>
          </div>
          <dl className="flex flex-col gap-1 font-mono text-xs text-text-secondary">
            <div className="flex justify-between gap-2">
              <dt>Task Set</dt>
              <dd>
                {def.workload.taskSetId} v{def.workload.version} · {shortDigest(def.workload.manifestDigest)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Model Pool</dt>
              <dd>
                {def.modelPool.poolId} v{def.modelPool.version} · {shortDigest(def.modelPool.digest)}
              </dd>
            </div>
            {def.fusionRecipes.map((r) => (
              <div key={`${r.recipeId}@${r.version}`} className="flex justify-between gap-2">
                <dt>Recipe</dt>
                <dd>
                  {r.recipeId} v{r.version} · {shortDigest(r.digest)}
                </dd>
              </div>
            ))}
            <div className="flex justify-between gap-2">
              <dt>Judges</dt>
              <dd>
                {shortMc(def.judge1.id)} · {shortMc(def.judge2.id)} (blind)
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Rubric</dt>
              <dd>
                {def.rubric.rubricId} v{def.rubric.version}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Protocol</dt>
              <dd>{shortDigest(def.protocolFingerprint)}</dd>
            </div>
          </dl>
          <p className="text-xs text-text-secondary">
            Estimated experimental cost: ~{pinnedSuite?.tasks.length ?? 0} tasks ×{" "}
            {selectedPool?.configCount ?? 0} pool configurations across four policies{" "}
            <em>(estimate)</em>.
          </p>
          <p className="text-sm font-medium text-text">
            Sealing is permanent. Treatment changes after this point create new trials — the
            definition can never be edited.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {/* Cancel is first in DOM order so initial focus lands on it, not
                on the paid action. */}
            <button
              type="button"
              data-action="cancel-seal"
              onClick={() => setSealOpen(false)}
              className="min-h-[44px] min-w-[44px] rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              data-action="confirm-seal"
              disabled={sealing}
              onClick={() => void handleConfirmSeal()}
              className="min-h-[44px] min-w-[44px] rounded-md bg-accent px-3 text-sm font-semibold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Seal &amp; start
            </button>
          </div>
        </div>
      </DialogSurface>

      {/* Inline New Model Pool affordance (§7.2 dialog) */}
      {labAssetRepo && (
        <ModelPoolForm
          labAssetRepo={labAssetRepo}
          open={poolDialogOpen}
          onOpenChange={setPoolDialogOpen}
          onCreated={() => void loadAssetOptions(() => false)}
        />
      )}
    </div>
  );
}
