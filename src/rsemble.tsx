// =============================================================================
// RSemble AI — root component (Split Workspace shell, Variation B)
//
// Owns the shell layout (header + two-pane workspace) and wires extracted
// modules: run-controller (pipeline), provider-probes (readiness/catalog),
// stream-buffer (batched deltas), history-cache (memoized telemetry),
// useActionShortcuts (keyboard), export-markdown (file download).
// UI components live in ./ui; state + reducer in ./studio-engine.
// =============================================================================

import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { BookOpen, FileText, RotateCcw } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { type Mode } from "./studio-data";
import { isProviderReadySync, listProviders } from "./lib/providers/registry";
import type { CatalogModel, ProviderId } from "./lib/providers/types";
import { Header, type ConnectionState } from "./ui/Header";
import { RecordsDrawer } from "./ui/RecordsDrawer";

import { type Action, type StudioState, initialState, reducer } from "./studio-engine";

import { useResizableSplit } from "./ui/useResizableSplit";
import { useMediaQuery } from "./ui/useMediaQuery";
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
import { ModelProbeProvider } from "./ui/ModelProbeContext";
import { AppRoutes } from "./app-router";
import { RouteErrorBoundary } from "./ui/RouteErrorBoundary";
import { MobileWorkspaceNav } from "./ui/MobileWorkspaceNav";
import { StreamDeltaBuffer } from "./lib/stream-buffer";
import { createRunController } from "./lib/run-controller";
import { checkAttachmentEligibility } from "./lib/pipeline";
import { evaluateComparePreflight } from "./lib/compare-preflight";
import { createProviderProbeCoordinator } from "./lib/provider-probes";
import { buildExportMarkdown, downloadMarkdown } from "./lib/export-markdown";
import { saveCommandPreferences } from "./lib/preferences";
import type { RunConfigPreload } from "./lib/runs/run-config-preload";
import { deriveWorkspace, useActionShortcuts, type WorkspaceKind } from "./ui/useActionShortcuts";
import {
  RepositoryContext,
  useRunRepository,
  useTaskRepository,
  useStudyRepository,
  useLabAssetRepository,
  useTaskSetRepository,
} from "./lib/persistence/repository-context";
import { createComparisonRepository } from "./lib/persistence/comparison-repository";
import { createRunRecorder } from "./lib/persistence/run-recorder";
import { useExecutionOwner } from "./lib/execution-owner-context";
import {
  useExecutionLease,
  useExperimentController,
} from "./lib/evaluations/experiment-controller-hooks";
import { GlobalExecutionStripContainer } from "./ui/GlobalExecutionStrip";
import { CloseIcon, SplitDivider, FocusStrip, PaneLabel, NoKeyBanner } from "./ui/CompareShell";
import { RunWithPlaybookDialog } from "./workspaces/compare/RunWithPlaybookDialog";

// Compare → View record gate (Slice 5). The link is shown only when a
// recorder-backed persisted record exists for the last run (never for
// in-memory-only runs) and no run is in flight. Pure and exported for tests.
export function canViewCompareRecord(
  state: Pick<StudioState, "running" | "runId">,
  recorderAvailable: boolean,
): boolean {
  return recorderAvailable && state.runId !== null && !state.running;
}

// Compare → historical preload notice (Slice 5). After a successful "Open in
// Compare" preload the fresh draft has no run id of its own (LOAD_RUN_CONFIG
// resets execution identity, so runId is null), so the honest "config loaded
// from run …" notice is visible. It is cleared (preloadRunId → null) once a
// new Compare run obtains its own id (the runId effect below) or the session
// resets (handleResetSession), so a later reset can never resurrect an old
// notice. Visibility is exact: only while the preloaded draft still has no
// runId. Pure and exported for tests.
export function isPreloadNoticeVisible(preloadRunId: string | null, runId: string | null): boolean {
  return preloadRunId !== null && runId === null;
}

export default function RSemble() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { registry: ownerRegistry, owner: activeOwner } = useExecutionOwner();
  const crossTabLease = useExecutionLease();
  const location = useLocation();
  const navigate = useNavigate();
  const experimentController = useExperimentController();
  const isCompareRoute = location.pathname === "/compare" || location.pathname === "/";
  // Workspace derivation (REV-5, plan 8.2 / spec §15.12): explicit routing/
  // ownership rule — Compare shortcuts fire only on routes that own live
  // Compare execution. /lab, /tasks, /compare/results/*, and unknown routes
  // map to "other" and inherit no Compare pipeline shortcuts.
  const workspace: WorkspaceKind = deriveWorkspace(location.pathname);
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
  // Quick Records drawer (Child 08 §H): >=1024 only. Below 1024 the header
  // Records utility is a plain /records link and the drawer never mounts.
  const [recordsDrawerOpen, setRecordsDrawerOpen] = useState(false);
  // Focus-return authority: the header trigger is the Base UI finalFocus
  // target when the drawer closes (spec §P).
  const recordsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const commandDialogHandle = useMemo(() => Dialog.createHandle(), []);
  const connectionsDialogHandle = useMemo(() => Dialog.createHandle(), []);
  const cheatsheetDialogHandle = useMemo(() => Dialog.createHandle(), []);

  const [playbookDialogOpen, setPlaybookDialogOpen] = useState(false);
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
  // Slice 5 (Open in Compare): id of the run whose frozen config was last
  // loaded into the command pane. Drives the honest "config loaded" notice on
  // the Compare toolbar. The notice is visible while the fresh draft has no
  // new run id of its own; preloadRunId is cleared once a new Compare run
  // obtains its own id (see the runId effect below) or the session resets
  // (see the reset handler), so a later reset can never resurrect an old
  // notice. It is also never set while a Compare run is in flight — see
  // handleOpenInCompare's active-execution guard.
  const [preloadRunId, setPreloadRunId] = useState<string | null>(null);

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
  const taskRepo = useTaskRepository();
  const studyRepo = useStudyRepository();
  const labAssetRepo = useLabAssetRepository();
  const taskSetRepo = useTaskSetRepository();
  const db = useContext(RepositoryContext).db;
  const comparisonRepo = useMemo(
    () => (db && runRepo ? createComparisonRepository(db, runRepo) : null),
    [db, runRepo],
  );
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
        comparisonRepo: comparisonRepo ?? undefined,
        taskRepo: taskRepo ?? undefined,
        preflight: (current) =>
          comparePreflightRef.current?.(current) ?? {
            ok: false,
            code: "active-execution",
            message: "Compare preflight is not ready.",
          },
        lease: crossTabLease,
      }),
    [dispatch, streamBuffer, recorder, comparisonRepo, taskRepo, crossTabLease],
  );
  const { runFanout, abortRun, retryCandidate, retryJudge, triggerFusion, runWithPlaybook } =
    runController;

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

  // Reset the Compare session and retire any historical-preload notice in
  // one shot. Centralized so every Reset button (desktop command pane + mobile
  // command dialog) clears preloadRunId together with RESET_SESSION — a later
  // reset can never resurrect an old "config loaded from run …" notice.
  const handleResetSession = useCallback(() => {
    dispatch({ type: "RESET_SESSION" });
    setPreloadRunId(null);
  }, [dispatch]);

  // ---------------------------------------------------------------------------
  // Run Detail → Open in Compare (Slice 5)
  // ---------------------------------------------------------------------------
  // Honest S-class preload: dispatch the record's frozen command-pane config
  // (never results, never the record itself), record which run it came from for
  // the toolbar notice, then navigate to Compare. The user reviews the loaded
  // inputs and explicitly starts a NEW run — no lineage is fabricated.
  const handleOpenInCompare = useCallback(
    (runId: string, config: RunConfigPreload) => {
      // Active-execution safety: if a Compare run is in flight, neither
      // dispatch a preload (the reducer's LOAD_RUN_CONFIG also no-ops on
      // running state, but skipping here is the load-bearing guard) nor set
      // the historical-preload notice — otherwise the notice would surface
      // the moment the live run finished and runId changed. Navigating to the
      // existing Compare view is still allowed; no other active state is
      // touched.
      if (stateRef.current.running) {
        void navigate("/compare");
        return;
      }
      dispatch({ type: "LOAD_RUN_CONFIG", config });
      setPreloadRunId(runId);
      // Navigation return is intentionally ignored — the dispatch above is the
      // source of truth and the route change is fire-and-forget.
      void navigate("/compare");
    },
    [dispatch, navigate],
  );

  // Clear the historical-preload notice once a new Compare run obtains its
  // own run id. After a successful preload the fresh draft has runId === null
  // (LOAD_RUN_CONFIG resets execution identity), so this effect stays idle
  // until requestRun mints a fresh `cmp-…` id that differs from the
  // historical preloadRunId — at which point the notice is retired and a
  // later reset cannot resurrect it. (Reset clears preloadRunId directly via
  // handleResetSession, which wraps RESET_SESSION for every Reset button.)
  useEffect(() => {
    if (preloadRunId !== null && state.runId !== null && state.runId !== preloadRunId) {
      setPreloadRunId(null);
    }
  }, [preloadRunId, state.runId]);

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
              recordsOpen={recordsDrawerOpen}
              onOpenRecords={isLg ? () => setRecordsDrawerOpen(true) : undefined}
              recordsTriggerRef={recordsTriggerRef}
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
              <RouteErrorBoundary>
                <AppRoutes
                  compareOutlet={
                    <div className="flex min-h-0 flex-1 flex-col">
                      <div
                        data-compare-toolbar=""
                        className="flex min-h-[52px] shrink-0 items-center justify-between gap-3 border-b border-edge bg-panel px-3 py-1.5 sm:px-4"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                            Finish
                          </span>
                          {/* Compare → View record (Slice 5): links the
                            persisted run of the last finished Compare run into
                            the Runs workspace. Only when a recorder-backed
                            record exists (never for in-memory-only runs) and
                            the run is not in flight. */}
                          {canViewCompareRecord(state, recorder !== null) && (
                            <button
                              type="button"
                              data-action="view-record"
                              onClick={() => state.runId && navigate(`/runs/${state.runId}`)}
                              className="pressable flex min-h-[32px] items-center gap-1.5 rounded-md border border-edge px-2.5 text-xs text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
                            >
                              <FileText size={13} aria-hidden="true" />
                              View record
                            </button>
                          )}
                          {/* Compare → Run with Playbook (Task 10): opens the explicit
                            preflight and compatibility dialog to run with a sealed playbook. */}
                          {studyRepo && labAssetRepo && (
                            <button
                              type="button"
                              data-action="open-run-with-playbook"
                              onClick={() => setPlaybookDialogOpen(true)}
                              disabled={state.running}
                              className="pressable flex min-h-[32px] items-center gap-1.5 rounded-md border border-edge px-2.5 text-xs text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <BookOpen size={13} aria-hidden="true" />
                              Run with playbook
                            </button>
                          )}
                          {preloadRunId !== null &&
                            isPreloadNoticeVisible(preloadRunId, state.runId) && (
                              <span
                                data-preload-notice=""
                                className="hidden truncate text-xs text-text-muted sm:inline"
                              >
                                Config loaded from run {preloadRunId.slice(0, 12)}… — results not
                                copied; run Compare to execute.
                              </span>
                            )}
                        </div>
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
                              onResetSession={handleResetSession}
                            />
                          )}
                        </section>

                        {!focusActive && (
                          <SplitDivider
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
                  onOpenInCompare={handleOpenInCompare}
                />
              </RouteErrorBoundary>
            </div>
          </div>
        </div>

        {/* Mobile bottom navigation — fixed, four workspaces. */}
        <MobileWorkspaceNav />

        {/* Quick Records drawer (Child 08 §H) — mounted only at >=1024.
          Below 1024 the header utility navigates to /records instead. */}
        {isLg && (
          <RecordsDrawer
            open={recordsDrawerOpen}
            onOpenChange={setRecordsDrawerOpen}
            finalFocus={recordsTriggerRef}
          />
        )}

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
                      onResetSession={handleResetSession}
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
            activeExperimentId && navigate(`/evaluations/results/${activeExperimentId}`)
          }
          onAbortExperiment={() => {
            void experimentController?.abort();
          }}
          onFindRecord={() => {
            // §G.7: >=1024 opens the drawer with its search focused;
            // below 1024 navigates to /records with the filter focused.
            if (isLg) {
              setRecordsDrawerOpen(true);
              requestAnimationFrame(() => {
                document.getElementById("records-drawer-search")?.focus();
              });
            } else {
              void navigate("/records?focus=search");
            }
          }}
        />
        <ShortcutCheatsheet
          open={cheatsheetOpen}
          onOpenChange={setCheatsheetOpen}
          handle={cheatsheetDialogHandle}
        />
        {studyRepo && labAssetRepo && (
          <RunWithPlaybookDialog
            open={playbookDialogOpen}
            onOpenChange={setPlaybookDialogOpen}
            studyRepo={studyRepo}
            labAssetRepo={labAssetRepo}
            taskSetRepo={taskSetRepo ?? undefined}
            slots={state.slots}
            candidateModelSlots={state.slots}
            critic={state.critic}
            prompt={state.prompt}
            taskBinding={state.taskBinding ?? null}
            taskSetContext={
              typeof (state as unknown as Record<string, unknown>).taskSetContext === "object" &&
              (state as unknown as Record<string, unknown>).taskSetContext !== null
                ? ((state as unknown as Record<string, unknown>).taskSetContext as {
                    taskSetId: string;
                    version: number;
                  })
                : null
            }
            running={state.running}
            onConfirmed={(binding) => {
              void runWithPlaybook(binding);
            }}
          />
        )}
      </div>
    </ModelProbeProvider>
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
  onResetSession,
}: {
  state: StudioState;
  dispatch: React.Dispatch<Action>;
  canRun: boolean;
  onRun: () => void;
  onAbort: () => void;
  /** Attachment gate reason for the Run button (plan 7.6.8). */
  blockReason?: string | null;
  /** Reset the Compare session: dispatches RESET_SESSION and retires any
   *  historical-preload notice so a later reset cannot resurrect it. */
  onResetSession: () => void;
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
        action={<ResetButton hasRun={hasRun} running={state.running} onReset={onResetSession} />}
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
