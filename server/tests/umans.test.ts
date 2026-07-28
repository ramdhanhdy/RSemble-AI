import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import { handleUmansProxy } from "../codex-bridge/umans";

function makeReq(method = "POST", body?: string): http.IncomingMessage {
  const req = new http.IncomingMessage(null as never);
  req.method = method;
  req.headers = { authorization: "Bearer test", "content-type": "application/json" };
  if (body !== undefined) {
    process.nextTick(() => {
      req.emit("data", Buffer.from(body));
      req.emit("end");
    });
  } else {
    process.nextTick(() => req.emit("end"));
  }
  return req;
}

function makeRes(): http.ServerResponse & { written: Buffer[] } {
  const req = new http.IncomingMessage(null as never);
  const res = new http.ServerResponse(req) as http.ServerResponse & { written: Buffer[] };
  res.written = [];
  res.writeHead = vi.fn(() => res) as never;
  res.write = vi.fn((chunk: Buffer) => {
    res.written.push(chunk);
    return true;
  }) as never;
  res.end = vi.fn(() => res) as never;
  return res;
}

function upstreamWithChunks(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("handleUmansProxy — plain proxy behavior", () => {
  it("forwards upstream status, content-type, and body chunks", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstreamWithChunks(['data: a\n\n', 'data: b\n\n'])));
    const res = makeRes();
    await handleUmansProxy(makeReq("POST", "{}"), res, "/umans/v1/chat/completions");
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "text/event-stream" }));
    expect(res.written).toHaveLength(2);
    expect(res.end).toHaveBeenCalled();
  });

  it("passes an AbortSignal to the upstream fetch and preserves upstream error status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"error":{"message":"bad key"}}', { status: 401, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = makeRes();
    await handleUmansProxy(makeReq("POST", "{}"), res, "/umans/v1/chat/completions");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.objectContaining({ "Content-Type": "application/json" }));
    // Plain-text/provider error body is forwarded untouched to the client.
    const body = Buffer.concat(res.written).toString();
    expect(body).toContain("bad key");
  });

  it("returns 502 JSON when the upstream is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ENOTFOUND")));
    const res = makeRes();
    await handleUmansProxy(makeReq("POST", "{}"), res, "/umans/v1/chat/completions");
    expect(res.writeHead).toHaveBeenCalledWith(502, expect.objectContaining({ "Content-Type": "application/json" }));
    const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(body.error.message).toContain("api.code.umans.ai");
  });
});

describe("handleUmansProxy — timeout", () => {
  it("returns 504 when the upstream stalls past the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        });
      }),
    );
    const res = makeRes();
    const promise = handleUmansProxy(makeReq("POST", "{}"), res, "/umans/v1/chat/completions", {
      upstreamTimeoutMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(6_000);
    await promise;
    expect(res.writeHead).toHaveBeenCalledWith(504, expect.objectContaining({ "Content-Type": "application/json" }));
    const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(body.error.type).toBe("upstream_timeout");
    vi.useRealTimers();
  });
});

describe("handleUmansProxy — backpressure", () => {
  it("waits for drain when the client socket buffer is full", async () => {
    const chunks = Array.from({ length: 4 }, (_, i) => `data: chunk-${i}\n\n`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstreamWithChunks(chunks)));

    const req = makeReq("POST", "{}");
    const res = new http.ServerResponse(new http.IncomingMessage(null as never));
    const drainListeners: Array<() => void> = [];
    const written: string[] = [];
    res.writeHead = vi.fn(() => res) as never;
    res.write = vi.fn((chunk: Buffer | Uint8Array) => {
      written.push(Buffer.from(chunk).toString());
      return false; // buffer always full
    }) as never;
    res.once = vi.fn((event: string, cb: () => void) => {
      if (event === "drain") drainListeners.push(cb);
      return res;
    }) as never;
    res.end = vi.fn(() => res) as never;

    const pumpPromise = handleUmansProxy(req, res, "/umans/v1/chat/completions");
    for (let i = 0; i < 50; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
      const listener = drainListeners.shift();
      if (!listener) {
        if ((res.end as ReturnType<typeof vi.fn>).mock.calls.length > 0) break;
        continue;
      }
      listener();
    }
    await pumpPromise;

    expect(written).toHaveLength(4);
    expect(written[0]).toContain("chunk-0");
    expect(written[3]).toContain("chunk-3");
    expect((res.once as ReturnType<typeof vi.fn>).mock.calls.some((c) => c[0] === "drain")).toBe(true);
    expect(res.end).toHaveBeenCalled();
  });
});
