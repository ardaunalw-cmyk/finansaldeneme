// Unit tests for the Halka Arzlar data (scripts/fetch-ipos.mjs) and its summary (assets/js/ipo.js).
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ipoRow } from '../scripts/fetch-ipos.mjs';

const context = {};
vm.createContext(context);
vm.runInContext(`${readFileSync(new URL('../assets/js/ipo.js', import.meta.url), 'utf8')}\nthis.Ipos = Ipos;`, context);
const { summary } = context.Ipos;

const DAY = 86400;
const NOW = Date.UTC(2026, 9, 24) / 1000;
const bar = (d, o, h, c) => ({ t: NOW - d * DAY, o, h, c });

test('a recent listing: limit-up run after day one, peak and return from the first close', () => {
  const r = ipoRow('NEW', [bar(10, 10, 11, 10), bar(9, 11, 11, 11), bar(8, 12.1, 12.1, 12.1), bar(7, 12, 13, 11.5), bar(6, 12, 12.5, 12)], NOW);
  assert.equal(r.first, '2026-10-14');
  assert.equal(r.streak, 2);                 // 11 (+10%) and 12.1 (+10%), then 11.5 breaks it
  assert.equal(r.peak, 13);
  assert.equal(r.ret, 20);
  assert.equal(r.peakRet, 30);
  assert.equal(r.fromPeak, -7.7);
  assert.equal(r.sessions, 5);
});

test('a company trading for longer than two years is not a recent listing', () => {
  assert.equal(ipoRow('OLD', [bar(900, 1, 1, 1), bar(1, 2, 2, 2)], NOW), null);
  assert.equal(ipoRow('NONE', [], NOW), null);
});

test('the summary gives the median return and the longest limit-up run', () => {
  const s = summary([{ code: 'A', ret: 10, streak: 1 }, { code: 'B', ret: -20, streak: 4 }, { code: 'C', ret: 5, streak: 0 }, { code: 'D', ret: 40, streak: 2 }]);
  assert.equal(s.n, 4);
  assert.equal(s.median, 7.5);
  assert.equal(s.up, 75);
  assert.equal(s.top.code, 'B');
});
