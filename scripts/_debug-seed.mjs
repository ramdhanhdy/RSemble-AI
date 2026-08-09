// Debug: seed the edge fixtures and inspect what the app sees.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const baseUrl = "http://localhost:5173/";
const chromePath = "/opt/data/home/.chrome/chrome-headless-shell-linux64/chrome-headless-shell";
const debugPort = 9351;

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${path.join(os.tmpdir(), `rsemble-edge-debug-${Date.now()}`)}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageWebSocketUrl() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const pages = await new Promise((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${debugPort}/json/list`, (response) => {
            let body = "";
            response.on("data", (c) => (body += c));
            response.on("end", () => resolve(JSON.parse(body)));
          })
          .on("error", reject);
      });
      const page = pages.find((c) => c.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error("no page");
}

const socket = new WebSocket(await getPageWebSocketUrl());
let nextId = 0;
const pending = new Map();
socket.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
await new Promise((r) => (socket.onopen = r));

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
}
async function waitFor(expression, label) {
  for (let i = 0; i < 80; i += 1) {
    if (await evaluate(expression)) return;
    await wait(125);
  }
  throw new Error("timeout: " + label);
}
async function navigate(hash) {
  await send("Page.navigate", { url: baseUrl + hash });
  await waitFor("Boolean(document.querySelector('#root > *'))", "shell");
  await wait(600);
}

const seed = fs.readFileSync("/opt/data/projects/RSemble-AI/scripts/cdp-runs-edge-qa.mjs", "utf8");
const seedSource = seed.match(/const SEED_SOURCE = `([\s\S]*?)`;/)[1];

await send("Page.enable");
await send("Runtime.enable");
await navigate("#/runs");
await wait(1200);
const body0 = await evaluate("(document.body.innerText ?? '').slice(0, 200)");
console.log("after first load (fresh profile):", JSON.stringify(body0));
const fillerDump = await evaluate(`(async () => {
  const openDb = () => new Promise((res, rej) => {
    const req = indexedDB.open("rsemble-evaluation");
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const db = await openDb();
  const first = (store) => new Promise((res, rej) => {
    const r = db.transaction(store).objectStore(store).getAll(null, 1);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const rows = await first("runSummaries");
  db.close();
  return rows.map((r) => ({ id: r.id, kind: r.kind, createdAt: r.createdAt, status: r.status, taskTitle: r.summary?.taskTitle, schemaVersion: r.summary?.schemaVersion }));
})()`);
console.log("filler row:", JSON.stringify(fillerDump).slice(0, 400));

const clearSource = `(async () => {
  const openDb = () => new Promise((res, rej) => {
    const req = indexedDB.open("rsemble-evaluation");
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const db = await openDb();
  const clearStore = (store) => new Promise((res, rej) => {
    const r = db.transaction(store, "readwrite").objectStore(store).clear();
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
  await clearStore("runSummaries");
  await clearStore("runDetails");
  db.close();
  return true;
})()`;
await evaluate(clearSource);
await navigate("#/runs");
await wait(1000);
const body1 = await evaluate("(document.body.innerText ?? '').slice(0, 200)");
console.log("after clear+reload:", JSON.stringify(body1));

const seeded = await evaluate(seedSource);
console.log("seed result:", JSON.stringify(seeded).slice(0, 200));

const dbDump = await evaluate(`(async () => {
  const openDb = () => new Promise((res, rej) => {
    const req = indexedDB.open("rsemble-evaluation");
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const db = await openDb();
  const count = (store) => new Promise((res, rej) => {
    const r = db.transaction(store).objectStore(store).count();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const c1 = await count("runSummaries");
  const c2 = await count("runDetails");
  db.close();
  return { runSummaries: c1, runDetails: c2 };
})()`);
console.log("DB after seed:", JSON.stringify(dbDump));

await navigate("#/runs");
await wait(1200);
const body2 = await evaluate("(document.body.innerText ?? '').slice(0, 300)");
const rows2 = await evaluate(
  'document.querySelectorAll(\'ul[role="list"] a[href*="/runs/"]\').length',
);
const dbDump2 = await evaluate(`(async () => {
  const openDb = () => new Promise((res, rej) => {
    const req = indexedDB.open("rsemble-evaluation");
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const db = await openDb();
  const count = (store) => new Promise((res, rej) => {
    const r = db.transaction(store).objectStore(store).count();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const c1 = await count("runSummaries");
  db.close();
  return { runSummaries: c1 };
})()`);
console.log(
  "after seed+reload: rows:",
  rows2,
  "DB:",
  JSON.stringify(dbDump2),
  "body:",
  JSON.stringify(body2.slice(0, 250)),
);

try {
  socket.close();
} catch {}
chrome.kill("SIGKILL");
