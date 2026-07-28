import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createBridgeServer } from "../codex-bridge/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface StartedServer {
  server: http.Server;
  port: number;
  url: string;
}

function startServer(overrides?: Parameters<typeof createBridgeServer>[0]): Promise<StartedServer> {
  const server = createBridgeServer(overrides);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function rawPost(
  url: string,
  path: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${url}${path}`,
      { method: "POST", headers: { "Content-Type": "application/json", ...headers } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function rawRequest(
  url: string,
  path: string,
  method: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${url}${path}`, { method, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Request size limit
// ---------------------------------------------------------------------------

describe("bridge — request size limit", () => {
  it("rejects POST /v1/chat/completions bodies larger than the limit with 413", async () => {
    const { server, url } = await startServer({ maxBodyBytes: 128 });
    try {
      const oversized = JSON.stringify({ model: "m", messages: [], pad: "x".repeat(512) });
      const res = await rawPost(url, "/v1/chat/completions", oversized);
      expect(res.status).toBe(413);
      expect(JSON.parse(res.body).error.type).toBe("request_too_large");
    } finally {
      await closeServer(server);
    }
  });

  it("destroys the socket on oversize so the client cannot keep streaming", async () => {
    const { server, port } = await startServer({ maxBodyBytes: 16 });
    try {
      const outcome = await new Promise<{ status?: number; errored: boolean }>((resolve) => {
        const req = http.request(
          {
            port,
            host: "127.0.0.1",
            path: "/v1/chat/completions",
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
          (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => resolve({ status: res.statusCode, errored: false }));
          },
        );
        req.on("error", () => resolve({ errored: true }));
        req.write("x".repeat(4096));
        req.end();
      });
      // Either the server responded 413 before destroy, or the socket errored —
      // both prove the connection did not proceed to upstream handling.
      expect(outcome.status === 413 || outcome.errored).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it("accepts bodies under the limit (400 on invalid JSON proves body was read)", async () => {
    const { server, url } = await startServer({ maxBodyBytes: 1024 });
    try {
      const res = await rawPost(url, "/v1/chat/completions", "not json");
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error.type).toBe("invalid_request");
    } finally {
      await closeServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Malformed request body rejection
// ---------------------------------------------------------------------------

describe("bridge — request error rejection", () => {
  it("rejects with 400 when the request stream errors mid-body", async () => {
    const { server, port } = await startServer();
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { port, host: "127.0.0.1", path: "/v1/chat/completions", method: "POST" },
          (res) => resolve(res.statusCode ?? 0),
        );
        req.on("error", reject);
        req.write('{"model":"m"');
        // Force a request error after partial body
        req.destroy(new Error("client reset"));
      }).catch(() => -1);
      // Server must not hang or crash; it either answered 400 or the socket died.
      expect([400, -1]).toContain(status);
    } finally {
      await closeServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Health/models endpoints
// ---------------------------------------------------------------------------

describe("bridge — static endpoints", () => {
  it("GET /health returns ok", async () => {
    const { server, url } = await startServer();
    try {
      const res = await fetch(`${url}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    } finally {
      await closeServer(server);
    }
  });

  it("GET /v1/models returns the codex catalog", async () => {
    const { server, url } = await startServer();
    try {
      const res = await fetch(`${url}/v1/models`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { data: Array<{ id: string; providerId: string }> };
      expect(json.data.length).toBeGreaterThan(0);
      expect(json.data.every((m) => m.providerId === "chatgpt-codex")).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it("unknown route returns 404 JSON", async () => {
    const { server, url } = await startServer();
    try {
      const res = await fetch(`${url}/nope`);
      expect(res.status).toBe(404);
      const json = (await res.json()) as { error: { message: string } };
      expect(json.error.message).toContain("Not found");
    } finally {
      await closeServer(server);
    }
  });
});

describe("bridge — browser credential-route policy", () => {
  it("rejects a hostile Origin before a credential-backed route is handled", async () => {
    const { server, url } = await startServer();
    try {
      const res = await rawRequest(url, "/v1/chat/completions", "POST", "{}", {
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
      });
      expect(res.status).toBe(403);
      expect(JSON.parse(res.body).error.type).toBe("origin_not_allowed");
    } finally {
      await closeServer(server);
    }
  });

  it("rejects text/plain POSTs that could bypass browser preflight", async () => {
    const { server, url } = await startServer();
    try {
      const res = await rawRequest(url, "/v1/chat/completions", "POST", "{}", {
        Origin: "http://localhost:5173",
        "Content-Type": "text/plain",
      });
      expect(res.status).toBe(415);
      expect(JSON.parse(res.body).error.type).toBe("unsupported_media_type");
    } finally {
      await closeServer(server);
    }
  });

  it("rejects hostile preflight requests", async () => {
    const { server, url } = await startServer();
    try {
      const res = await rawRequest(url, "/umans/v1/models", "OPTIONS", undefined, {
        Origin: "https://attacker.example",
        "Access-Control-Request-Method": "GET",
      });
      expect(res.status).toBe(403);
    } finally {
      await closeServer(server);
    }
  });

  it("allows no-Origin local clients and explicitly allowlisted browser origins", async () => {
    const { server, url } = await startServer({ allowedOrigins: ["https://trusted.example"] });
    try {
      const cli = await fetch(`${url}/v1/models`);
      expect(cli.status).toBe(200);
      const browser = await rawRequest(url, "/v1/models", "GET", undefined, {
        Origin: "https://trusted.example",
      });
      expect(browser.status).toBe(200);
    } finally {
      await closeServer(server);
    }
  });
});

describe("bridge — Umans request safety", () => {
  it("rejects oversized Umans POST bodies before calling upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { server, url } = await startServer({ maxBodyBytes: 32 });
    try {
      const res = await rawRequest(url, "/umans/v1/chat/completions", "POST", JSON.stringify({ pad: "x".repeat(128) }), {
        "Content-Type": "application/json",
      });
      expect(res.status).toBe(413);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it.each(["PUT", "PATCH", "DELETE"])("rejects unsupported Umans %s requests", async (method) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { server, url } = await startServer();
    try {
      const res = await rawRequest(url, "/umans/v1/models", method, undefined, {
        "Content-Type": "application/json",
      });
      expect(res.status).toBe(405);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it("rejects non-JSON Umans POST bodies", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { server, url } = await startServer();
    try {
      const res = await rawRequest(url, "/umans/v1/chat/completions", "POST", "{}", {
        "Content-Type": "text/plain",
      });
      expect(res.status).toBe(415);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });
});
