// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  COPY,
  VERIFIED_ON_SENTENCE,
  WON_TIED_LOST_SENTENCE,
  MIXED_COHORTS_SENTENCE,
  PROVIDER_VERSION_SENTENCE,
  INSUFFICIENT_SENTENCE,
  FORBIDDEN_COPY_PATTERNS,
  ALL_COPY_STRINGS,
} from "./copy";
import { FORBIDDEN_CLAIM_PHRASES } from "../../lib/model-profiles/profile-claims";

describe("copy.ts — Fable §10 string table", () => {
  it("holds the five §10 sentences verbatim", () => {
    expect(VERIFIED_ON_SENTENCE).toBe(
      "Verified on 8 of 10 code-transformation Tasks under verifier cohort X.",
    );
    expect(WON_TIED_LOST_SENTENCE).toBe(
      "Won 6, tied 2, lost 4 against configuration Y on 12 shared eligible Tasks.",
    );
    expect(MIXED_COHORTS_SENTENCE).toBe(
      "Evidence is mixed across two Rubric cohorts; values are not pooled.",
    );
    expect(PROVIDER_VERSION_SENTENCE).toBe(
      "Provider version was not reported for 14 observations from May–August.",
    );
    expect(INSUFFICIENT_SENTENCE).toBe(
      "Insufficient independent coverage for an interval — 4 resolved task-cluster units, 5 required.",
    );
  });

  it("exposes the DeterministicNarrative header and honesty footer verbatim", () => {
    expect(COPY.deterministicNarrative.header).toBe("OVERVIEW — TEMPLATE-GENERATED");
    expect(COPY.deterministicNarrative.footer).toBe(
      "Every sentence is generated from fixed templates over the facts below. It adds no judgment.",
    );
  });

  it("exposes the PairedGlyphStrip legend verbatim", () => {
    expect(COPY.pairedGlyphStrip.legend).toBe(
      "W won · T tied · L lost — per shared task, task order fixed",
    );
  });

  it("exposes the non-pooling divider verbatim", () => {
    expect(COPY.cohort.nonPoolingDivider).toBe(
      "Rubric cohorts are not commensurate; values are not pooled.",
    );
  });

  it("exposes the rollup policy block verbatim", () => {
    expect(COPY.rollup.eyebrow).toBe("SAVED ROLLUP");
    expect(COPY.rollup.policy).toBe(
      "Stratified only. This rollup is a pinned list of exact configurations shown side by side. It is not a model, not a pooled respondent, and never produces a merged estimate.",
    );
    expect(COPY.rollup.immutability).toBe(
      "Member or name changes create a new version; this version is pinned forever.",
    );
    expect(COPY.rollup.tombstone("mc-4f")).toBe(
      "Member mc-4f is not present in this database",
    );
  });

  it("contains no forbidden claim phrase anywhere in the string table", () => {
    const lower = ALL_COPY_STRINGS.map((s) => s.toLowerCase());
    for (const phrase of FORBIDDEN_CLAIM_PHRASES) {
      const needle = phrase.toLowerCase();
      for (const s of lower) {
        expect(s).not.toContain(needle);
      }
    }
  });

  it("contains no UI-forbidden pattern (n= digits, overall score, best model, good at, because the model)", () => {
    for (const pattern of FORBIDDEN_COPY_PATTERNS) {
      for (const s of ALL_COPY_STRINGS) {
        expect(s).not.toMatch(pattern);
      }
    }
  });

  it("never re-exports a forbidden phrase under a different key", () => {
    // The string table must not synthesize a pooled cross-cohort scalar.
    for (const s of ALL_COPY_STRINGS) {
      expect(s).not.toMatch(/Σ/);
      expect(s.toLowerCase()).not.toMatch(/\baverage\b/);
      expect(s.toLowerCase()).not.toMatch(/\btotal\b/);
    }
  });
});
