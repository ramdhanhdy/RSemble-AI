// =============================================================================
// AppRouter — route definitions for the three-workspace shell.
//
// RSemble wraps this in HashRouter (production) or MemoryRouter (tests).
// The routes render workspace content below the shared header. Compare
// content is rendered inline by RSemble via the CompareOutlet; Runs and
// Evaluations are separate workspace components.
//
// The reducer, controller refs, provider probes, and modals stay mounted
// in RSemble above this router so state persists across navigation.
//
// Rubric routes (rubric-terminology spec §4): /evaluations/rubrics,
// /evaluations/rubrics/:rubricId, and /evaluations/rubrics/:rubricId/versions/:version
// are the canonical scoring-rubric routes. The real baseline legacy routes
// /evaluations/profiles and /evaluations/profiles/:rubricId redirect to them,
// preserving the entity id and any location state (return location / historical
// version state) so existing deep links keep working. No invented /rubrics/*
// alias is added — only the real baseline profiles routes redirect. The
// list/detail components ship as RubricList/RubricDetail; the route paths and
// surfaces are both canonical.
// =============================================================================

import { lazy, Suspense, useContext, useEffect, useState } from "react";
import { Routes, Route, Navigate, Link, useParams, useLocation } from "react-router-dom";
import {
  RepositoryContext,
  useEvaluationRepository,
  useFusionStudyRepository,
  useTaskRepository,
} from "./lib/persistence/repository-context";
import type { CatalogModel, ProviderId } from "./lib/providers/types";
import type { RunConfigPreload } from "./lib/runs/run-config-preload";
import { ExecutionOwnerProvider } from "./lib/execution-owner-context";
import { ModelProbeProvider } from "./ui/ModelProbeContext";

// Route-level code splitting: Compare is the default surface and stays in the
// main chunk; Runs, Evaluations (task sets, rubrics, fusion study), and
// experiment results load on first navigation to them.
const RunsWorkspace = lazy(() =>
  import("./workspaces/RunsWorkspace").then((m) => ({ default: m.RunsWorkspace })),
);
const EvaluationsWorkspace = lazy(() =>
  import("./workspaces/EvaluationsWorkspace").then((m) => ({ default: m.EvaluationsWorkspace })),
);
const TaskSetList = lazy(() =>
  import("./workspaces/evaluations/TaskSetList").then((m) => ({ default: m.TaskSetList })),
);
const TaskSetEditor = lazy(() =>
  import("./workspaces/evaluations/TaskSetEditor").then((m) => ({ default: m.TaskSetEditor })),
);
const SuiteTaskEditorRoute = lazy(() =>
  import("./workspaces/evaluations/SuiteTaskEditorRoute").then((m) => ({
    default: m.SuiteTaskEditorRoute,
  })),
);
const RubricList = lazy(() =>
  import("./workspaces/evaluations/RubricList").then((m) => ({ default: m.RubricList })),
);
const RubricDetail = lazy(() =>
  import("./workspaces/evaluations/RubricDetail").then((m) => ({ default: m.RubricDetail })),
);
const FusionStudyRoute = lazy(() =>
  import("./workspaces/evaluations/FusionStudyView").then((m) => ({ default: m.FusionStudyRoute })),
);
const ExperimentRoute = lazy(() =>
  import("./workspaces/evaluations/ExperimentRoute").then((m) => ({ default: m.ExperimentRoute })),
);
// Canonical Task routes (canonical-tasks spec §7): /tasks, /tasks/new,
// /tasks/:taskId, /tasks/:taskId/versions/:version. Tasks are a secondary
// surface — reachable from the command palette and direct links, never from
// primary navigation.
const TaskCatalog = lazy(() =>
  import("./workspaces/tasks/TaskCatalog").then((m) => ({ default: m.TaskCatalog })),
);
const TaskNewRoute = lazy(() =>
  import("./workspaces/tasks/TaskRoute").then((m) => ({ default: m.TaskNewRoute })),
);
const TaskDetailRoute = lazy(() =>
  import("./workspaces/tasks/TaskRoute").then((m) => ({ default: m.TaskDetailRoute })),
);
const TaskVersionRoute = lazy(() =>
  import("./workspaces/tasks/TaskRoute").then((m) => ({ default: m.TaskVersionRoute })),
);

function RouteFallback() {
  return (
    <div className="flex min-h-[120px] items-center justify-center text-sm text-text-muted">
      Loading…
    </div>
  );
}

function withSuspense(node: React.ReactNode): React.ReactNode {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

export function AppRoutes({
  compareOutlet,
  models,
  availableProviderIds,
  onOpenInCompare,
}: {
  compareOutlet: React.ReactNode;
  models: CatalogModel[];
  /** Providers currently ready (registry order) — powers the add-model picker
   *  on terminal experiment results (roster spec F1). */
  availableProviderIds?: ProviderId[];
  /** Run Detail → Open in Compare (Slice 5): preloads a record's frozen
   *  config into the Compare command pane and navigates there. Optional so
   *  route-only renderers (tests) can omit it. */
  onOpenInCompare?: (runId: string, config: RunConfigPreload) => void;
}) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/compare" replace />} />
      <Route path="/compare" element={<CompareSlot>{compareOutlet}</CompareSlot>} />
      <Route
        path="/runs"
        element={withSuspense(<RunsWorkspace onOpenInCompare={onOpenInCompare} />)}
      />
      <Route
        path="/runs/:runId"
        element={withSuspense(<RunsWorkspace onOpenInCompare={onOpenInCompare} />)}
      />

      {/* Evaluations workspace — segmented nav (Task sets | Rubrics) + Outlet.
          EvaluationContext is provided by EvaluationsWorkspace so child routes
          can call useEvaluationRepository() from evaluation-context.tsx. */}
      <Route path="/evaluations" element={withSuspense(<EvaluationsWorkspace />)}>
        <Route index element={<EvaluationsIndexRedirect />} />

        {/* Canonical Task Set routes (task-sets spec §4). Static `sets` ranks
            above reserved rubric/profiles segments and the leftover dynamic
            :suiteId compatibility routes. */}
        <Route path="sets" element={withSuspense(<TaskSetListRoute />)} />
        <Route path="sets/new" element={withSuspense(<TaskSetNewRoute />)} />
        <Route
          path="sets/:taskSetId"
          element={withSuspense(<TaskSetEditorRoute models={models} />)}
        />
        <Route
          path="sets/:taskSetId/versions/:version"
          element={withSuspense(<TaskSetVersionRoute models={models} />)}
        />
        <Route
          path="sets/:taskSetId/tasks/:taskId"
          element={withSuspense(<SuiteTaskEditorRouteWrapper models={models} />)}
        />
        <Route
          path="sets/:taskSetId/fusion/:studyId"
          element={withSuspense(<FusionStudyRouteWrapper />)}
        />

        {/* Canonical Rubric routes (rubric-terminology spec §4). */}
        <Route path="rubrics" element={withSuspense(<RubricListRoute />)} />
        <Route path="rubrics/:rubricId" element={withSuspense(<RubricDetailRoute />)} />
        <Route
          path="rubrics/:rubricId/versions/:version"
          element={withSuspense(<RubricVersionRoute />)}
        />
        <Route path="profiles" element={<RubricListRedirect />} />
        <Route path="profiles/:rubricId" element={<RubricDetailRedirect />} />


        {/* Canonical Evaluation execution results routes (spec §5.1). */}
        <Route
          path="results/:evaluationExecutionId"
          element={withSuspense(
            <ExperimentRouteWrapper
              models={models}
              availableProviderIds={availableProviderIds ?? []}
            />,
          )}
        />
        {/* Real baseline legacy suite/fusion links. Fusion redirects only after
            exact ownership crosswalk resolution (spec §4 / §8.2). */}
        <Route path=":suiteId/fusion/:studyId" element={<LegacyFusionRedirect />} />
        <Route path=":suiteId" element={<LegacySuiteRedirect />} />
        <Route
          path=":suiteId/tasks/:taskId"
          element={withSuspense(<SuiteTaskEditorRouteWrapper models={models} />)}
        />
      </Route>

      {/* Canonical Task routes (canonical-tasks spec §7, plan Task 6).
          /tasks/new ranks above the dynamic :taskId segment so "new" always
          resolves to the create shell. Unknown task/version IDs render explicit
          not-found states — no silent redirects. */}
      <Route path="/tasks" element={withSuspense(<TaskCatalogRoute />)} />
      <Route path="/tasks/new" element={withSuspense(<TaskNewRouteWrapper />)} />
      <Route path="/tasks/:taskId" element={withSuspense(<TaskDetailRouteWrapper />)} />
      <Route
        path="/tasks/:taskId/versions/:version"
        element={withSuspense(<TaskVersionRouteWrapper />)}
      />

      {/* Legacy Experiment redirect — preserves query parameters and state (spec §5.1, plan Task 9). */}
      <Route path="/experiments/:experimentId" element={<LegacyExperimentRedirect />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function TaskSetListRoute() {
  const repo = useEvaluationRepository();
  return <TaskSetList repo={repo} />;
}

function TaskSetEditorRoute({ models }: { models: CatalogModel[] }) {
  const repo = useEvaluationRepository();
  return (
    <ExecutionOwnerProvider>
      <ModelProbeProvider>
        <TaskSetEditor repo={repo} models={models} />
      </ModelProbeProvider>
    </ExecutionOwnerProvider>
  );
}

function TaskSetVersionRoute({ models }: { models: CatalogModel[] }) {
  return <TaskSetEditorRoute models={models} />;
}

function TaskSetNewRoute() {
  const repo = useEvaluationRepository();
  return <TaskSetList repo={repo} />;
}
function EvaluationsIndexRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={{ pathname: "/evaluations/sets", search: location.search }}
      replace
      state={location.state}
    />
  );
}

const RESERVED_EVALUATION_SEGMENTS = new Set(["sets", "rubrics", "profiles", "results"]);

function LegacySuiteRedirect() {
  const { suiteId } = useParams<{ suiteId: string }>();
  const location = useLocation();
  if (!suiteId || RESERVED_EVALUATION_SEGMENTS.has(suiteId)) {
    return <Navigate to="/evaluations/sets" replace />;
  }
  return (
    <Navigate
      to={{ pathname: `/evaluations/sets/${suiteId}`, search: location.search }}
      replace
      state={location.state}
    />
  );
}

function LegacyExperimentRedirect() {
  const { experimentId } = useParams<{ experimentId: string }>();
  const location = useLocation();
  return (
    <Navigate
      to={{ pathname: `/evaluations/results/${experimentId ?? ""}`, search: location.search }}
      replace
      state={location.state}
    />
  );
}

function LegacyFusionRedirect() {
  const { studyId } = useParams<{ suiteId: string; studyId: string }>();
  const location = useLocation();
  const { db } = useContext(RepositoryContext);
  const [resolution, setResolution] = useState<"pending" | "resolved" | "unresolved">("pending");
  const [resolvedTaskSetId, setResolvedTaskSetId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!studyId || !db?.taskSetOwnershipCrosswalk) {
      setResolution("unresolved");
      return;
    }
    void db.taskSetOwnershipCrosswalk
      .get(`ts-xwalk:fusion:${studyId}`)
      .then((row) => {
        if (cancelled) return;
        if (isResolvedFusionOwner(row)) {
          setResolvedTaskSetId(row.taskSetId);
          setResolution("resolved");
          return;
        }
        setResolution("unresolved");
      })
      .catch(() => {
        if (!cancelled) setResolution("unresolved");
      });
    return () => {
      cancelled = true;
    };
  }, [db, studyId]);

  if (resolution === "resolved" && resolvedTaskSetId) {
    return (
      <Navigate
        to={{
          pathname: `/evaluations/sets/${resolvedTaskSetId}/fusion/${studyId ?? ""}`,
          search: location.search,
        }}
        replace
        state={location.state}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      {resolution === "unresolved" ? (
        <p className="text-sm text-warning" data-unresolved-owner="">
          Unresolved Fusion owner — this study stays on its legacy route because the Suite→Task Set
          crosswalk did not resolve exactly.
        </p>
      ) : (
        <p className="text-sm text-text-muted">Resolving Fusion owner…</p>
      )}
      <FusionStudyRouteWrapper />
    </div>
  );
}

function FusionStudyRouteWrapper() {
  const fusionRepo = useFusionStudyRepository();
  return <FusionStudyRoute fusionRepo={fusionRepo} />;
}

function isResolvedFusionOwner(row: unknown): row is { status: "resolved"; taskSetId: string } {
  if (!row || typeof row !== "object") return false;
  if (!("status" in row) || !("taskSetId" in row)) return false;
  return row.status === "resolved" && typeof row.taskSetId === "string";
}

/** Task catalog route wrapper — reads the task repository from context; the
 *  catalog surfaces its own bounded error state when storage is unavailable
 *  (spec §8) instead of failing the whole route tree. */
function TaskCatalogRoute() {
  const repo = useTaskRepository();
  return <TaskCatalog repo={repo} />;
}

/** /tasks/new route wrapper. */
function TaskNewRouteWrapper() {
  const repo = useTaskRepository();
  return <TaskNewRoute repo={repo} />;
}

/** /tasks/:taskId route wrapper. Reads the id from the URL for direct loads. */
function TaskDetailRouteWrapper() {
  const repo = useTaskRepository();
  const { taskId } = useParams<{ taskId: string }>();
  return <TaskDetailRoute repo={repo} taskId={taskId ?? ""} />;
}

/** /tasks/:taskId/versions/:version route wrapper. Parses the version param;
 *  malformed params render the explicit invalid-version state, not a redirect. */
function TaskVersionRouteWrapper() {
  const repo = useTaskRepository();
  const { taskId, version } = useParams<{ taskId: string; version: string }>();
  const parsed = Number(version);
  return <TaskVersionRoute repo={repo} taskId={taskId ?? ""} version={parsed} />;
}

/** RubricList route wrapper — canonical /evaluations/rubrics. Renders the
 *  RubricList surface. Passes the repo explicitly for consistency with the
 *  suite route wrappers. */
function RubricListRoute() {
  const repo = useEvaluationRepository();
  return <RubricList repo={repo} />;
}

/** RubricDetail route wrapper — canonical /evaluations/rubrics/:rubricId.
 *  Reads :rubricId and passes it as the rubric identity to RubricDetail.
 *  The stored record id is the same whether the link arrived via the
 *  canonical route or the legacy rubric redirect. */
function RubricDetailRoute() {
  const repo = useEvaluationRepository();
  const { rubricId } = useParams<{ rubricId: string }>();
  return <RubricDetail repo={repo} rubricId={rubricId ?? ""} />;
}

/** RubricVersion route wrapper — canonical
 *  /evaluations/rubrics/:rubricId/versions/:version (spec §4). Reads
 *  :rubricId and :version and passes them to RubricDetail so a direct
 *  load/refresh/deep link opens the requested historical version (read-only
 *  when not latest). The version prop drives reloading on URL navigation
 *  (back/forward between versions). */
function RubricVersionRoute() {
  const repo = useEvaluationRepository();
  const { rubricId, version } = useParams<{ rubricId: string; version: string }>();
  const parsed = Number(version);
  const versionNum = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  return <RubricDetail repo={repo} rubricId={rubricId ?? ""} version={versionNum} />;
}

/** Compatibility redirect: /evaluations/profiles → /evaluations/rubrics.
 *  Preserves search and location state so return locations and any
 *  historical version state encoded in the URL/location survive the
 *  redirect (rubric-terminology spec §4). `replace` keeps the legacy URL
 *  out of the history stack so browser back does not loop back to it. */
function RubricListRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={{ pathname: "/evaluations/rubrics", search: location.search }}
      replace
      state={location.state}
    />
  );
}

/** Compatibility redirect: /evaluations/profiles/:rubricId →
 *  /evaluations/rubrics/:rubricId. The legacy profiles entity id is the same
 *  stored record — only the route name changes. Preserves search and
 *  location state; `replace` avoids a back-button loop. */
function RubricDetailRedirect() {
  const { rubricId } = useParams<{ rubricId: string }>();
  const location = useLocation();
  return (
    <Navigate
      to={{ pathname: `/evaluations/rubrics/${rubricId ?? ""}`, search: location.search }}
      replace
      state={location.state}
    />
  );
}

/** SuiteTaskEditorRoute wrapper for the mobile deep-link route. */
function SuiteTaskEditorRouteWrapper({ models }: { models: CatalogModel[] }) {
  const repo = useEvaluationRepository();
  return <SuiteTaskEditorRoute repo={repo} models={models} />;
}

function ExperimentRouteWrapper({
  models,
  availableProviderIds,
}: {
  models: CatalogModel[];
  availableProviderIds: ProviderId[];
}) {
  return (
    <ExecutionOwnerProvider>
      <ExperimentRoute models={models} availableProviderIds={availableProviderIds} />
    </ExecutionOwnerProvider>
  );
}

function CompareSlot({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="font-mono text-sm uppercase tracking-[0.14em] text-text-muted">Not found</h1>
      <p className="max-w-sm text-sm text-text-secondary">This route does not exist.</p>
      <Link
        to="/compare"
        className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
      >
        Return to Compare
      </Link>
    </div>
  );
}
