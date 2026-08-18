// =============================================================================
// RSemble AI — Study repository (Dexie-backed + in-memory)
//
// Persists the generic first-party study lifecycle and immutable Policy
// Playbooks (spec §4, §5, §12). Stores: studies, studyTrials, studyAttempts,
// studyObservations, policyPlaybooks. Lab asset stores (labRecipeVersions,
// modelPoolVersions) are read for ref-existence checks but not owned here.
//
// Invariants:
//  - registered payload validation at the repository boundary (exactly one
//    kind: "policy"; unknown kinds/schema versions/prohibited keys rejected
//    before any write);
//  - draft CAS revision; start seals the definition (no mutation after start);
//  - completed immutability (reportRef set, definition/trials/observations
//    frozen — no update path);
//  - trial create requires an in_progress study; seal via internal row
//    revision CAS;
//  - treatment-changing retry = atomic successor trial + Attempt (fromTrial
//    must be sealed, sampleIndex = fromTrial.sampleIndex + 1, from != to);
//  - measurement-only retry = new terminal Observation on the same sealed
//    trial (atomic observationIds update, no new trial);
//  - Policy Playbook create/get immutable (idempotent on byte-equivalent
//    content, no update/delete path);
//  - missing refs rejected (unknown study/trial/parent; playbook studyId and
//    definitionFingerprint must match an existing study);
//  - F1: createTrial / sealTrial reject when the trial's recipeRef or the
//    study's pinned modelPool do not resolve to a stored Lab asset version —
//    a trial cannot seal against missing recipe/pool refs (old Fusion did
//    this at seal time; the generic substrate enforces it at both create and
//    seal);
//  - F2: appendObservation never mutates payload / payloadFingerprint — the
//    trial's payload fingerprint stays valid across measurement-only retries;
//  - archive-only after any paid execution; no ordinary delete API for started
//    evidence; no unarchive API;
//  - no repository method performs provider calls.
// =============================================================================

import { type RSembleEvaluationDB, StorageError, classifyStorageError } from "./database";
import {
  isPolicyReportPayload,
  isPolicyStudyObservation,
  isPolicyStudyRecord,
  isPolicyStudyTrial,
  policyStudyRegistration,
  type PolicyReportPayload,
  type PolicyStudyDefinition,
  type PolicyStudyObservation,
  type PolicyStudyRecord,
  type PolicyStudyTrial,
} from "../studies/policy/policy-study-types";
import { getStudyTypeRegistration } from "../studies/study-registry";
import { fingerprintStudyValue } from "../studies/study-fingerprint";
import { isStudyAttempt, type StudyAttempt } from "../studies/study-types";

// --- Asset ref resolver (F1) --------------------------------------------------

/**
 * Resolves whether a pinned Lab asset version exists. Used by createTrial /
 * sealTrial to reject trials that reference a missing recipe or model-pool
 * version before the trial can seal (F1, spec §12 — old Fusion checked this at
 * seal time). The Dexie factory wires a default resolver that reads the shared
 * Lab asset tables; tests and the in-memory repository may inject a map-backed
 * resolver. When no resolver is available the check is skipped ONLY for the
 * in-memory repository used outside production wiring — the Dexie path always
 * resolves against the canonical Lab stores.
 */
export interface StudyAssetRefResolver {
  recipeVersionExists(recipeId: string, version: number): Promise<boolean>;
  poolVersionExists(poolId: string, version: number): Promise<boolean>;
}

/**
 * Default Dexie resolver: reads the canonical Lab asset tables on the same DB
 * handle. Production wiring (`createStudyRepository(handle.db)`) gets this for
 * free, so F1 is always enforced at runtime.
 */
function defaultDexieResolver(db: RSembleEvaluationDB): StudyAssetRefResolver {
  return {
    async recipeVersionExists(recipeId, version) {
      const row = await db.labRecipeVersions.get([recipeId, version]);
      return row != null;
    },
    async poolVersionExists(poolId, version) {
      const row = await db.modelPoolVersions.get([poolId, version]);
      return row != null;
    },
  };
}

/**
 * F1 check: a trial cannot be created or sealed when its recipeRef or the
 * parent study's pinned modelPool do not resolve to a stored Lab asset version.
 * Matches the old Fusion seal-time recipe-existence check and extends it to the
 * pool pinned on the study definition.
 */
async function assertTrialAssetRefsResolve(
  study: PolicyStudyRecord,
  trialPayload: PolicyStudyTrial["payload"],
  resolver: StudyAssetRefResolver,
): Promise<void> {
  const poolOk = await resolver.poolVersionExists(
    study.definition.modelPool.poolId,
    study.definition.modelPool.version,
  );
  if (!poolOk) {
    throw new StorageError(
      "validation",
      `Model pool ${study.definition.modelPool.poolId} v${study.definition.modelPool.version} referenced by study ${study.id} not found.`,
    );
  }
  if (trialPayload.recipeRef !== null) {
    const recipeOk = await resolver.recipeVersionExists(
      trialPayload.recipeRef.recipeId,
      trialPayload.recipeRef.version,
    );
    if (!recipeOk) {
      throw new StorageError(
        "validation",
        `Recipe ${trialPayload.recipeRef.recipeId} v${trialPayload.recipeRef.version} referenced by trial not found.`,
      );
    }
  }
}

// --- Repository interface -----------------------------------------------------

export interface StudyRepository {
  // Study lifecycle (spec §4.2, §12)
  createStudy(record: PolicyStudyRecord): Promise<void>;
  updateDraftStudy(
    id: string,
    expectedRevision: number,
    next: { definition: PolicyStudyDefinition; title: string },
    updatedAt: number,
  ): Promise<number>;
  getStudy(id: string): Promise<PolicyStudyRecord | null>;
  listStudies(includeArchived?: boolean): Promise<PolicyStudyRecord[]>;
  startStudy(id: string, expectedRevision: number, updatedAt: number): Promise<number>;
  sealStudy(
    id: string,
    expectedRevision: number,
    reportRef: string,
    updatedAt: number,
  ): Promise<number>;
  failStudy(id: string, expectedRevision: number, updatedAt: number): Promise<number>;
  archiveStudy(id: string, expectedRevision: number, archivedAt: number): Promise<number>;
  deleteStudy(id: string, expectedRevision: number): Promise<void>;

  // Trials (spec §4.3, §12)
  createTrial(trial: PolicyStudyTrial): Promise<void>;
  sealTrial(id: string, expectedRevision: number, sealedAt: number): Promise<number>;
  getTrial(id: string): Promise<PolicyStudyTrial | null>;
  listTrials(studyId: string): Promise<PolicyStudyTrial[]>;

  // Attempts (treatment-changing retry, spec §4.3)
  createAttempt(attempt: StudyAttempt, successorTrial: PolicyStudyTrial): Promise<void>;
  listAttempts(studyId: string): Promise<StudyAttempt[]>;

  // Observations (terminal append, spec §4.3)
  appendObservation(observation: PolicyStudyObservation): Promise<void>;
  listObservations(studyId: string): Promise<PolicyStudyObservation[]>;
  listObservationsForTrial(trialId: string): Promise<PolicyStudyObservation[]>;

  // Policy Playbook (immutable, spec §5, §12)
  createPlaybook(id: string, playbook: PolicyReportPayload): Promise<void>;
  getPlaybook(id: string): Promise<PolicyReportPayload | null>;
  getPlaybookForStudy(
    studyId: string,
  ): Promise<{ id: string; playbook: PolicyReportPayload } | null>;
}

// --- Shared helpers -----------------------------------------------------------

function registryFingerprint(definition: PolicyStudyDefinition): string {
  const reg = getStudyTypeRegistration("policy");
  if (!reg) throw new StorageError("validation", "Policy study type not registered");
  return reg.fingerprintDefinition(definition);
}

function validateStudyRecord(record: PolicyStudyRecord): void {
  if (!isPolicyStudyRecord(record)) {
    throw new StorageError("validation", "Invalid policy study record");
  }
}

function validateTrial(trial: PolicyStudyTrial): void {
  if (!isPolicyStudyTrial(trial)) {
    throw new StorageError("validation", "Invalid policy study trial");
  }
}

function validateObservation(observation: PolicyStudyObservation): void {
  if (!isPolicyStudyObservation(observation)) {
    throw new StorageError("validation", "Invalid policy study observation");
  }
}

function validatePlaybook(playbook: PolicyReportPayload): void {
  if (!isPolicyReportPayload(playbook)) {
    throw new StorageError("validation", "Invalid policy playbook");
  }
}

function playbookDigest(playbook: PolicyReportPayload): string {
  return fingerprintStudyValue(playbook);
}

// --- Dexie implementation -----------------------------------------------------

export function createStudyRepository(
  db: RSembleEvaluationDB,
  resolver: StudyAssetRefResolver = defaultDexieResolver(db),
): StudyRepository {
  // --- Study lifecycle ------------------------------------------------------

  async function createStudy(record: PolicyStudyRecord): Promise<void> {
    validateStudyRecord(record);
    db.assertWritable();
    try {
      await db.transaction("rw", db.studies, async () => {
        if (record.confirmationOf !== null) {
          const parent = await db.studies.get(record.confirmationOf);
          if (!parent) {
            throw new StorageError(
              "validation",
              `Confirmation parent ${record.confirmationOf} not found`,
            );
          }
        }
        const existing = await db.studies.get(record.id);
        if (existing) {
          throw new StorageError("conflict", `Study ${record.id} already exists`);
        }
        await db.studies.put({
          id: record.id,
          record,
          kind: record.kind,
          status: record.status,
          claimLevel: record.claimLevel,
          confirmationOf: record.confirmationOf,
          revision: record.revision,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          archivedAt: record.archivedAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getStudy(id: string): Promise<PolicyStudyRecord | null> {
    try {
      const row = await db.studies.get(id);
      if (!row) return null;
      return isPolicyStudyRecord(row.record) ? row.record : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listStudies(includeArchived = false): Promise<PolicyStudyRecord[]> {
    try {
      const rows = await db.studies.toArray();
      return rows
        .map((r) => r.record)
        .filter((r): r is PolicyStudyRecord => isPolicyStudyRecord(r))
        .filter((r) => includeArchived || r.archivedAt === null)
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function updateDraftStudy(
    id: string,
    expectedRevision: number,
    next: { definition: PolicyStudyDefinition; title: string },
    updatedAt: number,
  ): Promise<number> {
    if (!policyStudyRegistration.validateDefinition(next.definition)) {
      throw new StorageError("validation", "Invalid policy study definition");
    }
    if (typeof next.title !== "string" || next.title.trim().length === 0) {
      throw new StorageError("validation", "Study title must be a non-blank string");
    }
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.studies, async () => {
        const row = await db.studies.get(id);
        if (!row) throw new StorageError("conflict", `Study ${id} not found`);
        const record = isPolicyStudyRecord(row.record) ? row.record : null;
        if (!record) throw new StorageError("validation", `Study ${id} record corrupted`);
        if (row.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${row.revision}`,
          );
        }
        if (record.status !== "draft") {
          throw new StorageError(
            "conflict",
            `Study ${id} is not a draft — definition is sealed after start`,
          );
        }
        const updated: PolicyStudyRecord = {
          ...record,
          revision: newRevision,
          title: next.title,
          definition: next.definition,
          definitionFingerprint: registryFingerprint(next.definition),
          updatedAt,
        };
        validateStudyRecord(updated);
        await db.studies.put({
          id: row.id,
          record: updated,
          kind: updated.kind,
          status: updated.status,
          claimLevel: updated.claimLevel,
          confirmationOf: updated.confirmationOf,
          revision: newRevision,
          createdAt: row.createdAt,
          updatedAt,
          archivedAt: row.archivedAt,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function startStudy(
    id: string,
    expectedRevision: number,
    updatedAt: number,
  ): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.studies, async () => {
        const row = await db.studies.get(id);
        if (!row) throw new StorageError("conflict", `Study ${id} not found`);
        const record = isPolicyStudyRecord(row.record) ? row.record : null;
        if (!record) throw new StorageError("validation", `Study ${id} record corrupted`);
        if (row.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${row.revision}`,
          );
        }
        if (record.status !== "draft") {
          throw new StorageError("conflict", `Study ${id} is not a draft`);
        }
        const updated: PolicyStudyRecord = {
          ...record,
          status: "in_progress",
          revision: newRevision,
          updatedAt,
        };
        validateStudyRecord(updated);
        await db.studies.put({
          id: row.id,
          record: updated,
          kind: updated.kind,
          status: "in_progress",
          claimLevel: updated.claimLevel,
          confirmationOf: updated.confirmationOf,
          revision: newRevision,
          createdAt: row.createdAt,
          updatedAt,
          archivedAt: row.archivedAt,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function sealStudy(
    id: string,
    expectedRevision: number,
    reportRef: string,
    updatedAt: number,
  ): Promise<number> {
    if (typeof reportRef !== "string" || reportRef.trim().length === 0) {
      throw new StorageError("validation", "reportRef must be a non-blank string");
    }
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.studies, async () => {
        const row = await db.studies.get(id);
        if (!row) throw new StorageError("conflict", `Study ${id} not found`);
        const record = isPolicyStudyRecord(row.record) ? row.record : null;
        if (!record) throw new StorageError("validation", `Study ${id} record corrupted`);
        if (row.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${row.revision}`,
          );
        }
        if (record.status !== "in_progress") {
          throw new StorageError(
            "conflict",
            `Study ${id} is not in_progress (status=${record.status})`,
          );
        }
        const updated: PolicyStudyRecord = {
          ...record,
          status: "completed",
          reportRef,
          revision: newRevision,
          updatedAt,
        };
        validateStudyRecord(updated);
        await db.studies.put({
          id: row.id,
          record: updated,
          kind: updated.kind,
          status: "completed",
          claimLevel: updated.claimLevel,
          confirmationOf: updated.confirmationOf,
          revision: newRevision,
          createdAt: row.createdAt,
          updatedAt,
          archivedAt: row.archivedAt,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function failStudy(
    id: string,
    expectedRevision: number,
    updatedAt: number,
  ): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.studies, async () => {
        const row = await db.studies.get(id);
        if (!row) throw new StorageError("conflict", `Study ${id} not found`);
        const record = isPolicyStudyRecord(row.record) ? row.record : null;
        if (!record) throw new StorageError("validation", `Study ${id} record corrupted`);
        if (row.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${row.revision}`,
          );
        }
        if (record.status !== "in_progress") {
          throw new StorageError(
            "conflict",
            `Study ${id} is not in_progress (status=${record.status})`,
          );
        }
        const updated: PolicyStudyRecord = {
          ...record,
          status: "failed",
          revision: newRevision,
          updatedAt,
        };
        validateStudyRecord(updated);
        await db.studies.put({
          id: row.id,
          record: updated,
          kind: updated.kind,
          status: "failed",
          claimLevel: updated.claimLevel,
          confirmationOf: updated.confirmationOf,
          revision: newRevision,
          createdAt: row.createdAt,
          updatedAt,
          archivedAt: row.archivedAt,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function archiveStudy(
    id: string,
    expectedRevision: number,
    archivedAt: number,
  ): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.studies, async () => {
        const row = await db.studies.get(id);
        if (!row) throw new StorageError("conflict", `Study ${id} not found`);
        const record = isPolicyStudyRecord(row.record) ? row.record : null;
        if (!record) throw new StorageError("validation", `Study ${id} record corrupted`);
        if (row.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${row.revision}`,
          );
        }
        if (record.status === "draft") {
          throw new StorageError(
            "conflict",
            `Study ${id} is a draft — drafts are deletable, not archive-only`,
          );
        }
        if (record.status === "archived") {
          throw new StorageError("conflict", `Study ${id} is already archived`);
        }
        const updated: PolicyStudyRecord = {
          ...record,
          status: "archived",
          archivedAt,
          revision: newRevision,
          updatedAt: archivedAt,
        };
        validateStudyRecord(updated);
        await db.studies.put({
          id: row.id,
          record: updated,
          kind: updated.kind,
          status: "archived",
          claimLevel: updated.claimLevel,
          confirmationOf: updated.confirmationOf,
          revision: newRevision,
          createdAt: row.createdAt,
          updatedAt: archivedAt,
          archivedAt,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function deleteStudy(id: string, expectedRevision: number): Promise<void> {
    db.assertWritable();
    try {
      await db.transaction(
        "rw",
        db.studies,
        db.studyTrials,
        db.studyObservations,
        db.studyAttempts,
        async () => {
          const row = await db.studies.get(id);
          if (!row) throw new StorageError("conflict", `Study ${id} not found`);
          const record = isPolicyStudyRecord(row.record) ? row.record : null;
          if (!record) throw new StorageError("validation", `Study ${id} record corrupted`);
          if (row.revision !== expectedRevision) {
            throw new StorageError(
              "conflict",
              `Stale revision: expected ${expectedRevision}, got ${row.revision}`,
            );
          }
          if (record.status !== "draft") {
            throw new StorageError(
              "conflict",
              `Study ${id} is started evidence — archive-only, cannot delete`,
            );
          }
          await db.studies.delete(id);
          // Defensive: a draft cannot have children, but clear any strays so the
          // delete is total and never leaves orphaned evidence.
          await db.studyTrials.where("studyId").equals(id).delete();
          await db.studyObservations.where("studyId").equals(id).delete();
          await db.studyAttempts.where("studyId").equals(id).delete();
        },
      );
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  // --- Trials ---------------------------------------------------------------

  async function createTrial(trial: PolicyStudyTrial): Promise<void> {
    validateTrial(trial);
    db.assertWritable();
    try {
      await db.transaction(
        "rw",
        db.studies,
        db.studyTrials,
        db.labRecipeVersions,
        db.modelPoolVersions,
        async () => {
          const studyRow = await db.studies.get(trial.studyId);
          if (!studyRow) {
            throw new StorageError("conflict", `Study ${trial.studyId} not found`);
          }
          const study = isPolicyStudyRecord(studyRow.record) ? studyRow.record : null;
          if (!study) {
            throw new StorageError("validation", `Study ${trial.studyId} record corrupted`);
          }
          if (study.status !== "in_progress") {
            throw new StorageError(
              "conflict",
              `Study ${trial.studyId} is not in_progress (status=${study.status})`,
            );
          }
          // F1: reject missing recipe/pool refs before the trial can seal.
          await assertTrialAssetRefsResolve(study, trial.payload, resolver);
          const existing = await db.studyTrials.get(trial.id);
          if (existing) {
            throw new StorageError("conflict", `Trial ${trial.id} already exists`);
          }
          await db.studyTrials.put({
            id: trial.id,
            trial,
            studyId: trial.studyId,
            status: trial.status,
            sampleIndex: trial.sampleIndex,
            revision: 0,
            createdAt: trial.createdAt,
            sealedAt: trial.sealedAt,
          });
        },
      );
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function sealTrial(
    id: string,
    expectedRevision: number,
    sealedAt: number,
  ): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction(
        "rw",
        db.studies,
        db.studyTrials,
        db.labRecipeVersions,
        db.modelPoolVersions,
        async () => {
          const row = await db.studyTrials.get(id);
          if (!row) throw new StorageError("conflict", `Trial ${id} not found`);
          const trial = isPolicyStudyTrial(row.trial) ? row.trial : null;
          if (!trial) throw new StorageError("validation", `Trial ${id} record corrupted`);
          if (trial.status !== "in_progress") {
            throw new StorageError("conflict", `Trial ${id} is already sealed`);
          }
          if (row.revision !== expectedRevision) {
            throw new StorageError(
              "conflict",
              `Stale revision: expected ${expectedRevision}, got ${row.revision}`,
            );
          }
          // F1: re-verify recipe/pool refs resolve before sealing. The study
          // is loaded for its pinned modelPool ref (and to confirm the trial
          // still belongs to an in_progress study).
          const studyRow = await db.studies.get(trial.studyId);
          if (!studyRow) {
            throw new StorageError("conflict", `Study ${trial.studyId} not found`);
          }
          const study = isPolicyStudyRecord(studyRow.record) ? studyRow.record : null;
          if (!study) {
            throw new StorageError("validation", `Study ${trial.studyId} record corrupted`);
          }
          await assertTrialAssetRefsResolve(study, trial.payload, resolver);
          const sealed: PolicyStudyTrial = { ...trial, status: "sealed", sealedAt };
          validateTrial(sealed);
          await db.studyTrials.put({
            id: row.id,
            trial: sealed,
            studyId: row.studyId,
            status: "sealed",
            sampleIndex: row.sampleIndex,
            revision: newRevision,
            createdAt: row.createdAt,
            sealedAt,
          });
        },
      );
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getTrial(id: string): Promise<PolicyStudyTrial | null> {
    try {
      const row = await db.studyTrials.get(id);
      if (!row) return null;
      return isPolicyStudyTrial(row.trial) ? row.trial : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listTrials(studyId: string): Promise<PolicyStudyTrial[]> {
    try {
      const rows = await db.studyTrials.where("studyId").equals(studyId).toArray();
      return rows
        .map((r) => r.trial)
        .filter((t): t is PolicyStudyTrial => isPolicyStudyTrial(t))
        .sort((a, b) => a.sampleIndex - b.sampleIndex);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  // --- Attempts (treatment-changing retry) ----------------------------------

  async function createAttempt(
    attempt: StudyAttempt,
    successorTrial: PolicyStudyTrial,
  ): Promise<void> {
    if (!isStudyAttempt(attempt)) {
      throw new StorageError("validation", "Invalid study attempt");
    }
    validateTrial(successorTrial);
    if (attempt.toTrialId !== successorTrial.id) {
      throw new StorageError("validation", "Attempt toTrialId must match successor trial id");
    }
    if (attempt.studyId !== successorTrial.studyId) {
      throw new StorageError("validation", "Attempt and successor trial must share a studyId");
    }
    db.assertWritable();
    try {
      await db.transaction("rw", db.studies, db.studyTrials, db.studyAttempts, async () => {
        const studyRow = await db.studies.get(attempt.studyId);
        if (!studyRow) {
          throw new StorageError("conflict", `Study ${attempt.studyId} not found`);
        }
        const study = isPolicyStudyRecord(studyRow.record) ? studyRow.record : null;
        if (!study) {
          throw new StorageError("validation", `Study ${attempt.studyId} record corrupted`);
        }
        if (study.status !== "in_progress") {
          throw new StorageError(
            "conflict",
            `Study ${attempt.studyId} is not in_progress (status=${study.status})`,
          );
        }
        const fromRow = await db.studyTrials.get(attempt.fromTrialId);
        if (!fromRow) {
          throw new StorageError("conflict", `Trial ${attempt.fromTrialId} not found`);
        }
        const fromTrial = isPolicyStudyTrial(fromRow.trial) ? fromRow.trial : null;
        if (!fromTrial) {
          throw new StorageError("validation", `Trial ${attempt.fromTrialId} record corrupted`);
        }
        if (fromTrial.status !== "sealed") {
          throw new StorageError(
            "conflict",
            `Trial ${attempt.fromTrialId} is not sealed — cannot replace an in-progress treatment`,
          );
        }
        if (successorTrial.sampleIndex !== fromTrial.sampleIndex + 1) {
          throw new StorageError(
            "conflict",
            `Successor sampleIndex must be ${fromTrial.sampleIndex + 1}, got ${successorTrial.sampleIndex}`,
          );
        }
        const existingAttempt = await db.studyAttempts.get(attempt.id);
        if (existingAttempt) {
          throw new StorageError("conflict", `Attempt ${attempt.id} already exists`);
        }
        const existingSuccessor = await db.studyTrials.get(successorTrial.id);
        if (existingSuccessor) {
          throw new StorageError("conflict", `Trial ${successorTrial.id} already exists`);
        }
        await db.studyAttempts.put({
          id: attempt.id,
          attempt,
          studyId: attempt.studyId,
          fromTrialId: attempt.fromTrialId,
          toTrialId: attempt.toTrialId,
          createdAt: attempt.createdAt,
        });
        await db.studyTrials.put({
          id: successorTrial.id,
          trial: successorTrial,
          studyId: successorTrial.studyId,
          status: successorTrial.status,
          sampleIndex: successorTrial.sampleIndex,
          revision: 0,
          createdAt: successorTrial.createdAt,
          sealedAt: successorTrial.sealedAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function listAttempts(studyId: string): Promise<StudyAttempt[]> {
    try {
      const rows = await db.studyAttempts.where("studyId").equals(studyId).toArray();
      return rows
        .map((r) => r.attempt)
        .filter((a): a is StudyAttempt => isStudyAttempt(a))
        .sort((a, b) => a.createdAt - b.createdAt);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  // --- Observations (terminal append) --------------------------------------

  async function appendObservation(observation: PolicyStudyObservation): Promise<void> {
    validateObservation(observation);
    db.assertWritable();
    try {
      await db.transaction("rw", db.studyTrials, db.studyObservations, async () => {
        const trialRow = await db.studyTrials.get(observation.trialId);
        if (!trialRow) {
          throw new StorageError("conflict", `Trial ${observation.trialId} not found`);
        }
        const trial = isPolicyStudyTrial(trialRow.trial) ? trialRow.trial : null;
        if (!trial) {
          throw new StorageError("validation", `Trial ${observation.trialId} record corrupted`);
        }
        if (trial.status !== "sealed") {
          throw new StorageError(
            "conflict",
            `Trial ${observation.trialId} is not sealed — measurements attach to sealed artifacts`,
          );
        }
        const existing = await db.studyObservations.get(observation.id);
        if (existing) {
          throw new StorageError("conflict", `Observation ${observation.id} already exists`);
        }
        await db.studyObservations.put({
          id: observation.id,
          observation,
          studyId: observation.studyId,
          trialId: observation.trialId,
          status: observation.status,
          createdAt: observation.createdAt,
          finishedAt: observation.finishedAt,
        });
        const updatedTrial: PolicyStudyTrial = {
          ...trial,
          observationIds: [...trial.observationIds, observation.id],
        };
        validateTrial(updatedTrial);
        await db.studyTrials.put({
          id: trialRow.id,
          trial: updatedTrial,
          studyId: trialRow.studyId,
          status: trialRow.status,
          sampleIndex: trialRow.sampleIndex,
          revision: trialRow.revision + 1,
          createdAt: trialRow.createdAt,
          sealedAt: trialRow.sealedAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function listObservations(studyId: string): Promise<PolicyStudyObservation[]> {
    try {
      const rows = await db.studyObservations.where("studyId").equals(studyId).toArray();
      return rows
        .map((r) => r.observation)
        .filter((o): o is PolicyStudyObservation => isPolicyStudyObservation(o))
        .sort((a, b) => a.createdAt - b.createdAt);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listObservationsForTrial(trialId: string): Promise<PolicyStudyObservation[]> {
    try {
      const rows = await db.studyObservations.where("trialId").equals(trialId).toArray();
      return rows
        .map((r) => r.observation)
        .filter((o): o is PolicyStudyObservation => isPolicyStudyObservation(o))
        .sort((a, b) => a.createdAt - b.createdAt);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  // --- Policy Playbook (immutable) -----------------------------------------

  async function createPlaybook(id: string, playbook: PolicyReportPayload): Promise<void> {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new StorageError("validation", "Playbook id must be a non-blank string");
    }
    validatePlaybook(playbook);
    db.assertWritable();
    const digest = playbookDigest(playbook);
    try {
      await db.transaction("rw", db.studies, db.policyPlaybooks, async () => {
        const studyRow = await db.studies.get(playbook.studyId);
        if (!studyRow) {
          throw new StorageError("conflict", `Study ${playbook.studyId} not found for playbook`);
        }
        const study = isPolicyStudyRecord(studyRow.record) ? studyRow.record : null;
        if (!study) {
          throw new StorageError("validation", `Study ${playbook.studyId} record corrupted`);
        }
        if (playbook.definitionFingerprint !== study.definitionFingerprint) {
          throw new StorageError(
            "conflict",
            `Playbook definitionFingerprint does not match study ${playbook.studyId} (provenance mismatch)`,
          );
        }
        const existing = await db.policyPlaybooks.get(id);
        if (existing) {
          // Byte-equivalent idempotency: same id + same digest → no-op.
          if (existing.digest === digest) return;
          throw new StorageError(
            "conflict",
            `Playbook ${id} already exists with different content — playbooks are immutable.`,
          );
        }
        await db.policyPlaybooks.put({
          id,
          playbook,
          studyId: playbook.studyId,
          definitionFingerprint: playbook.definitionFingerprint,
          digest,
          createdAt: playbook.createdAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getPlaybook(id: string): Promise<PolicyReportPayload | null> {
    try {
      const row = await db.policyPlaybooks.get(id);
      if (!row) return null;
      return isPolicyReportPayload(row.playbook) ? row.playbook : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getPlaybookForStudy(
    studyId: string,
  ): Promise<{ id: string; playbook: PolicyReportPayload } | null> {
    try {
      const rows = await db.policyPlaybooks.where("studyId").equals(studyId).toArray();
      if (rows.length === 0) return null;
      const row = rows.sort((a, b) => b.createdAt - a.createdAt)[0];
      const playbook = isPolicyReportPayload(row.playbook) ? row.playbook : null;
      if (!playbook) return null;
      return { id: row.id, playbook };
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  return {
    createStudy,
    updateDraftStudy,
    getStudy,
    listStudies,
    startStudy,
    sealStudy,
    failStudy,
    archiveStudy,
    deleteStudy,
    createTrial,
    sealTrial,
    getTrial,
    listTrials,
    createAttempt,
    listAttempts,
    appendObservation,
    listObservations,
    listObservationsForTrial,
    createPlaybook,
    getPlaybook,
    getPlaybookForStudy,
  };
}

// --- In-memory implementation -------------------------------------------------

interface InMemoryTrialEntry {
  trial: PolicyStudyTrial;
  revision: number;
}

/**
 * In-memory StudyRepository with identical validation and conflict semantics
 * to the Dexie implementation. Used by unit tests and non-persisted
 * orchestration. No provider calls.
 */
export class InMemoryStudyRepository implements StudyRepository {
  private studies = new Map<string, PolicyStudyRecord>();
  private trials = new Map<string, InMemoryTrialEntry>();
  private attempts = new Map<string, StudyAttempt>();
  private observations = new Map<string, PolicyStudyObservation>();
  private playbooks = new Map<
    string,
    { id: string; playbook: PolicyReportPayload; digest: string }
  >();
  private readonly assetResolver: StudyAssetRefResolver | null;

  /**
   * @param assetResolver When provided, createTrial / sealTrial enforce F1
   *   (reject missing recipe/pool refs). When omitted the check is skipped —
   *   use only in tests that do not exercise ref-existence. Production wiring
   *   always supplies a resolver.
   */
  constructor(assetResolver: StudyAssetRefResolver | null = null) {
    this.assetResolver = assetResolver;
  }

  // --- Study lifecycle ------------------------------------------------------

  async createStudy(record: PolicyStudyRecord): Promise<void> {
    validateStudyRecord(record);
    if (record.confirmationOf !== null && !this.studies.has(record.confirmationOf)) {
      throw new StorageError(
        "validation",
        `Confirmation parent ${record.confirmationOf} not found`,
      );
    }
    if (this.studies.has(record.id)) {
      throw new StorageError("conflict", `Study ${record.id} already exists`);
    }
    this.studies.set(record.id, record);
  }

  async getStudy(id: string): Promise<PolicyStudyRecord | null> {
    return this.studies.get(id) ?? null;
  }

  async listStudies(includeArchived = false): Promise<PolicyStudyRecord[]> {
    return [...this.studies.values()]
      .filter((r) => includeArchived || r.archivedAt === null)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async updateDraftStudy(
    id: string,
    expectedRevision: number,
    next: { definition: PolicyStudyDefinition; title: string },
    updatedAt: number,
  ): Promise<number> {
    if (!policyStudyRegistration.validateDefinition(next.definition)) {
      throw new StorageError("validation", "Invalid policy study definition");
    }
    if (typeof next.title !== "string" || next.title.trim().length === 0) {
      throw new StorageError("validation", "Study title must be a non-blank string");
    }
    const record = this.studies.get(id);
    if (!record) throw new StorageError("conflict", `Study ${id} not found`);
    if (record.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${record.revision}`,
      );
    }
    if (record.status !== "draft") {
      throw new StorageError(
        "conflict",
        `Study ${id} is not a draft — definition is sealed after start`,
      );
    }
    const newRevision = expectedRevision + 1;
    const updated: PolicyStudyRecord = {
      ...record,
      revision: newRevision,
      title: next.title,
      definition: next.definition,
      definitionFingerprint: registryFingerprint(next.definition),
      updatedAt,
    };
    validateStudyRecord(updated);
    this.studies.set(id, updated);
    return newRevision;
  }

  async startStudy(id: string, expectedRevision: number, updatedAt: number): Promise<number> {
    const record = this.studies.get(id);
    if (!record) throw new StorageError("conflict", `Study ${id} not found`);
    if (record.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${record.revision}`,
      );
    }
    if (record.status !== "draft") {
      throw new StorageError("conflict", `Study ${id} is not a draft`);
    }
    const newRevision = expectedRevision + 1;
    const updated: PolicyStudyRecord = {
      ...record,
      status: "in_progress",
      revision: newRevision,
      updatedAt,
    };
    validateStudyRecord(updated);
    this.studies.set(id, updated);
    return newRevision;
  }

  async sealStudy(
    id: string,
    expectedRevision: number,
    reportRef: string,
    updatedAt: number,
  ): Promise<number> {
    if (typeof reportRef !== "string" || reportRef.trim().length === 0) {
      throw new StorageError("validation", "reportRef must be a non-blank string");
    }
    const record = this.studies.get(id);
    if (!record) throw new StorageError("conflict", `Study ${id} not found`);
    if (record.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${record.revision}`,
      );
    }
    if (record.status !== "in_progress") {
      throw new StorageError(
        "conflict",
        `Study ${id} is not in_progress (status=${record.status})`,
      );
    }
    const newRevision = expectedRevision + 1;
    const updated: PolicyStudyRecord = {
      ...record,
      status: "completed",
      reportRef,
      revision: newRevision,
      updatedAt,
    };
    validateStudyRecord(updated);
    this.studies.set(id, updated);
    return newRevision;
  }

  async failStudy(id: string, expectedRevision: number, updatedAt: number): Promise<number> {
    const record = this.studies.get(id);
    if (!record) throw new StorageError("conflict", `Study ${id} not found`);
    if (record.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${record.revision}`,
      );
    }
    if (record.status !== "in_progress") {
      throw new StorageError(
        "conflict",
        `Study ${id} is not in_progress (status=${record.status})`,
      );
    }
    const newRevision = expectedRevision + 1;
    const updated: PolicyStudyRecord = {
      ...record,
      status: "failed",
      revision: newRevision,
      updatedAt,
    };
    validateStudyRecord(updated);
    this.studies.set(id, updated);
    return newRevision;
  }

  async archiveStudy(id: string, expectedRevision: number, archivedAt: number): Promise<number> {
    const record = this.studies.get(id);
    if (!record) throw new StorageError("conflict", `Study ${id} not found`);
    if (record.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${record.revision}`,
      );
    }
    if (record.status === "draft") {
      throw new StorageError(
        "conflict",
        `Study ${id} is a draft — drafts are deletable, not archive-only`,
      );
    }
    if (record.status === "archived") {
      throw new StorageError("conflict", `Study ${id} is already archived`);
    }
    const newRevision = expectedRevision + 1;
    const updated: PolicyStudyRecord = {
      ...record,
      status: "archived",
      archivedAt,
      revision: newRevision,
      updatedAt: archivedAt,
    };
    validateStudyRecord(updated);
    this.studies.set(id, updated);
    return newRevision;
  }

  async deleteStudy(id: string, expectedRevision: number): Promise<void> {
    const record = this.studies.get(id);
    if (!record) throw new StorageError("conflict", `Study ${id} not found`);
    if (record.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${record.revision}`,
      );
    }
    if (record.status !== "draft") {
      throw new StorageError(
        "conflict",
        `Study ${id} is started evidence — archive-only, cannot delete`,
      );
    }
    this.studies.delete(id);
    for (const [tid, entry] of this.trials) {
      if (entry.trial.studyId === id) this.trials.delete(tid);
    }
    for (const [aid, attempt] of this.attempts) {
      if (attempt.studyId === id) this.attempts.delete(aid);
    }
    for (const [oid, obs] of this.observations) {
      if (obs.studyId === id) this.observations.delete(oid);
    }
  }

  // --- Trials ---------------------------------------------------------------

  async createTrial(trial: PolicyStudyTrial): Promise<void> {
    validateTrial(trial);
    const study = this.studies.get(trial.studyId);
    if (!study) throw new StorageError("conflict", `Study ${trial.studyId} not found`);
    if (study.status !== "in_progress") {
      throw new StorageError(
        "conflict",
        `Study ${trial.studyId} is not in_progress (status=${study.status})`,
      );
    }
    // F1: reject missing recipe/pool refs before the trial can seal.
    if (this.assetResolver) {
      await assertTrialAssetRefsResolve(study, trial.payload, this.assetResolver);
    }
    if (this.trials.has(trial.id)) {
      throw new StorageError("conflict", `Trial ${trial.id} already exists`);
    }
    this.trials.set(trial.id, { trial, revision: 0 });
  }
  async sealTrial(id: string, expectedRevision: number, sealedAt: number): Promise<number> {
    const entry = this.trials.get(id);
    if (!entry) throw new StorageError("conflict", `Trial ${id} not found`);
    if (entry.trial.status !== "in_progress") {
      throw new StorageError("conflict", `Trial ${id} is already sealed`);
    }
    if (entry.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${entry.revision}`,
      );
    }
    // F1: re-verify recipe/pool refs resolve before sealing.
    if (this.assetResolver) {
      const study = this.studies.get(entry.trial.studyId);
      if (!study) {
        throw new StorageError("conflict", `Study ${entry.trial.studyId} not found`);
      }
      await assertTrialAssetRefsResolve(study, entry.trial.payload, this.assetResolver);
    }
    const newRevision = expectedRevision + 1;
    const sealed: PolicyStudyTrial = { ...entry.trial, status: "sealed", sealedAt };
    validateTrial(sealed);
    this.trials.set(id, { trial: sealed, revision: newRevision });
    return newRevision;
  }

  async getTrial(id: string): Promise<PolicyStudyTrial | null> {
    return this.trials.get(id)?.trial ?? null;
  }

  async listTrials(studyId: string): Promise<PolicyStudyTrial[]> {
    return [...this.trials.values()]
      .map((e) => e.trial)
      .filter((t) => t.studyId === studyId)
      .sort((a, b) => a.sampleIndex - b.sampleIndex);
  }

  // --- Attempts (treatment-changing retry) ----------------------------------

  async createAttempt(attempt: StudyAttempt, successorTrial: PolicyStudyTrial): Promise<void> {
    if (!isStudyAttempt(attempt)) {
      throw new StorageError("validation", "Invalid study attempt");
    }
    validateTrial(successorTrial);
    if (attempt.toTrialId !== successorTrial.id) {
      throw new StorageError("validation", "Attempt toTrialId must match successor trial id");
    }
    if (attempt.studyId !== successorTrial.studyId) {
      throw new StorageError("validation", "Attempt and successor trial must share a studyId");
    }
    const study = this.studies.get(attempt.studyId);
    if (!study) throw new StorageError("conflict", `Study ${attempt.studyId} not found`);
    if (study.status !== "in_progress") {
      throw new StorageError(
        "conflict",
        `Study ${attempt.studyId} is not in_progress (status=${study.status})`,
      );
    }
    const fromEntry = this.trials.get(attempt.fromTrialId);
    if (!fromEntry) {
      throw new StorageError("conflict", `Trial ${attempt.fromTrialId} not found`);
    }
    if (fromEntry.trial.status !== "sealed") {
      throw new StorageError(
        "conflict",
        `Trial ${attempt.fromTrialId} is not sealed — cannot replace an in-progress treatment`,
      );
    }
    if (successorTrial.sampleIndex !== fromEntry.trial.sampleIndex + 1) {
      throw new StorageError(
        "conflict",
        `Successor sampleIndex must be ${fromEntry.trial.sampleIndex + 1}, got ${successorTrial.sampleIndex}`,
      );
    }
    if (this.attempts.has(attempt.id)) {
      throw new StorageError("conflict", `Attempt ${attempt.id} already exists`);
    }
    if (this.trials.has(successorTrial.id)) {
      throw new StorageError("conflict", `Trial ${successorTrial.id} already exists`);
    }
    this.attempts.set(attempt.id, attempt);
    this.trials.set(successorTrial.id, { trial: successorTrial, revision: 0 });
  }

  async listAttempts(studyId: string): Promise<StudyAttempt[]> {
    return [...this.attempts.values()]
      .filter((a) => a.studyId === studyId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  // --- Observations (terminal append) --------------------------------------

  async appendObservation(observation: PolicyStudyObservation): Promise<void> {
    validateObservation(observation);
    const entry = this.trials.get(observation.trialId);
    if (!entry) {
      throw new StorageError("conflict", `Trial ${observation.trialId} not found`);
    }
    if (entry.trial.status !== "sealed") {
      throw new StorageError(
        "conflict",
        `Trial ${observation.trialId} is not sealed — measurements attach to sealed artifacts`,
      );
    }
    if (this.observations.has(observation.id)) {
      throw new StorageError("conflict", `Observation ${observation.id} already exists`);
    }
    this.observations.set(observation.id, observation);
    const updatedTrial: PolicyStudyTrial = {
      ...entry.trial,
      observationIds: [...entry.trial.observationIds, observation.id],
    };
    validateTrial(updatedTrial);
    this.trials.set(observation.trialId, {
      trial: updatedTrial,
      revision: entry.revision + 1,
    });
  }

  async listObservations(studyId: string): Promise<PolicyStudyObservation[]> {
    return [...this.observations.values()]
      .filter((o) => o.studyId === studyId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async listObservationsForTrial(trialId: string): Promise<PolicyStudyObservation[]> {
    return [...this.observations.values()]
      .filter((o) => o.trialId === trialId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  // --- Policy Playbook (immutable) -----------------------------------------

  async createPlaybook(id: string, playbook: PolicyReportPayload): Promise<void> {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new StorageError("validation", "Playbook id must be a non-blank string");
    }
    validatePlaybook(playbook);
    const study = this.studies.get(playbook.studyId);
    if (!study) {
      throw new StorageError("conflict", `Study ${playbook.studyId} not found for playbook`);
    }
    if (playbook.definitionFingerprint !== study.definitionFingerprint) {
      throw new StorageError(
        "conflict",
        `Playbook definitionFingerprint does not match study ${playbook.studyId} (provenance mismatch)`,
      );
    }
    const digest = playbookDigest(playbook);
    const existing = this.playbooks.get(id);
    if (existing) {
      if (existing.digest === digest) return;
      throw new StorageError(
        "conflict",
        `Playbook ${id} already exists with different content — playbooks are immutable.`,
      );
    }
    this.playbooks.set(id, { id, playbook, digest });
  }

  async getPlaybook(id: string): Promise<PolicyReportPayload | null> {
    return this.playbooks.get(id)?.playbook ?? null;
  }

  async getPlaybookForStudy(
    studyId: string,
  ): Promise<{ id: string; playbook: PolicyReportPayload } | null> {
    const matches = [...this.playbooks.values()].filter((p) => p.playbook.studyId === studyId);
    if (matches.length === 0) return null;
    const top = matches.sort((a, b) => b.playbook.createdAt - a.playbook.createdAt)[0];
    return { id: top.id, playbook: top.playbook };
  }
}
