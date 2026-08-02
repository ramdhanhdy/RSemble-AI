import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("press feedback contract", () => {
  it("uses press feedback on physical buttons but not data surfaces", () => {
    expect(read("src/ui/RunButton.tsx")).toContain("pressable");
    expect(read("src/ui/ModeToggle.tsx")).toContain("pressable");
    expect(read("src/ui/ModelList.tsx")).toContain("pressable");
    expect(read("src/ui/EvaluationDisclosure.tsx")).toContain("pressable");
    expect(read("src/ui/TaskInput.tsx")).toContain("pressable");
    expect(read("src/ui/RecordRow.tsx")).not.toContain("pressable");
    expect(read("src/workspaces/evaluations/ResultMatrix.tsx")).not.toContain("pressable");
    expect(read("src/ui/CommandPalette.tsx")).not.toContain("pressable");
  });
});
