// @vitest-environment happy-dom
// Child 08 Task 5 — task-first primary navigation (spec §G.4–G.7).
//
// The shell presents exactly four primary destinations — Compare · Evaluations
// · Lab · Models — on desktop and mobile, with Runs removed from primary
// navigation entirely and Records living only in the header utility cluster.
import { describe, expect, it, afterEach, vi } from "vitest";
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

function stubMatchMedia(desktop: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desktop && query.includes("1024"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function renderWithRouter(node: React.ReactNode, initialEntry = "/compare"): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter initialEntries={[initialEntry]}>{node}</MemoryRouter>);
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
  vi.unstubAllGlobals();
});

const DESKTOP_ITEMS = ["Compare", "Evaluations", "Lab", "Models"];
const DESKTOP_HREFS = ["/compare", "/evaluations", "/lab", "/models"];
const NAV_ICONS = [
  "lucide-git-compare",
  "lucide-flask-conical",
  "lucide-test-tubes",
  "lucide-cpu",
];

describe("WorkspaceNav (desktop) — task-first topology", () => {
  it("renders nav with aria-label='Primary'", () => {
    const h = renderWithRouter(<WorkspaceNav />);
    expect(h.$('nav[aria-label="Primary"]')).toBeTruthy();
    cleanup(h);
  });

  it("renders exactly four destinations in canonical order", () => {
    const h = renderWithRouter(<WorkspaceNav />);
    const links = h.$$("nav[aria-label='Primary'] a");
    expect(links).toHaveLength(4);
    expect(links.map((l) => l.textContent?.trim())).toEqual(DESKTOP_ITEMS);
    cleanup(h);
  });

  it("links point to /compare, /evaluations, /lab, /models", () => {
    const h = renderWithRouter(<WorkspaceNav />);
    const hrefs = h.$$("nav[aria-label='Primary'] a").map((l) => l.getAttribute("href"));
    expect(hrefs).toEqual(DESKTOP_HREFS);
    cleanup(h);
  });

  it("has no Runs destination anywhere in primary navigation", () => {
    const h = renderWithRouter(<WorkspaceNav />);
    const nav = h.$("nav[aria-label='Primary']")!;
    expect(nav.textContent).not.toContain("Runs");
    expect(nav.querySelector("a[href='/runs']")).toBeNull();
    expect(nav.querySelector("a[href^='/runs']")).toBeNull();
    cleanup(h);
  });

  it("marks the active route with aria-current='page'", () => {
    const h = renderWithRouter(<WorkspaceNav />, "/evaluations");
    const current = h.$$('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent?.trim()).toBe("Evaluations");
    cleanup(h);
  });

  it("active item carries a static 2px bottom accent bar; inactive items do not", () => {
    const h = renderWithRouter(<WorkspaceNav />, "/lab");
    const links = h.$$("nav[aria-label='Primary'] a");
    const active = links.find((l) => l.getAttribute("aria-current") === "page")!;
    expect(active.textContent?.trim()).toBe("Lab");
    expect(active.className).toContain("shadow-[inset_0_-2px_0_0_#00e5ff]");
    for (const link of links.filter((l) => l !== active)) {
      expect(link.className).not.toContain("shadow-[inset");
    }
    cleanup(h);
  });

  it("keeps every destination at a >=44px target", () => {
    const h = renderWithRouter(<WorkspaceNav />);
    for (const link of h.$$("nav[aria-label='Primary'] a")) {
      expect(link.className.includes("min-h-[44px]")).toBe(true);
    }
    cleanup(h);
  });

  it("binds the canonical icon identity per destination", () => {
    const h = renderWithRouter(<WorkspaceNav />);
    const links = h.$$("nav[aria-label='Primary'] a");
    links.forEach((link, index) => {
      const icon = link.querySelector(`svg.${NAV_ICONS[index]}`);
      expect(icon, `${DESKTOP_ITEMS[index]} must wear ${NAV_ICONS[index]}`).toBeTruthy();
    });
    cleanup(h);
  });
});

describe("MobileWorkspaceNav — same four destinations", () => {
  it("renders exactly four items in the same order as desktop", () => {
    const h = renderWithRouter(<MobileWorkspaceNav />);
    const links = h.$$("nav a");
    expect(links).toHaveLength(4);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(DESKTOP_HREFS);
    expect(links.map((l) => l.textContent?.trim())).toEqual(DESKTOP_ITEMS);
    cleanup(h);
  });

  it("has no Runs item and no Records item at any width", () => {
    const h = renderWithRouter(<MobileWorkspaceNav />);
    const nav = h.$("nav")!;
    expect(nav.querySelector("a[href='/records']")).toBeNull();
    expect(nav.querySelector("a[href^='/runs']")).toBeNull();
    expect(nav.textContent).not.toContain("Runs");
    expect(nav.textContent).not.toContain("Records");
    cleanup(h);
  });

  it("marks the active route and mirrors the accent bar on top", () => {
    const h = renderWithRouter(<MobileWorkspaceNav />, "/models");
    const current = h.$$('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent?.trim()).toBe("Models");
    expect(current[0].className).toContain("shadow-[inset_0_2px_0_0_#00e5ff]");
    cleanup(h);
  });

  it("includes an icon in each nav item with the canonical identity", () => {
    const h = renderWithRouter(<MobileWorkspaceNav />);
    const items = h.$$("[data-testid='mobile-nav-item']");
    expect(items).toHaveLength(4);
    items.forEach((item, index) => {
      expect(item.querySelector("svg")).toBeTruthy();
      expect(item.querySelector(`svg.${NAV_ICONS[index]}`)).toBeTruthy();
      expect(item.textContent?.trim()).toBeTruthy();
    });
    cleanup(h);
  });

  it("keeps every mobile destination at a >=44px target", () => {
    const h = renderWithRouter(<MobileWorkspaceNav />);
    for (const item of h.$$("[data-testid='mobile-nav-item']")) {
      expect(item.className.includes("min-h-[44px]")).toBe(true);
    }
    cleanup(h);
  });
});

describe("Header Records utility (secondary chrome)", () => {
  function renderHeader(desktop: boolean): Harness {
    stubMatchMedia(desktop);
    return renderWithRouter(
      <Header
        running={false}
        connectionState="ready"
        onOpenConnections={() => undefined}
        onOpenPalette={() => undefined}
        onOpenHelp={() => undefined}
        recordsOpen={false}
        onOpenRecords={() => undefined}
      />,
      "/compare",
    );
  }

  it("renders the Records utility below 1024 as a direct link to /records", () => {
    const h = renderHeader(false);
    const link = h.$('a[aria-label="Records"]');
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe("/records");
    expect(link?.getAttribute("aria-haspopup")).toBeNull();
    cleanup(h);
  });

  it("renders the Records utility at >=1024 as the drawer trigger", () => {
    const h = renderHeader(true);
    const button = h.$('button[aria-label="Records"]');
    expect(button).toBeTruthy();
    expect(button?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    cleanup(h);
  });

  it("wires aria-expanded and opens the drawer from the trigger at >=1024", () => {
    let opened = false;
    stubMatchMedia(true);
    const h = renderWithRouter(
      <Header
        running={false}
        connectionState="ready"
        recordsOpen={false}
        onOpenRecords={() => {
          opened = true;
        }}
      />,
    );
    const button = h.$('button[aria-label="Records"]')!;
    act(() => {
      button.click();
    });
    expect(opened).toBe(true);
    cleanup(h);
  });

  it("shows the History glyph at every width and the label only at lg+", () => {
    for (const desktop of [false, true]) {
      const h = renderHeader(desktop);
      const control =
        h.$('button[aria-label="Records"]') ?? h.$('a[aria-label="Records"]');
      expect(control?.querySelector("svg.lucide-history")).toBeTruthy();
      const label = control?.querySelector("span");
      expect(label?.className.includes("hidden lg:inline")).toBe(true);
      expect(control?.className.includes("min-h-[44px]")).toBe(true);
      cleanup(h);
    }
  });

  it("orders the right utility cluster palette · Records · Connections · Help", () => {
    const h = renderHeader(true);
    const cluster = h.$$('header div.flex.items-center.justify-self-end > *');
    const names = cluster.map((el) => el.getAttribute("aria-label") ?? "");
    const paletteIndex = names.indexOf("Command palette");
    const recordsIndex = names.indexOf("Records");
    const connectionsIndex = names.findIndex((n) => n.startsWith("Connection status"));
    const helpIndex = names.indexOf("Keyboard shortcuts");
    expect(paletteIndex).toBeGreaterThanOrEqual(0);
    expect(recordsIndex).toBeGreaterThan(paletteIndex);
    expect(connectionsIndex).toBeGreaterThan(recordsIndex);
    expect(helpIndex).toBeGreaterThan(connectionsIndex);
    cleanup(h);
  });

  it("keeps the Records control out of both primary nav surfaces", () => {
    const h = renderHeader(true);
    expect(h.$("nav[aria-label='Primary'] a[href='/records']")).toBeNull();
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
      />,
      "/compare",
    );
  }

  it("renders workspace nav visible at md+ (hidden on mobile)", () => {
    const h = renderHeader();
    const navWrapper = h.$("header > div.hidden.md\\:block");
    expect(navWrapper).toBeTruthy();
    const nav = navWrapper?.querySelector('nav[aria-label="Primary"]');
    expect(nav).toBeTruthy();
    expect(nav?.querySelectorAll("a").length).toBe(4);
    cleanup(h);
  });

  it("palette is icon-only at md and full keycaps at lg (sacrifice order: palette first)", () => {
    const h = renderHeader();
    const paletteBtns = h.$$('button[aria-label="Command palette"]');
    // Two palette buttons: icon-only (md:flex lg:hidden) and keycaps (lg:flex).
    expect(paletteBtns.length).toBe(2);
    const iconBtn = paletteBtns.find(
      (b) => b.className.includes("md:flex") && b.className.includes("lg:hidden"),
    );
    const keycapBtn = paletteBtns.find(
      (b) => b.className.includes("lg:flex") && !b.className.includes("lg:hidden"),
    );
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

  it("keeps Finish out of the global header", () => {
    const h = renderHeader();
    expect(h.$("header")?.className).toContain("grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]");
    expect(h.$('[role="radiogroup"]')).toBeNull();
    cleanup(h);
  });

  it("keeps Records visible below md when palette and help are hidden", () => {
    const h = renderHeader();
    const records = h.$('a[aria-label="Records"]');
    expect(records).toBeTruthy();
    // Palette and help hide below md; Records must never disappear.
    expect(h.$$('button[aria-label="Command palette"]')[0]?.className.includes("hidden")).toBe(
      true,
    );
    expect(h.$('button[aria-label="Keyboard shortcuts"]')?.className.includes("hidden")).toBe(
      true,
    );
    cleanup(h);
  });
});
