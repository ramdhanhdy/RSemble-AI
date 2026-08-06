// =============================================================================
// Bridge security tests — Plan 003 workstreams B and C
//
// Proves exact route allowlisting (unknown paths make zero upstream calls),
// method/content-type enforcement, bridge-secret authentication, and that the
// configured secret never appears in responses.
// =============================================================================

import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createBridgeServer } from "../codex-bridge/index";

const SECRET = "test-bridge-secret";

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

async function rawRequest(
  url: string,
  path: string,
  method: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; allow?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${url}${path}`, { method, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: data, allow: res.headers.allow }),
      );
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function upstreamOk(data = "{}"): Response {
  return new Response(data, { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.RSEMBLE_BRIDGE_SECRET;
});

// ---------------------------------------------------------------------------
// Exact route allowlisting — unknown paths never reach an upstream
// ---------------------------------------------------------------------------

describe("bridge — exact proxy allowlists (Plan 003 B)", () => {
  it.each([
    "/umans/v1/models",
    "/umans/v1/chat/completions",
    "/clinepass/v1/models",
    "/clinepass/v1/chat/completions",
    "/9router/v1/models",
    "/9router/v1/chat/completions",
  ])("approves the exact route %s", async (path) => {
    const method = path.endsWith("/models") ? "GET" : "POST";
    const fetchMock = vi.fn().mockResolvedValue(upstreamOk());
    vi.stubGlobal("fetch", fetchMock);
    const { server, url } = await startServer();
    try {
      const res = await rawRequest(url, path, method, method === "POST" ? "{}" : undefined, {
        "Content-Type": "application/json",
      });
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(server);
    }
  });

  it.each([
    "/umans/account",
    "/umans/v1/keys",
    "/umans/v1/models/extra",
    "/umans/v1/chat/completions/",
    "/umans",
    "/clinepass/anything",
    "/clinepass/api/v1/models",
    "/clinepass/v1/keys",
    "/9router/v1/models/extra",
    "/9router/control",
  ])(
    "rejects unknown or prefix-bypassing path %s with 404 and zero upstream calls",
    async (path) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const { server, url } = await startServer();
      try {
        const res = await rawRequest(url, path, "GET");
        expect(res.status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    },
  );

  it("forwards query strings only on an approved exact path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamOk());
    vi.stubGlobal("fetch", fetchMock);
    const { server, url } = await startServer();
    try {
      const res = await rawRequest(url, "/umans/v1/models?limit=5", "GET");
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.code.umans.ai/v1/models?limit=5",
        expect.any(Object),
      );
    } finally {
      await closeServer(server);
    }
  });

  it.each([
    ["PUT", "/umans/v1/models"],
    ["GET", "/umans/v1/chat/completions"],
    ["DELETE", "/clinepass/v1/models"],
    ["GET", "/clinepass/v1/chat/completions"],
    ["PATCH", "/9router/v1/chat/completions"],
  ])("returns 405 with an exact Allow header for %s %s", async (method, path) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { server, url } = await startServer();
    try {
      const res = await rawRequest(url, path, method, "{}", { "Content-Type": "application/json" });
      expect(res.status).toBe(405);
      expect(JSON.parse(res.body).error.type).toBe("method_not_allowed");
      const allow = (res.allow ?? "").split(",").map((s) => s.trim());
      expect(allow).toContain("OPTIONS");
      // The allowed method is the route's own method, regardless of the
      // unsupported method used in the request.
      const expectedRouteMethod = path.endsWith("/models") ? "GET" : "POST";
      expect(allow).toContain(expectedRouteMethod);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it("omits blank Authorization instead of forwarding an empty bearer value", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamOk());
    vi.stubGlobal("fetch", fetchMock);
    const { server, url } = await startServer();
    try {
      const res = await rawRequest(url, "/umans/v1/models", "GET", undefined, {
        Authorization: " ",
      });
      expect(res.status).toBe(200);
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    } finally {
      await closeServer(server);
    }
  });
});

// ---------------------------------------------------------------------------
// Bridge secret authentication — Plan 002 D3 / Plan 003 C
// ---------------------------------------------------------------------------

describe("bridge — configured secret is enforced (Plan 002 D3)", () => {
  async function withSecret(fn: (url: string) => Promise<void>): Promise<void> {
    process.env.RSEMBLE_BRIDGE_SECRET = SECRET;
    const { server, url } = await startServer();
    try {
      await fn(url);
    } finally {
      await closeServer(server);
    }
  }

  it("keeps /health public when a secret is configured", async () => {
    await withSecret(async (url) => {
      const res = await fetch(`${url}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("ok");
    });
  });

  it("keeps /auth/status public metadata when a secret is configured", async () => {
    await withSecret(async (url) => {
      const res = await fetch(`${url}/auth/status`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(typeof body.ok).toBe("boolean");
    });
  });

  it.each([
    ["GET", "/v1/models"],
    ["GET", "/umans/v1/models"],
    ["GET", "/clinepass/v1/models"],
    ["GET", "/9router/v1/models"],
  ])(
    "rejects %s %s with 401 bridge_auth_required when the header is missing",
    async (method, path) => {
      await withSecret(async (url) => {
        const res = await rawRequest(url, path, method);
        expect(res.status).toBe(401);
        expect(JSON.parse(res.body).error.type).toBe("bridge_auth_required");
      });
    },
  );

  it.each([
    ["POST", "/v1/chat/completions"],
    ["POST", "/umans/v1/chat/completions"],
    ["POST", "/clinepass/v1/chat/completions"],
    ["POST", "/9router/v1/chat/completions"],
  ])("rejects %s %s with 401 bridge_auth_invalid for a wrong secret", async (method, path) => {
    await withSecret(async (url) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const res = await rawRequest(url, path, method, "{}", {
        "Content-Type": "application/json",
        "X-RSemble-Bridge-Secret": "wrong-secret",
      });
      expect(res.status).toBe(401);
      expect(JSON.parse(res.body).error.type).toBe("bridge_auth_invalid");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("accepts protected routes with the correct secret", async () => {
    await withSecret(async (url) => {
      const fetchMock = vi.fn().mockResolvedValue(upstreamOk());
      vi.stubGlobal("fetch", fetchMock);
      const res = await rawRequest(url, "/umans/v1/models", "GET", undefined, {
        "X-RSemble-Bridge-Secret": SECRET,
      });
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("never echoes the configured secret in any response body", async () => {
    await withSecret(async (url) => {
      const missing = await rawRequest(url, "/v1/models", "GET");
      const wrong = await rawRequest(url, "/v1/models", "GET", undefined, {
        "X-RSemble-Bridge-Secret": "not-the-secret",
      });
      const unknown = await rawRequest(url, "/definitely-not-a-route", "GET");
      expect(missing.body).not.toContain(SECRET);
      expect(wrong.body).not.toContain(SECRET);
      expect(unknown.body).not.toContain(SECRET);
    });
  });

  it("advertises X-RSemble-Bridge-Secret in CORS preflight", async () => {
    process.env.RSEMBLE_BRIDGE_SECRET = SECRET;
    const { server, url } = await startServer();
    try {
      const res = await fetch(`${url}/v1/models`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
        },
      });
      expect(res.status).toBe(204);
      const allowHeaders = res.headers.get("access-control-allow-headers") ?? "";
      expect(allowHeaders).toContain("X-RSemble-Bridge-Secret");
    } finally {
      await closeServer(server);
    }
  });
});

describe("bridge — unconfigured secret keeps existing behavior", () => {
  it("serves protected routes without any header when no secret is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamOk());
    vi.stubGlobal("fetch", fetchMock);
    const { server, url } = await startServer();
    try {
      const res = await rawRequest(url, "/umans/v1/models", "GET");
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(server);
    }
  });
});
