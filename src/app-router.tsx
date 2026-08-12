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
// Rubric routes (rubric-terminology spec §4): /evaluations/rubrics and
// /evaluations/rubrics/:rubricId are the canonical scoring-rubric routes.
// The baseline /evaluations/profiles… routes redirect to them, preserving
// the entity id and any location state (return location / historical
// version state) so existing deep links keep working. No invented
// /profiles/* alias is added — only real baseline profile routes redirect.
// The list/detail components still ship as ProfileList/ProfileDetail until
// Task 5 renames the surfaces; the route paths are canonical already.
// =============================================================================

import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, Link, useParams, useLocation } from "react-router-dom";
import {
  useEvaluationRepository,
  useFusionStudyRepository,
} from "./lib/persistence/repository-context";
import type { CatalogModel, ProviderId } from "./lib/providers/types";
import type { RunConfigPreload } from "./lib/runs/run-config-preload";

// Route-level code splitting: Compare is the default surface and stays in the
// main chunk; Runs, Evaluations (suites, rubrics, fusion study), and
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
  import("./workspaces/evaluations/SuiteTaskEditorRoute").then((m) => ({
    default: m.SuiteTaskEditorRoute,
  })),
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

      {/* Evaluations workspace — segmented nav (Suites | Rubrics) + Outlet.
          EvaluationContext is provided by EvaluationsWorkspace so child routes
          can call useEvaluationRepository() from evaluation-context.tsx. */}
      <Route path="/evaluations" element={withSuspense(<EvaluationsWorkspace />)}>
        <Route index element={withSuspense(<SuiteListRoute />)} />

        {/* Canonical Rubric routes (rubric-terminology spec §4). Static
            segments rank above the dynamic :suiteId route below, so
            /evaluations/rubrics and /evaluations/rubrics/:rubricId always
            resolve to the rubric surfaces, never to a suite editor. */}
        <Route path="rubrics" element={withSuspense(<RubricListRoute />)} />
        <Route path="rubrics/:rubricId" element={withSuspense(<RubricDetailRoute />)} />

        {/* Compatibility redirects — real baseline /evaluations/profiles…
            links redirect to the canonical Rubric routes, preserving the
            entity id and any location state (return location / historical
            version state) without an invented /profiles/* alias (spec §4). */}
        <Route path="profiles" element={<ProfileListRedirect />} />
        <Route path="profiles/:profileId" element={<ProfileDetailRedirect />} />

        <Route path=":suiteId" element={withSuspense(<SuiteEditorRoute models={models} />)} />
        <Route
          path=":suiteId/tasks/:taskId"
          element={withSuspense(<SuiteTaskEditorRouteWrapper models={models} />)}
        />
        <Route
          path=":suiteId/fusion/:studyId"
          element={withSuspense(<FusionStudyRouteWrapper />)}
        />
      </Route>

      {/* Experiment progress/results — top-level route (spec §5.1). Terminal
          records render results; non-terminal render live progress. */}
      <Route
        path="/experiments/:experimentId"
        element={withSuspense(
          <ExperimentRoute models={models} availableProviderIds={availableProviderIds ?? []} />,
        )}
      />

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

/** RubricList route wrapper — canonical /evaluations/rubrics. Renders the
 *  rubric list (currently the ProfileList component, renamed in Task 5).
 *  Passes the repo explicitly for consistency with the suite route wrappers. */
function RubricListRoute() {
  const repo = useEvaluationRepository();
  return <ProfileList repo={repo} />;
}

/** RubricDetail route wrapper — canonical /evaluations/rubrics/:rubricId.
 *  Reads :rubricId and passes it as the rubric identity to ProfileDetail
 *  (renamed in Task 5). The stored record id is the same whether the link
 *  arrived via the canonical route or the legacy profile redirect. */
function RubricDetailRoute() {
  const repo = useEvaluationRepository();
  const { rubricId } = useParams<{ rubricId: string }>();
  return <ProfileDetail repo={repo} profileId={rubricId ?? ""} />;
}

/** Compatibility redirect: /evaluations/profiles → /evaluations/rubrics.
 *  Preserves search and location state so return locations and any
 *  historical version state encoded in the URL/location survive the
 *  redirect (rubric-terminology spec §4). `replace` keeps the legacy URL
 *  out of the history stack so browser back does not loop back to it. */
function ProfileListRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={{ pathname: "/evaluations/rubrics", search: location.search }}
      replace
      state={location.state}
    />
  );
}

/** Compatibility redirect: /evaluations/profiles/:profileId →
 *  /evaluations/rubrics/:rubricId. The profileId entity becomes the rubricId
 *  (same stored record — only the route name changes). Preserves search and
 *  location state; `replace` avoids a back-button loop. */
function ProfileDetailRedirect() {
  const { profileId } = useParams<{ profileId: string }>();
  const location = useLocation();
  return (
    <Navigate
      to={{ pathname: `/evaluations/rubrics/${profileId ?? ""}`, search: location.search }}
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
