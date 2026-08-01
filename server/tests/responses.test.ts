import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import { handleCompletions, DEFAULT_UPSTREAM_TIMEOUT_MS, type CompletionRequestBody } from "../codex-bridge/responses";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeRes(): http.ServerResponse {
  const req = new http.IncomingMessage(null as never);
  const res = new http.ServerResponse(req);
  res.write = vi.fn(() => true) as never;
  res.end = vi.fn(() => res) as never;
  res.writeHead = vi.fn(() => res) as never;
  return res;
}

function authOk() {
  return { token: "test-token", accountId: "acct-1" };
}

const BASE_BODY: CompletionRequestBody = {
  model: "gpt-5.6-sol",
  messages: [{ role: "user", content: "hello" }],
  stream: true,
};

function sseUpstream(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Upstream timeout
// ---------------------------------------------------------------------------

describe("handleCompletions — upstream timeout", () => {
  it("exports a sane default upstream timeout", () => {
    expect(DEFAULT_UPSTREAM_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
  });

  it("returns 504 when the upstream fetch never resolves within the timeout", async () => {
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
    const promise = handleCompletions(BASE_BODY, res, {
      getToken: authOk,
      upstreamTimeoutMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(6_000);
    await promise;
    expect(res.writeHead).toHaveBeenCalledWith(504, expect.objectContaining({ "Content-Type": "application/json" }));
    const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(body.error.type).toBe("upstream_timeout");
  });

  it("passes an AbortSignal to the upstream fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseUpstream(['data: {"type":"response.output_text.delta","delta":"hi"}\n\n', "data: [DONE]\n\n"]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = makeRes();
    await handleCompletions(BASE_BODY, res, { getToken: authOk });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps an active stream alive when total generation time exceeds the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const timers: ReturnType<typeof setTimeout>[] = [];
            const enqueue = (delay: number, text: string) => {
              timers.push(setTimeout(() => controller.enqueue(encoder.encode(text)), delay));
            };
            enqueue(30, 'data: {"type":"response.output_text.delta","delta":"one"}\n\n');
            enqueue(60, 'data: {"type":"response.output_text.delta","delta":"two"}\n\n');
            enqueue(90, "data: [DONE]\n\n");
            init?.signal?.addEventListener("abort", () => {
              timers.forEach(clearTimeout);
              controller.error(new DOMException("The operation was aborted.", "AbortError"));
            });
          },
        });
        return Promise.resolve(
          new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
        );
      }),
    );

    const res = makeRes();
    const promise = handleCompletions(BASE_BODY, res, {
      getToken: authOk,
      upstreamTimeoutMs: 50,
    });

    await vi.advanceTimersByTimeAsync(120);
    await promise;

    const writes = (res.write as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
    expect(writes.some((chunk) => chunk.includes('"content":"one"'))).toBe(true);
    expect(writes.some((chunk) => chunk.includes('"content":"two"'))).toBe(true);
    expect(writes).toContain("data: [DONE]\n\n");
  });
});

// ---------------------------------------------------------------------------
// Response backpressure
// ---------------------------------------------------------------------------

describe("handleCompletions — backpressure", () => {
  it("waits for drain when res.write returns false before writing more", async () => {
    const deltas = Array.from({ length: 5 }, (_, i) => `chunk-${i}`);
    const lines = [
      ...deltas.map((d) => `data: {"type":"response.output_text.delta","delta":"${d}"}\n\n`),
      "data: [DONE]\n\n",
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseUpstream(lines)));

    const req = new http.IncomingMessage(null as never);
    const res = new http.ServerResponse(req);
    const drainListeners: Array<() => void> = [];
    const writtenChunks: string[] = [];
    res.write = vi.fn((chunk: string) => {
      writtenChunks.push(chunk);
      // Always report a full buffer so the pump must wait for drain.
      return false;
    }) as never;
    res.once = vi.fn((event: string, cb: () => void) => {
      if (event === "drain") drainListeners.push(cb);
      return res;
    }) as never;
    res.writeHead = vi.fn(() => res) as never;
    res.end = vi.fn(() => res) as never;

    const pumpPromise = handleCompletions(BASE_BODY, res, { getToken: authOk });

    // Drive drain events until the pump completes. If the implementation did
    // not wait for drain, all writes would already be queued and this loop
    // simply finishes; if it deadlocks waiting for drain, the test times out.
    for (let i = 0; i < 50; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
      const listener = drainListeners.shift();
      if (!listener) {
        // No pending drain wait: pump is either done or blocked elsewhere.
        if ((res.end as ReturnType<typeof vi.fn>).mock.calls.length > 0) break;
        continue;
      }
      listener();
    }

    await pumpPromise;

    const sseWrites = writtenChunks.filter((c) => c.startsWith("data: "));
    // 5 delta chunks + 1 [DONE] frame must all have been written in order.
    expect(sseWrites.length).toBe(6);
    expect(sseWrites[0]).toContain("chunk-0");
    expect(sseWrites[4]).toContain("chunk-4");
    expect(sseWrites[5]).toBe("data: [DONE]\n\n");
    // The pump must have registered at least one drain wait (buffer was full).
    expect((res.once as ReturnType<typeof vi.fn>).mock.calls.some((c) => c[0] === "drain")).toBe(true);
    expect(res.end).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Headers-sent-safe stream errors
// ---------------------------------------------------------------------------

describe("handleCompletions — headers-sent-safe stream errors", () => {
  it("on mid-stream upstream failure after headers sent: ends stream, no second writeHead", async () => {
    const encoder = new TextEncoder();
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        if (reads === 1) {
          controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"partial"}\n\n'));
        } else {
          controller.error(new Error("upstream exploded"));
        }
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      ),
    );

    const res = makeRes();
    // Simulate headers already sent (streaming began).
    Object.defineProperty(res, "headersSent", { value: true, writable: true });

    await handleCompletions(BASE_BODY, res, { getToken: authOk });

    // writeHead called exactly once for the initial 200 SSE response —
    // the error path must NOT attempt to writeHead(500) after headers sent.
    const writeHeadCalls = (res.writeHead as ReturnType<typeof vi.fn>).mock.calls;
    expect(writeHeadCalls).toHaveLength(1);
    expect(writeHeadCalls[0][0]).toBe(200);
    expect(res.end).toHaveBeenCalled();
  });

  it("on upstream failure before headers sent: still responds 500 JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    const res = makeRes();
    await handleCompletions(BASE_BODY, res, { getToken: authOk });
    expect(res.writeHead).toHaveBeenCalledWith(500, expect.objectContaining({ "Content-Type": "application/json" }));
    const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(body.error.type).toBe("bridge_internal_error");
  });
});

// ---------------------------------------------------------------------------
// Auth failure still returns 401
// ---------------------------------------------------------------------------

describe("handleCompletions — auth", () => {
  it("returns 401 JSON when token retrieval fails", async () => {
    const res = makeRes();
    await handleCompletions(BASE_BODY, res, {
      getToken: () => {
        throw new Error("Not authenticated");
      },
    });
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.objectContaining({ "Content-Type": "application/json" }));
  });
});

// ---------------------------------------------------------------------------
// Content-array translation — attachments plan 7.4.3
// ---------------------------------------------------------------------------

function captureUpstreamBody(fetchMock: ReturnType<typeof vi.fn>) {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string);
}

describe("handleCompletions — content parts (7.4.3)", () => {
  it("keeps the all-string upstream body byte-identical to pre-attachments", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "r1", output: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = makeRes();
    await handleCompletions(
      {
        model: "gpt-5.6-sol",
        messages: [
          { role: "system", content: "You are a judge." },
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi there" },
        ],
        stream: true,
      },
      res,
      { getToken: authOk },
    );

    const body = captureUpstreamBody(fetchMock);
    expect(body.input).toEqual([{ role: "user", content: "hello\n\nAssistant: hi there" }]);
    expect(body.instructions).toBe("You are a judge.");
    // Legacy flattening: the input item has no type wrapper and no part array.
    expect(body.input[0]).toEqual({ role: "user", content: "hello\n\nAssistant: hi there" });
  });

  it("translates text and image_url parts to Responses API input items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "r1", output: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = makeRes();
    await handleCompletions(
      {
        model: "gpt-5.6-sol",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "read this chart" },
              { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo" } },
            ],
          },
        ],
        stream: true,
      },
      res,
      { getToken: authOk },
    );

    const body = captureUpstreamBody(fetchMock);
    expect(body.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "read this chart" },
          { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo" },
        ],
      },
    ]);
    expect(body.instructions).toBe("You are a helpful, rigorous assistant.");
  });

  it("preserves roles and wraps string messages alongside part messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "r1", output: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = makeRes();
    await handleCompletions(
      {
        model: "gpt-5.6-sol",
        messages: [
          { role: "assistant", content: "first answer" },
          { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } }] },
        ],
        stream: true,
      },
      res,
      { getToken: authOk },
    );

    const body = captureUpstreamBody(fetchMock);
    expect(body.input).toEqual([
      { type: "message", role: "assistant", content: [{ type: "input_text", text: "first answer" }] },
      { type: "message", role: "user", content: [{ type: "input_image", image_url: "data:image/jpeg;base64,AAAA" }] },
    ]);
  });

  it("rejects file parts with HTTP 415 before any auth or upstream call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = makeRes();
    await handleCompletions(
      {
        model: "gpt-5.6-sol",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "summarize" },
              { type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBER" } },
            ],
          },
        ],
        stream: true,
      },
      res,
      {
        getToken: () => {
          throw new Error("must not be called");
        },
      },
    );

    expect(res.writeHead).toHaveBeenCalledWith(415, expect.objectContaining({ "Content-Type": "application/json" }));
    const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(body.error.type).toBe("unsupported_media_type");
    expect(body.error.message).toContain("report.pdf");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
