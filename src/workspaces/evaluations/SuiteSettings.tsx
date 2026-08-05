// =============================================================================
// SuiteSettings — in-page disclosure for suite configuration (spec §10.3).
//
// Not a permanent third pane. Opens from the SuiteEditor header as a disclosure.
// Holds: name + description (with saved-state), model roster (provider-scoped
// selector reusing Compare's AddModelCombobox pattern), default Judge selector,
// and default evaluation selection (holistic or pinned profile version).
// Duplicate model keys surface a field error.
// =============================================================================

import { useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Plus,
  Search,
  Trash2,
  X,
  Check,
} from "lucide-react";
import { ModelProbeControl } from "../../ui/ModelProbeControl";
import { useModelProbe } from "../../ui/ModelProbeContext";
import type { CatalogModel, ProviderId } from "../../lib/providers/types";
import type { ModelSlot } from "../../studio-data";
import type {
  EvaluationSuite,
  EvaluationSelection,
  EvaluationProfileRef,
} from "../../lib/evaluations/evaluation-types";
import type { ProfileRecord } from "../../lib/evaluations/evaluation-types";
import { ProviderTabs, PROVIDER_LABELS } from "../../ui/ProviderTabs";
import { CompactModelLabel } from "../../ui/CompactModelLabel";
import { modelKey } from "../../lib/history-cache";
import { DEFAULT_REASONING_POLICY } from "../../lib/providers/types";
import { capabilitiesForModel, commonReasoningEfforts } from "../../lib/providers/reasoning";
import { ReasoningEffortPicker } from "../../ui/ReasoningEffortPicker";

interface SuiteSettingsProps {
  suite: EvaluationSuite;
  onChange: (patch: Partial<EvaluationSuite>) => void;
  /** Catalog models from provider probes (may be empty if no keys). */
  models: CatalogModel[];
  /** Available profile records for the default-evaluation pinned-profile picker. */
  profileRecords: ProfileRecord[];
  /** Resolve a pinned profile ref to a display label (name + version). */
  resolveProfileLabel: (ref: EvaluationProfileRef) => string;
}

export function SuiteSettings({
  suite,
  onChange,
  models,
  profileRecords,
  resolveProfileLabel,
}: SuiteSettingsProps) {
  const { testBatch } = useModelProbe();
  const enabledSlots = suite.modelSlots.filter((s) => s.enabled);
  const reasoningPolicy = suite.reasoningPolicy ?? DEFAULT_REASONING_POLICY;
  const candidateEfforts = commonReasoningEfforts(suite.modelSlots);
  const judgeEfforts = capabilitiesForModel(suite.defaultJudge.providerId, suite.defaultJudge.model).supportedEfforts;
  const takenKeys = useMemo(
    () => new Set(enabledSlots.map((s) => modelKey(s.providerId, s.slug))),
    [enabledSlots],
  );

  // Detect duplicate model keys among enabled slots.
  const dupKeyError = useMemo(() => {
    const seen = new Set<string>();
    for (const s of enabledSlots) {
      const k = modelKey(s.providerId, s.slug);
      if (seen.has(k)) return `Duplicate model key "${k}" — enabled models must have unique providerId:modelSlug.`;
      seen.add(k);
    }
    return null;
  }, [enabledSlots]);

  function setSlotEnabled(slotId: string, enabled: boolean) {
    onChange({
      modelSlots: suite.modelSlots.map((s) => (s.id === slotId ? { ...s, enabled } : s)),
    });
  }

  function removeSlot(slotId: string) {
    onChange({ modelSlots: suite.modelSlots.filter((s) => s.id !== slotId) });
  }

  function addSlot(slot: ModelSlot) {
    onChange({ modelSlots: [...suite.modelSlots, slot] });
  }

  function setDefaultJudge(providerId: ProviderId, model: string) {
    onChange({ defaultJudge: { providerId, model } });
  }

  function setDefaultEvaluation(sel: EvaluationSelection) {
    onChange({ defaultEvaluation: sel });
  }

  return (
    <div className="space-y-4 rounded-md border border-edge bg-panel p-3">
      {/* Name + description */}
      <div className="space-y-2">
        <label
          htmlFor="suite-name"
          className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
        >
          Suite name
        </label>
        <input
          id="suite-name"
          type="text"
          value={suite.name}
          onChange={(e) => onChange({ name: e.target.value })}
          aria-invalid={!suite.name.trim()}
          className="min-h-[44px] w-full rounded-sm border border-edge bg-card px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {!suite.name.trim() && (
          <p className="text-xs text-error">Suite name is required.</p>
        )}

        <label
          htmlFor="suite-description"
          className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
        >
          Description <span className="normal-case tracking-normal">· optional</span>
        </label>
        <textarea
          id="suite-description"
          value={suite.description}
          onChange={(e) => onChange({ description: e.target.value })}
          rows={2}
          className="min-h-[44px] w-full resize-y rounded-sm border border-edge bg-card px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>

      {/* Model roster */}
      <div className="space-y-2">
        <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Candidate models
        </span>
        {dupKeyError && (
          <p role="alert" className="text-xs text-error">{dupKeyError}</p>
        )}
        {suite.modelSlots.length === 0 && (
          <p className="text-xs text-text-muted">No models yet. Add at least two enabled candidates to run.</p>
        )}
        <ul className="space-y-1" role="list">
          {suite.modelSlots.map((slot) => (
            <li
              key={slot.id}
              className="flex min-h-[44px] items-center gap-2 rounded-sm border border-edge bg-card px-2 py-1"
            >
              <label className="flex min-h-[44px] cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={slot.enabled}
                  onChange={(e) => setSlotEnabled(slot.id, e.target.checked)}
                  aria-label={`Enable ${slot.providerId}:${slot.slug}`}
                  className="h-4 w-4 accent-accent"
                />
              </label>
              <span className="min-w-0 flex-1">
                <CompactModelLabel providerId={slot.providerId} slug={slot.slug} />
              </span>
              <ModelProbeControl
                providerId={slot.providerId}
                model={slot.slug}
                slotLabel={`${slot.providerId}:${slot.slug}`}
                disabled={!slot.enabled}
              />
              <button
                type="button"
                aria-label={`Remove model ${slot.providerId}:${slot.slug}`}
                onClick={() => removeSlot(slot.id)}
                className="flex h-11 w-11 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <SuiteModelAdder models={models} takenKeys={takenKeys} onAdd={addSlot} />
        {enabledSlots.length > 0 && (
          <button
            type="button"
            onClick={() => {
              // Build entries: enabled candidates + Judge (de-duplicated).
              const entries = enabledSlots.map((s) => ({ providerId: s.providerId, model: s.slug }));
              const judgeKey = `${suite.defaultJudge.providerId}:${suite.defaultJudge.model}`;
              const candidateKeys = new Set(entries.map((e) => `${e.providerId}:${e.model}`));
              if (!candidateKeys.has(judgeKey)) {
                entries.push({ providerId: suite.defaultJudge.providerId, model: suite.defaultJudge.model });
              }
              void testBatch(entries, 3);
            }}
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-card px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Test selected models
          </button>
        )}
        {enabledSlots.length > 0 && (
          <p className="text-xs text-text-muted">
            Live model tests send a small generation request and may incur provider cost.
          </p>
        )}
      </div>

      {/* Default Judge */}
      <div className="space-y-2">
        <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Default Judge
        </span>
        <JudgeSelector
          current={suite.defaultJudge}
          models={models}
          onCommit={setDefaultJudge}
        />
        <ModelProbeControl
          providerId={suite.defaultJudge.providerId}
          model={suite.defaultJudge.model}
          slotLabel={`Judge · ${suite.defaultJudge.providerId}:${suite.defaultJudge.model}`}
        />
      </div>
      {/* Default evaluation */}
      <div className="space-y-2">
        <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Default evaluation
        </span>
        <DefaultEvaluationPicker
          selection={suite.defaultEvaluation}
          profileRecords={profileRecords}
          resolveProfileLabel={resolveProfileLabel}
          onChange={setDefaultEvaluation}
        />
      </div>

      <section aria-label="Suite reasoning policy" className="space-y-3 rounded-md border border-edge bg-card p-2.5">
        <div>
          <h3 className="font-mono text-xs uppercase tracking-wide text-text-secondary">Reasoning policy</h3>
          <p className="mt-1 text-xs text-text-secondary">
            Named effort is a controlled request, not proof that model families spend equal compute.
          </p>
        </div>
        <ReasoningEffortPicker
          label="Candidate effort"
          value={reasoningPolicy.candidates}
          options={candidateEfforts}
          onChange={(candidates) => onChange({ reasoningPolicy: { ...reasoningPolicy, candidates } })}
          description="Only common strict levels for enabled candidates are offered."
        />
        <ReasoningEffortPicker
          label="Judge effort"
          value={reasoningPolicy.judge}
          options={judgeEfforts}
          onChange={(judge) => onChange({ reasoningPolicy: { ...reasoningPolicy, judge } })}
          description="Provider default leaves the model's native effort unchanged."
        />
      </section>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SuiteModelAdder — provider-scoped model adder reusing Compare's combobox
// pattern (ProviderTabs + catalog search + raw-slug entry).
// -----------------------------------------------------------------------------

function SuiteModelAdder({
  models,
  takenKeys,
  onAdd,
}: {
  models: CatalogModel[];
  takenKeys: Set<string>;
  onAdd: (slot: ModelSlot) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[44px] w-full items-center gap-1.5 rounded-sm border border-dashed border-edge px-3 font-mono text-xs text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Plus size={13} aria-hidden="true" /> Add model
      </button>
    );
  }
  return (
    <AddModelCombobox
      models={models}
      takenKeys={takenKeys}
      onCancel={() => setOpen(false)}
      onAdd={(slot) => {
        onAdd(slot);
        setOpen(false);
      }}
    />
  );
}

/**
 * Provider-scoped model combobox adapted from Compare's AddModelCombobox.
 * Catalog autocomplete + manual raw-slug entry. Duplicate keys are rejected.
 */
function AddModelCombobox({
  models,
  takenKeys,
  onCancel,
  onAdd,
}: {
  models: CatalogModel[];
  takenKeys: Set<string>;
  onCancel: () => void;
  onAdd: (slot: ModelSlot) => void;
}) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("openrouter");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const providerModels = useMemo(
    () => models.filter((m) => m.providerId === selectedProvider),
    [models, selectedProvider],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = providerModels.length > 0 ? providerModels : [];
    if (q.length === 0) return pool;
    return pool.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  }, [query, providerModels]);

  const hasCatalog = providerModels.length > 0;
  const trimmed = query.trim();
  const candidateKey = modelKey(selectedProvider, trimmed);
  const manualSlugValid =
    trimmed.length > 0 &&
    (selectedProvider === "openrouter" || selectedProvider === "commandcode" || selectedProvider === "clinepass"
      ? trimmed.includes("/")
      : true) &&
    !takenKeys.has(candidateKey);

  function commit(slug: string, name?: string) {
    const providerLabel = PROVIDER_LABELS[selectedProvider] ?? "OpenRouter";
    const model = name ?? (slug.includes("/") ? slug.split("/").slice(1).join("/") : slug);
    onAdd({
      id: `slot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      providerId: selectedProvider,
      provider: providerLabel,
      model,
      slug,
      enabled: true,
    });
  }

  const handleProviderChange = (p: ProviderId) => {
    setSelectedProvider(p);
    setQuery("");
    inputRef.current?.focus();
  };

  const handleClearOrCancel = () => {
    if (query.length > 0) {
      setQuery("");
      inputRef.current?.focus();
    } else {
      onCancel();
    }
  };

  return (
    <div className="mt-2 rounded-md border border-edge-bright bg-card p-2">
      <ProviderTabs
        value={selectedProvider}
        onChange={handleProviderChange}
        ariaLabel="Candidate model providers"
      />
      <label htmlFor="suite-model-search" className="sr-only">
        Search models
      </label>
      <div className="flex items-center gap-1 rounded-sm border border-edge bg-panel px-2 py-1 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
        <Search size={13} className="shrink-0 text-text-muted" />
        <input
          id="suite-model-search"
          ref={inputRef}
          role="searchbox"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (manualSlugValid) commit(trimmed);
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
          placeholder={hasCatalog ? "Search catalog or type a slug (provider/model)…" : "Type a slug (provider/model)…"}
          aria-label="Search the model catalog or enter a slug"
          className="min-h-[44px] flex-1 bg-transparent font-mono text-sm text-text placeholder-text-muted focus:outline-none"
        />
        <button
          type="button"
          onClick={handleClearOrCancel}
          aria-label={query.length > 0 ? "Clear model search" : "Cancel add model"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-text"
        >
          <X size={13} />
        </button>
      </div>

      {hasCatalog && matches.length > 0 && (
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-sm border border-edge scroll-thin">
          {matches.map((m) => {
            const taken = takenKeys.has(modelKey(m.providerId, m.id));
            return (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={taken}
                  onClick={() => commit(m.id, m.name)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-2 px-2 py-2 text-left font-mono text-sm text-text-secondary hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="min-w-0 truncate">
                    {m.name}
                    <span className="ml-2 text-text-muted">{m.id}</span>
                  </span>
                  {taken && <span className="shrink-0 text-text-muted">added</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hasCatalog && matches.length === 0 && query.trim().length > 0 && (
        <p className="px-1 py-2 font-mono text-sm text-text-muted">No catalog match — add as raw slug below.</p>
      )}

      {manualSlugValid ? (
        <button
          type="button"
          onClick={() => commit(trimmed)}
          aria-label={`Add slug ${trimmed}`}
          className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm border border-accent/40 bg-accent/[0.06] py-2 font-mono text-sm text-accent hover:bg-accent/[0.12]"
        >
          <Plus size={13} /> add slug
          <span className="max-w-[55%] truncate" title={trimmed}>
            {trimmed}
          </span>
        </button>
      ) : (
        query.trim().length > 0 && (
          <p className="mt-2 px-1 font-mono text-sm text-text-muted">
            Enter a slug as <span className="text-text-secondary">provider/model</span>
            {takenKeys.has(candidateKey) && " · already added"}
          </p>
        )
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// JudgeSelector — single-slug provider-scoped judge picker (Compare's pattern).
// -----------------------------------------------------------------------------

function JudgeSelector({
  current,
  models,
  onCommit,
}: {
  current: { providerId: ProviderId; model: string };
  models: CatalogModel[];
  onCommit: (providerId: ProviderId, model: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(current.providerId);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const providerModels = useMemo(
    () => models.filter((m) => m.providerId === selectedProvider),
    [models, selectedProvider],
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = providerModels.length > 0 ? providerModels : [];
    if (q.length === 0) return pool;
    return pool.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  }, [query, providerModels]);

  const hasCatalog = providerModels.length > 0;
  const trimmed = query.trim();
  const isCurrent = selectedProvider === current.providerId && trimmed === current.model;
  const slugValid =
    trimmed.length > 0 &&
    (selectedProvider === "openrouter" || selectedProvider === "commandcode" || selectedProvider === "clinepass"
      ? trimmed.includes("/")
      : true) &&
    !isCurrent;

  if (!editing) {
    const label = current.model.trim()
      ? `${PROVIDER_LABELS[current.providerId] ?? current.providerId} · ${current.model}`
      : "No judge set";
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true);
          setSelectedProvider(current.providerId);
        }}
        aria-label={`Change default judge, current: ${current.model || "none"}`}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-sm border border-edge bg-card px-2.5 py-1.5 text-left hover:border-edge-bright hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span dir="rtl" className="min-w-0 flex-1 truncate font-mono text-sm text-text" title={current.model}>
          {`‎${label}`}
        </span>
        <ChevronDown size={14} className="shrink-0 text-text-muted" aria-hidden="true" />
      </button>
    );
  }

  const handleProviderChange = (p: ProviderId) => {
    setSelectedProvider(p);
    setQuery("");
    inputRef.current?.focus();
  };
  const handleClearOrCancel = () => {
    if (query.length > 0) {
      setQuery("");
      inputRef.current?.focus();
    } else {
      setEditing(false);
    }
  };

  return (
    <div className="rounded-md border border-edge-bright bg-card p-2">
      <ProviderTabs
        value={selectedProvider}
        onChange={handleProviderChange}
        ariaLabel="Judge model providers"
      />
      <label htmlFor="suite-judge-search" className="sr-only">
        Judge model
      </label>
      <div className="flex items-center gap-1 rounded-sm border border-edge bg-panel px-2 py-1 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
        <Search size={13} className="shrink-0 text-text-muted" />
        <input
          id="suite-judge-search"
          ref={inputRef}
          role="searchbox"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (slugValid) {
                onCommit(selectedProvider, trimmed);
                setEditing(false);
              }
            } else if (e.key === "Escape") {
              setEditing(false);
            }
          }}
          placeholder="Search catalog or type a slug (provider/model)…"
          aria-label="Search the model catalog or enter a judge slug"
          className="min-h-[44px] flex-1 bg-transparent font-mono text-sm text-text placeholder-text-muted focus:outline-none"
        />
        <button
          type="button"
          onClick={handleClearOrCancel}
          aria-label={query.length > 0 ? "Clear judge search" : "Cancel judge edit"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-text"
        >
          <X size={13} />
        </button>
      </div>

      {hasCatalog && matches.length > 0 && (
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-sm border border-edge scroll-thin">
          {matches.map((m) => {
            const selected = m.providerId === current.providerId && m.id === current.model;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    onCommit(m.providerId, m.id);
                    setEditing(false);
                  }}
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

      {slugValid ? (
        <button
          type="button"
          onClick={() => {
            onCommit(selectedProvider, trimmed);
            setEditing(false);
          }}
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

// -----------------------------------------------------------------------------
// DefaultEvaluationPicker — holistic or pinned-profile version.
// -----------------------------------------------------------------------------

function DefaultEvaluationPicker({
  selection,
  profileRecords,
  resolveProfileLabel,
  onChange,
}: {
  selection: EvaluationSelection;
  profileRecords: ProfileRecord[];
  resolveProfileLabel: (ref: EvaluationProfileRef) => string;
  onChange: (sel: EvaluationSelection) => void;
}) {
  const isHolistic = selection.kind === "holistic";
  const pinned = selection.kind === "profile" ? selection.profile : null;

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <button
          type="button"
          aria-pressed={isHolistic}
          onClick={() => onChange({ kind: "holistic" })}
          className={`min-h-[44px] flex-1 rounded-sm px-2 font-mono text-xs uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            isHolistic
              ? "bg-accent/15 font-semibold text-accent"
              : "text-text-secondary hover:text-text"
          }`}
        >
          Holistic
        </button>
        <button
          type="button"
          aria-pressed={!isHolistic}
          onClick={() => {
            // Pin the first available profile if none pinned yet.
            const first = profileRecords[0];
            if (first) {
              onChange({ kind: "profile", profile: { id: first.id, version: first.latestVersion } });
            } else {
              onChange({ kind: "profile", profile: { id: "", version: 0 } });
            }
          }}
          className={`min-h-[44px] flex-1 rounded-sm px-2 font-mono text-xs uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            !isHolistic
              ? "bg-accent/15 font-semibold text-accent"
              : "text-text-secondary hover:text-text"
          }`}
        >
          Pinned profile
        </button>
      </div>

      {!isHolistic && (
        <div>
          {profileRecords.length === 0 ? (
            <p className="text-xs text-text-muted">
              No profiles available. Create a profile under the Profiles tab first.
            </p>
          ) : (
            <label className="block">
              <span className="sr-only">Pinned profile version</span>
              <select
                value={pinned ? `${pinned.id}:${pinned.version}` : ""}
                onChange={(e) => {
                  const [id, ver] = e.target.value.split(":");
                  onChange({ kind: "profile", profile: { id, version: Number(ver) } });
                }}
                aria-label="Pinned profile version"
                className="min-h-[44px] w-full rounded-sm border border-edge bg-card px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                  {profileRecords.map((r) => (
                    <option key={`${r.id}:${r.latestVersion}`} value={`${r.id}:${r.latestVersion}`}>
                      {resolveProfileLabel({ id: r.id, version: r.latestVersion })}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
