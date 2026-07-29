import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import http from "node:http";
import { handleNineRouterProxy, configuredNineRouterUpstream } from "../codex-bridge/nine-router";

function makeReq(
  method = "POST",
  body?: string,
  headers: Record<string, string> = { authorization: "Bearer test", "content-type": "application/json" },
): http.IncomingMessage {
  const req = new http.IncomingMessage(null as never);
  req.method = method;
  req.headers = headers;
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

beforeEach(() => {
  delete process.env.RSEMBLE_9ROUTER_URL;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.RSEMBLE_9ROUTER_URL;
});

// ---------------------------------------------------------------------------
// Upstream configuration
// ---------------------------------------------------------------------------

describe("configuredNineRouterUpstream", () => {
  it("defaults to http://127.0.0.1:20128", () => {
    expect(configuredNineRouterUpstream()).toBe("http://127.0.0.1:20128");
  });

  it("reads RSEMBLE_9ROUTER_URL and strips trailing slashes", () => {
    process.env.RSEMBLE_9ROUTER_URL = "http://192.168.1.50:9090/";
    expect(configuredNineRouterUpstream()).toBe("http://192.168.1.50:9090");
  });

  it("rejects file: protocol", () => {
    process.env.RSEMBLE_9ROUTER_URL = "file:///etc/passwd";
    expect(() => configuredNineRouterUpstream()).toThrow(/invalid/i);
  });

  it("rejects javascript: protocol", () => {
    process.env.RSEMBLE_9ROUTER_URL = "javascript:alert(1)";
    expect(() => configuredNineRouterUpstream()).toThrow(/invalid/i);
  });
});

// ---------------------------------------------------------------------------
// Proxy forwarding
// ---------------------------------------------------------------------------

describe("handleNineRouterProxy — forwarding", () => {
  it("maps GET /9router/v1/models to <upstream>/v1/models preserving query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamWithChunks(['data: {"object":"list"}']));
    vi.stubGlobal("fetch", fetchMock);
    const res = makeRes();
    await handleNineRouterProxy(
      makeReq("GET", undefined, {}),
      res,
      "/9router/v1/models?limit=50",
      { upstream: "http://127.0.0.1:20128" },
    );
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:20128/v1/models?limit=50");
  });

  it("forwards POST /9router/v1/chat/completions and streams response bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamWithChunks(["data: hello\n\n", "data: world\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    const res = makeRes();
    await handleNineRouterProxy(
      makeReq("POST", '{"model":"test"}'),
      res,
      "/9router/v1/chat/completions",
      { upstream: "http://127.0.0.1:20128" },
    );
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "text/event-stream" }));
    expect(res.written).toHaveLength(2);
    expect(res.end).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Authorization header handling
// ---------------------------------------------------------------------------

describe("handleNineRouterProxy — authorization", () => {
  it("omits the Authorization header upstream when incoming auth is blank", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamWithChunks(['data: {"object":"list"}']));
    vi.stubGlobal("fetch", fetchMock);
    const res = makeRes();
    await handleNineRouterProxy(
      makeReq("GET", undefined, {}),
      res,
      "/9router/v1/models",
      { upstream: "http://127.0.0.1:20128" },
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
  });

  it("forwards a supplied Bearer header unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamWithChunks(['data: {"object":"list"}']));
    vi.stubGlobal("fetch", fetchMock);
    const res = makeRes();
    await handleNineRouterProxy(
      makeReq("GET", undefined, { authorization: "Bearer sk-[REDACTED]" }),
      res,
      "/9router/v1/models",
      { upstream: "http://127.0.0.1:20128" },
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-[REDACTED]");
  });

  it("never includes the key in error messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ENOTFOUND")));
    const res = makeRes();
    await handleNineRouterProxy(
      makeReq("POST", "{}", { authorization: "Bearer sk-[REDACTED]", "content-type": "application/json" }),
      res,
      "/9router/v1/chat/completions",
      { upstream: "http://127.0.0.1:20128" },
    );
    const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(body.error.message).not.toContain("sk-[REDACTED]");
    expect(body.error.message).not.toContain("Bearer");
  });
});

// ---------------------------------------------------------------------------
// Redirect rejection
// ---------------------------------------------------------------------------

describe("handleNineRouterProxy — redirect rejection", () => {
  it("rejects a 302 upstream redirect without following it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("", { status: 302, headers: { Location: "http://evil.example.com" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = makeRes();
    await handleNineRouterProxy(
      makeReq("GET", undefined, {}),
      res,
      "/9router/v1/models",
      { upstream: "http://127.0.0.1:20128" },
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("manual");
    // 3xx must be treated as an error, not forwarded.
    const status = (res.writeHead as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(status).not.toBe(302);
    expect(status).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// Client disconnect / abort
// ---------------------------------------------------------------------------

describe("handleNineRouterProxy — abort propagation", () => {
  it("passes an AbortSignal to the upstream fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamWithChunks(["data: ok\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    const res = makeRes();
    await handleNineRouterProxy(
      makeReq("POST", "{}"),
      res,
      "/9router/v1/chat/completions",
      { upstream: "http://127.0.0.1:20128" },
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
