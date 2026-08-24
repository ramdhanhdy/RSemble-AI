// @vitest-environment node
// Static accounting must reject newly introduced Fusion product references until
// a reviewer classifies their exact source path. This guards against a broad
// fallback bucket silently preserving a new competing authority.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");
const probe = resolve(ROOT, "src", "fusion-accounting-unclassified-probe.ts");

function runAccounting(): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, ["scripts/fusion-accounting.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failed.status ?? 1, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

afterEach(() => {
  if (existsSync(probe)) rmSync(probe);
});

describe("fusion accounting", () => {
  it("fails closed for an unclassified product Fusion hit", () => {
    writeFileSync(probe, 'export const probe = "fusion";\n', "utf8");
    const result = runAccounting();
    expect(result.status).toBe(1);
    expect(result.output).toContain("fusion-accounting-unclassified-probe.ts");
    expect(result.output).toContain("UNEXPLAINED");
  });
});
