// =============================================================================
// cdp-runs-visual-parity.mjs - Final visual parity review (task t_f95b93e6).
//
// Compares the production Runs UI (feat/runs-fairness-baseline @ HEAD, served
// by the running vite dev server) against the baseline HTML prototype
// (docs/explorations/runs-ia/prototypes/baseline-standalone.html) using the
// transplant map's Visual Success Criteria (docs/explorations/runs-ia/
// prototypes/prototype-production-transplant-map.md, "Visual Success
// Criteria"): cards-in-cards, border-driven hierarchy, row density, source/
// status glanceability, selected accent, detail header hierarchy, detail
// rhythm, list/detail continuity, selective cyan.
//
// Evidence is numeric computed-style data plus screenshots; the human/vision
// pass reads the PNGs in docs/qa/runs-visual-parity/.
//
// Fixtures: production IndexedDB is seeded with the same deterministic
// 11-run corpus used by cdp-runs-edge-qa.mjs (seed source extracted from that
// file at runtime so the corpus cannot drift). The prototype renders its own
// built-in synthetic corpus.
// =============================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const prodBaseUrl = process.env.QA_BASE_URL ?? "http://localhost:5173/";
const protoDir = path.join(repoRoot, "docs/explorations/runs-ia/prototypes");
const protoPort = 4181;
const protoBaseUrl = `http://127.0.0.1:${protoPort}/`;
const outDir = path.join(repoRoot, "docs/qa/runs-visual-parity");
const chromePath =
  process.env.CHROME_PATH ??
  "/opt/data/home/.chrome/chrome-headless-shell-linux64/chrome-headless-shell";
// Random debug port so a stale chrome from a crashed run can never hijack the
// connection (crashed runs leave the previous chrome alive on the old port).
const debugPort = 12000 + Math.floor(Math.random() * 4000);

// Crash cleanup: kill our chrome and server even on thrown errors so no stale
// process holds the debug port for the next run.
let chromeProc = null;
let protoServerHandle = null;
process.on("uncaughtException", (error) => {
  try {
    chromeProc?.kill();
  } catch {}
  try {
    protoServerHandle?.close();
  } catch {}
  console.error(error);
  process.exit(1);
});

const results = {
  generatedAt: new Date().toISOString(),
  prodBaseUrl,
  protoBaseUrl,
  probes: [],
  screenshots: [],
  consoleErrors: [],
};

fs.mkdirSync(outDir, { recursive: true });

// --- Mini static server for the prototype -----------------------------------
const mime = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
};
protoServerHandle = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = path.join(protoDir, urlPath === "/" ? "index.html" : urlPath);
  if (!file.startsWith(protoDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": mime[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => protoServerHandle.listen(protoPort, "127.0.0.1", resolve));

// --- Chrome ------------------------------------------------------------------
chromeProc = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${path.join(os.tmpdir(), `rsemble-visual-parity-${Date.now()}`)}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPageWebSocketUrl() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const pages = await new Promise((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${debugPort}/json/list`, (response) => {
            let body = "";
            response.on("data", (chunk) => (body += chunk));
            response.on("end", () => resolve(JSON.parse(body)));
          })
          .on("error", reject);
      });
      const page = pages.find((candidate) => candidate.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome can take a moment to expose its debugger endpoint.
    }
    await wait(250);
  }
  throw new Error("Chrome did not expose a CDP page target.");
}

const socket = new WebSocket(await getPageWebSocketUrl());
let nextMessageId = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") {
    const detail =
      message.params.exceptionDetails?.exception?.description ??
      message.params.exceptionDetails?.text ??
      "uncaught exception";
    results.consoleErrors.push(detail);
    return;
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    const text = (message.params.args ?? [])
      .map((arg) => arg.value ?? arg.description ?? "")
      .join(" ");
    if (text) results.consoleErrors.push(text);
    return;
  }
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message);
};
await new Promise((resolve) => {
  socket.onopen = resolve;
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextMessageId;
    pending.set(id, (message) => {
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, args) {
  const result = await send("Runtime.evaluate", {
    expression,
    arguments: (args ?? []).map((value) => ({ value })),
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    const detail =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      "Runtime evaluation failed.";
    throw new Error(detail);
  }
  return result.result?.value;
}

async function waitFor(expression, label, maxAttempts = 100) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(125);
  }
  const diagnostic = await evaluate(
    `({ hash: location.hash, title: document.title, body: (document.body?.innerText ?? "").slice(0, 600) })`,
  );
  throw new Error(`Timed out waiting for ${label}. ${JSON.stringify(diagnostic)}`);
}

async function setViewport({ width, height }) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function navigate(url) {
  await send("Page.navigate", { url });
  await waitFor("Boolean(document.body && document.body.children.length > 0)", "page body");
  await wait(500);
}

async function reload() {
  await send("Page.reload", { ignoreCache: true });
  await waitFor("Boolean(document.body && document.body.children.length > 0)", "page body");
  await wait(600);
}

async function screenshot(name) {
  const capture = await send("Page.captureScreenshot", { format: "png" });
  const file = `${name}.png`;
  fs.writeFileSync(path.join(outDir, file), Buffer.from(capture.data, "base64"));
  results.screenshots.push(file);
}

function record(name, value) {
  results.probes.push({ name, ...value });
  if (value.pass === false) throw new Error(`${name}: ${value.reason ?? "assertion failed"}`);
}

// --- Seed extraction: reuse the edge-qa driver's fixture corpus --------------
const edgeDriver = fs.readFileSync(path.join(repoRoot, "scripts/cdp-runs-edge-qa.mjs"), "utf8");
const seedStartMarker = "const SEED_SOURCE = `";
const seedStart = edgeDriver.indexOf(seedStartMarker);
const seedEnd = edgeDriver.indexOf("))`;\n", seedStart);
if (seedStart < 0 || seedEnd < 0)
  throw new Error("Could not locate SEED_SOURCE in cdp-runs-edge-qa.mjs");
const SEED_SOURCE = edgeDriver.slice(seedStart + seedStartMarker.length, seedEnd + 2);

// Drop stale execution-lease/fence keys so a leftover compare lease from a
// previous session cannot surface the "Compare is active in another tab"
// banner and pollute the parity screenshots (same cleanup as the edge driver).
const CLEAR_LEASE_SOURCE = `(async () => {
  const DB = "rsemble-evaluation";
  const openDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const deleteKey = (db, store, key) => new Promise((resolve, reject) => {
    const r = db.transaction(store, "readwrite").objectStore(store).delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  const db = await openDb();
  await deleteKey(db, "storageMeta", "execution-lease");
  await deleteKey(db, "storageMeta", "execution-lease-fence");
  db.close();
  return true;
})().catch((e) => ({ __clearError: e instanceof Error ? e.message : String(e) }))`;

// --- Shared style probe (selector strings are interpolated, not passed as
// --- CDP arguments - Runtime.evaluate argument-calling is unreliable here) ---
const styleProbe = (selectors) => `(() => {
  const out = {};
  const map = ${JSON.stringify(selectors)};
  for (const [label, sel] of Object.entries(map)) {
    const el = document.querySelector(sel);
    if (!el) { out[label] = null; continue; }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out[label] = {
      cls: el.className,
      bg: cs.backgroundColor,
      color: cs.color,
      borderTop: cs.borderTopWidth + " " + cs.borderTopStyle + " " + cs.borderTopColor,
      borderRight: cs.borderRightWidth + " " + cs.borderRightStyle + " " + cs.borderRightColor,
      borderBottom: cs.borderBottomWidth + " " + cs.borderBottomStyle + " " + cs.borderBottomColor,
      borderLeft: cs.borderLeftWidth + " " + cs.borderLeftStyle + " " + cs.borderLeftColor,
      boxShadow: cs.boxShadow,
      font: cs.fontSize + "/" + cs.lineHeight + " " + cs.fontFamily.split(",")[0],
      width: Math.round(r.width),
      height: Math.round(r.height),
      top: Math.round(r.top),
    };
  }
  return out;
})()`;

const CYAN_COUNT_PROBE = `(() => {
  const ACCENT = "rgb(0, 229, 255)";
  let count = 0;
  const samples = [];
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    const hit =
      cs.color === ACCENT ||
      cs.backgroundColor === ACCENT ||
      cs.borderTopColor === ACCENT ||
      cs.borderBottomColor === ACCENT ||
      cs.borderLeftColor === ACCENT ||
      cs.borderRightColor === ACCENT ||
      (cs.boxShadow ?? "").includes(ACCENT);
    if (hit) {
      count += 1;
      if (samples.length < 8) samples.push((el.className || el.tagName).toString().slice(0, 60));
    }
  }
  return { count, samples };
})()`;

const rowMeasureProbe = (rowSel, listSel) => `(() => {
  const rows = [...document.querySelectorAll(${JSON.stringify(rowSel)})];
  const heights = rows.map((r) => Math.round(r.getBoundingClientRect().height));
  const list = document.querySelector(${JSON.stringify(listSel)});
  const listCs = list ? getComputedStyle(list) : null;
  return {
    rowCount: rows.length,
    heights,
    min: heights.length ? Math.min(...heights) : null,
    max: heights.length ? Math.max(...heights) : null,
    mean: heights.length ? Math.round(heights.reduce((a, b) => a + b, 0) / heights.length) : null,
    listGap: listCs ? listCs.rowGap + "/" + listCs.columnGap : null,
    listPaddingTop: listCs ? listCs.paddingTop : null,
  };
})()`;

// =============================================================================
// PHASE 1 - Prototype (baseline-standalone.html)
// =============================================================================
console.log("Phase 1: prototype baseline");
await setViewport({ width: 1440, height: 900 });

// 1a. List view
await navigate(`${protoBaseUrl}baseline-standalone.html#/runs`);
await waitFor("document.querySelectorAll('.run-row').length > 0", "prototype run rows");

const protoList = await evaluate(
  `(() => {
    const panes = [...document.querySelectorAll(".list-pane")];
    const pane = panes[0] ?? null;
    const paneCs = pane ? getComputedStyle(pane) : null;
    return {
      paneBg: paneCs?.backgroundColor,
      paneBorderRight: paneCs ? paneCs.borderRightWidth + " " + paneCs.borderRightStyle + " " + paneCs.borderRightColor : null,
      filtersVisible: (() => {
        const f = document.querySelector(".filters-bar");
        if (!f) return false;
        const r = f.getBoundingClientRect();
        const cs = getComputedStyle(f);
        return r.width > 0 && r.height > 0 && cs.display !== "none";
      })(),
      splitWidth: (() => {
        const s = document.querySelector(".workspace-split");
        return s ? Math.round(s.getBoundingClientRect().width) : null;
      })(),
    };
  })()`,
);
const protoRows = await evaluate(rowMeasureProbe(".run-row", ".run-list"));
const protoCyanList = await evaluate(CYAN_COUNT_PROBE);
await screenshot("01-proto-list");
record("proto.list.surface", {
  pass:
    protoList.paneBg === "rgb(10, 10, 10)" &&
    protoList.paneBorderRight?.includes("rgb(38, 38, 38)"),
  evidence: protoList,
  note: "prototype pane = shell bg + 1px edge border-right (border-driven split)",
});
record("proto.list.density", {
  pass: protoRows.rowCount >= 8 && (protoRows.mean ?? 0) < 96,
  evidence: protoRows,
  note: "prototype baseline: 11 rows at 84px each, zero row-gap, border-separated",
});
record("proto.list.cyanSelective", {
  pass: (protoCyanList.count ?? 99) <= 40,
  evidence: protoCyanList,
  note: "prototype baseline count incl. SVG icon strokes + active nav + adhoc chips",
});

// 1b. Selected row + detail (split view)
await navigate(`${protoBaseUrl}baseline-standalone.html#/runs/run-20260809-001`);
await waitFor("document.querySelector('.run-row.selected')", "prototype selected row");
const protoSelected = await evaluate(
  styleProbe({
    row: ".run-row.selected",
    detail: ".detail-pane",
    detailTitle: ".detail-title",
    detailSection: ".detail-section",
  }),
);
const protoDetailMeta = await evaluate(
  `(() => ({
    sectionCount: document.querySelectorAll(".detail-section").length,
    headerText: (document.querySelector(".detail-header")?.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 200),
  }))()`,
);
const protoCyanDetail = await evaluate(CYAN_COUNT_PROBE);
await screenshot("02-proto-detail-selected");
record("proto.detail.selectedRow", {
  pass:
    protoSelected.row?.bg === "rgb(24, 24, 24)" &&
    protoSelected.row?.borderLeft?.startsWith("2px solid rgb(0, 229, 255)"),
  evidence: protoSelected.row,
  note: "prototype selected = raised bg + 2px accent left border",
});
record("proto.detail.hierarchy", {
  pass: protoDetailMeta.sectionCount >= 4,
  evidence: protoDetailMeta,
});
record("proto.detail.cyanSelective", {
  pass: (protoCyanDetail.count ?? 99) <= 50,
  evidence: protoCyanDetail,
});

// =============================================================================
// PHASE 2 - Production (vite dev server, seeded corpus)
// =============================================================================
console.log("Phase 2: production");
await navigate(`${prodBaseUrl}#/runs`);
await waitFor("Boolean(document.querySelector('#root > *'))", "application shell");

// Seed and reload so the in-memory repository re-reads the fixtures.
await evaluate(CLEAR_LEASE_SOURCE);
const seeded = await evaluate(SEED_SOURCE);
if (seeded?.__seedError) throw new Error(`Seed failed: ${seeded.__seedError}`);
await reload();
await waitFor("document.querySelectorAll('a[href*=\"/runs/\"]').length > 0", "seeded run rows");

// 2a. List view measurements
const prodList = await evaluate(
  `(() => {
    // The desktop list pane: ancestor of the run list that has the border-r split.
    const listEl = document.querySelector('ul[role="list"]');
    let pane = listEl;
    const isBorderedPane = (el) => {
      const cs = getComputedStyle(el);
      return cs.borderRightStyle === "solid" && cs.borderRightWidth !== "0px";
    };
    while (pane && !isBorderedPane(pane)) pane = pane.parentElement;
    const paneCs = pane ? getComputedStyle(pane) : null;
    return {
      paneBg: paneCs?.backgroundColor,
      paneBorderRight: paneCs ? paneCs.borderRightWidth + " " + paneCs.borderRightStyle + " " + paneCs.borderRightColor : null,
      filtersVisible: (() => {
        const isVisible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 40 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        };
        const search = document.querySelector('input[placeholder*="Search"], input[type="search"]');
        const visibleFilters = [...document.querySelectorAll("select[data-filter]")].filter(isVisible);
        return Boolean(search && isVisible(search) && visibleFilters.length === 4);
      })(),
      visibleFilterNames: [...document.querySelectorAll("select[data-filter]")]
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 40 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        })
        .map((el) => el.getAttribute("data-filter")),
      paneWidth: pane ? Math.round(pane.getBoundingClientRect().width) : null,
    };
  })()`,
);
const prodRows = await evaluate(rowMeasureProbe('ul[role="list"] > li', 'ul[role="list"]'));
const prodCyanList = await evaluate(CYAN_COUNT_PROBE);
const prodRowSample = await evaluate(
  `(() => {
    const rows = [...document.querySelectorAll('ul[role="list"] > li a[href*="/runs/"]')];
    return rows.slice(0, 12).map((r) => ({
      href: r.getAttribute("href"),
      text: (r.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 160),
    }));
  })()`,
);
await screenshot("03-prod-list");
record("prod.list.surface", {
  pass:
    (prodList.paneBg === "rgb(18, 18, 18)" || prodList.paneBg === "rgb(10, 10, 10)") &&
    prodList.paneBorderRight?.includes("rgb(38, 38, 38)"),
  evidence: prodList,
  note: "production pane = panel bg + 1px edge border-right; solid surface, not floating cards",
});
record("prod.list.density", {
  pass:
    prodRows.rowCount >= 8 &&
    (prodRows.mean ?? 0) <= Math.round((protoRows.mean ?? 84) * 1.25) &&
    (prodRows.mean ?? 0) >= Math.round((protoRows.mean ?? 84) * 0.6),
  evidence: { ...prodRows, protoMean: protoRows.mean },
  note: "production row density within +-25% band of prototype 84px baseline",
});
record("prod.list.filtersVisible", {
  pass: prodList.filtersVisible === true,
  evidence: prodList,
  note: "search plus Model/Status/Mode/Source controls visibly rendered on desktop (transplant map E1)",
});
record("prod.list.cyanSelective", {
  pass: (prodCyanList.count ?? 99) <= Math.max(40, Math.round((protoCyanList.count ?? 19) * 1.75)),
  evidence: { ...prodCyanList, protoCount: protoCyanList.count },
  note: "cyan usage within 1.75x of prototype's own list count; selective use (chips/status/selection only)",
});

// 2b. Selected row via real click on run-completed (HashRouter renders
// react-router Link hrefs as "#/runs/run-completed").
await evaluate(
  `(() => {
    const link = document.querySelector('a[href="#/runs/run-completed"]');
    if (link) link.click();
    return Boolean(link);
  })()`,
);
await waitFor("Boolean(document.querySelector('[data-selected=\"true\"]'))", "selected row");
const prodSelected = await evaluate(
  styleProbe({ wrapper: '[data-selected="true"]', detailHeader: '[data-section="header"]' }),
);
await screenshot("04-prod-list-selected");
record("prod.detail.selectedRow", {
  pass:
    prodSelected.wrapper?.bg === "rgb(24, 24, 24)" &&
    (prodSelected.wrapper?.boxShadow ?? "").includes("rgb(0, 229, 255)"),
  evidence: prodSelected.wrapper,
  note: "production selected = raised bg + 2px inset cyan accent via box-shadow",
});

// 2c. Completed detail: sections, header hierarchy, timeline, toolbar
const completedDetail = await evaluate(
  `(() => {
    const t = (sel) => (document.querySelector(sel)?.textContent ?? "").replace(/\\s+/g, " ").trim();
    return {
      sections: [...document.querySelectorAll("[data-section]")].map((s) => s.getAttribute("data-section")),
      headerTitle: t('[data-section="header"] h2, [data-section="header"] h1'),
      headerMetaLines: document.querySelectorAll('[data-section="header"] .text-sm, [data-section="header"] [class*="text-sm"]').length,
      timelineSteps: document.querySelectorAll('[data-section="timeline"] li').length,
      toolbarButtons: [...document.querySelectorAll('[data-section="header"] button, [data-section="header"] a')]
        .map((b) => (b.textContent ?? "").replace(/\\s+/g, " ").trim())
        .filter(Boolean),
    };
  })()`,
);
await screenshot("05-prod-detail-completed");
record("prod.detail.sections", {
  pass: completedDetail.sections.length >= 5 && completedDetail.sections.includes("timeline"),
  evidence: completedDetail,
});
record("prod.detail.toolbar", {
  pass:
    completedDetail.toolbarButtons.some((b) => /copy/i.test(b)) &&
    completedDetail.toolbarButtons.some((b) => /compare/i.test(b)),
  evidence: completedDetail,
  note: "Slice 5 contextual continuity: Copy link + Open in Compare present in detail header",
});

// 2d. Fuse + cost breakdown detail (richest evidence view)
await navigate(`${prodBaseUrl}#/runs/run-fuse`);
await waitFor(
  "Boolean(document.querySelector('[data-section=\"cost-breakdown\"]'))",
  "cost breakdown",
);
const fuseDetail = await evaluate(
  `(() => {
    const t = (sel) => (document.querySelector(sel)?.textContent ?? "").replace(/\\s+/g, " ").trim();
    return {
      sections: [...document.querySelectorAll("[data-section]")].map((s) => s.getAttribute("data-section")),
      costCards: document.querySelectorAll('[data-section="cost-breakdown"] [data-cost-source]').length,
      costSources: [...document.querySelectorAll('[data-section="cost-breakdown"] [data-cost-source]')].map((el) => el.getAttribute("data-cost-source")),
      costTotal: t("[data-cost-total]"),
      timelineSteps: document.querySelectorAll('[data-section="timeline"] li').length,
      fusionText: t('[data-section="fusion"]').slice(0, 120),
    };
  })()`,
);
const prodCyanDetail = await evaluate(CYAN_COUNT_PROBE);
await screenshot("06-prod-detail-fuse");
record("prod.detail.costCards", {
  pass: fuseDetail.costCards >= 2 && Boolean(fuseDetail.costTotal),
  evidence: fuseDetail,
  note: "cost breakdown rendered as per-stage cards (one per candidate with a cost source) plus a total (transplant map F1)",
});
record("prod.detail.timeline", {
  pass: fuseDetail.timelineSteps >= 4,
  evidence: fuseDetail,
  note: "lifecycle timeline present (transplant map J: RESTYLE visual version)",
});
record("prod.detail.cyanSelective", {
  pass:
    (prodCyanDetail.count ?? 99) <= Math.max(50, Math.round((protoCyanDetail.count ?? 20) * 1.75)),
  evidence: { ...prodCyanDetail, protoCount: protoCyanDetail.count },
});

// 2e. List/detail continuity: list pane remains mounted in the split with the
// selected row visible while detail is open.
const continuity = await evaluate(
  `(() => ({
    listVisibleInSplit: (() => {
      const listEl = document.querySelector('ul[role="list"]');
      if (!listEl) return false;
      const r = listEl.getBoundingClientRect();
      return r.width > 300 && r.height > 100;
    })(),
    selectedCount: document.querySelectorAll('[data-selected="true"]').length,
  }))()`,
);
record("prod.continuity.split", {
  pass: continuity.listVisibleInSplit && continuity.selectedCount === 1,
  evidence: continuity,
  note: "desktop split keeps the list + selected accent visible while detail renders",
});

// --- Console errors -----------------------------------------------------------
const prodConsoleErrors = [...results.consoleErrors];
record("prod.console.clean", {
  pass: prodConsoleErrors.length === 0,
  evidence: { errors: prodConsoleErrors.slice(0, 5) },
});

// --- Output -------------------------------------------------------------------
const report = {
  ...results,
  summary: {
    protoList,
    protoRows,
    prodList,
    prodRows,
    prodRowSample,
    completedDetail,
    fuseDetail,
  },
};
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(report, null, 2));
console.log(`Probes: ${results.probes.length}, Screenshots: ${results.screenshots.length}`);
console.log(results.probes.map((p) => `${p.pass ? "PASS" : "FAIL"} ${p.name}`).join("\n"));

chromeProc.kill();
protoServerHandle.close();
