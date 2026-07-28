import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { StreamDeltaBuffer, createStreamDeltaBuffer } from "./stream-buffer";

// The vitest environment is Node, so requestAnimationFrame / cancelAnimationFrame
// are not present. Stub them on globalThis before each test.
describe("StreamDeltaBuffer", () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextId: number;

  beforeEach(() => {
    rafCallbacks = new Map();
    nextId = 1;
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
      cb: FrameRequestCallback,
    ) => {
      const id = nextId++;
      rafCallbacks.set(id, cb);
      return id;
    };
    (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => {
      rafCallbacks.delete(id);
    };
  });

  afterEach(() => {
    delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
    delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
  });

  const runRaf = () => {
    const cbs = [...rafCallbacks.values()];
    rafCallbacks.clear();
    for (const cb of cbs) cb(0);
  };

  it("batches multiple deltas into one rAF flush", () => {
    const flushed: Array<[string, string]> = [];
    const buf = new StreamDeltaBuffer((id, delta) => flushed.push([id, delta]));

    buf.push("a", "Hello");
    buf.push("a", " world");
    buf.push("b", "foo");
    expect(flushed).toEqual([]); // nothing dispatched yet

    runRaf();
    expect(flushed).toEqual([
      ["a", "Hello world"],
      ["b", "foo"],
    ]);
  });

  it("schedules at most one rAF at a time", () => {
    const buf = new StreamDeltaBuffer(() => {});
    buf.push("a", "1");
    buf.push("a", "2");
    buf.push("a", "3");
    expect(rafCallbacks.size).toBe(1);
    runRaf();
    expect(rafCallbacks.size).toBe(0);
  });

  it("flush() is synchronous and idempotent", () => {
    const flushed: string[] = [];
    const buf = new StreamDeltaBuffer((_id, d) => flushed.push(d));
    buf.push("a", "x");
    buf.flush();
    buf.flush(); // no-op
    expect(flushed).toEqual(["x"]);
    expect(rafCallbacks.size).toBe(0);
  });

  it("cancel discards pending deltas and the scheduled rAF", () => {
    const flushed: string[] = [];
    const buf = new StreamDeltaBuffer((_id, d) => flushed.push(d));
    buf.push("a", "x");
    buf.cancel();
    expect(rafCallbacks.size).toBe(0);
    runRaf();
    expect(flushed).toEqual([]);
  });

  it("createStreamDeltaBuffer returns stable helpers", () => {
    const flushed: string[] = [];
    const { push, flush, cancel } = createStreamDeltaBuffer((_id, d) => flushed.push(d));
    push("a", "1");
    push("a", "2");
    flush();
    expect(flushed).toEqual(["12"]);
    push("a", "3");
    cancel();
    expect(flushed).toEqual(["12"]);
  });
});
