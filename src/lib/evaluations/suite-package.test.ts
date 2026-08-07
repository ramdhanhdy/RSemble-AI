// =============================================================================
// RSemble AI — Suite package tests
//
// Parse validation, normalization (identity minting, conflict suffixes, ref
// remapping, local-profile pinning, draft notes), and the import writer.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { RSembleEvaluationDB } from "../persistence/database";
import { importSuitePackage } from "../persistence/suite-package-import";
import { InMemoryEvaluationRepository } from "../persistence/evaluation-repository";
import {
  normalizeSuitePackage,
  parseSuitePackage,
  validateSuitePackageBytes,
  type SuitePackageV1,
} from "./suite-package";

function criterion(id: string) {
  return {
    id,
    name: id,
    description: "d",
    weight: 1,
    anchors: { one: "1 — bad", three: "3 — ok", five: "5 — great" },
  };
}

function makePkg(overrides: Partial<SuitePackageV1> = {}): SuitePackageV1 {
  return {
    kind: "rsemble-suite-package",
    schemaVersion: 1,
    name: "Pkg Suite",
    description: "",
    tasks: [
      { title: "T1", prompt: "Do thing one" },
      { id: "task-custom", title: "T2", prompt: "Do thing two", systemPrompt: "Be terse" },
    ],
    modelSlots: [
      { providerId: "openrouter", provider: "A", model: "MA", slug: "a/m1" },
      { providerId: "openrouter", provider: "B", model: "MB", slug: "b/m2", enabled: false },
    ],
    defaultJudge: { providerId: "openrouter", model: "judge-1" },
    ...overrides,
  };
}

describe("validateSuitePackageBytes", () => {
  it("accepts small files and rejects oversized ones", () => {
    expect(validateSuitePackageBytes(1024)).toBeNull();
    expect(validateSuitePackageBytes(9 * 1024 * 1024)).toContain("too large");
  });
});

describe("parseSuitePackage", () => {
  it("parses a minimal valid package", () => {
    const result = parseSuitePackage(makePkg());
    expect(result.ok).toBe(true);
  });

  it("rejects wrong kind and version", () => {
    expect(parseSuitePackage({ ...makePkg(), kind: "other" }).ok).toBe(false);
    expect(parseSuitePackage({ ...makePkg(), schemaVersion: 2 }).ok).toBe(false);
  });

  it("rejects tasks with blank title or prompt", () => {
    const bad = parseSuitePackage(makePkg({ tasks: [{ title: "", prompt: "x" }] }));
    expect(bad.ok).toBe(false);
    const blank = parseSuitePackage(makePkg({ tasks: [{ title: "x", prompt: "  " }] }));
    expect(blank.ok).toBe(false);
  });

  it("rejects invalid slot and judge shapes", () => {
    expect(parseSuitePackage(makePkg({ modelSlots: [{ provider: "A" } as never] })).ok).toBe(false);
    expect(parseSuitePackage(makePkg({ defaultJudge: {} as never })).ok).toBe(false);
  });

  it("rejects profiles with empty criteria", () => {
    const result = parseSuitePackage(makePkg({ profiles: [{ name: "P", criteria: [] }] }));
    expect(result.ok).toBe(false);
  });
});

describe("normalizeSuitePackage", () => {
  const baseOpts = () => ({ takenIds: new Set<string>(), existingProfileIds: new Set<string>() });

  it("mints ids for missing entries and indexes tasks by order", () => {
    let counter = 0;
    const result = normalizeSuitePackage(makePkg(), {
      ...baseOpts(),
      generateId: () => `gen-${++counter}`,
      now: () => 5000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [t1, t2] = result.result.suite.tasks;
    expect(t1.id).toBe("gen-1");
    expect(t2.id).toBe("task-custom"); // provided ids kept when free
    expect(t2.order).toBe(1);
    expect(t2.systemPrompt).toBe("Be terse");
    expect(result.result.suite.modelSlots[1].enabled).toBe(false);
    expect(result.result.executionReady).toBe(false); // <2 enabled → draft
    expect(result.result.notes.some((n) => n.includes("draft"))).toBe(true);
  });

  it("suffixes conflicting ids instead of skipping", () => {
    const taken = new Set(["task-custom"]);
    const result = normalizeSuitePackage(makePkg(), {
      takenIds: taken,
      existingProfileIds: new Set(),
      generateId: () => "abcd1234-ffff",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t2 = result.result.suite.tasks[1];
    expect(t2.id).toBe("task-custom-abcd1234");
    expect(result.result.notes.some((n) => n.includes("task-custom"))).toBe(true);
  });

  it("remaps embedded profile references to minted ids", () => {
    const pkg = makePkg({
      profiles: [{ id: "pkg-profile", name: "P", criteria: [criterion("c1")] }],
      tasks: [
        {
          title: "T",
          prompt: "p",
          evaluation: { kind: "profile", profile: { id: "pkg-profile", version: 1 } },
        },
      ],
      defaultEvaluation: { kind: "profile", profile: { id: "pkg-profile", version: 1 } },
    });
    const result = normalizeSuitePackage(pkg, { ...baseOpts(), generateId: () => "minted-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Provided id is free — kept; refs remap through the id map to version 1.
    expect(result.result.profiles[0].profile.id).toBe("pkg-profile");
    const taskEval = result.result.suite.tasks[0].evaluation;
    expect(taskEval).toEqual({ kind: "profile", profile: { id: "pkg-profile", version: 1 } });
    expect(result.result.suite.defaultEvaluation).toEqual({
      kind: "profile",
      profile: { id: "pkg-profile", version: 1 },
    });
  });

  it("leaves references to existing local profiles untouched", () => {
    const pkg = makePkg({
      tasks: [
        {
          title: "T",
          prompt: "p",
          evaluation: { kind: "profile", profile: { id: "local-profile", version: 3 } },
        },
      ],
    });
    const result = normalizeSuitePackage(pkg, {
      takenIds: new Set(),
      existingProfileIds: new Set(["local-profile"]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.suite.tasks[0].evaluation).toEqual({
      kind: "profile",
      profile: { id: "local-profile", version: 3 },
    });
  });

  it("errors when a task pins a profile that is neither embedded nor local", () => {
    const pkg = makePkg({
      tasks: [
        {
          title: "T",
          prompt: "p",
          evaluation: { kind: "profile", profile: { id: "ghost", version: 1 } },
        },
      ],
    });
    const result = normalizeSuitePackage(pkg, baseOpts());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("ghost");
  });

  it("rejects embedded profiles with invalid criteria at the record guard", () => {
    const pkg = makePkg({
      profiles: [
        {
          name: "P",
          criteria: [{ ...criterion("c1"), anchors: { one: "", three: "x", five: "y" } }],
        },
      ],
    });
    const result = normalizeSuitePackage(pkg, baseOpts());
    expect(result.ok).toBe(false);
  });

  it("marks a six-model suite execution-ready", () => {
    const pkg = makePkg({
      modelSlots: Array.from({ length: 6 }, (_, i) => ({
        providerId: "openrouter" as const,
        provider: "T",
        model: `M${i}`,
        slug: `m-${i}`,
      })),
    });
    const result = normalizeSuitePackage(pkg, baseOpts());
    expect(result.ok && result.result.executionReady).toBe(true);
  });
});

describe("importSuitePackage", () => {
  const dbs: RSembleEvaluationDB[] = [];
  afterEach(async () => {
    while (dbs.length > 0) {
      const db = dbs.pop()!;
      db.close();
      await db.delete();
    }
  });

  it("writes profiles and suite transactionally; second import creates new entities", async () => {
    const db = new RSembleEvaluationDB(`pkg-test-${crypto.randomUUID()}`);
    dbs.push(db);
    const pkg = makePkg({ profiles: [{ id: "p1", name: "P", criteria: [criterion("c1")] }] });
    const first = normalizeSuitePackage(pkg, {
      takenIds: new Set(),
      existingProfileIds: new Set(),
      generateId: () => crypto.randomUUID(),
    });
    if (!first.ok) throw new Error("normalize failed");
    const result1 = await importSuitePackage(db, first.result);
    expect((await db.suites.toArray()).length).toBe(1);
    expect((await db.profiles.toArray()).length).toBe(1);

    // Same package again — suffixed, never skipped.
    const second = normalizeSuitePackage(pkg, {
      takenIds: new Set([result1.suiteId, ...result1.profileIds, "p1"]),
      existingProfileIds: new Set(),
      generateId: () => crypto.randomUUID(),
    });
    if (!second.ok) throw new Error("normalize failed");
    await importSuitePackage(db, second.result);
    expect((await db.suites.toArray()).length).toBe(2);
    expect((await db.profiles.toArray()).length).toBe(2);
  });

  it("InMemoryEvaluationRepository mirrors the writer contract", async () => {
    const repo = new InMemoryEvaluationRepository();
    const pkg = makePkg({ profiles: [{ name: "P", criteria: [criterion("c1")] }] });
    const normalized = normalizeSuitePackage(pkg, {
      takenIds: new Set(),
      existingProfileIds: new Set(),
    });
    if (!normalized.ok) throw new Error("normalize failed");
    const result = await repo.importSuitePackage(normalized.result);
    expect((await repo.getSuite(result.suiteId))?.name).toBe("Pkg Suite");
    expect(await repo.getProfile(result.profileIds[0], 1)).not.toBeNull();
    // Conflict is an error, not a silent skip.
    await expect(repo.importSuitePackage(normalized.result)).rejects.toThrow(/already exists/);
  });
});
