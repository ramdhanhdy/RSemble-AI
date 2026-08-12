// =============================================================================
// RSemble AI — Suite package import (content authoring, not restore)
//
// A suite package is a hand-authorable, shareable JSON file that creates NEW
// entities on import — the authoring counterpart to the Workbench Archive
// (which is backup/restore: identity-preserving, skip-on-conflict). Follows
// the eval-platform convention (LangSmith/promptfoo/DeepEval): the file
// carries semantic content; the importer mints database identity.
//
// Format (suite-package v1):
//   { kind: "rsemble-suite-package", schemaVersion: 1,
//     name, description?, tasks[], modelSlots[], defaultJudge,
//     defaultEvaluation?, profiles?[] }
//
// Identity semantics: provided ids are kept when free and suffixed on
// conflict, so re-importing the same file yields a second suite instead of a
// silent skip. Embedded profiles get fresh ids with every in-package
// reference remapped; tasks may also pin EXISTING local profiles by id.
// Imports must pass the structural record guards; execution readiness is
// reported, never required (draft tolerance, spec §10.2).
// =============================================================================

import { isRecord } from "../persistence/run-types";
import {
  isEvaluationRubric,
  isEvaluationSuite,
  isTaskVerification,
  type EvaluationRubric,
  type RubricVersionRef,
  type EvaluationSelection,
  type EvaluationSuite,
  type EvaluationTask,
  type RubricRecord,
} from "./evaluation-types";
import { validateSuiteForExecution } from "./suite-validation";
import { validateRubric } from "./evaluation-rubric";
import type { CriticRef, ProviderId } from "../providers/types";
import type { ModelSlot } from "../../studio-data";

export const SUITE_PACKAGE_KIND = "rsemble-suite-package";

// --- Limits (mirroring archive import discipline) --------------------------------

export const SUITE_PACKAGE_LIMITS = {
  BYTES: 8388608,
  TASKS: 500,
  CRITERIA: 100,
  RUBRICS: 50,
  DEPTH: 32,
  STRING_BYTES: 8388608,
  ID_PATTERN: /^[A-Za-z0-9._:-]{1,128}$/,
} as const;

// --- Package shapes (authoring surface — identity fields optional) ------------------

export interface SuitePackageTask {
  id?: string;
  title: string;
  prompt: string;
  systemPrompt?: string;
  evaluation?: EvaluationTask["evaluation"];
  judgeInstructionOverride?: string;
  verification?: EvaluationTask["verification"];
}

export interface SuitePackageModelSlot {
  id?: string;
  providerId: ProviderId;
  provider: string;
  model: string;
  slug: string;
  enabled?: boolean;
}

export interface SuitePackageRubric {
  id?: string;
  name: string;
  description?: string;
  judgeInstruction?: string;
  criteria: EvaluationRubric["criteria"];
  requirementGroups?: EvaluationRubric["requirementGroups"];
  complianceInfluence?: EvaluationRubric["complianceInfluence"];
}

export interface SuitePackageV1 {
  kind: typeof SUITE_PACKAGE_KIND;
  schemaVersion: 1;
  name: string;
  description?: string;
  tasks: SuitePackageTask[];
  modelSlots: SuitePackageModelSlot[];
  defaultJudge: CriticRef;
  defaultEvaluation?: EvaluationSelection;
  profiles?: SuitePackageRubric[];
}

export interface ImportedSuitePackage {
  suite: EvaluationSuite;
  profiles: Array<{ record: RubricRecord; profile: EvaluationRubric }>;
  /** True when the imported suite passes validateSuiteForExecution. */
  executionReady: boolean;
  /** Human-readable notes (e.g. conflict suffixes, non-executable draft). */
  notes: string[];
}

// --- Byte/depth walk ----------------------------------------------------------------

export function validateSuitePackageBytes(byteLength: number): string | null {
  if (byteLength > SUITE_PACKAGE_LIMITS.BYTES) {
    return `Suite package is too large — the limit is 8 MiB (${SUITE_PACKAGE_LIMITS.BYTES} bytes).`;
  }
  return null;
}

function walkLimits(value: unknown, depth = 0): string | null {
  if (depth > SUITE_PACKAGE_LIMITS.DEPTH) {
    return `Suite package nests deeper than ${SUITE_PACKAGE_LIMITS.DEPTH} levels.`;
  }
  if (typeof value === "string" && value.length > SUITE_PACKAGE_LIMITS.STRING_BYTES) {
    return `Suite package contains a string longer than ${SUITE_PACKAGE_LIMITS.STRING_BYTES} characters.`;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const violation = walkLimits(item, depth + 1);
      if (violation) return violation;
    }
  } else if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      const violation = walkLimits(value[key], depth + 1);
      if (violation) return violation;
    }
  }
  return null;
}

// --- Parsing -----------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isValidPackageTask(v: unknown, where: string, errors: string[]): v is SuitePackageTask {
  if (!isRecord(v)) {
    errors.push(`${where} must be an object.`);
    return false;
  }
  if (!isNonEmptyString(v.title)) errors.push(`${where}.title must be a non-empty string.`);
  if (!isNonEmptyString(v.prompt)) errors.push(`${where}.prompt must be a non-empty string.`);
  if (
    v.id !== undefined &&
    (typeof v.id !== "string" || !SUITE_PACKAGE_LIMITS.ID_PATTERN.test(v.id))
  ) {
    errors.push(`${where}.id must match ${SUITE_PACKAGE_LIMITS.ID_PATTERN}.`);
  }
  if (v.systemPrompt !== undefined && typeof v.systemPrompt !== "string") {
    errors.push(`${where}.systemPrompt must be a string.`);
  }
  if (v.judgeInstructionOverride !== undefined && typeof v.judgeInstructionOverride !== "string") {
    errors.push(`${where}.judgeInstructionOverride must be a string.`);
  }
  if (v.verification !== undefined && !isTaskVerification(v.verification)) {
    errors.push(`${where}.verification has an unknown verifier kind.`);
  }
  return errors.length === 0;
}

function isValidPackageSlot(
  v: unknown,
  where: string,
  errors: string[],
): v is SuitePackageModelSlot {
  if (!isRecord(v)) {
    errors.push(`${where} must be an object.`);
    return false;
  }
  if (!isNonEmptyString(v.providerId)) errors.push(`${where}.providerId is required.`);
  if (typeof v.provider !== "string") errors.push(`${where}.provider must be a string.`);
  if (typeof v.model !== "string") errors.push(`${where}.model must be a string.`);
  if (!isNonEmptyString(v.slug)) errors.push(`${where}.slug is required.`);
  if (v.enabled !== undefined && typeof v.enabled !== "boolean") {
    errors.push(`${where}.enabled must be a boolean.`);
  }
  return errors.length === 0;
}

function isValidPackageRubric(
  v: unknown,
  where: string,
  errors: string[],
): v is SuitePackageRubric {
  if (!isRecord(v)) {
    errors.push(`${where} must be an object.`);
    return false;
  }
  if (!isNonEmptyString(v.name)) errors.push(`${where}.name is required.`);
  if (!Array.isArray(v.criteria) || v.criteria.length === 0) {
    errors.push(`${where}.criteria must be a non-empty array.`);
  }
  return errors.length === 0;
}

/** Structural parse of the raw JSON value into a typed package (no normalization). */
export function parseSuitePackage(
  value: unknown,
): { ok: true; pkg: SuitePackageV1 } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["Suite package must be a JSON object."] };
  }
  if (value.kind !== SUITE_PACKAGE_KIND) {
    errors.push(`Suite package kind must be "${SUITE_PACKAGE_KIND}".`);
  }
  if (value.schemaVersion !== 1) {
    errors.push("Suite package schemaVersion must be 1.");
  }
  if (!isNonEmptyString(value.name)) errors.push("name must be a non-empty string.");
  if (value.description !== undefined && typeof value.description !== "string") {
    errors.push("description must be a string.");
  }
  const walkViolation = walkLimits(value);
  if (walkViolation) return { ok: false, errors: [walkViolation] };

  const tasksRaw = Array.isArray(value.tasks) ? value.tasks : null;
  const slotsRaw = Array.isArray(value.modelSlots) ? value.modelSlots : null;
  const rubricsRaw =
    value.profiles === undefined || Array.isArray(value.profiles) ? (value.profiles ?? []) : null;
  if (tasksRaw === null) errors.push("tasks must be an array.");
  if (slotsRaw === null) errors.push("modelSlots must be an array.");
  if (rubricsRaw === null) errors.push("profiles must be an array when present.");
  if (tasksRaw && tasksRaw.length > SUITE_PACKAGE_LIMITS.TASKS) {
    errors.push(
      `tasks has ${tasksRaw.length} entries — the limit is ${SUITE_PACKAGE_LIMITS.TASKS}.`,
    );
  }
  if (rubricsRaw && rubricsRaw.length > SUITE_PACKAGE_LIMITS.RUBRICS) {
    errors.push(
      `profiles has ${rubricsRaw.length} entries — the limit is ${SUITE_PACKAGE_LIMITS.RUBRICS}.`,
    );
  }
  if (errors.length > 0) return { ok: false, errors };

  tasksRaw!.forEach((t, i) => isValidPackageTask(t, `tasks[${i}]`, errors));
  slotsRaw!.forEach((s, i) => isValidPackageSlot(s, `modelSlots[${i}]`, errors));
  rubricsRaw!.forEach((p, i) => {
    if (!isValidPackageRubric(p, `profiles[${i}]`, errors)) return;
    const rubric = p as SuitePackageRubric;
    if (rubric.criteria.length > SUITE_PACKAGE_LIMITS.CRITERIA) {
      errors.push(`profiles[${i}].criteria exceeds the limit of ${SUITE_PACKAGE_LIMITS.CRITERIA}.`);
    }
  });

  const judge = value.defaultJudge;
  if (!isRecord(judge) || typeof judge.providerId !== "string" || typeof judge.model !== "string") {
    errors.push("defaultJudge must be an object with providerId and model.");
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    pkg: {
      kind: SUITE_PACKAGE_KIND,
      schemaVersion: 1,
      name: (value.name as string).trim(),
      description: typeof value.description === "string" ? value.description : "",
      tasks: tasksRaw as SuitePackageTask[],
      modelSlots: slotsRaw as SuitePackageModelSlot[],
      defaultJudge: judge as CriticRef,
      defaultEvaluation: value.defaultEvaluation as EvaluationSelection | undefined,
      profiles: rubricsRaw as SuitePackageRubric[],
    },
  };
}

// --- Normalization + identity remapping ------------------------------------------------------

export interface NormalizeSuitePackageOptions {
  /** Ids already taken in the local store (suites and profiles). */
  takenIds: ReadonlySet<string>;
  /** Ids of profiles that already exist locally (tasks may pin them). */
  existingRubricIds: ReadonlySet<string>;
  generateId?: () => string;
  now?: () => number;
}

/**
 * Normalize a parsed package into persistable records. Ids are minted for
 * missing entries and suffixed on conflict; embedded rubric references are
 * remapped to the minted ids. Errors when a task pins a rubric that is
 * neither embedded nor present locally.
 */
export function normalizeSuitePackage(
  pkg: SuitePackageV1,
  opts: NormalizeSuitePackageOptions,
): { ok: true; result: ImportedSuitePackage } | { ok: false; errors: string[] } {
  // Arrow wrapper required: Node's webcrypto rejects an unbound reference.
  const generateId = opts.generateId ?? (() => crypto.randomUUID());
  const now = opts.now ?? Date.now;
  const notes: string[] = [];
  const taken = new Set(opts.takenIds);

  const mintId = (preferred: string | undefined, label: string): string => {
    let candidate =
      preferred && SUITE_PACKAGE_LIMITS.ID_PATTERN.test(preferred) ? preferred : generateId();
    if (taken.has(candidate)) {
      const base = candidate;
      candidate = `${base}-${generateId().slice(0, 8)}`;
      notes.push(`${label} id "${base}" already exists — imported as "${candidate}".`);
    }
    taken.add(candidate);
    return candidate;
  };

  // Rubrics first — tasks and the suite default pin them by id.
  const rubricIdMap = new Map<string, string>();
  const profiles: Array<{ record: RubricRecord; profile: EvaluationRubric }> = [];
  const errors: string[] = [];
  const timestamp = now();
  for (const pkgRubric of pkg.profiles ?? []) {
    const minted = mintId(pkgRubric.id, "Rubric");
    if (pkgRubric.id && pkgRubric.id !== minted) {
      rubricIdMap.set(pkgRubric.id, minted);
    } else {
      rubricIdMap.set(pkgRubric.id ?? minted, minted);
    }
    const rubric: EvaluationRubric = {
      id: minted,
      version: 1,
      name: pkgRubric.name,
      description: pkgRubric.description ?? "",
      judgeInstruction: pkgRubric.judgeInstruction ?? "",
      criteria: pkgRubric.criteria,
      requirementGroups: pkgRubric.requirementGroups,
      complianceInfluence: pkgRubric.complianceInfluence,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    // Authoring-boundary validation FIRST: enforces group membership invariants
    // (every checkId resolves to a binary check, exactly-one membership, no
    // ungrouped binary checks) and yields detailed, actionable errors. The
    // structural guard below runs as the final shape check; because the guard
    // also rejects binary criteria with undefined requirementGroups (spec §19),
    // it must not preempt the detailed authoring message.
    const rubricErrors = validateRubric(rubric);
    if (rubricErrors.length > 0) {
      errors.push(`Rubric "${pkgRubric.name}" is invalid: ${rubricErrors.join("; ")}`);
      continue;
    }
    if (!isEvaluationRubric(rubric)) {
      errors.push(
        `Rubric "${pkgRubric.name}" fails the record guard — check criteria anchors and weights (a kind:"gate" criterion is not supported in this version; author it as a binary check or wait for gate support).`,
      );
      continue;
    }
    profiles.push({
      record: {
        id: minted,
        revision: 0,
        latestVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: null,
      },
      profile: rubric,
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  const remapRef = (ref: RubricVersionRef, where: string): RubricVersionRef | null => {
    if (rubricIdMap.has(ref.id)) {
      return { id: rubricIdMap.get(ref.id)!, version: 1 };
    }
    if (opts.existingRubricIds.has(ref.id)) {
      return ref; // pins an existing local rubric — left untouched
    }
    errors.push(
      `${where} pins rubric "${ref.id}" v${ref.version}, which is neither embedded in the package nor present locally.`,
    );
    return null;
  };

  const remapSelection = (
    selection: EvaluationTask["evaluation"] | EvaluationSelection | undefined,
    where: string,
  ): EvaluationTask["evaluation"] | EvaluationSelection => {
    if (!selection) return { kind: "inherit" };
    if (selection.kind === "profile") {
      const remapped = remapRef(selection.profile, where);
      if (!remapped) return selection;
      return { kind: "profile", profile: remapped };
    }
    return selection;
  };

  const tasks: EvaluationTask[] = pkg.tasks.map((t, i) => ({
    id: mintId(t.id, "Task"),
    title: t.title,
    prompt: t.prompt,
    systemPrompt: t.systemPrompt ?? "",
    evaluation: remapSelection(
      t.evaluation,
      `tasks[${i}].evaluation`,
    ) as EvaluationTask["evaluation"],
    judgeInstructionOverride: t.judgeInstructionOverride ?? "",
    order: i,
    ...(t.verification ? { verification: t.verification } : {}),
  }));
  const modelSlots: ModelSlot[] = pkg.modelSlots.map((s) => ({
    id: mintId(s.id, "Model slot"),
    providerId: s.providerId,
    provider: s.provider,
    model: s.model,
    slug: s.slug,
    enabled: s.enabled ?? true,
  }));
  // Suite defaults are EvaluationSelection (holistic | rubric) — "inherit"
  // exists only at task level.
  const defaultEvaluation: EvaluationSelection = pkg.defaultEvaluation
    ? (remapSelection(pkg.defaultEvaluation, "defaultEvaluation") as EvaluationSelection)
    : { kind: "holistic" };
  if (errors.length > 0) return { ok: false, errors };

  const suite: EvaluationSuite = {
    id: mintId(undefined, "Suite"),
    revision: 0,
    version: 1,
    name: pkg.name,
    description: pkg.description ?? "",
    tasks,
    modelSlots,
    defaultJudge: pkg.defaultJudge,
    defaultEvaluation,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
  };
  if (!isEvaluationSuite(suite)) {
    return { ok: false, errors: ["The normalized suite fails the record guard."] };
  }

  const gate = validateSuiteForExecution(suite);
  if (!gate.valid) {
    notes.push(
      `Imported as a draft — not ready to run (${gate.errors[0]?.message ?? "execution validation failed"}).`,
    );
  }
  return {
    ok: true,
    result: { suite, profiles, executionReady: gate.valid, notes },
  };
}
