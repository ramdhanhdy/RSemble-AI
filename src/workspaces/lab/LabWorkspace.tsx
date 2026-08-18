import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import type { LabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import type { StudyRepository } from "../../lib/persistence/study-repository";
import {
  useLabAssetRepository,
  useStudyRepository,
} from "../../lib/persistence/repository-context";
import { LabRecipeList } from "./LabRecipeList";
import { LabRecipeVersionPage } from "./LabRecipeVersionPage";
import { ModelPoolList } from "./ModelPoolList";
import { ModelPoolVersionPage } from "./ModelPoolVersionPage";
import { PolicyStudyList } from "./PolicyStudyList";
import { PolicyStudyPage } from "./PolicyStudyPage";

interface LabWorkspaceProps {
  studyRepo?: StudyRepository | null;
  labAssetRepo?: LabAssetRepository | null;
}

interface RailCounts {
  studies: number;
  recipes: number;
  pools: number;
}

export function LabWorkspace({
  studyRepo: studyRepoProp,
  labAssetRepo: labAssetRepoProp,
}: LabWorkspaceProps) {
  const ctxStudy = useStudyRepository();
  const ctxAssets = useLabAssetRepository();
  const studyRepo = studyRepoProp !== undefined ? studyRepoProp : ctxStudy;
  const labAssetRepo = labAssetRepoProp !== undefined ? labAssetRepoProp : ctxAssets;
  const [counts, setCounts] = useState<RailCounts>({ studies: 0, recipes: 0, pools: 0 });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      studyRepo?.listStudies() ?? Promise.resolve([]),
      labAssetRepo?.listRecipeRecords() ?? Promise.resolve([]),
      labAssetRepo?.listPoolRecords() ?? Promise.resolve([]),
    ]).then(([studies, recipes, pools]) => {
      if (!cancelled) {
        setCounts({ studies: studies.length, recipes: recipes.length, pools: pools.length });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [labAssetRepo, studyRepo]);

  const rail = [
    { to: "/lab", end: true, label: "Policy Studies", count: counts.studies },
    { to: "/lab/recipes", end: false, label: "Fusion Recipes", count: counts.recipes },
    { to: "/lab/model-pools", end: false, label: "Model Pools", count: counts.pools },
  ] as const;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
      <nav
        aria-label="Research Lab"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-edge p-2 lg:w-[220px] lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:p-3"
      >
        {rail.map((entry) => (
          <NavLink
            key={entry.to}
            to={entry.to}
            end={entry.end}
            className={({ isActive }) =>
              `flex min-h-[44px] items-center justify-between gap-2 rounded-md px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                isActive
                  ? "border-l-2 border-accent bg-accent/10 text-accent"
                  : "border-l-2 border-transparent text-text hover:bg-panel"
              }`
            }
          >
            <span>{entry.label}</span>
            <span className="font-mono text-xs text-text-muted tabular-nums">{entry.count}</span>
          </NavLink>
        ))}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto scroll-thin px-3 py-4 lg:px-6">
        <div className="max-w-[960px]">
          <Routes>
            <Route
              index
              element={<PolicyStudyList studyRepo={studyRepo} />}
            />
            <Route
              path="recipes"
              element={<LabRecipeList labAssetRepo={labAssetRepo} studyRepo={studyRepo} />}
            />
            <Route
              path="recipes/:recipeId/versions/:version"
              element={<LabRecipeVersionPage labAssetRepo={labAssetRepo} />}
            />
            <Route
              path="model-pools"
              element={<ModelPoolList labAssetRepo={labAssetRepo} studyRepo={studyRepo} />}
            />
            <Route
              path="model-pools/:poolId/versions/:version"
              element={<ModelPoolVersionPage labAssetRepo={labAssetRepo} />}
            />
            <Route path="studies/:studyId" element={<PolicyStudyPage studyRepo={studyRepo} />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
