// =============================================================================
// Run controller — extracted pipeline orchestration from rsemble.tsx.
// Owns fanout → judge → fusion, abort, retry, and fusion triggering.
// =============================================================================

import { type Candidate } from "../studio-data";
import {
  buildFanoutJobs,
  isUsableCandidate,
  checkFusionEligibility,
  checkAttachmentEligibility,
} from "./pipeline";
import { resolveEvaluationProfile } from "./evaluations/evaluation-profile-adhoc";
import { evaluateComparePreflight, type ComparePreflight } from "./compare-preflight";
import type { RunRecorder } from "./persistence/run-recorder";
import type { ExecutionFence } from "./persistence/run-types";
import { HEARTBEAT_INTERVAL, type ExecutionLease, type LeaseInfo } from "./execution-lease";
import { createExecutionHeartbeat, type ExecutionHeartbeat } from "./execution-heartbeat";
import { createRunExecutor, type RunExecutorEvents } from "./run-executor";
import type { StudioState, Action, RunEvaluationContext } from "../studio-engine";
import type { StreamDeltaBuffer } from "./stream-buffer";

export interface RunControllerDeps {
  stateRef: React.MutableRefObject<StudioState>;
  dispatch: React.Dispatch<Action>;
  runEpochRef: React.MutableRefObject<number>;
  abortControllersRef: React.MutableRefObject<Set<AbortController>>;
  streamBuffer: StreamDeltaBuffer;
  /** Random source for the blind-label shuffle (spec §5.1). Tests inject a
   *  deterministic source to control the permutation; defaults to Math.random. */
  random?: () => number;
  /** Clock for timestamps. Tests inject deterministic. Defaults to Date.now. */
  now?: () => number;
  /** Durable persistence layer. When present, lifecycle records replace
   *  localStorage addRun calls. When absent (storage unavailable), the
   *  controller keeps evidence in memory only — never falls back to addRun. */
  recorder?: RunRecorder;
  /** Root-provided readiness snapshot so every paid entry point uses the same
   * deterministic preflight result. Tests may omit it; the local fallback still
   * enforces task/cardinality/attachment gates without network calls. */
  preflight?: (state: StudioState) => ComparePreflight;
  /** Actual cross-tab fence for persisted ad-hoc run provenance. */
  executionFence?: () => ExecutionFence | null;
  /** undefined = injected unit-test bypass; null = production storage failure (fail closed). */
  lease?: ExecutionLease | null;
}

export function createRunController(deps: RunControllerDeps) {
  const { stateRef, dispatch, runEpochRef, abortControllersRef, streamBuffer, recorder } = deps;
  const random = deps.random ?? Math.random;
  const now = deps.now ?? (() => Date.now());
  const executor = createRunExecutor({ random, now });
  const preflight = deps.preflight ?? ((state: StudioState): ComparePreflight =>
    evaluateComparePreflight({
      running: state.running,
      experimentActive: false,
      prompt: state.prompt,
      slots: state.slots,
      readinessMap: Object.fromEntries(state.slots.map((slot) => [slot.providerId, true])),
      critic: state.critic,
      attachments: state.attachments,
      attachmentEligibility: checkAttachmentEligibility(state.slots, state.attachments),
    })
  );
  const runIdRef: { current: string | null } = { current: null };
  const currentAbortRef: { current: AbortController | null } = { current: null };
  const activeLeaseRef: { current: LeaseInfo | null } = { current: null };
  // Cleanup epoch fences asynchronous finally blocks from an earlier run. A
  // late cleanup must never clear the heartbeat or release a newer lease.
  let leaseEpoch = 0;
  let heartbeat: ExecutionHeartbeat | null = null;
  let leaseUnsubscribe: (() => void) | null = null;
  const leaseLostRef: { current: boolean } = { current: false };
  // Abort persistence must finish before lease release, otherwise the
  // executor's finally block could surrender the fence before markAborted.
  const abortPersistenceRef: { current: Promise<void> | null } = { current: null };

  async function acquireSharedLease(executionId: string, abort?: AbortController): Promise<boolean> {
    if (deps.lease === undefined) return true; // narrow injected unit-test seam
    if (deps.lease === null) return false;
    try {
      const lease = await deps.lease.acquire({ kind: "compare", executionId });
      const epoch = ++leaseEpoch;
      leaseLostRef.current = false;
      activeLeaseRef.current = lease;

      // Broadcast/poll notifications are advisory for transport, but the
      // current token in the notification is authoritative for this local
      // controller. Invalidate immediately on a takeover instead of waiting
      // for the next heartbeat, which closes the late-terminal UI window.
      const invalidateIfCurrent = () => {
        const current = activeLeaseRef.current;
        if (
          epoch !== leaseEpoch ||
          current?.ownerId !== lease.ownerId ||
          current.fence !== lease.fence ||
          current.leaseId !== lease.leaseId
        ) return;
        if (leaseLostRef.current) return;
        leaseLostRef.current = true;
        runEpochRef.current += 1;
        streamBuffer.cancel();
        abort?.abort();
        dispatch({ type: "LEASE_LOST", message: "Compare execution lost its lease to another browser tab." });
      };

      leaseUnsubscribe?.();
      leaseUnsubscribe = deps.lease.subscribe((state) => {
        const current = activeLeaseRef.current;
        const currentMatchesCaptured = current &&
          current.ownerId === lease.ownerId &&
          current.fence === lease.fence &&
          current.leaseId === lease.leaseId;
        if (!currentMatchesCaptured) return;
        const stateMatchesCaptured = state.status === "owned" &&
          state.lease.ownerId === lease.ownerId &&
          state.lease.fence === lease.fence &&
          state.lease.leaseId === lease.leaseId;
        if (stateMatchesCaptured) {
          // Keep the expiry metadata current without changing the token.
          activeLeaseRef.current = state.lease;
          return;
        }
        // A different live token (including a same-owner reacquisition) or a
        // free/expired state invalidates this controller immediately.
        invalidateIfCurrent();
      });

      const heartbeatForLease = createExecutionHeartbeat({
        intervalMs: HEARTBEAT_INTERVAL,
        renew: async () => {
          try {
            const renewed = await deps.lease!.renew(lease);
            if (activeLeaseRef.current?.ownerId === lease.ownerId &&
                activeLeaseRef.current.fence === lease.fence &&
                activeLeaseRef.current.leaseId === lease.leaseId) {
              activeLeaseRef.current = renewed;
            }
            return renewed;
          } catch (error) {
            invalidateIfCurrent();
            throw error;
          }
        },
        onError: invalidateIfCurrent,
      });
      heartbeat = heartbeatForLease;
      heartbeatForLease.start();
      return true;
    } catch {
      leaseUnsubscribe?.();
      leaseUnsubscribe = null;
      activeLeaseRef.current = null;
      return false;
    }
  }

  async function releaseSharedLease(
    token: LeaseInfo | null = activeLeaseRef.current,
    epoch = leaseEpoch,
  ): Promise<void> {
    const pendingAbort = abortPersistenceRef.current;
    if (pendingAbort) {
      await pendingAbort;
      if (abortPersistenceRef.current === pendingAbort) abortPersistenceRef.current = null;
    }
    const current = activeLeaseRef.current;
    const isCurrent = token !== null && epoch === leaseEpoch &&
      current?.ownerId === token.ownerId && current.fence === token.fence && current.leaseId === token.leaseId;
    if (isCurrent) {
      // Invalidate timer callbacks before awaiting IndexedDB, so a new run can
      // acquire/restart safely while this cleanup is still unwinding.
      leaseEpoch++;
      heartbeat?.stop();
      heartbeat = null;
      leaseUnsubscribe?.();
      leaseUnsubscribe = null;
      activeLeaseRef.current = null;
    }
    if (deps.lease && token) {
      try { await deps.lease.release(token); } catch { /* expiry remains crash-safe */ }
    }
  }

  async function assertCurrentLease(token: LeaseInfo | null | undefined): Promise<void> {
    if (deps.lease === undefined) return;
    if (!deps.lease || !token || !(await deps.lease.verify(token))) {
      throw new Error("Execution lease lost; stale controller rejected");
    }
  }

  function freshAbort(): AbortController {
    const ctrl = new AbortController();
    currentAbortRef.current = ctrl;
    abortControllersRef.current.add(ctrl);
    return ctrl;
  }

  // --- Events adapter: executor events → dispatch + recorder -----------------

  function makeEvents(
    epoch: number,
    isRetry = false,
    slotsOverride?: StudioState["slots"],
    frozenContext?: RunEvaluationContext,
    leaseToken?: LeaseInfo,
  ): RunExecutorEvents {
    const candidateAttemptIds: Record<string, string> = {};
    // Capture the exact lease token for this execution. All recorder writes
    // use this immutable token; a later acquisition by another tab cannot be
    // mistaken for continued ownership.
    const capturedLease = leaseToken ?? activeLeaseRef.current;
    const persistedFence: ExecutionFence | undefined = capturedLease
      ? { ownerId: capturedLease.ownerId, fence: capturedLease.fence, ...(capturedLease.leaseId ? { leaseId: capturedLease.leaseId } : {}) }
      : undefined;
    // Legacy contexts may omit mode; capture the fallback at event creation so
    // a command-pane edit cannot rewrite persisted protocol state later.
    const capturedMode = frozenContext?.mode ?? stateRef.current.mode;
    const executionCurrent = () =>
      runEpochRef.current === epoch &&
      !leaseLostRef.current &&
      (deps.lease === undefined || (
        capturedLease != null &&
        activeLeaseRef.current?.ownerId === capturedLease.ownerId &&
        activeLeaseRef.current?.fence === capturedLease.fence &&
        activeLeaseRef.current?.leaseId === capturedLease.leaseId
      ));
    const ensureCurrent = async (): Promise<void> => {
      if (!executionCurrent()) throw new Error("Execution lease lost; stale controller rejected");
      await assertCurrentLease(capturedLease);
      if (!executionCurrent()) throw new Error("Execution lease lost; stale controller rejected");
    };

    return {
      onFanoutStart: async () => {
        await ensureCurrent();
        // The executor may yield before this lifecycle callback runs. Never
        // rebuild the run from mutable command-pane state here; the caller
        // captured one immutable protocol snapshot before execution began.
        const s = stateRef.current;
        const context = frozenContext ?? {
          mode: s.mode,
          task: { prompt: s.prompt, systemPrompt: s.systemPrompt, temperature: s.temperature },
          prompt: s.prompt,
          evaluation: s.evaluation,
          slots: (slotsOverride ?? s.slots).map((slot) => ({ ...slot })),
          critic: { ...s.critic },
          judgeInstruction: s.judgeInstruction,
          attachments: s.attachments.map((a) => ({ ...a })),
          attachmentsToJudge: s.attachmentsToJudge,
          reasoningPolicy: { ...s.reasoningPolicy },
        } satisfies RunEvaluationContext;
        const runId = `run-${now()}-${random().toString(36).slice(2, 8)}`;
        runIdRef.current = runId;
        // The eligibility gate may have filtered slots for this run
        // (spec §5.1 auto-disable) — placeholders must match what the executor
        // actually fans out, or the candidate roster would include ghosts.
        const jobs = buildFanoutJobs(slotsOverride ?? s.slots);
        const ts = now();
        const placeholders: Candidate[] = jobs.map((j) => ({
          id: j.id, model: j.displayName, provider: j.provider, providerId: j.providerId,
          slug: j.slug, accent: j.accent, strategy: j.strategyLabel,
          summary: "", scores: {}, weightedScore: 0, segments: [], status: "pending",
          startedAt: ts,
        }));
        if (recorder) {
          await assertCurrentLease(leaseToken);
          await recorder.begin({
            runId,
            source: { kind: "adhoc" },
            mode: context.mode ?? capturedMode,
            task: {
              title: context.prompt.slice(0, 80),
              ...(context.task ?? { prompt: context.prompt, systemPrompt: s.systemPrompt, temperature: s.temperature }),
            },
            // Persist the resolved evaluation profile so run evidence (and
            // summary provenance) reflects the actual frozen scoring protocol.
            evaluation: { profile: resolveEvaluationProfile(context.evaluation), candidateMessages: [] },
            // The eligibility gate may have filtered slots — the record must
            // match the exact roster that actually ran.
            slots: context.slots ?? slotsOverride ?? s.slots,
            critic: context.critic ?? s.critic,
            reasoningPolicy: context.reasoningPolicy ? { ...context.reasoningPolicy } : undefined,
            fence: persistedFence ?? deps.executionFence?.() ?? { ownerId: "tab-1", fence: epoch },
            // Attachment metadata only — never bytes or text (spec §9).
            attachments: context.attachments.map((a) => ({ name: a.name, kind: a.kind, bytes: a.bytes })),
          });
        }
        await ensureCurrent();
        dispatch({
          type: "FANOUT_START",
          candidates: placeholders,
          context: {
            mode: context.mode ?? capturedMode,
            task: context.task
              ? { ...context.task }
              : { prompt: context.prompt, systemPrompt: s.systemPrompt, temperature: s.temperature },
            evaluation: context.evaluation,
            slots: context.slots ?? slotsOverride ?? s.slots,
            critic: context.critic ?? s.critic,
            judgeInstruction: context.judgeInstruction ?? s.judgeInstruction,
            attachments: context.attachments,
            attachmentsToJudge: context.attachmentsToJudge,
            reasoningPolicy: context.reasoningPolicy ? { ...context.reasoningPolicy } : undefined,
            prompt: context.prompt,
          },
        });
      },

      onCandidateDelta: (candidateId, delta) => {
        if (executionCurrent()) {
          streamBuffer.push(candidateId, delta);
        }
      },

      onCandidateTerminal: async (candidateId, result) => {
        await ensureCurrent();
        streamBuffer.flush();
        dispatch({
          type: isRetry ? "RETRY_CANDIDATE_RESULT" : "CANDIDATE_RESULT",
          id: candidateId,
          segments: result.segments,
          summary: result.summary,
          finishedAt: result.finishedAt,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        });
      },

      onFanoutTerminal: async (done) => {
        await ensureCurrent();
        if (recorder && runIdRef.current) {
          await recorder.saveFanout(runIdRef.current, { candidates: done }, persistedFence);
        }
        await ensureCurrent();
        dispatch({ type: "FANOUT_END", count: done.length });
      },

      onCandidateAttemptStart: async (candidateId, attemptId, input) => {
        await ensureCurrent();
        candidateAttemptIds[candidateId] = attemptId;
        if (recorder && runIdRef.current) {
          await recorder.beginCandidateAttempt(runIdRef.current, candidateId, attemptId, {
            attemptId, messages: input.messages, startedAt: input.startedAt,
          }, persistedFence);
        }
        await ensureCurrent();
      },

      onCandidateAttemptTerminal: async (candidateId, attemptId, input) => {
        await ensureCurrent();
        if (recorder && runIdRef.current) {
          await recorder.finishCandidateAttempt(runIdRef.current, candidateId, attemptId, input, persistedFence);
        }
        await ensureCurrent();
        if (input.status === "failed") {
          dispatch({
            type: isRetry ? "RETRY_CANDIDATE_FAILED" : "CANDIDATE_FAILED",
            id: candidateId,
            error: input.error?.message ?? "Candidate failed",
            finishedAt: input.finishedAt,
          });
        }
      },

      onJudgeStart: async (attemptId, input) => {
        await ensureCurrent();
        if (recorder && runIdRef.current) {
          await recorder.beginJudgeAttempt(runIdRef.current, attemptId, input, persistedFence);
        }
        await ensureCurrent();
        dispatch({ type: "JUDGE_START" });
      },

      onJudgeTerminal: async (attemptId, input) => {
        await ensureCurrent();
        if (recorder && runIdRef.current) {
          await recorder.finishJudgeAttempt(runIdRef.current, attemptId, input, persistedFence);
        }
        await ensureCurrent();
        if (input.status === "completed" && input.report) {
          dispatch({
            type: "JUDGE_RESULT",
            // A terminal Judge transition is protocol state, so never consult
            // the mutable command-pane mode after execution begins.
            mode: frozenContext?.mode ?? capturedMode,
            consensus: input.consensus!,
            scoresById: Object.fromEntries(
              Object.entries(input.report.evaluationsById).map(
                ([cid, ev]) => [cid, ev.overallScore],
              ),
            ),
            report: input.report,
          });
        } else if (input.status === "failed") {
          dispatch({ type: "JUDGE_FAILED", error: input.error?.message ?? "Judge failed" });
        }
      },

      onFusionStart: async (attemptId, input) => {
        await ensureCurrent();
        if (recorder && runIdRef.current) {
          await recorder.beginFusionAttempt(runIdRef.current, attemptId, input, persistedFence);
        }
        await ensureCurrent();
        dispatch({ type: "FUSION_START" });
      },

      onFusionTerminal: async (attemptId, input) => {
        await ensureCurrent();
        if (recorder && runIdRef.current) {
          await recorder.finishFusionAttempt(runIdRef.current, attemptId, input, persistedFence);
        }
        await ensureCurrent();
        if (input.status === "completed" && input.result) {
          dispatch({ type: "FUSION_RESULT", text: input.result });
        } else if (input.status === "failed") {
          dispatch({ type: "FUSION_FAILED", error: input.error?.message ?? "Fusion failed" });
        }
      },
    };
  }

  const runFanout = async () => {
    const s = stateRef.current;
    const gate = preflight(s);
    if (!gate.ok) {
      dispatch({ type: "FANOUT_BLOCKED", reason: gate.message });
      return;
    }

    // The controller is the last line of defence behind every UI entry point;
    // the shared result above has already rejected cardinality, readiness, task,
    // attachment lifecycle, and capability failures before any adapter call.
    // Attachment gate (spec §5.1, plan 7.6.6): never start a fanout where a
    // model would answer blind. Blocked → visible audit trail; auto-disable →
    // the run proceeds with the capable slots (matching the strip's explicit
    // "Disable incompatible" action).
    const eligibility = checkAttachmentEligibility(s.slots, s.attachments);
    if ("blocked" in eligibility) {
      dispatch({ type: "FANOUT_BLOCKED", reason: eligibility.blocked });
      return;
    }
    let slots = s.slots;
    if ("autoDisable" in eligibility) {
      const dropped = new Set(eligibility.autoDisable);
      slots = slots.filter((sl) => !dropped.has(sl.id));
      for (const id of eligibility.autoDisable) {
        dispatch({ type: "TOGGLE_SLOT", id });
      }
    }

    const jobs = buildFanoutJobs(slots);
    if (jobs.length < 2) {
      dispatch({
        type: "FANOUT_BLOCKED",
        reason: jobs.length === 0
          ? "Enable at least two candidate models."
          : "Add or enable one more candidate to compare.",
      });
      return;
    }

    // Capture every protocol-affecting input once. Retries and later stages
    // receive this same object even if the command pane changes meanwhile.
    const frozenContext: RunEvaluationContext = {
      mode: s.mode,
      task: { prompt: s.prompt, systemPrompt: s.systemPrompt, temperature: s.temperature },
      prompt: s.prompt,
      evaluation: s.evaluation,
      slots: slots.map((slot) => ({ ...slot })),
      critic: { ...s.critic },
      judgeInstruction: s.judgeInstruction,
      attachments: s.attachments.map((a) => ({ ...a })),
      attachmentsToJudge: s.attachmentsToJudge,
      reasoningPolicy: { ...s.reasoningPolicy },
    };
    const epoch = ++runEpochRef.current;
    abortControllersRef.current.clear();
    const abort = freshAbort();

    if (!(await acquireSharedLease(`compare-${epoch}`, abort))) {
      dispatch({ type: "FANOUT_BLOCKED", reason: deps.lease === null
        ? "Shared execution storage is unavailable; Compare is blocked to prevent duplicate paid runs."
        : "Another execution is active in this browser. Wait for it to finish before comparing." });
      return;
    }
    const leaseToken = activeLeaseRef.current;
    const leaseScope = leaseEpoch;
    try {
      const events = makeEvents(epoch, false, slots, frozenContext, leaseToken ?? undefined);
      await executor.executeTask({
        source: { kind: "adhoc" },
        mode: frozenContext.mode!,
        task: { ...frozenContext.task! },
        evaluation: frozenContext.evaluation,
        slots: frozenContext.slots!,
        critic: frozenContext.critic!,
        judgeInstruction: frozenContext.judgeInstruction!,
        attachments: frozenContext.attachments,
        attachmentsToJudge: frozenContext.attachmentsToJudge,
        reasoningPolicy: { ...frozenContext.reasoningPolicy! },
      }, events, abort.signal);

      // Insufficient candidates check
      if (runEpochRef.current === epoch) {
        const s2 = stateRef.current;
        const done = s2.candidates.filter(isUsableCandidate);
        if (done.length < 2) {
          dispatch({
            type: "INSUFFICIENT_CANDIDATES",
            done: done.length,
            failed: s2.candidates.length - done.length,
          });
        }
      }
    } finally {
      await releaseSharedLease(leaseToken, leaseScope);
    }
  };

  const abortRun = () => {
    runEpochRef.current += 1;
    const controllers = abortControllersRef.current;
    for (const c of controllers) c.abort();
    controllers.clear();
    streamBuffer.cancel();
    dispatch({ type: "ABORT_RUN" });
    // Capture the run identity before the asynchronous lease check. A
    // continuation can start before this promise settles; reading runIdRef in
    // the callback could otherwise abort that newer run.
    const abortedRunId = runIdRef.current;
    if (recorder && abortedRunId) {
      const token = activeLeaseRef.current;
      const fence = token
        ? { ownerId: token.ownerId, fence: token.fence, ...(token.leaseId ? { leaseId: token.leaseId } : {}) }
        : undefined;
      abortPersistenceRef.current = assertCurrentLease(token)
        .then(() => recorder.markAborted(abortedRunId, fence))
        .catch(() => {
          // A reclaimed lease must not allow a stale abort callback to mutate
          // the new owner's run; the repository fence is the final guard.
        });
    }
  };

  const retryCandidate = async (candidate: Candidate) => {
    if (stateRef.current.running) return;
    const s = stateRef.current;
    const ctx = s.runContext;
    // Resolve identity against the frozen roster. A retry is a continuation of
    // the original protocol, not a new run using whatever model the user has
    // since selected in the command pane.
    const frozenSlots = ctx?.slots ?? s.slots;
    const slotId = candidate.id.startsWith("cand-") ? candidate.id.slice("cand-".length) : null;
    const slot =
      (slotId ? frozenSlots.find((sl) => sl.id === slotId) : undefined) ??
      frozenSlots.find((sl) => sl.slug === candidate.slug && sl.providerId === candidate.providerId) ??
      frozenSlots.find((sl) => sl.slug === candidate.slug);
    if (!slot) return;

    const epoch = ++runEpochRef.current;
    abortControllersRef.current.clear();
    const abort = freshAbort();
    if (!(await acquireSharedLease(`retry-candidate-${candidate.id}`, abort))) {
      dispatch({ type: "FANOUT_BLOCKED", reason: deps.lease === null
        ? "Shared execution storage is unavailable; retry is blocked to prevent duplicate paid runs."
        : "Another execution is active in this browser. Wait for it to finish before retrying." });
      return;
    }
    const leaseToken = activeLeaseRef.current;
    const leaseScope = leaseEpoch;
    try {
      await assertCurrentLease(leaseToken);
      dispatch({ type: "RETRY_CANDIDATE_START", id: candidate.id });
      if (recorder && runIdRef.current && leaseToken) {
        await assertCurrentLease(leaseToken);
        await recorder.rebindExecution(runIdRef.current, { ownerId: leaseToken.ownerId, fence: leaseToken.fence, ...(leaseToken.leaseId ? { leaseId: leaseToken.leaseId } : {}) });
      }

    const events = makeEvents(epoch, true, frozenSlots, ctx ?? undefined, leaseToken ?? undefined);
    const peerCandidates = s.candidates.filter((c) => c.id !== candidate.id);

    // Load the persisted record to get real accepted attempt IDs
    let candidateAttemptIdsByCandidateId: Record<string, string> = {};
    if (recorder && runIdRef.current) {
      const record = await recorder.getRecord(runIdRef.current);
      if (record) {
        for (const c of record.candidates) {
          if (c.acceptedAttemptId) {
            candidateAttemptIdsByCandidateId[c.candidateId] = c.acceptedAttemptId;
          }
        }
      }
    }

    await executor.retryCandidate({
      source: { kind: "adhoc" },
      mode: ctx?.mode ?? s.mode,
      task: ctx?.task ?? { prompt: s.prompt, systemPrompt: s.systemPrompt, temperature: s.temperature },
      evaluation: ctx?.evaluation ?? s.evaluation,
      slots: frozenSlots,
      critic: ctx?.critic ?? s.critic,
      judgeInstruction: ctx?.judgeInstruction ?? s.judgeInstruction,
      // Frozen attachment set — the retry must reproduce the original input
      // even if the user edited the command pane since the run (plan 7.6.6).
      attachments: ctx?.attachments ?? [],
      attachmentsToJudge: ctx?.attachmentsToJudge ?? true,
      reasoningPolicy: { ...(ctx?.reasoningPolicy ?? s.reasoningPolicy) },
      retryCandidateId: candidate.id,
      retrySlotId: slot.id,
      peerCandidates,
      candidateAttemptIdsByCandidateId,
    }, events, abort.signal);
    } finally {
      await releaseSharedLease(leaseToken, leaseScope);
    }
  };

  const retryJudge = async (): Promise<void> => {
    const s = stateRef.current;
    if (s.running || s.aborted || s.judgeStatus !== "error") return;

    const done = s.candidates.filter(isUsableCandidate);
    if (done.length < 2) {
      dispatch({
        type: "INSUFFICIENT_CANDIDATES",
        done: done.length,
        failed: s.candidates.length - done.length,
      });
      return;
    }

    const ctx = s.runContext;
    if (!ctx) {
      dispatch({
        type: "JUDGE_FAILED",
        error:
          "Cannot retry the Judge: the original run context is no longer available. Re-run the full pipeline from the command pane.",
      });
      return;
    }

    const epoch = ++runEpochRef.current;
    abortControllersRef.current.clear();
    const abort = freshAbort();
    if (!(await acquireSharedLease("retry-judge", abort))) {
      dispatch({ type: "FANOUT_BLOCKED", reason: deps.lease === null
        ? "Shared execution storage is unavailable; Judge retry is blocked to prevent duplicate paid runs."
        : "Another execution is active in this browser. Wait for it to finish before retrying." });
      return;
    }
    const leaseToken = activeLeaseRef.current;
    const leaseScope = leaseEpoch;
    try {
      await assertCurrentLease(leaseToken);
      if (recorder && runIdRef.current && leaseToken) {
        await assertCurrentLease(leaseToken);
        await recorder.rebindExecution(runIdRef.current, { ownerId: leaseToken.ownerId, fence: leaseToken.fence, ...(leaseToken.leaseId ? { leaseId: leaseToken.leaseId } : {}) });
      }

    // Load the persisted record to get real accepted attempt IDs
    let candidateAttemptIdsByCandidateId: Record<string, string> = {};
    if (recorder && runIdRef.current) {
      const record = await recorder.getRecord(runIdRef.current);
      if (record) {
        for (const c of record.candidates) {
          if (c.acceptedAttemptId) {
            candidateAttemptIdsByCandidateId[c.candidateId] = c.acceptedAttemptId;
          }
        }
      }
    }

    const events = makeEvents(epoch, false, ctx.slots, ctx, leaseToken ?? undefined);
    await executor.retryJudge({
      mode: ctx.mode ?? s.mode,
      task: ctx.task ?? { prompt: ctx.prompt, systemPrompt: s.systemPrompt, temperature: 0.4 },
      evaluation: ctx.evaluation,
      candidates: done,
      critic: ctx.critic ?? s.critic,
      judgeInstruction: ctx.judgeInstruction ?? s.judgeInstruction,
      attachments: ctx.attachments,
      attachmentsToJudge: ctx.attachmentsToJudge,
      reasoningPolicy: { ...(ctx.reasoningPolicy ?? s.reasoningPolicy) },
      candidateAttemptIdsByCandidateId,
    }, events, abort.signal);
    } finally {
      await releaseSharedLease(leaseToken, leaseScope);
    }
  };

  const triggerFusion = (force = false) => {
    const s = stateRef.current;
    if (s.running) return;

    const eligibility = checkFusionEligibility(s.candidates);
    if (!eligibility.ok) {
      if (!force && s.fusionStatus === "done") return;
      dispatch({
        type: "INSUFFICIENT_CANDIDATES",
        done: eligibility.done,
        failed: eligibility.failed,
      });
      return;
    }
    if (!force && s.fusionStatus === "done") return;
    if (s.aborted) return;
    if (s.judgeStatus !== "done" || s.judgeReport === null) return;

    const epoch = ++runEpochRef.current;
    abortControllersRef.current.clear();
    const abort = freshAbort();

    void (async () => {
      if (!(await acquireSharedLease("fusion", abort))) {
        dispatch({ type: "FANOUT_BLOCKED", reason: deps.lease === null
          ? "Shared execution storage is unavailable; Fusion is blocked to prevent duplicate paid runs."
          : "Another execution is active in this browser. Wait for it to finish before fusion." });
        return;
      }
      const leaseToken = activeLeaseRef.current;
      const leaseScope = leaseEpoch;
      try {
        await assertCurrentLease(leaseToken);
        if (recorder && runIdRef.current && leaseToken) {
          await assertCurrentLease(leaseToken);
          await recorder.rebindExecution(runIdRef.current, { ownerId: leaseToken.ownerId, fence: leaseToken.fence, ...(leaseToken.leaseId ? { leaseId: leaseToken.leaseId } : {}) });
        }
        // Load the persisted record for real accepted attempt IDs
        let candidateAttemptIdsByCandidateId: Record<string, string> = {};
        let judgeAttemptId = "";
        let blindLabelToCandidateId: Record<string, string> = {};
        if (recorder && runIdRef.current) {
          const record = await recorder.getRecord(runIdRef.current);
          if (record) {
            for (const c of record.candidates) {
              if (c.acceptedAttemptId) {
                candidateAttemptIdsByCandidateId[c.candidateId] = c.acceptedAttemptId;
              }
            }
            judgeAttemptId = record.judge.acceptedAttemptId ?? "";
            const acceptedJudge = record.judge.attempts.find(
              (a) => a.attemptId === record.judge.acceptedAttemptId,
            );
            if (acceptedJudge) {
              blindLabelToCandidateId = acceptedJudge.blindLabelToCandidateId;
            }
          }
        }

        const ctx = stateRef.current.runContext;
        const events = makeEvents(epoch, false, ctx?.slots, ctx ?? undefined, leaseToken ?? undefined);
        await executor.executeFusionAttempt({
          mode: "fuse",
          task: ctx?.task ?? { prompt: s.prompt, systemPrompt: s.systemPrompt, temperature: 0.3 },
          evaluation: ctx?.evaluation ?? s.evaluation,
          candidates: eligibility.usable,
          critic: ctx?.critic ?? s.critic,
          judgeInstruction: ctx?.judgeInstruction ?? s.judgeInstruction,
          attachments: ctx?.attachments ?? s.attachments,
          attachmentsToJudge: ctx?.attachmentsToJudge ?? s.attachmentsToJudge,
          reasoningPolicy: { ...(ctx?.reasoningPolicy ?? s.reasoningPolicy) },
          judgeAttemptId,
          blindLabelToCandidateId,
          candidateAttemptIdsByCandidateId,
        }, events, abort.signal);
      } finally {
        await releaseSharedLease(leaseToken, leaseScope);
      }
    })();
  };

  return {
    runFanout,
    abortRun,
    retryCandidate,
    retryJudge,
    triggerFusion,
  };
}
