// Unit tests for the data helpers of the interactive price chart (assets/js/pro-chart.js).
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The chart file is a classic browser script; run it with a bare window and no chart library
const context = { window: {} };
vm.createContext(context);
vm.runInContext(readFileSync(new URL('../assets/js/pro-chart.js', import.meta.url), 'utf8'), context);
const { toBars, heikinAshi, groupBars, startIndex, snapTime } = context.window.ProChart;
// Arrays from the vm context have another realm's prototype, so compare plain copies
const plain = v => JSON.parse(JSON.stringify(v));

const DAY = 86400;
const H = 3600;
const bar = (time, o, h, l, c, v = 1) => ({ time, open: o, high: h, low: l, close: c, volume: v });

test('history becomes ascending bars in seconds, skipping gaps and repeats', () => {
  const bars = toBars({
    t: [1000, 2000, 2000, 3000, 4000],
    o: [10, 11, 11, null, 13],
    h: [12, 13, 13, 14, 15],
    l: [9, 10, 10, 11, 12],
    c: [11, 12, 12, 13, 14],
    v: [100, 200, 200, 300, null]
  });
  assert.deepEqual(plain(bars.map(b => b.time)), [1, 2, 4]);
  assert.equal(bars[2].volume, 0);
});

test('bar times shift by the exchange UTC offset', () => {
  // 06:30 UTC is 09:30 in Istanbul
  const bars = toBars({ t: [Date.UTC(2026, 9, 19, 6, 30)], o: [1], h: [1], l: [1], c: [1], v: [1] }, 10800);
  assert.equal(new Date(bars[0].time * 1000).toISOString(), '2026-10-19T09:30:00.000Z');
});

test('hourly bars merge into 4-hour bars within each day', () => {
  // Nine hourly bars a day (09:30-17:30) -> 4 + 4 + 1, and the next day starts a new group
  const day1 = Array.from({ length: 9 }, (_, i) => bar(DAY + 9.5 * H + i * H, 10 + i, 11 + i, 9 + i, 10.5 + i, 100));
  const day2 = [bar(2 * DAY + 9.5 * H, 50, 52, 49, 51, 7)];
  const out = plain(groupBars([...day1, ...day2], 4));
  assert.equal(out.length, 4);
  assert.deepEqual(out[0], { time: day1[0].time, open: 10, high: 14, low: 9, close: 13.5, volume: 400 });
  assert.equal(out[1].open, 14);
  assert.equal(out[2].time, day1[8].time);
  assert.equal(out[2].volume, 100);
  assert.deepEqual(out[3], day2[0]);
});

test('Heikin-Ashi candles follow the standard formulas', () => {
  const bars = [bar(1, 10, 12, 9, 11), bar(2, 11, 14, 10, 13)];
  const [a, b] = heikinAshi(bars);
  assert.equal(a.close, (10 + 12 + 9 + 11) / 4);
  assert.equal(a.open, (10 + 11) / 2);
  assert.equal(b.open, (a.open + a.close) / 2);
  assert.equal(b.close, (11 + 14 + 10 + 13) / 4);
  assert.equal(b.high, Math.max(14, b.open, b.close));
  assert.equal(b.low, Math.min(10, b.open, b.close));
});

test('visible windows count trading days for 1G/5G and calendar days otherwise', () => {
  // 30 trading days of 5-minute bars (100 a day)
  const bars = [];
  for (let d = 0; d < 30; d++) for (let k = 0; k < 100; k++) bars.push(bar(d * DAY + 10 * H + k * 300, 1, 1, 1, 1));
  assert.equal(startIndex(bars, '1G'), 2900);
  assert.equal(startIndex(bars, '5G'), 2500);
  assert.equal(startIndex(bars, 'all'), 0);
  // 20 daily bars: a 1-day window still shows at least 10 bars; 1A covers them all
  const daily = Array.from({ length: 20 }, (_, i) => bar(i * DAY, 1, 1, 1, 1));
  assert.equal(startIndex(daily, '1G'), 10);
  assert.equal(startIndex(daily, '1A'), 0);
});

test('drawing points snap to the nearest bar, and outside the loaded bars to nothing', () => {
  const bars = [bar(100, 1, 1, 1, 1), bar(200, 1, 1, 1, 1), bar(300, 1, 1, 1, 1)];
  assert.equal(snapTime(bars, 140), 100);
  assert.equal(snapTime(bars, 160), 200);
  assert.equal(snapTime(bars, 300), 300);
  assert.equal(snapTime(bars, 50), null);
  assert.equal(snapTime(bars, 301), null);
});
