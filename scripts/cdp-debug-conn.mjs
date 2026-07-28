// node scripts/cdp-debug-conn.mjs — find what overflows in Connections modal at 390
import { spawn } from 'node:child_process';
import http from 'node:http';

const URL_ = 'http://localhost:5176/';
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=9338',
  `--user-data-dir=C:/Temp/cdp-profile-${Date.now()}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function wsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await new Promise((res, rej) => {
        http.get('http://127.0.0.1:9338/json/list', r => {
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
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: URL_ });
await wait(3000);

const evalJs = async (expression) => (await send('Runtime.evaluate', { returnByValue: true, expression })).result?.result?.value;

// Open Connections modal
console.log(await evalJs(`(() => {
  const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'').includes('Connection status'));
  if (!b) return 'NOT FOUND'; b.click(); return 'clicked';
})()`));
await wait(1200);

console.log(await evalJs(`(() => {
  const dlg = document.querySelector('[role=dialog]');
  if (!dlg) return 'NO DIALOG';
  const out = { dialog: { cw: dlg.clientWidth, sw: dlg.scrollWidth } };
  // Walk all elements and find ones wider than the dialog
  const dw = dlg.clientWidth;
  const over = [];
  dlg.querySelectorAll('*').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > dw + 1 || el.scrollWidth > el.clientWidth + 1) {
      over.push({
        tag: el.tagName, cls: (el.className||'').toString().slice(0,80),
        bw: Math.round(r.width), sw: el.scrollWidth, cw: el.clientWidth,
        text: (el.textContent||'').slice(0,60)
      });
    }
  });
  out.over = over.slice(0, 30);
  out.docOverflow = { dsw: document.documentElement.scrollWidth, iw: innerWidth };
  return JSON.stringify(out, null, 1);
})()`));

chrome.kill(); process.exit(0);
