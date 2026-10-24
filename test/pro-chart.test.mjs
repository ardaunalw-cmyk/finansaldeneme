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
const { toBars, heikinAshi, groupBars, startIndex, snapTime, cleanSettings, indLabel, alignTo, rayEnd, measureLabel, volumeProfile } = context.window.ProChart;
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

test('compared closes land on the stock bar times within the tolerance', () => {
  // Stock: daily bars at 09:30; index: bars stamped 10:00, plus one day the stock did not trade
  const stock = [1, 2, 4].map(d => bar(d * DAY + 9.5 * H, 1, 1, 1, 1));
  const index = [1, 2, 3, 4].map(d => bar(d * DAY + 10 * H, 1, 1, 1, 100 + d));
  assert.deepEqual(plain(alignTo(stock, index, 12 * H)), [
    { time: stock[0].time, value: 101 },
    { time: stock[1].time, value: 102 },
    { time: stock[2].time, value: 104 }
  ]);
  // A currency's 24-hour 5-minute bars: only those on the stock's bars are kept, the later wins
  const s5 = [0, 300, 600].map(t => bar(t, 1, 1, 1, 1));
  const fx = [-600, 0, 120, 300, 9000].map((t, i) => bar(t, 1, 1, 1, 30 + i));
  assert.deepEqual(plain(alignTo(s5, fx, 150)), [{ time: 0, value: 32 }, { time: 300, value: 33 }]);
  assert.deepEqual(plain(alignTo([], fx, 150)), []);
});

test('indicator settings fall back to defaults, are clamped, and name the indicator', () => {
  const d = plain(cleanSettings({}));
  assert.equal(d.sma20.n, 20);
  assert.deepEqual(d.macd, { fast: 12, slow: 26, signal: 9 });
  const s = plain(cleanSettings({ sma20: { n: 34.4 }, rsi: { n: 0, upper: 'x' }, bb: { k: 2.5 } }));
  assert.equal(s.sma20.n, 34);
  assert.equal(s.rsi.n, 2);
  assert.equal(s.rsi.upper, 70);
  assert.equal(s.bb.k, 2.5);
  assert.equal(indLabel('sma20', s), 'SMA 34');
  assert.equal(indLabel('bb', s), 'BB 20,2,5');
  assert.equal(indLabel('macd', s), 'MACD 12,26,9');
  assert.equal(indLabel('volume', s), 'Hacim');
});

test('a ray runs to the pane edge on the side of its second point', () => {
  assert.deepEqual(plain(rayEnd({ x: 0, y: 100 }, { x: 10, y: 90 }, 200)), { x: 200, y: -100 });
  assert.deepEqual(plain(rayEnd({ x: 50, y: 0 }, { x: 40, y: 10 }, 200)), { x: 0, y: 50 });
  // Vertical: nowhere to extend, the second point is the end
  assert.deepEqual(plain(rayEnd({ x: 5, y: 0 }, { x: 5, y: 10 }, 200)), { x: 5, y: 10 });
});

test('the measure label gives the change, the percent and the bar count', () => {
  assert.equal(measureLabel(100, 112.4, 23), '+12,40 (+12,40%) · 23 mum');
  assert.equal(measureLabel(200, 150, -5), '-50,00 (-25,00%) · 5 mum');
});

test('volume profile spreads each bar over its price rows and finds the POC and value area', () => {
  // Rows of 1 between 10 and 14: an up bar over 10-12 (rows 0 and 1), a down bar over 11.5-13.5
  // (rows 1-3) and a heavy down bar inside 13-14 (row 3)
  const p = volumeProfile([bar(1, 10, 12, 10, 11, 300), bar(2, 13, 13.5, 11.5, 12, 600), bar(3, 14, 14, 13, 13, 500)], 4);
  assert.equal(p.lo, 10);
  assert.equal(p.step, 1);
  assert.deepEqual(plain(p.rows.map(r => [r.up, r.down])), [[150, 0], [150, 200], [0, 200], [0, 700]]);
  assert.equal(p.poc, 3);
  // 70% of 1400 = 980: POC (700), then the heavier neighbour below (row 2: 200), then row 1 (350)
  assert.deepEqual([p.vaLow, p.vaHigh], [1, 3]);
  assert.equal(volumeProfile([bar(1, 1, 1, 1, 1, 0)]), null);
  assert.equal(volumeProfile([bar(1, 5, 5, 5, 5, 10)]), null);
});

test('drawing points snap to the nearest bar, and outside the loaded bars to nothing', () => {
  const bars = [bar(100, 1, 1, 1, 1), bar(200, 1, 1, 1, 1), bar(300, 1, 1, 1, 1)];
  assert.equal(snapTime(bars, 140), 100);
  assert.equal(snapTime(bars, 160), 200);
  assert.equal(snapTime(bars, 300), 300);
  assert.equal(snapTime(bars, 50), null);
  assert.equal(snapTime(bars, 301), null);
});
