import { describe, expect, it } from "vitest";
import type { EvaluationSuite } from "./evaluation-types";
import { suitesUsingProfile } from "./profile-usage";

/** Minimal suite fixture — mirrors the makeSuite pattern in SuiteList.test.tsx. */
function makeSuite(id: string, overrides: Partial<EvaluationSuite> = {}): EvaluationSuite {
  const now = 0;
  return {
    id,
    revision: 1,
    version: 1,
    name: `Suite ${id}`,
    description: "",
    tasks: [],
    modelSlots: [],
    defaultJudge: { providerId: "openrouter", model: "" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  };
}

const PIN = { id: "p1", version: 2 };

describe("suitesUsingProfile", () => {
  it("matches suites whose default evaluation pins the profile", () => {
    const s = makeSuite("s1", {
      defaultEvaluation: { kind: "profile", profile: PIN },
    });
    const usage = suitesUsingProfile([s], "p1");
    expect(usage).toHaveLength(1);
    expect(usage[0].suite.id).toBe("s1");
    expect(usage[0].versions).toEqual([2]);
    expect(usage[0].levels).toEqual(["default"]);
  });

  it("matches task-level pins and reports the task level", () => {
    const s = makeSuite("s1", {
      tasks: [
        {
          id: "t1",
          title: "Task 1",
          prompt: "p",
          systemPrompt: "",
          evaluation: { kind: "profile", profile: PIN },
          judgeInstructionOverride: "",
          order: 0,
        },
      ],
    });
    const usage = suitesUsingProfile([s], "p1");
    expect(usage).toHaveLength(1);
    expect(usage[0].versions).toEqual([2]);
    expect(usage[0].levels).toEqual(["task"]);
  });

  it("enumerates distinct versions across default and task pins, ascending", () => {
    const s = makeSuite("s1", {
      defaultEvaluation: { kind: "profile", profile: { id: "p1", version: 3 } },
      tasks: [
        {
          id: "t1",
          title: "Task 1",
          prompt: "p",
          systemPrompt: "",
          evaluation: { kind: "profile", profile: { id: "p1", version: 1 } },
          judgeInstructionOverride: "",
          order: 0,
        },
        {
          id: "t2",
          title: "Task 2",
          prompt: "p",
          systemPrompt: "",
          evaluation: { kind: "profile", profile: { id: "p1", version: 3 } },
          judgeInstructionOverride: "",
          order: 1,
        },
      ],
    });
    const usage = suitesUsingProfile([s], "p1");
    expect(usage[0].versions).toEqual([1, 3]);
    expect(usage[0].levels.sort()).toEqual(["default", "task"]);
  });

  it("excludes archived suites", () => {
    const archived = makeSuite("s2", {
      archivedAt: 1,
      defaultEvaluation: { kind: "profile", profile: PIN },
    });
    expect(suitesUsingProfile([archived], "p1")).toEqual([]);
  });

  it("excludes holistic suites", () => {
    const holistic = makeSuite("s3");
    expect(suitesUsingProfile([holistic], "p1")).toEqual([]);
  });

  it("does not match other profile ids", () => {
    const s = makeSuite("s4", {
      defaultEvaluation: { kind: "profile", profile: { id: "p9", version: 1 } },
    });
    expect(suitesUsingProfile([s], "p1")).toEqual([]);
  });

  it("excludes tasks whose evaluation is inherit", () => {
    const s = makeSuite("s5", {
      tasks: [
        {
          id: "t1",
          title: "Task 1",
          prompt: "p",
          systemPrompt: "",
          evaluation: { kind: "inherit" },
          judgeInstructionOverride: "",
          order: 0,
        },
      ],
    });
    expect(suitesUsingProfile([s], "p1")).toEqual([]);
  });
});
