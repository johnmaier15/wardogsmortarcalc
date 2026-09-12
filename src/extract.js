/**
 * Pull a coordinate pair out of noisy OCR text.
 * Pure module (no DOM) so it can be unit-tested under Node.
 *
 * The in-game tactical map shows coordinates like "X: 85.23  Y: 41.10" and
 * Mark Coordinates puts a similar line into squad chat. OCR of HUD text is
 * messy: X may come back as "x", "×" or "K"; Y as "V" or "¥"; digits as
 * "O", "l", "I", "S", "B"; and the decimal point may become a comma or get
 * lost entirely. This extractor tolerates all of that and prefers labelled
 * values over bare numbers.
 */

const DIGIT_FIXES = { O: '0', o: '0', Q: '0', D: '0', l: '1', I: '1', '|': '1', i: '1', S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6', g: '9', q: '9' };

/** Normalise a numeric-ish token, fixing common OCR letter/digit swaps. */
export function cleanNumberToken(tok) {
  let s = String(tok).replace(/[,،]/g, '.').replace(/[^\dOoQDlI|iSsBZzGgq.\-+]/g, '');
  s = s.replace(/[OoQDlI|iSsBZzGgq]/g, ch => DIGIT_FIXES[ch] ?? ch);
  // Collapse repeated dots and strip trailing/leading ones.
  s = s.replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '');
  return s;
}

/** Turn a cleaned token into a coordinate number, or null. */
export function tokenToCoordinate(tok) {
  // A token with no genuine digit is a word, not a number ("pos", "so").
  if (!/\d/.test(String(tok))) return null;
  const s = cleanNumberToken(tok);
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  let n = Number(s);
  if (!Number.isFinite(n)) return null;
  // A lost decimal point: "8523" on a 16 km map is almost certainly 85.23.
  if (!s.includes('.') && Math.abs(n) >= 1000 && Math.abs(n) <= 99999) n = n / 100;
  return n;
}

const LABEL_X = '[xX×kK]';
const LABEL_Y = '[yY¥vV]';
// A number as OCR might render it: digits, possible confusable letters, one separator.
const NUMBERISH = '[+-]?[\\dOoQDlI|iSsBZzGgq]{1,5}(?:[.,،]\\s?[\\dOoQDlI|iSsBZzGgq]{1,3})?';

function findLabelled(text, labelClass) {
  // Label, optional separator, then the number. Require the label not to be
  // glued to a preceding letter (so "max" doesn't count as an X label).
  const re = new RegExp(`(?:^|[^A-Za-z])${labelClass}\\s*[:=.\\-]?\\s*(${NUMBERISH})`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = tokenToCoordinate(m[1]);
    if (n !== null) out.push({ value: n, index: m.index });
  }
  return out;
}

/**
 * Find all plausible coordinate numbers in text, in reading order.
 * Coordinates on WARDOGS maps run from roughly 0 to 164 with two decimals.
 */
export function findNumbers(text) {
  const re = new RegExp(NUMBERISH, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = tokenToCoordinate(m[0]);
    if (n !== null && n >= 0 && n <= 200) out.push({ value: n, index: m.index, raw: m[0] });
  }
  return out;
}

/**
 * Extract { x, y } from OCR text.
 * Strategy, in order:
 *   1. Labelled X and Y values (first of each).
 *   2. Two consecutive numbers that both carry decimals.
 *   3. The first two plausible numbers.
 * Returns null if nothing usable is found. The result also carries a
 * `confidence` of 'labelled' | 'decimals' | 'guess' so the UI can warn.
 */
export function extractCoordinates(text) {
  const t = String(text ?? '');
  if (!t.trim()) return null;

  const xs = findLabelled(t, LABEL_X);
  const ys = findLabelled(t, LABEL_Y);
  if (xs.length && ys.length) {
    return { x: xs[0].value, y: ys[0].value, confidence: 'labelled' };
  }

  const nums = findNumbers(t);
  const withDecimals = nums.filter(n => /[.,،]/.test(n.raw));
  if (withDecimals.length >= 2) {
    // If exactly one label was found, pair it with the nearest other number.
    if (xs.length === 1) {
      const other = withDecimals.find(n => n.value !== xs[0].value) ?? withDecimals[1];
      return { x: xs[0].value, y: other.value, confidence: 'decimals' };
    }
    if (ys.length === 1) {
      const other = withDecimals.find(n => n.value !== ys[0].value) ?? withDecimals[0];
      return { x: other.value, y: ys[0].value, confidence: 'decimals' };
    }
    return { x: withDecimals[0].value, y: withDecimals[1].value, confidence: 'decimals' };
  }
  if (nums.length >= 2) {
    return { x: nums[0].value, y: nums[1].value, confidence: 'guess' };
  }
  return null;
}

/** Format a coordinate the way the game and chat show it. */
export function formatCoordinate(n) {
  return Number(n).toFixed(2);
}
