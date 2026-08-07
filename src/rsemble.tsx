// =============================================================================
// RSemble AI — root component (Split Workspace shell, Variation B)
//
// Owns the shell layout (header + two-pane workspace) and wires extracted
// modules: run-controller (pipeline), provider-probes (readiness/catalog),
// stream-buffer (batched deltas), history-cache (memoized telemetry),
// useActionShortcuts (keyboard), export-markdown (file download).
// UI components live in ./ui; state + reducer in ./studio-engine.
// =============================================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Play, RotateCcw, Square } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { type Mode } from "./studio-data";
import { isProviderReadySync, listProviders } from "./lib/providers/registry";
import type { CatalogModel, ProviderId } from "./lib/providers/types";
import { Header, type ConnectionState } from "./ui/Header";

import { type Action, type StudioState, initialState, reducer } from "./studio-engine";

import { useResizableSplit } from "./ui/useResizableSplit";
import { ModeToggle } from "./ui/ModeToggle";
import { ModelList } from "./ui/ModelList";
import { EvaluationDisclosure } from "./ui/EvaluationDisclosure";
import { TaskInput } from "./ui/TaskInput";
import { AttachmentChips } from "./ui/AttachmentChips";
import { AttachmentCapabilityStrip } from "./ui/AttachmentCapabilityStrip";
import { useAttachments } from "./ui/useAttachments";
import { RunButton } from "./ui/RunButton";
import { JudgeConfig } from "./ui/JudgeConfig";
import { OutputPane } from "./ui/OutputPane";
import { ConnectionsModal } from "./ui/ConnectionsModal";
import { CommandPalette } from "./ui/CommandPalette";
import { ShortcutCheatsheet } from "./ui/ShortcutCheatsheet";
import { BrandAvatar } from "./ui/brand-icons";
import { ModelProbeProvider } from "./ui/ModelProbeContext";
import { AppRoutes } from "./app-router";
import { MobileWorkspaceNav } from "./ui/MobileWorkspaceNav";
import { StreamDeltaBuffer } from "./lib/stream-buffer";
import { createRunController } from "./lib/run-controller";
import { checkAttachmentEligibility } from "./lib/pipeline";
import { evaluateComparePreflight } from "./lib/compare-preflight";
import { createProviderProbeCoordinator } from "./lib/provider-probes";
import { buildExportMarkdown, downloadMarkdown } from "./lib/export-markdown";
import { saveCommandPreferences } from "./lib/preferences";
import { useActionShortcuts, type WorkspaceKind } from "./ui/useActionShortcuts";
import { useRunRepository } from "./lib/persistence/repository-context";
import { createRunRecorder } from "./lib/persistence/run-recorder";
import { useExecutionOwner } from "./lib/execution-owner-context";
import {
  useExecutionLease,
  useExperimentController,
} from "./lib/evaluations/experiment-controller-hooks";
import { GlobalExecutionStripContainer } from "./ui/GlobalExecutionStrip";

export default function RSemble() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { registry: ownerRegistry, owner: activeOwner } = useExecutionOwner();
  const crossTabLease = useExecutionLease();
  const location = useLocation();
  const navigate = useNavigate();
  const experimentController = useExperimentController();
  const isCompareRoute = location.pathname === "/compare" || location.pathname === "/";
  // Workspace derivation (plan 8.2): gates the command palette and the
  // Compare-only keyboard shortcuts (spec §15.12).
  const workspace: WorkspaceKind = location.pathname.startsWith("/runs")
    ? "runs"
    : location.pathname.startsWith("/evaluations")
      ? "evaluations"
      : location.pathname.startsWith("/experiments")
        ? "experiments"
        : "compare";
  // Keep a live ref so the shortcut listener reads the current workspace per
  // keystroke without re-registering on every navigation.
  const workspaceRef = useRef<WorkspaceKind>(workspace);
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);
  const activeExperimentId = activeOwner?.kind === "experiment" ? activeOwner.id : null;

  // Mobile command drawer (<768px). On md+ the command pane is inline, so this
  // stays closed. Per DESIGN.md: output is primary full-screen on mobile, command
  // opens as a drawer/sheet from the header.
  const [commandOpen, setCommandOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const commandDialogHandle = useMemo(() => Dialog.createHandle(), []);
  const connectionsDialogHandle = useMemo(() => Dialog.createHandle(), []);
  const cheatsheetDialogHandle = useMemo(() => Dialog.createHandle(), []);

  const {
    commandWidth,
    dragging,
    onDividerPointerDown,
    onDividerKeyDown,
    onDoubleClick,
    containerRef,
    min,
    max,
  } = useResizableSplit();
  const [focusMode, setFocusMode] = useState(false);

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

  // Persist model roster + judge so a reload keeps the user's selection.
  useEffect(() => {
    saveCommandPreferences({ slots: state.slots, critic: state.critic });
  }, [state.slots, state.critic]);
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
  // Persistence: create a RunRecorder when the repository is available. When
  // storage is unavailable, the controller keeps evidence in memory only — it
  // never falls back to the legacy localStorage addRun path (spec §7.7).
  // ---------------------------------------------------------------------------
  const runRepo = useRunRepository();
  const comparePreflightRef = useRef<
    ((current: StudioState) => ReturnType<typeof evaluateComparePreflight>) | null
  >(null);
  const recorder = useMemo(
    () => (runRepo ? createRunRecorder(runRepo, undefined, { enforceLease: true }) : null),
    [runRepo],
  );
  const runController = useMemo(
    () =>
      createRunController({
        stateRef,
        dispatch,
        runEpochRef,
        abortControllersRef,
        streamBuffer,
        recorder: recorder ?? undefined,
        preflight: (current) =>
          comparePreflightRef.current?.(current) ?? {
            ok: false,
            code: "active-execution",
            message: "Compare preflight is not ready.",
          },
        lease: crossTabLease,
      }),
    [dispatch, streamBuffer, recorder, crossTabLease],
  );
  const { runFanout, abortRun, retryCandidate, retryJudge, triggerFusion } = runController;

  // ---------------------------------------------------------------------------
  // Readiness + catalog probes — parallel, bounded, with diagnosable failures.
  // ---------------------------------------------------------------------------
  const [readinessMap, setReadinessMap] = useState<Record<ProviderId, boolean>>(
    () =>
      Object.fromEntries(
        listProviders().map((provider) => [provider.id, isProviderReadySync(provider.id)]),
      ) as Record<ProviderId, boolean>,
  );
  const [readinessReasons, setReadinessReasons] = useState<Partial<Record<ProviderId, string>>>({});
  // False until the first probe cycle has settled. While checking, the header
  // shows a neutral "Checking" pill and no offline banner — an unprobed
  // provider is unknown, not disconnected.
  const [readinessSettled, setReadinessSettled] = useState(false);

  const [catalogError, setCatalogError] = useState<string | null>(null);
  const probeCoordinator = useMemo(() => createProviderProbeCoordinator(), []);

  const checkAllReadiness = useCallback(async () => {
    const cycle = await probeCoordinator.run();
    // Lifecycle cancellation (run/experiment start) must not mutate health,
    // catalog, or error banner — even when some providers already finished.
    if (cycle.status === "cancelled") return;
    const results = cycle.results;
    setReadinessSettled(true);
    const map: Record<string, boolean> = {};
    const reasons: Partial<Record<ProviderId, string>> = {};
    const mergedCatalog: CatalogModel[] = [];
    // Only banner errors for providers the user is actually using. An idle
    // catalog timeout must not interrupt a suite on other providers.
    const inUse = new Set<ProviderId>([
      ...stateRef.current.slots.filter((s) => s.enabled).map((s) => s.providerId),
      stateRef.current.critic.providerId,
    ]);
    let firstError: string | null = null;
    for (const r of results) {
      map[r.id] = r.readiness.ok;
      if (!r.readiness.ok) reasons[r.id] = r.readiness.reason;
      if (r.catalog.length > 0) mergedCatalog.push(...r.catalog);
      if (r.error && !firstError && inUse.has(r.id)) {
        firstError = `${r.id}: ${r.error}`;
      }
    }
    setReadinessMap(map as Record<ProviderId, boolean>);
    setReadinessReasons(reasons);
    if (mergedCatalog.length > 0) {
      dispatch({ type: "SET_MODELS", models: mergedCatalog });
    }
    setCatalogError(firstError);
  }, [probeCoordinator]);

  const experimentActive = activeOwner?.kind === "experiment";

  // Providers currently ready, in the registry's stable order (roster spec
  // F1). Drives the add-model picker on terminal experiment results; catalog
  // population is a separate concern handled by state.models.
  const availableProviderIds = useMemo<ProviderId[]>(
    () =>
      listProviders()
        .filter((p) => readinessMap[p.id] === true)
        .map((p) => p.id),
    [readinessMap],
  );

  useEffect(() => {
    // Suite / compare runs already saturate the bridge and upstreams. Pause the
    // 10s catalog poller for the duration so probe timeouts don't paint a red
    // banner over an otherwise healthy run.
    if (state.running || experimentActive) {
      setCatalogError(null);
      probeCoordinator.abort();
      return;
    }
    void checkAllReadiness();
    const interval = setInterval(() => void checkAllReadiness(), 10000);
    // Cleanup only clears the interval: aborting the shared coordinator here
    // would kill an in-flight cycle on unrelated re-renders (slot hydration,
    // StrictMode remount) and paint its AbortError as a false offline state.
    return () => clearInterval(interval);
  }, [checkAllReadiness, probeCoordinator, state.running, experimentActive]);

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

  const apiKeyPresent = listProviders().some((provider) => readinessMap[provider.id] === true);
  const connectionState: ConnectionState = state.running
    ? "running"
    : apiKeyPresent
      ? "ready"
      : readinessSettled
        ? "offline"
        : "checking";

  // ---------------------------------------------------------------------------
  // Run gate + requestRun
  // ---------------------------------------------------------------------------
  const attachmentEligibility = checkAttachmentEligibility(state.slots, state.attachments);
  const preflight = evaluateComparePreflight({
    running: state.running,
    experimentActive,
    prompt: state.prompt,
    slots: state.slots,
    readinessMap,
    readinessReasons,
    critic: state.critic,
    attachments: state.attachments,
    attachmentEligibility,
  });
  const canRun = preflight.ok;
  const attachmentBlockReason = preflight.ok ? null : preflight.message;
  // The controller is created once, but this ref is refreshed every render so
  // keyboard, mobile, palette, and race paths all consult the same snapshot.
  comparePreflightRef.current = (current) =>
    evaluateComparePreflight({
      running: current.running,
      experimentActive,
      prompt: current.prompt,
      slots: current.slots,
      readinessMap,
      readinessReasons,
      critic: current.critic,
      attachments: current.attachments,
      attachmentEligibility: checkAttachmentEligibility(current.slots, current.attachments),
    });

  const canRunRef = useRef(canRun);
  useEffect(() => {
    canRunRef.current = canRun;
  }, [canRun]);

  const compareRunIdRef = useRef<string | null>(null);
  const requestRun = useCallback(() => {
    if (!canRunRef.current) return;
    const runId = `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (!ownerRegistry.tryAcquire({ kind: "compare", id: runId })) return;
    compareRunIdRef.current = runId;
    void runFanout().finally(() => {
      // A controller-side race/preflight rejection never transitions running
      // true, so release the local owner explicitly rather than leaving the
      // Compare shell permanently locked.
      if (!stateRef.current.running && compareRunIdRef.current === runId) {
        ownerRegistry.release(runId);
        compareRunIdRef.current = null;
      }
    });
  }, [runFanout, ownerRegistry]);

  // Release Compare ownership when the run finishes (running → false).
  useEffect(() => {
    if (!state.running && compareRunIdRef.current) {
      ownerRegistry.release(compareRunIdRef.current);
      compareRunIdRef.current = null;
    }
  }, [state.running, ownerRegistry]);

  // ---------------------------------------------------------------------------
  // Mode change + fusion trigger
  // ---------------------------------------------------------------------------
  const handleModeChange = useCallback(
    (mode: Mode) => {
      if (stateRef.current.running) return;
      dispatch({ type: "SET_MODE", mode });
      const current = stateRef.current;
      if (mode === "fuse" && current.judgeStatus === "done" && current.judgeReport !== null) {
        triggerFusion();
      }
    },
    [triggerFusion],
  );

  // The Rank→Fuse button in RankResult must switch to Fuse mode so the Output
  // pane renders the fused result, then trigger fusion. This mirrors the header
  // toggle and the palette "Toggle mode" command — all share handleModeChange.
  const handleFuseFromRank = useCallback(() => {
    handleModeChange("fuse");
  }, [handleModeChange]);

  // ---------------------------------------------------------------------------
  // Action shortcuts (extracted)
  // ---------------------------------------------------------------------------
  useActionShortcuts({
    stateRef,
    workspaceRef,
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
      document
        .querySelector<HTMLElement>('[aria-label="Command"]')
        ?.scrollIntoView({ block: "nearest" });
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

  const toggleFocusMode = useCallback(() => {
    window.dispatchEvent(new CustomEvent("rsemble:toggle-focus-mode"));
  }, []);

  return (
    <ModelProbeProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-canvas p-2 text-text antialiased">
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-edge bg-shell">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Header
              running={state.running}
              onOpenCommand={isCompareRoute ? () => setCommandOpen(true) : undefined}
              onOpenConnections={() => setConnectionsOpen(true)}
              onOpenPalette={() => setPaletteOpen(true)}
              onOpenHelp={() => setCheatsheetOpen(true)}
              commandDialogHandle={commandDialogHandle}
              connectionsDialogHandle={connectionsDialogHandle}
              cheatsheetDialogHandle={cheatsheetDialogHandle}
              connectionState={connectionState}
            />

            {/* Global execution awareness strip (spec §5.5) — visible on every
              workspace except the exact owning progress route; never hides a
              storage failure. */}
            <GlobalExecutionStripContainer compareRunning={state.running} />

            {connectionState === "offline" && <NoKeyBanner />}
            {catalogError && (
              <div className="flex shrink-0 items-center gap-2 border-b border-error/40 bg-error/10 px-4 py-2 text-xs text-error">
                <span>
                  <span className="font-semibold">Catalog probe issue:</span> {catalogError}
                </span>
              </div>
            )}

            {/* Workspace content — routed. Compare content is passed as the
              compareOutlet so the reducer/controller/state stays mounted above
              the router and persists across navigation. */}
            <div className="flex min-h-0 flex-1 flex-col pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
              <AppRoutes
                compareOutlet={
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div
                      data-compare-toolbar=""
                      className="flex min-h-[52px] shrink-0 items-center justify-between border-b border-edge bg-panel px-3 py-1.5 sm:px-4"
                    >
                      <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                        Finish
                      </span>
                      <ModeToggle
                        mode={state.mode}
                        onChange={handleModeChange}
                        disabled={state.running}
                      />
                    </div>
                    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col lg:flex-row">
                      <section
                        aria-label="Command"
                        className={`hidden min-h-0 overflow-y-auto border-b border-edge bg-panel scroll-thin lg:border-b-0 lg:border-r md:block ${
                          focusActive
                            ? "lg:!w-14 lg:!overflow-hidden lg:!border-r"
                            : "lg:w-[var(--cmd-w)]"
                        } md:w-full`}
                        style={
                          focusActive ? undefined : { ["--cmd-w" as string]: `${commandWidth}px` }
                        }
                      >
                        {focusActive ? (
                          <FocusStrip
                            state={state}
                            canRun={canRun}
                            onRun={requestRun}
                            onAbort={abortRun}
                            blockReason={attachmentBlockReason}
                          />
                        ) : (
                          <CommandPane
                            state={state}
                            dispatch={dispatch}
                            canRun={canRun}
                            onRun={requestRun}
                            onAbort={abortRun}
                            blockReason={attachmentBlockReason}
                          />
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

                      <section
                        aria-label="Output"
                        className="min-h-0 flex-1 overflow-y-auto bg-panel scroll-thin"
                      >
                        <OutputPane
                          state={state}
                          onFuse={handleFuseFromRank}
                          onRefuse={() => triggerFusion(true)}
                          onRetryCandidate={retryCandidate}
                          onRetryJudge={retryJudge}
                        />
                      </section>
                    </div>
                  </div>
                }
                models={state.models}
                availableProviderIds={availableProviderIds}
              />
            </div>
          </div>
        </div>

        {/* Mobile bottom navigation — fixed, three workspaces. */}
        <MobileWorkspaceNav />

        {isCompareRoute && (
          <Dialog.Root
            handle={commandDialogHandle}
            open={commandOpen}
            onOpenChange={setCommandOpen}
          >
            <Dialog.Portal>
              <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/60 md:hidden" />
              <Dialog.Viewport className="fixed inset-0 z-50 flex md:hidden">
                <Dialog.Popup className="motion-state flex h-full w-[85%] max-w-sm origin-left flex-col border-r border-edge bg-panel shadow-2xl">
                  <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
                    <Dialog.Title className="font-mono text-xs uppercase tracking-wider text-text-muted">
                      Command
                    </Dialog.Title>
                    <Dialog.Close
                      aria-label="Close command pane"
                      className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-card hover:text-text"
                    >
                      <CloseIcon />
                    </Dialog.Close>
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
                </Dialog.Popup>
              </Dialog.Viewport>
            </Dialog.Portal>
          </Dialog.Root>
        )}
        <ConnectionsModal
          isOpen={connectionsOpen}
          onOpenChange={setConnectionsOpen}
          onRefresh={checkAllReadiness}
          handle={connectionsDialogHandle}
        />
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onRun={requestRun}
          onAbort={abortRun}
          onToggleMode={toggleMode}
          onAddModel={addModel}
          onOpenConnections={() => setConnectionsOpen(true)}
          onToggleFocusMode={toggleFocusMode}
          onExport={exportResult}
          running={state.running}
          canRun={canRun}
          workspace={workspace}
          onNavigate={(path) => navigate(path)}
          activeExperimentId={activeExperimentId}
          onViewExperiment={() =>
            activeExperimentId && navigate(`/experiments/${activeExperimentId}`)
          }
          onAbortExperiment={() => {
            void experimentController?.abort();
          }}
        />
        <ShortcutCheatsheet
          open={cheatsheetOpen}
          onOpenChange={setCheatsheetOpen}
          handle={cheatsheetDialogHandle}
        />
      </div>
    </ModelProbeProvider>
  );
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
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
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- role="separator" with aria-valuenow is a focusable ARIA widget; pointer/keyboard resizing is its purpose
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
  blockReason,
}: {
  state: StudioState;
  canRun: boolean;
  onRun: () => void;
  onAbort: () => void;
  /** Attachment gate reason surfaced as the button tooltip (plan 7.6.8). */
  blockReason?: string | null;
}) {
  const enabledSlots = state.slots.filter((s) => s.enabled);
  return (
    <div className="flex h-full w-14 flex-col items-center gap-3 py-4">
      <div className="flex flex-col items-center gap-2">
        {enabledSlots.map((slot) => (
          <BrandAvatar key={slot.id} slug={slot.slug} size={28} className="rounded-md" />
        ))}
        {enabledSlots.length === 0 && (
          <span className="font-mono text-[11px] text-text-muted">—</span>
        )}
      </div>
      <button
        type="button"
        onClick={state.running ? onAbort : onRun}
        disabled={!canRun && !state.running}
        aria-label={state.running ? "Stop run" : "Re-run pipeline"}
        title={state.running ? "Stop run" : (blockReason ?? "Re-run pipeline")}
        className={`pressable mt-auto flex h-11 w-11 items-center justify-center rounded-md ${
          state.running
            ? "bg-error/20 text-error"
            : canRun
              ? "bg-accent text-on-accent hover-lift"
              : "border border-edge bg-card text-text-secondary opacity-60 cursor-not-allowed"
        }`}
      >
        {state.running ? <Square size={16} /> : <Play size={16} />}
      </button>
    </div>
  );
}

// =============================================================================
// components: TaskInput · ModelList · JudgeConfig · EvaluationDisclosure · RunButton.
// =============================================================================

function CommandPane({
  state,
  dispatch,
  canRun,
  onRun,
  onAbort,
  blockReason,
}: {
  state: StudioState;
  dispatch: React.Dispatch<Action>;
  canRun: boolean;
  onRun: () => void;
  onAbort: () => void;
  /** Attachment gate reason for the Run button (plan 7.6.8). */
  blockReason?: string | null;
}) {
  const enabledCount = state.slots.filter((s) => s.enabled).length;
  const hasRun = state.candidates.length > 0 || state.running;
  const attachmentUi = useAttachments(state.attachments, dispatch);
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <PaneLabel
        index="01"
        title="Command"
        hint="Define your task, select models, choose a judge, and set evaluation criteria."
        action={
          <ResetButton
            hasRun={hasRun}
            running={state.running}
            onReset={() => dispatch({ type: "RESET_SESSION" })}
          />
        }
      />

      <TaskInput
        prompt={state.prompt}
        exampleIndex={state.exampleIndex}
        dispatch={dispatch}
        attachments={state.attachments}
        onAddFiles={attachmentUi.addFiles}
      />
      <AttachmentChips
        attachments={state.attachments}
        thumbnails={attachmentUi.thumbnails}
        notice={attachmentUi.notice}
        onRemove={attachmentUi.remove}
        onRetry={attachmentUi.retry}
      />
      <AttachmentCapabilityStrip
        slots={state.slots}
        attachments={state.attachments}
        dispatch={dispatch}
      />
      <ModelList slots={state.slots} models={state.models} dispatch={dispatch} />
      <JudgeConfig
        critic={state.critic}
        models={state.models}
        dispatch={dispatch}
        reasoningPolicy={state.reasoningPolicy}
        slots={state.slots}
        judgeInstruction={state.judgeInstruction}
        attachments={state.attachments}
        attachmentsToJudge={state.attachmentsToJudge}
      />
      <EvaluationDisclosure evaluation={state.evaluation} dispatch={dispatch} />
      <RunButton
        running={state.running}
        canRun={canRun}
        hasPrompt={state.prompt.trim().length > 0}
        enabledCount={enabledCount}
        enabledSlugs={state.slots.filter((s) => s.enabled).map((s) => s.slug)}
        prompt={state.prompt}
        onClick={onRun}
        onAbort={onAbort}
        blockReason={blockReason}
        attachments={state.attachments}
        mode={state.mode}
        judge={state.critic}
        providerIdsBySlug={Object.fromEntries(
          state.slots.filter((s) => s.enabled).map((s) => [s.slug, s.providerId]),
        )}
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
      data-geometry="reset-action"
      type="button"
      disabled={running}
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
      className={`pressable relative flex h-11 min-w-[132px] shrink-0 items-center justify-center rounded-md border ${
        running
          ? "cursor-not-allowed border-edge text-text-secondary opacity-50"
          : armed
            ? "border-warning/60 bg-warning/10 font-mono text-xs text-warning"
            : "border-edge text-text-secondary hover:border-edge-bright hover:text-text"
      }`}
    >
      <span className="absolute inset-0 flex items-center justify-center gap-1.5">
        {armed && <span>Confirm reset</span>}
        <RotateCcw size={15} />
      </span>
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
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
            {title}
          </span>
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
        <span className="font-semibold">No provider connected.</span> Connect any configured
        provider via the connection status button in the header — or set a supported{" "}
        <code className="rounded bg-warning/10 px-1">VITE_*_KEY</code> in{" "}
        <code className="rounded bg-warning/10 px-1">.env</code> and restart the dev server to
        enable live runs.
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
