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

import type { RunRepository } from "./run-repository";
import type { RunRecordV2 } from "./run-types";
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

// --- Recorder interface ------------------------------------------------------

export interface RunRecorder {
  begin(input: BeginRunInput): Promise<string>;
  saveFanout(runId: string, input: FanoutTerminalInput): Promise<void>;
  beginCandidateAttempt(runId: string, candidateId: string, attemptId: string, input: CandidateAttemptStartInput): Promise<void>;
  finishCandidateAttempt(runId: string, candidateId: string, attemptId: string, input: CandidateTerminalInput): Promise<void>;
  beginJudgeAttempt(runId: string, attemptId: string, input: JudgeAttemptStartInput): Promise<void>;
  finishJudgeAttempt(runId: string, attemptId: string, input: JudgeTerminalInput): Promise<void>;
  beginFusionAttempt(runId: string, attemptId: string, input: FusionAttemptStartInput): Promise<void>;
  finishFusionAttempt(runId: string, attemptId: string, input: FusionTerminalInput): Promise<void>;
  markAborted(runId: string): Promise<void>;
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

export function createRunRecorder(
  repo: RunRepository,
  builderDeps: BuilderDeps = { now: () => Date.now() },
): RunRecorder {
  const builder = createRunRecordBuilder(builderDeps);
  const queues = new RunWriteQueue();

  async function loadAndMutate(
    runId: string,
    mutate: (record: RunRecordV2, state: RunRecordBuilderState) => void,
  ): Promise<void> {
    return queues.enqueue(runId, async () => {
      const record = await repo.get(runId);
      if (!record) throw new Error(`Run ${runId} not found`);
      const state: RunRecordBuilderState = { record };
      mutate(record, state);
      const summary = builder.deriveSummary(record);
      const newRevision = await repo.update(record, summary, record.revision);
      record.revision = newRevision;
    });
  }

  async function begin(input: BeginRunInput): Promise<string> {
    const state = builder.createInitialState();
    const record = builder.applyFanoutStart(state, input);
    const summary = builder.deriveSummary(record);
    await repo.create(record, summary);
    return input.runId;
  }

  async function saveFanout(runId: string, input: FanoutTerminalInput): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyFanoutTerminal(state, record, input.candidates);
    });
  }

  async function beginCandidateAttempt(
    runId: string,
    candidateId: string,
    _attemptId: string,
    input: CandidateAttemptStartInput,
  ): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyCandidateAttemptStart(state, record, candidateId, input);
    });
  }

  async function finishCandidateAttempt(
    runId: string,
    candidateId: string,
    attemptId: string,
    input: CandidateTerminalInput,
  ): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyCandidateAttemptTerminal(state, record, candidateId, attemptId, input);
    });
  }

  async function beginJudgeAttempt(
    runId: string,
    attemptId: string,
    input: JudgeAttemptStartInput,
  ): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyJudgeStart(state, record, attemptId, input);
    });
  }

  async function finishJudgeAttempt(
    runId: string,
    attemptId: string,
    input: JudgeTerminalInput,
  ): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyJudgeTerminal(state, record, attemptId, input);
    });
  }

  async function beginFusionAttempt(
    runId: string,
    attemptId: string,
    input: FusionAttemptStartInput,
  ): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyFusionStart(state, record, attemptId, input);
    });
  }

  async function finishFusionAttempt(
    runId: string,
    attemptId: string,
    input: FusionTerminalInput,
  ): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyFusionTerminal(state, record, attemptId, input);
    });
  }

  async function markAborted(runId: string): Promise<void> {
    await loadAndMutate(runId, (record, state) => {
      builder.applyAborted(state, record);
    });
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
    markAborted,
    getRecord,
  };
}
