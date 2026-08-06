// =============================================================================
// JudgeConfig — the Judge/Fusion model selector.
//
// `state.criticModel` powers BOTH the Judge stage (Rank) and the Fusion stage
// (Fuse). It is user-configurable here — finishing the config of an IN-scope
// stage (the Judge is IN per PRODUCT.md §5). This is NOT the OUT item "model
// roles": that referred to assigning fanout *slots* to draft/critic/verifier
// buckets, which we don't do. Here there is exactly one judge, set globally.
//
// Reuses the same pattern as ModelList's combobox: live-catalog autocomplete +
// manual raw-slug entry (so a brand-new judge model works before it's cataloged).
// =============================================================================

import { useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Search, X } from "lucide-react";
import type { Action } from "../studio-engine";
import type { CatalogModel, ProviderId, ReasoningPolicy } from "../lib/providers/types";
import type { Attachment } from "../lib/attachments/types";
import type { ModelSlot } from "../studio-data";
import { capabilitiesForModel, commonReasoningEfforts } from "../lib/providers/reasoning";
import { BrandAvatar } from "./brand-icons";
import { ProviderTabs, PROVIDER_LABELS } from "./ProviderTabs";
import { ReasoningEffortPicker } from "./ReasoningEffortPicker";

interface JudgeConfigProps {
  critic: { providerId: ProviderId; model: string };
  models: CatalogModel[];
  dispatch: React.Dispatch<Action>;
  /** Optional Compare policy; omitted by isolated legacy callers. */
  reasoningPolicy?: ReasoningPolicy;
  slots?: ModelSlot[];
  /** Optional custom instruction applied to the judge/fusion model. */
  judgeInstruction: string;
  /** Current task attachments — drives the "send to judge" toggle visibility. */
  attachments: Attachment[];
  /** Whether native media is sent to the judge/fusion critic (spec §6.2). */
  attachmentsToJudge: boolean;
}

export function JudgeConfig({
  critic,
  models,
  dispatch,
  reasoningPolicy,
  slots = [],
  judgeInstruction,
  attachments,
  attachmentsToJudge,
}: JudgeConfigProps) {
  const [editing, setEditing] = useState(false);
  const policy = reasoningPolicy ?? {
    candidates: "provider-default" as const,
    judge: "provider-default" as const,
  };
  const candidateEfforts = commonReasoningEfforts(slots);
  const judgeEfforts = capabilitiesForModel(critic.providerId, critic.model).supportedEfforts;
  // TODO(phase-2): adjacent gear button → judge settings popover (temperature,
  // system prompt — both already in state) per spec §4.4.
  const hasNativeAttachments = attachments.some((a) => a.kind === "image" || a.kind === "pdf");

  return (
    <div>
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
        Judge model <span className="text-xs normal-case tracking-normal">· also fuses</span>
      </span>

      {!editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Change judge model, current: ${critic.model}`}
          className="mt-2 flex min-h-[44px] w-full items-center gap-2.5 rounded-md border border-edge bg-card px-2.5 py-1.5 text-left hover:border-edge-bright hover:bg-card-hover"
        >
          <BrandAvatar slug={critic.model} size={28} />
          <span
            dir="rtl"
            className="min-w-0 flex-1 truncate font-mono text-sm text-text"
            title={critic.model}
          >
            {`‎${critic.model}`}
          </span>
          <span className="shrink-0 rounded-sm border border-edge px-1 text-[11px] uppercase tracking-wide text-text-secondary">
            {PROVIDER_LABELS[critic.providerId]}
          </span>
          <ChevronRight size={14} className="shrink-0 text-text-muted" />
        </button>
      )}

      {editing && (
        <JudgeCombobox
          models={models}
          current={critic.model}
          initialProvider={critic.providerId}
          onCancel={() => setEditing(false)}
          onCommit={(model, providerId) => {
            dispatch({ type: "SET_CRITIC", critic: { providerId, model } });
            setEditing(false);
          }}
        />
      )}

      <section
        aria-label="Reasoning policy"
        data-reasoning-policy=""
        className="mt-3 grid gap-3 rounded-md border border-edge bg-card p-2.5 sm:grid-cols-2"
      >
        <ReasoningEffortPicker
          label="Candidate reasoning effort"
          value={policy.candidates}
          options={candidateEfforts}
          onChange={(candidates) =>
            dispatch({ type: "SET_REASONING_POLICY", policy: { ...policy, candidates } })
          }
          description="Only levels supported by every enabled candidate are offered."
        />
        <ReasoningEffortPicker
          label="Judge reasoning effort"
          value={policy.judge}
          options={judgeEfforts}
          onChange={(judge) =>
            dispatch({ type: "SET_REASONING_POLICY", policy: { ...policy, judge } })
          }
          description="Provider default is not compute-equivalent across model families."
        />
      </section>

      {/* Optional custom instruction for the judge/fusion model — separate
          from the task prompt and weighted rubric. Empty = no instruction
          (prompts stay unchanged). */}
      <label
        htmlFor="judge-instruction"
        className="mt-3 block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
      >
        Judge instruction <span className="normal-case tracking-normal">· optional</span>
      </label>
      <textarea
        id="judge-instruction"
        value={judgeInstruction}
        onChange={(e) => dispatch({ type: "SET_JUDGE_INSTRUCTION", value: e.target.value })}
        placeholder="e.g. “Prefer concise answers and penalize hedging.” Applied on top of the evaluation, never overriding the scored JSON contract."
        aria-label="Optional judge instruction"
        rows={2}
        className="mt-1.5 min-h-[44px] w-full resize-y rounded-md border border-edge bg-card px-2.5 py-1.5 text-sm text-text placeholder-text-muted focus:border-edge-bright focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <p className="mt-1 text-[11px] text-text-muted">
        Optional guidance applied to every judge &amp; fusion pass. Leave blank to keep prompts
        unchanged.
      </p>

      {/* Native-media-to-judge toggle (spec §6.2). Only rendered when the task
          actually carries image/pdf attachments — invisible when idle. */}
      {hasNativeAttachments && (
        <label className="mt-3 flex items-start gap-2 rounded-md border border-edge bg-card px-2.5 py-2">
          <input
            type="checkbox"
            checked={attachmentsToJudge}
            onChange={(e) =>
              dispatch({ type: "SET_ATTACHMENTS_TO_JUDGE", value: e.target.checked })
            }
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#06b6d4]"
          />
          <span>
            <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary">
              Send attachments to judge
            </span>
            <span className="mt-0.5 block text-[11px] text-text-muted">
              {attachmentsToJudge
                ? "The judge sees the images/PDFs the candidates saw, so it can verify factual claims."
                : "Off — auto-disabled for more than 4 images or 4 MB of media. Re-enable to include them (costs more)."}
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

// ---- combobox (single-slug variant) -----------------------------------------

export function JudgeCombobox({
  models,
  current,
  initialProvider,
  onCancel,
  onCommit,
}: {
  models: CatalogModel[];
  current: string;
  /** The provider tab to open on — must match the current Judge's provider so
   *  editing never silently opens on a different provider (spec §6.1). */
  initialProvider: ProviderId;
  onCancel: () => void;
  onCommit: (slug: string, providerId: ProviderId) => void;
}) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(initialProvider);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Provider IDs are separate namespaces — switching clears the query and
  // refocuses (spec §6.1). The input is a persistent element, so synchronous
  // focus is safe and deterministic.
  const handleProviderChange = (p: ProviderId) => {
    setSelectedProvider(p);
    setQuery("");
    inputRef.current?.focus();
  };

  // Clear text first; close only when there is nothing left to clear (spec §6.2).
  const handleClearOrCancel = () => {
    if (query.length > 0) {
      setQuery("");
      inputRef.current?.focus();
    } else {
      onCancel();
    }
  };

  const providerModels = useMemo(() => {
    return models.filter((m) => m.providerId === selectedProvider);
  }, [models, selectedProvider]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = providerModels.length > 0 ? providerModels : [];
    if (q.length === 0) return pool;
    return pool.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  }, [query, providerModels]);

  const hasCatalog = providerModels.length > 0;
  const trimmed = query.trim();
  const isCurrentSelection = selectedProvider === initialProvider && trimmed === current;
  const slugValid =
    trimmed.length > 0 &&
    (selectedProvider === "openrouter" ||
    selectedProvider === "commandcode" ||
    selectedProvider === "clinepass"
      ? trimmed.includes("/")
      : true) &&
    !isCurrentSelection;
  return (
    <div className="mt-2 rounded-md border border-edge-bright bg-card p-2">
      <ProviderTabs
        value={selectedProvider}
        onChange={handleProviderChange}
        ariaLabel="Judge model providers"
      />
      <label htmlFor="judge-search" className="sr-only">
        Judge model
      </label>
      <div className="flex items-center gap-1 rounded-sm border border-edge bg-panel px-2 py-1 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
        <Search size={13} className="shrink-0 text-text-muted" />
        <input
          id="judge-search"
          ref={inputRef}
          role="searchbox"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (slugValid) onCommit(trimmed, selectedProvider);
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
          placeholder="Search catalog or type a slug (provider/model)…"
          aria-label="Search the model catalog or enter a judge slug"
          className="min-h-[44px] flex-1 bg-transparent font-mono text-sm text-text placeholder-text-muted focus:outline-none"
        />
        <button
          type="button"
          onClick={handleClearOrCancel}
          aria-label={query.length > 0 ? "Clear judge model search" : "Cancel judge edit"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-text"
        >
          <X size={13} />
        </button>
      </div>

      {/* Live catalog matches */}
      {hasCatalog && matches.length > 0 && (
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-sm border border-edge scroll-thin">
          {matches.map((m) => {
            const selected = m.providerId === initialProvider && m.id === current;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onCommit(m.id, m.providerId)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-2 px-2 py-2 text-left font-mono text-sm text-text-secondary hover:bg-card-hover"
                >
                  <span className="min-w-0 truncate">
                    {m.name}
                    <span className="ml-2 text-text-muted">{m.id}</span>
                  </span>
                  {selected && <Check size={13} className="shrink-0 text-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hasCatalog && matches.length === 0 && query.trim().length > 0 && (
        <p className="px-1 py-2 font-mono text-sm text-text-muted">
          No catalog match — commit the slug below.
        </p>
      )}

      {/* Manual raw-slug commit */}
      {slugValid ? (
        <button
          type="button"
          onClick={() => onCommit(trimmed, selectedProvider)}
          aria-label={`Set judge to ${trimmed}`}
          className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm border border-accent/40 bg-accent/[0.06] py-2 font-mono text-sm text-accent hover:bg-accent/[0.12]"
        >
          <Check size={13} /> set judge
          <span className="max-w-[55%] truncate" title={trimmed}>
            {trimmed}
          </span>
        </button>
      ) : (
        query.trim().length > 0 &&
        !slugValid && (
          <p className="mt-2 px-1 font-mono text-sm text-text-muted">
            {selectedProvider === "openrouter"
              ? "Enter a slug as provider/model"
              : "Enter a model id (e.g. gpt-5.6-sol)"}
          </p>
        )
      )}
    </div>
  );
}
