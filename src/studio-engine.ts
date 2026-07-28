// =============================================================================
// RSemble AI — state engine
//
// Slimmed from the prior studio reducer: the studio-only fields are gone and a
// single `mode: "rank" | "fuse"` field added (the header toggle's state, and the
// sole switch in the product). The fanout/judge/fusion actions are preserved
// verbatim because the pipeline logic in pipeline.ts is reused as-is.
//
// See PRODUCT.md §3 (the spine + fork) and UI.md §6 (toggle behavior matrix).
// =============================================================================

import {
  DEFAULT_CRITIC_REF,
  INITIAL_PROMPT,
  SEED_RUBRIC,
  SEED_SLOTS,
  SYSTEM_PROMPT_DEFAULT,
  type AuditEntry,
  type Candidate,
  type CandidateSegment,
  type ConsensusBreakdown,
  type Mode,
  type ModelSlot,
  type RubricCriterion,
  type RubricKind,
} from "./studio-data";
import type { CatalogModel, CriticRef } from "./lib/providers/types";

export type StageStatus = "idle" | "running" | "done" | "error";

export interface StudioState {
  // --- the sole switch ---
  mode: Mode;

  // --- command (left pane, identical in both modes) ---
  prompt: string;
  rubric: RubricCriterion[];
  slots: ModelSlot[];
  temperature: number;
  systemPrompt: string;
  critic: CriticRef;

  // --- live pipeline execution state ---
  candidates: Candidate[];
  running: boolean;
  models: CatalogModel[];
  judgeStatus: StageStatus;
  judgeError: string | null;
  consensus: ConsensusBreakdown | null;
  fusionStatus: StageStatus;
  fusionError: string | null;
  fusedText: string | null;
  /** Terminal state set when too few candidates succeeded to rank/fuse (need ≥2).
   *  `{done, failed}` describes how the fanout ended. Null when not applicable. */
  insufficient: { done: number; failed: number } | null;
  aborted: boolean;
  // --- background learning loop (RANK-mode only, optional surface) ---
  qualityRating: number;
  audit: AuditEntry[];
}

export type Action =
  // --- the sole switch ---
  | { type: "SET_MODE"; mode: Mode }
  // --- command ---
  | { type: "SET_PROMPT"; value: string }
  | { type: "TOGGLE_RUBRIC"; id: string }
  | { type: "ADD_RUBRIC"; label: string; kind: RubricKind }
  | { type: "SET_RUBRIC_WEIGHT"; id: string; weight: number }
  | { type: "REMOVE_RUBRIC"; id: string }
  | { type: "ADD_SLOT"; slot: ModelSlot }
  | { type: "REMOVE_SLOT"; id: string }
  | { type: "SWAP_SLOT"; id: string; provider: string; model: string; slug: string }
  | { type: "TOGGLE_SLOT"; id: string }
  | { type: "SET_TEMPERATURE"; value: number }
  | { type: "SET_SYSTEM_PROMPT"; value: string }
  | { type: "SET_CRITIC"; critic: CriticRef }
  | { type: "SET_CRITIC_MODEL"; value: string }
  // --- pipeline ---
  | { type: "FANOUT_START"; candidates: Candidate[] }
  | { type: "CANDIDATE_RESULT"; id: string; segments: CandidateSegment[]; summary: string; finishedAt: number; tokensIn: number; tokensOut: number }
  | { type: "CANDIDATE_DELTA"; id: string; delta: string }
  | { type: "CANDIDATE_FAILED"; id: string; error: string; finishedAt: number }
  | { type: "FANOUT_END"; count: number }
  | { type: "INSUFFICIENT_CANDIDATES"; done: number; failed: number }
  | { type: "JUDGE_START" }
  | { type: "JUDGE_RESULT"; mode: Mode; consensus: ConsensusBreakdown; scoresById: Record<string, number> }
  | { type: "JUDGE_FAILED"; error: string }
  | { type: "FUSION_START" }
  | { type: "FUSION_RESULT"; text: string }
  | { type: "FUSION_FAILED"; error: string }
  | { type: "SET_MODELS"; models: CatalogModel[] }
  | { type: "SET_RATING"; value: number }
  | { type: "RESET_SESSION" }
  | { type: "ABORT_RUN" }
  // --- single-candidate retry ---
  | { type: "RETRY_CANDIDATE_START"; id: string }
  | { type: "RETRY_CANDIDATE_DELTA"; id: string; delta: string }
  | { type: "RETRY_CANDIDATE_RESULT"; id: string; segments: CandidateSegment[]; summary: string; finishedAt: number; tokensIn: number; tokensOut: number }
  | { type: "RETRY_CANDIDATE_FAILED"; id: string; error: string; finishedAt: number };

let auditSeq = 0;
const logAudit = (audit: AuditEntry[], message: string): AuditEntry[] => {
  auditSeq += 1;
  const entry: AuditEntry = {
    id: `audit-${Date.now()}-${auditSeq}`,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    message,
  };
  return [entry, ...audit].slice(0, 40);
};

export function reducer(state: StudioState, action: Action): StudioState {
  switch (action.type) {
    case "SET_MODE":
      return { ...state, mode: action.mode };

    case "SET_PROMPT":
      return { ...state, prompt: action.value };

    case "TOGGLE_RUBRIC":
      return {
        ...state,
        rubric: state.rubric.map((c) => (c.id === action.id ? { ...c, enabled: !c.enabled } : c)),
      };

    case "ADD_RUBRIC": {
      const id = `r-${Date.now()}`;
      const criterion: RubricCriterion = {
        id,
        kind: action.kind,
        label: action.label,
        description: "User-added criterion. Override before evaluation.",
        enabled: true,
        weight: 0.1,
      };
      return { ...state, rubric: [...state.rubric, criterion] };
    }
    case "SET_RUBRIC_WEIGHT":
      return {
        ...state,
        rubric: state.rubric.map((c) =>
          c.id === action.id ? { ...c, weight: action.weight } : c
        ),
      };

    case "REMOVE_RUBRIC":
      return { ...state, rubric: state.rubric.filter((c) => c.id !== action.id) };

    case "ADD_SLOT":
      return { ...state, slots: [...state.slots, action.slot] };

    case "REMOVE_SLOT":
      return { ...state, slots: state.slots.filter((s) => s.id !== action.id) };

    case "SWAP_SLOT": {
      const slots = state.slots.map((s) =>
        s.id === action.id ? { ...s, provider: action.provider, model: action.model, slug: action.slug } : s
      );
      return { ...state, slots };
    }

    case "TOGGLE_SLOT":
      return { ...state, slots: state.slots.map((s) => (s.id === action.id ? { ...s, enabled: !s.enabled } : s)) };

    case "SET_TEMPERATURE":
      return { ...state, temperature: action.value };

    case "SET_SYSTEM_PROMPT":
      return { ...state, systemPrompt: action.value };

    case "SET_CRITIC":
      return { ...state, critic: action.critic };

    case "SET_CRITIC_MODEL":
      // Preserve the current critic's providerId — the model id changed but the
      // provider didn't (the JudgeConfig combobox dispatches SET_CRITIC with both
      // fields when the provider changes; SET_CRITIC_MODEL is only for model-only
      // edits within the same provider).
      return { ...state, critic: { providerId: state.critic.providerId, model: action.value } };

    case "FANOUT_START":
      return {
        ...state,
        running: true,
        candidates: action.candidates,
        consensus: null,
        judgeStatus: "idle",
        judgeError: null,
        fusedText: null,
        fusionStatus: "idle",
        fusionError: null,
        insufficient: null,
        aborted: false,
        audit: logAudit(state.audit, `Fanout started across ${action.candidates.length} candidate(s).`),
      };

    case "CANDIDATE_RESULT":
      return {
        ...state,
        candidates: state.candidates.map((c) =>
          c.id === action.id
            ? { ...c, status: "done", segments: action.segments, summary: action.summary, streamingText: "", finishedAt: action.finishedAt, tokensIn: action.tokensIn, tokensOut: action.tokensOut }
            : c
        ),
      };

    case "CANDIDATE_DELTA":
      // Append a streamed token chunk to the candidate's in-progress text. Used
      // only during fanout; on completion CANDIDATE_RESULT clears streamingText.
      return {
        ...state,
        candidates: state.candidates.map((c) =>
          c.id === action.id
            ? { ...c, streamingText: (c.streamingText ?? "") + action.delta }
            : c
        ),
      };

    case "CANDIDATE_FAILED":
      return {
        ...state,
        candidates: state.candidates.map((c) =>
          c.id === action.id ? { ...c, status: "error", errorMessage: action.error, finishedAt: action.finishedAt } : c
        ),
        audit: logAudit(state.audit, `Candidate ${action.id} failed: ${action.error}`),
      };

    case "INSUFFICIENT_CANDIDATES":
      // Terminal: too few candidates survived to rank or fuse (need ≥2). Stop the
      // run and record why, so the UI can show an honest outcome instead of a
      // degenerate single-candidate "merged" result.
      return {
        ...state,
        running: false,
        insufficient: { done: action.done, failed: action.failed },
        audit: logAudit(
          state.audit,
          `Stopped: only ${action.done} candidate(s) succeeded (${action.failed} failed) — need at least 2.`
        ),
      };

    case "FANOUT_END":
      // Do NOT clear `running` here when candidates succeeded — the pipeline
      // continues into the Judge (and Fusion, in fuse mode). Clearing it now would
      // flash a zero-score leaderboard between fanout-done and judge-done.
      // Exception: when zero candidates returned, the pipeline cannot continue, so
      // this IS the terminal action and `running` must clear.
      return {
        ...state,
        running: action.count === 0 ? false : state.running,
        audit: logAudit(state.audit, `Fanout complete — ${action.count} candidate(s) returned.`),
      };

    case "JUDGE_START":
      return { ...state, judgeStatus: "running", judgeError: null };

    case "JUDGE_RESULT":
      // Terminal for RANK mode (the run ends after judging). In FUSE mode the
      // pipeline continues to fusion, so `running` stays true.
      return {
        ...state,
        running: action.mode === "fuse" ? state.running : false,
        judgeStatus: "done",
        consensus: action.consensus,
        candidates: state.candidates.map((c) =>
          action.scoresById[c.id] != null ? { ...c, weightedScore: action.scoresById[c.id] } : c
        ),
        audit: logAudit(state.audit, "AI judge evaluation complete."),
      };

    case "JUDGE_FAILED":
      // Terminal in ALL modes. Even in Fuse mode, a judge failure stops the run —
      // the pipeline does not proceed to fusion with unscored candidates, and the
      // error must be reachable in the UI (not hidden behind a stuck "running" state).
      return {
        ...state,
        running: false,
        judgeStatus: "error",
        judgeError: action.error,
        audit: logAudit(state.audit, `AI judge failed: ${action.error}`),
      };

    case "FUSION_START":
      return { ...state, fusionStatus: "running", fusionError: null };

    case "FUSION_RESULT":
      // Terminal for FUSE mode.
      return {
        ...state,
        running: false,
        fusionStatus: "done",
        fusedText: action.text,
        audit: logAudit(state.audit, "Fusion synthesis complete."),
      };

    case "FUSION_FAILED":
      return {
        ...state,
        running: false,
        fusionStatus: "error",
        fusionError: action.error,
        audit: logAudit(state.audit, `Fusion failed: ${action.error}`),
      };

    case "SET_MODELS":
      return { ...state, models: action.models };

    case "SET_RATING":
      return { ...state, qualityRating: action.value };

    case "RESET_SESSION":
      return { ...initialState, models: state.models, mode: state.mode };

    case "ABORT_RUN":
      return {
        ...state,
        running: false,
        aborted: true,
        candidates: state.candidates.map((c) =>
          c.status === "pending" ? { ...c, status: "error", errorMessage: "Aborted", finishedAt: Date.now() } : c
        ),
        judgeStatus: state.judgeStatus === "running" ? "idle" : state.judgeStatus,
        fusionStatus: state.fusionStatus === "running" ? "idle" : state.fusionStatus,
        audit: logAudit(state.audit, "Run aborted by user."),
      };

    case "RETRY_CANDIDATE_START":
      // Mark the candidate as pending again and clear prior error/segments.
      // Set running so the UI shows the retry in progress.
      return {
        ...state,
        running: true,
        judgeStatus: "idle",
        judgeError: null,
        consensus: null,
        fusionStatus: "idle",
        fusionError: null,
        fusedText: null,
        insufficient: null,
        candidates: state.candidates.map((c) =>
          c.id === action.id
            ? { ...c, status: "pending", errorMessage: undefined, segments: [], summary: "", streamingText: "", scores: {}, weightedScore: 0, startedAt: Date.now(), finishedAt: undefined }
            : c
        ),
        audit: logAudit(state.audit, `Retrying candidate ${action.id}.`),
      };

    case "RETRY_CANDIDATE_DELTA":
      return {
        ...state,
        candidates: state.candidates.map((c) =>
          c.id === action.id
            ? { ...c, streamingText: (c.streamingText ?? "") + action.delta }
            : c
        ),
      };

    case "RETRY_CANDIDATE_RESULT":
      return {
        ...state,
        candidates: state.candidates.map((c) =>
          c.id === action.id
            ? { ...c, status: "done", segments: action.segments, summary: action.summary, streamingText: "", finishedAt: action.finishedAt, tokensIn: action.tokensIn, tokensOut: action.tokensOut }
            : c
        ),
      };

    case "RETRY_CANDIDATE_FAILED":
      return {
        ...state,
        running: false,
        candidates: state.candidates.map((c) =>
          c.id === action.id ? { ...c, status: "error", errorMessage: action.error, finishedAt: action.finishedAt } : c
        ),
        audit: logAudit(state.audit, `Retry of candidate ${action.id} failed: ${action.error}`),
      };

    default:
      return state;
  }
}

export const initialState: StudioState = {
  mode: "rank",
  prompt: INITIAL_PROMPT,
  rubric: SEED_RUBRIC,
  slots: SEED_SLOTS,
  temperature: 0.4,
  systemPrompt: SYSTEM_PROMPT_DEFAULT,
  critic: DEFAULT_CRITIC_REF,
  candidates: [],
  running: false,
  models: [],
  judgeStatus: "idle",
  judgeError: null,
  consensus: null,
  insufficient: null,
  aborted: false,
  qualityRating: 0,
  fusionStatus: "idle",
  fusionError: null,
  fusedText: null,
  audit: [],
};
