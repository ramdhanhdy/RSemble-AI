// =============================================================================
// RSemble AI — Run → Compare config preload (Slice 5, "Open in Compare")
//
// Builds an honest command-pane preload from a persisted RunRecordV2. This is
// an S-class surface action: it restores what the record actually stores
// (task, resolved evaluation rubric, candidate roster, judge target from the
// accepted judge attempt, reasoning policy) and deliberately omits what it
// does NOT store (attachments, the user's custom judgeInstruction, results).
//
// Never fabricates lineage: no rebasedFrom, no record mutation, no result
// preload. The Compare run the user starts from here is a NEW run.
// =============================================================================

import type { Mode, ModelSlot } from "../../studio-data";
import type { RunRecordV2 } from "../persistence/run-types";
import type { CriticRef, ProviderId, ReasoningPolicy } from "../providers/types";
import type { AdHocEvaluationConfig } from "../evaluations/evaluation-rubric-adhoc";

/** Command-pane fields restorable from a run record. Optional fields are
 *  absent when the record cannot restore them; the reducer keeps the user's
 *  current value in that case. */
export interface RunConfigPreload {
  mode: Mode;
  prompt: string;
  systemPrompt: string;
  temperature: number;
  evaluation: AdHocEvaluationConfig;
  /** Candidate roster that actually ran (all enabled). */
  slots: ModelSlot[];
  /** Judge target from the accepted judge attempt (last attempt fallback).
   *  Absent for runs aborted before any judge attempt. */
  critic?: CriticRef;
  reasoningPolicy?: ReasoningPolicy;
}

/** Derive the config preload from a record. Always returns a config for V2
 *  records; legacy summaries have no frozen config and are handled separately
 *  (no button). */
export function runConfigFromRecord(record: RunRecordV2): RunConfigPreload {
  const rubric = record.evaluation?.profile;
  const evaluation: AdHocEvaluationConfig = rubric
    ? {
        kind: "profile",
        ref: { id: rubric.id, version: rubric.version },
        // The record stores the resolved snapshot; embed it so the command
        // pane renders exactly the criteria that were judged.
        profile: rubric,
      }
    : { kind: "holistic" };

  // The roster that ran — every persisted candidate is an enabled slot.
  const candidates = record.candidates ?? [];
  const slots: ModelSlot[] = candidates.map((c) => ({
    id: c.slotId,
    // Persisted candidate ids come from the catalog that ran; the cast is the
    // typed seam (record guards validate strings, catalog mints ProviderIds).
    providerId: c.providerId as ProviderId,
    // Display-only label; ModelList resolves pretty names from providerId.
    provider: c.providerId,
    model: c.model,
    slug: c.slug,
    enabled: true,
  }));

  // Judge target: prefer the accepted attempt, else the most recent attempt.
  const attempts = record.judge?.attempts ?? [];
  const judgeAttempt =
    attempts.find((a) => a.attemptId === record.judge?.acceptedAttemptId) ??
    attempts[attempts.length - 1];
  const critic: CriticRef | undefined = judgeAttempt
    ? { providerId: judgeAttempt.providerId as ProviderId, model: judgeAttempt.model }
    : undefined;

  const reasoningPolicy: ReasoningPolicy | undefined = record.reasoning
    ? {
        candidates:
          Object.values(record.reasoning.candidates ?? {})[0]?.requested ?? "provider-default",
        judge: record.reasoning.judge?.requested ?? "provider-default",
      }
    : undefined;

  return {
    mode: record.mode,
    prompt: record.task?.prompt ?? "",
    systemPrompt: record.task?.systemPrompt ?? "",
    temperature: record.task?.temperature ?? 0.7,
    evaluation,
    slots,
    critic,
    reasoningPolicy,
  };
}
