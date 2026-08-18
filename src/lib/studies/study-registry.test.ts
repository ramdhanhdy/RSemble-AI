// =============================================================================
// RSemble AI — Study registry tests (spec §4.1)
//
// RED: specifies the first-party study registry — exactly one registered kind
// (policy), unknown kinds rejected, registration exposes validators and
// fingerprinter.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  REGISTERED_STUDY_KINDS,
  STUDY_REGISTRY,
  getStudyTypeRegistration,
  isRegisteredStudyKind,
  type AnyStudyTypeRegistration,
} from "./study-registry";

describe("study registry", () => {
  it("registers exactly one kind: policy", () => {
    expect(REGISTERED_STUDY_KINDS).toEqual(["policy"]);
    expect(Object.keys(STUDY_REGISTRY)).toEqual(["policy"]);
    expect("policy" in STUDY_REGISTRY).toBe(true);
  });

  it("does not register routing, judge, or workflow placeholders", () => {
    expect(isRegisteredStudyKind("routing")).toBe(false);
    expect(isRegisteredStudyKind("judge")).toBe(false);
    expect(isRegisteredStudyKind("workflow")).toBe(false);
    expect(isRegisteredStudyKind("")).toBe(false);
    expect(isRegisteredStudyKind("Policy")).toBe(false);
  });

  it("isRegisteredStudyKind rejects non-string values", () => {
    expect(isRegisteredStudyKind(null)).toBe(false);
    expect(isRegisteredStudyKind(42)).toBe(false);
    expect(isRegisteredStudyKind({})).toBe(false);
  });

  it("getStudyTypeRegistration returns the policy registration", () => {
    const reg = getStudyTypeRegistration("policy") as AnyStudyTypeRegistration | null;
    expect(reg).not.toBeNull();
    expect(reg?.kind).toBe("policy");
    expect(typeof reg?.schemaVersion).toBe("number");
    expect(typeof reg?.validateDefinition).toBe("function");
    expect(typeof reg?.validateTrialPayload).toBe("function");
    expect(typeof reg?.validateObservationPayload).toBe("function");
    expect(typeof reg?.validateReportPayload).toBe("function");
    expect(typeof reg?.fingerprintDefinition).toBe("function");
  });

  it("getStudyTypeRegistration returns null for unknown kinds", () => {
    expect(getStudyTypeRegistration("routing")).toBeNull();
    expect(getStudyTypeRegistration("judge")).toBeNull();
    expect(getStudyTypeRegistration("")).toBeNull();
  });

  it("the registration kind matches the registry key", () => {
    const reg = getStudyTypeRegistration("policy");
    expect(reg?.kind).toBe("policy");
  });
});
