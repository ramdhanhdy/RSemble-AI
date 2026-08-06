// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JudgeConfig, JudgeCombobox } from "./JudgeConfig";
import type { Action } from "../studio-engine";
import type { CatalogModel } from "../lib/providers/types";
import type { Attachment } from "../lib/attachments/types";

const noop: React.Dispatch<Action> = () => undefined;
const NO_MODELS: CatalogModel[] = [];

const baseProps = {
  critic: { providerId: "openrouter" as const, model: "z-ai/glm-5.2" },
  models: NO_MODELS,
  dispatch: noop,
  attachments: [] as Attachment[],
  attachmentsToJudge: true,
};

describe("JudgeConfig — judge custom instruction input", () => {
  it("renders a clearly labelled optional judge-instruction input", () => {
    const html = renderToStaticMarkup(
      <JudgeConfig {...baseProps} judgeInstruction="" attachments={[]} attachmentsToJudge={true} />,
    );
    // A visible label identifying it as the judge instruction.
    expect(html.toLowerCase()).toMatch(/judge instruction/);
  });

  it("renders concise helper text explaining the instruction is optional", () => {
    const html = renderToStaticMarkup(
      <JudgeConfig {...baseProps} judgeInstruction="" attachments={[]} attachmentsToJudge={true} />,
    );
    // Helper text must mention "optional" (or equivalent) so the user knows it
    // is not required and is judge-scoped.
    expect(html.toLowerCase()).toMatch(/optional/);
  });

  it("the instruction textarea is accessible via an associated label", () => {
    const html = renderToStaticMarkup(
      <JudgeConfig {...baseProps} judgeInstruction="" attachments={[]} attachmentsToJudge={true} />,
    );
    // There must be a label[for] pointing at the input's id, or an
    // aria-label on the input itself, so AT users can reach it.
    expect(html).toMatch(/id="judge-instruction"/);
    expect(html).toMatch(/for="judge-instruction"/);
  });

  it("shows the current judgeInstruction value in the input", () => {
    const html = renderToStaticMarkup(
      <JudgeConfig {...baseProps} judgeInstruction="Prefer brevity." />,
    );
    expect(html).toContain("Prefer brevity.");
  });

  it("the input meets the 44px touch-target minimum (WCAG 2.5.5)", () => {
    const html = renderToStaticMarkup(
      <JudgeConfig {...baseProps} judgeInstruction="" attachments={[]} attachmentsToJudge={true} />,
    );
    const match = html.match(/<(textarea)[^>]*id="judge-instruction"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/min-h-\[44px\]|h-11/);
  });
});

// ---------------------------------------------------------------------------
// JudgeCombobox — provider switch, initial provider, and clear-X (run-recovery spec §6)
// ---------------------------------------------------------------------------

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
  byText: (t: string) => HTMLElement | undefined;
}

function render(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
    byText: (t) =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => b.textContent?.trim() === t,
      ),
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

function typeInto(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const GEMINI_MODELS: CatalogModel[] = [
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", providerId: "gemini" },
];

describe("JudgeConfig — Judge combobox provider switch and clear-X", () => {
  it("opens on the current Judge provider, not always OpenRouter", () => {
    const dispatched: Action[] = [];
    const h = render(
      <JudgeConfig
        critic={{ providerId: "gemini", model: "gemini-3.1-pro-preview" }}
        models={GEMINI_MODELS}
        dispatch={(a) => dispatched.push(a)}
        judgeInstruction=""
        attachments={[]}
        attachmentsToJudge={true}
      />,
    );
    try {
      // Open the editor.
      const changeBtn = h.$('button[aria-label^="Change judge model"]') as HTMLButtonElement;
      act(() => changeBtn.click());

      const geminiTab = h.byText("Gemini")!;
      const openrouterTab = h.byText("OpenRouter")!;
      expect(geminiTab.getAttribute("aria-pressed")).toBe("true");
      expect(openrouterTab.getAttribute("aria-pressed")).toBe("false");
    } finally {
      cleanup(h);
    }
  });

  it("switching providers clears the current query and focuses the input", () => {
    const h = render(
      <JudgeCombobox
        models={GEMINI_MODELS}
        current="gemini-3.1-pro-preview"
        initialProvider="gemini"
        onCancel={() => {}}
        onCommit={() => {}}
      />,
    );
    try {
      const input = h.$("input#judge-search") as HTMLInputElement;
      // The editor opens with an empty query (full catalog visible); type a
      // Gemini id, then switch providers and assert it is cleared + focused.
      typeInto(input, "gemini-3.1-pro-preview");
      expect(input.value).toBe("gemini-3.1-pro-preview");

      const openrouterTab = h.byText("OpenRouter")!;
      act(() => openrouterTab.click());

      const after = h.$("input#judge-search") as HTMLInputElement;
      expect(after.value).toBe("");
      expect(document.activeElement).toBe(after);
    } finally {
      cleanup(h);
    }
  });

  it("X clears a non-empty query without dispatching SET_CRITIC or closing", () => {
    const dispatched: Action[] = [];
    const h = render(
      <JudgeConfig
        critic={{ providerId: "openrouter", model: "z-ai/glm-5.2" }}
        models={NO_MODELS}
        dispatch={(a) => dispatched.push(a)}
        judgeInstruction=""
        attachments={[]}
        attachmentsToJudge={true}
      />,
    );
    try {
      const changeBtn = h.$('button[aria-label^="Change judge model"]') as HTMLButtonElement;
      act(() => changeBtn.click());

      const input = h.$("input#judge-search") as HTMLInputElement;
      typeInto(input, "openai/gpt-4o");

      const xBtn = h.$('button[aria-label="Clear judge model search"]') as HTMLButtonElement;
      expect(xBtn).not.toBeNull();
      act(() => xBtn.click());

      // Still open (input present), cleared, no SET_CRITIC dispatched.
      const after = h.$("input#judge-search") as HTMLInputElement;
      expect(after).not.toBeNull();
      expect(after.value).toBe("");
      expect(dispatched.filter((a) => a.type === "SET_CRITIC")).toHaveLength(0);
    } finally {
      cleanup(h);
    }
  });

  it("X on an empty query closes the editor", () => {
    const h = render(
      <JudgeConfig
        critic={{ providerId: "openrouter", model: "z-ai/glm-5.2" }}
        models={NO_MODELS}
        dispatch={noop}
        judgeInstruction=""
        attachments={[]}
        attachmentsToJudge={true}
      />,
    );
    try {
      const changeBtn = h.$('button[aria-label^="Change judge model"]') as HTMLButtonElement;
      act(() => changeBtn.click());
      expect(h.$("input#judge-search")).not.toBeNull();

      const xEmpty = h.$('button[aria-label="Cancel judge edit"]') as HTMLButtonElement;
      expect(xEmpty).not.toBeNull();
      act(() => xEmpty.click());

      // Editor closed: the combobox input is gone, the change button returns.
      expect(h.$("input#judge-search")).toBeNull();
      expect(h.$('button[aria-label^="Change judge model"]')).not.toBeNull();
    } finally {
      cleanup(h);
    }
  });

  it("committing a catalog model dispatches exactly one SET_CRITIC with provider + exact slug", () => {
    const dispatched: Action[] = [];
    const h = render(
      <JudgeConfig
        critic={{ providerId: "gemini", model: "old-model" }}
        models={GEMINI_MODELS}
        dispatch={(a) => dispatched.push(a)}
        judgeInstruction=""
        attachments={[]}
        attachmentsToJudge={true}
      />,
    );
    try {
      const changeBtn = h.$('button[aria-label^="Change judge model"]') as HTMLButtonElement;
      act(() => changeBtn.click());

      // Click the catalog model row (button containing the model id).
      const catalogBtn = h
        .$$("button")
        .find((b) => b.textContent?.includes("gemini-3.6-flash")) as HTMLButtonElement;
      expect(catalogBtn).toBeTruthy();
      act(() => catalogBtn.click());

      const setCritic = dispatched.filter((a) => a.type === "SET_CRITIC");
      expect(setCritic).toHaveLength(1);
      expect(setCritic[0]).toMatchObject({
        type: "SET_CRITIC",
        critic: { providerId: "gemini", model: "gemini-3.6-flash" },
      });
    } finally {
      cleanup(h);
    }
  });

  it("allows the same opaque slug to be committed under a different provider namespace", () => {
    let committed: { slug: string; providerId: string } | null = null;
    const h = render(
      <JudgeCombobox
        models={NO_MODELS}
        current="shared-model-id"
        initialProvider="9router"
        onCancel={() => {}}
        onCommit={(slug, providerId) => {
          committed = { slug, providerId };
        }}
      />,
    );
    try {
      act(() => h.byText("Gemini")!.click());
      const input = h.$("input#judge-search") as HTMLInputElement;
      typeInto(input, "shared-model-id");
      const commitButton = h.$(
        'button[aria-label="Set judge to shared-model-id"]',
      ) as HTMLButtonElement;
      expect(commitButton).not.toBeNull();
      act(() => commitButton.click());
      expect(committed).toEqual({ slug: "shared-model-id", providerId: "gemini" });
    } finally {
      cleanup(h);
    }
  });
});

// ---------------------------------------------------------------------------
// JudgeCombobox — complete catalog scrolling (no eight-item cutoff) (spec §8.4)
// ---------------------------------------------------------------------------

function geminiCatalogForJudge(n: number): CatalogModel[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `gemini-3.${n - i}-flash`,
    name: `Gemini 3.${n - i} Flash`,
    providerId: "gemini" as const,
  }));
}

describe("JudgeCombobox — complete catalog (no slice cutoff)", () => {
  it("renders every catalog entry on an empty query, not just the first eight", () => {
    const models = geminiCatalogForJudge(12);
    const h = render(
      <JudgeCombobox
        models={models}
        current="old-model"
        initialProvider="gemini"
        onCancel={() => {}}
        onCommit={() => {}}
      />,
    );
    try {
      const catalogBtns = h.$$("ul button");
      expect(catalogBtns.length).toBe(12);
      expect(catalogBtns[0].textContent).toContain(models[0].id);
      expect(catalogBtns[8].textContent).toContain(models[8].id);
      expect(catalogBtns[11].textContent).toContain(models[11].id);
    } finally {
      cleanup(h);
    }
  });

  it("keeps the bounded-height overflow list class", () => {
    const models = geminiCatalogForJudge(12);
    const h = render(
      <JudgeCombobox
        models={models}
        current="old"
        initialProvider="gemini"
        onCancel={() => {}}
        onCommit={() => {}}
      />,
    );
    try {
      const list = h.$("ul")!;
      expect(list.className).toContain("max-h-48");
      expect(list.className).toContain("overflow-y-auto");
    } finally {
      cleanup(h);
    }
  });

  it("a search can return every matching item, including ones near the bottom", () => {
    const models = geminiCatalogForJudge(12);
    const h = render(
      <JudgeCombobox
        models={models}
        current="old"
        initialProvider="gemini"
        onCancel={() => {}}
        onCommit={() => {}}
      />,
    );
    try {
      const input = h.$("input#judge-search") as HTMLInputElement;
      typeInto(input, models[11].id);
      const matches = h.$$("ul button");
      expect(matches.length).toBe(1);
      expect(matches[0].textContent).toContain(models[11].id);
    } finally {
      cleanup(h);
    }
  });

  it("a nonmatching manual slug can still be committed exactly", () => {
    const models = geminiCatalogForJudge(12);
    const dispatched: Action[] = [];
    const h = render(
      <JudgeConfig
        critic={{ providerId: "gemini", model: "old-model" }}
        models={models}
        dispatch={(a) => dispatched.push(a)}
        judgeInstruction=""
        attachments={[]}
        attachmentsToJudge={true}
      />,
    );
    try {
      act(() => h.$('button[aria-label^="Change judge model"]')!.click());
      const input = h.$("input#judge-search") as HTMLInputElement;
      typeInto(input, "gemini-custom-fake");
      const setJudgeBtn = h
        .$$("button")
        .find((b) =>
          b.getAttribute("aria-label")?.startsWith("Set judge to "),
        ) as HTMLButtonElement;
      expect(setJudgeBtn).toBeTruthy();
      act(() => setJudgeBtn.click());
      const setCritic = dispatched.filter((a) => a.type === "SET_CRITIC");
      expect(setCritic).toHaveLength(1);
      expect(setCritic[0]).toMatchObject({
        type: "SET_CRITIC",
        critic: { providerId: "gemini", model: "gemini-custom-fake" },
      });
    } finally {
      cleanup(h);
    }
  });
});

// ---------------------------------------------------------------------------
// Send-attachments-to-judge toggle — plan 7.5.6
// ---------------------------------------------------------------------------

const IMAGE_ATTACHMENT = {
  id: "att-1",
  name: "shot.png",
  kind: "image" as const,
  mimeType: "image/png",
  bytes: 100,
  status: "ready" as const,
  data: "AAAA",
};

describe("JudgeConfig — attachments-to-judge toggle (7.5.6)", () => {
  it("is absent when the task has no native attachments", () => {
    const html = renderToStaticMarkup(
      <JudgeConfig {...baseProps} judgeInstruction="" attachments={[]} attachmentsToJudge={true} />,
    );
    expect(html).not.toContain("Send attachments to judge");
  });

  it("renders when an image is attached, checked to match state", () => {
    const html = renderToStaticMarkup(
      <JudgeConfig
        {...baseProps}
        judgeInstruction=""
        attachments={[IMAGE_ATTACHMENT]}
        attachmentsToJudge={true}
      />,
    );
    expect(html).toContain("Send attachments to judge");
    const match = html.match(/<input[^>]*type="checkbox"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain("checked");
  });

  it("explains the auto-off reason when unchecked", () => {
    const html = renderToStaticMarkup(
      <JudgeConfig
        {...baseProps}
        judgeInstruction=""
        attachments={[IMAGE_ATTACHMENT]}
        attachmentsToJudge={false}
      />,
    );
    expect(html).toContain("4 images or 4 MB");
  });

  it("dispatches SET_ATTACHMENTS_TO_JUDGE on change", () => {
    const dispatched: Action[] = [];
    const h = render(
      <JudgeConfig
        critic={{ providerId: "openrouter", model: "z-ai/glm-5.2" }}
        models={NO_MODELS}
        dispatch={(a) => dispatched.push(a)}
        judgeInstruction=""
        attachments={[IMAGE_ATTACHMENT]}
        attachmentsToJudge={true}
      />,
    );
    try {
      const checkbox = h.$('input[type="checkbox"]') as HTMLInputElement;
      act(() => checkbox.click());
      expect(dispatched).toEqual([{ type: "SET_ATTACHMENTS_TO_JUDGE", value: false }]);
    } finally {
      cleanup(h);
    }
  });
});
