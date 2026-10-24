// Unit tests for the Teknik Tarayıcı rules (assets/js/screener.js).
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = {};
vm.createContext(context);
vm.runInContext(`${readFileSync(new URL('../assets/js/screener.js', import.meta.url), 'utf8')}\nthis.Screener = Screener;`, context);
const { applyRules, sortRows, PRESETS } = context.Screener;
const codes = rows => JSON.parse(JSON.stringify(rows.map(r => r.code)));

const rows = [
  { code: 'A', rsi: 25, s50: 5, s200: 10, w1: 3 },
  { code: 'B', rsi: 75, s50: -2, s200: -5, w1: -1 },
  { code: 'C', rsi: null, s50: 1, s200: 0.5, w1: 8 },
  { code: 'D', rsi: 50, s50: 2, s200: 4, w1: null }
];

test('every rule must pass and a missing value fails', () => {
  assert.deepEqual(codes(applyRules(rows, [['rsi', '<', 30]])), ['A']);
  assert.deepEqual(codes(applyRules(rows, [['rsi', '>=', 25], ['rsi', '<=', 50]])), ['A', 'D']);
  assert.deepEqual(codes(applyRules(rows, [])), ['A', 'B', 'C', 'D']);
});

test('the trend scan needs SMA 50 above SMA 200 (the smaller distance)', () => {
  const p = PRESETS.trend;
  assert.deepEqual(codes(applyRules(rows, p.rules, p.test)), ['A', 'D']);
});

test('sorting keeps missing values last in both directions', () => {
  assert.deepEqual(codes(sortRows(rows, ['w1', -1])), ['C', 'A', 'B', 'D']);
  assert.deepEqual(codes(sortRows(rows, ['w1', 1])), ['B', 'A', 'C', 'D']);
});
