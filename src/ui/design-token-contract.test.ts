import { describe, expect, it } from "vitest";
// @ts-expect-error JS config has no type declarations
import config from "../../tailwind.config.js";

const extend = config.theme?.extend;

describe("design tokens", () => {
  it("matches the approved industrial surface palette", () => {
    expect(extend?.colors).toMatchObject({
      canvas: "#0a0a0a",
      panel: "#121212",
      card: { DEFAULT: "#121212", hover: "#1a1a1a" },
      edge: { DEFAULT: "#262626" },
      accent: { DEFAULT: "#00e5ff" },
      text: { DEFAULT: "#ededed", secondary: "#a1a1a1" },
      success: "#00ff9d",
      warning: "#ffb300",
      error: "#ff4d4d",
    });
  });

  it("uses the documented compact radius scale", () => {
    expect(extend?.borderRadius).toEqual({ sm: "4px", md: "6px", lg: "8px" });
  });
});
