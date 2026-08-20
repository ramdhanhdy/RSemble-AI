// =============================================================================
// RSemble AI — models-url-state.test.ts (Child 07 Task 9, C2 RED).
//
// Codec contract: the eight filters + D1 sort + page round-trip through sorted
// URL params. The default state encodes to an empty param string; equivalent
// states encode identically; malformed values fall back to defaults.
// =============================================================================
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_LIST_URL_STATE,
  countAppliedModelFilters,
  decodeModelListUrlState,
  encodeModelListUrlState,
  type ModelListUrlState,
} from "./models-url-state";

describe("models-url-state — default + round-trip", () => {
  it("the default state encodes to an empty param string", () => {
    expect(encodeModelListUrlState(DEFAULT_MODEL_LIST_URL_STATE).toString()).toBe("");
  });

  it("decoding an empty source yields the default state", () => {
    expect(decodeModelListUrlState(new URLSearchParams())).toEqual(DEFAULT_MODEL_LIST_URL_STATE);
  });

  it("a fully-set state round-trips through encode → decode", () => {
    const state: ModelListUrlState = {
      search: "alpha",
      provider: "providerA",
      model: "alpha-1",
      versionStatus: "rolling_alias",
      signature: "reason-high",
      evidenceClass: "verified",
      family: "family-transform",
      recency: "30",
      sort: "latest",
      page: 3,
    };
    const encoded = encodeModelListUrlState(state);
    const decoded = decodeModelListUrlState(encoded);
    expect(decoded).toEqual(state);
  });

  it("equivalent states produce identical sorted param strings", () => {
    const state: ModelListUrlState = {
      search: "",
      provider: "providerB",
      model: "",
      versionStatus: "exact",
      signature: "",
      evidenceClass: "comparable",
      family: "",
      recency: "",
      sort: "canonical",
      page: 1,
    };
    const a = encodeModelListUrlState(state).toString();
    const b = encodeModelListUrlState(state).toString();
    expect(a).toBe(b);
    // Params are sorted by key.
    const keys = Array.from(encodeModelListUrlState(state).keys());
    const sorted = [...keys].sort((x, y) => x.localeCompare(y));
    expect(keys).toEqual(sorted);
  });

  it("only non-default values are emitted", () => {
    const encoded = encodeModelListUrlState({
      ...DEFAULT_MODEL_LIST_URL_STATE,
      provider: "providerA",
      recency: "7",
    });
    const keys = Array.from(encoded.keys());
    expect(keys).toEqual(["m.provider", "m.recency"]);
  });
});

describe("models-url-state — decode robustness", () => {
  it("malformed page falls back to 1", () => {
    expect(decodeModelListUrlState(new URLSearchParams("m.page=abc")).page).toBe(1);
    expect(decodeModelListUrlState(new URLSearchParams("m.page=-2")).page).toBe(1);
    expect(decodeModelListUrlState(new URLSearchParams("m.page=2.5")).page).toBe(1);
  });

  it("unknown version-status / recency / sort fall back to defaults", () => {
    const decoded = decodeModelListUrlState(
      new URLSearchParams("m.versionStatus=bogus&m.recency=99&m.sort=score"),
    );
    expect(decoded.versionStatus).toBe("");
    expect(decoded.recency).toBe("");
    expect(decoded.sort).toBe("canonical");
  });

  it("accepts a plain record as source", () => {
    const decoded = decodeModelListUrlState({ "m.family": "family-write", "m.page": "4" });
    expect(decoded.family).toBe("family-write");
    expect(decoded.page).toBe(4);
  });
});

describe("models-url-state — applied-count", () => {
  it("counts only the eight filters, not sort or page", () => {
    expect(countAppliedModelFilters(DEFAULT_MODEL_LIST_URL_STATE)).toBe(0);
    expect(
      countAppliedModelFilters({
        ...DEFAULT_MODEL_LIST_URL_STATE,
        sort: "latest",
        page: 5,
      }),
    ).toBe(0);
    expect(
      countAppliedModelFilters({
        ...DEFAULT_MODEL_LIST_URL_STATE,
        provider: "providerA",
        evidenceClass: "verified",
        recency: "30",
      }),
    ).toBe(3);
  });

  it("search counts only when non-empty after trim", () => {
    expect(countAppliedModelFilters({ ...DEFAULT_MODEL_LIST_URL_STATE, search: "   " })).toBe(0);
    expect(countAppliedModelFilters({ ...DEFAULT_MODEL_LIST_URL_STATE, search: "x" })).toBe(1);
  });
});
