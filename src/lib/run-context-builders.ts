// =============================================================================
// RSemble AI — Compare run context builders (pure)
//
// Extracted from run-controller (Plan 007 Workstream C). These are the
// deterministic, side-effect-free data transforms the controller uses to:
//   - freeze one immutable protocol snapshot from mutable command-pane state,
//   - build candidate placeholders matching exactly what the executor fans out,
//   - derive the persisted execution-fence shape from a lease token,
//   - load the real accepted attempt IDs from a persisted candidate record.
// Keeping them pure makes the frozen-run contract (spec §5.1/§11.3) directly
// unit-testable and removes three copy-pasted copies that previously lived in
// the controller factory closure. No dispatch, no recorder writes, no side
// effects occur here.
// =============================================================================

import type { Candidate, ModelSlot } from "../studio-data";
import type { RunEvaluationContext } from "../studio-engine";
import type { FanoutJob } from "./pipeline";
import type { ExecutionFence, PersistedCandidate } from "./persistence/run-types";
import type { LeaseInfo } from "./execution-lease";

export interface FrozenContextSource {
  mode: RunEvaluationContext["mode"];
  prompt: string;
  systemPrompt: string;
  temperature: number;
  evaluation: RunEvaluationContext["evaluation"];
  slots: ModelSlot[];
  critic: RunEvaluationContext["critic"];
  judgeInstruction: string | undefined;
  attachments: RunEvaluationContext["attachments"];
  attachmentsToJudge: boolean;
  reasoningPolicy: RunEvaluationContext["reasoningPolicy"];
}

/**
 * Freeze one immutable protocol snapshot from mutable command-pane state.
 * The executor and every retry/stage afterwards receive this same object even
 * if the command pane changes meanwhile (spec §5.1 immutable protocol).
 */
export function buildFrozenContext(source: FrozenContextSource): RunEvaluationContext {
  return {
    mode: source.mode,
    task: {
      prompt: source.prompt,
      systemPrompt: source.systemPrompt,
      temperature: source.temperature,
    },
    prompt: source.prompt,
    evaluation: source.evaluation,
    slots: source.slots.map((slot) => ({ ...slot })),
    critic: { ...source.critic! },
    judgeInstruction: source.judgeInstruction,
    attachments: source.attachments.map((a) => ({ ...a })),
    attachmentsToJudge: source.attachmentsToJudge,
    reasoningPolicy: source.reasoningPolicy ? { ...source.reasoningPolicy } : undefined,
  } satisfies RunEvaluationContext;
}

/**
 * Build pending candidate placeholders that mirror exactly what the executor
 * will fan out. The eligibility gate may have filtered slots (spec §5.1
 * auto-disable); placeholders must match the actual roster or the candidate
 * list would include ghosts (spec §5.1).
 */
export function buildPlaceholders(jobs: FanoutJob[], startedAt: number): Candidate[] {
  return jobs.map((j) => ({
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
    startedAt,
  }));
}

/**
 * Derive the persisted execution-fence shape from an active lease token.
 * Absent a token (or a superfluous fence fallback) the caller supplies its own
 * `executionFence`; this helper only produces the lease-driven shape.
 */
export function fenceFromLease(token: LeaseInfo | null | undefined): ExecutionFence | undefined {
  if (!token) return undefined;
  return {
    ownerId: token.ownerId,
    fence: token.fence,
    ...(token.leaseId ? { leaseId: token.leaseId } : {}),
  };
}

/**
 * Load the real accepted attempt IDs from a persisted run record. Retries and
 * re-uses must reference the exact immutable attempt records for every judged
 * output (spec §11.3); persistence is the authority, not in-memory state.
 */
export function acceptedAttemptIdsByCandidate(
  record: { candidates: Pick<PersistedCandidate, "candidateId" | "acceptedAttemptId">[] } | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!record) return out;
  for (const c of record.candidates) {
    if (c.acceptedAttemptId) out[c.candidateId] = c.acceptedAttemptId;
  }
  return out;
}
