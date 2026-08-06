// =============================================================================
// RSemble AI — Suite package import (persistence writer)
//
// Writes a normalized suite package (suite-package.ts) into the database in
// one transaction: embedded profiles (record + version 1) and the suite.
// Unlike importWorkbenchArchive this NEVER skips — every import creates new
// entities; identity conflicts were already suffixed during normalization.
// =============================================================================

import type { RSembleEvaluationDB } from "./database";
import { classifyStorageError, StorageError } from "./database";
import type { ImportedSuitePackage } from "../evaluations/suite-package";

export interface SuitePackageImportResult {
  suiteId: string;
  profileIds: string[];
}

export async function importSuitePackage(
  db: RSembleEvaluationDB,
  imported: ImportedSuitePackage,
): Promise<SuitePackageImportResult> {
  db.assertWritable();
  try {
    return await db.transaction("rw", db.suites, db.profiles, db.profileVersions, async () => {
      const profileIds: string[] = [];
      for (const { record, profile } of imported.profiles) {
        const existing = await db.profiles.get(record.id);
        if (existing) {
          // Normalization suffixed conflicts, so this is unreachable in
          // practice — kept as the transactional hard floor.
          throw new StorageError("conflict", `Profile ${record.id} already exists`);
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
          id: profile.id,
          version: profile.version,
          profile,
          updatedAt: profile.updatedAt,
        });
        profileIds.push(record.id);
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
      return { suiteId: imported.suite.id, profileIds };
    });
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw classifyStorageError(err);
  }
}
