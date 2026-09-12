/**
 * Browser-side OCR wrapper around Tesseract.js (vendored under /vendor so the
 * app works with no CDN and, after first load, offline).
 *
 * Why the preprocessing matters: Tesseract cannot pick an 18 px HUD readout
 * out of a busy 1080p map on its own. HUD text is near-white on a dark box,
 * so a hard brightness threshold erases the terrain and leaves only the
 * text, after which a single full-frame pass reads it in well under a second.
 */
import Tesseract from '../vendor/tesseract/tesseract.esm.min.js';

const { createWorker, PSM } = Tesseract;
const BASE = new URL('../', import.meta.url).href;

let workerPromise = null;

/** Lazily create and initialise a single shared worker. */
export function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng', 1, {
        workerPath: `${BASE}vendor/tesseract/worker.min.js`,
        corePath: `${BASE}vendor/tesseract/`,
        langPath: `${BASE}vendor/tessdata`,
        gzip: true,
        workerBlobURL: false,
        logger: m => onProgress?.(m),
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: '0123456789XYxy:.,- ',
        preserve_interword_spaces: '1',
      });
      return worker;
    })().catch(err => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/**
 * Preprocess an image region for OCR. Returns a canvas of black text on
 * white, upscaled by `scale`.
 *
 * mode 'bright': pixels with luminance >= cut become text (light HUD text).
 * mode 'dark':   pixels with luminance <= cut become text (dark text on a
 *                light map).
 * mode 'stretch': greyscale contrast stretch, optionally inverted; the
 *                generic fallback for odd colour schemes.
 */
export function preprocess(img, rect, { mode = 'bright', cut = 200, scale = 1, invert = true } = {}) {
  const sx = rect ? rect.x : 0;
  const sy = rect ? rect.y : 0;
  const sw = rect ? rect.w : img.width;
  const sh = rect ? rect.h : img.height;
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const n = w * h;
  const lum = new Float32Array(n);
  let min = 255;
  let max = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const l = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    lum[j] = l;
    if (l < min) min = l;
    if (l > max) max = l;
  }
  const span = Math.max(1, max - min);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    let v;
    if (mode === 'bright') v = lum[j] >= cut ? 0 : 255;
    else if (mode === 'dark') v = lum[j] <= cut ? 0 : 255;
    else {
      v = ((lum[j] - min) / span) * 255;
      if (invert) v = 255 - v;
    }
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/** Upscale factor that brings typical HUD text to a comfortable glyph size. */
function autoScale(rect, img) {
  const h = rect ? rect.h : img.height;
  if (rect && h < 120) return 4;   // a hand-drawn box around one line of text
  if (rect && h < 400) return 2.5;
  return Math.min(2, Math.max(0.75, 1600 / h)); // whole frame: ~1.5x at 1080p
}

/** Preprocessing attempts, most likely first. */
function attempts(rect, img) {
  const scale = autoScale(rect, img);
  return [
    { mode: 'bright', cut: 200, scale },
    { mode: 'bright', cut: 160, scale },
    { mode: 'stretch', invert: true, scale },
    { mode: 'dark', cut: 70, scale },
    { mode: 'stretch', invert: false, scale },
  ];
}

/**
 * OCR an image (or a region of it) and extract coordinates.
 * Runs the preprocessing cascade and returns the first labelled X/Y pair,
 * otherwise the best lower-confidence guess, otherwise null coords.
 *
 * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement} img
 * @param {{x:number,y:number,w:number,h:number}|null} rect
 * @param {(text:string)=>object|null} extract text → {x,y,confidence}|null
 * @param {Function} [onProgress]
 * @param {{shouldStop?:()=>boolean}} [opts]
 * @returns {Promise<{coords:object|null, text:string, aborted?:boolean}>}
 */
export async function findCoordinates(img, rect, extract, onProgress, { shouldStop } = {}) {
  const worker = await getWorker(onProgress);
  const list = attempts(rect, img);
  let best = null;
  let allText = '';
  for (let i = 0; i < list.length; i++) {
    if (shouldStop?.()) return { coords: null, text: allText, aborted: true };
    onProgress?.({ status: `reading (pass ${i + 1}/${list.length})`, progress: i / list.length });
    const canvas = preprocess(img, rect, list[i]);
    const { data } = await worker.recognize(canvas);
    const text = (data.text ?? '').trim();
    if (text) allText += text + '\n';
    const c = extract(text);
    if (!c) continue;
    if (c.confidence === 'labelled') return { coords: c, text };
    const rank = c.confidence === 'decimals' ? 2 : 1;
    if (!best || rank > best.rank) best = { coords: c, text, rank };
  }
  return best ? { coords: best.coords, text: best.text } : { coords: null, text: allText };
}
