import http from "node:http";

export const BRIDGE_SERVICE = "rsemble-codex-bridge";

/** Return true only when the occupied port belongs to a marked RSemble bridge. */
export function probeReusableBridge(
  host: string,
  port: number,
  timeoutMs = 1_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: "/health", timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          const payload = JSON.parse(body) as { status?: string; service?: string };
          resolve(
            res.statusCode === 200 && payload.status === "ok" && payload.service === BRIDGE_SERVICE,
          );
        } catch {
          resolve(false);
        }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

export type BridgeStartResult = "listening" | "reused";

/** Listen normally, or reuse an already-running marked bridge on the same address. */
export function listenOrReuseBridge(
  server: http.Server,
  host: string,
  port: number,
): Promise<BridgeStartResult> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error & { code?: string }) => {
      if (error.code !== "EADDRINUSE") {
        reject(error);
        return;
      }
      void probeReusableBridge(host, port).then((reusable) => {
        if (reusable) resolve("reused");
        else reject(error);
      });
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.removeListener("error", onError);
      resolve("listening");
    });
  });
}
