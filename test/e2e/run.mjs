// End-to-end check in headless Chromium: synthetic HUD screenshots go
// through the real page, OCR must read them, and the solution must match.
// Usage: node test/e2e/run.mjs  (needs a static server on :8000)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8000/';
const OUT = process.env.OUT_DIR ?? 'test/e2e/out';
mkdirSync(OUT, { recursive: true });

// Draw a fake tactical-map screenshot: dark map, a grid, and a small
// coordinate readout near the cursor like the game shows.
async function fakeScreenshot(page, x, y, opts = {}) {
  const { w = 1920, h = 1080, font = 'bold 18px Arial', where = 'cursor' } = opts;
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<canvas id=c width=${w} height=${h}></canvas>`);
  await page.evaluate(({ x, y, w, h, font, where }) => {
    const c = document.getElementById('c');
    const g = c.getContext('2d');
    g.fillStyle = '#2b3a2e';
    g.fillRect(0, 0, w, h);
    // terrain noise
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `hsl(${100 + Math.random() * 40},${20 + Math.random() * 30}%,${15 + Math.random() * 25}%)`;
      g.fillRect(Math.random() * w, Math.random() * h, 6 + Math.random() * 40, 6 + Math.random() * 40);
    }
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < w; i += 100) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); }
    for (let i = 0; i < h; i += 100) { g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
    // readout
    const label = `X: ${x.toFixed(2)}  Y: ${y.toFixed(2)}`;
    g.font = font;
    const tx = where === 'cursor' ? 900 : 24;
    const ty = where === 'cursor' ? 520 : h - 24;
    const m = g.measureText(label);
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(tx - 6, ty - 20, m.width + 12, 28);
    g.fillStyle = '#f2f2f2';
    g.fillText(label, tx, ty);
    // cursor
    g.strokeStyle = '#fff';
    g.beginPath(); g.moveTo(880, 505); g.lineTo(890, 530); g.lineTo(896, 522); g.lineTo(904, 528); g.stroke();
  }, { x, y, w, h, font, where });
  const buf = await page.screenshot({ type: 'png' });
  return buf;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const gen = await ctx.newPage();

const GUN = { x: 85.23, y: 41.1 };
const TGT = { x: 87.1, y: 44.65 };
const gunPng = await fakeScreenshot(gen, GUN.x, GUN.y);
const tgtPng = await fakeScreenshot(gen, TGT.x, TGT.y);
writeFileSync(`${OUT}/gun.png`, gunPng);
writeFileSync(`${OUT}/target.png`, tgtPng);

const page = await ctx.newPage();
page.on('pageerror', e => console.error('PAGE ERROR', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.reload();

const failures = [];
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures.push(name);
};

const t0 = Date.now();
await page.setInputFiles('#slot-gun [data-role=file]', { name: 'gun.png', mimeType: 'image/png', buffer: gunPng });
await page.waitForFunction(() => /^x\d|check|failed|not found/.test(document.querySelector('#slot-gun [data-role=badge]').textContent), null, { timeout: 120000 });
const gunMs = Date.now() - t0;
const gx = await page.inputValue('#slot-gun [data-role=x]');
const gy = await page.inputValue('#slot-gun [data-role=y]');
const gunRaw = await page.textContent('#slot-gun [data-role=raw]');
check('gun OCR whole screenshot', gx === '85.23' && gy === '41.10', `got x=${gx} y=${gy} in ${gunMs} ms; raw="${gunRaw.trim().replace(/\s+/g, ' ')}"`);

const t1 = Date.now();
await page.setInputFiles('#slot-target [data-role=file]', { name: 'target.png', mimeType: 'image/png', buffer: tgtPng });
await page.waitForFunction(() => /^x\d|check|failed|not found/.test(document.querySelector('#slot-target [data-role=badge]').textContent), null, { timeout: 120000 });
const tx = await page.inputValue('#slot-target [data-role=x]');
const ty = await page.inputValue('#slot-target [data-role=y]');
check('target OCR whole screenshot', tx === '87.10' && ty === '44.65', `got x=${tx} y=${ty} in ${Date.now() - t1} ms`);

// Expected solution
const dx = (TGT.x - GUN.x) * 100, dy = (TGT.y - GUN.y) * 100;
const range = Math.hypot(dx, dy);
let az = Math.atan2(dx, dy) * 180 / Math.PI; if (az < 0) az += 360;
const azText = await page.textContent('#az');
const rangeText = await page.textContent('#range');
const milText = await page.textContent('#mil');
check('azimuth shown', azText === `${az.toFixed(1)}°`, `${azText} vs ${az.toFixed(1)}°`);
check('range shown', rangeText === `${Math.round(range)} m`, `${rangeText} vs ${Math.round(range)} m`);
check('mil shown', /^\d+$/.test(milText), milText);

// Region drag: draw a box around the readout on the target and re-scan.
const t2 = Date.now();
const box = await page.locator('#slot-target [data-role=canvas]').boundingBox();
const sx = box.width / 1920, sy = box.height / 1080;
await page.mouse.move(box.x + 885 * sx, box.y + 495 * sy);
await page.mouse.down();
await page.mouse.move(box.x + 1160 * sx, box.y + 535 * sy, { steps: 5 });
await page.mouse.up();
await page.waitForFunction(() => document.querySelector('#slot-target [data-role=status]').textContent.startsWith('Read x'), null, { timeout: 60000 });
const tx2 = await page.inputValue('#slot-target [data-role=x]');
const ty2 = await page.inputValue('#slot-target [data-role=y]');
check('target OCR from dragged region', tx2 === '87.10' && ty2 === '44.65', `got x=${tx2} y=${ty2} in ${Date.now() - t2} ms`);

// Remembered region applies to the next same-size screenshot automatically.
const t3 = Date.now();
const tgt2 = await fakeScreenshot(gen, 86.4, 43.2);
await page.setInputFiles('#slot-target [data-role=file]', { name: 'target2.png', mimeType: 'image/png', buffer: tgt2 });
await page.waitForFunction(() => document.querySelector('#slot-target [data-role=x]').value === '86.40', null, { timeout: 60000 });
check('remembered region reused', (await page.inputValue('#slot-target [data-role=y]')) === '43.20', `${Date.now() - t3} ms`);

// Chat-line paste path.
await page.fill('#slot-target [data-role=chat]', 'x88.00, y41.10');
check('chat line parsed', (await page.inputValue('#slot-target [data-role=x]')) === '88.00');
const azEast = await page.textContent('#az');
check('due east is 90°', azEast === '90.0°', azEast);

await page.screenshot({ path: `${OUT}/app.png`, fullPage: true });
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
process.exit(failures.length ? 1 : 0);
