import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCoordinates, cleanNumberToken, tokenToCoordinate, findNumbers } from '../src/extract.js';

test('clean OCR text with labels', () => {
  assert.deepEqual(extractCoordinates('X: 85.23  Y: 41.10'), { x: 85.23, y: 41.1, confidence: 'labelled' });
  assert.deepEqual(extractCoordinates('x85.23, y41.10'), { x: 85.23, y: 41.1, confidence: 'labelled' });
  assert.deepEqual(extractCoordinates('X 105.00\nY 115.10'), { x: 105, y: 115.1, confidence: 'labelled' });
});

test('labels survive common OCR swaps', () => {
  assert.deepEqual(extractCoordinates('×: 85.23 V: 41.10'), { x: 85.23, y: 41.1, confidence: 'labelled' });
  assert.deepEqual(extractCoordinates('X: 8S.23 Y: 4l.1O'), { x: 85.23, y: 41.1, confidence: 'labelled' });
  assert.deepEqual(extractCoordinates('X: 85,23 Y: 41,10'), { x: 85.23, y: 41.1, confidence: 'labelled' });
});

test('labels are not matched inside words', () => {
  // "max" contains an x, "key" contains a y; they must not be treated as labels.
  const r = extractCoordinates('max 3 key 4 X: 12.50 Y: 13.75');
  assert.deepEqual(r, { x: 12.5, y: 13.75, confidence: 'labelled' });
});

test('falls back to two decimal numbers when labels are lost', () => {
  assert.deepEqual(extractCoordinates('85.23 41.10'), { x: 85.23, y: 41.1, confidence: 'decimals' });
  assert.deepEqual(extractCoordinates('HUD 1200 85.23 | 41.10 12'), { x: 85.23, y: 41.1, confidence: 'decimals' });
});

test('one label plus a bare decimal pairs correctly', () => {
  assert.deepEqual(extractCoordinates('X: 85.23 41.10'), { x: 85.23, y: 41.1, confidence: 'decimals' });
  assert.deepEqual(extractCoordinates('85.23 Y: 41.10'), { x: 85.23, y: 41.1, confidence: 'decimals' });
});

test('lost decimal point is recovered for 4-5 digit tokens', () => {
  assert.equal(tokenToCoordinate('8523'), 85.23);
  assert.equal(tokenToCoordinate('10500'), 105);
  assert.equal(tokenToCoordinate('85'), 85);
  assert.deepEqual(extractCoordinates('X 8523 Y 4110'), { x: 85.23, y: 41.1, confidence: 'labelled' });
});

test('guess mode uses first two plausible numbers', () => {
  assert.deepEqual(extractCoordinates('85 41'), { x: 85, y: 41, confidence: 'guess' });
});

test('returns null on garbage', () => {
  assert.equal(extractCoordinates(''), null);
  assert.equal(extractCoordinates('nothing to see'), null);
  assert.equal(extractCoordinates('7'), null);
});

test('cleanNumberToken and findNumbers', () => {
  assert.equal(cleanNumberToken('8S.2З'), '85.2'); // Cyrillic З is dropped, not mapped
  assert.equal(cleanNumberToken('l0O.5'), '100.5');
  const nums = findNumbers('speed 999 pos 85.23 41.10 alt 12345');
  assert.deepEqual(nums.map(n => n.value), [85.23, 41.1, 123.45]);
});
