import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCoordinates, distanceMeters, azimuthDegrees, degreesToMils,
  interpolateMils, solve, correctedTarget,
} from '../src/ballistics.js';
import { WEAPONS, getWeapon } from '../data/weapons.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('parseCoordinates handles labelled and bare pairs', () => {
  assert.deepEqual(parseCoordinates('X: 85.23 Y: 41.10'), { x: 85.23, y: 41.1 });
  assert.deepEqual(parseCoordinates('x85.23, y41.10'), { x: 85.23, y: 41.1 });
  assert.deepEqual(parseCoordinates('X85,23 Y41,10'), { x: 85.23, y: 41.1 });
  assert.deepEqual(parseCoordinates('85.23 41.10'), { x: 85.23, y: 41.1 });
  assert.deepEqual(parseCoordinates('Y 41.10  X 85.23'), { x: 85.23, y: 41.1 });
  assert.equal(parseCoordinates('nothing here'), null);
  assert.equal(parseCoordinates('1 2 3'), null);
  assert.equal(parseCoordinates(''), null);
});

test('distance: 0.10 units is 10 m (calculator doc example)', () => {
  close(distanceMeters({ x: 105.0, y: 115.1 }, { x: 105.1, y: 115.1 }), 10);
  close(distanceMeters({ x: 0, y: 0 }, { x: 3, y: 4 }), 500);
});

test('azimuth is a compass bearing with Y north', () => {
  close(azimuthDegrees({ x: 0, y: 0 }, { x: 0, y: 1 }), 0);
  close(azimuthDegrees({ x: 0, y: 0 }, { x: 1, y: 0 }), 90);
  close(azimuthDegrees({ x: 0, y: 0 }, { x: 0, y: -1 }), 180);
  close(azimuthDegrees({ x: 0, y: 0 }, { x: -1, y: 0 }), 270);
  close(azimuthDegrees({ x: 0, y: 0 }, { x: 1, y: 1 }), 45);
  close(azimuthDegrees({ x: 0, y: 0 }, { x: -1, y: 1 }), 315);
  close(azimuthDegrees({ x: 5, y: 5 }, { x: 5, y: 5 }), 0);
});

test('degrees to NATO mils', () => {
  close(degreesToMils(90), 1600);
  close(degreesToMils(360), 6400);
});

test('interpolateMils hits table rows exactly and interpolates between', () => {
  const t = getWeapon('mortar').tables.single;
  assert.equal(interpolateMils(t, 132), 850);
  assert.equal(interpolateMils(t, 684), 150);
  assert.equal(interpolateMils(t, 385), 600);
  // between [376,610] and [385,600]
  close(interpolateMils(t, 380.5), 605);
  assert.equal(interpolateMils(t, 10), null);
  assert.equal(interpolateMils(t, 5000), null);
  assert.equal(interpolateMils([], 100), null);
});

test('interpolateMils works on descending-range tables (SPH-2 high)', () => {
  const t = getWeapon('spg').tables.high;
  assert.equal(interpolateMils(t, 780), 1390);
  assert.equal(interpolateMils(t, 2147), 1000);
  close(interpolateMils(t, 2135), 1005);
});

test('solve returns a full mortar solution', () => {
  const gun = { x: 100.0, y: 100.0 };
  const target = { x: 102.0, y: 103.0 }; // dx=200 m, dy=300 m
  const s = solve(gun, target, getWeapon('mortar'));
  close(s.rangeMeters, Math.hypot(200, 300));
  close(s.azimuthDeg, (Math.atan2(200, 300) * 180) / Math.PI);
  assert.equal(s.inRange, true);
  assert.equal(s.solutions.length, 1);
  assert.equal(s.solutions[0].name, 'single');
  assert.ok(s.solutions[0].mil > 620 && s.solutions[0].mil < 630);
});

test('solve flags out-of-range shots', () => {
  const w = getWeapon('mortar');
  const tooClose = solve({ x: 0, y: 0 }, { x: 0, y: 0.5 }, w);
  assert.equal(tooClose.inRange, false);
  assert.equal(tooClose.tooClose, true);
  assert.equal(tooClose.solutions.length, 0);
  const tooFar = solve({ x: 0, y: 0 }, { x: 0, y: 10 }, w);
  assert.equal(tooFar.tooFar, true);
  assert.equal(tooFar.solutions.length, 0);
});

test('SPH-2 exposes low and high solutions where both exist', () => {
  const s = solve({ x: 0, y: 0 }, { x: 0, y: 20 }, getWeapon('spg')); // 2000 m
  assert.equal(s.inRange, true);
  const names = s.solutions.map(x => x.name).sort();
  assert.deepEqual(names, ['high', 'low']);
});

test('weapon tables are internally consistent', () => {
  for (const w of WEAPONS) {
    assert.ok(w.minRangeMeters < w.maxRangeMeters);
    for (const rows of Object.values(w.tables)) {
      for (const [r, m] of rows) {
        assert.ok(Number.isFinite(r) && Number.isFinite(m));
      }
    }
    // The playable range must be covered by at least one table at each end.
    const tables = Object.values(w.tables);
    assert.ok(tables.some(t => interpolateMils(t, w.minRangeMeters) !== null), `${w.id} min`);
    assert.ok(tables.some(t => interpolateMils(t, w.maxRangeMeters) !== null), `${w.id} max`);
  }
});

test('correctedTarget shifts aim opposite to the miss', () => {
  const gun = { x: 0, y: 0 };
  const target = { x: 0, y: 3 }; // due north, 300 m
  // Round landed 20 m long and 10 m right: aim 20 m short, 10 m left.
  const c = correctedTarget(gun, target, 20, 10);
  close(c.x, -0.1);
  close(c.y, 2.8);
  // Firing east: overshoot is +x, right is -y.
  const c2 = correctedTarget(gun, { x: 3, y: 0 }, 20, 10);
  close(c2.x, 2.8);
  close(c2.y, 0.1);
});
