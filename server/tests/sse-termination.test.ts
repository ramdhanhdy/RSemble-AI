import { describe, it, expect } from "vitest";
import {
  inspectOpenAiSseChunk,
  finalizeOpenAiSseState,
  shouldAppendDone,
  initialSseTerminationState,
  DONE_SENTINEL,
} from "../codex-bridge/sse-termination";

function sseDelta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("inspectOpenAiSseChunk — one complete content event", () => {
  it("detects usable content and no [DONE]", () => {
    let state = initialSseTerminationState();
    state = inspectOpenAiSseChunk(state, encode(sseDelta("OK")));
    expect(state.sawUsableContent).toBe(true);
    expect(state.sawDone).toBe(false);
    expect(state.pending).toBe("");
  });
});

describe("inspectOpenAiSseChunk — split UTF-8 and split JSON", () => {
  it("handles a content event split across two chunks at a byte boundary", () => {
    const event = sseDelta("OK");
    const mid = Math.floor(event.length / 2);
    let state = initialSseTerminationState();
    state = inspectOpenAiSseChunk(state, encode(event.slice(0, mid)));
    // After the first half, no complete line yet.
    expect(state.sawUsableContent).toBe(false);
    state = inspectOpenAiSseChunk(state, encode(event.slice(mid)));
    expect(state.sawUsableContent).toBe(true);
    expect(state.pending).toBe("");
  });

  it("handles multi-byte UTF-8 split across chunks", () => {
    const content = "→";
    const event = sseDelta(content);
    // Split inside the multi-byte sequence (→ is 3 bytes in UTF-8).
    const bytes = new TextEncoder().encode(event);
    const splitPoint = bytes.indexOf(0xe2); // first byte of →
    let state = initialSseTerminationState();
    state = inspectOpenAiSseChunk(state, bytes.slice(0, splitPoint + 1));
    state = inspectOpenAiSseChunk(state, bytes.slice(splitPoint + 1));
    expect(state.sawUsableContent).toBe(true);
  });
});

describe("inspectOpenAiSseChunk — [DONE] across chunks", () => {
  it("detects [DONE] when the sentinel is split across two chunks", () => {
    const event = "data: [DONE]\n\n";
    const mid = 7; // split inside "[DONE]"
    let state = initialSseTerminationState();
    state = inspectOpenAiSseChunk(state, encode(event.slice(0, mid)));
    expect(state.sawDone).toBe(false);
    state = inspectOpenAiSseChunk(state, encode(event.slice(mid)));
    expect(state.sawDone).toBe(true);
  });
});

describe("inspectOpenAiSseChunk — comment/heartbeat events", () => {
  it("ignores comment lines starting with colon", () => {
    let state = initialSseTerminationState();
    state = inspectOpenAiSseChunk(state, encode(": heartbeat\n\n"));
    expect(state.sawDone).toBe(false);
    expect(state.sawUsableContent).toBe(false);
  });
});

describe("inspectOpenAiSseChunk — empty delta", () => {
  it("does not mark usable content for a delta with empty string content", () => {
    let state = initialSseTerminationState();
    state = inspectOpenAiSseChunk(
      state,
      encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "" } }] })}\n\n`),
    );
    expect(state.sawUsableContent).toBe(false);
  });

  it("does not mark usable content for a delta with no content field", () => {
    let state = initialSseTerminationState();
    state = inspectOpenAiSseChunk(
      state,
      encode(`data: ${JSON.stringify({ choices: [{ delta: {} }] })}\n\n`),
    );
    expect(state.sawUsableContent).toBe(false);
  });
});

describe("inspectOpenAiSseChunk — reasoning-only protocol activity", () => {
  it("recognizes reasoning_content as a valid delta for clean-EOF normalization", () => {
    let state = initialSseTerminationState();
    state = inspectOpenAiSseChunk(
      state,
      encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking" } }] })}\n\n`),
    );
    expect(shouldAppendDone(state, true)).toBe(true);
  });
});

describe("finalizeOpenAiSseState — final line without newline", () => {
  it("inspects a complete content event left in the pending EOF buffer", () => {
    let state = initialSseTerminationState();
    state = inspectOpenAiSseChunk(
      state,
      encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}`),
    );
    expect(state.sawUsableContent).toBe(false);
    state = finalizeOpenAiSseState(state);
    expect(state.sawUsableContent).toBe(true);
    expect(state.pending).toBe("");
    expect(shouldAppendDone(state, true)).toBe(true);
  });
});

describe("inspectOpenAiSseChunk — malformed JSON", () => {
  it("ignores a complete data line with invalid JSON", () => {
    let state = initialSseTerminationState();
    state = inspectOpenAiSseChunk(state, encode("data: {not json}\n\n"));
    expect(state.sawUsableContent).toBe(false);
    expect(state.sawDone).toBe(false);
  });
});

describe("shouldAppendDone", () => {
  it("appends when content was observed and iteration completed normally", () => {
    const state = { pending: "", sawDone: false, sawUsableContent: true };
    expect(shouldAppendDone(state, true)).toBe(true);
  });

  it("does not append when [DONE] was already observed", () => {
    const state = { pending: "", sawDone: true, sawUsableContent: true };
    expect(shouldAppendDone(state, true)).toBe(false);
  });

  it("does not append when no usable content was observed", () => {
    const state = { pending: "", sawDone: false, sawUsableContent: false };
    expect(shouldAppendDone(state, true)).toBe(false);
  });

  it("does not append when iteration did not complete normally (thrown)", () => {
    const state = { pending: "", sawDone: false, sawUsableContent: true };
    expect(shouldAppendDone(state, false)).toBe(false);
  });

  it("does not append when iteration did not complete normally (client abort)", () => {
    const state = { pending: "", sawDone: false, sawUsableContent: true };
    expect(shouldAppendDone(state, false)).toBe(false);
  });
});

describe("DONE_SENTINEL", () => {
  it("is exactly 'data: [DONE]\\n\\n'", () => {
    expect(DONE_SENTINEL).toBe("data: [DONE]\n\n");
  });
});
