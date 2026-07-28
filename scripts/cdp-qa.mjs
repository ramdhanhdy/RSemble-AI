// node scripts/cdp-qa.mjs
// Full QA pass: desktop 1440x1000 + mobile 390x844 + interactions.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const URL_ = process.argv[2] || 'http://localhost:5176/';
const OUT_DIR = process.argv[3] || 'docs/screenshots';
fs.mkdirSync(OUT_DIR, { recursive: true });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=9337',
  `--user-data-dir=C:/Temp/cdp-profile-${Date.now()}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function wsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await new Promise((res, rej) => {
        http.get('http://127.0.0.1:9337/json/list', r => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
        }).on('error', rej);
      });
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await wait(300);
  }
  throw new Error('no CDP');
}

const ws = new WebSocket(await wsUrl());
let id = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise(r => ws.onopen = r);

await send('Page.enable');
await send('Runtime.enable');

async function shot(path) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path, Buffer.from(s.result.data, 'base64'));
  console.log('WROTE', path);
}

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { returnByValue: true, expression });
  return r.result?.result?.value;
}

async function probe(tag) {
  const p = await evalJs(`JSON.stringify({
    iw: innerWidth, ih: innerHeight,
    dsw: document.documentElement.scrollWidth,
    dsh: document.documentElement.scrollHeight,
    bodyOverflow: getComputedStyle(document.body).overflow,
  })`);
  console.log(`PROBE ${tag}:`, p);
  return JSON.parse(p);
}

async function setViewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: mobile ? 2 : 1, mobile,
  });
}

const clickByAria = (label) => `(() => {
  const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'').includes(${JSON.stringify(label)}));
  if (!b) return 'NOT FOUND';
  window.__trigger=b; b.focus(); b.click(); return 'clicked';
})()`;

const key = async (k, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
};

// ======== DESKTOP 1440x1000 ========
console.log('\n========= DESKTOP 1440x1000 =========');
await setViewport(1440, 1000, false);
await send('Page.navigate', { url: URL_ });
await wait(3500);
await probe('desktop-1440');
await shot(`${OUT_DIR}/qa-desktop-1440x1000.png`);

// Open Connections modal
console.log('click Connections:', await evalJs(clickByAria('Connection status')));
await wait(800);
await probe('desktop-connections');
await shot(`${OUT_DIR}/qa-desktop-connections.png`);
// Dialog a11y assertions
console.log('A11Y conn open focus-in-dialog:', await evalJs(`document.querySelector('[role=dialog]')?.contains(document.activeElement)`));
for (let i = 0; i < 30; i++) await key('Tab', 'Tab', 9);
console.log('A11Y conn trap-after-30-tab:', await evalJs(`document.querySelector('[role=dialog]')?.contains(document.activeElement)`));
await key('Escape', 'Escape', 27);
await wait(400);
console.log('A11Y conn escape-closes:', await evalJs(`document.querySelector('[role=dialog]') === null`));
console.log('A11Y conn focus-restored:', await evalJs(`document.activeElement === window.__trigger`));

// Open command palette
await key('k', 'KeyK', 75);  // Note: no ctrl modifier here — plain K won't trigger
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
await wait(700);
await shot(`${OUT_DIR}/qa-desktop-palette.png`);
console.log('A11Y palette open:', await evalJs(`document.querySelector('[role=dialog]') !== null || document.querySelector('[role=listbox]') !== null || !!document.querySelector('[cmdk-root]')`));
await key('Escape', 'Escape', 27);
await wait(400);

// ======== MOBILE 390x844 ========
console.log('\n========= MOBILE 390x844 =========');
await setViewport(390, 844, true);
await send('Page.navigate', { url: URL_ });
await wait(3500);
await probe('mobile-390');
await shot(`${OUT_DIR}/qa-mobile-390x844.png`);

// Open command drawer via hamburger
console.log('click hamburger:', await evalJs(clickByAria('Open command pane')));
await wait(800);
await probe('mobile-drawer');
await shot(`${OUT_DIR}/qa-mobile-drawer.png`);
// A11y assertions on drawer
console.log('A11Y drawer open focus-in-dialog:', await evalJs(`document.querySelector('[role=dialog]')?.contains(document.activeElement)`));
for (let i = 0; i < 30; i++) await key('Tab', 'Tab', 9);
console.log('A11Y drawer trap-after-30-tab:', await evalJs(`document.querySelector('[role=dialog]')?.contains(document.activeElement)`));
// Drawer inner scroll reachability
console.log('drawer scroll:', await evalJs(`(() => {
  const d=document.querySelector('[role=dialog]');
  if (!d) return 'NO DIALOG';
  const sc=[...d.querySelectorAll('div')].find(x=>x.className.includes('overflow-y-auto'));
  if (!sc) return 'NO SCROLL REGION';
  sc.scrollTop = sc.scrollHeight;
  return JSON.stringify({sh: sc.scrollHeight, ch: sc.clientHeight, st: sc.scrollTop});
})()`));
await shot(`${OUT_DIR}/qa-mobile-drawer-scrolled.png`);
await key('Escape', 'Escape', 27);
await wait(400);
console.log('A11Y drawer escape-closes:', await evalJs(`document.querySelector('[role=dialog]') === null`));
console.log('A11Y drawer focus-restored:', await evalJs(`document.activeElement === window.__trigger`));

// Open Connections on mobile
console.log('click Connections (mobile):', await evalJs(clickByAria('Connection status')));
await wait(800);
await shot(`${OUT_DIR}/qa-mobile-connections.png`);
await key('Escape', 'Escape', 27);
await wait(400);

// Type a task in the input to verify the run button enables (mobile drawer flow)
console.log('\n========= MOBILE drawer full flow =========');
await evalJs(clickByAria('Open command pane'));
await wait(700);
console.log('type into task:', await evalJs(`(() => {
  const ta = document.querySelector('textarea');
  if (!ta) return 'NO TEXTAREA';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, 'Summarize the tradeoffs of RAG vs fine-tuning for a domain-specific assistant.');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`));
await wait(500);
await shot(`${OUT_DIR}/qa-mobile-drawer-filled.png`);
// Check horizontal overflow in drawer
console.log('drawer doc overflow:', await evalJs(`JSON.stringify({
  dsw: document.documentElement.scrollWidth, iw: innerWidth,
})`));
await key('Escape', 'Escape', 27);
await wait(400);

chrome.kill();
process.exit(0);
