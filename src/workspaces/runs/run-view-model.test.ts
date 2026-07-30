// =============================================================================
// run-view-model tests — query hooks and formatting (Phase 3 Task 3.1).
//
// The view-model layer converts raw RunSummary / RunRecordV2 into display-ready
// strings for list rows and detail sections. Pure functions, no I/O.
// =============================================================================

import { describe, expect, it } from "vitest";
import type { FullRunSummaryV2, LegacyRunSummary, RunRecordV2 } from "../../lib/persistence/run-types";
import {
  formatRunRow,
  formatRunDetail,
  formatRelativeTime,
} from "./run-view-model";

// --- Helper: minimal FullRunSummaryV2 --------------------------------------

function makeFullSummary(overrides: Partial<FullRunSummaryV2> = {}): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id: "run-123",
    revision: 1,
    createdAt: 1716048000000, // 2024-05-18T00:00:00Z
    completedAt: 1716048060000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    taskTitle: "Write a Python sort function",
    taskExcerpt: "Write a Python function that sorts a list of integers",
    modelKeys: ["openrouter:gpt-4o", "umans:claude-opus", "gemini:gemini-2.5-pro"],
    winnerKeys: ["openrouter:gpt-4o"],
    scoresByModelKey: { "openrouter:gpt-4o": 4.5, "umans:claude-opus": 3.8, "gemini:gemini-2.5-pro": 3.2 },
    judgeModelKey: "openrouter:judge-model",
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: "write a python sort function",
    ...overrides,
  };
}

function makeLegacySummary(overrides: Partial<LegacyRunSummary> = {}): LegacyRunSummary {
  return {
    kind: "legacy",
    schemaVersion: "1-import",
    id: "legacy-456",
    createdAt: 1715961600000, // 2024-05-17T00:00:00Z
    taskExcerpt: "Old run before v2 migration",
    modelKeys: ["openrouter:gpt-3.5-turbo"],
    winnerKeys: ["openrouter:gpt-3.5-turbo"],
    scoresByModelKey: { "openrouter:gpt-3.5-turbo": 3.0 },
    detailAvailable: false,
    searchText: "old run before v2 migration",
    ...overrides,
  };
}

function makeFullRecord(overrides: Partial<RunRecordV2> = {}): RunRecordV2 {
  return {
    schemaVersion: 2,
    id: "run-123",
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt: 1716048000000,
    updatedAt: 1716048060000,
    completedAt: 1716048060000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: "Write a Python sort function", prompt: "Write a Python function that sorts a list of integers using bubble sort.", systemPrompt: "You are a helpful assistant.", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [
      {
        candidateId: "c1",
        slotId: "s1",
        modelKey: "openrouter:gpt-4o",
        providerId: "openrouter",
        model: "GPT-4o",
        slug: "gpt-4o",
        acceptedAttemptId: "att-1",
        attempts: [{
          attemptId: "att-1",
          messages: [{ role: "user", content: "Write a sort" }],
          startedAt: 1716048000000,
          finishedAt: 1716048030000,
          status: "completed",
          output: "def bubble_sort(arr):\n  pass",
          tokensIn: 15,
          tokensOut: 30,
          error: null,
        }],
      },
    ],
    judge: {
      status: "done",
      acceptedAttemptId: "judge-att-1",
      report: {
        labelMap: [{ label: "A", candidateId: "c1" }],
        evaluationsById: { c1: { candidateId: "c1", blindLabel: "A", overallScore: 4.5, position: "First", rationale: "Good", strengths: ["Fast"], deductions: [], missedRequirements: [], criterionScores: [] } },
        comparisons: [],
      },
      consensus: null,
      attempts: [{
        attemptId: "judge-att-1",
        providerId: "openrouter",
        model: "judge-model",
        instruction: "Evaluate",
        messages: [{ role: "user", content: "Evaluate the candidates" }],
        blindLabelToCandidateId: { A: "c1" },
        candidateAttemptIdsByCandidateId: { c1: "att-1" },
        startedAt: 1716048030000,
        finishedAt: 1716048050000,
        status: "completed",
        error: null,
        report: {
          labelMap: [{ label: "A", candidateId: "c1" }],
          evaluationsById: { c1: { candidateId: "c1", blindLabel: "A", overallScore: 4.5, position: "First", rationale: "Good", strengths: ["Fast"], deductions: [], missedRequirements: [], criterionScores: [] } },
          comparisons: [],
        },
        consensus: null,
      }],
    },
    fusion: {
      status: "idle",
      acceptedAttemptId: null,
      attempts: [],
    },
    winnerKeys: ["openrouter:gpt-4o"],
    ...overrides,
  };
}

// --- formatRunRow ------------------------------------------------------------

describe("run-view-model", () => {
  describe("formatRunRow", () => {
    it("formats a completed full summary with winner, top score, model count, source, and relative time", () => {
      const vm = formatRunRow(makeFullSummary());
      expect(vm.taskTitle).toBe("Write a Python sort function");
      expect(vm.status).toBe("completed");
      expect(vm.mode).toBe("rank");
      expect(vm.modelCount).toBe(3);
      expect(vm.winnerKeys).toEqual(["openrouter:gpt-4o"]);
      expect(vm.sourceLabel).toBe("ad hoc");
      expect(vm.isLegacy).toBe(false);
      expect(vm.detailAvailable).toBe(true);
    });

    it("formats every persisted tied winner", () => {
      const vm = formatRunRow(makeFullSummary({
        winnerKeys: ["openrouter:gpt-4o", "umans:claude-opus"],
        scoresByModelKey: { "openrouter:gpt-4o": 4.5, "umans:claude-opus": 4.5 },
      }));
      expect(vm.winnerKeys).toEqual(["openrouter:gpt-4o", "umans:claude-opus"]);
    });

    it("does not infer a winner from scores when accepted Judge is missing", () => {
      const vm = formatRunRow(makeFullSummary({
        winnerKeys: [],
        status: "failed",
      }));
      expect(vm.winnerKeys).toEqual([]);
    });

    it("formats a failed run", () => {
      const vm = formatRunRow(makeFullSummary({
        status: "failed",
        winnerKeys: [],
      }));
      expect(vm.status).toBe("failed");
      expect(vm.winnerKeys).toEqual([]);
    });

    it("formats an experiment source labeled with experiment metadata", () => {
      const vm = formatRunRow(makeFullSummary({
        source: {
          kind: "experiment",
          experimentId: "exp-1",
          suiteId: "suite-1",
          suiteVersion: 3,
          protocolFingerprint: "fp-abc",
          taskId: "task-1",
          experimentTaskAttemptId: "attempt-1",
          trial: 1,
        },
      }));
      expect(vm.sourceLabel).toBe("experiment");
    });

    it("formats legacy summaries with explicit detail unavailable", () => {
      const vm = formatRunRow(makeLegacySummary());
      expect(vm.kind).toBe("legacy");
      expect(vm.isLegacy).toBe(true);
      expect(vm.detailAvailable).toBe(false);
      // Legacy: no status/mode inference — winnerKeys come from persisted data
      expect(vm.winnerKeys).toEqual(["openrouter:gpt-3.5-turbo"]);
      expect(vm.modelCount).toBe(1);
    });

    it("formats scores display with top score", () => {
      const vm = formatRunRow(makeFullSummary({
        winnerKeys: ["openrouter:gpt-4o"],
        scoresByModelKey: { "openrouter:gpt-4o": 4.5 },
      }));
      expect(vm.topScore).toBe(4.5);
    });

    it("returns null topScore when no winner", () => {
      const vm = formatRunRow(makeFullSummary({
        winnerKeys: [],
      }));
      expect(vm.topScore).toBeNull();
    });
  });

  describe("formatRunDetail", () => {
    it("formats full record with sections in exact semantic order", () => {
      // Provide a fusion attempt so the canonical 7-section order is exercised.
      const vm = formatRunDetail(makeFullRecord({
        fusion: {
          status: "done",
          acceptedAttemptId: "fusion-att-1",
          attempts: [{
            attemptId: "fusion-att-1",
            providerId: "openrouter",
            model: "judge-model",
            messages: [{ role: "user", content: "Merge" }],
            sourceJudgeAttemptId: "judge-att-1",
            candidateAttemptIdsByCandidateId: { c1: "att-1" },
            startedAt: 1716048050000,
            finishedAt: 1716048060000,
            status: "completed",
            error: null,
            result: "fused answer",
          }],
        },
      }));
      expect(vm).not.toBeNull();
      expect(vm!.sections).toBeDefined();
      // Exact section order: header → outcome → candidates → selected → judge → fusion → task/config
      expect(vm!.sections.map((s) => s.id)).toEqual([
        "header",
        "outcome",
        "candidates",
        "selected-candidate",
        "judge",
        "fusion",
        "task-config",
      ]);
    });

    it("header section contains status, title, exact timestamp with timezone, and relative time", () => {
      const vm = formatRunDetail(makeFullRecord());
      const header = vm!.sections.find((s) => s.id === "header");
      expect(header).toBeDefined();
      expect(header!.title).toBe("Write a Python sort function");
      expect(header!.status).toBe("completed");
    });

    it("outcome section lists every tied winner", () => {
      const vm = formatRunDetail(makeFullRecord({
        winnerKeys: ["openrouter:gpt-4o", "umans:claude-opus"],
      }));
      const outcome = vm!.sections.find((s) => s.id === "outcome");
      expect(outcome).toBeDefined();
      expect((outcome as Record<string, unknown>).winners).toEqual(["openrouter:gpt-4o", "umans:claude-opus"]);
    });

    it("fusion section only appears when Fusion attempts exist", () => {
      const vm = formatRunDetail(makeFullRecord());
      const fusion = vm!.sections.find((s) => s.id === "fusion");
      // fusion.status === "idle" → no fusion section
      expect(fusion).toBeUndefined();
    });

    it("fusion section renders when fusion attempts exist", () => {
      const vm = formatRunDetail(makeFullRecord({
        fusion: {
          status: "done",
          acceptedAttemptId: "fusion-att-1",
          attempts: [{
            attemptId: "fusion-att-1",
            providerId: "openrouter",
            model: "judge-model",
            messages: [{ role: "user", content: "Merge" }],
            sourceJudgeAttemptId: "judge-att-1",
            candidateAttemptIdsByCandidateId: { c1: "att-1" },
            startedAt: 1716048050000,
            finishedAt: 1716048060000,
            status: "completed",
            error: null,
            result: "fused answer",
          }],
        },
      }));
      const fusion = vm!.sections.find((s) => s.id === "fusion");
      expect(fusion).toBeDefined();
    });

    it("returns null for legacy record", () => {
      const vm = formatRunDetail(null);
      expect(vm).toBeNull();
    });
  });

  describe("formatRelativeTime", () => {
    it("returns seconds for < 1 minute", () => {
      expect(formatRelativeTime(Date.now() - 30_000)).toMatch(/\d+s ago/);
    });

    it("returns minutes for < 1 hour", () => {
      expect(formatRelativeTime(Date.now() - 300_000)).toMatch(/\d+m ago/);
    });

    it("returns hours for < 1 day", () => {
      expect(formatRelativeTime(Date.now() - 7_200_000)).toMatch(/\d+h ago/);
    });

    it("returns days for >= 1 day", () => {
      expect(formatRelativeTime(Date.now() - 172_800_000)).toMatch(/\d+d ago/);
    });
  });
});
