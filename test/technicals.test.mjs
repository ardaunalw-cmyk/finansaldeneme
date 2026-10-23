// Unit tests for the screener's daily technical snapshot (scripts/fetch-technicals.mjs) and the
// committed data file it writes (assets/data/technicals.json).
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapshot, FIELDS } from '../scripts/fetch-technicals.mjs';

const row = r => Object.fromEntries(FIELDS.map((f, i) => [f, r[i]]));

test('a steady rise reads as above every average, near the high, with positive returns', () => {
  const c = Array.from({ length: 260 }, (_, i) => 100 + i);
  const t = row(snapshot(c.map(x => x + 1), c.map(x => x - 1), c, c.map(() => 1000)));
  assert.equal(t.close, 359);
  assert.ok(t.s20 > 0 && t.s50 > 0 && t.s200 > 0);
  assert.ok(t.rsi > 90);
  assert.ok(t.hi52 <= 0 && t.hi52 > -1, 'just under the 52-week high (which includes the high)');
  assert.equal(t.d1, Math.round((359 / 358 - 1) * 1000) / 10);
  assert.equal(t.m1, Math.round((359 / 338 - 1) * 1000) / 10);
  assert.equal(t.vol, 1);
  // On a straight line MACD flattens out; the field is only ever a sign
  assert.ok([1, 0, -1].includes(t.macd), `macd ${t.macd}`);
});

test('short histories leave the long average out and very short ones are skipped', () => {
  const c = Array.from({ length: 60 }, (_, i) => 50 - i * 0.2);
  const t = row(snapshot(c, c, c, c.map(() => 0)));
  assert.equal(t.s200, null);
  assert.ok(t.s20 < 0);
  assert.equal(t.vol, null, 'no volume, no ratio');
  assert.equal(t.m3, null, 'fewer than 64 sessions');
  assert.equal(snapshot([1], [1], [1], [1]), null);
});

test('the committed snapshot matches its field list', () => {
  const j = JSON.parse(readFileSync(new URL('../assets/data/technicals.json', import.meta.url), 'utf8'));
  assert.deepEqual(j.fields, FIELDS);
  const rows = Object.values(j.data);
  assert.ok(rows.length > 300, `${rows.length} rows`);
  rows.forEach(r => assert.equal(r.length, FIELDS.length));
  assert.match(j.asOf, /^\d{4}-\d{2}-\d{2}$/);
});
