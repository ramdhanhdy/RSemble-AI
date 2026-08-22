// =============================================================================
// RSemble AI — Pure pre-call persistence builder & coordinator
//
// Child 05 (Contextual Compare Results) Milestone B — Task 4.
//
// Persists the comparison envelope, immutable input snapshot, and canonical
// Task Instance/linkage atomically BEFORE any paid provider call (spec §5).
// This is the zero-paid-call boundary — the most critical safety property
// of Child 05.
//
// Sequence (spec §5):
//  1. Validate candidate roster, judge/Rubric, context, and mode;
//  2. Create the RunRecordV2 through the existing atomic recorder;
//  3. Create or update the Comparison Result index with immutable input
//     snapshot reference;
//  4. If canonically bound, resolve Task Version and create/get Task Instance;
//  5. Persist the linkage atomically or abort before paid execution;
//  6. Acquire existing execution ownership/lease and continue current pipeline.
//
// Key invariants:
//  - Pure preflight builder: testable without provider calls or network.
//  - Zero provider calls before durable persistence success.
//  - Failure at ANY boundary triggers compensation (marks run aborted) and aborts.
//  - No credentials or prohibited keys enter the snapshot or index.
//  - Ad hoc input snapshots preserve normalized task/context for later promotion
//    without claiming canonical identity.
//  - Stream deltas are NEVER routed into the persistence control queue.
// =============================================================================

import type { ModelSlot } from "../../studio-data";
import type { CriticRef, ReasoningPolicy } from "../providers/types";
import {
  type AdHocEvaluationConfig,
  resolveEvaluationRubric,
} from "../evaluations/evaluation-rubric-adhoc";
import type { Attachment } from "../attachments/types";
import type {
  ComparisonMode,
  ComparisonTaskBinding,
  PolicyPlaybookAttachment,
} from "./comparison-result-types";
import {
  validateComparisonTaskBinding,
  COMPARISON_PROHIBITED_KEYS,
} from "./comparison-result-validation";
import { CREDENTIAL_LIKE_VALUE } from "../tasks/task-validation";
import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import { computeInstanceInputDigest, resolveInstanceCompleteness } from "../tasks/task-instance";
import type { ContextManifestEntry, NormalizedTaskInput, TaskInstance } from "../tasks/task-types";
import type { BeginRunInput, RunRecorder } from "../persistence/run-recorder";
import type {
  ComparisonRepository,
  CreateComparisonEnvelopeOptions,
} from "../persistence/comparison-repository";
import type { TaskRepository } from "../persistence/task-repository";
import { StorageError } from "../persistence/database";
import type { RunRecordV2 } from "../persistence/run-types";

// --- Types -------------------------------------------------------------------

export interface PreCallPersistenceInput {
  mode: ComparisonMode;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  slots: ModelSlot[];
  critic: CriticRef;
  judgeInstruction?: string;
  evaluation: AdHocEvaluationConfig;
  attachments?: Attachment[];
  attachmentsToJudge?: boolean;
  reasoningPolicy?: ReasoningPolicy;
  taskBinding?: ComparisonTaskBinding | null;
  repeatedFrom?: string | null;
  taskInstanceId?: string | null;
  policyPlaybook?: PolicyPlaybookAttachment | null;
}

export interface ComparisonInputSnapshotAttachment {
  id: string;
  name: string;
  mediaType: string;
  byteCount: number;
  digest: string | null;
}

export interface ComparisonInputSnapshot {
  schemaVersion: 1;
  mode: ComparisonMode;
  prompt: string;
  systemPrompt: string;
  temperature: number;
  evaluation: AdHocEvaluationConfig;
  judgeInstruction: string;
  attachments: ComparisonInputSnapshotAttachment[];
  attachmentsToJudge: boolean;
  reasoningPolicy?: ReasoningPolicy;
  normalizedInput: NormalizedTaskInput;
  contextManifest: ContextManifestEntry[];
  inputDigest: string;
  inputSnapshotRef: string;
  createdAt: number;
}

export interface PreCallPersistencePlan {
  snapshot: ComparisonInputSnapshot;
  resolvedBinding: ComparisonTaskBinding;
  beginRunInput: BeginRunInput;
  envelopeOptions: CreateComparisonEnvelopeOptions;
  candidateInstance: TaskInstance | null;
}

export interface PreCallValidationError {
  field: string;
  message: string;
}

export type PreCallValidationResult =
  { ok: true; value: PreCallPersistenceInput } | { ok: false; errors: PreCallValidationError[] };

export interface PreCallPersistenceDeps {
  recorder?: RunRecorder;
  comparisonRepo?: ComparisonRepository | null;
  taskRepo?: TaskRepository | null;
  now?: () => number;
  mintRunId?: () => string;
  availableArtifactBytes?: Map<string, Uint8Array>;
}

export interface PreCallPersistenceResult {
  ok: true;
  runId: string;
  snapshot: ComparisonInputSnapshot;
  taskBinding: ComparisonTaskBinding;
  taskInstanceId: string | null;
}

export interface PreCallSnapshotOptions {
  now?: () => number;
}

// --- Helpers -----------------------------------------------------------------

function assertNoSecrets(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (CREDENTIAL_LIKE_VALUE.test(value)) {
      throw new StorageError("validation", `Credential-like value detected at ${path}`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
  } else if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      if (COMPARISON_PROHIBITED_KEYS.has(key)) {
        throw new StorageError(
          "validation",
          `Prohibited secret key "${key}" detected at ${path}.${key}`,
        );
      }
      assertNoSecrets(val, `${path}.${key}`);
    }
  }
}

// --- Pure Snapshot Builder ---------------------------------------------------

/**
 * Build a deterministic, immutable ComparisonInputSnapshot from valid input.
 * Scans for credentials and prohibited keys, sanitizes attachments to metadata
 * only, and derives the content-addressed input digest and snapshot reference.
 */
export function buildComparisonInputSnapshot(
  input: PreCallPersistenceInput,
  options: PreCallSnapshotOptions = {},
): ComparisonInputSnapshot {
  const now = options.now ?? (() => Date.now());

  // Secret guard over prompt, systemPrompt, judgeInstruction
  assertNoSecrets(input.prompt, "prompt");
  if (input.systemPrompt) assertNoSecrets(input.systemPrompt, "systemPrompt");
  if (input.judgeInstruction) assertNoSecrets(input.judgeInstruction, "judgeInstruction");

  const sanitizedAttachments: ComparisonInputSnapshotAttachment[] = (input.attachments ?? []).map(
    (a) => {
      const raw = a as unknown as Record<string, unknown>;
      const mediaType =
        typeof a.mimeType === "string"
          ? a.mimeType
          : typeof raw.mediaType === "string"
            ? (raw.mediaType as string)
            : "application/octet-stream";
      const byteCount =
        typeof a.bytes === "number"
          ? a.bytes
          : typeof raw.byteCount === "number"
            ? (raw.byteCount as number)
            : 0;
      const digest = typeof raw.digest === "string" ? (raw.digest as string) : null;
      return {
        id: a.id,
        name: a.name,
        mediaType,
        byteCount,
        digest,
      };
    },
  );

  const normalizedInput: NormalizedTaskInput = {
    text: input.prompt,
    artifactIds: sanitizedAttachments.map((a) => a.id),
    metadata: {
      systemPrompt: input.systemPrompt ?? "",
      temperature: String(input.temperature ?? 0.7),
      mode: input.mode,
      judgeInstruction: input.judgeInstruction ?? "",
    },
  };

  const contextManifest: ContextManifestEntry[] = sanitizedAttachments.map((a) => ({
    role: "attachment",
    artifactId: a.id,
    externalRef: null,
    metadataDigest: a.digest,
    mediaType: a.mediaType,
    byteCount: a.byteCount,
  }));

  const inputDigest = computeInstanceInputDigest({
    id: "temp",
    taskId: "temp",
    taskVersion: 1,
    normalizedInput,
    contextManifest,
    inputDigest: "",
    inputCompleteness: "complete",
    createdAt: 0,
    sourceRef: { kind: "comparison", legacyScopeKey: null, originId: null },
  });

  const rawDigest = inputDigest.startsWith("sha256:")
    ? inputDigest.slice("sha256:".length)
    : inputDigest;
  const inputSnapshotRef = `snap:sha256:${rawDigest}`;

  const snapshot: ComparisonInputSnapshot = {
    schemaVersion: 1,
    mode: input.mode,
    prompt: input.prompt,
    systemPrompt: input.systemPrompt ?? "",
    temperature: input.temperature ?? 0.7,
    evaluation: input.evaluation,
    judgeInstruction: input.judgeInstruction ?? "",
    attachments: sanitizedAttachments,
    attachmentsToJudge: input.attachmentsToJudge ?? false,
    reasoningPolicy: input.reasoningPolicy,
    normalizedInput,
    contextManifest,
    inputDigest,
    inputSnapshotRef,
    createdAt: now(),
  };

  assertNoSecrets(snapshot, "snapshot");

  return snapshot;
}

// --- Pure Pre-Call Validation ------------------------------------------------

/**
 * Validate input before execution or persistence.
 * Rejects empty prompts, insufficient candidates, invalid modes, and malformed task bindings.
 */
export function validatePreCallPersistence(
  input: PreCallPersistenceInput,
): PreCallValidationResult {
  const errors: PreCallValidationError[] = [];

  if (!input.prompt || typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
    errors.push({ field: "prompt", message: "Prompt must be a non-empty string." });
  }

  if (input.mode !== "rank" && input.mode !== "fuse") {
    errors.push({ field: "mode", message: 'Mode must be "rank" or "fuse".' });
  }

  const enabledSlots = (input.slots ?? []).filter((s) => s.enabled);
  if (enabledSlots.length < 2) {
    errors.push({ field: "slots", message: "At least two candidate models must be enabled." });
  }

  for (let i = 0; i < enabledSlots.length; i++) {
    const slot = enabledSlots[i];
    if (!slot.providerId || typeof slot.providerId !== "string") {
      errors.push({
        field: `slots[${i}].providerId`,
        message: "Candidate slot providerId is required.",
      });
    }
  }

  if (
    !input.critic ||
    typeof input.critic.providerId !== "string" ||
    input.critic.providerId.length === 0
  ) {
    errors.push({ field: "critic", message: "Critic provider is required." });
  }

  if (input.taskBinding) {
    const bindingValidation = validateComparisonTaskBinding(input.taskBinding);
    if (!bindingValidation.ok) {
      for (const err of bindingValidation.errors) {
        errors.push({ field: err.field, message: err.message });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: input };
}

// --- Pure Plan Builder -------------------------------------------------------

/**
 * Pure builder that produces the pre-call persistence plan.
 * Resolves ad-hoc versus canonical task binding and constructs the exact
 * initial RunRecordV2 parameters, task instance candidate, and comparison index options.
 */
export function buildPreCallPersistencePlan(
  input: PreCallPersistenceInput,
  options: PreCallSnapshotOptions = {},
): PreCallPersistencePlan {
  const validation = validatePreCallPersistence(input);
  if (!validation.ok) {
    const first = validation.errors[0];
    throw new StorageError(
      "validation",
      first ? first.message : "Invalid pre-call persistence input",
    );
  }

  const snapshot = buildComparisonInputSnapshot(input, options);

  let resolvedBinding: ComparisonTaskBinding;
  let candidateInstance: TaskInstance | null = null;

  if (input.taskBinding?.kind === "canonical") {
    const { taskId, taskVersion } = input.taskBinding;
    resolvedBinding = { kind: "canonical", taskId, taskVersion };

    const instanceCompleteness = resolveInstanceCompleteness({
      normalizedInput: snapshot.normalizedInput,
      availableArtifactBytes: new Map(),
    });

    const instanceId = `inst:${hashArtifactContent(
      canonicalJsonString([taskId, taskVersion, snapshot.inputDigest]),
    )}`;

    candidateInstance = {
      id: instanceId,
      taskId,
      taskVersion,
      normalizedInput: snapshot.normalizedInput,
      contextManifest: snapshot.contextManifest,
      inputDigest: snapshot.inputDigest,
      inputCompleteness: instanceCompleteness,
      createdAt: snapshot.createdAt,
      sourceRef: { kind: "comparison", legacyScopeKey: null, originId: null },
    };
  } else {
    resolvedBinding = {
      kind: "ad_hoc",
      inputSnapshotRef: snapshot.inputSnapshotRef,
    };
  }

  const beginRunInput: BeginRunInput = {
    runId: "",
    source: { kind: "adhoc" },
    mode: snapshot.mode,
    task: {
      title: snapshot.prompt.slice(0, 80),
      prompt: snapshot.prompt,
      systemPrompt: snapshot.systemPrompt,
      temperature: snapshot.temperature,
    },
    evaluation: {
      profile: resolveEvaluationRubric(snapshot.evaluation),
      candidateMessages: [],
    },
    slots: input.slots.filter((s) => s.enabled),
    critic: input.critic,
    fence: { ownerId: "tab-1", fence: 0 },
    attachments: (input.attachments ?? []).map((a) => ({
      name: a.name,
      kind: a.kind,
      bytes: a.bytes,
    })),
    reasoningPolicy: snapshot.reasoningPolicy,
  };

  const envelopeOptions: CreateComparisonEnvelopeOptions = {
    taskInstanceId: input.taskInstanceId ?? null,
    repeatedFrom: input.repeatedFrom ?? null,
    activeObservationIds: [],
    evidenceReceiptRevision: 0,
    policyPlaybook: input.policyPlaybook ?? null,
  };
  return {
    snapshot,
    resolvedBinding,
    beginRunInput,
    envelopeOptions,
    candidateInstance,
  };
}

// --- Pre-Call Execution Coordinator (Atomic Sequence) -------------------------

/**
 * Execute the atomic pre-call persistence sequence (spec §5).
 * Validates, begins the run record, verifies/creates canonical task instances,
 * and creates the Comparison Result index before returning.
 *
 * If any boundary fails, compensation executes (marks the run aborted) and
 * the error is thrown BEFORE any provider network calls are made.
 */
export async function executePreCallPersistence(
  deps: PreCallPersistenceDeps,
  input: PreCallPersistenceInput,
): Promise<PreCallPersistenceResult> {
  const plan = buildPreCallPersistencePlan(input, { now: deps.now });
  const mintId =
    deps.mintRunId ??
    (() => `run-${deps.now ? deps.now() : Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const { recorder, comparisonRepo, taskRepo } = deps;
  let runId: string | null = null;

  // Step 2: Create the RunRecordV2 through the existing atomic recorder
  if (recorder) {
    runId = await recorder.begin({
      ...plan.beginRunInput,
      runId: plan.beginRunInput.runId || mintId(),
    });
  } else {
    runId = mintId();
  }

  try {
    let taskInstanceId: string | null = null;

    // Step 4: If canonically bound, resolve Task Version and create/get Task Instance
    if (plan.resolvedBinding.kind === "canonical") {
      const { taskId, taskVersion } = plan.resolvedBinding;
      if (taskRepo) {
        const version = await taskRepo.getTaskVersion(taskId, taskVersion);
        if (!version) {
          throw new StorageError(
            "validation",
            `Task version ${taskId}@v${taskVersion} not found in repository.`,
          );
        }
        if (plan.candidateInstance) {
          const availableBytes = deps.availableArtifactBytes ?? new Map<string, Uint8Array>();
          const instanceCandidate: TaskInstance = {
            ...plan.candidateInstance,
            sourceRef: { kind: "comparison", legacyScopeKey: null, originId: runId },
          };
          const instanceResult = await taskRepo.getOrCreateTaskInstance(
            instanceCandidate,
            availableBytes,
          );
          taskInstanceId = instanceResult.instance.id;
        }
      }
    }

    // Step 3 & 5: Create or update Comparison Result index with immutable input snapshot reference / linkage
    if (comparisonRepo) {
      const record = recorder ? await recorder.getRecord(runId) : null;

      const sourceRecord: RunRecordV2 = record ?? {
        schemaVersion: 2,
        id: runId,
        revision: 0,
        execution: { ownerId: "tab-1", fence: 0 },
        createdAt: plan.snapshot.createdAt,
        updatedAt: plan.snapshot.createdAt,
        completedAt: null,
        source: { kind: "adhoc" },
        status: "running",
        mode: plan.snapshot.mode,
        task: {
          title: plan.snapshot.prompt.slice(0, 80),
          prompt: plan.snapshot.prompt,
          systemPrompt: plan.snapshot.systemPrompt,
          temperature: plan.snapshot.temperature,
        },
        evaluation: {
          profile: resolveEvaluationRubric(plan.snapshot.evaluation),
          candidateMessages: [],
        },
        candidates: [],
        judge: {
          status: "idle",
          acceptedAttemptId: null,
          report: null,
          consensus: null,
          attempts: [],
        },
        fusion: {
          status: "idle",
          acceptedAttemptId: null,
          attempts: [],
        },
        winnerKeys: [],
      };

      await comparisonRepo.createComparisonEnvelope(sourceRecord, plan.resolvedBinding, {
        ...plan.envelopeOptions,
        taskInstanceId,
      });
    }

    return {
      ok: true,
      runId,
      snapshot: plan.snapshot,
      taskBinding: plan.resolvedBinding,
      taskInstanceId,
    };
  } catch (err) {
    // Compensation: mark run aborted if recorder created it
    if (recorder && runId) {
      try {
        await recorder.markAborted(runId);
      } catch {
        // best-effort compensation
      }
    }
    throw err;
  }
}
