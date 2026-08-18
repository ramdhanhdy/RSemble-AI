// =============================================================================
// RSemble AI — Compare "Run with Policy Playbook" Picker + Preflight Dialog
// (spec §8, plan Task 10).
//
// Explicit-only semantics:
//   - Lists sealed playbooks against the current compare session;
//   - Evaluates compatibility (pool, workload, study lifecycle);
//   - Shows preflight card (recommended policy, claim level, policy vs baseline
//     cost, MPID 0.2, pool adequacy, scope statement);
//   - Only an explicit confirm button produces a run binding;
//   - Closing or cancelling never runs a playbook.
// =============================================================================

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, X } from "lucide-react";
import { DialogSurface } from "../../ui/DialogSurface";
import type { ModelSlot } from "../../studio-data";
import type { CriticRef } from "../../lib/providers/types";
import type { StudyRepository } from "../../lib/persistence/study-repository";
import type { LabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import type { TaskSetRepository } from "../../lib/persistence/task-set-repository";
import type { LabRecipeVersion } from "../../lib/studies/lab-recipe-types";
import type { ModelPoolVersion } from "../../lib/studies/model-pool-types";
import type {
  PolicyReportPayload,
  PolicyStudyRecord,
} from "../../lib/studies/policy/policy-study-types";
import {
  evaluatePlaybookCompatibility,
  modelConfigRefForIdentity,
  type PinnedTaskSetVersionView,
  type PlaybookCompatibilityOutcome,
} from "../../lib/studies/policy/playbook-compatibility";
import {
  estimatePlaybookCostPreflight,
  type PlaybookCostPreflight,
  type PlaybookRunBinding,
} from "../../lib/compare/playbook-execution";

const EMPTY_SLOTS: ModelSlot[] = [];

export interface RunWithPlaybookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studyRepo: StudyRepository;
  labAssetRepo: LabAssetRepository;
  taskSetRepo?: TaskSetRepository;
  slots?: ModelSlot[];
  candidateModelSlots?: ModelSlot[];
  critic: CriticRef;
  prompt: string;
  taskBinding?:
    | { kind: "canonical"; taskId: string; taskVersion?: number }
    | { kind: "ad_hoc"; inputSnapshotRef: string }
    | null;
  taskSetContext?: { taskSetId: string; version: number } | null;
  running?: boolean;
  onConfirmed: (binding: PlaybookRunBinding) => void;
}

interface LoadedPlaybookItem {
  study: PolicyStudyRecord;
  playbookId: string;
  playbook: PolicyReportPayload;
  pool: ModelPoolVersion | null;
  recipe: LabRecipeVersion | null;
  pinnedTaskSetVersion: PinnedTaskSetVersionView | null;
}

export function RunWithPlaybookDialog({
  open,
  onOpenChange,
  studyRepo,
  labAssetRepo,
  taskSetRepo,
  slots: rawSlots,
  candidateModelSlots,
  critic,
  prompt,
  taskBinding = null,
  taskSetContext = null,
  running = false,
  onConfirmed,
}: RunWithPlaybookDialogProps): React.ReactElement {
  const slots = useMemo(
    () => candidateModelSlots ?? rawSlots ?? EMPTY_SLOTS,
    [candidateModelSlots, rawSlots],
  );
  const [items, setItems] = useState<LoadedPlaybookItem[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Load completed studies and their playbooks
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);

    async function load() {
      try {
        const studies = await studyRepo.listStudies();
        const eligible = studies.filter(
          (s) =>
            s.status === "completed" ||
            (s.status as string) === "sealed" ||
            s.status === "archived",
        );

        const loaded: LoadedPlaybookItem[] = [];
        for (const study of eligible) {
          const playbookId = study.reportRef ?? `pb-${study.id}`;
          let playbook: PolicyReportPayload | null = null;
          if (study.reportRef) {
            playbook = await studyRepo.getPlaybook(study.reportRef);
          }
          if (!playbook) {
            const pbResult = await studyRepo.getPlaybookForStudy(study.id);
            playbook = pbResult ? pbResult.playbook : null;
          }
          if (!playbook) continue;

          let pool: ModelPoolVersion | null = null;
          try {
            pool = await labAssetRepo.getPoolVersion(
              study.definition.modelPool.poolId,
              study.definition.modelPool.version,
            );
          } catch {
            pool = null;
          }

          let recipe: LabRecipeVersion | null = null;
          const recipeRef = study.definition.fusionRecipes?.[0];
          if (recipeRef) {
            try {
              recipe = await labAssetRepo.getRecipeVersion(recipeRef.recipeId, recipeRef.version);
            } catch {
              recipe = null;
            }
          }

          let pinnedTaskSetVersion: PinnedTaskSetVersionView | null = null;
          if (taskSetRepo) {
            try {
              const tv = await taskSetRepo.getTaskSetVersion(
                study.definition.workload.taskSetId,
                study.definition.workload.version,
              );
              if (tv) {
                pinnedTaskSetVersion = {
                  taskSetId: tv.taskSetId,
                  version: tv.version,
                  members: tv.members.map((m) => ({
                    taskVersionRef: {
                      taskId: m.taskVersionRef.taskId,
                      taskVersion: m.taskVersionRef.version,
                    },
                  })),
                };
              }
            } catch {
              pinnedTaskSetVersion = null;
            }
          }

          loaded.push({
            study,
            playbookId,
            playbook,
            pool,
            recipe,
            pinnedTaskSetVersion,
          });
        }

        if (active) {
          setItems(loaded);
          if (loaded.length > 0) {
            setSelectedStudyId((prev) => prev ?? loaded[0].study.id);
          }
          setLoading(false);
        }
      } catch {
        if (active) {
          setItems([]);
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [open, studyRepo, labAssetRepo, taskSetRepo]);

  const selectedItem = useMemo(() => {
    return items.find((i) => i.study.id === selectedStudyId) ?? null;
  }, [items, selectedStudyId]);

  // Evaluate compatibility
  const compatibility: PlaybookCompatibilityOutcome | null = useMemo(() => {
    if (!selectedItem) return null;
    const enabledSlots = slots.filter((s) => s.enabled);
    const candidateConfigurations = enabledSlots.map((s) =>
      modelConfigRefForIdentity(s.providerId, s.model),
    );

    return evaluatePlaybookCompatibility({
      playbookId: selectedItem.playbookId,
      playbook: selectedItem.playbook,
      study: selectedItem.study,
      poolVersion: selectedItem.pool,
      pinnedTaskSetVersion: selectedItem.pinnedTaskSetVersion,
      candidateConfigurations,
      taskBinding,
      taskSetContext,
    });
  }, [selectedItem, slots, taskBinding, taskSetContext]);

  // Estimate cost preflight
  const costPreflight: PlaybookCostPreflight | null = useMemo(() => {
    if (!selectedItem) return null;
    return estimatePlaybookCostPreflight({
      prompt,
      slots,
      critic,
      recommendation: selectedItem.playbook.recommendation,
      synthesizer: selectedItem.recipe?.synthesizer ?? null,
      now: () => Date.now(),
    });
  }, [selectedItem, prompt, slots, critic]);

  const isSynthesis =
    selectedItem?.playbook.recommendation.kind === "adopt" &&
    (selectedItem.playbook.recommendation.policy === "fuse" ||
      selectedItem.playbook.recommendation.policy === "refine");
  const missingRequiredRecipe = Boolean(isSynthesis && !selectedItem?.recipe);

  const handleConfirm = () => {
    if (
      !selectedItem ||
      !compatibility ||
      !compatibility.ok ||
      !costPreflight ||
      missingRequiredRecipe ||
      running
    )
      return;
    const binding: PlaybookRunBinding = {
      playbookId: selectedItem.playbookId,
      playbook: selectedItem.playbook,
      study: selectedItem.study,
      poolVersion: selectedItem.pool!,
      pinnedTaskSetVersion: selectedItem.pinnedTaskSetVersion,
      recipeVersion: selectedItem.recipe,
      taskSetContext,
      taskBinding,
      compatibility,
      costPreflight,
      preflightConfirmedAt: Date.now(),
    };
    onConfirmed(binding);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <DialogSurface
      open={open}
      onOpenChange={onOpenChange}
      title="Run with Policy Playbook"
      className="max-w-2xl"
    >
      <div className="flex flex-col max-h-[85vh]">
        {/* Dialog Header */}
        <div className="flex items-center justify-between border-b border-edge px-6 py-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold text-text">Run with Policy Playbook</h2>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="flex h-11 w-11 items-center justify-center rounded-md text-dim hover:text-text hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Dialog Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {loading ? (
            <div className="py-12 text-center text-sm text-dim">Loading available playbooks...</div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-dim">
              No sealed policy playbooks found. Create and complete a Policy Study in Research Lab
              to generate playbooks.
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="block text-xs font-semibold uppercase tracking-wider text-dim mb-2">
                  Select Sealed Playbook
                </div>
                <div className="space-y-2">
                  {items.map((item) => {
                    const isSelected = item.study.id === selectedStudyId;
                    const rec = item.playbook.recommendation;
                    const recLabel =
                      rec.kind === "adopt"
                        ? `Adopt ${rec.policy.charAt(0).toUpperCase() + rec.policy.slice(1).replace("_", " ")}`
                        : "Do Not Fuse";

                    return (
                      <button
                        key={item.study.id}
                        type="button"
                        data-testid={`playbook-option-${item.study.id}`}
                        onClick={() => setSelectedStudyId(item.study.id)}
                        className={`w-full min-h-[44px] text-left p-3 rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                          isSelected
                            ? "border-accent bg-accent/5"
                            : "border-edge hover:border-edge-bright bg-surface"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium text-sm text-text">{item.study.title}</div>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              item.study.claimLevel === "confirmed"
                                ? "bg-green-500/10 text-green-400 border border-green-500/20"
                                : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            }`}
                          >
                            {item.study.claimLevel === "confirmed" ? "Confirmed" : "Exploratory"}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs text-dim">
                          <span>{recLabel}</span>
                          {"configuration" in rec && rec.configuration && (
                            <span className="font-mono">{rec.configuration}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selected Playbook Preflight */}
              {selectedItem && (
                <div
                  data-testid="playbook-preflight"
                  className="rounded-lg border border-edge bg-surface p-4 space-y-4"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-edge">
                    <span className="text-xs font-semibold uppercase tracking-wider text-dim">
                      Preflight Analysis
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        selectedItem.study.claimLevel === "confirmed"
                          ? "bg-green-500/10 text-green-400 border border-green-500/20"
                          : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                      }`}
                    >
                      {selectedItem.study.claimLevel === "confirmed" ? "Confirmed" : "Exploratory"}
                    </span>
                  </div>

                  {/* Recommendation details */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-dim block">Recommended policy</span>
                      <span className="font-semibold text-text">
                        {selectedItem.playbook.recommendation.kind === "adopt"
                          ? `Adopt ${selectedItem.playbook.recommendation.policy.charAt(0).toUpperCase() + selectedItem.playbook.recommendation.policy.slice(1).replace("_", " ")}`
                          : "Do Not Fuse"}
                      </span>
                    </div>
                    <div>
                      <span className="text-dim block">Predeclared Threshold</span>
                      <span className="font-semibold text-text">MPID 0.2</span>
                    </div>
                    <div>
                      <span className="text-dim block">Pool Adequacy</span>
                      <span className="font-semibold text-text capitalize">
                        pool adequacy: {selectedItem.playbook.poolAdequacy?.outcome ?? "unprobed"}
                      </span>
                    </div>
                    <div>
                      <span className="text-dim block">Recipe Sensitivity</span>
                      <span className="font-semibold text-text">
                        {selectedItem.playbook.recipeSensitivity?.checked ? "Checked" : "Unchecked"}
                      </span>
                    </div>
                  </div>

                  {/* Cost estimates */}
                  <div className="pt-2 border-t border-edge space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-dim">Estimated policy cost:</span>
                      <span className="font-mono text-text">
                        {costPreflight && costPreflight.policyCostUsd !== null
                          ? `$${costPreflight.policyCostUsd.toFixed(4)}${costPreflight.multiplier ? ` (${costPreflight.multiplier.toFixed(1)}x)` : ""}`
                          : "Unknown (partial pricing / unavailable)"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-dim">Experimental baseline:</span>
                      <span className="font-mono text-text">
                        {costPreflight && costPreflight.baselineCostUsd !== null
                          ? `$${costPreflight.baselineCostUsd.toFixed(4)}`
                          : "Unknown (unavailable)"}
                      </span>
                    </div>
                  </div>

                  {/* Scope Statement */}
                  <div className="pt-2 border-t border-edge text-xs text-dim italic">
                    A policy playbook is a local recommendation for this specific workload and pool;
                    it never applies itself automatically.
                  </div>

                  {/* Compatibility Warning if incompatible */}
                  {compatibility && !compatibility.ok && (
                    <div className="flex items-start gap-2 p-3 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">Session not pool-compatible</div>
                        <div>{compatibility.reason}</div>
                      </div>
                    </div>
                  )}
                  {missingRequiredRecipe && (
                    <div className="flex items-start gap-2 p-3 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">Fusion recipe unresolved</div>
                        <div>
                          The adopted policy requires a resolved fusion recipe version, but none was
                          found for this study.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dialog Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-edge px-6 py-4">
          <button
            type="button"
            data-action="cancel-playbook-run"
            onClick={handleCancel}
            className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-md border border-edge bg-surface text-sm font-medium text-text hover:bg-surface-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            data-action="confirm-playbook-run"
            onClick={handleConfirm}
            disabled={
              !selectedItem ||
              !compatibility ||
              !compatibility.ok ||
              missingRequiredRecipe ||
              running
            }
            className={`min-h-[44px] min-w-[44px] px-4 py-2 rounded-md text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
              !selectedItem ||
              !compatibility ||
              !compatibility.ok ||
              missingRequiredRecipe ||
              running
                ? "bg-muted text-dim cursor-not-allowed border border-edge"
                : "bg-accent text-white hover:bg-accent-hover shadow"
            }`}
          >
            Run with Playbook
          </button>
        </div>
      </div>
    </DialogSurface>
  );
}
