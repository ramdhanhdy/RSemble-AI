// =============================================================================
// rubric-usage — derive which suites pin a rubric (identity spec §5.3).
//
// Pure function over listSuites(true) results; no storage access. Extracted
// from RubricDetail's inline suiteReferencesRubric predicate so suite rows,
// the suite editor, and rubric backlinks share one tested derivation.
// =============================================================================

import type { EvaluationSuite } from "./evaluation-types";

export interface RubricUsage {
  suite: EvaluationSuite;
  /** Distinct pinned versions of this rubric, ascending. */
  versions: number[];
  /** Where the pins occur: suite default evaluation and/or task level. */
  levels: ("default" | "task")[];
}

/**
 * Return every non-archived suite that pins the given rubric id, with the
 * versions pinned and where (suite default, task-level, or both). Archived
 * suites are excluded; holistic and inherit-only suites never match.
 */
export function suitesUsingRubric(suites: EvaluationSuite[], rubricId: string): RubricUsage[] {
  const out: RubricUsage[] = [];
  for (const suite of suites) {
    if (suite.archivedAt != null) continue;
    const versions = new Set<number>();
    const levels = new Set<"default" | "task">();
    if (
      suite.defaultEvaluation.kind === "profile" &&
      suite.defaultEvaluation.profile.id === rubricId
    ) {
      versions.add(suite.defaultEvaluation.profile.version);
      levels.add("default");
    }
    for (const task of suite.tasks) {
      if (task.evaluation.kind === "profile" && task.evaluation.profile.id === rubricId) {
        versions.add(task.evaluation.profile.version);
        levels.add("task");
      }
    }
    if (versions.size > 0) {
      out.push({
        suite,
        versions: [...versions].sort((a, b) => a - b),
        levels: [...levels],
      });
    }
  }
  return out;
}
