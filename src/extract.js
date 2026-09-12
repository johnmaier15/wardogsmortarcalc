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
  const re = new RegExp(`(?:^|[^A-Za-z])(${labelClass})(\\s*[:=.\\-]?\\s*)(${NUMBERISH})`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[3];
    const n = tokenToCoordinate(raw);
    if (n === null) continue;
    // Score how much this looks like the game's readout, which is always a
    // lowercase label glued to a number with two decimals: "x98.44".
    let score = 0;
    const hasDecimals = /[.,،]\s?[\dOoQDlI|iSsBZzGgq]{2}$/.test(raw.trim());
    if (hasDecimals) score += 4;
    if (m[2] === '') score += 2;                    // label glued to number
    else if (/^\s*:?\s*$/.test(m[2])) score += 1;   // "X: 85.23" style
    if (n >= 0 && n <= 170) score += 1;             // inside any WARDOGS map
    if (/^\d{1,3}$/.test(cleanNumberToken(raw).split('.')[0])) score += 1;
    out.push({ value: n, index: m.index, score, hasDecimals });
  }
  return out;
}

/**
 * Pick the best X/Y pair from labelled candidates. Pairs are scored by
 * their own format scores plus a bonus for being close together in the
 * text, since the readout's two lines come out adjacent in reading order
 * while distractors (compass strip, dial numbers, key hints) sit elsewhere.
 */
function bestPair(xs, ys) {
  let best = null;
  for (const x of xs) {
    for (const y of ys) {
      const gap = Math.abs(x.index - y.index);
      const proximity = gap <= 20 ? 3 : gap <= 60 ? 2 : gap <= 150 ? 1 : 0;
      const total = x.score + y.score + proximity;
      if (!best || total > best.total) best = { x, y, total };
    }
  }
  return best;
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
    const p = bestPair(xs, ys);
    // Two two-decimal readings next to each other is the real thing; a pair
    // without decimals is probably noise and gets flagged for a closer look.
    const strong = p.x.hasDecimals && p.y.hasDecimals;
    return { x: p.x.value, y: p.y.value, confidence: strong ? 'labelled' : 'labelled-weak' };
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
