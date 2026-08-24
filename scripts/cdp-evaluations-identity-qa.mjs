#!/usr/bin/env node
// =============================================================================
// cdp-evaluations-identity-qa.mjs — browser-matrix QA evidence for the
// Evaluations identity/UX upgrade (Task 14, identity spec §8).
//
// Deterministic: seeds rsemble-evaluation IndexedDB with known suites,
// profiles, and one completed experiment — no provider calls, no mock fetch
// needed (nothing runs). Verifies at every viewport:
//   - no horizontal overflow
//   - identity grammar renders: Workload/Rubric eyebrows, rubric chip,
//     holistic chip, latest-run line, segmented-nav sublabels
//   - archive slot holds stable width (Task 12)
//   - reduced motion removes spinner rotation
//
// Usage: node scripts/cdp-evaluations-identity-qa.mjs [baseUrl]
//   QA_BASE_URL env overrides the argument. Default http://localhost:5176/
// =============================================================================
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? process.argv[2] ?? "http://localhost:5176/";
const outDir = path.resolve("docs/qa/evaluations-identity-ux");
const chromePath =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const debugPort = 9340;
const results = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  probes: [],
  screenshots: [],
};
fs.mkdirSync(outDir, { recursive: true });

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${path.join(os.tmpdir(), `rsemble-identity-qa-${Date.now()}`)}`,
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
            response.on("data", (chunk) => {
              body += chunk;
            });
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

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
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

async function waitFor(expression, label, maxAttempts = 80) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(125);
  }
  const diagnostic = await evaluate(`({
    hash: location.hash,
    title: document.title,
    body: (document.body?.innerText ?? "").slice(0, 800),
  })`);
  throw new Error(`Timed out waiting for ${label}. ${JSON.stringify(diagnostic)}`);
}

async function setViewport({ width, height, mobile = false, touch = false }) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile,
  });
  await send(
    "Emulation.setTouchEmulationEnabled",
    touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
  );
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

async function navigateTo(hash) {
  await send("Page.navigate", { url: `${baseUrl}${hash}` });
  await waitFor(
    "Boolean(document.querySelector('main, [role=main], #root > *'))",
    "application shell",
  );
  await wait(500);
}

// --- Deterministic seed ------------------------------------------------------
// One rubric (pinnable), one workload pinned to it, one holistic workload,
// one completed experiment for the pinned workload (drives the latest-run
// line). Shapes match database.ts wrapper rows, verified against the app's
// validators (isEvaluationSuite / isProfileRecord).
const SEED_SOURCE = `(async () => {
  const DB = "rsemble-evaluation";
  const openDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const put = (db, store, value) => new Promise((resolve, reject) => {
    const r = db.transaction(store, "readwrite").objectStore(store).put(value);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  const db = await openDb();
  const NOW = 1700000000000;

  const record = {
    id: "prof-matrix", revision: 1, latestVersion: 1,
    createdAt: NOW, updatedAt: NOW, archivedAt: null,
  };
  const profile = {
    id: "prof-matrix", version: 1, name: "Clarity",
    description: "QA rubric for the identity matrix.",
    judgeInstruction: "Judge fairly.",
    criteria: [{
      id: "c-1", name: "Correctness", description: "",
      weight: 1, anchors: { one: "Wrong", three: "Partial", five: "Correct" },
    }],
    createdAt: NOW, updatedAt: NOW,
  };
  await put(db, "profiles", {
    id: record.id, record, revision: 1, latestVersion: 1,
    updatedAt: NOW, archivedAt: null,
  });
  await put(db, "profileVersions", {
    id: profile.id, version: 1, profile, updatedAt: NOW,
  });

  const SLOTS = [
    { id: "s1", providerId: "umans", provider: "Umans", model: "Model", slug: "model", enabled: true },
  ];
  const makeTask = (id, order) => ({
    id, title: "Task " + id, prompt: "Prompt " + id, systemPrompt: "",
    evaluation: { kind: "inherit" }, judgeInstructionOverride: "", order,
  });

  const pinnedSuite = {
    id: "suite-matrix", revision: 2, version: 1, name: "Matrix Suite",
    description: "Workload pinned to the Clarity rubric.",
    tasks: [makeTask("t1", 0)], modelSlots: SLOTS,
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "profile", profile: { id: "prof-matrix", version: 1 } },
    createdAt: NOW, updatedAt: NOW + 1000, archivedAt: null,
  };
  const holisticSuite = {
    id: "suite-holistic", revision: 2, version: 1, name: "Holistic Suite",
    description: "Workload with holistic judging.",
    tasks: [makeTask("t1", 0)], modelSlots: SLOTS,
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: NOW, updatedAt: NOW + 2000, archivedAt: null,
  };
  for (const s of [pinnedSuite, holisticSuite]) {
    await put(db, "suites", {
      id: s.id, suite: s, revision: s.revision, version: s.version,
      updatedAt: s.updatedAt, archivedAt: s.archivedAt,
    });
  }

  const experiment = {
    id: "exp-matrix", revision: 2, suiteId: "suite-matrix", suiteVersion: 1,
    protocolFingerprint: "sha256:qa", status: "completed", execution: null,
    snapshot: {
      suiteId: "suite-matrix", suiteVersion: 1,
      tasks: [makeTask("t1", 0)], modelSlots: SLOTS,
      defaultJudge: { providerId: "openrouter", model: "judge" },
      defaultEvaluation: { kind: "profile", profile: { id: "prof-matrix", version: 1 } },
      profiles: [], protocolFingerprint: "sha256:qa", createdAt: NOW,
    },
    tasks: [{
      taskId: "t1", selectedAttemptId: "att-t1",
      attempts: [{
        id: "att-t1", runId: "run-matrix-t1", trial: 0, status: "completed",
        startedAt: NOW + 3000, finishedAt: NOW + 4000, error: null,
        coverage: { scoredModelKeys: ["umans:model"], totalModels: 1 },
      }],
    }],
    createdAt: NOW + 3000, updatedAt: NOW + 4000,
  };
  await put(db, "experiments", {
    id: experiment.id, experiment, revision: experiment.revision,
    suiteId: experiment.suiteId, suiteVersion: experiment.suiteVersion,
    protocolFingerprint: experiment.protocolFingerprint,
    createdAt: experiment.createdAt, status: experiment.status,
  });
  const taskRecord = {
    id: "t1", latestVersion: 1, createdAt: NOW, updatedAt: NOW, archivedAt: null,
    origin: "legacy-task-set", revision: 1,
  };
  const taskVersion = {
    taskId: "t1", version: 1, title: "Task t1 v1", objective: "Do the task",
    candidateInstruction: "Solve it", defaultContextManifest: [],
    responseContract: { format: "text", constraints: [], maxLength: null },
    taskVerifierRef: null, source: { kind: "legacy-task-set", legacyScopeKey: "legacy:t1", note: null },
    createdAt: NOW,
  };
  await put(db, "tasks", {
    id: taskRecord.id, record: taskRecord, latestVersion: 1, createdAt: NOW,
    updatedAt: NOW, archivedAt: null, origin: "legacy-task-set", revision: 1,
  });
  await put(db, "taskVersions", {
    taskId: "t1", version: 1, version_: taskVersion, createdAt: NOW,
  });

  const tsRecord = {
    id: "suite-matrix", latestVersion: 1, name: "Matrix Suite",
    description: "Workload pinned to the Clarity rubric.", createdAt: NOW,
    updatedAt: NOW, archivedAt: null, revision: 1, origin: "legacy-suite",
  };
  const tsVersion = {
    taskSetId: "suite-matrix", version: 1,
    members: [{
      id: "member-1", taskVersionRef: { taskId: "t1", version: 1 }, order: 0,
      role: "organic", stratum: null, weight: 1, rubricOverrideRef: null,
      executionOverrides: null, unresolved: null,
    }],
    defaultRubricRef: { id: "prof-matrix", version: 1 },
    defaultModelSlots: SLOTS,
    defaultJudge: { providerId: "openrouter", model: "judge" },
    repeatPolicy: { kind: "none" },
    missingnessPolicy: { kind: "strict" },
    protocolDefaults: {},
    createdAt: NOW,
  };
  await put(db, "taskSets", {
    id: tsRecord.id, record: tsRecord, latestVersion: 1, name: "Matrix Suite",
    createdAt: NOW, updatedAt: NOW, archivedAt: null, origin: "legacy-suite", revision: 1,
  });
  await put(db, "taskSetVersions", {
    taskSetId: "suite-matrix", version: 1, version_: tsVersion, createdAt: NOW,
  });

  db.close();
  return true;
})().catch((e) => ({ __seedError: e instanceof Error ? e.message : String(e) }))`;

// Assertions shared by every viewport probe.
// NOTE: innerText reflects CSS text-transform, so eyebrow words render
// UPPERCASE — assert via the KindEyebrow tooltip attributes (exact component
// proof) instead. Sublabels carry data-nav-sublabel markers. Links resolve
// through the hash router, so hrefs carry a "#/" prefix.
const IDENTITY_ASSERT_SOURCE = `(() => {
  const has = (s) => (document.body.innerText ?? "").includes(s);
  const workloadEyebrow = Boolean(document.querySelector('span[title="A versioned set of tasks, models, and a judge. You run it."]'));
  const chip = document.querySelector('[aria-label^="Rubric "]');
  const slot = document.querySelector('[data-geometry="task-set-archive-slot"]');
  const slotStyle = slot ? getComputedStyle(slot).minWidth : null;
  const sublabels = [...document.querySelectorAll('[data-nav-sublabel]')];
  const activeVisible = sublabels.some((s) => !s.classList.contains("invisible"));
  return {
    overflowX: document.documentElement.scrollWidth > innerWidth,
    workloadEyebrow,
    pinnedChip: Boolean(chip) && chip.getAttribute("aria-label").includes("Clarity v1"),
    chipLink: chip ? chip.getAttribute("href") : null,
    holisticChip: has("Holistic judging"),
    latestRun: has("last run"),
    sublabelCount: sublabels.length,
    sublabelsVisible: activeVisible,
    suiteNames: has("Matrix Suite") && has("Holistic Suite"),
    slotMinWidth: slotStyle,
    innerWidth,
  };
})()`;

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setEmulatedMedia", { features: [] });

  // Seed on a fresh shell navigation so IndexedDB exists before the app reads it.
  await navigateTo("");
  await waitFor("Boolean(window.indexedDB)", "indexedDB");
  const seeded = await evaluate(SEED_SOURCE);
  if (seeded?.__seedError) throw new Error(`Seed failed: ${seeded.__seedError}`);

  // --- 1440×1000 desktop -------------------------------------------------------
  await setViewport({ width: 1440, height: 1000 });
  await navigateTo("#/evaluations/sets");
  await waitFor("Boolean(document.querySelector('[data-record-row]'))", "suite rows");
  const desktop = await evaluate(IDENTITY_ASSERT_SOURCE);
  record("desktop-1440", {
    ...desktop,
    pass:
      !desktop.overflowX &&
      desktop.workloadEyebrow &&
      desktop.pinnedChip &&
      desktop.chipLink === "#/evaluations/rubrics/prof-matrix" &&
      desktop.holisticChip &&
      desktop.latestRun &&
      desktop.sublabelCount === 2 &&
      desktop.sublabelsVisible &&
      desktop.suiteNames &&
      desktop.slotMinWidth === "136px",
    reason:
      "no overflow; identity grammar, chip link, latest run, sublabels, and stable archive slot all render",
  });
  await screenshot("qa-desktop-1440");

  // --- 1024×768 tablet landscape ------------------------------------------------
  await setViewport({ width: 1024, height: 768 });
  await navigateTo("#/evaluations/sets");
  await waitFor("Boolean(document.querySelector('[data-record-row]'))", "suite rows");
  const tablet = await evaluate(IDENTITY_ASSERT_SOURCE);
  record("tablet-1024", {
    ...tablet,
    pass:
      !tablet.overflowX &&
      tablet.workloadEyebrow &&
      tablet.pinnedChip &&
      tablet.holisticChip &&
      tablet.sublabelCount === 2 &&
      tablet.suiteNames,
    reason: "identity grammar holds at tablet width without overflow",
  });
  await screenshot("qa-tablet-1024");

  // --- 768×1024 tablet portrait -------------------------------------------------
  await setViewport({ width: 768, height: 1024 });
  await navigateTo("#/evaluations/sets");
  await waitFor("Boolean(document.querySelector('[data-record-row]'))", "suite rows");
  const portrait = await evaluate(IDENTITY_ASSERT_SOURCE);
  record("tablet-portrait-768", {
    ...portrait,
    pass:
      !portrait.overflowX &&
      portrait.workloadEyebrow &&
      portrait.pinnedChip &&
      portrait.holisticChip &&
      portrait.suiteNames,
    reason: "identity grammar holds at portrait tablet width without overflow",
  });
  await screenshot("qa-tablet-portrait-768");

  // --- 390×844 mobile -----------------------------------------------------------
  // Below sm, chips and eyebrows collapse to icon-only (aria-label/title carry
  // the meaning; innerText excludes hidden text), so assert on the attributes.
  await setViewport({ width: 390, height: 844, mobile: true, touch: true });
  await navigateTo("#/evaluations/sets");
  await waitFor("Boolean(document.querySelector('[data-record-row]'))", "suite rows");
  const mobile = await evaluate(`(() => {
    const has = (s) => (document.body.innerText ?? "").includes(s);
    return {
      overflowX: document.documentElement.scrollWidth > innerWidth,
      workloadEyebrow: Boolean(document.querySelector('span[title="A versioned set of tasks, models, and a judge. You run it."]')),
      pinnedChip: Boolean(document.querySelector('[aria-label="Rubric Clarity v1"]')),
      chipLink: document.querySelector('[aria-label="Rubric Clarity v1"]')?.getAttribute("href") ?? null,
      holisticChip: Boolean(document.querySelector('[aria-label="Holistic judging"]')),
      titleVisible: [...document.querySelectorAll(".truncate")].some((el) => el.getBoundingClientRect().width > 40 && el.textContent.includes("Suite")),
      suiteNames: has("Matrix Suite") && has("Holistic Suite"),
      innerWidth,
    };
  })()`);
  record("mobile-390", {
    ...mobile,
    pass:
      !mobile.overflowX &&
      mobile.workloadEyebrow &&
      mobile.pinnedChip &&
      mobile.chipLink === "#/evaluations/rubrics/prof-matrix" &&
      mobile.holisticChip &&
      mobile.titleVisible &&
      mobile.suiteNames,
    reason: "icon-only chips and eyebrow keep titles legible at 390px without overflow",
  });
  await screenshot("qa-mobile-390");

  // --- Profiles list at desktop (rubric identity + reusable status) --------------
  await setViewport({ width: 1440, height: 1000 });
  await navigateTo("#/evaluations/rubrics");
  await waitFor("Boolean(document.querySelector('[data-record-row]'))", "rubric rows");
  const rubricsPage = await evaluate(`(() => {
    const body = document.body.innerText ?? "";
    return {
      overflowX: document.documentElement.scrollWidth > innerWidth,
      // KindEyebrow renders UPPERCASE via text-transform — assert the tooltip.
      rubricEyebrow: Boolean(document.querySelector('span[title="Scoring criteria with 1/3/5 anchors. It judges, it does not run."]')),
      reusableStatus: body.includes("Reusable"),
      criteriaPreview: body.includes("1 criterion"),
      profileRow: body.includes("Clarity"),
      hasNewRubricAction: Boolean(document.querySelector('[data-action="new-rubric"]')),
    };
  })()`);
  record("rubrics-1440", {
    ...rubricsPage,
    pass:
      !rubricsPage.overflowX &&
      rubricsPage.rubricEyebrow &&
      rubricsPage.reusableStatus &&
      rubricsPage.profileRow &&
      rubricsPage.hasNewRubricAction,
    reason: "rubric rows show rubric identity, reusable status, and new rubric action",
  });
  await screenshot("qa-rubrics-1440");

  // --- 200% zoom (720px CSS viewport, per suite-reliability convention) ----------
  await setViewport({ width: 720, height: 500 });
  await navigateTo("#/evaluations/sets");
  await waitFor("Boolean(document.querySelector('[data-record-row]'))", "suite rows");
  const zoom = await evaluate(`(() => {
    return {
      overflowX: document.documentElement.scrollWidth > innerWidth,
      innerWidth,
      pinnedChip: Boolean(document.querySelector('[aria-label^="Rubric "]')),
      workloadEyebrow: Boolean(document.querySelector('span[title="A versioned set of tasks, models, and a judge. You run it."]')),
    };
  })()`);
  record("zoom-200-percent", {
    ...zoom,
    pass: !zoom.overflowX && zoom.innerWidth === 720 && zoom.pinnedChip && zoom.workloadEyebrow,
    reason: "effective 200% CSS viewport keeps identity grammar legible without overflow",
  });
  await screenshot("qa-zoom-200");

  // --- Reduced motion --------------------------------------------------------------
  await setViewport({ width: 1440, height: 1000 });
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await navigateTo("#/evaluations/sets");
  await waitFor("Boolean(document.querySelector('[data-record-row]'))", "suite rows");
  const reduced = await evaluate(`(() => {
    const spinner = document.createElement("span");
    spinner.className = "animate-spin-ease";
    document.body.append(spinner);
    const animation = getComputedStyle(spinner).animationName;
    spinner.remove();
    return {
      spinnerAnimation: animation,
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  record("reduced-motion", {
    ...reduced,
    pass: reduced.spinnerAnimation === "none" && !reduced.overflowX,
    reason: "reduced motion removes spinner rotation without horizontal overflow",
  });
  await screenshot("qa-reduced-motion");

  // --- Task Set List Actions (create & import) --------------------------------
  await setViewport({ width: 1440, height: 1000 });
  await navigateTo("#/evaluations/sets");
  await waitFor("Boolean(document.querySelector('[data-record-row]'))", "suite rows");
  const listActions = await evaluate(`(() => {
    return {
      createAction: Boolean(document.querySelector('[data-action="create-task-set"]')),
      importAction: Boolean(document.querySelector('[data-action="import-suite"]')),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  record("task-set-list-actions", {
    ...listActions,
    pass: listActions.createAction && listActions.importAction && !listActions.overflowX,
    reason: "task set list provides create and import actions without horizontal overflow",
  });

  // --- Rubric Detail & Version Selector ----------------------------------------
  await setViewport({ width: 1440, height: 1000 });
  await navigateTo("#/evaluations/rubrics/prof-matrix");
  await waitFor(
    "Boolean(document.querySelector('[data-action=\"save\"]'))",
    "rubric detail save action",
  );
  const rubricDetail = await evaluate(`(() => {
    const text = document.body.textContent ?? "";
    return {
      nameClarity: (document.querySelector('input#rubric-name')?.value ?? text).includes("Clarity"),
      hasSave: Boolean(document.querySelector('[data-action="save"]')),
      hasDuplicate: Boolean(document.querySelector('[data-action="duplicate"]')),
      hasVersionSelector: Boolean(document.querySelector('[data-action="version-selector"]')),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  record("rubric-detail-1440", {
    ...rubricDetail,
    pass:
      rubricDetail.nameClarity &&
      rubricDetail.hasSave &&
      rubricDetail.hasDuplicate &&
      rubricDetail.hasVersionSelector &&
      !rubricDetail.overflowX,
    reason: "rubric detail renders rubric name, save/duplicate actions, and version selector",
  });
  await screenshot("qa-rubric-detail-1440");

  // --- Task Set Editor at 1440 -------------------------------------------------
  await setViewport({ width: 1440, height: 1000 });
  await navigateTo("#/evaluations/sets/suite-matrix");
  await waitFor(
    "Boolean(document.querySelector('[data-action=\"run-task-set\"]'))",
    "task set editor run action",
  );
  const editor1440 = await evaluate(`(() => {
    const text = document.body.textContent ?? "";
    return {
      hasRunAction: Boolean(document.querySelector('[data-action="run-task-set"]')),
      hasSaveAction: Boolean(document.querySelector('[data-action="save-task-set"]')),
      hasSettings: Boolean(document.querySelector('[aria-controls="suite-settings-disclosure"]')),
      suiteTitle: text.includes("Matrix Suite"),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  record("task-set-editor-1440", {
    ...editor1440,
    pass:
      editor1440.hasRunAction &&
      editor1440.hasSaveAction &&
      editor1440.hasSettings &&
      editor1440.suiteTitle &&
      !editor1440.overflowX,
    reason: "task set editor renders run, save, and settings actions without overflow at 1440px",
  });
  await screenshot("qa-task-set-editor-1440");

  // --- Task Set Editor at 390 mobile -------------------------------------------
  await setViewport({ width: 390, height: 844, mobile: true, touch: true });
  await navigateTo("#/evaluations/sets/suite-matrix");
  await waitFor(
    "Boolean(document.querySelector('[data-action=\"run-task-set\"]'))",
    "task set editor mobile run action",
  );
  const editor390 = await evaluate(`(() => {
    return {
      hasRunAction: Boolean(document.querySelector('[data-action="run-task-set"]')),
      hasSaveAction: Boolean(document.querySelector('[data-action="save-task-set"]')),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  record("task-set-editor-390", {
    ...editor390,
    pass: editor390.hasRunAction && editor390.hasSaveAction && !editor390.overflowX,
    reason: "task set editor renders run and save actions without horizontal overflow at 390px",
  });
  await screenshot("qa-task-set-editor-390");

  // --- Task Set Version Route (historical read-only) ---------------------------
  await setViewport({ width: 1440, height: 1000, mobile: false, touch: false });
  await navigateTo("#/evaluations/sets/suite-matrix/versions/1");
  await waitFor(
    "Boolean(document.querySelector('[data-action=\"run-task-set\"]'))",
    "task set version run action",
  );
  const versionView = await evaluate(`(() => {
    const text = document.body.textContent ?? "";
    return {
      hasRunAction: Boolean(document.querySelector('[data-action="run-task-set"]')),
      hasVersionInfo: text.includes("v1") && (text.includes("read-only") || text.includes("Saved")),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  record("task-set-version-1440", {
    ...versionView,
    pass: versionView.hasRunAction && versionView.hasVersionInfo && !versionView.overflowX,
    reason: "version route displays version state and run action without overflow",
  });
  await screenshot("qa-task-set-version-1440");

  fs.writeFileSync(path.join(outDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Evaluations-identity QA passed. Evidence: ${outDir}`);
} catch (error) {
  fs.writeFileSync(
    path.join(outDir, "results.json"),
    `${JSON.stringify({ ...results, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  socket.close();
  chrome.kill();
}
