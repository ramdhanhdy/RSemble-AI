// =============================================================================
// RSemble AI — Run recorder (persistence layer)
//
// Persists stage boundaries via RunRepository. Serializes writes per run ID
// using a per-run mutex. Uses CAS with expectedRevision. No streamed deltas.
//
// The recorder loads the current record from the repository, applies the
// builder mutation, derives the summary, and persists via update(). The
// builder is injected for testability.
// =============================================================================

import type { ChatMessage, ContentPart } from "../providers/types";
import type { RunRepository } from "./run-repository";
import type { ExecutionFence, RunRecordV2 } from "./run-types";
import {
  createRunRecordBuilder,
  type RunRecordBuilderState,
  type BuilderDeps,
  type FanoutStartInput,
  type CandidateAttemptStartInput,
  type CandidateTerminalInput,
  type JudgeAttemptStartInput,
  type JudgeTerminalInput,
  type FusionAttemptStartInput,
  type FusionTerminalInput,
} from "./run-record-builder";

// --- Input types (mirror builder inputs) ------------------------------------

export interface BeginRunInput extends FanoutStartInput {}

export interface FanoutTerminalInput {
  candidates: unknown[];
}

/**
 * Run attempts retain prompt/audit text but never attachment bytes or extracted
 * document text. Multipart provider messages are reduced at the persistence
 * boundary because the live ContentPart[] includes inline base64 media.
 */
const ATTACHMENT_BLOCK_PART_RE =
  /^\s*(?:---\s*BEGIN\s+ATTACHMENT\s+\d+:[\s\S]*?---\s*END\s+ATTACHMENT\s+\d+\s*---\s*)+$/i;
const PERSISTED_ATTACHMENT_MARKER = "[attachment content omitted from persisted run record]";

function persistedMessage(message: ChatMessage): ChatMessage {
  // Attachment-free requests use plain strings. Preserve them exactly; the
  // block scrubber below is only for generated multipart attachment payloads.
  if (typeof message.content === "string") return message;

  let hadAttachmentText = false;
  const textParts = message.content
    .filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")
    .map((part, index) => {
      if (index === 0 || !ATTACHMENT_BLOCK_PART_RE.test(part.text)) return part.text;
      hadAttachmentText = true;
      return "";
    });
  const text = textParts.join("\n");
  const hasNativeMedia = message.content.some((part) => part.type === "image" || part.type === "file");
  const marker = hasNativeMedia || hadAttachmentText ? PERSISTED_ATTACHMENT_MARKER : "";

  return {
    role: message.role,
    content: marker
      ? `${text}${text.length === 0 ? "" : text.endsWith("\n") ? "\n" : "\n\n"}${marker}`
      : text,
  };

}

function persistedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(persistedMessage);
}

// --- Recorder interface ------------------------------------------------------

export interface RunRecorder {
  begin(input: BeginRunInput): Promise<string>;
  saveFanout(runId: string, input: FanoutTerminalInput, fence?: ExecutionFence): Promise<void>;
  beginCandidateAttempt(runId: string, candidateId: string, attemptId: string, input: CandidateAttemptStartInput, fence?: ExecutionFence): Promise<void>;
  finishCandidateAttempt(runId: string, candidateId: string, attemptId: string, input: CandidateTerminalInput, fence?: ExecutionFence): Promise<void>;
  beginJudgeAttempt(runId: string, attemptId: string, input: JudgeAttemptStartInput, fence?: ExecutionFence): Promise<void>;
  finishJudgeAttempt(runId: string, attemptId: string, input: JudgeTerminalInput, fence?: ExecutionFence): Promise<void>;
  beginFusionAttempt(runId: string, attemptId: string, input: FusionAttemptStartInput, fence?: ExecutionFence): Promise<void>;
  finishFusionAttempt(runId: string, attemptId: string, input: FusionTerminalInput, fence?: ExecutionFence): Promise<void>;
  /** Rebind a continuation (retry/fusion) to its newly acquired fence. */
  rebindExecution(runId: string, fence: ExecutionFence): Promise<void>;
  markAborted(runId: string, fence?: ExecutionFence): Promise<void>;
  getRecord(runId: string): Promise<RunRecordV2 | null>;
}

// --- Per-run write serialization --------------------------------------------

class RunWriteQueue {
  private queues = new Map<string, Promise<unknown>>();

  async enqueue<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(runId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(runId, next);
    try {
      return await next;
    } finally {
      // Clean up if this was the last write
      if (this.queues.get(runId) === next) {
        this.queues.delete(runId);
      }
    }
  }
}

// --- Factory -----------------------------------------------------------------

export interface RunRecorderOptions {
  /** Verify the initial create fence as well as continuation writes. */
  enforceLease?: boolean;
}

export function createRunRecorder(
  repo: RunRepository,
  builderDeps: BuilderDeps = { now: () => Date.now() },
  options: RunRecorderOptions = {},
): RunRecorder {
  const builder = createRunRecordBuilder(builderDeps);
  const queues = new RunWriteQueue();
  const enforceLease = options.enforceLease ?? false;

  async function loadAndMutate(
    runId: string,
    mutate: (record: RunRecordV2, state: RunRecordBuilderState) => void,
    fence?: ExecutionFence,
  ): Promise<void> {
    return queues.enqueue(runId, async () => {
      const record = await repo.get(runId);
      if (!record) throw new Error(`Run ${runId} not found`);
      // Capture the STORED revision before the builder mutation bumps
      // record.revision in memory — repo.update compares expectedRevision
      // against the stored row. Passing the post-mutation value fails the CAS
      // against Dexie (structured-clone isolation), while InMemoryRunRepository
      // masks it by storing the record object by reference.
      const expectedRevision = record.revision;
      const state: RunRecordBuilderState = { record };
      mutate(record, state);
      const summary = builder.deriveSummary(record);
      const newRevision = await repo.update(record, summary, expectedRevision, fence);
      record.revision = newRevision;
    });
  }

  async function begin(input: BeginRunInput): Promise<string> {
    const state = builder.createInitialState();
    const record = builder.applyFanoutStart(state, input);
    const summary = builder.deriveSummary(record);
    await repo.create(record, summary, enforceLease ? input.fence : undefined);
    return input.runId;
  }

  async function saveFanout(runId: string, input: FanoutTerminalInput, fence?: ExecutionFence): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyFanoutTerminal(state, record, input.candidates);
    }, fence);
  }

  async function beginCandidateAttempt(
    runId: string,
    candidateId: string,
    _attemptId: string,
    input: CandidateAttemptStartInput,
    fence?: ExecutionFence,
  ): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyCandidateAttemptStart(state, record, candidateId, {
        ...input,
        messages: persistedMessages(input.messages),
      });
    }, fence);
  }

  async function finishCandidateAttempt(
    runId: string,
    candidateId: string,
    attemptId: string,
    input: CandidateTerminalInput,
    fence?: ExecutionFence,
  ): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyCandidateAttemptTerminal(state, record, candidateId, attemptId, input);
    }, fence);
  }

  async function beginJudgeAttempt(
    runId: string,
    attemptId: string,
    input: JudgeAttemptStartInput,
    fence?: ExecutionFence,
  ): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyJudgeStart(state, record, attemptId, {
        ...input,
        messages: persistedMessages(input.messages),
      });
    }, fence);
  }

  async function finishJudgeAttempt(
    runId: string,
    attemptId: string,
    input: JudgeTerminalInput,
    fence?: ExecutionFence,
  ): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyJudgeTerminal(state, record, attemptId, input);
    }, fence);
  }

  async function beginFusionAttempt(
    runId: string,
    attemptId: string,
    input: FusionAttemptStartInput,
    fence?: ExecutionFence,
  ): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyFusionStart(state, record, attemptId, {
        ...input,
        messages: persistedMessages(input.messages),
      });
    }, fence);
  }

  async function finishFusionAttempt(
    runId: string,
    attemptId: string,
    input: FusionTerminalInput,
    fence?: ExecutionFence,
  ): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyFusionTerminal(state, record, attemptId, input);
    }, fence);
  }

  async function rebindExecution(runId: string, fence: ExecutionFence): Promise<void> {
    await loadAndMutate(runId, (record) => {
      if (record.source.kind === "adhoc") record.execution = { ...fence };
    }, fence);
  }

  async function markAborted(runId: string, fence?: ExecutionFence): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyAborted(state, record);
    }, fence);
  }

  async function getRecord(runId: string): Promise<RunRecordV2 | null> {
    return repo.get(runId);
  }

  return {
    begin,
    saveFanout,
    beginCandidateAttempt,
    finishCandidateAttempt,
    beginJudgeAttempt,
    finishJudgeAttempt,
    beginFusionAttempt,
    finishFusionAttempt,
    rebindExecution,
    markAborted,
    getRecord,
  };
}
