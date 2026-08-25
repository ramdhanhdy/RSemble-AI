// =============================================================================
// RSemble AI — Suite package import (persistence writer)
//
// Writes a normalized suite package (suite-package.ts) into the database in
// one transaction: embedded rubrics (record + version 1) and the suite.
// Unlike importWorkbenchArchive this NEVER skips — every import creates new
// entities; identity conflicts were already suffixed during normalization.
// =============================================================================

import { type RSembleEvaluationDB, classifyStorageError, StorageError } from "./database";
import type { ImportedSuitePackage } from "../evaluations/suite-package";

export interface SuitePackageImportResult {
  suiteId: string;
  rubricIds: string[];
  taskIds: string[];
}

export async function importSuitePackage(
  db: RSembleEvaluationDB,
  imported: ImportedSuitePackage,
): Promise<SuitePackageImportResult> {
  db.assertWritable();
  try {
    return await db.transaction(
      "rw",
      db.suites,
      db.profiles,
      db.profileVersions,
      db.tasks,
      db.taskVersions,
      async () => {
        const rubricIds: string[] = [];
        for (const { record, profile: rubric } of imported.profiles) {
          const existing = await db.profiles.get(record.id);
          if (existing) {
            // Normalization suffixed conflicts, so this is unreachable in
            // practice — kept as the transactional hard floor.
            throw new StorageError("conflict", `Rubric ${record.id} already exists`);
          }
          await db.profiles.put({
            id: record.id,
            record,
            revision: record.revision,
            latestVersion: record.latestVersion,
            updatedAt: record.updatedAt,
            archivedAt: record.archivedAt,
          });
          await db.profileVersions.put({
            id: rubric.id,
            version: rubric.version,
            profile: rubric,
            updatedAt: rubric.updatedAt,
          });
          rubricIds.push(record.id);
        }

        const taskIds: string[] = [];
        for (const { record, version } of imported.tasks) {
          const existing = await db.tasks.get(record.id);
          if (existing) {
            throw new StorageError("conflict", `Task ${record.id} already exists`);
          }
          await db.tasks.put({
            id: record.id,
            record,
            latestVersion: record.latestVersion,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            archivedAt: record.archivedAt,
            origin: record.origin,
            revision: record.revision,
          });
          await db.taskVersions.put({
            taskId: version.taskId,
            version: version.version,
            version_: version,
            createdAt: version.createdAt,
          });
          taskIds.push(record.id);
        }

        const existingSuite = await db.suites.get(imported.suite.id);
        if (existingSuite) {
          throw new StorageError("conflict", `Suite ${imported.suite.id} already exists`);
        }
        await db.suites.put({
          id: imported.suite.id,
          suite: imported.suite,
          revision: imported.suite.revision,
          version: imported.suite.version,
          updatedAt: imported.suite.updatedAt,
          archivedAt: imported.suite.archivedAt,
        });
        return { suiteId: imported.suite.id, rubricIds, taskIds };
      },
    );
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw classifyStorageError(err);
  }
}
