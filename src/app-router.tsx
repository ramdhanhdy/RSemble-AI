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
// =============================================================================

import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, Link, useParams } from "react-router-dom";
import { useEvaluationRepository, useFusionStudyRepository } from "./lib/persistence/repository-context";
import type { CatalogModel } from "./lib/providers/types";

// Route-level code splitting: Compare is the default surface and stays in the
// main chunk; Runs, Evaluations (suites, profiles, fusion study), and
// experiment results load on first navigation to them.
const RunsWorkspace = lazy(() =>
  import("./workspaces/RunsWorkspace").then((m) => ({ default: m.RunsWorkspace })),
);
const EvaluationsWorkspace = lazy(() =>
  import("./workspaces/EvaluationsWorkspace").then((m) => ({ default: m.EvaluationsWorkspace })),
);
const SuiteList = lazy(() =>
  import("./workspaces/evaluations/SuiteList").then((m) => ({ default: m.SuiteList })),
);
const SuiteEditor = lazy(() =>
  import("./workspaces/evaluations/SuiteEditor").then((m) => ({ default: m.SuiteEditor })),
);
const SuiteTaskEditorRoute = lazy(() =>
  import("./workspaces/evaluations/SuiteTaskEditorRoute").then((m) => ({ default: m.SuiteTaskEditorRoute })),
);
const ProfileList = lazy(() =>
  import("./workspaces/evaluations/ProfileList").then((m) => ({ default: m.ProfileList })),
);
const ProfileDetail = lazy(() =>
  import("./workspaces/evaluations/ProfileDetail").then((m) => ({ default: m.ProfileDetail })),
);
const FusionStudyRoute = lazy(() =>
  import("./workspaces/evaluations/FusionStudyView").then((m) => ({ default: m.FusionStudyRoute })),
);
const ExperimentRoute = lazy(() =>
  import("./workspaces/evaluations/ExperimentRoute").then((m) => ({ default: m.ExperimentRoute })),
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

export function AppRoutes({ compareOutlet, models }: { compareOutlet: React.ReactNode; models: CatalogModel[] }) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/compare" replace />} />
      <Route path="/compare" element={<CompareSlot>{compareOutlet}</CompareSlot>} />
      <Route path="/runs" element={withSuspense(<RunsWorkspace />)} />
      <Route path="/runs/:runId" element={withSuspense(<RunsWorkspace />)} />

      {/* Evaluations workspace — segmented nav (Suites | Profiles) + Outlet.
          EvaluationContext is provided by EvaluationsWorkspace so child routes
          can call useEvaluationRepository() from evaluation-context.tsx. */}
      <Route path="/evaluations" element={withSuspense(<EvaluationsWorkspace />)}>
        <Route index element={withSuspense(<SuiteListRoute />)} />
        <Route path="profiles" element={withSuspense(<ProfileListRoute />)} />
        <Route path="profiles/:profileId" element={withSuspense(<ProfileDetailRoute />)} />
        <Route path=":suiteId" element={withSuspense(<SuiteEditorRoute models={models} />)} />
        <Route path=":suiteId/tasks/:taskId" element={withSuspense(<SuiteTaskEditorRouteWrapper models={models} />)} />
        <Route path=":suiteId/fusion/:studyId" element={withSuspense(<FusionStudyRouteWrapper />)} />
      </Route>

      {/* Experiment progress/results — top-level route (spec §5.1). Terminal
          records render results; non-terminal render live progress. */}
      <Route path="/experiments/:experimentId" element={withSuspense(<ExperimentRoute />)} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/** SuiteList route wrapper — pulls the repo from RepositoryContext and passes
 *  it as a prop so SuiteList stays test-friendly (matches RunList's pattern). */
function SuiteListRoute() {
  const repo = useEvaluationRepository();
  return <SuiteList repo={repo} />;
}

/** SuiteEditor route wrapper. */
function SuiteEditorRoute({ models }: { models: CatalogModel[] }) {
  const repo = useEvaluationRepository();
  return <SuiteEditor repo={repo} models={models} />;
}

/** Fusion Study route wrapper — under the suite, inside Evaluations (spec §9). */
function FusionStudyRouteWrapper() {
  const fusionRepo = useFusionStudyRepository();
  return <FusionStudyRoute fusionRepo={fusionRepo} />;
}

/** ProfileList route wrapper. ProfileList falls back to context, but we pass
 *  repo explicitly for consistency with the suite route wrappers. */
function ProfileListRoute() {
  const repo = useEvaluationRepository();
  return <ProfileList repo={repo} />;
}

/** ProfileDetail route wrapper. Reads :profileId from the route and passes it
 *  as a prop (spec §5.1: /evaluations/profiles/:profileId). */
function ProfileDetailRoute() {
  const repo = useEvaluationRepository();
  const { profileId } = useParams<{ profileId: string }>();
  return <ProfileDetail repo={repo} profileId={profileId ?? ""} />;
}

/** SuiteTaskEditorRoute wrapper for the mobile deep-link route. */
function SuiteTaskEditorRouteWrapper({ models }: { models: CatalogModel[] }) {
  const repo = useEvaluationRepository();
  return <SuiteTaskEditorRoute repo={repo} models={models} />;
}

function CompareSlot({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="font-mono text-sm uppercase tracking-[0.14em] text-text-muted">
        Not found
      </h1>
      <p className="max-w-sm text-sm text-text-secondary">
        This route does not exist.
      </p>
      <Link
        to="/compare"
        className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
      >
        Return to Compare
      </Link>
    </div>
  );
}
