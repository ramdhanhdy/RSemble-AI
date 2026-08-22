// =============================================================================
// RSemble AI — Task Link Validator tests (spec §7.3, §7.4)
//
// Child 05 (Contextual Compare Results) Milestone D — Task 8 (RED first).
//
// Tests pure exact-normalized match validation for promoting/linking ad hoc
// comparisons to canonical Task Versions:
//   - exact normalized instruction matching (whitespace / CRLF invariance);
//   - instruction mismatch rejection;
//   - context manifest exact matching and mismatch detection;
//   - response contract matching and mismatch detection;
//   - exact match candidate discovery without semantic similarity auto-merging;
//   - historical input completeness assessment (instance_input_incomplete);
//   - zero provider calls / pure function contract.
// =============================================================================

import { describe, expect, it } from "vitest";
import type { TaskVersion, ContextManifestEntry, ResponseContract } from "../tasks/task-types";
import {
  validateTaskVersionLink,
  findExactTaskMatches,
  assessInputCompleteness,
  normalizeInstruction,
  type ComparisonExecutableInput,
} from "./task-link-validator";

const NOW = 1_700_000_000_000;

function makeVersion(overrides: Partial<TaskVersion> = {}): TaskVersion {
  return {
    taskId: "task-test-1",
    version: 1,
    title: "Test Task 1",
    objective: "Test objective",
    candidateInstruction: "Write a function that calculates fibonacci numbers.",
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "authored", legacyScopeKey: null, note: null },
    createdAt: NOW,
    ...overrides,
  };
}

describe("normalizeInstruction", () => {
  it("trims surrounding whitespace and normalizes CRLF to LF", () => {
    expect(normalizeInstruction("  hello\r\nworld  \n")).toBe("hello\nworld");
    expect(normalizeInstruction("")).toBe("");
    expect(normalizeInstruction("   \t  ")).toBe("");
  });
});

describe("validateTaskVersionLink", () => {
  it("passes exact normalized match with identical instruction and empty context", () => {
    const version = makeVersion({
      candidateInstruction: "Write a function that calculates fibonacci numbers.",
      defaultContextManifest: [],
      responseContract: null,
    });

    const input: ComparisonExecutableInput = {
      prompt: "  Write a function that calculates fibonacci numbers. \n",
      contextManifest: [],
      responseContract: null,
    };

    const result = validateTaskVersionLink(input, version);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matchType).toBe("exact");
    }
  });

  it("normalizes CRLF line endings when comparing instructions", () => {
    const version = makeVersion({
      candidateInstruction: "Line 1\nLine 2\nLine 3",
    });

    const input: ComparisonExecutableInput = {
      prompt: "Line 1\r\nLine 2\r\nLine 3",
    };

    const result = validateTaskVersionLink(input, version);
    expect(result.ok).toBe(true);
  });

  it("rejects instruction text mismatch with clear error details", () => {
    const version = makeVersion({
      candidateInstruction: "Write a function that calculates fibonacci numbers.",
    });

    const input: ComparisonExecutableInput = {
      prompt: "Write a python script that calculates primes.",
    };

    const result = validateTaskVersionLink(input, version);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.matchType).toBe("mismatch");
      expect(result.mismatches.some((m) => m.field === "instruction")).toBe(true);
      expect(result.message).toContain("instruction");
    }
  });

  it("rejects semantic similarity as mismatch (spec §7.4: no semantic identity)", () => {
    const version = makeVersion({
      candidateInstruction: "Implement fibonacci sequence in Python.",
    });

    // Semantically near-identical prompt, but not exact normalized match
    const input: ComparisonExecutableInput = {
      prompt: "Write a Python function to compute the Fibonacci sequence.",
    };

    const result = validateTaskVersionLink(input, version);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.matchType).toBe("mismatch");
    }
  });

  it("matches identical context manifest entries", () => {
    const manifest: ContextManifestEntry[] = [
      {
        role: "reference",
        artifactId: "art-1",
        externalRef: null,
        metadataDigest: "sha256:abcd",
        mediaType: "text/plain",
        byteCount: 120,
      },
    ];

    const version = makeVersion({
      candidateInstruction: "Analyze the attached file.",
      defaultContextManifest: manifest,
    });

    const input: ComparisonExecutableInput = {
      prompt: "Analyze the attached file.",
      contextManifest: [
        {
          role: "reference",
          artifactId: "art-1",
          externalRef: null,
          metadataDigest: "sha256:abcd",
          mediaType: "text/plain",
          byteCount: 120,
        },
      ],
    };

    const result = validateTaskVersionLink(input, version);
    expect(result.ok).toBe(true);
  });

  it("rejects context manifest count mismatch", () => {
    const version = makeVersion({
      candidateInstruction: "Analyze the attached file.",
      defaultContextManifest: [
        {
          role: "reference",
          artifactId: "art-1",
          externalRef: null,
          metadataDigest: "sha256:abcd",
          mediaType: "text/plain",
          byteCount: 120,
        },
      ],
    });

    const input: ComparisonExecutableInput = {
      prompt: "Analyze the attached file.",
      contextManifest: [],
    };

    const result = validateTaskVersionLink(input, version);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mismatches.some((m) => m.field === "context_manifest")).toBe(true);
    }
  });

  it("matches identical response contracts", () => {
    const contract: ResponseContract = {
      format: "json",
      constraints: ["valid JSON schema", "no markdown formatting"],
      maxLength: 2000,
    };

    const version = makeVersion({
      candidateInstruction: "Generate user data.",
      responseContract: contract,
    });

    const input: ComparisonExecutableInput = {
      prompt: "Generate user data.",
      responseContract: {
        format: "json",
        constraints: ["valid JSON schema", "no markdown formatting"],
        maxLength: 2000,
      },
    };

    const result = validateTaskVersionLink(input, version);
    expect(result.ok).toBe(true);
  });

  it("rejects response contract mismatch", () => {
    const version = makeVersion({
      candidateInstruction: "Generate user data.",
      responseContract: {
        format: "json",
        constraints: ["strict schema"],
        maxLength: 1000,
      },
    });

    const input: ComparisonExecutableInput = {
      prompt: "Generate user data.",
      responseContract: {
        format: "markdown",
        constraints: ["strict schema"],
        maxLength: 1000,
      },
    };

    const result = validateTaskVersionLink(input, version);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mismatches.some((m) => m.field === "response_contract")).toBe(true);
    }
  });
});

describe("findExactTaskMatches", () => {
  it("finds all exact matching versions and ignores mismatched ones", () => {
    const v1 = makeVersion({
      taskId: "task-1",
      version: 1,
      candidateInstruction: "Exact match instruction",
    });
    const v2 = makeVersion({
      taskId: "task-2",
      version: 1,
      candidateInstruction: "Exact match instruction",
    });
    const v3 = makeVersion({
      taskId: "task-3",
      version: 1,
      candidateInstruction: "Different instruction",
    });

    const input: ComparisonExecutableInput = {
      prompt: "Exact match instruction",
    };

    const matches = findExactTaskMatches(input, [v1, v2, v3]);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.taskId)).toEqual(["task-1", "task-2"]);
  });

  it("returns empty array when no exact matches exist", () => {
    const v1 = makeVersion({ candidateInstruction: "Some instruction A" });
    const v2 = makeVersion({ candidateInstruction: "Some instruction B" });

    const input: ComparisonExecutableInput = {
      prompt: "Some instruction C",
    };

    const matches = findExactTaskMatches(input, [v1, v2]);
    expect(matches).toEqual([]);
  });
});

describe("assessInputCompleteness", () => {
  it("marks complete when prompt is non-empty and no missing artifacts", () => {
    const input: ComparisonExecutableInput = {
      prompt: "Calculate pi to 10 decimal places.",
      contextManifest: [],
    };

    const assessment = assessInputCompleteness(input);
    expect(assessment.isMissingInput).toBe(false);
    expect(assessment.completeness).toBe("complete");
    expect(assessment.reason).toBeNull();
  });

  it("marks incomplete and instance_input_incomplete when prompt is empty/missing", () => {
    const input: ComparisonExecutableInput = {
      prompt: "   ",
      contextManifest: [],
    };

    const assessment = assessInputCompleteness(input);
    expect(assessment.isMissingInput).toBe(true);
    expect(assessment.completeness).toBe("incomplete");
    expect(assessment.reason).toBe("instance_input_incomplete");
  });

  it("marks incomplete when context manifest references artifacts without bytes", () => {
    const input: ComparisonExecutableInput = {
      prompt: "Analyze the data.",
      contextManifest: [
        {
          role: "input",
          artifactId: "art-missing",
          externalRef: null,
          metadataDigest: "sha256:1234",
          mediaType: "application/json",
          byteCount: 500,
        },
      ],
    };

    const availableBytes = new Map<string, Uint8Array>();
    const assessment = assessInputCompleteness(input, availableBytes);
    expect(assessment.isMissingInput).toBe(true);
    expect(assessment.completeness).toBe("incomplete");
    expect(assessment.reason).toBe("instance_input_incomplete");
  });
});
