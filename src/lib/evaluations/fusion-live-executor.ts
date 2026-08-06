// =============================================================================
// RSemble AI — Live Fusion policy executor
//
// Production FusionPolicyExecutor over the provider registry. Candidates,
// judges, synthesizers, and the holdout judge are real provider calls built
// from the shared pipeline helpers — blind labeling via createBlindCandidateSet,
// judge prompts via judgeMessages, strict parsing via parseJudge. Token costs
// are estimated (estimateTokens) exactly as in the ad-hoc run path.
// =============================================================================

import type { ChatMessage, CriticRef } from "../providers/types";
import { getProvider } from "../providers/registry";
import { contentToText } from "../providers/content";
import { estimateTokens } from "../cost";
import {
  type Candidate,
  type CandidateSegment,
  type JudgeReport,
  type ModelSlot,
} from "../../studio-data";
import {
  createBlindCandidateSet,
  draftMessages,
  judgeMessages,
  parseJudge,
  splitSegments,
} from "../pipeline";
import type { EvaluationProfileSnapshot, EvaluationTask } from "./evaluation-types";
import type {
  BlockedRunResult,
  FusionPolicyExecutor,
  HoldoutArtifact,
  PoolSweepOutput,
} from "./fusion-study-controller";

function candidateFromOutput(candidateId: string, slot: ModelSlot, text: string): Candidate {
  const segments: CandidateSegment[] = splitSegments(text, candidateId);
  return {
    id: candidateId,
    model: slot.model,
    provider: slot.provider,
    providerId: slot.providerId,
    slug: slot.slug,
    accent: "indigo",
    strategy: "Parallel model",
    summary: "",
    scores: {},
    weightedScore: 0,
    segments,
    status: "done",
  };
}

async function chatOnce(
  ref: CriticRef,
  messages: ChatMessage[],
  temperature: number,
): Promise<string> {
  const provider = getProvider(ref.providerId);
  return provider.chatCompletion({ model: ref.model, messages, temperature });
}

function messageTokens(messages: ChatMessage[]): number {
  return estimateTokens(messages.map((m) => contentToText(m.content)).join("\n"));
}

export function createLiveFusionExecutor(deps?: {
  random?: () => number;
  generateId?: () => string;
}): FusionPolicyExecutor {
  const random = deps?.random ?? Math.random;
  const generateId = deps?.generateId ?? (() => crypto.randomUUID());

  async function generateForSlot(
    task: EvaluationTask,
    slot: ModelSlot,
    candidateId: string,
  ): Promise<PoolSweepOutput> {
    const messages = draftMessages({ systemPrompt: task.systemPrompt, prompt: task.prompt });
    const ref: CriticRef = { providerId: slot.providerId, model: slot.slug };
    const text = await chatOnce(ref, messages, 0.7);
    return {
      slot,
      modelKey: `${slot.providerId}:${slot.slug}`,
      candidateId,
      text,
      cost: { tokensIn: messageTokens(messages), tokensOut: estimateTokens(text) },
    };
  }

  async function judgeOutputs(
    task: EvaluationTask,
    profile: EvaluationProfileSnapshot | null,
    judge: CriticRef,
    candidates: Candidate[],
  ): Promise<{
    report: JudgeReport;
    consensus: BlockedRunResult["consensus"];
    cost: BlockedRunResult["judgeCost"];
    blindSet: ReturnType<typeof createBlindCandidateSet>;
  }> {
    const blindSet = createBlindCandidateSet(candidates, random);
    const messages = judgeMessages(task.prompt, profile, blindSet.candidates);
    const content = await chatOnce(judge, messages, 0.1);
    const { report, breakdown } = parseJudge(content, blindSet, profile, candidates);
    return {
      report,
      consensus: breakdown,
      cost: { tokensIn: messageTokens(messages), tokensOut: estimateTokens(content) },
      blindSet,
    };
  }

  return {
    async runPoolSweep(task, slots) {
      const outputs: PoolSweepOutput[] = [];
      for (const slot of slots) {
        outputs.push(await generateForSlot(task, slot, `cand-${slot.id}`));
      }
      return { taskId: task.id, outputs };
    },

    async judgePool(task, profile, judge1, outputs) {
      const candidates = outputs.map((o) => candidateFromOutput(o.candidateId, o.slot, o.text));
      const judged = await judgeOutputs(task, profile, judge1, candidates);
      return { report: judged.report, consensus: judged.consensus, cost: judged.cost };
    },

    async runBlockedEvidence(task, profile, pair, judge1) {
      const outputs: PoolSweepOutput[] = [];
      for (let i = 0; i < pair.length; i++) {
        outputs.push(await generateForSlot(task, pair[i], `cand-${pair[i].id}`));
      }
      const live = outputs.map((o) => candidateFromOutput(o.candidateId, o.slot, o.text));
      const judged = await judgeOutputs(task, profile, judge1, live);
      return {
        blindCandidates: judged.blindSet.candidates,
        report: judged.report,
        consensus: judged.consensus,
        candidateAttemptIdsByCandidateId: Object.fromEntries(
          outputs.map((o) => [o.candidateId, `live-catt-${generateId()}`]),
        ),
        judgeAttemptId: `live-jatt-${generateId()}`,
        candidateRunId: null,
        devJudgeRunId: null,
        candidateCosts: Object.fromEntries(outputs.map((o) => [o.candidateId, o.cost])),
        judgeCost: judged.cost,
      };
    },

    async runSynthesis(synthesizer, messages) {
      const text = await chatOnce(synthesizer, messages, 0.3);
      return { text, cost: { tokensIn: messageTokens(messages), tokensOut: estimateTokens(text) } };
    },

    async runHoldout(task, profile, judge2, artifacts: HoldoutArtifact[]) {
      // Holdout evaluates policy artifacts blind and randomized (spec §5.3).
      const candidates = artifacts.map((a) =>
        candidateFromOutput(
          a.key,
          {
            id: a.key,
            providerId: judge2.providerId,
            provider: "policy",
            model: a.key,
            slug: a.key,
            enabled: true,
          },
          a.text,
        ),
      );
      const blindSet = createBlindCandidateSet(candidates, random);
      const messages = judgeMessages(task.prompt, profile, blindSet.candidates);
      const content = await chatOnce(judge2, messages, 0.1);
      const { report } = parseJudge(content, blindSet, profile, candidates);
      const scoresByKey: Record<string, number> = {};
      for (const artifact of artifacts) {
        scoresByKey[artifact.key] = report.evaluationsById[artifact.key]?.overallScore ?? 0;
      }
      return {
        scoresByKey,
        cost: { tokensIn: messageTokens(messages), tokensOut: estimateTokens(content) },
      };
    },
  };
}
