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

import { Routes, Route, Navigate, Link, useParams } from "react-router-dom";
import { RunsWorkspace } from "./workspaces/RunsWorkspace";
import { EvaluationsWorkspace } from "./workspaces/EvaluationsWorkspace";
import { SuiteList } from "./workspaces/evaluations/SuiteList";
import { SuiteEditor } from "./workspaces/evaluations/SuiteEditor";
import { SuiteTaskEditorRoute } from "./workspaces/evaluations/SuiteTaskEditorRoute";
import { ProfileList } from "./workspaces/evaluations/ProfileList";
import { ProfileDetail } from "./workspaces/evaluations/ProfileDetail";
import { ExperimentRoute } from "./workspaces/evaluations/ExperimentRoute";
import { useEvaluationRepository } from "./lib/persistence/repository-context";
import type { CatalogModel } from "./lib/providers/types";

export function AppRoutes({ compareOutlet, models }: { compareOutlet: React.ReactNode; models: CatalogModel[] }) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/compare" replace />} />
      <Route path="/compare" element={<CompareSlot>{compareOutlet}</CompareSlot>} />
      <Route path="/runs" element={<RunsWorkspace />} />
      <Route path="/runs/:runId" element={<RunsWorkspace />} />

      {/* Evaluations workspace — segmented nav (Suites | Profiles) + Outlet.
          EvaluationContext is provided by EvaluationsWorkspace so child routes
          can call useEvaluationRepository() from evaluation-context.tsx. */}
      <Route path="/evaluations" element={<EvaluationsWorkspace />}>
        <Route index element={<SuiteListRoute />} />
        <Route path="profiles" element={<ProfileListRoute />} />
        <Route path="profiles/:profileId" element={<ProfileDetailRoute />} />
        <Route path=":suiteId" element={<SuiteEditorRoute models={models} />} />
        <Route path=":suiteId/tasks/:taskId" element={<SuiteTaskEditorRouteWrapper models={models} />} />
      </Route>

      {/* Experiment progress/results — top-level route (spec §5.1). Terminal
          records render results; non-terminal render live progress. */}
      <Route path="/experiments/:experimentId" element={<ExperimentRoute />} />

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
