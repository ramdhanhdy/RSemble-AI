// =============================================================================
// Run controller — extracted pipeline orchestration from rsemble.tsx.
// Owns fanout → judge → fusion, abort, retry, and fusion triggering.
// =============================================================================

import { type Candidate } from "../studio-data";
import { getProvider } from "./providers/registry";
import { errorMessage } from "./llm-utils";
import { estimateTokens } from "./cost";
import { addRun, modelKey } from "./run-history";
import { invalidateHistoryCache } from "./history-cache";
import {
  buildFanoutJobs,
  createBlindCandidateSet,
  draftMessages,
  fusionMessages,
  judgeMessages,
  parseJudge,
  splitSegments,
  summarize,
  isUsableCandidate,
  checkFusionEligibility,
} from "./pipeline";
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
}

export function createRunController(deps: RunControllerDeps) {
  const { stateRef, dispatch, runEpochRef, abortControllersRef, streamBuffer } = deps;
  const random = deps.random ?? Math.random;

  const runFanout = async () => {
    const s = stateRef.current;
    const jobs = buildFanoutJobs(s.slots);
    if (jobs.length === 0) return;
    const epoch = ++runEpochRef.current;
    abortControllersRef.current.clear();
    const placeholders: Candidate[] = jobs.map((j) => ({
      id: j.id,
      model: j.displayName,
      provider: j.provider,
      providerId: j.providerId,
      slug: j.slug,
      accent: j.accent,
      strategy: j.strategyLabel,
      summary: "",
      scores: {},
      weightedScore: 0,
      segments: [],
      status: "pending",
      startedAt: Date.now(),
    }));
    dispatch({ type: "FANOUT_START", candidates: placeholders });

    const results = await Promise.all(
      jobs.map(async (job): Promise<Candidate | null> => {
        try {
          let content = "";
          const provider = getProvider(job.providerId);
          const ctrl = new AbortController();
          abortControllersRef.current.add(ctrl);
          try {
            const signal = ctrl.signal;
            for await (const delta of provider.chatCompletionStream({
              model: job.slug,
              messages: draftMessages({
                systemPrompt: s.systemPrompt,
                prompt: s.prompt,
                rubric: s.rubric,
              }),
              temperature: s.temperature,
              signal,
            })) {
              content += delta;
              if (runEpochRef.current === epoch) {
                streamBuffer.push(job.id, delta);
              }
            }
          } finally {
            abortControllersRef.current.delete(ctrl);
          }
          streamBuffer.flush();
          if (runEpochRef.current !== epoch) return null;
          const segments = splitSegments(content, job.id);
          const summary = summarize(content);
          const tokensIn = estimateTokens(s.prompt);
          const tokensOut = estimateTokens(content);
          const finishedAt = Date.now();
          dispatch({
            type: "CANDIDATE_RESULT",
            id: job.id,
            segments,
            summary,
            finishedAt,
            tokensIn,
            tokensOut,
          });
          return {
            ...placeholders.find((p) => p.id === job.id)!,
            status: "done",
            segments,
            summary,
            finishedAt,
            tokensIn,
            tokensOut,
          };
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return null;
          if (runEpochRef.current !== epoch) return null;
          dispatch({
            type: "CANDIDATE_FAILED",
            id: job.id,
            error: errorMessage(err),
            finishedAt: Date.now(),
          });
          return null;
        }
      }),
    );
    if (runEpochRef.current !== epoch) return;
    // Only candidates with genuine content (status "done" + non-empty text) are
    // usable for judge/fusion. Empty, truncated, aborted, or errored candidates
    // must never reach the judge — including them would poison the comparison.
    const done = results.filter((r): r is Candidate => r !== null).filter(isUsableCandidate);
    dispatch({ type: "FANOUT_END", count: done.length });

    if (done.length < 2) {
      if (runEpochRef.current !== epoch) return;
      dispatch({
        type: "INSUFFICIENT_CANDIDATES",
        done: done.length,
        failed: jobs.length - done.length,
      });
      return;
    }

    const judgeResult = await runJudge(done, s, epoch);
    if (judgeResult.ok && s.mode === "fuse") {
      await runFusion(done, s, epoch, judgeResult.scoresById);
    }
  };

  const runJudge = async (
    done: Candidate[],
    seed: StudioState,
    epoch: number,
  ): Promise<{ ok: true; scoresById: Record<string, number> } | { ok: false }> => {
    if (done.length === 0) return { ok: false };
    if (runEpochRef.current !== epoch) return { ok: false };
    dispatch({ type: "JUDGE_START" });
    const judgeCtrl = new AbortController();
    abortControllersRef.current.add(judgeCtrl);
    try {
      // Blind judging (DECISIONS.md #6): the label map is constructed exactly
      // once per judge run — it stays stable regardless of later score sorting.
      const blindSet = createBlindCandidateSet(done, random);
      const criticProvider = getProvider(seed.critic.providerId);
      const content = await criticProvider.chatCompletion({
        model: seed.critic.model,
        messages: judgeMessages(seed.prompt, seed.rubric, blindSet.candidates, seed.judgeInstruction),
        temperature: 0.1,
        signal: judgeCtrl.signal,
      });
      if (runEpochRef.current !== epoch) return { ok: false };
      const { breakdown, scoresById } = parseJudge(content, blindSet, seed.rubric, done);
      dispatch({ type: "JUDGE_RESULT", mode: seed.mode, consensus: breakdown, scoresById });
      if (seed.mode === "rank") {
        const scored = done.map((c) => ({
          c,
          score: scoresById[c.id] ?? 0,
        }));
        const winner = [...scored].sort((a, b) => b.score - a.score)[0];
        addRun({
          taskExcerpt: seed.prompt.slice(0, 120),
          models: done.map((c) => modelKey(c.providerId, c.slug)),
          stats: Object.fromEntries(
            scored.map(({ c, score }) => [
              modelKey(c.providerId, c.slug),
              {
                score,
                latencyMs: c.startedAt && c.finishedAt ? c.finishedAt - c.startedAt : 0,
                costUsd: null,
              },
            ]),
          ),
          winner: winner ? modelKey(winner.c.providerId, winner.c.slug) : "",
          timestamp: Date.now(),
        });
        invalidateHistoryCache();
      }
      return { ok: true, scoresById };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return { ok: false };
      if (runEpochRef.current !== epoch) return { ok: false };
      dispatch({ type: "JUDGE_FAILED", error: errorMessage(err) });
      return { ok: false };
    } finally {
      abortControllersRef.current.delete(judgeCtrl);
    }
  };

  const runFusion = async (
    done: Candidate[],
    seed: StudioState,
    epoch: number,
    scoresById?: Record<string, number>,
  ) => {
    if (done.length === 0) return;
    if (runEpochRef.current !== epoch) return;
    dispatch({ type: "FUSION_START" });
    const fusionCtrl = new AbortController();
    abortControllersRef.current.add(fusionCtrl);
    try {
      const criticProvider = getProvider(seed.critic.providerId);
      const content = await criticProvider.chatCompletion({
        model: seed.critic.model,
        messages: fusionMessages({
          prompt: seed.prompt,
          rubric: seed.rubric,
          candidates: done,
          judgeInstruction: seed.judgeInstruction,
        }),
        temperature: 0.3,
        signal: fusionCtrl.signal,
      });
      if (runEpochRef.current !== epoch) return;
      dispatch({ type: "FUSION_RESULT", text: content });
      const scored = done.map((c) => ({
        c,
        score: scoresById?.[c.id] ?? 0,
      }));
      const winner = [...scored].sort((a, b) => b.score - a.score)[0];
      addRun({
        taskExcerpt: seed.prompt.slice(0, 120),
        models: done.map((c) => modelKey(c.providerId, c.slug)),
        stats: Object.fromEntries(
          scored.map(({ c, score }) => [
            modelKey(c.providerId, c.slug),
            {
              score,
              latencyMs: c.startedAt && c.finishedAt ? c.finishedAt - c.startedAt : 0,
              costUsd: null,
            },
          ]),
        ),
        winner: winner ? modelKey(winner.c.providerId, winner.c.slug) : "",
        timestamp: Date.now(),
      });
      invalidateHistoryCache();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (runEpochRef.current !== epoch) return;
      dispatch({ type: "FUSION_FAILED", error: errorMessage(err) });
    } finally {
      abortControllersRef.current.delete(fusionCtrl);
    }
  };

  const abortRun = () => {
    runEpochRef.current += 1;
    const controllers = abortControllersRef.current;
    for (const c of controllers) c.abort();
    controllers.clear();
    streamBuffer.cancel();
    dispatch({ type: "ABORT_RUN" });
  };

  const retryCandidate = async (candidate: Candidate) => {
    if (stateRef.current.running) return;
    const s = stateRef.current;
    const slot =
      s.slots.find((sl) => sl.slug === candidate.slug && sl.providerId === candidate.providerId) ??
      s.slots.find((sl) => sl.slug === candidate.slug);
    if (!slot) return;

    const epoch = ++runEpochRef.current;
    abortControllersRef.current.clear();
    const retryStartedAt = Date.now();
    dispatch({ type: "RETRY_CANDIDATE_START", id: candidate.id });

    const ctrl = new AbortController();
    abortControllersRef.current.add(ctrl);
    let updatedCandidate: Candidate | null = null;
    try {
      let content = "";
      const provider = getProvider(slot.providerId);
      for await (const delta of provider.chatCompletionStream({
        model: slot.slug,
        messages: draftMessages({
          systemPrompt: s.systemPrompt,
          prompt: s.prompt,
          rubric: s.rubric,
        }),
        temperature: s.temperature,
        signal: ctrl.signal,
      })) {
        content += delta;
        if (runEpochRef.current === epoch) {
          streamBuffer.push(candidate.id, delta);
        }
      }
      streamBuffer.flush();
      if (runEpochRef.current !== epoch) return;
      const segments = splitSegments(content, candidate.id);
      const summary = summarize(content);
      const tokensIn = estimateTokens(s.prompt);
      const tokensOut = estimateTokens(content);
      const finishedAt = Date.now();
      updatedCandidate = {
        ...candidate,
        status: "done",
        errorMessage: undefined,
        segments,
        summary,
        streamingText: "",
        startedAt: retryStartedAt,
        finishedAt,
        tokensIn,
        tokensOut,
      };
      dispatch({
        type: "RETRY_CANDIDATE_RESULT",
        id: candidate.id,
        segments,
        summary,
        finishedAt,
        tokensIn,
        tokensOut,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (runEpochRef.current !== epoch) return;
      dispatch({
        type: "RETRY_CANDIDATE_FAILED",
        id: candidate.id,
        error: errorMessage(err),
        finishedAt: Date.now(),
      });
      return;
    } finally {
      abortControllersRef.current.delete(ctrl);
    }

    if (!updatedCandidate) return;
    const snapshot = s.candidates.map((c) => c.id === candidate.id ? updatedCandidate! : c);
    // Only candidates with genuine content are usable for the judge. This
    // matches the runFanout guard so retry uses the same eligibility rule.
    const done = snapshot.filter(isUsableCandidate);
    if (done.length >= 2) {
      const judgeResult = await runJudge(done, s, epoch);
      if (judgeResult.ok && s.mode === "fuse") {
        await runFusion(done, s, epoch, judgeResult.scoresById);
      }
    } else {
      dispatch({
        type: "INSUFFICIENT_CANDIDATES",
        done: done.length,
        failed: snapshot.filter((c) => !isUsableCandidate(c)).length,
      });
    }
  };

  const triggerFusion = (force = false) => {
    const s = stateRef.current;
    if (s.running) return;

    // Shared eligibility guard — same rule as every fusion entry point. This
    // must not silently do nothing: when there are too few usable candidates,
    // dispatch INSUFFICIENT_CANDIDATES so the UI surfaces an honest outcome.
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

    const epoch = ++runEpochRef.current;
    const scoresById = Object.fromEntries(eligibility.usable.map((c) => [c.id, c.weightedScore]));
    void runFusion(eligibility.usable, s, epoch, scoresById);
  };

  return {
    runFanout,
    runJudge,
    runFusion,
    abortRun,
    retryCandidate,
    triggerFusion,
  };
}
