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
  INITIAL_EXAMPLE_INDEX,
  INITIAL_PROMPT,
  SEED_SLOTS,
  SYSTEM_PROMPT_DEFAULT,
  type AuditEntry,
  type Candidate,
  type CandidateSegment,
  type ConsensusBreakdown,
  type JudgeReport,
  type Mode,
  type ModelSlot,
} from "./studio-data";
import {
  DEFAULT_REASONING_POLICY,
  type CatalogModel,
  type CriticRef,
  type ProviderId,
  type ReasoningPolicy,
} from "./lib/providers/types";
import { loadStoredCritic, loadStoredSlots } from "./lib/preferences";
import { EXAMPLE_TASKS, nextExampleIndex } from "./lib/test-cases";
import type { Attachment } from "./lib/attachments/types";
import { MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES } from "./lib/attachments/limits";
import {
  HOLISTIC_EVALUATION,
  deepCopyEvaluationConfig,
  type AdHocEvaluationConfig,
} from "./lib/evaluations/evaluation-rubric-adhoc";
import type { ComparisonTaskBinding } from "./lib/compare/comparison-result-types";

export type StageStatus = "idle" | "running" | "done" | "error";

/** Frozen execution protocol captured at fanout start (run-recovery spec §5.2).
 *  Every paid stage and retry consumes this snapshot; mutable command-pane state
 *  cannot change reasoning, Judge/candidate identity, mode, task, rubric,
 *  attachments, or retry inputs after execution begins. Deep-copied by the
 *  reducer so later edits cannot mutate the snapshot. Current-session only:
 *  cleared on reset, replaced on every new fanout. Never carries provider
 *  secrets or candidate outputs. */
export interface RunEvaluationContext {
  /** Frozen execution mode and task protocol. Legacy prompt/evaluation fields
   * remain below so pre-hardening in-memory callers and persisted records stay
   * readable; new runs always populate both representations. */
  mode?: Mode;
  task?: {
    prompt: string;
    systemPrompt: string;
    temperature: number;
  };
  prompt: string;
  evaluation: AdHocEvaluationConfig;
  /** Frozen candidate roster — retries never resolve mutable slot state. */
  slots?: ModelSlot[];
  /** Frozen Judge/Fusion target and instruction. */
  critic?: CriticRef;
  judgeInstruction?: string;
  /** Frozen attachment set the candidates saw — retries reproduce it exactly
   *  (plan 7.6.6), even if the user edits the command pane afterwards. */
  attachments: Attachment[];
  /** Frozen §6.2 flag: whether native media reached the judge/fusion critic. */
  attachmentsToJudge: boolean;
  /** Immutable candidate/Judge effort requested for this run. */
  reasoningPolicy?: ReasoningPolicy;
  /** Task binding of the comparison (spec §3, §5). */
  taskBinding?: ComparisonTaskBinding | null;
  /** Content-addressed immutable input snapshot ref (spec §3, §5). */
  inputSnapshotRef?: string | null;
  /** Canonical Task Instance id (spec §3, §5). Null for ad-hoc. */
  taskInstanceId?: string | null;
}

export interface StudioState {
  // --- the sole switch ---
  mode: Mode;

  // --- command (left pane, identical in both modes) ---
  prompt: string;
  /** Index of the last curated example loaded by the "Try an example" control.
   *  `-1` means none loaded yet. Drives rotation via `nextExampleIndex`. */
  exampleIndex: number;
  evaluation: AdHocEvaluationConfig;
  slots: ModelSlot[];
  temperature: number;
  systemPrompt: string;
  critic: CriticRef;
  /** Optional custom instruction applied to every judge/fusion path, separate
   *  from the task prompt and weighted rubric. Empty string = no instruction
   *  (prompts stay byte-identical to the pre-instruction baseline). */
  judgeInstruction: string;
  reasoningPolicy: ReasoningPolicy;
  /** Current task binding (canonical Task or ad-hoc). */
  taskBinding?: ComparisonTaskBinding | null;
  // --- task attachments (attachments spec §4) ---
  /** In-memory attachment set for the current task. Bytes/text never persist
   *  to localStorage or history (metadata only, phase 7.7). */
  attachments: Attachment[];
  /** Whether native media (image/pdf parts) is also sent to the judge/fusion
   *  critic (spec §6.2). Auto-defaulted on attachment-set changes; the user can
   *  override via SET_ATTACHMENTS_TO_JUDGE until the next set change. */
  attachmentsToJudge: boolean;

  // --- live pipeline execution state ---
  candidates: Candidate[];
  running: boolean;
  models: CatalogModel[];
  judgeStatus: StageStatus;
  judgeError: string | null;
  consensus: ConsensusBreakdown | null;
  /** Current run's resolved blind judge report — the audit trail for every
   *  score (label map, per-candidate evaluations, comparisons). Cleared on new
   *  fanout / retry / reset / judge failure; preserved across Rank/Fuse toggle. */
  judgeReport: JudgeReport | null;
  fusionStatus: StageStatus;
  fusionError: string | null;
  fusedText: string | null;
  /** Terminal state set when too few candidates succeeded to rank/fuse (need ≥2).
   *  `{done, failed}` describes how the fanout ended. Null when not applicable. */
  insufficient: { done: number; failed: number } | null;
  aborted: boolean;
  /** Precise cross-tab lease-loss state; null for ordinary user aborts. */
  executionConflict?: string | null;
  /** Frozen prompt/rubric snapshot for the current run, captured at FANOUT_START.
   *  Enables Judge-only retry against the exact generation context the retained
   *  candidates answered. Null before the first run and after RESET_SESSION. */
  runContext: RunEvaluationContext | null;
  /** Persisted id of the current/last Compare run, minted by the run
   *  controller and surfaced at FANOUT_START (Slice 5, Compare → View record).
   *  Retries and re-fuse reuse the same id; null before the first run and
   *  after RESET_SESSION. */
  runId: string | null;
  // --- background learning loop (RANK-mode only, optional surface) ---
  qualityRating: number;
  audit: AuditEntry[];
}

export type Action =
  // --- the sole switch ---
  | { type: "SET_MODE"; mode: Mode }
  // --- command ---
  | { type: "SET_PROMPT"; value: string }
  | { type: "SET_TASK_BINDING"; binding: ComparisonTaskBinding | null }
  | { type: "LOAD_EXAMPLE"; force?: boolean }
  | { type: "SET_EVALUATION"; config: AdHocEvaluationConfig }
  | { type: "ADD_SLOT"; slot: ModelSlot }
  | { type: "REMOVE_SLOT"; id: string }
  | {
      type: "SWAP_SLOT";
      id: string;
      providerId?: ProviderId;
      provider: string;
      model: string;
      slug: string;
    }
  | { type: "TOGGLE_SLOT"; id: string }
  | { type: "SET_TEMPERATURE"; value: number }
  | { type: "SET_SYSTEM_PROMPT"; value: string }
  | { type: "SET_CRITIC"; critic: CriticRef }
  | { type: "SET_CRITIC_MODEL"; value: string }
  | { type: "SET_JUDGE_INSTRUCTION"; value: string }
  | { type: "SET_REASONING_POLICY"; policy: ReasoningPolicy }
  // --- attachments (spec §4.1, §9) ---
  | { type: "ADD_ATTACHMENTS"; attachments: Attachment[] }
  | {
      type: "ATTACHMENT_READY";
      id: string;
      data?: string;
      text?: string;
      truncated?: boolean;
      width?: number;
      height?: number;
      pageCount?: number;
      mimeType?: string;
    }
  | { type: "ATTACHMENT_FAILED"; id: string; error: string }
  | { type: "ATTACHMENT_RETRY"; id: string }
  | { type: "REMOVE_ATTACHMENT"; id: string }
  | { type: "CLEAR_ATTACHMENTS" }
  | { type: "SET_ATTACHMENTS_TO_JUDGE"; value: boolean }
  // --- pipeline ---
  | {
      type: "FANOUT_START";
      candidates: Candidate[];
      context: RunEvaluationContext;
      /** Production controllers always supply the persisted id. Optional only
       *  so older in-memory/test callers degrade honestly to a non-linkable
       *  current run instead of fabricating an id. */
      runId?: string;
    }
  | { type: "FANOUT_BLOCKED"; reason: string }
  | {
      type: "CANDIDATE_RESULT";
      id: string;
      segments: CandidateSegment[];
      summary: string;
      finishedAt: number;
      tokensIn: number | null;
      tokensOut: number | null;
    }
  | { type: "CANDIDATE_DELTA"; id: string; delta: string }
  | { type: "CANDIDATE_FAILED"; id: string; error: string; finishedAt: number }
  | { type: "FANOUT_END"; count: number }
  | { type: "INSUFFICIENT_CANDIDATES"; done: number; failed: number }
  | { type: "JUDGE_START" }
  | {
      type: "JUDGE_RESULT";
      mode: Mode;
      consensus: ConsensusBreakdown;
      scoresById: Record<string, number>;
      report: JudgeReport;
      /** Score domain for display (spec §16.3): "compliance" for runs with a
       *  compliance-only profile (weightedScore = C in [0,1]). */
      scoreDomain?: "rank" | "compliance";
    }
  | { type: "JUDGE_FAILED"; error: string }
  | { type: "FUSION_START" }
  | { type: "FUSION_RESULT"; text: string }
  | { type: "FUSION_FAILED"; error: string }
  | { type: "SET_MODELS"; models: CatalogModel[] }
  | { type: "SET_RATING"; value: number }
  | { type: "RESET_SESSION" }
  | { type: "ABORT_RUN" }
  | { type: "LEASE_LOST"; message: string }
  // --- Compare config preload (Slice 5, Run Detail → Open in Compare) ---
  // Opens the persisted configuration as a FRESH Compare draft: historical
  // results, run identity/context, attachments, and non-restorable judge
  // instruction must not leak into the new draft. Active Compare execution is
  // immutable, so the reducer ignores this action while `running` is true.
  | {
      type: "LOAD_RUN_CONFIG";
      config: {
        mode: Mode;
        prompt: string;
        systemPrompt: string;
        temperature: number;
        evaluation: AdHocEvaluationConfig;
        slots: ModelSlot[];
        /** Judge target restored from the run's accepted judge attempt.
         *  Absent when the record has no judge attempt (aborted pre-judge). */
        critic?: CriticRef;
        judgeInstruction?: string;
        reasoningPolicy?: ReasoningPolicy;
      };
    }
  // --- single-candidate retry ---
  | { type: "RETRY_CANDIDATE_START"; id: string }
  | { type: "RETRY_CANDIDATE_DELTA"; id: string; delta: string }
  | {
      type: "RETRY_CANDIDATE_RESULT";
      id: string;
      segments: CandidateSegment[];
      summary: string;
      finishedAt: number;
      tokensIn: number | null;
      tokensOut: number | null;
    }
  | { type: "RETRY_CANDIDATE_FAILED"; id: string; error: string; finishedAt: number };

let auditSeq = 0;
const logAudit = (audit: AuditEntry[], message: string): AuditEntry[] => {
  auditSeq += 1;
  const entry: AuditEntry = {
    id: `audit-${Date.now()}-${auditSeq}`,
    time: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    message,
  };
  return [entry, ...audit].slice(0, 40);
};

/**
 * Populate a candidate's `scores` map from the judge's per-criterion scores.
 * Keys by the criterion's display label; when two or more criteria share a
 * label, EVERY entry in that collision group is suffixed with its criterion id
 * so the criterion matrix/leaderboard keys are unambiguous (spec §5.5).
 * Returns an empty map when no criterion scores exist — never invents dimensions.
 */
function criterionScoresToMap(
  criterionScores: { criterionId: string; label: string; score?: number; kind?: string }[],
): Record<string, number> {
  const labelCounts = new Map<string, number>();
  for (const cs of criterionScores) {
    labelCounts.set(cs.label, (labelCounts.get(cs.label) ?? 0) + 1);
  }
  const out: Record<string, number> = {};
  for (const cs of criterionScores) {
    if (cs.score === undefined) continue; // skip binary criteria (no numeric score)
    const key = (labelCounts.get(cs.label) ?? 0) > 1 ? `${cs.label} (${cs.criterionId})` : cs.label;
    out[key] = cs.score;
  }
  return out;
}
/**
 * Spec §6.2 thresholds for auto-sending native media to the judge.
 * Default ON when the native payload is small enough that re-sending it to
 * the critic is cheap: ≤ 4 MB total native bytes AND ≤ 4 images.
 */
export const NATIVE_TO_JUDGE_MAX_BYTES = 4 * 1024 * 1024;
export const NATIVE_TO_JUDGE_MAX_IMAGES = 4;

/** Compute the spec §6.2 default for `attachmentsToJudge` from a set. */
export function computeAttachmentsToJudgeDefault(attachments: Attachment[]): boolean {
  const nativeBytes = attachments.reduce(
    (sum, a) => sum + (a.kind === "image" || a.kind === "pdf" ? a.bytes : 0),
    0,
  );
  const imageCount = attachments.filter((a) => a.kind === "image").length;
  return nativeBytes <= NATIVE_TO_JUDGE_MAX_BYTES && imageCount <= NATIVE_TO_JUDGE_MAX_IMAGES;
}

export function reducer(state: StudioState, action: Action): StudioState {
  switch (action.type) {
    case "SET_MODE":
      return { ...state, mode: action.mode };

    case "SET_PROMPT":
      return { ...state, prompt: action.value };

    case "SET_TASK_BINDING":
      return { ...state, taskBinding: action.binding };
    case "LOAD_EXAMPLE": {
      // Guard against silently destroying meaningful USER text. Filling is
      // allowed without `force` only when:
      //   - the current prompt is empty/whitespace, OR
      //   - the current prompt is still the previously-loaded example (i.e. the
      //     user clicked "Try an example" again without editing it) — this is a
      //     deliberate rotation, not a silent overwrite.
      // Any other non-empty text (user-typed) requires `force: true`, which the
      // UI's confirm-replace affordance supplies after a second click.
      const isBlank = state.prompt.trim().length === 0;
      const isUneditedExample =
        state.exampleIndex >= 0 && EXAMPLE_TASKS[state.exampleIndex]?.prompt === state.prompt;
      if (!isBlank && !isUneditedExample && !action.force) return state;
      const index = nextExampleIndex(state.exampleIndex);
      const task = EXAMPLE_TASKS[index];
      if (!task) return state;
      return { ...state, prompt: task.prompt, exampleIndex: index };
    }

    case "SET_EVALUATION":
      return { ...state, evaluation: action.config };

    case "ADD_SLOT":
      return { ...state, slots: [...state.slots, action.slot] };

    case "REMOVE_SLOT":
      return { ...state, slots: state.slots.filter((s) => s.id !== action.id) };

    case "SWAP_SLOT": {
      // Switch a slot's model in place, keeping its stable `id` so the
      // candidate→slot retry link (cand-<slotId>) survives the switch. When the
      // caller supplies providerId (a cross-provider switch), update it too so
      // the retry path resolves the correct provider adapter; otherwise keep the
      // existing providerId (model-only change within the same provider).
      const slots = state.slots.map((s) =>
        s.id === action.id
          ? {
              ...s,
              providerId: action.providerId ?? s.providerId,
              provider: action.provider,
              model: action.model,
              slug: action.slug,
            }
          : s,
      );
      return { ...state, slots };
    }

    case "TOGGLE_SLOT":
      return {
        ...state,
        slots: state.slots.map((s) => (s.id === action.id ? { ...s, enabled: !s.enabled } : s)),
      };

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

    case "SET_JUDGE_INSTRUCTION":
      return { ...state, judgeInstruction: action.value };

    case "SET_REASONING_POLICY":
      return { ...state, reasoningPolicy: { ...action.policy } };

    case "ADD_ATTACHMENTS": {
      // Defence in depth: the picker already ran admitFiles (spec §3.1), but a
      // file that slips past it can never enter state. Per-file admission:
      // over-count and over-total reject only the offending files, keeping the
      // rest — mirroring admitFiles exactly.
      const next = [...state.attachments];
      for (const att of action.attachments) {
        if (next.length >= MAX_FILES) break;
        if (att.bytes > MAX_FILE_BYTES) continue;
        const total = next.reduce((sum, a) => sum + a.bytes, 0);
        if (total + att.bytes > MAX_TOTAL_BYTES) continue;
        next.push(att);
      }
      return {
        ...state,
        attachments: next,
        // The auto-default tracks the set; a user override (SET_ATTACHMENTS_TO_JUDGE)
        // persists until the next set change (spec §6.2).
        attachmentsToJudge: computeAttachmentsToJudgeDefault(next),
      };
    }

    case "ATTACHMENT_READY":
      return {
        ...state,
        attachments: state.attachments.map((a) =>
          a.id === action.id
            ? {
                ...a,
                status: "ready",
                error: undefined,
                data: action.data ?? a.data,
                text: action.text ?? a.text,
                truncated: action.truncated ?? a.truncated,
                width: action.width ?? a.width,
                height: action.height ?? a.height,
                pages: action.pageCount ?? a.pages,
                mimeType: action.mimeType ?? a.mimeType,
              }
            : a,
        ),
      };

    case "ATTACHMENT_FAILED":
      return {
        ...state,
        attachments: state.attachments.map((a) =>
          a.id === action.id ? { ...a, status: "error", error: action.error } : a,
        ),
      };

    case "ATTACHMENT_RETRY":
      return {
        ...state,
        attachments: state.attachments.map((a) =>
          a.id === action.id ? { ...a, status: "reading", error: undefined } : a,
        ),
      };

    case "REMOVE_ATTACHMENT": {
      const next = state.attachments.filter((a) => a.id !== action.id);
      return {
        ...state,
        attachments: next,
        attachmentsToJudge: computeAttachmentsToJudgeDefault(next),
      };
    }

    case "CLEAR_ATTACHMENTS":
      return {
        ...state,
        attachments: [],
        attachmentsToJudge: computeAttachmentsToJudgeDefault([]),
      };

    case "SET_ATTACHMENTS_TO_JUDGE":
      return { ...state, attachmentsToJudge: action.value };

    case "FANOUT_START":
      return {
        ...state,
        running: true,
        runId: action.runId ?? null,
        candidates: action.candidates,
        consensus: null,
        judgeStatus: "idle",
        judgeError: null,
        judgeReport: null,
        fusedText: null,
        fusionStatus: "idle",
        fusionError: null,
        insufficient: null,
        aborted: false,
        executionConflict: null,
        // Snapshot the generation context for Judge-only recovery. Deep-copied
        // here (defense in depth) so neither the caller's payload nor later
        // command-pane edits can mutate what a Judge retry evaluates against.
        runContext: {
          mode: action.context.mode,
          task: action.context.task ? { ...action.context.task } : undefined,
          prompt: action.context.prompt,
          evaluation: deepCopyEvaluationConfig(action.context.evaluation),
          slots: action.context.slots?.map((slot) => ({ ...slot })),
          critic: action.context.critic ? { ...action.context.critic } : undefined,
          judgeInstruction: action.context.judgeInstruction,
          attachments: action.context.attachments.map((a) => ({ ...a })),
          attachmentsToJudge: action.context.attachmentsToJudge,
          reasoningPolicy: action.context.reasoningPolicy
            ? { ...action.context.reasoningPolicy }
            : undefined,
          taskBinding: action.context.taskBinding ?? state.taskBinding ?? null,
          inputSnapshotRef: action.context.inputSnapshotRef ?? null,
          taskInstanceId: action.context.taskInstanceId ?? null,
        },
        audit: logAudit(
          state.audit,
          `Fanout started across ${action.candidates.length} candidate(s).`,
        ),
      };

    case "FANOUT_BLOCKED":
      // The RunButton gate normally prevents this; the controller dispatches it
      // as a visible audit trail when a run is attempted anyway (shortcut, race).
      return { ...state, audit: logAudit(state.audit, `Run blocked: ${action.reason}`) };

    case "CANDIDATE_RESULT":
      return {
        ...state,
        candidates: state.candidates.map((c) =>
          c.id === action.id
            ? {
                ...c,
                status: "done",
                segments: action.segments,
                summary: action.summary,
                streamingText: "",
                finishedAt: action.finishedAt,
                tokensIn: action.tokensIn,
                tokensOut: action.tokensOut,
              }
            : c,
        ),
      };

    case "CANDIDATE_DELTA":
      // Append a streamed token chunk to the candidate's in-progress text. Used
      // only during fanout; on completion CANDIDATE_RESULT clears streamingText.
      return {
        ...state,
        candidates: state.candidates.map((c) =>
          c.id === action.id ? { ...c, streamingText: (c.streamingText ?? "") + action.delta } : c,
        ),
      };

    case "CANDIDATE_FAILED":
      return {
        ...state,
        candidates: state.candidates.map((c) =>
          c.id === action.id
            ? { ...c, status: "error", errorMessage: action.error, finishedAt: action.finishedAt }
            : c,
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
          `Stopped: only ${action.done} candidate(s) succeeded (${action.failed} failed) — need at least 2.`,
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
      // Active-stage transition for BOTH the normal fanout → judge handoff and a
      // standalone Judge-only retry (run-recovery spec §5.4). Sets running so the
      // UI shows the pipeline as active, and clears every stale terminal artifact
      // — a retry must not render the previous error, report, consensus, or
      // insufficient/fusion residue while the new attempt is in flight. The run
      // context is retained: it is the retry's frozen evaluation input.
      return {
        ...state,
        running: true,
        judgeStatus: "running",
        judgeError: null,
        judgeReport: null,
        consensus: null,
        insufficient: null,
        fusionStatus: "idle",
        fusionError: null,
        fusedText: null,
      };

    case "JUDGE_RESULT": {
      // Terminal for RANK mode (the run ends after judging). In FUSE mode the
      // pipeline continues to fusion, so `running` stays true. The resolved
      // blind report is stored so every score traces to a structured explanation;
      // criterion scores populate Candidate.scores (display-label keyed, with
      // id disambiguation for collisions) so the criterion matrix is functional.
      const evalById = action.report.evaluationsById;
      return {
        ...state,
        running: action.mode === "fuse" ? state.running : false,
        judgeStatus: "done",
        consensus: action.consensus,
        judgeReport: action.report,
        candidates: state.candidates.map((c) => {
          const score = action.scoresById[c.id];
          const ev = evalById[c.id];
          const scores = ev ? criterionScoresToMap(ev.criterionScores) : (c.scores ?? {});
          return score != null
            ? {
                ...c,
                weightedScore: score,
                scores,
                scoreDomain: action.scoreDomain ?? c.scoreDomain,
              }
            : c;
        }),
        audit: logAudit(state.audit, "AI judge evaluation complete."),
      };
    }
    case "JUDGE_FAILED":
      // Terminal in ALL modes. Even in Fuse mode, a judge failure stops the run —
      // the pipeline does not proceed to fusion with unscored candidates, and the
      // error must be reachable in the UI (not hidden behind a stuck "running" state).
      return {
        ...state,
        running: false,
        judgeStatus: "error",
        judgeError: action.error,
        judgeReport: null,
        audit: logAudit(state.audit, `AI judge failed: ${action.error}`),
      };

    case "FUSION_START":
      // Standalone re-fusion is an active provider stage too. Marking it
      // running prevents Judge retry or another fusion from overlapping it.
      return { ...state, running: true, fusionStatus: "running", fusionError: null };

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

    case "LOAD_RUN_CONFIG": {
      // Opening a persisted run is a NEW Compare draft, not a mutation of the
      // current/previous execution. Never overwrite a live run. When idle,
      // reset all execution/output identity plus in-memory attachments before
      // applying the fields the persisted record can honestly restore.
      if (state.running) return state;
      const cfg = action.config;
      return {
        ...initialState,
        models: state.models,
        mode: cfg.mode,
        prompt: cfg.prompt,
        exampleIndex: -1,
        systemPrompt: cfg.systemPrompt,
        temperature: cfg.temperature,
        evaluation: deepCopyEvaluationConfig(cfg.evaluation),
        slots: cfg.slots.map((slot) => ({ ...slot })),
        critic: cfg.critic ? { ...cfg.critic } : { ...initialState.critic },
        // The record does not persist the user's ad-hoc custom judge
        // instruction. Empty it instead of silently carrying unrelated text
        // from the current Compare session into the historical draft.
        judgeInstruction: cfg.judgeInstruction ?? "",
        // A record that lacks a reconstructible reasoning policy (e.g.
        // aborted pre-judge) must NOT inherit the mutable current Compare
        // session policy — start the fresh draft from the clean initialState
        // baseline so no session configuration leaks across historical loads.
        reasoningPolicy: cfg.reasoningPolicy
          ? { ...cfg.reasoningPolicy }
          : { ...initialState.reasoningPolicy },
        // Attachments are intentionally memory-only and cannot be reconstructed
        // from persisted metadata. A historical draft therefore starts clean.
        attachments: [],
        attachmentsToJudge: computeAttachmentsToJudgeDefault([]),
        audit: logAudit(state.audit, "Run configuration loaded as a fresh Compare draft."),
      };
    }

    case "RESET_SESSION":
      // Keep mode, catalog, and the user's model roster/judge — reset only clears
      // the current run/output, not command configuration the user chose.
      return {
        ...initialState,
        models: state.models,
        mode: state.mode,
        slots: state.slots,
        critic: state.critic,
        taskBinding: null,
      };

    case "LEASE_LOST":
      return {
        ...state,
        running: false,
        aborted: true,
        executionConflict: action.message,
        audit: logAudit(state.audit, action.message),
      };

    case "ABORT_RUN":
      return {
        ...state,
        running: false,
        aborted: true,
        candidates: state.candidates.map((c) =>
          c.status === "pending"
            ? { ...c, status: "error", errorMessage: "Aborted", finishedAt: Date.now() }
            : c,
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
        judgeReport: null,
        fusionStatus: "idle",
        fusionError: null,
        fusedText: null,
        insufficient: null,
        candidates: state.candidates.map((c) =>
          c.id === action.id
            ? {
                ...c,
                status: "pending",
                errorMessage: undefined,
                segments: [],
                summary: "",
                streamingText: "",
                scores: {},
                weightedScore: 0,
                startedAt: Date.now(),
                finishedAt: undefined,
              }
            : c,
        ),
        audit: logAudit(state.audit, `Retrying candidate ${action.id}.`),
      };

    case "RETRY_CANDIDATE_DELTA":
      return {
        ...state,
        candidates: state.candidates.map((c) =>
          c.id === action.id ? { ...c, streamingText: (c.streamingText ?? "") + action.delta } : c,
        ),
      };

    case "RETRY_CANDIDATE_RESULT":
      return {
        ...state,
        candidates: state.candidates.map((c) =>
          c.id === action.id
            ? {
                ...c,
                status: "done",
                segments: action.segments,
                summary: action.summary,
                streamingText: "",
                finishedAt: action.finishedAt,
                tokensIn: action.tokensIn,
                tokensOut: action.tokensOut,
              }
            : c,
        ),
      };

    case "RETRY_CANDIDATE_FAILED":
      return {
        ...state,
        running: false,
        candidates: state.candidates.map((c) =>
          c.id === action.id
            ? { ...c, status: "error", errorMessage: action.error, finishedAt: action.finishedAt }
            : c,
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
  exampleIndex: INITIAL_EXAMPLE_INDEX,
  evaluation: HOLISTIC_EVALUATION,
  slots: loadStoredSlots() ?? SEED_SLOTS,
  temperature: 0.4,
  systemPrompt: SYSTEM_PROMPT_DEFAULT,
  critic: loadStoredCritic() ?? DEFAULT_CRITIC_REF,
  judgeInstruction: "",
  reasoningPolicy: { ...DEFAULT_REASONING_POLICY },
  attachments: [],
  attachmentsToJudge: true,
  candidates: [],
  running: false,
  models: [],
  judgeStatus: "idle",
  judgeError: null,
  consensus: null,
  judgeReport: null,
  insufficient: null,
  aborted: false,
  executionConflict: null,
  runContext: null,
  runId: null,
  qualityRating: 0,
  fusionStatus: "idle",
  fusionError: null,
  fusedText: null,
  audit: [],
  taskBinding: null,
};
