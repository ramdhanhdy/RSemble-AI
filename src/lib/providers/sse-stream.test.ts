import { describe, it, expect } from "vitest";
import { readSseChatStream } from "./sse-stream";
import { ProviderError } from "./types";
import type { ProviderId } from "./types";
import type { SseMeta } from "./sse-stream";

// Helper: build a ReadableStream from an array of string chunks.
function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

// Helper: build a ReadableStream that enqueues chunks then errors on read.
function makeFailingStream(chunksBeforeFail: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sentChunks = 0;
  return new ReadableStream({
    pull(controller) {
      if (sentChunks < chunksBeforeFail.length) {
        controller.enqueue(encoder.encode(chunksBeforeFail[sentChunks]));
        sentChunks++;
      } else {
        controller.error(new Error("upstream connection dropped"));
      }
    },
  });
}

const pid: ProviderId = "umans";
const label = "Umans";

describe("readSseChatStream", () => {
  it("yields content deltas from a normal stream ending with [DONE]", async () => {
    const stream = makeStream([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const deltas: string[] = [];
    for await (const d of readSseChatStream(stream, pid, label)) {
      deltas.push(d);
    }
    expect(deltas).toEqual(["Hello", " world"]);
  });

  it("throws ProviderError on unexpected EOF (no [DONE] sentinel)", async () => {
    const stream = makeStream([
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      // stream closes without [DONE]
    ]);
    const deltas: string[] = [];
    await expect(async () => {
      for await (const d of readSseChatStream(stream, pid, label)) {
        deltas.push(d);
      }
    }).rejects.toThrow(ProviderError);
    // We should have received the partial content before the error
    expect(deltas).toEqual(["partial"]);
  });

  it("throws ProviderError on empty stream ([DONE] with no content)", async () => {
    const stream = makeStream(["data: [DONE]\n\n"]);
    await expect(async () => {
      for await (const _d of readSseChatStream(stream, pid, label)) {
        // should never yield
      }
    }).rejects.toThrow(ProviderError);
  });

  it("throws ProviderError on empty stream (reader closes with no data at all)", async () => {
    const stream = makeStream([]);
    await expect(async () => {
      for await (const _d of readSseChatStream(stream, pid, label)) {
        // should never yield
      }
    }).rejects.toThrow(ProviderError);
  });

  it("distinguishes client abort: re-throws AbortError, not ProviderError", async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = makeStream([
      'data: {"choices":[{"delta":{"content":"data"}}]}\n\n',
      // no [DONE] — but signal is aborted so it should be AbortError not ProviderError
    ]);
    await expect(async () => {
      for await (const _d of readSseChatStream(stream, pid, label, controller.signal)) {
        // may yield some data before EOF
      }
    }).rejects.toSatisfy((err: unknown) =>
      err instanceof DOMException && err.name === "AbortError"
    );
  });

  it("throws ProviderError on upstream read failure (reader.read rejects)", async () => {
    const stream = makeFailingStream([
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
    ]);
    await expect(async () => {
      for await (const _d of readSseChatStream(stream, pid, label)) {
        // may yield partial before failure
      }
    }).rejects.toThrow(ProviderError);
  });

  it("handles multi-line content in a single chunk", async () => {
    const stream = makeStream([
      'data: {"choices":[{"delta":{"content":"line1\\nline2"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const deltas: string[] = [];
    for await (const d of readSseChatStream(stream, pid, label)) {
      deltas.push(d);
    }
    expect(deltas).toEqual(["line1\nline2"]);
  });

  it("handles JSON split across chunk boundaries", async () => {
    const stream = makeStream([
      'data: {"choi',
      'ces":[{"delta":{"content":"split"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const deltas: string[] = [];
    for await (const d of readSseChatStream(stream, pid, label)) {
      deltas.push(d);
    }
    expect(deltas).toEqual(["split"]);
  });

  it("captures final usage and reported cost from the accounting chunk", async () => {
    const stream = makeStream([
      'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"completion_tokens_details":{"reasoning_tokens":2},"prompt_tokens_details":{"cached_tokens":3}},"cost":0.00042}\n\n',
      "data: [DONE]\n\n",
    ]);
    const meta: SseMeta = { usage: null, cost: null };
    let text = "";
    for await (const delta of readSseChatStream(stream, pid, label, undefined, meta)) {
      text += delta;
    }
    expect(text).toBe("hello");
    expect(meta.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: null,
    });
    expect(meta.cost).toEqual({ usd: 0.00042, source: "provider-reported" });
  });
});
