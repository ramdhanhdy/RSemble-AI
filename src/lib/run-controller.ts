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
  ): RunExecutorEvents {
    const candidateAttemptIds: Record<string, string> = {};

    return {
      onFanoutStart: async () => {
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
        dispatch({
          type: "FANOUT_START",
          candidates: placeholders,
          context: {
            mode: context.mode ?? s.mode,
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
        if (recorder) {
          await recorder.begin({
            runId,
            source: { kind: "adhoc" },
            mode: context.mode ?? s.mode,
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
            fence: { ownerId: "tab-1", fence: epoch },
            // Attachment metadata only — never bytes or text (spec §9).
            attachments: context.attachments.map((a) => ({ name: a.name, kind: a.kind, bytes: a.bytes })),
          });
        }
      },

      onCandidateDelta: (candidateId, delta) => {
        if (runEpochRef.current === epoch) {
          streamBuffer.push(candidateId, delta);
        }
      },

      onCandidateTerminal: (candidateId, result) => {
        streamBuffer.flush();
        if (runEpochRef.current !== epoch) return;
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
        if (runEpochRef.current === epoch) {
          dispatch({ type: "FANOUT_END", count: done.length });
        }
        if (recorder && runIdRef.current) {
          await recorder.saveFanout(runIdRef.current, { candidates: done });
        }
      },

      onCandidateAttemptStart: async (candidateId, attemptId, input) => {
        candidateAttemptIds[candidateId] = attemptId;
        if (recorder && runIdRef.current) {
          await recorder.beginCandidateAttempt(runIdRef.current, candidateId, attemptId, {
            attemptId, messages: input.messages, startedAt: input.startedAt,
          });
        }
      },

      onCandidateAttemptTerminal: async (candidateId, attemptId, input) => {
        if (runEpochRef.current === epoch && input.status === "failed") {
          dispatch({
            type: isRetry ? "RETRY_CANDIDATE_FAILED" : "CANDIDATE_FAILED",
            id: candidateId,
            error: input.error?.message ?? "Candidate failed",
            finishedAt: input.finishedAt,
          });
        }
        if (recorder && runIdRef.current) {
          await recorder.finishCandidateAttempt(runIdRef.current, candidateId, attemptId, input);
        }
      },

      onJudgeStart: async (attemptId, input) => {
        if (runEpochRef.current === epoch) {
          dispatch({ type: "JUDGE_START" });
        }
        if (recorder && runIdRef.current) {
          await recorder.beginJudgeAttempt(runIdRef.current, attemptId, input);
        }
      },

      onJudgeTerminal: async (attemptId, input) => {
        if (runEpochRef.current !== epoch) return;
        if (input.status === "completed" && input.report) {
          dispatch({
            type: "JUDGE_RESULT",
            mode: stateRef.current.mode,
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
        if (recorder && runIdRef.current) {
          await recorder.finishJudgeAttempt(runIdRef.current, attemptId, input);
        }
      },

      onFusionStart: async (attemptId, input) => {
        if (runEpochRef.current === epoch) {
          dispatch({ type: "FUSION_START" });
        }
        if (recorder && runIdRef.current) {
          await recorder.beginFusionAttempt(runIdRef.current, attemptId, input);
        }
      },

      onFusionTerminal: async (attemptId, input) => {
        if (runEpochRef.current !== epoch) return;
        if (input.status === "completed" && input.result) {
          dispatch({ type: "FUSION_RESULT", text: input.result });
        } else if (input.status === "failed") {
          dispatch({ type: "FUSION_FAILED", error: input.error?.message ?? "Fusion failed" });
        }
        if (recorder && runIdRef.current) {
          await recorder.finishFusionAttempt(runIdRef.current, attemptId, input);
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

    const events = makeEvents(epoch, false, slots, frozenContext);
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
  };

  const abortRun = () => {
    runEpochRef.current += 1;
    const controllers = abortControllersRef.current;
    for (const c of controllers) c.abort();
    controllers.clear();
    streamBuffer.cancel();
    dispatch({ type: "ABORT_RUN" });
    if (recorder && runIdRef.current) {
      void recorder.markAborted(runIdRef.current);
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
    dispatch({ type: "RETRY_CANDIDATE_START", id: candidate.id });

    const events = makeEvents(epoch, true, frozenSlots, ctx ?? undefined);
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

    const events = makeEvents(epoch, false, ctx.slots, ctx);
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
      const events = makeEvents(epoch, false, ctx?.slots, ctx ?? undefined);
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
