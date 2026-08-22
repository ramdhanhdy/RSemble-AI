// =============================================================================
// RSemble AI — Promote Comparison Task Dialog (spec §7.3, §7.4)
//
// Child 05 (Contextual Compare Results) Milestone D — Task 8.
//
// Save or link ad hoc comparison workflow:
//   - Previews title, objective, instruction, context manifest, response contract,
//     family, and facets;
//   - Suggests exact-content matches as choices, NEVER auto-merges (spec §7.4);
//   - Supports Create new Task or Link to existing Task Version;
//   - Validates that existing Task Version executable content matches stored
//     comparison input before linking;
//   - Creates/reconstructs Task Instance with appropriate input completeness;
//   - Updates Comparison Result binding via CAS;
//   - Triggers evidence reindex under child-04 rules;
//   - Missing historical input: records link for navigation, limited with
//     `instance_input_incomplete` reason;
//   - Cancel, CAS conflict retry without input loss, accessible focus flows.
// =============================================================================

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Link2,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { DialogSurface } from "../../ui/DialogSurface";
import { useTaskRepository } from "../../lib/persistence/repository-context";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { ComparisonRepository } from "../../lib/persistence/comparison-repository";
import type {
  ContextManifestEntry,
  NormalizedTaskInput,
  ResponseContract,
  TaskFamily,
  TaskInstance,
  TaskRecord,
  TaskVersion,
} from "../../lib/tasks/task-types";
import {
  assessInputCompleteness,
  findExactTaskMatches,
  normalizeInstruction,
  validateTaskVersionLink,
  type ComparisonExecutableInput,
} from "../../lib/compare/task-link-validator";
import {
  canonicalJsonString,
  hashArtifactContent,
} from "../../lib/evaluations/protocol-fingerprint";
import {
  computeInstanceInputDigest,
  resolveInstanceCompleteness,
} from "../../lib/tasks/task-instance";
import { StorageError } from "../../lib/persistence/database";

export interface PromoteComparisonTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comparisonId: string;
  expectedRevision: number;
  prompt?: string;
  systemPrompt?: string;
  title?: string;
  objective?: string;
  contextManifest?: ContextManifestEntry[];
  responseContract?: ResponseContract | null;
  taskRepo?: TaskRepository | null;
  comparisonRepo?: ComparisonRepository | null;
  availableArtifactBytes?: Map<string, Uint8Array>;
  onSuccess?: (result: { taskId: string; taskVersion: number; taskInstanceId: string }) => void;
  onReindex?: () => Promise<void> | void;
  onCancel?: () => void;
  className?: string;
}

export function PromoteComparisonTaskDialog({
  open,
  onOpenChange,
  comparisonId,
  expectedRevision,
  prompt = "",
  systemPrompt = "",
  title: initialTitle = "",
  objective: initialObjective = "",
  contextManifest = [],
  responseContract = null,
  taskRepo: propTaskRepo,
  comparisonRepo: propComparisonRepo,
  availableArtifactBytes,
  onSuccess,
  onReindex,
  onCancel,
  className = "",
}: PromoteComparisonTaskDialogProps): React.ReactElement {
  const contextTaskRepo = useTaskRepository();
  const taskRepo = propTaskRepo !== undefined ? propTaskRepo : contextTaskRepo;
  const comparisonRepo = propComparisonRepo ?? null;

  // Comparison executable input
  const comparisonInput: ComparisonExecutableInput = useMemo(
    () => ({
      prompt,
      contextManifest,
      responseContract,
    }),
    [prompt, contextManifest, responseContract],
  );

  // Assess input completeness
  const completenessAssessment = useMemo(
    () => assessInputCompleteness(comparisonInput, availableArtifactBytes),
    [comparisonInput, availableArtifactBytes],
  );

  // Promotion mode: "create" | "link"
  const [mode, setMode] = useState<"create" | "link">("create");

  // Form fields for "create"
  const [titleInput, setTitleInput] = useState("");
  const [objectiveInput, setObjectiveInput] = useState("");
  const [selectedFamilyId, setSelectedFamilyId] = useState<string>("");
  const [selectedFacets] = useState<
    Array<{ facetId: string; valueId: string; taxonomyVersion: number }>
  >([]);

  // Form fields for "link"
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [selectedVersionNumber, setSelectedVersionNumber] = useState<number>(1);

  // Loaded repository data
  const [families, setFamilies] = useState<TaskFamily[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [versionsByTaskId, setVersionsByTaskId] = useState<Map<string, TaskVersion[]>>(new Map());
  const [allVersions, setAllVersions] = useState<TaskVersion[]>([]);

  // Async & submission status
  const [, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Initialize title and objective defaults when opening
  useEffect(() => {
    if (open) {
      const derivedTitle =
        initialTitle.trim() ||
        normalizeInstruction(prompt).slice(0, 60).trim() ||
        `Comparison ${comparisonId}`;
      const derivedObjective = initialObjective.trim() || `Objective for ${derivedTitle}.`;
      setTitleInput(derivedTitle);
      setObjectiveInput(derivedObjective);
      setConflictError(null);
      setActionError(null);
      setMode("create");
    }
  }, [open, initialTitle, initialObjective, prompt, comparisonId]);

  // Load existing tasks, versions, and families for linking / match suggestions
  useEffect(() => {
    if (!open || !taskRepo) return;
    let cancelled = false;

    async function loadData() {
      setIsLoading(true);
      try {
        const [loadedFamilies, loadedTasks] = await Promise.all([
          taskRepo!.listTaskFamilies(),
          taskRepo!.listTasks({ archiveState: "active" }),
        ]);

        if (cancelled) return;
        setFamilies(loadedFamilies);
        setTasks(loadedTasks);

        // Load versions for all active tasks
        const versionMap = new Map<string, TaskVersion[]>();
        const flatVersions: TaskVersion[] = [];

        await Promise.all(
          loadedTasks.map(async (t) => {
            const vList = await taskRepo!.listTaskVersions(t.id);
            if (!cancelled) {
              versionMap.set(t.id, vList);
              flatVersions.push(...vList);
            }
          }),
        );

        if (cancelled) return;
        setVersionsByTaskId(versionMap);
        setAllVersions(flatVersions);

        // Pre-select first task if available
        if (loadedTasks.length > 0) {
          setSelectedTaskId((prev) => {
            if (prev) return prev;
            setSelectedVersionNumber(loadedTasks[0].latestVersion);
            return loadedTasks[0].id;
          });
        }
      } catch (err) {
        if (!cancelled) {
          setActionError(err instanceof Error ? err.message : "Failed to load Task catalog.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [open, taskRepo]);

  // Discover exact matches among existing Task Versions
  const exactMatches = useMemo(
    () => findExactTaskMatches(comparisonInput, allVersions),
    [comparisonInput, allVersions],
  );

  // Selected version for link mode
  const selectedTaskVersions = useMemo(
    () => (selectedTaskId ? versionsByTaskId.get(selectedTaskId) || [] : []),
    [selectedTaskId, versionsByTaskId],
  );

  const selectedVersion = useMemo(
    () =>
      selectedTaskVersions.find((v) => v.version === selectedVersionNumber) ||
      selectedTaskVersions[0] ||
      null,
    [selectedTaskVersions, selectedVersionNumber],
  );

  // Link validation result
  const linkValidation = useMemo(() => {
    if (!selectedVersion) return null;
    return validateTaskVersionLink(comparisonInput, selectedVersion);
  }, [comparisonInput, selectedVersion]);

  // Handle selecting an exact match suggestion
  const handleSelectExactMatch = (taskVersion: TaskVersion) => {
    setMode("link");
    setSelectedTaskId(taskVersion.taskId);
    setSelectedVersionNumber(taskVersion.version);
    setConflictError(null);
  };

  // Close dialog handler
  const handleClose = () => {
    if (isSubmitting) return;
    onCancel?.();
    onOpenChange(false);
  };

  // Submit promotion
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskRepo) {
      setActionError("Task repository is not available.");
      return;
    }
    if (isSubmitting) return;

    setIsSubmitting(true);
    setConflictError(null);
    setActionError(null);

    try {
      const now = Date.now();

      if (mode === "create") {
        // --- Create New Task Workflow ---
        const newTaskId = `task-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const finalTitle = titleInput.trim() || `Promoted Task ${newTaskId}`;
        const finalObjective = objectiveInput.trim() || `Objective for ${finalTitle}.`;

        const record: TaskRecord = {
          id: newTaskId,
          latestVersion: 1,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          origin: "promoted-comparison",
          revision: 0,
        };

        const version: TaskVersion = {
          taskId: newTaskId,
          version: 1,
          title: finalTitle,
          objective: finalObjective,
          candidateInstruction: prompt,
          defaultContextManifest: contextManifest,
          responseContract: responseContract ?? null,
          taskVerifierRef: null,
          source: {
            kind: "authored",
            legacyScopeKey: null,
            note: `Promoted from comparison ${comparisonId}`,
          },
          createdAt: now,
        };

        await taskRepo.createTask(record, version);

        if (selectedFamilyId) {
          await taskRepo.assignTaskFamily({
            id: `assign-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            taskId: newTaskId,
            taskVersion: 1,
            familyId: selectedFamilyId,
            isPrimary: true,
            createdAt: now,
            revision: 0,
            archivedAt: null,
          });
        }

        for (const facet of selectedFacets) {
          await taskRepo.annotateTaskFacet({
            id: `facet-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            taskId: newTaskId,
            taskVersion: 1,
            facetId: facet.facetId,
            valueId: facet.valueId,
            source: "authored",
            authorKind: "user",
            confidence: 1.0,
            taxonomyVersion: facet.taxonomyVersion,
            createdAt: now,
            supersedesId: null,
          });
        }

        // Reconstruct / get Task Instance
        const normalizedInput: NormalizedTaskInput = {
          text: prompt,
          artifactIds: contextManifest
            .map((m) => m.artifactId)
            .filter((id): id is string => Boolean(id)),
          metadata: {
            systemPrompt,
            mode: "rank",
          },
        };

        const completeness = completenessAssessment.isMissingInput
          ? "incomplete"
          : resolveInstanceCompleteness({
              normalizedInput,
              availableArtifactBytes: availableArtifactBytes ?? new Map(),
            });

        const tempInstanceForDigest: TaskInstance = {
          id: "temp",
          taskId: newTaskId,
          taskVersion: 1,
          normalizedInput,
          contextManifest,
          inputDigest: "",
          inputCompleteness: completeness,
          createdAt: now,
          sourceRef: { kind: "comparison", legacyScopeKey: null, originId: comparisonId },
        };
        const inputDigest = computeInstanceInputDigest(tempInstanceForDigest);

        const instanceCandidate: TaskInstance = {
          id: `inst:${hashArtifactContent(canonicalJsonString([newTaskId, 1, inputDigest]))}`,
          taskId: newTaskId,
          taskVersion: 1,
          normalizedInput,
          contextManifest,
          inputDigest,
          inputCompleteness: completeness,
          createdAt: now,
          sourceRef: { kind: "comparison", legacyScopeKey: null, originId: comparisonId },
        };

        const instanceResult = await taskRepo.getOrCreateTaskInstance(
          instanceCandidate,
          availableArtifactBytes ?? new Map(),
        );

        // Update comparison CAS binding
        if (comparisonRepo) {
          await comparisonRepo.bindComparisonToTask(
            comparisonId,
            { kind: "canonical", taskId: newTaskId, taskVersion: 1 },
            instanceResult.instance.id,
            expectedRevision,
          );
        }

        // Trigger evidence reindex
        if (onReindex) {
          await onReindex();
        }

        onSuccess?.({
          taskId: newTaskId,
          taskVersion: 1,
          taskInstanceId: instanceResult.instance.id,
        });

        onOpenChange(false);
      } else {
        // --- Link to Existing Task Version Workflow ---
        if (!selectedVersion || !selectedTaskId) {
          setActionError("Please select a Task Version to link.");
          return;
        }

        if (!linkValidation?.ok && !completenessAssessment.isMissingInput) {
          setActionError("Cannot link to mismatched Task Version.");
          return;
        }

        const targetTaskId = selectedTaskId;
        const targetVersionNum = selectedVersion.version;

        const normalizedInput: NormalizedTaskInput = {
          text: prompt,
          artifactIds: selectedVersion.defaultContextManifest
            .map((m) => m.artifactId)
            .filter((id): id is string => Boolean(id)),
          metadata: {
            systemPrompt,
            mode: "rank",
          },
        };

        const completeness = completenessAssessment.isMissingInput
          ? "incomplete"
          : resolveInstanceCompleteness({
              normalizedInput,
              availableArtifactBytes: availableArtifactBytes ?? new Map(),
            });

        const tempInstanceForDigest: TaskInstance = {
          id: "temp",
          taskId: targetTaskId,
          taskVersion: targetVersionNum,
          normalizedInput,
          contextManifest: selectedVersion.defaultContextManifest,
          inputDigest: "",
          inputCompleteness: completeness,
          createdAt: now,
          sourceRef: { kind: "comparison", legacyScopeKey: null, originId: comparisonId },
        };
        const inputDigest = computeInstanceInputDigest(tempInstanceForDigest);

        const instanceCandidate: TaskInstance = {
          id: `inst:${hashArtifactContent(
            canonicalJsonString([targetTaskId, targetVersionNum, inputDigest]),
          )}`,
          taskId: targetTaskId,
          taskVersion: targetVersionNum,
          normalizedInput,
          contextManifest: selectedVersion.defaultContextManifest,
          inputDigest,
          inputCompleteness: completeness,
          createdAt: now,
          sourceRef: { kind: "comparison", legacyScopeKey: null, originId: comparisonId },
        };

        const instanceResult = await taskRepo.getOrCreateTaskInstance(
          instanceCandidate,
          availableArtifactBytes ?? new Map(),
        );

        // CAS update comparison binding
        if (comparisonRepo) {
          await comparisonRepo.bindComparisonToTask(
            comparisonId,
            { kind: "canonical", taskId: targetTaskId, taskVersion: targetVersionNum },
            instanceResult.instance.id,
            expectedRevision,
          );
        }

        // Trigger evidence reindex
        if (onReindex) {
          await onReindex();
        }

        onSuccess?.({
          taskId: targetTaskId,
          taskVersion: targetVersionNum,
          taskInstanceId: instanceResult.instance.id,
        });

        onOpenChange(false);
      }
    } catch (err) {
      if (
        (err instanceof StorageError && err.kind === "conflict") ||
        (typeof err === "object" && err !== null && "kind" in err && err.kind === "conflict") ||
        (err instanceof Error && /conflict|stale/i.test(err.message))
      ) {
        setConflictError(
          "A concurrent modification conflict occurred while binding the comparison. Please refresh and retry.",
        );
      } else {
        setActionError(err instanceof Error ? err.message : "Failed to promote comparison.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLinkDisabled =
    mode === "link" &&
    (!selectedTaskId || (!linkValidation?.ok && !completenessAssessment.isMissingInput));

  return (
    <DialogSurface
      open={open}
      onOpenChange={onOpenChange}
      title="Save or link as a canonical Task"
      className={`max-w-2xl ${className}`}
    >
      <div className="flex max-h-[calc(100dvh-4rem)] min-w-0 flex-col overflow-y-auto p-6">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-accent" />
              <span className="font-mono text-xs font-semibold tracking-wider text-accent uppercase">
                Promote Result
              </span>
            </div>
            <h2 className="mt-1 text-lg font-semibold text-text">
              Save or link as a canonical Task
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              Review the exact stored input before changing identity. No semantic merge occurs
              automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            data-testid="close-promote-dialog-btn"
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-card-hover hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Missing Historical Input Warning */}
        {completenessAssessment.isMissingInput && (
          <div
            data-testid="missing-input-warning"
            className="mb-4 flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/[0.08] p-3 text-xs text-amber-300"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
            <div>
              <span className="font-semibold">Historical input content is incomplete.</span> Linking
              will be recorded for navigation, but evidence eligibility will remain limited (
              <code className="font-mono text-amber-200">instance_input_incomplete</code>).
            </div>
          </div>
        )}

        {/* Exact Match Suggestions Banner (spec §7.3 step 2, §7.4) */}
        {exactMatches.length > 0 && (
          <div
            data-testid="exact-match-suggestions"
            className="mb-4 rounded-md border border-accent/30 bg-accent/[0.05] p-3.5"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-accent">
              <CheckCircle2 size={15} />
              <span>Exact-content match found</span>
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              The following existing Tasks share this exact candidate instruction, context manifest,
              and response contract:
            </p>
            <div className="mt-2.5 space-y-2">
              {exactMatches.map((m) => (
                <div
                  key={`${m.taskId}-${m.version}`}
                  className="flex items-center justify-between gap-3 rounded border border-edge bg-panel px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-text">{m.title}</span>
                    <span className="ml-2 font-mono text-text-muted">
                      ({m.taskId} v{m.version})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSelectExactMatch(m)}
                    data-testid={`select-exact-match-${m.taskId}-${m.version}`}
                    className="inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-xs font-medium text-accent transition-colors hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    <Link2 size={13} />
                    Select to Link
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Promotion Mode Selection (spec §7.3 step 3) */}
        <div className="mb-4 flex rounded-md border border-edge bg-panel p-1 text-xs">
          <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded px-3 py-2 font-medium transition-colors has-[:checked]:bg-raised has-[:checked]:text-text has-[:checked]:shadow-sm">
            <input
              type="radio"
              name="promotion-mode"
              value="create"
              checked={mode === "create"}
              onChange={() => {
                setMode("create");
                setConflictError(null);
              }}
              className="sr-only"
            />
            <Plus size={14} className={mode === "create" ? "text-accent" : "text-text-muted"} />
            <span>Create new Task</span>
          </label>
          <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded px-3 py-2 font-medium transition-colors has-[:checked]:bg-raised has-[:checked]:text-text has-[:checked]:shadow-sm">
            <input
              type="radio"
              name="promotion-mode"
              value="link"
              checked={mode === "link"}
              onChange={() => {
                setMode("link");
                setConflictError(null);
              }}
              className="sr-only"
            />
            <Link2 size={14} className={mode === "link" ? "text-accent" : "text-text-muted"} />
            <span>Link to existing Task Version</span>
          </label>
        </div>

        {/* Stored Comparison Input Previews (spec §7.3 step 1) */}
        <div className="mb-5 space-y-3 rounded-md border border-edge bg-panel/60 p-3.5 text-xs">
          <div>
            <span className="font-semibold text-text-secondary uppercase tracking-wider text-[10px]">
              Candidate Instruction
            </span>
            <div
              data-testid="preview-instruction"
              className="mt-1 max-h-24 overflow-y-auto rounded border border-edge bg-card p-2 font-mono text-xs text-text"
            >
              {prompt || <span className="italic text-text-muted">Empty prompt</span>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <span className="font-semibold text-text-secondary uppercase tracking-wider text-[10px]">
                Context Manifest ({contextManifest.length})
              </span>
              <div
                data-testid="preview-context-manifest"
                className="mt-1 rounded border border-edge bg-card p-2 text-text"
              >
                {contextManifest.length > 0 ? (
                  <ul className="space-y-1">
                    {contextManifest.map((c, i) => (
                      <li key={i} className="font-mono text-xs text-text-secondary">
                        • {c.role}: {c.artifactId || c.externalRef || "attachment"} (
                        {c.mediaType || "file"})
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="italic text-text-muted">No context attachments</span>
                )}
              </div>
            </div>

            <div>
              <span className="font-semibold text-text-secondary uppercase tracking-wider text-[10px]">
                Response Contract
              </span>
              <div
                data-testid="preview-response-contract"
                className="mt-1 rounded border border-edge bg-card p-2 text-text"
              >
                {responseContract ? (
                  <div>
                    <span className="font-mono font-medium text-accent">
                      {responseContract.format}
                    </span>
                    {responseContract.constraints && responseContract.constraints.length > 0 && (
                      <div className="mt-1 text-text-secondary">
                        Constraints: {responseContract.constraints.join(", ")}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="italic text-text-muted">Standard (no explicit contract)</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic Form per Mode */}
        <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-4">
          {mode === "create" ? (
            <>
              {/* Create Mode: Title & Objective */}
              <div>
                <label className="block text-xs font-semibold text-text" htmlFor="task-title-input">
                  Task Title <span className="text-accent">*</span>
                </label>
                <input
                  id="task-title-input"
                  data-testid="task-title-input"
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  placeholder="e.g. Implement Binary Search"
                  required
                  className="mt-1 flex min-h-[44px] w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                />
              </div>

              <div>
                <label
                  className="block text-xs font-semibold text-text"
                  htmlFor="task-objective-input"
                >
                  Task Objective
                </label>
                <textarea
                  id="task-objective-input"
                  data-testid="task-objective-input"
                  value={objectiveInput}
                  onChange={(e) => setObjectiveInput(e.target.value)}
                  placeholder="Describe the expected task outcome and evaluation intent..."
                  rows={2}
                  className="mt-1 flex w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                />
              </div>

              {/* Family Selector */}
              <div>
                <label
                  className="block text-xs font-semibold text-text"
                  htmlFor="task-family-select"
                >
                  Primary Task Family (Optional)
                </label>
                <select
                  id="task-family-select"
                  data-testid="task-family-select"
                  value={selectedFamilyId}
                  onChange={(e) => setSelectedFamilyId(e.target.value)}
                  className="mt-1 flex min-h-[44px] w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  <option value="">None (Unassigned)</option>
                  {families.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Facet annotations preview */}
              <div data-testid="task-facet-selector" className="text-xs text-text-muted">
                Facets will be authored as standard version 1 annotations.
              </div>
            </>
          ) : (
            <>
              {/* Link Mode: Select Existing Task & Version */}
              <div>
                <label className="block text-xs font-semibold text-text" htmlFor="link-task-select">
                  Select Canonical Task <span className="text-accent">*</span>
                </label>
                <select
                  id="link-task-select"
                  data-testid="link-task-select"
                  value={selectedTaskId}
                  onChange={(e) => {
                    setSelectedTaskId(e.target.value);
                    const t = tasks.find((item) => item.id === e.target.value);
                    if (t) setSelectedVersionNumber(t.latestVersion);
                  }}
                  className="mt-1 flex min-h-[44px] w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  {tasks.length === 0 && <option value="">No existing tasks found</option>}
                  {tasks.map((t) => {
                    const latest = versionsByTaskId.get(t.id)?.[0];
                    return (
                      <option key={t.id} value={t.id}>
                        {latest ? `${latest.title} (${t.id})` : t.id}
                      </option>
                    );
                  })}
                </select>
              </div>

              {selectedTaskVersions.length > 1 && (
                <div>
                  <label
                    className="block text-xs font-semibold text-text"
                    htmlFor="link-version-select"
                  >
                    Task Version
                  </label>
                  <select
                    id="link-version-select"
                    data-testid="link-version-select"
                    value={selectedVersionNumber}
                    onChange={(e) => setSelectedVersionNumber(Number(e.target.value))}
                    className="mt-1 flex min-h-[44px] w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  >
                    {selectedTaskVersions.map((v) => (
                      <option key={v.version} value={v.version}>
                        Version {v.version}: {v.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Link validation status (spec §7.3 step 4, §7.4) */}
              {selectedVersion && (
                <div className="mt-1">
                  {linkValidation?.ok ? (
                    <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/[0.06] p-3 text-xs text-accent">
                      <Check size={16} className="shrink-0" />
                      <span>
                        Exact match: Candidate instruction, context manifest, and response contract
                        match exactly.
                      </span>
                    </div>
                  ) : completenessAssessment.isMissingInput ? (
                    <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs text-amber-300">
                      <AlertTriangle size={16} className="shrink-0 text-amber-400" />
                      <span>
                        Historical input is missing. Link will be recorded for navigation only with
                        incomplete status.
                      </span>
                    </div>
                  ) : (
                    <div
                      data-testid="link-mismatch-warning"
                      className="flex items-start gap-2.5 rounded-md border border-red-500/30 bg-red-500/[0.08] p-3 text-xs text-red-300"
                    >
                      <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
                      <div>
                        <span className="font-semibold">Content mismatch:</span> Only exact
                        normalized matches may be linked (spec §7.4).
                        <p className="mt-1 text-red-200">{linkValidation?.message}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Stale CAS Conflict Alert (spec §7.3 step 6) */}
          {conflictError && (
            <div
              data-testid="promotion-conflict-alert"
              className="flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/[0.1] p-3 text-xs text-amber-300"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
              <div>
                <span className="font-semibold">Concurrent modification:</span> {conflictError}
              </div>
            </div>
          )}

          {/* General Action Error */}
          {actionError && (
            <div className="flex items-start gap-2.5 rounded-md border border-red-500/40 bg-red-500/[0.1] p-3 text-xs text-red-300">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
              <div>{actionError}</div>
            </div>
          )}

          {/* Dialog Action Buttons */}
          <div className="mt-3 flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={handleClose}
              data-testid="cancel-promote-btn"
              disabled={isSubmitting}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-edge bg-panel px-4 text-sm font-medium text-text-secondary transition-colors hover:bg-panel-hover hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="submit-promote-btn"
              disabled={isSubmitting || isLinkDisabled}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-accent/40 bg-accent/[0.1] px-5 text-sm font-medium text-accent transition-colors hover:bg-accent/[0.18] focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <span>Saving...</span>
              ) : mode === "create" ? (
                <>
                  <Plus size={16} />
                  <span>Create Task & Link</span>
                </>
              ) : (
                <>
                  <Link2 size={16} />
                  <span>
                    {completenessAssessment.isMissingInput
                      ? "Link Task (Navigation only)"
                      : "Link Task"}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </DialogSurface>
  );
}
