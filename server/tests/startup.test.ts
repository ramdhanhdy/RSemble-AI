import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { listenOrReuseBridge, probeReusableBridge } from "../codex-bridge/startup.js";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function healthServer(payload: unknown): Promise<number> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

describe("bridge startup reuse", () => {
  it("reuses a marked RSemble bridge", async () => {
    const port = await healthServer({ status: "ok", service: "rsemble-codex-bridge" });
    await expect(probeReusableBridge("127.0.0.1", port)).resolves.toBe(true);
  });

  it("rejects an unrelated healthy service", async () => {
    const port = await healthServer({ status: "ok" });
    await expect(probeReusableBridge("127.0.0.1", port)).resolves.toBe(false);
  });

  it("returns reused when listen collides with a marked bridge", async () => {
    const port = await healthServer({ status: "ok", service: "rsemble-codex-bridge" });
    const duplicate = http.createServer();
    servers.push(duplicate);

    await expect(listenOrReuseBridge(duplicate, "127.0.0.1", port)).resolves.toBe("reused");
  });

  it("rejects when listen collides with an unrelated service", async () => {
    const port = await healthServer({ status: "ok" });
    const duplicate = http.createServer();
    servers.push(duplicate);

    await expect(listenOrReuseBridge(duplicate, "127.0.0.1", port)).rejects.toMatchObject({
      code: "EADDRINUSE",
    });
  });
});
