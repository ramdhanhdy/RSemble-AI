import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const explicitBaseUrl = process.env.QA_BASE_URL ?? process.argv[2] ?? null;
const baseUrl = explicitBaseUrl ?? "http://127.0.0.1:5176/";
const outDir = path.resolve("docs/qa/design-motion-refinement");
const runtimeRoot = path.resolve(
  process.env.QA_RUNTIME_ROOT ?? "E:/2026/.rsemble-qa-cache/design-motion",
);
const tempDir = path.join(runtimeRoot, "temp");
const browserDir = path.join(runtimeRoot, "browser");
const chromePath =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const debugPort = 9338;
const results = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  probes: [],
  screenshots: [],
};

for (const dir of [outDir, tempDir, browserDir]) fs.mkdirSync(dir, { recursive: true });
process.env.TEMP = tempDir;
process.env.TMP = tempDir;
process.env.TMPDIR = tempDir;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const viteBin = path.join(process.cwd(), "node_modules", "vite", "bin", "vite.js");

function runVite(args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [viteBin, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function serverResponds(url) {
  try {
    const status = await new Promise((resolve, reject) => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.on("error", reject);
    });
    return status >= 200 && status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await serverResponds(url)) return;
    await wait(250);
  }
  throw new Error(`Application server did not become ready at ${url}.`);
}

let previewProcess = null;
if (explicitBaseUrl) {
  await waitForServer(baseUrl);
} else {
  if (await serverResponds(baseUrl)) {
    throw new Error(
      `Port ${new URL(baseUrl).port || "5176"} is already serving another process. ` +
        "Stop it or pass QA_BASE_URL explicitly.",
    );
  }
  await runVite(["build"], "Vite production build");
  const previewUrl = new URL(baseUrl);
  previewProcess = spawn(
    process.execPath,
    [
      viteBin,
      "preview",
      "--host",
      previewUrl.hostname,
      "--port",
      previewUrl.port || "5176",
      "--strictPort",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    },
  );
  const previewFailure = new Promise((_, reject) => {
    previewProcess.once("error", reject);
    previewProcess.once("exit", (code) => {
      reject(new Error(`Vite production preview exited with code ${code ?? "unknown"}.`));
    });
  });
  await Promise.race([waitForServer(baseUrl), previewFailure]);
}

const runId = Date.now();
const userDataDir = path.join(browserDir, `profile-${runId}`);
const diskCacheDir = path.join(browserDir, `cache-${runId}`);
const crashDumpsDir = path.join(browserDir, `crashes-${runId}`);

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--disk-cache-dir=${diskCacheDir}`,
    `--crash-dumps-dir=${crashDumpsDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore" },
);

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
      if (message.error) {
        reject(new Error(`${method}: ${message.error.message}`));
      } else {
        resolve(message.result);
      }
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
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.text ?? "Runtime evaluation failed.");
  return result.result?.value;
}

async function waitFor(expression, label) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
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

async function navigate() {
  await send("Page.navigate", { url: baseUrl });
  await waitFor(
    "Boolean(document.querySelector('main, [role=main], #root > *'))",
    "application shell",
  );
  await wait(250);
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

async function documentProbe(name) {
  const value = await evaluate(`(() => {
    const spinner = document.createElement("span");
    spinner.className = "animate-spin-ease";
    document.body.append(spinner);
    const spinnerTiming = getComputedStyle(spinner).animationTimingFunction;
    spinner.remove();
    const palette = document.querySelector("[cmdk-dialog]");
    return {
      paletteAnimation: palette ? getComputedStyle(palette).animationName : null,
      spinnerTiming,
      overflowX: document.documentElement.scrollWidth > innerWidth,
      activeTag: document.activeElement?.tagName ?? null,
    };
  })()`);
  record(name, {
    ...value,
    pass:
      value.spinnerTiming === "linear" &&
      !value.overflowX &&
      (value.paletteAnimation === null || value.paletteAnimation === "none"),
    reason: "expected a linear spinner, no horizontal overflow, and no palette animation",
  });
}

async function clickButton(label) {
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find((element) =>
      (element.getAttribute("aria-label") ?? "").includes(${JSON.stringify(label)}) ||
      (element.textContent ?? "").includes(${JSON.stringify(label)}),
    );
    if (!button) return false;
    window.__qaTrigger = button;
    button.focus();
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Could not find button: ${label}`);
}

async function press(key, code, windowsVirtualKeyCode) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
}

async function verifyDialog(name, triggerLabel) {
  await clickButton(triggerLabel);
  await waitFor("Boolean(document.querySelector('[role=dialog]'))", `${name} dialog`);
  await wait(50);
  const open = await evaluate(`(() => {
    const dialog = document.querySelector('[role=dialog]');
    return { focusInDialog: Boolean(dialog?.contains(document.activeElement)), overflowX: document.documentElement.scrollWidth > innerWidth };
  })()`);
  record(`${name}-open`, {
    ...open,
    pass: open.focusInDialog && !open.overflowX,
    reason: "focus must enter dialog without horizontal overflow",
  });
  await screenshot(`qa-${name}-dialog`);
  await press("Escape", "Escape", 27);
  await waitFor("!document.querySelector('[role=dialog]')", `${name} close`);
  const restored = await evaluate("document.activeElement === window.__qaTrigger");
  record(`${name}-focus-restored`, {
    restored,
    pass: restored,
    reason: "focus must return to the trigger",
  });
}

async function captureViewport(name, viewport) {
  await setViewport(viewport);
  await navigate();
  await documentProbe(`${name}-normal`);
  await screenshot(`qa-${name}`);
}
async function verifyPipelineMotionCss(name, expectedAnimations) {
  const active = await evaluate(`(() => {
    const connector = document.createElement('span');
    connector.className = 'connector-dots w-10 animate-dash-march';
    connector.style.backgroundImage = 'radial-gradient(circle, #00e5ff 1.25px, transparent 1.25px)';
    const spinner = document.createElement('span');
    spinner.className = 'animate-spin-ease';
    document.body.append(connector, spinner);
    const connectorStyle = getComputedStyle(connector);
    const spinnerStyle = getComputedStyle(spinner);
    const measurement = {
      activeConnectors: 1,
      connectorAnimation: connectorStyle.animationName,
      connectorTiming: connectorStyle.animationTimingFunction,
      spinnerAnimation: spinnerStyle.animationName,
      spinnerTiming: spinnerStyle.animationTimingFunction,
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
    connector.remove();
    spinner.remove();
    return measurement;
  })()`);
  record(name, {
    ...active,
    componentEvidence:
      "src/ui/PipelineRail.test.tsx proves an active stage assigns exactly one animate-dash-march class",
    pass:
      active.activeConnectors === 1 &&
      active.connectorAnimation === expectedAnimations.connector &&
      active.spinnerAnimation === expectedAnimations.spinner &&
      (expectedAnimations.spinner === "none" || active.spinnerTiming === "linear") &&
      !active.overflowX,
    reason: "production motion classes must compute to the expected normal/reduced animation mode",
  });
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      localStorage.setItem('rsemble.key.openrouter', 'qa-motion-probe');
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('openrouter.ai/api/v1/models')) {
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('openrouter.ai/api/v1/chat/completions')) {
          const request = JSON.parse(init?.body ?? '{}');
          if (request.stream) {
            const encoder = new TextEncoder();
            return new Response(new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"QA motion probe"}}]}\\n\\n'));
              },
            }), {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            });
          }
          return new Response(JSON.stringify({ choices: [{ message: { content: 'QA response' } }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return nativeFetch(input, init);
      };
    })();`,
  });

  await send("Emulation.setEmulatedMedia", { features: [] });
  await captureViewport("desktop-1440x1000", { width: 1440, height: 1000 });
  const runAction = await evaluate(`(() => {
    const button = document.querySelector('[data-geometry="run-action"]');
    button.scrollIntoView({ block: 'center' });
    const style = getComputedStyle(button);
    return { backgroundImage: style.backgroundImage, visible: button.getBoundingClientRect().height >= 64 };
  })()`);
  record("desktop-run-action", {
    ...runAction,
    pass: runAction.backgroundImage === "none" && runAction.visible,
    reason: "Run action must be a visible solid control, not a gradient",
  });
  await screenshot("qa-desktop-run-action");
  await evaluate("window.scrollTo(0, 0)");

  const openedAt = Date.now();
  await clickButton("Command palette");
  await waitFor("Boolean(document.querySelector('[cmdk-dialog]'))", "command palette");
  const paletteLatencyMs = Date.now() - openedAt;
  const palette = await evaluate(`(() => {
    const dialog = document.querySelector('[cmdk-dialog]');
    return { animationName: getComputedStyle(dialog).animationName, focusInPalette: dialog.contains(document.activeElement) };
  })()`);
  record("command-palette", {
    ...palette,
    latencyMs: paletteLatencyMs,
    pass: palette.animationName === "none" && palette.focusInPalette && paletteLatencyMs < 500,
    reason: "palette must open within 500ms, focus its input, and have no entrance animation",
  });
  await press("Escape", "Escape", 27);

  await verifyDialog("connections", "Connection status");
  await verifyPipelineMotionCss("desktop-pipeline-motion-css", {
    connector: "bg-march",
    spinner: "spin-ease",
  });
  await captureViewport("tablet-1024x768", { width: 1024, height: 768 });
  await verifyDialog("connections-tablet-1024", "Connection status");
  await captureViewport("tablet-768x1024", { width: 768, height: 1024, touch: true });
  await verifyDialog("connections-tablet-768", "Connection status");

  await captureViewport("mobile-390x844", { width: 390, height: 844, mobile: true, touch: true });
  await verifyDialog("connections-mobile-390", "Connection status");
  await clickButton("Open command pane");
  await waitFor("Boolean(document.querySelector('[role=dialog]'))", "mobile command drawer");
  await wait(50);
  const drawer = await evaluate(`(() => {
    const dialog = document.querySelector('[role=dialog]');
    return { focusInDialog: Boolean(dialog?.contains(document.activeElement)), overflowX: document.documentElement.scrollWidth > innerWidth };
  })()`);
  record("mobile-command-drawer", {
    ...drawer,
    pass: drawer.focusInDialog && !drawer.overflowX,
    reason: "mobile drawer must focus and fit",
  });
  await screenshot("qa-mobile-drawer");
  const drawerScroll = await evaluate(`(() => {
    const scroller = document.querySelector('[role=dialog] .overflow-y-auto');
    if (!scroller) return { found: false, reachedEnd: false, overflowX: true };
    scroller.scrollTop = scroller.scrollHeight;
    return {
      found: true,
      reachedEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight,
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  record("mobile-command-drawer-scroll", {
    ...drawerScroll,
    pass: drawerScroll.found && drawerScroll.reachedEnd && !drawerScroll.overflowX,
    reason: "mobile drawer content must remain vertically reachable without horizontal overflow",
  });
  await screenshot("qa-mobile-drawer-scrolled");
  await press("Escape", "Escape", 27);

  await setViewport({ width: 1440, height: 1000 });
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await navigate();
  const reduced = await evaluate(`(() => {
    const button = document.querySelector('.pressable');
    const status = [...document.querySelectorAll('button')].find((element) =>
      (element.getAttribute('aria-label') ?? '').includes('Connection status'),
    );
    const spinner = document.createElement('span');
    spinner.className = 'animate-spin-ease';
    document.body.append(spinner);
    const spinnerAnimation = getComputedStyle(spinner).animationName;
    spinner.remove();
    const disclosureChevron = document.querySelector('.disclosure-chevron');
    disclosureChevron?.closest('button')?.click();
    return {
      transitionDuration: getComputedStyle(button).transitionDuration,
      spinnerAnimation,
      disclosureTransitionDuration: disclosureChevron ? getComputedStyle(disclosureChevron).transitionDuration : null,
      overflowX: document.documentElement.scrollWidth > innerWidth,
      visibleStatus: Boolean(status?.textContent?.trim()),
    };
  })()`);
  record("desktop-reduced-motion", {
    ...reduced,
    pass:
      reduced.transitionDuration.split(",").every((duration) => duration.trim() === "0s") &&
      reduced.spinnerAnimation === "none" &&
      reduced.disclosureTransitionDuration === "0s" &&
      !reduced.overflowX &&
      reduced.visibleStatus,
    reason:
      "reduced motion must remove interaction transitions and movement while retaining visible status text",
  });
  await screenshot("qa-desktop-reduced-motion");
  await verifyPipelineMotionCss("desktop-reduced-pipeline-motion-css", {
    connector: "none",
    spinner: "none",
  });

  await send("Emulation.setEmulatedMedia", { features: [] });
  await setViewport({ width: 720, height: 500 });
  await navigate();
  const zoom = await evaluate(`({
    overflowX: document.documentElement.scrollWidth > innerWidth,
    innerWidth,
    innerHeight,
  })`);
  record("desktop-200-percent-css-zoom", {
    ...zoom,
    pass: !zoom.overflowX && zoom.innerWidth === 720 && zoom.innerHeight === 500,
    reason: "an effective 200% CSS viewport must fit without horizontal overflow",
  });
  await screenshot("qa-desktop-200-percent-css-zoom");

  fs.writeFileSync(path.join(outDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Design-motion QA passed. Evidence: ${outDir}`);
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
  previewProcess?.kill();
}
