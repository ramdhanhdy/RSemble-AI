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
import type { RunRecorder } from "./persistence/run-recorder";
import { createRunExecutor, type RunExecutorEvents } from "./run-executor";
import type { StudioState, Action } from "../studio-engine";
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
}

export function createRunController(deps: RunControllerDeps) {
  const { stateRef, dispatch, runEpochRef, abortControllersRef, streamBuffer, recorder } = deps;
  const random = deps.random ?? Math.random;
  const now = deps.now ?? (() => Date.now());
  const executor = createRunExecutor({ random, now });
  const runIdRef: { current: string | null } = { current: null };
  const currentAbortRef: { current: AbortController | null } = { current: null };

  function freshAbort(): AbortController {
    const ctrl = new AbortController();
    currentAbortRef.current = ctrl;
    abortControllersRef.current.add(ctrl);
    return ctrl;
  }

  // --- Events adapter: executor events → dispatch + recorder -----------------

  function makeEvents(epoch: number, isRetry = false, slotsOverride?: StudioState["slots"]): RunExecutorEvents {
    const candidateAttemptIds: Record<string, string> = {};

    return {
      onFanoutStart: async () => {
        const s = stateRef.current;
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
            prompt: s.prompt,
            evaluation: s.evaluation,
            attachments: s.attachments,
            attachmentsToJudge: s.attachmentsToJudge,
          },
        });
        if (recorder) {
          await recorder.begin({
            runId,
            source: { kind: "adhoc" },
            mode: s.mode,
            task: { title: s.prompt.slice(0, 80), prompt: s.prompt, systemPrompt: s.systemPrompt, temperature: s.temperature },
            // Persist the resolved evaluation profile so run evidence (and
            // summary provenance) reflects the actual scoring protocol.
            evaluation: { profile: resolveEvaluationProfile(s.evaluation), candidateMessages: [] },
            slots: s.slots,
            fence: { ownerId: "tab-1", fence: epoch },
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
    if (jobs.length === 0) return;
    const epoch = ++runEpochRef.current;
    abortControllersRef.current.clear();
    const abort = freshAbort();

    const events = makeEvents(epoch, false, slots);
    await executor.executeTask({
      source: { kind: "adhoc" },
      mode: s.mode,
      task: { prompt: s.prompt, systemPrompt: s.systemPrompt, temperature: s.temperature },
      evaluation: s.evaluation,
      slots,
      critic: s.critic,
      judgeInstruction: s.judgeInstruction,
      attachments: s.attachments,
      attachmentsToJudge: s.attachmentsToJudge,
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
    // Resolve the slot by IDENTITY, not by the candidate's stale slug/providerId.
    // Candidate identity is `cand-<slotId>` (candidateIdForSlot), so the slot id
    // is the suffix. The user may have switched the slot's model/provider after
    // the failed run — retry must use the slot's CURRENT model, which the
    // executor reads from the resolved slot via retrySlotId.
    const slotId = candidate.id.startsWith("cand-") ? candidate.id.slice("cand-".length) : null;
    const slot =
      (slotId ? s.slots.find((sl) => sl.id === slotId) : undefined) ??
      s.slots.find((sl) => sl.slug === candidate.slug && sl.providerId === candidate.providerId) ??
      s.slots.find((sl) => sl.slug === candidate.slug);
    if (!slot) return;

    const epoch = ++runEpochRef.current;
    abortControllersRef.current.clear();
    const abort = freshAbort();
    dispatch({ type: "RETRY_CANDIDATE_START", id: candidate.id });

    const events = makeEvents(epoch, true);
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
      mode: s.mode,
      task: { prompt: s.prompt, systemPrompt: s.systemPrompt, temperature: s.temperature },
      evaluation: s.evaluation,
      slots: s.slots,
      critic: s.critic,
      judgeInstruction: s.judgeInstruction,
      // Frozen attachment set — the retry must reproduce the original input
      // even if the user edited the command pane since the run (plan 7.6.6).
      attachments: s.runContext?.attachments ?? [],
      attachmentsToJudge: s.runContext?.attachmentsToJudge ?? true,
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

    const events = makeEvents(epoch);
    await executor.retryJudge({
      mode: s.mode,
      task: { prompt: ctx.prompt, systemPrompt: s.systemPrompt, temperature: s.temperature },
      evaluation: ctx.evaluation,
      candidates: done,
      critic: s.critic,
      judgeInstruction: s.judgeInstruction,
      attachments: ctx.attachments,
      attachmentsToJudge: ctx.attachmentsToJudge,
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

      const events = makeEvents(epoch);
      await executor.executeFusionAttempt({
        mode: "fuse",
        task: { prompt: s.prompt, systemPrompt: s.systemPrompt, temperature: 0.3 },
        evaluation: s.evaluation,
        candidates: eligibility.usable,
        critic: s.critic,
        judgeInstruction: s.judgeInstruction,
        attachments: s.attachments,
        attachmentsToJudge: s.attachmentsToJudge,
        judgeAttemptId,
        blindLabelToCandidateId,
        candidateAttemptIdsByCandidateId,
      }, events, abort.signal);
    })();
  };

  return {
    runFanout,
    runJudge: async () => {},
    runFusion: async () => {},
    abortRun,
    retryCandidate,
    retryJudge,
    triggerFusion,
  };
}
