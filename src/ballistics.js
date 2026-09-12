/**
 * Pure ballistics / geometry helpers for the WARDOGS mortar calculator.
 * No DOM access, so this module is unit-testable under Node.
 *
 * Coordinate conventions (matching the in-game tactical map):
 *   - X grows to the east, Y grows to the north.
 *   - One coordinate unit is 100 m, so 0.01 units is 1 m.
 *   - Azimuth is a compass bearing: 0 = north, 90 = east, clockwise.
 */

export const METERS_PER_UNIT = 100;

/**
 * Parse a coordinate pair from free text.
 * Accepts labelled forms like "X: 85.23 Y: 41.10", "x85.23, y41.10",
 * "X85.23 Y41.10", or a bare pair of numbers "85.23 41.10".
 * Decimal commas are accepted. Returns { x, y } or null.
 */
export function parseCoordinates(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;

  const num = '[+-]?\\d+(?:[.,]\\d+)?';
  const toNum = raw => Number(String(raw).replace(',', '.'));

  const xm = s.match(new RegExp(`(?:^|[^a-z])x\\s*[:=]?\\s*(${num})`, 'i'));
  const ym = s.match(new RegExp(`(?:^|[^a-z])y\\s*[:=]?\\s*(${num})`, 'i'));
  if (xm && ym) {
    const x = toNum(xm[1]);
    const y = toNum(ym[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  const all = s.match(new RegExp(num, 'g'));
  if (!all || all.length !== 2) return null;
  const x = toNum(all[0]);
  const y = toNum(all[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Distance in metres between two coordinate points. */
export function distanceMeters(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y) * METERS_PER_UNIT;
}

/** Compass bearing in degrees from a to b, 0 = north, clockwise, in [0, 360). */
export function azimuthDegrees(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return 0;
  let deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

/** Degrees to NATO mils (6400 per circle). */
export function degreesToMils(deg) {
  return (deg * 6400) / 360;
}

/**
 * Linear interpolation on a firing table given as [[rangeMeters, mil], ...].
 * Returns the mil value for the range, or null when the range is outside
 * the table. Tables may be listed with ranges increasing or decreasing.
 */
export function interpolateMils(table, rangeMeters) {
  if (!Array.isArray(table) || table.length === 0 || !Number.isFinite(rangeMeters)) {
    return null;
  }
  const rows = [...table].sort((p, q) => p[0] - q[0]);
  const eps = 1e-9;
  if (rangeMeters < rows[0][0] - eps || rangeMeters > rows[rows.length - 1][0] + eps) {
    return null;
  }
  for (let i = 0; i < rows.length; i++) {
    const [r, m] = rows[i];
    if (Math.abs(r - rangeMeters) <= eps) return m;
    if (i < rows.length - 1) {
      const [r2, m2] = rows[i + 1];
      if (rangeMeters > r && rangeMeters < r2) {
        const t = (rangeMeters - r) / (r2 - r);
        return m + t * (m2 - m);
      }
    }
  }
  return null;
}

/**
 * Compute a full firing solution.
 * @param {{x:number,y:number}} gun   your mortar position
 * @param {{x:number,y:number}} target
 * @param {object} weapon  entry from data/weapons.js
 * @returns {{
 *   rangeMeters:number, azimuthDeg:number, azimuthMils:number,
 *   inRange:boolean, tooClose:boolean, tooFar:boolean,
 *   solutions: Array<{ name:string, mil:number }>
 * }}
 */
export function solve(gun, target, weapon) {
  const rangeMeters = distanceMeters(gun, target);
  const azimuthDeg = azimuthDegrees(gun, target);
  const tooClose = rangeMeters < weapon.minRangeMeters - 1e-6;
  const tooFar = rangeMeters > weapon.maxRangeMeters + 1e-6;
  const inRange = !tooClose && !tooFar;

  const solutions = [];
  if (inRange) {
    for (const [name, table] of Object.entries(weapon.tables)) {
      const mil = interpolateMils(table, rangeMeters);
      if (mil !== null) solutions.push({ name, mil });
    }
  }

  return {
    rangeMeters,
    azimuthDeg,
    azimuthMils: degreesToMils(azimuthDeg),
    inRange,
    tooClose,
    tooFar,
    solutions,
  };
}

/**
 * Correction helper: given where a round actually landed relative to the
 * target, return an adjusted aim point. Returns the point you should feed
 * back in as the "target" so the next round lands on the real target.
 * Ranges are in metres along the gun–target line (positive = overshoot) and
 * across it (positive = landed right of target when looking from the gun).
 */
export function correctedTarget(gun, target, overshootMeters, rightMeters) {
  const az = (azimuthDegrees(gun, target) * Math.PI) / 180;
  // Unit vectors in coordinate units (100 m each)
  const fwd = { x: Math.sin(az), y: Math.cos(az) };
  const right = { x: Math.cos(az), y: -Math.sin(az) };
  const o = overshootMeters / METERS_PER_UNIT;
  const r = rightMeters / METERS_PER_UNIT;
  return {
    x: target.x - fwd.x * o - right.x * r,
    y: target.y - fwd.y * o - right.y * r,
  };
}
