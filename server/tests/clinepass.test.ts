import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { handleClinePassProxy } from "../codex-bridge/clinepass.js";

function makeReq(body = "{}"): http.IncomingMessage {
  const req = new http.IncomingMessage(null as never);
  req.method = "POST";
  req.headers = { authorization: "Bearer test", "content-type": "application/json" };
  process.nextTick(() => {
    req.emit("data", Buffer.from(body));
    req.emit("end");
  });
  return req;
}

function makeRes(): http.ServerResponse & { written: Buffer[] } {
  const req = new http.IncomingMessage(null as never);
  const res = new http.ServerResponse(req) as http.ServerResponse & { written: Buffer[] };
  res.written = [];
  res.writeHead = vi.fn(() => res) as never;
  res.write = vi.fn((chunk: Buffer | Uint8Array) => {
    res.written.push(Buffer.from(chunk));
    return true;
  }) as never;
  res.end = vi.fn(() => res) as never;
  return res;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ClinePass bridge proxy", () => {
  it("forwards the request to the official Cline API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"data":[]}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = makeRes();

    await handleClinePassProxy(makeReq(), res, "/clinepass/v1/chat/completions");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cline.bot/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test" }),
      }),
    );
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "application/json" }),
    );
  });
});
