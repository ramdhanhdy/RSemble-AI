// =============================================================================
// suite-roster-extension.ts — suite sync for roster extension (roster spec §8,
// plan 001 E).
//
// When the user confirms "Add model" with suite sync checked, the added slot is
// ALSO saved into the source suite as a new version. The suite write and the
// experiment extension are independent: a conflict on the suite (another tab
// edited it) never blocks the paid experiment work the user already confirmed
// (spec §7.3). This service therefore never throws — every failure is a typed
// result the UI reports as "results only".
//
// Append-only: exactly one slot is appended with the SAME stable identity the
// experiment snapshot carries; tasks, judge, evaluation pins, description,
// creation time, and archive state are never rewritten.
// =============================================================================

import type { EvaluationRepository } from "../persistence/evaluation-repository";
import type { TaskSetRepository } from "../persistence/task-set-repository";
import { StorageError } from "../persistence/database";
import { suiteToTaskSetRecord } from "./suite-compat";
import type { EvaluationSuite } from "./evaluation-types";
import type { ModelSlot } from "../../studio-data";

export type SuiteRosterExtensionResult =
  | { ok: true; suiteVersion: number }
  | {
      ok: false;
      code: "not-found" | "archived" | "duplicate" | "conflict" | "storage";
      message: string;
    };

/** Provider-scoped model key — must match experiment-roster-extension. */
function modelKeyOf(slot: Pick<ModelSlot, "providerId" | "slug">): string {
  return `${slot.providerId}:${slot.slug}`;
}

/**
 * Append one model slot to the source suite as a new persisted version.
 *
 * Loads the current suite immediately before saving and calls the repository's
 * CAS `saveSuite` against the freshly-read revision. Returns a typed result;
 * never throws.
 */
export async function appendModelToSuite(
  repo: EvaluationRepository,
  input: {
    suiteId: string;
    slot: ModelSlot;
    now: number;
    taskSetRepository?: TaskSetRepository | null;
  },
): Promise<SuiteRosterExtensionResult> {
  let suite: EvaluationSuite | null;
  try {
    suite = await repo.getSuite(input.suiteId);
  } catch (err) {
    return {
      ok: false,
      code: "storage",
      message: suiteStorageMessage(err),
    };
  }

  if (!suite) {
    return {
      ok: false,
      code: "not-found",
      message: "Suite no longer exists — the model was added to these results only.",
    };
  }
  if (suite.archivedAt !== null) {
    return {
      ok: false,
      code: "archived",
      message: "The suite is archived — the model was added to these results only.",
    };
  }
  const addedKey = modelKeyOf(input.slot);
  if (suite.modelSlots.some((s) => modelKeyOf(s) === addedKey)) {
    return {
      ok: false,
      code: "duplicate",
      message: "The suite already contains this model — the model was added to these results only.",
    };
  }

  // When the Task Set is canonical (a TaskSetRecord exists), the optional sync
  // appends a new Task Set Version in addition to the legacy Suite write
  // (spec §7.9). The two writes are atomic; the sync stays separate from the
  // experiment extension and never changes its success semantics.
  const taskSetRepo = input.taskSetRepository ?? null;
  if (taskSetRepo) {
    const currentTaskSet = await taskSetRepo.getTaskSetRecord(input.suiteId);
    if (currentTaskSet) {
      const latest = await taskSetRepo.getTaskSetVersion(
        input.suiteId,
        currentTaskSet.latestVersion,
      );
      if (!latest) {
        // Fail closed: a canonical Task Set whose latest Version row is missing
        // must not silently fall through to a legacy-only write and leave
        // latestVersion stale.
        return {
          ok: false,
          code: "storage",
          message: "The Task Set version is missing — the model was added to these results only.",
        };
      }
      const nextVersionNumber = currentTaskSet.latestVersion + 1;
      const canonicalUpdated: EvaluationSuite = {
        ...suite,
        modelSlots: [...suite.modelSlots, { ...input.slot }],
        version: nextVersionNumber,
        updatedAt: input.now,
      };
      const taskSetRecord = suiteToTaskSetRecord({
        ...canonicalUpdated,
        revision: currentTaskSet.revision,
      });
      const nextVersion = {
        ...latest,
        version: nextVersionNumber,
        defaultModelSlots: [...latest.defaultModelSlots, { ...input.slot }],
        createdAt: input.now,
      };
      try {
        await repo.saveSuiteAndTaskSetVersion({
          suite: canonicalUpdated,
          expectedSuiteRevision: suite.revision,
          taskSetRecord,
          taskSetVersion: nextVersion,
          expectedTaskSetRevision: currentTaskSet.revision,
          taskSetRepository: taskSetRepo,
        });
        return { ok: true, suiteVersion: nextVersionNumber };
      } catch (err) {
        if (err instanceof StorageError && err.kind === "conflict") {
          return {
            ok: false,
            code: "conflict",
            message: "Suite was modified elsewhere — the model was added to these results only.",
          };
        }
        return { ok: false, code: "storage", message: suiteStorageMessage(err) };
      }
    }
  }

  // Legacy Suite compatibility write (no canonical Task Set).
  const updated: EvaluationSuite = {
    ...suite,
    modelSlots: [...suite.modelSlots, { ...input.slot }],
    version: suite.version + 1,
    updatedAt: input.now,
  };

  try {
    await repo.saveSuite(updated, suite.revision);
  } catch (err) {
    if (err instanceof StorageError && err.kind === "conflict") {
      return {
        ok: false,
        code: "conflict",
        message: "Suite was modified elsewhere — the model was added to these results only.",
      };
    }
    return { ok: false, code: "storage", message: suiteStorageMessage(err) };
  }

  return { ok: true, suiteVersion: updated.version };
}

/** Map a raw repository error to user-facing storage copy. */
function suiteStorageMessage(err: unknown): string {
  if (err instanceof StorageError) {
    if (err.kind === "unavailable" || err.kind === "blocked" || err.kind === "versionchange") {
      return "Storage is unavailable — the model was added to these results only.";
    }
    if (err.kind === "quota") {
      return "Storage is full — the model was added to these results only.";
    }
  }
  return "The suite could not be saved — the model was added to these results only.";
}
