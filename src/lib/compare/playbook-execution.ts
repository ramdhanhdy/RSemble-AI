// =============================================================================
// RSemble AI — Policy Playbook execution in Compare (spec §8, Task 10).
//
// Playbooks apply to Compare only through explicit user opt-in with a verified
// compatibility receipt and preflight cost estimate.
// =============================================================================

import type { ModelSlot } from "../../studio-data";
import type { ProviderId } from "../providers/types";
import { estimateTokens, estimateCost } from "../cost";
import type { LabRecipeVersion } from "../studies/lab-recipe-types";
import type { ModelPoolVersion } from "../studies/model-pool-types";
import type {
  PolicyRecommendation,
  PolicyReportPayload,
  PolicyStudyRecord,
} from "../studies/policy/policy-study-types";
import type {
  PinnedTaskSetVersionView,
  PlaybookCompatibilityOutcome,
} from "../studies/policy/playbook-compatibility";

export interface PlaybookCostPreflight {
  pricedAt: number;
  baselineCostUsd: number | null;
  policyCostUsd: number | null;
  synthesisCostUsd: number | null;
  multiplier: number | null;
  partial: boolean;
}

export type PlaybookCostEstimate = PlaybookCostPreflight;

export interface PlaybookRunBinding {
  playbookId: string;
  playbook: PolicyReportPayload;
  study: PolicyStudyRecord;
  poolVersion: ModelPoolVersion;
  pinnedTaskSetVersion?: PinnedTaskSetVersionView | null;
  recipeVersion: LabRecipeVersion | null;
  taskSetContext?: { taskSetId: string; version: number } | null;
  taskBinding?:
    | { kind: "canonical"; taskId: string; taskVersion?: number }
    | { kind: "ad_hoc"; inputSnapshotRef: string }
    | null;
  compatibility: PlaybookCompatibilityOutcome;
  costPreflight: PlaybookCostPreflight;
  preflightConfirmedAt: number;
}

export interface PlaybookCostPreflightInput {
  prompt: string;
  slots: ModelSlot[];
  critic: { providerId: string; model: string };
  recommendation: PolicyRecommendation;
  synthesizer?: { providerId: string; model: string } | null;
  now?: () => number;
}
/**
 * Estimate policy cost versus the experimental baseline from current pricing.
 * Never fabricates numbers: when any component lacks pricing, the total is null
 * and marked partial.
 */
export function estimatePlaybookCostPreflight(
  inputOrSlots: PlaybookCostPreflightInput | ModelSlot[],
  promptText?: string,
  playbook?: PolicyReportPayload,
  _pricing?: Record<string, unknown>,
): PlaybookCostPreflight {
  let input: PlaybookCostPreflightInput;
  if (Array.isArray(inputOrSlots)) {
    input = {
      prompt: promptText ?? "",
      slots: inputOrSlots,
      critic: { providerId: "openrouter", model: "judge-model" },
      recommendation: playbook?.recommendation ?? { kind: "do_not_fuse", rationale: "" },
      synthesizer: null,
    };
  } else {
    input = inputOrSlots;
  }

  const now = input.now ?? (() => Date.now());
  const enabledSlots = (input.slots ?? []).filter((s) => s.enabled);
  const prompt = input.prompt ?? "";
  const tokensIn = estimateTokens(prompt);
  const tokensOut = Math.round(tokensIn * 1.5);

  let baselineCostUsd: number | null = 0;
  let partial = false;

  for (const slot of enabledSlots) {
    const cost = estimateCost(
      tokensIn,
      tokensOut,
      slot.providerId as ProviderId,
      slot.slug || slot.model,
    );
    if (cost === null) {
      baselineCostUsd = null;
      partial = true;
      break;
    }
    baselineCostUsd += cost;
  }

  if (baselineCostUsd !== null && input.critic) {
    const judgeTokens = Math.round(tokensIn * 0.4);
    const judgeCost = estimateCost(
      judgeTokens,
      judgeTokens,
      input.critic.providerId as ProviderId,
      input.critic.model,
    );
    if (judgeCost === null) {
      baselineCostUsd = null;
      partial = true;
    } else {
      baselineCostUsd += judgeCost;
    }
  }

  let synthesisCostUsd: number | null = null;
  let policyCostUsd: number | null = null;
  let multiplier: number | null = null;

  const rec = input.recommendation;
  const isSynthesisPolicy =
    rec.kind === "adopt" && (rec.policy === "fuse" || rec.policy === "refine");

  if (isSynthesisPolicy) {
    if (input.synthesizer) {
      const synthTokens = Math.round(tokensIn * 1.5);
      synthesisCostUsd = estimateCost(
        synthTokens,
        synthTokens,
        input.synthesizer.providerId as ProviderId,
        input.synthesizer.model,
      );
    }
    if (synthesisCostUsd === null) {
      partial = true;
    }
    if (baselineCostUsd !== null && synthesisCostUsd !== null) {
      policyCostUsd = baselineCostUsd + synthesisCostUsd;
      multiplier = baselineCostUsd > 0 ? policyCostUsd / baselineCostUsd : 1;
    } else {
      policyCostUsd = null;
      multiplier = null;
      partial = true;
    }
  } else {
    synthesisCostUsd = null;
    policyCostUsd = baselineCostUsd;
    multiplier = baselineCostUsd !== null ? 1 : null;
    partial = baselineCostUsd === null;
  }

  return {
    pricedAt: now(),
    baselineCostUsd,
    policyCostUsd,
    synthesisCostUsd,
    multiplier,
    partial,
  };
}
/**
 * Re-estimate the playbook cost preflight at run start and compare it to the
 * binding's confirmed preflight. A mismatch means pricing changed (or the
 * preflight was tampered with) between confirmation and run start; the run
 * must block rather than execute a cost the user never approved.
 *
 * Returns `{ ok: true }` when the preflight still holds, or `{ ok: false,
 * reason }` describing the drift. Partial preflights (some pricing was
 * unavailable at confirmation) are allowed through — there was no concrete
 * number to tamper with.
 */
export function revalidatePlaybookCostPreflight(
  binding: PlaybookRunBinding,
  input: PlaybookCostPreflightInput,
): { ok: true } | { ok: false; reason: string } {
  const stored = binding.costPreflight;
  const live = estimatePlaybookCostPreflight(input);

  if (stored.partial) return { ok: true };

  if (live.partial) {
    return {
      ok: false,
      reason:
        "Playbook cost preflight is stale: pricing that was available at confirmation is now unavailable.",
    };
  }

  const storedTotal = stored.policyCostUsd;
  const liveTotal = live.policyCostUsd;
  if (storedTotal === null || liveTotal === null) {
    return { ok: false, reason: "Playbook cost preflight is stale: missing cost total." };
  }

  const tolerance = 1e-4;
  const relative =
    storedTotal > 0
      ? Math.abs(storedTotal - liveTotal) / storedTotal
      : Math.abs(storedTotal - liveTotal);
  if (relative > tolerance) {
    return {
      ok: false,
      reason: `Playbook cost preflight is stale: confirmed $${storedTotal.toFixed(6)} but live re-estimate is $${liveTotal.toFixed(6)} (pricing changed).`,
    };
  }

  return { ok: true };
}
