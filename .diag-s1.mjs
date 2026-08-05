// Diagnostic: run the S1 extension and dump console messages + task states.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? process.argv[2] ?? "http://localhost:5176/";
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const debugPort = 9341;

// Load the real harness pieces by importing the QA script's sources is hard;
// instead, re-read them from the file.
const qaSrc = fs.readFileSync("scripts/cdp-experiment-roster-extension-qa.mjs", "utf8");
const extract = (name) => {
  const m = qaSrc.match(new RegExp("const " + name + " = `([\\s\\S]+?)`;"));
  if (!m) throw new Error("missing " + name);
  return m[1];
};
const MOCK_FETCH_SOURCE = extract("MOCK_FETCH_SOURCE");
const SEED_SOURCE = extract("SEED_SOURCE");

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${path.join(os.tmpdir(), `rsemble-diag-${Date.now()}`)}`,
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function getPageWebSocketUrl() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const pages = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${debugPort}/json/list`, (res) => {
          let body = "";
          res.on("data", (c) => { body += c; });
          res.on("end", () => resolve(JSON.parse(body)));
        }).on("error", reject);
      });
      const page = pages.find((c) => c.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await wait(250);
  }
  throw new Error("no CDP target");
}
const socket = new WebSocket(await getPageWebSocketUrl());
let nextId = 0;
const pending = new Map();
const consoleMessages = [];
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.consoleAPICalled") {
    const text = (message.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
    consoleMessages.push(`[${message.params.type}] ${text}`);
  }
  if (message.method === "Runtime.exceptionThrown") {
    const d = message.params.exceptionDetails;
    consoleMessages.push(`[exception] ${d.exception?.description ?? d.text}`);
  }
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message);
};
await new Promise((r) => { socket.onopen = r; });
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "eval failed");
  return result.result?.value;
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK_FETCH_SOURCE });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: baseUrl });
  await wait(1500);
  const seeded = await evaluate(SEED_SOURCE);
  if (seeded?.__seedError) throw new Error(`Seed failed: ${seeded.__seedError}`);
  await wait(1200);

  // Navigate and open the dialog.
  await send("Page.navigate", { url: `${baseUrl}#/experiments/exp-roster` });
  await wait(2000);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Add model");
    if (!button) throw new Error("no Add model button");
    button.click();
  })()`);
  await wait(800);
  // Pick the catalog entry.
  await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const button = [...dialog.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("deepseek/deepseek-chat") && !b.disabled);
    if (!button) throw new Error("no catalog entry");
    button.click();
  })()`);
  await wait(800);
  const preview = await evaluate(`document.querySelector('[role="dialog"] [data-cost-preview]')?.textContent ?? "NO PREVIEW"`);
  console.log("PREVIEW:", preview);
  await evaluate(`window.__qaCalls = []`);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent ?? "").includes("Add and run"));
    button.click();
  })()`);

  // Watch the experiment record for 12 seconds.
  for (let i = 0; i < 24; i += 1) {
    await wait(500);
    const state = await evaluate(`new Promise((resolve) => {
      const open = indexedDB.open("rsemble-evaluation");
      open.onsuccess = () => {
        const db = open.result;
        const r = db.transaction("experiments", "readonly").objectStore("experiments").get("exp-roster");
        r.onsuccess = () => {
          const exp = r.result?.experiment;
          db.close();
          resolve({
            revision: r.result?.revision,
            status: exp?.status,
            rosterExt: (exp?.rosterExtensions ?? []).length,
            tasks: (exp?.tasks ?? []).map((t) => ({
              taskId: t.taskId,
              attempts: t.attempts.map((a) => ({ id: a.id, status: a.status, runId: a.runId, error: a.error })),
            })),
            calls: (window.__qaCalls ?? []).length,
          });
        };
      };
    })`);
    console.log(`t=${(i + 1) * 0.5}s`, JSON.stringify(state));
    if (state.status === "completed" || state.status === "completed_with_failures" || state.status === "aborted") {
      if (state.revision > 3) break;
    }
  }
  console.log("\n=== CONSOLE MESSAGES ===");
  for (const m of consoleMessages.slice(-40)) console.log(m);
} finally {
  try { socket.close(); } catch {}
  chrome.kill();
}
