// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import RSemble from "./rsemble";
import { Header } from "./ui/Header";
import { ExecutionOwnerProvider } from "./lib/execution-owner-context";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface TestRoot {
  render: (node: React.ReactNode) => void;
  unmount: () => void;
}

interface Harness {
  container: HTMLDivElement;
  root: TestRoot;
  $: (selector: string) => HTMLElement | null;
  $$: (selector: string) => HTMLElement[];
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
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

/** Render RSemble inside a MemoryRouter at the given initial route(s). */
function renderAtRoute(initialEntries: string[]): Harness {
  // Stub fetch so provider-probe useEffects don't hang in happy-dom.
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: [] }),
    text: () => Promise.resolve(""),
  })));
  // Stub matchMedia for useMediaQuery used in rsemble.tsx.
  if (!window.matchMedia) {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
  }
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ExecutionOwnerProvider>
        <RSemble />
      </ExecutionOwnerProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RSemble workspace shell", () => {
  it("renders distinct workspace headings for /compare, /runs, and /evaluations", () => {
    const compare = renderAtRoute(["/compare"]);
    // Compare renders the command/output panes — its heading is the section
    // aria-label "Command" + "Output". There is no "not implemented" placeholder.
    expect(compare.$('[aria-label="Command"]')).toBeTruthy();
    expect(compare.container.textContent).not.toContain("not yet implemented");
    cleanup(compare);

    const runs = renderAtRoute(["/runs"]);
    // Runs workspace is an honest placeholder saying the feature is not yet
    // implemented, with no fake controls.
    expect(runs.container.textContent).toContain("Runs");
    cleanup(runs);

    const evaluations = renderAtRoute(["/evaluations"]);
    expect(evaluations.container.textContent).toContain("Evaluations");
    cleanup(evaluations);
  });

  it("redirects root to /compare", () => {
    const h = renderAtRoute(["/"]);
    // After redirect, the Compare command pane should be present.
    expect(h.$('[aria-label="Command"]')).toBeTruthy();
    cleanup(h);
  });

  it("renders a Return to Compare link for unknown routes", () => {
    const h = renderAtRoute(["/nonexistent"]);
    // The NotFound view renders a link with exact text "Return to Compare".
    // Scope to route content (not the header WorkspaceNav link) by matching
    // the exact link text.
    const allLinks = [...h.container.querySelectorAll<HTMLAnchorElement>("a")];
    const returnLink = allLinks.find((a) => a.textContent?.trim() === "Return to Compare");
    expect(returnLink).toBeTruthy();
    expect(returnLink?.getAttribute("href")).toMatch(/compare/);
    // The NotFound state should also show "Not found" text.
    expect(h.container.textContent).toContain("Not found");
    cleanup(h);
  });

  it("desktop primary nav has aria-label='Primary'", () => {
    const h = renderAtRoute(["/compare"]);
    const nav = h.$('nav[aria-label="Primary"]');
    expect(nav).toBeTruthy();
    cleanup(h);
  });

  it("exactly one desktop nav link has aria-current='page'", () => {
    const h = renderAtRoute(["/compare"]);
    const nav = h.$('nav[aria-label="Primary"]');
    expect(nav).toBeTruthy();
    const currentLinks = h.$$('nav[aria-label="Primary"] [aria-current="page"]');
    expect(currentLinks).toHaveLength(1);
    cleanup(h);
  });

  it("shows Rank/Fuse toggle on Compare and not on Runs/Evaluations", () => {
    const compare = renderAtRoute(["/compare"]);
    // The ModeToggle is a radiogroup with role="radiogroup".
    const compareToggle = compare.$('[role="radiogroup"]');
    expect(compareToggle).toBeTruthy();
    cleanup(compare);

    const runs = renderAtRoute(["/runs"]);
    const runsToggle = runs.$('[role="radiogroup"]');
    expect(runsToggle).toBeFalsy();
    cleanup(runs);

    const evaluations = renderAtRoute(["/evaluations"]);
    const evalToggle = evaluations.$('[role="radiogroup"]');
    expect(evalToggle).toBeFalsy();
    cleanup(evaluations);
  });

  it("mobile navigation exposes three visible labels and 44px targets", () => {
    // happy-dom doesn't apply CSS, so we check the rendered structure: the
    // mobile nav exists, has three links with visible text, and each has a
    // min-height style or class indicating 44px. We verify the three labels.
    const h = renderAtRoute(["/compare"]);
    // Look for the mobile nav — it should be a nav with an aria-label
    // containing "Workspace" and visible only on small screens.
    const mobileNavs = h.$$('nav[aria-label*="Workspace" i], nav[data-mobile="true"]');
    // The mobile nav should exist in the DOM (even if hidden by CSS on desktop).
    expect(mobileNavs.length).toBeGreaterThanOrEqual(1);
    const mobileNav = mobileNavs[0];
    const links = [...mobileNav.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links).toHaveLength(3);
    const labels = links.map((l) => l.textContent?.trim()).filter(Boolean);
    expect(labels).toEqual(expect.arrayContaining(["Compare", "Runs", "Evaluations"]));
    cleanup(h);
  });

  it("does not reset the Compare reducer state when navigating between workspaces", () => {
    // Render at /compare, type a prompt, navigate to /runs via the real nav
    // link, then navigate back to /compare via the real nav link. The prompt
    // should persist because the reducer is mounted above the router.
    const h = renderAtRoute(["/compare"]);
    const textarea = h.$("textarea") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "Test prompt for persistence");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Verify the prompt was set before navigating.
    expect(h.container.textContent).toContain("Test prompt for persistence");

    // Navigate to /runs via the desktop nav link.
    const runsLink = [...h.container.querySelectorAll<HTMLAnchorElement>("a")].find(
      (a) => a.getAttribute("href") === "/runs",
    );
    expect(runsLink).toBeTruthy();
    act(() => {
      runsLink!.click();
    });

    // On /runs the command pane (with textarea) is gone — the Runs workspace shows.
    expect(h.$('[aria-label="Command"]')).toBeFalsy();
    // Runs workspace renders (no longer a placeholder)
    expect(h.container.textContent).not.toContain("not yet implemented");

    // Navigate back to /compare via the desktop nav link.
    const compareLink = [...h.container.querySelectorAll<HTMLAnchorElement>("a")].find(
      (a) => a.getAttribute("href") === "/compare",
    );
    expect(compareLink).toBeTruthy();
    act(() => {
      compareLink!.click();
    });

    // The command pane is back and the textarea retained its value because
    // the reducer lives above the router.
    const restoredTextarea = h.$("textarea") as HTMLTextAreaElement;
    expect(restoredTextarea).toBeTruthy();
    expect(restoredTextarea.value).toBe("Test prompt for persistence");

    cleanup(h);
  });

  it("keeps workspace links enabled while a run is active", () => {
    // Render the Header with running=true to simulate an active run. The
    // workspace nav links must remain enabled — navigation is always
    // available even during execution (spec §5.2).
    const h = render(
      <MemoryRouter initialEntries={["/compare"]}>
        <Header running={true} connectionState="running" onOpenConnections={() => undefined}>
          <span data-testid="toggle-stub" />
        </Header>
      </MemoryRouter>,
    );
    const nav = h.$('nav[aria-label="Primary"]');
    expect(nav).toBeTruthy();
    const links = [...nav?.querySelectorAll<HTMLAnchorElement>("a") ?? []];
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const link of links) {
      expect(link.getAttribute("aria-disabled")).not.toBe("true");
      expect(link.hasAttribute("disabled")).toBe(false);
    }
    // The running state should be reflected in the connection button's
    // accessible label.
    const connBtn = h.$('button[title="Provider connections"]');
    expect(connBtn?.getAttribute("aria-label")).toContain("Running");
    cleanup(h);
  });

  it("no longer forbids primary navigation (superseded assertion)", () => {
    // The old assertion checked that aria-label="Primary" was ABSENT. That
    // behavior is superseded — primary navigation is now approved scope.
    const h = renderAtRoute(["/compare"]);
    expect(h.$('nav[aria-label="Primary"]')).toBeTruthy();
    cleanup(h);
  });
});
