// READ-ONLY probe: inspect the user's live experiment record to find WHY the
// roster-extension attempts failed instantly. Touches nothing — no writes,
// no clicks, no navigation (evaluates against the current page only).
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const baseUrl = process.argv[2] ?? "http://localhost:5173/";
const chromePath =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const debugPort = 9377;

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${path.join(os.tmpdir(), `rsemble-probe-${Date.now()}`)}`,
    "--no-first-run",
    "--no-default-browser-check",
    baseUrl,
  ],
  { stdio: "ignore" },
);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function getPageWebSocketUrl() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const pages = await new Promise((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${debugPort}/json/list`, (res) => {
            let body = "";
            res.on("data", (c) => {
              body += c;
            });
            res.on("end", () => resolve(JSON.parse(body)));
          })
          .on("error", reject);
      });
      const page = pages.find((c) => c.type === "page" && c.url.includes("5173"));
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await wait(250);
  }
  throw new Error("no CDP target");
}
const socket = new WebSocket(await getPageWebSocketUrl());
let nextId = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message);
};
await new Promise((r) => {
  socket.onopen = r;
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (m) =>
      m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result),
    );
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? "eval failed");
  return result.result?.value;
}

try {
  await send("Runtime.enable");
  await wait(2500); // let the SPA boot against the SAME origin storage

  const report = await evaluate(`new Promise((resolve) => {
    const open = indexedDB.open("rsemble-evaluation");
    open.onerror = () => resolve({ error: "cannot open DB: " + open.error });
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(["experiments", "runs"], "readonly");
      const expStore = tx.objectStore("experiments");
      const runStore = tx.objectStore("runs");
      const all = expStore.getAll();
      all.onsuccess = () => {
        const rows = all.result ?? [];
        const out = [];
        for (const row of rows) {
          const exp = row.experiment;
          const taskTitles = (exp.tasks ?? []).map((t) => t.title);
          if (!taskTitles.some((t) => String(t).toLowerCase().includes("acquisition"))) continue;
          const summary = {
            experimentId: exp.id,
            status: exp.status,
            revision: row.revision,
            rosterSize: (exp.snapshot?.modelSlots ?? []).length,
            rosterExtensions: (exp.rosterExtensions ?? []).map((r) => ({
              addedModelKey: r.addedModelKey, extendedAt: r.extendedAt,
            })),
            tasks: [],
          };
          for (const t of exp.tasks ?? []) {
            summary.tasks.push({
              taskId: t.taskId,
              title: String(t.title).slice(0, 60),
              selectedAttemptId: t.selectedAttemptId,
              attempts: t.attempts.map((a) => ({
                id: a.id, trial: a.trial, status: a.status, runId: a.runId,
                error: a.error ?? null,
                repair: a.repair ?? null,
                startedAt: a.startedAt, finishedAt: a.finishedAt,
              })),
            });
          }
          out.push(summary);
        }
        if (out.length === 0) { db.close(); resolve({ error: "no matching experiment", totalRows: rows.length }); return; }
        // Pull run records for every non-completed extension attempt.
        const runIds = [];
        for (const s of out) for (const t of s.tasks) for (const a of t.attempts) {
          if (a.repair && a.status !== "completed" && a.runId) runIds.push(a.runId);
        }
        let remaining = runIds.length;
        if (remaining === 0) { db.close(); resolve({ experiments: out, runs: [] }); return; }
        const runs = [];
        for (const rid of runIds) {
          const g = runStore.get(rid);
          g.onsuccess = () => {
            const run = g.result?.run ?? g.result;
            if (run) {
              runs.push({
                runId: rid,
                status: run.status,
                error: run.error ?? null,
                candidates: (run.candidates ?? []).map((c) => ({
                  modelKey: c.modelKey,
                  accepted: c.acceptedAttemptId !== null,
                  attempts: (c.attempts ?? []).map((ca) => ({ status: ca.status, error: ca.error ?? null })),
                })),
                judge: run.judge ? { status: run.judge.status, error: run.judge.error ?? null } : null,
              });
            }
            remaining -= 1;
            if (remaining === 0) { db.close(); resolve({ experiments: out, runs }); }
          };
          g.onerror = () => { remaining -= 1; if (remaining === 0) { db.close(); resolve({ experiments: out, runs }); } };
        }
      };
    };
  })`);
  console.log(JSON.stringify(report, null, 1));
} finally {
  try {
    socket.close();
  } catch {}
  chrome.kill();
}
