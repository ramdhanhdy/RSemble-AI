// =============================================================================
// RSemble AI — root component (Split Workspace shell, Variation B)
//
// Owns the shell layout (header + two-pane workspace) and wires extracted
// modules: run-controller (pipeline), provider-probes (readiness/catalog),
// stream-buffer (batched deltas), history-cache (memoized telemetry),
// useActionShortcuts (keyboard), export-markdown (file download).
// UI components live in ./ui; state + reducer in ./studio-engine.
// =============================================================================

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { Play, RotateCcw, Square } from "lucide-react";

import { type Mode } from "./studio-data";
import { isProviderReadySync } from "./lib/providers/registry";
import type { ProviderId } from "./lib/providers/types";
import { Header, type ConnectionState } from "./ui/Header";

import { type Action, type StudioState, initialState, reducer } from "./studio-engine";
import { IconRail } from "./ui/IconRail";
import { useDialogA11y } from "./ui/useDialogA11y";
import { useResizableSplit } from "./ui/useResizableSplit";
import { ModeToggle } from "./ui/ModeToggle";
import { ModelList } from "./ui/ModelList";
import { RubricDisclosure } from "./ui/RubricDisclosure";
import { TaskInput } from "./ui/TaskInput";
import { RunButton } from "./ui/RunButton";
import { JudgeConfig } from "./ui/JudgeConfig";
import { OutputPane } from "./ui/OutputPane";
import { ConnectionsModal } from "./ui/ConnectionsModal";
import { CommandPalette } from "./ui/CommandPalette";
import { ShortcutCheatsheet } from "./ui/ShortcutCheatsheet";
import { BrandAvatar } from "./ui/brand-icons";

import { StreamDeltaBuffer } from "./lib/stream-buffer";
import { createRunController } from "./lib/run-controller";
import { createProviderProbeCoordinator } from "./lib/provider-probes";
import { buildExportMarkdown, downloadMarkdown } from "./lib/export-markdown";
import { useActionShortcuts } from "./ui/useActionShortcuts";

export default function RSemble() {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Mobile command drawer (<768px). On md+ the command pane is inline, so this
  // stays closed. Per DESIGN.md: output is primary full-screen on mobile, command
  // opens as a drawer/sheet from the header.
  const [commandOpen, setCommandOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);

  const { commandWidth, dragging, onDividerPointerDown, onDividerKeyDown, onDoubleClick, containerRef, min, max } = useResizableSplit();
  const [focusMode, setFocusMode] = useState(false);
  const commandDrawerRef = useRef<HTMLElement>(null);
  useDialogA11y(commandOpen, () => setCommandOpen(false), commandDrawerRef);

  // Focus mode only applies to the horizontal lg split. At md (stacked) and
  // mobile (drawer) the command pane is already compact, so collapsing to a
  // 56px strip would be pointless. Track the lg breakpoint reactively.
  const isLg = useMediaQuery("(min-width: 1024px)");
  const focusActive = focusMode && isLg;
  // Keep a live ref to state so async orchestration reads the latest values.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const runEpochRef = useRef(0);
  const abortControllersRef = useRef<Set<AbortController>>(new Set());

  // ---------------------------------------------------------------------------
  // Stream buffer — batch token deltas into one dispatch per animation frame.
  // ---------------------------------------------------------------------------
  const streamBufferRef = useRef<StreamDeltaBuffer | null>(null);
  if (streamBufferRef.current === null) {
    streamBufferRef.current = new StreamDeltaBuffer((id, delta) => {
      dispatch({ type: "CANDIDATE_DELTA", id, delta });
    });
  }
  const streamBuffer = streamBufferRef.current;

  // ---------------------------------------------------------------------------
  // Run controller — extracted pipeline orchestration.
  // ---------------------------------------------------------------------------
  const runController = useMemo(
    () =>
      createRunController({
        stateRef,
        dispatch,
        runEpochRef,
        abortControllersRef,
        streamBuffer,
      }),
    [dispatch, streamBuffer],
  );
  const { runFanout, abortRun, retryCandidate, triggerFusion } = runController;

  // ---------------------------------------------------------------------------
  // Readiness + catalog probes — parallel, bounded, with diagnosable failures.
  // ---------------------------------------------------------------------------
  const [readinessMap, setReadinessMap] = useState<Record<ProviderId, boolean>>({
    openrouter: isProviderReadySync("openrouter"),
    "chatgpt-codex": false,
    gemini: isProviderReadySync("gemini"),
    commandcode: isProviderReadySync("commandcode"),
    clinepass: isProviderReadySync("clinepass"),
    umans: false,
  });

  const [catalogError, setCatalogError] = useState<string | null>(null);
  const probeCoordinator = useMemo(() => createProviderProbeCoordinator(), []);

  const checkAllReadiness = useCallback(async () => {
    const results = await probeCoordinator.run();
    const map: Record<string, boolean> = {};
    const mergedCatalog: import("./lib/providers/types").CatalogModel[] = [];
    let firstError: string | null = null;
    for (const r of results) {
      map[r.id] = r.readiness.ok;
      if (r.catalog.length > 0) mergedCatalog.push(...r.catalog);
      if (r.error && !firstError) firstError = `${r.id}: ${r.error}`;
    }
    setReadinessMap(map as Record<ProviderId, boolean>);
    if (mergedCatalog.length > 0) {
      dispatch({ type: "SET_MODELS", models: mergedCatalog });
    }
    setCatalogError(firstError);
  }, [probeCoordinator]);

  useEffect(() => {
    void checkAllReadiness();
    const interval = setInterval(() => void checkAllReadiness(), 10000);
    return () => {
      clearInterval(interval);
      probeCoordinator.abort();
    };
  }, [checkAllReadiness, probeCoordinator]);

  // ---------------------------------------------------------------------------
  // Global keyboard shortcuts (palette, cheatsheet, focus mode).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        setCheatsheetOpen(false);
        return;
      }
      if (mod && e.key === "\\") {
        e.preventDefault();
        setFocusMode((v) => !v);
        return;
      }
      if (e.key === "?" && !mod) {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        const typing = tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable;
        if (!typing) {
          e.preventDefault();
          setCheatsheetOpen((v) => !v);
          setPaletteOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onToggle = () => setFocusMode((v) => !v);
    window.addEventListener("rsemble:toggle-focus-mode", onToggle);
    return () => window.removeEventListener("rsemble:toggle-focus-mode", onToggle);
  }, []);

  const apiKeyPresent =
    readinessMap.openrouter ||
    readinessMap["chatgpt-codex"] ||
    readinessMap.gemini ||
    readinessMap.commandcode ||
    readinessMap.clinepass ||
    readinessMap.umans;
  const connectionState: ConnectionState =
    state.running ? "running" : !apiKeyPresent ? "offline" : "ready";

  // ---------------------------------------------------------------------------
  // Run gate + requestRun
  // ---------------------------------------------------------------------------
  const enabledSlots = state.slots.filter((s) => s.enabled);
  const slotsReady = enabledSlots.every((s) => readinessMap[s.providerId] === true);
  const criticReady = readinessMap[state.critic.providerId] === true;
  const canRun =
    !state.running && state.prompt.trim().length > 0 && enabledSlots.length > 0 && slotsReady && criticReady;

  const canRunRef = useRef(canRun);
  useEffect(() => {
    canRunRef.current = canRun;
  }, [canRun]);

  const requestRun = useCallback(() => {
    if (!canRunRef.current) return;
    void runFanout();
  }, [runFanout]);

  // ---------------------------------------------------------------------------
  // Mode change + fusion trigger
  // ---------------------------------------------------------------------------
  const handleModeChange = useCallback(
    (mode: Mode) => {
      if (stateRef.current.running) return;
      dispatch({ type: "SET_MODE", mode });
      if (mode === "fuse") triggerFusion();
    },
    [triggerFusion],
  );

  // ---------------------------------------------------------------------------
  // Action shortcuts (extracted)
  // ---------------------------------------------------------------------------
  useActionShortcuts({
    stateRef,
    dispatch,
    requestRun,
    abortRun,
    handleModeChange,
  });

  // ---------------------------------------------------------------------------
  // Export (extracted)
  // ---------------------------------------------------------------------------
  const exportResult = useCallback(() => {
    const text = buildExportMarkdown(stateRef.current);
    if (!text) return;
    downloadMarkdown(text);
  }, []);

  // ---------------------------------------------------------------------------
  // Command palette helpers
  // ---------------------------------------------------------------------------
  const toggleMode = useCallback(() => {
    handleModeChange(state.mode === "rank" ? "fuse" : "rank");
  }, [handleModeChange, state.mode]);

  const focusCommandPane = useCallback(() => {
    setCommandOpen(true);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[aria-label="Command"]')?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  const addModel = useCallback(() => {
    focusCommandPane();
    if (focusMode) {
      setFocusMode(false);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("rsemble:add-model"))),
      );
    } else {
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("rsemble:add-model")));
    }
  }, [focusCommandPane, focusMode]);

  const addCriterion = useCallback(() => {
    focusCommandPane();
    if (focusMode) {
      setFocusMode(false);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("rsemble:add-criterion"))),
      );
    } else {
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("rsemble:add-criterion")));
    }
  }, [focusCommandPane, focusMode]);

  const toggleFocusMode = useCallback(() => {
    window.dispatchEvent(new CustomEvent("rsemble:toggle-focus-mode"));
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-canvas p-2 text-text antialiased">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-edge bg-shell">
        <IconRail activeId="command" focusMode={focusMode} onToggleFocusMode={() => setFocusMode((v) => !v)} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Header
            state={state}
            onOpenCommand={() => setCommandOpen(true)}
            onOpenConnections={() => setConnectionsOpen(true)}
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenHelp={() => setCheatsheetOpen(true)}
            connectionState={connectionState}
          >
            <ModeToggle mode={state.mode} onChange={handleModeChange} disabled={state.running} />
          </Header>

          {!apiKeyPresent && <NoKeyBanner />}
          {catalogError && (
            <div className="flex shrink-0 items-center gap-2 border-b border-error/40 bg-error/10 px-4 py-2 text-xs text-error">
              <span>
                <span className="font-semibold">Catalog probe issue:</span> {catalogError}
              </span>
            </div>
          )}

          <div ref={containerRef} className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <section
              aria-label="Command"
              className={`hidden min-h-0 overflow-y-auto border-b border-edge bg-panel scroll-thin lg:border-b-0 lg:border-r md:block ${
                focusActive ? "lg:!w-14 lg:!overflow-hidden lg:!border-r" : "lg:w-[var(--cmd-w)]"
              } md:w-full`}
              style={focusActive ? undefined : { ["--cmd-w" as string]: `${commandWidth}px` }}
            >
              {focusActive ? (
                <FocusStrip state={state} canRun={canRun} onRun={requestRun} onAbort={abortRun} />
              ) : (
                <CommandPane state={state} dispatch={dispatch} canRun={canRun} onRun={requestRun} onAbort={abortRun} />
              )}
            </section>

            {!focusActive && (
              <Divider
                dragging={dragging}
                value={commandWidth}
                min={min}
                max={max}
                onPointerDown={onDividerPointerDown}
                onKeyDown={onDividerKeyDown}
                onDoubleClick={onDoubleClick}
              />
            )}

            <section aria-label="Output" className="min-h-0 flex-1 overflow-y-auto bg-panel scroll-thin">
              <OutputPane state={state} onFuse={triggerFusion} onRefuse={() => triggerFusion(true)} onRetryCandidate={retryCandidate} />
            </section>
          </div>
        </div>
      </div>

      {commandOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            aria-hidden="true"
            onClick={() => setCommandOpen(false)}
          />
          <aside
            ref={commandDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Command"
            tabIndex={-1}
            className="fixed inset-y-0 left-0 z-50 flex w-[85%] max-w-sm flex-col border-r border-edge bg-panel shadow-2xl focus:outline-none md:hidden"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
              <span className="font-mono text-xs uppercase tracking-wider text-text-muted">Command</span>
              <button
                type="button"
                onClick={() => setCommandOpen(false)}
                aria-label="Close command pane"
                className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-card hover:text-text"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
              <CommandPane
                state={state}
                dispatch={dispatch}
                canRun={canRun}
                onRun={() => {
                  if (!canRun) return;
                  requestRun();
                  setCommandOpen(false);
                }}
                onAbort={abortRun}
              />
            </div>
          </aside>
        </>
      )}
      <ConnectionsModal
        isOpen={connectionsOpen}
        onClose={() => setConnectionsOpen(false)}
        onRefresh={checkAllReadiness}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onRun={requestRun}
        onAbort={abortRun}
        onToggleMode={toggleMode}
        onAddModel={addModel}
        onAddCriterion={addCriterion}
        onOpenConnections={() => setConnectionsOpen(true)}
        onToggleFocusMode={toggleFocusMode}
        onExport={exportResult}
        running={state.running}
        canRun={canRun}
      />
      <ShortcutCheatsheet open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function Divider({
  dragging,
  value,
  min,
  max,
  onPointerDown,
  onKeyDown,
  onDoubleClick,
}: {
  dragging: boolean;
  value: number;
  min: number;
  max: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      role="separator"
      aria-label="Resize command and output panes"
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      data-dragging={dragging ? "true" : undefined}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      className="rsemble-divider hidden lg:block"
    />
  );
}

function FocusStrip({
  state,
  canRun,
  onRun,
  onAbort,
}: {
  state: StudioState;
  canRun: boolean;
  onRun: () => void;
  onAbort: () => void;
}) {
  const enabledSlots = state.slots.filter((s) => s.enabled);
  return (
    <div className="flex h-full w-14 flex-col items-center gap-3 py-4">
      <div className="flex flex-col items-center gap-2">
        {enabledSlots.map((slot) => (
          <BrandAvatar key={slot.id} slug={slot.slug} size={28} className="rounded-md" />
        ))}
        {enabledSlots.length === 0 && <span className="font-mono text-[11px] text-text-muted">—</span>}
      </div>
      <button
        type="button"
        onClick={state.running ? onAbort : onRun}
        disabled={!canRun && !state.running}
        aria-label={state.running ? "Stop run" : "Re-run pipeline"}
        title={state.running ? "Stop run" : "Re-run pipeline"}
        className={`mt-auto flex h-11 w-11 items-center justify-center rounded-md transition-[transform,background-color] ease-out duration-150 ${
          state.running
            ? "bg-error/20 text-error"
            : canRun
              ? "bg-accent text-on-accent hover:-translate-y-0.5"
              : "border border-edge bg-card text-text-secondary opacity-60 cursor-not-allowed"
        }`}
      >
        {state.running ? <Square size={16} /> : <Play size={16} />}
      </button>
    </div>
  );
}

// =============================================================================
// Command pane — full implementation (Phase 2). Composes the four command
// components: TaskInput · ModelList · RubricDisclosure · RunButton.
// =============================================================================

function CommandPane({
  state,
  dispatch,
  canRun,
  onRun,
  onAbort,
}: {
  state: StudioState;
  dispatch: React.Dispatch<Action>;
  canRun: boolean;
  onRun: () => void;
  onAbort: () => void;
}) {
  const enabledCount = state.slots.filter((s) => s.enabled).length;
  const hasRun = state.candidates.length > 0 || state.running;
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <PaneLabel
        index="01"
        title="Command"
        hint="Define your task, select models, set the rubric, and choose a judge."
        action={
          <ResetButton
            hasRun={hasRun}
            running={state.running}
            onReset={() => dispatch({ type: "RESET_SESSION" })}
          />
        }
      />

      <TaskInput prompt={state.prompt} dispatch={dispatch} />
      <ModelList slots={state.slots} models={state.models} dispatch={dispatch} />
      <RubricDisclosure
        rubric={state.rubric}
        dispatch={dispatch}
        critic={state.critic}
        candidates={state.candidates}
        slots={state.slots}
        models={state.models}
      />
      <JudgeConfig critic={state.critic} models={state.models} dispatch={dispatch} />
      <RunButton
        running={state.running}
        canRun={canRun}
        hasPrompt={state.prompt.trim().length > 0}
        enabledCount={enabledCount}
        enabledSlugs={state.slots.filter((s) => s.enabled).map((s) => s.slug)}
        prompt={state.prompt}
        onClick={onRun}
        onAbort={onAbort}
      />
    </div>
  );
}

function ResetButton({
  hasRun,
  running,
  onReset,
}: {
  hasRun: boolean;
  running: boolean;
  onReset: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      aria-disabled={running ? true : undefined}
      onClick={() => {
        if (running) return;
        if (hasRun && !armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onReset();
      }}
      aria-label={armed ? "Confirm reset session" : "Reset session"}
      title={
        running
          ? "Reset is unavailable while a run is in flight"
          : armed
            ? "Click again to discard the current run and reset"
            : "Reset session"
      }
      className={`flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border ${
        armed ? "px-3" : "w-11"
      } ${
        running
          ? "cursor-not-allowed border-edge text-text-secondary opacity-50"
          : armed
            ? "border-warning/60 bg-warning/10 font-mono text-xs text-warning"
            : "border-edge text-text-secondary hover:border-edge-bright hover:text-text"
      }`}
    >
      {armed && <span>Confirm reset</span>}
      <RotateCcw size={15} />
    </button>
  );
}

// ---- small presentational helpers ----

function PaneLabel({
  index,
  title,
  hint,
  action,
}: {
  index: string;
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs font-semibold tabular-nums text-accent">{index}</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">{title}</span>
        </div>
        <p className="mt-1 text-xs text-text-muted">{hint}</p>
      </div>
      {action}
    </div>
  );
}

// =============================================================================
// Helpers / banner
// =============================================================================

function NoKeyBanner() {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning">
      <span>
        <span className="font-semibold">No provider connected.</span> Add an API key for any
        provider (OpenRouter, Gemini, CommandCode, ClinePass, Umans) via the connection status
        button in the header — or set <code className="rounded bg-warning/10 px-1">VITE_*_KEY</code> in{" "}
        <code className="rounded bg-warning/10 px-1">.env</code> and restart the dev server to enable live runs.
      </span>
    </div>
  );
}

// Reactive CSS media query — returns true while the query matches. Used to
// gate focus mode to the lg horizontal split only.
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
