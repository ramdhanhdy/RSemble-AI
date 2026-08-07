import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/ui/ConnectionsModal.tsx"), "utf8");

describe("ConnectionsModal", () => {
  it("uses the shared Base UI dialog instead of bespoke focus handling", () => {
    expect(source).toContain('import { DialogSurface } from "./DialogSurface"');
    expect(source).toContain("<DialogSurface");
    expect(source).not.toContain("useDialogA11y");
    expect(source).not.toMatch(/role="dialog"|aria-modal="true"/);
  });

  it("offers a test connection action for API-key providers", () => {
    expect(source).toContain("aria-label={`Test ${d.label} connection`}");
    expect(source).toContain('id: "clinepass"');
    expect(source).toContain('id: "openrouter"');
  });

  it("offers a test connection action for 9Router with optional-key guidance", () => {
    expect(source).toContain('id: "9router"');
    expect(source).toContain("key is optional");
  });

  it("invalidates model probe results when a credential is saved", () => {
    expect(source).toContain("useModelProbe");
    expect(source).toContain("invalidateProvider(providerId)");
    expect(source).toContain("const { invalidateProvider } = useModelProbe()");
  });
});
