import { solve, correctedTarget, degreesToMils } from './ballistics.js';
import { extractCoordinates, formatCoordinate } from './extract.js';
import { WEAPONS, DEFAULT_WEAPON_ID, getWeapon } from '../data/weapons.js';

const STORAGE_KEY = 'wardogs-mortar-calc';
const $ = (sel, root = document) => root.querySelector(sel);

// ---------- persistent state ----------
function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveState(patch) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadState(), ...patch }));
  } catch { /* storage unavailable, fine */ }
}

const persisted = loadState();

const state = {
  weaponId: persisted.weaponId ?? DEFAULT_WEAPON_ID,
  gun: persisted.gun ?? null,
  target: null,
  active: 'gun',
};

// ---------- OCR (lazy-loaded so the page is usable without it) ----------
let ocrModule = null;
const ocrState = $('#ocr-state');
async function ocr() {
  if (!ocrModule) {
    ocrState.textContent = 'OCR engine: loading…';
    ocrModule = await import('./ocr.js');
  }
  return ocrModule;
}
function onOcrProgress(m) {
  if (!m || !m.status) return;
  const pct = Number.isFinite(m.progress) ? ` ${Math.round(m.progress * 100)}%` : '';
  ocrState.textContent = `OCR engine: ${m.status}${pct}`;
}

// ---------- slots ----------
class Slot {
  constructor(name, root) {
    this.name = name;
    this.root = root;
    this.el = {
      drop: $('[data-role=drop]', root),
      pick: $('[data-role=pick]', root),
      file: $('[data-role=file]', root),
      preview: $('[data-role=preview]', root),
      canvas: $('[data-role=canvas]', root),
      marquee: $('[data-role=marquee]', root),
      status: $('[data-role=status]', root),
      badge: $('[data-role=badge]', root),
      x: $('[data-role=x]', root),
      y: $('[data-role=y]', root),
      chat: $('[data-role=chat]', root),
      clear: $('[data-role=clear]', root),
      raw: $('[data-role=raw]', root),
    };
    this.image = null; // ImageBitmap or HTMLImageElement
    this.rect = null;  // last OCR crop in image pixels
    this.scanId = 0;
    this.bind();
  }

  bind() {
    const { drop, pick, file, x, y, chat, clear, preview } = this.el;

    drop.addEventListener('click', e => {
      setActive(this.name);
      if (!this.image && !e.target.closest('button')) file.click();
    });
    drop.addEventListener('focus', () => setActive(this.name));
    pick.addEventListener('click', e => { e.stopPropagation(); setActive(this.name); file.click(); });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) this.loadFile(f);
      file.value = '';
    });

    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('over');
      setActive(this.name);
      const f = [...(e.dataTransfer?.files ?? [])].find(f => f.type.startsWith('image/'));
      if (f) this.loadFile(f);
    });

    // Manual entry.
    const manual = () => {
      const px = parseFloat(x.value);
      const py = parseFloat(y.value);
      this.setCoords(Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null, { fromUser: true });
    };
    x.addEventListener('input', manual);
    y.addEventListener('input', manual);
    chat.addEventListener('input', () => {
      const c = extractCoordinates(chat.value);
      if (c) {
        this.setCoords({ x: c.x, y: c.y });
        this.status(`Read x${formatCoordinate(c.x)}, y${formatCoordinate(c.y)} from the chat line.`, 'ok');
      }
    });
    clear.addEventListener('click', () => this.clear());

    // Region selection on the preview.
    let start = null;
    preview.addEventListener('pointerdown', e => {
      if (!this.image) return;
      e.preventDefault();
      preview.setPointerCapture(e.pointerId);
      start = this.pointToImage(e);
      this.showMarquee(start, start);
    });
    preview.addEventListener('pointermove', e => {
      if (!start) return;
      this.showMarquee(start, this.pointToImage(e));
    });
    const finish = e => {
      if (!start) return;
      const end = this.pointToImage(e);
      const rect = normRect(start, end);
      start = null;
      if (rect.w < 8 || rect.h < 6) {
        this.el.marquee.hidden = true;
        return;
      }
      this.rect = rect;
      this.rememberRect();
      this.scan(rect);
    };
    preview.addEventListener('pointerup', finish);
    preview.addEventListener('pointercancel', () => { start = null; this.el.marquee.hidden = true; });
  }

  pointToImage(e) {
    const r = this.el.canvas.getBoundingClientRect();
    const sx = this.image.width / r.width;
    const sy = this.image.height / r.height;
    return {
      x: clamp((e.clientX - r.left) * sx, 0, this.image.width),
      y: clamp((e.clientY - r.top) * sy, 0, this.image.height),
    };
  }

  showMarquee(a, b) {
    const rect = normRect(a, b);
    const r = this.el.canvas.getBoundingClientRect();
    const sx = r.width / this.image.width;
    const sy = r.height / this.image.height;
    const m = this.el.marquee;
    m.hidden = false;
    m.style.left = `${rect.x * sx}px`;
    m.style.top = `${rect.y * sy}px`;
    m.style.width = `${rect.w * sx}px`;
    m.style.height = `${rect.h * sy}px`;
  }

  rectKey() {
    return `rect:${this.name}:${this.image.width}x${this.image.height}`;
  }
  rememberRect() {
    saveState({ [this.rectKey()]: this.rect });
  }
  recallRect() {
    const r = loadState()[this.rectKey()];
    return r && r.w > 0 && r.h > 0 ? r : null;
  }

  async loadFile(file) {
    this.status('Loading image…');
    try {
      const bmp = await createImageBitmap(file);
      this.setImage(bmp);
    } catch (err) {
      this.status(`Could not read that file: ${err.message}`, 'err');
    }
  }

  setImage(img) {
    this.image = img;
    const { canvas, preview, drop, marquee } = this.el;
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    preview.hidden = false;
    drop.classList.add('has-image');
    marquee.hidden = true;
    this.badge('scanning', 'busy');
    // Reuse the last hand-drawn region for screenshots of the same size:
    // the HUD readout sits in the same place every time.
    const remembered = this.recallRect();
    this.rect = remembered;
    if (remembered) this.showMarquee({ x: remembered.x, y: remembered.y }, { x: remembered.x + remembered.w, y: remembered.y + remembered.h });
    this.scan(remembered);
  }

  async scan(rect) {
    if (!this.image) return;
    const id = ++this.scanId;
    const stale = () => id !== this.scanId;
    this.status(rect ? 'Reading the selected area…' : 'Searching the screenshot for the X / Y readout…');
    this.badge('scanning', 'busy');
    let text = '';
    let c = null;
    try {
      const mod = await ocr();
      const found = await mod.findCoordinates(this.image, rect, extractCoordinates, onOcrProgress, { shouldStop: stale });
      if (found.aborted) return;
      text = found.text;
      c = found.coords;
    } catch (err) {
      if (stale()) return;
      this.status(`OCR failed: ${err.message}. Type the coordinates instead.`, 'err');
      this.badge('ocr failed', 'warn');
      return;
    }
    if (stale()) return; // superseded by a newer scan
    ocrState.textContent = 'OCR engine: ready';
    this.el.raw.textContent = text.trim() || '(no text found)';

    if (!c) {
      this.status('No coordinates found. Drag a tight box around the X / Y readout, or type them in.', 'err');
      this.badge('not found', 'warn');
      return;
    }
    this.setCoords({ x: c.x, y: c.y });
    if (c.confidence === 'labelled') {
      this.status(`Read x${formatCoordinate(c.x)}, y${formatCoordinate(c.y)}. Check it against the screenshot.`, 'ok');
    } else {
      this.status(`Guessed x${formatCoordinate(c.x)}, y${formatCoordinate(c.y)} (readout not clearly found). Verify, or drag a box around the readout.`);
      this.badge('check', 'warn');
    }
  }

  setCoords(coords, { fromUser = false } = {}) {
    state[this.name] = coords;
    if (!fromUser) {
      this.el.x.value = coords ? formatCoordinate(coords.x) : '';
      this.el.y.value = coords ? formatCoordinate(coords.y) : '';
    }
    if (coords) {
      this.badge(`x${formatCoordinate(coords.x)} y${formatCoordinate(coords.y)}`, 'ok');
      if (this.name === 'gun') saveState({ gun: coords });
      // Auto-advance: after the gun is set, the next paste goes to the target.
      if (this.name === 'gun' && !state.target) setActive('target');
    } else {
      this.badge('empty');
      if (this.name === 'gun') saveState({ gun: null });
    }
    render();
  }

  clear() {
    this.image = null;
    this.rect = null;
    this.scanId++;
    const { preview, drop, marquee, raw, chat } = this.el;
    preview.hidden = true;
    drop.classList.remove('has-image');
    marquee.hidden = true;
    raw.textContent = '';
    chat.value = '';
    this.setCoords(null);
    this.status('Cleared.');
    setActive(this.name);
  }

  status(msg, kind = '') {
    this.el.status.textContent = msg;
    this.el.status.className = `status ${kind}`.trim();
  }
  badge(text, kind = '') {
    this.el.badge.textContent = text;
    this.el.badge.className = `badge ${kind}`.trim();
  }
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function normRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(Math.abs(b.x - a.x)), h: Math.round(Math.abs(b.y - a.y)) };
}

const slots = {
  gun: new Slot('gun', $('#slot-gun')),
  target: new Slot('target', $('#slot-target')),
};

function setActive(name) {
  state.active = name;
  for (const [n, s] of Object.entries(slots)) s.root.classList.toggle('active', n === name);
}

// Global paste: goes to the active slot.
document.addEventListener('paste', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  const f = item.getAsFile();
  if (f) slots[state.active].loadFile(f);
});

// ---------- weapon select ----------
const weaponSel = $('#weapon');
for (const w of WEAPONS) {
  const o = document.createElement('option');
  o.value = w.id;
  o.textContent = w.name;
  weaponSel.appendChild(o);
}
weaponSel.value = state.weaponId;
weaponSel.addEventListener('change', () => {
  state.weaponId = weaponSel.value;
  saveState({ weaponId: state.weaponId });
  render();
});

// ---------- results ----------
const out = {
  solution: $('#solution'), az: $('#az'), azMils: $('#az-mils'), mil: $('#mil'), milAlt: $('#mil-alt'),
  range: $('#range'), rangeLimits: $('#range-limits'), warn: $('#warn'), copy: $('#copy'), swap: $('#swap'),
};
let lastSolution = null;

function render() {
  const weapon = getWeapon(state.weaponId);
  out.rangeLimits.textContent = `${weapon.minRangeMeters}–${weapon.maxRangeMeters} m`;
  out.warn.hidden = true;
  out.solution.classList.remove('ready');
  lastSolution = null;

  if (!state.gun || !state.target) {
    out.az.textContent = out.mil.textContent = out.range.textContent = '—';
    out.azMils.textContent = out.milAlt.textContent = '';
    out.copy.disabled = true;
    return;
  }

  const s = solve(state.gun, state.target, weapon);
  lastSolution = s;
  out.range.textContent = `${Math.round(s.rangeMeters)} m`;
  out.az.textContent = `${s.azimuthDeg.toFixed(1)}°`;
  out.azMils.textContent = `${Math.round(degreesToMils(s.azimuthDeg))} mil`;

  if (s.inRange && s.solutions.length) {
    const primary = s.solutions[0];
    out.mil.textContent = `${Math.round(primary.mil)}`;
    if (s.solutions.length > 1) {
      out.milAlt.textContent = s.solutions.map(x => `${x.name}: ${Math.round(x.mil)}`).join('  ');
    } else {
      out.milAlt.textContent = primary.name === 'single' ? 'from table, verify' : `${primary.name} arc`;
    }
    out.solution.classList.add('ready');
    out.copy.disabled = false;
  } else {
    out.mil.textContent = '—';
    out.milAlt.textContent = '';
    out.copy.disabled = true;
    out.warn.hidden = false;
    out.warn.textContent = s.tooClose
      ? `Too close: ${Math.round(s.rangeMeters)} m is under the ${weapon.name} minimum of ${weapon.minRangeMeters} m. Move the gun back.`
      : `Out of range: ${Math.round(s.rangeMeters)} m is beyond the ${weapon.name} maximum of ${weapon.maxRangeMeters} m.`;
  }
}

out.copy.addEventListener('click', async () => {
  if (!lastSolution) return;
  const s = lastSolution;
  const mils = s.solutions.map(x => (s.solutions.length > 1 ? `${x.name} ${Math.round(x.mil)}` : `${Math.round(x.mil)}`)).join(' / ');
  const text = `AZ ${s.azimuthDeg.toFixed(1)}° ELEV ${mils} mil RNG ${Math.round(s.rangeMeters)} m → x${formatCoordinate(state.target.x)}, y${formatCoordinate(state.target.y)}`;
  try {
    await navigator.clipboard.writeText(text);
    out.copy.textContent = 'Copied';
  } catch {
    window.prompt('Copy this:', text);
  }
  setTimeout(() => { out.copy.textContent = 'Copy solution'; }, 1200);
});

out.swap.addEventListener('click', () => {
  const g = state.gun;
  const t = state.target;
  slots.gun.setCoords(t);
  slots.target.setCoords(g);
});

// ---------- correction ----------
$('#apply-corr').addEventListener('click', () => {
  if (!state.gun || !state.target) return;
  const long = parseFloat($('#corr-long').value) || 0;
  const right = parseFloat($('#corr-right').value) || 0;
  if (!long && !right) return;
  const t = correctedTarget(state.gun, state.target, long, right);
  slots.target.setCoords(t);
  slots.target.status(`Aim point shifted ${long > 0 ? 'short' : 'long'} ${Math.abs(long)} m and ${right > 0 ? 'left' : 'right'} ${Math.abs(right)} m.`, 'ok');
  $('#corr-long').value = '0';
  $('#corr-right').value = '0';
});

// ---------- boot ----------
if (state.gun) {
  slots.gun.setCoords(state.gun);
  slots.gun.status('Restored your last gun position. Paste a new screenshot if you moved.');
  setActive('target');
} else {
  setActive('gun');
}
render();
