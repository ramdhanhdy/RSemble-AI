// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceNav } from "./WorkspaceNav";
import { MobileWorkspaceNav } from "./MobileWorkspaceNav";
import { Header } from "./Header";

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

function renderWithRouter(node: React.ReactNode, initialEntry = "/compare"): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        {node}
      </MemoryRouter>,
    );
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

afterEach(() => {
  document.body.innerHTML = "";
});

describe("WorkspaceNav (desktop)", () => {
  it("renders nav with aria-label='Primary'", () => {
    const h = renderWithRouter(<WorkspaceNav />);
    expect(h.$('nav[aria-label="Primary"]')).toBeTruthy();
    cleanup(h);
  });

  it("renders three links: Compare, Runs, Evaluations", () => {
    const h = renderWithRouter(<WorkspaceNav />);
    const links = h.$$("nav[aria-label='Primary'] a");
    expect(links).toHaveLength(3);
    const labels = links.map((l) => l.textContent?.trim());
    expect(labels).toEqual(["Compare", "Runs", "Evaluations"]);
    cleanup(h);
  });

  it("marks the active route with aria-current='page'", () => {
    const h = renderWithRouter(<WorkspaceNav />, "/runs");
    const current = h.$$('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent?.trim()).toBe("Runs");
    cleanup(h);
  });

  it("links point to /compare, /runs, /evaluations", () => {
    const h = renderWithRouter(<WorkspaceNav />);
    const links = h.$$("nav[aria-label='Primary'] a");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/compare");
    expect(hrefs).toContain("/runs");
    expect(hrefs).toContain("/evaluations");
    cleanup(h);
  });
});

describe("MobileWorkspaceNav", () => {
  it("renders three items with visible text labels", () => {
    const h = renderWithRouter(<MobileWorkspaceNav />);
    const nav = h.$("nav");
    expect(nav).toBeTruthy();
    const links = h.$$("nav a");
    expect(links).toHaveLength(3);
    const labels = links.map((l) => l.textContent?.trim()).filter(Boolean);
    expect(labels).toEqual(expect.arrayContaining(["Compare", "Runs", "Evaluations"]));
  });

  it("marks the active route with aria-current='page'", () => {
    const h = renderWithRouter(<MobileWorkspaceNav />, "/evaluations");
    const current = h.$$('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent?.trim()).toBe("Evaluations");
    cleanup(h);
  });

  it("includes an icon in each nav item", () => {
    const h = renderWithRouter(<MobileWorkspaceNav />);
    const items = h.$$("[data-testid='mobile-nav-item']");
    expect(items).toHaveLength(3);
    for (const item of items) {
      // Each item should have an svg (lucide icon) and text.
      expect(item.querySelector("svg")).toBeTruthy();
      expect(item.textContent?.trim()).toBeTruthy();
    }
    cleanup(h);
  });
});

describe("Header responsive sacrifice order (768–1023px tablet)", () => {
  // happy-dom does not apply CSS breakpoints, so these tests assert the
  // responsive class structure that encodes the spec's fixed sacrifice order:
  // palette/help visible text → icon-only at md, then connection text →
  // dot-only at md, restored at lg. See DESIGN.md §122-125 and spec §5.2.

  function renderHeader(): Harness {
    return renderWithRouter(
      <Header
        running={false}
        connectionState="ready"
        onOpenConnections={() => undefined}
        onOpenPalette={() => undefined}
        onOpenHelp={() => undefined}
        showToggle={true}
      >
        <span data-testid="toggle" />
      </Header>,
      "/compare",
    );
  }

  it("renders workspace nav visible at md+ (hidden on mobile)", () => {
    const h = renderHeader();
    const navWrapper = h.$("header > div.hidden.md\\:block");
    expect(navWrapper).toBeTruthy();
    const nav = navWrapper?.querySelector('nav[aria-label="Primary"]');
    expect(nav).toBeTruthy();
    expect(nav?.querySelectorAll("a").length).toBe(3);
    cleanup(h);
  });

  it("palette is icon-only at md and full keycaps at lg (sacrifice order: palette first)", () => {
    const h = renderHeader();
    const paletteBtns = h.$$('button[aria-label="Command palette"]');
    // Two palette buttons: icon-only (md:flex lg:hidden) and keycaps (lg:flex).
    expect(paletteBtns.length).toBe(2);
    const iconBtn = paletteBtns.find((b) => b.className.includes("md:flex") && b.className.includes("lg:hidden"));
    const keycapBtn = paletteBtns.find((b) => b.className.includes("lg:flex") && !b.className.includes("lg:hidden"));
    expect(iconBtn).toBeTruthy();
    expect(keycapBtn).toBeTruthy();
    // Both retain accessible name.
    expect(iconBtn?.getAttribute("aria-label")).toBe("Command palette");
    expect(keycapBtn?.getAttribute("aria-label")).toBe("Command palette");
    // Icon-only button has an svg, not keycaps.
    expect(iconBtn?.querySelector("svg")).toBeTruthy();
    expect(iconBtn?.querySelector("kbd")).toBeFalsy();
    cleanup(h);
  });

  it("help is icon-only at md+ (visible at tablet)", () => {
    const h = renderHeader();
    const helpBtn = h.$('button[aria-label="Keyboard shortcuts"]');
    expect(helpBtn).toBeTruthy();
    expect(helpBtn?.className.includes("md:flex")).toBe(true);
    expect(helpBtn?.querySelector("svg")).toBeTruthy();
    cleanup(h);
  });

  it("connection label is hidden at md and visible at lg (sacrifice order: after palette/help)", () => {
    const h = renderHeader();
    const connBtn = h.$('button[title="Provider connections"]');
    expect(connBtn).toBeTruthy();
    const label = connBtn?.querySelector("span[aria-live]");
    expect(label).toBeTruthy();
    // The label must have the lg:inline class (hidden below lg).
    expect(label?.className.includes("lg:inline")).toBe(true);
    cleanup(h);
  });

  it("Rank/Fuse toggle is shown only when showToggle is true", () => {
    const h = renderHeader();
    const toggleStub = h.$('[data-testid="toggle"]');
    expect(toggleStub).toBeTruthy();
    cleanup(h);

    const h2 = renderWithRouter(
      <Header running={false} showToggle={false}>
        <span data-testid="toggle" />
      </Header>,
      "/compare",
    );
    expect(h2.$('[data-testid="toggle"]')).toBeFalsy();
    cleanup(h2);
  });
});
