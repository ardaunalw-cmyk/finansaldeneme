// Unit tests for the technical indicators (assets/js/indicators.js).
//
//   npm test
//
// Synthetic bars with an obvious answer (steady rise, steady fall, flat) pin each indicator's
// direction and range; a few textbook values pin the formulas themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ind = require('../assets/js/indicators.js');

const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} != ${expected} ± ${tol}`);
const last = a => a[a.length - 1];

/** n daily bars moving by `step` per day, each with a 2-wide range around the close. */
function bars(n, step, start = 100, volume = 1000) {
  const c = Array.from({ length: n }, (_, i) => start + step * i);
  return { c, h: c.map(x => x + 1), l: c.map(x => x - 1), v: c.map(() => volume) };
}
const up = bars(120, 1);
const down = bars(120, -0.5, 200);

test('moving averages', () => {
  assert.deepEqual(Ind.sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const e = Ind.ema([1, 2, 3, 4, 5], 3);
  assert.deepEqual(e.slice(0, 3), [null, null, 2]);
  assert.equal(e[3], 3);   // 4 * 0.5 + 2 * 0.5
  assert.equal(e[4], 4);
});

test('RSI, stochastic, Williams %R and CCI read a steady rise as overbought', () => {
  assert.equal(last(Ind.rsi(up.c)), 100);
  assert.equal(last(Ind.rsi(down.c)), 0);
  near(last(Ind.stochastic(up.h, up.l, up.c).k), 100 * 14 / 15, 1e-9, 'close sits 1 below the 14-bar high');
  assert.ok(Ind.williamsR(up.h, up.l, up.c) > -20);
  assert.ok(Ind.cci(up.h, up.l, up.c) > 100);
  assert.ok(Ind.cci(down.h, down.l, down.c) < -100);
});

test('MACD is positive in a rise and its histogram settles near zero', () => {
  const m = Ind.macd(up.c);
  near(last(m.line), 7, 1e-6, 'EMA12 - EMA26 of a straight line is (26 - 12) / 2');
  near(last(m.histogram), 0, 1e-6, 'signal catches up with a constant MACD');
});

test('Bollinger bands are symmetric around the SMA', () => {
  const b = Ind.bollinger(up.c);
  near(last(b.upper) - last(b.mid), last(b.mid) - last(b.lower), 1e-9, 'symmetry');
  near(last(b.mid), last(up.c) - 9.5, 1e-9, 'SMA 20 of a line lags by 9.5');
});

test('ROC and Ultimate Oscillator', () => {
  near(Ind.roc(up.c, 10), (219 / 209 - 1) * 100, 1e-9, 'roc');
  // Closes in the middle of every range read as 50; closing on the high / low reads 100 / 0
  assert.equal(Ind.ultimateOscillator(up.h, up.l, up.c), 50);
  assert.equal(Ind.ultimateOscillator(up.c, up.c.map(x => x - 2), up.c), 100);
  assert.equal(Ind.ultimateOscillator(down.c.map(x => x + 2), down.c, down.c), 0);
  assert.equal(Ind.roc([1, 2], 5), null);
});

test('StochRSI stays mid-range when RSI is flat', () => {
  const s = Ind.stochRsi(up.c);
  assert.equal(last(s.k), 50, 'RSI is pinned at 100, so its own range is zero');
});

test('ADX, Parabolic SAR, Supertrend and Aroon agree on the trend direction', () => {
  const a = Ind.adx(up.h, up.l, up.c);
  assert.ok(a.plusDI > a.minusDI && a.adx > 25, JSON.stringify(a));
  const d = Ind.adx(down.h, down.l, down.c);
  assert.ok(d.minusDI > d.plusDI);

  assert.equal(Ind.parabolicSar(up.h, up.l).up, true);
  assert.equal(Ind.parabolicSar(down.h, down.l).up, false);
  assert.ok(Ind.parabolicSar(up.h, up.l).sar < last(up.l));

  assert.equal(Ind.supertrend(up.h, up.l, up.c).up, true);
  assert.equal(Ind.supertrend(down.h, down.l, down.c).up, false);

  assert.deepEqual(Ind.aroon(up.h, up.l), { up: 100, down: 0 });
  assert.deepEqual(Ind.aroon(down.h, down.l), { up: 0, down: 100 });
});

test('Ichimoku puts a rising price above its cloud', () => {
  const i = Ind.ichimoku(up.h, up.l, up.c);
  assert.ok(last(up.c) > i.cloudTop);
  assert.ok(i.tenkan > i.kijun);
  assert.equal(Ind.ichimoku(up.h.slice(0, 50), up.l.slice(0, 50), up.c.slice(0, 50)), null);
});

test('volume indicators: OBV, MFI, CMF, VWAP and the volume ratio', () => {
  assert.equal(last(Ind.obv(up.c, up.v)), 119 * 1000);
  assert.equal(Ind.mfi(up.h, up.l, up.c, up.v), 100);
  assert.equal(Ind.mfi(down.h, down.l, down.c, down.v), 0);

  // Closing on the high of every bar is full buying pressure
  const c = [10, 11, 12, 13, 14];
  assert.equal(Ind.cmf(c, c.map(x => x - 1), c, [1, 1, 1, 1, 1], 5), 1);

  near(Ind.vwap(up.h, up.l, up.c, up.v), last(up.c) - 9.5, 1e-9, 'equal volume: VWAP is the mean typical price');
  assert.equal(Ind.volumeRatio([10, 10, 10, 30], 3), 3);
});

test('channels and pivots', () => {
  const dc = Ind.donchian(up.h, up.l);
  assert.equal(dc.upper, up.h[up.h.length - 2], 'channel excludes the newest bar');
  assert.ok(last(up.h) > dc.upper, 'a steady rise makes a new high every day');

  const k = Ind.keltner(up.h, up.l, up.c);
  near(k.upper - k.mid, k.mid - k.lower, 1e-9, 'keltner symmetry');

  const p = Ind.pivots([12], [8], [10]);
  assert.deepEqual(p, { p: 10, r1: 12, s1: 8, r2: 14, s2: 6 });
});

test('lastCross finds the newest crossing and its age', () => {
  assert.deepEqual(Ind.lastCross([1, 1, 3, 4], [2, 2, 2, 2], 5), { dir: 'up', ago: 1 });
  assert.deepEqual(Ind.lastCross([3, 3, 1, 1], [2, 2, 2, 2], 5), { dir: 'down', ago: 1 });
  assert.equal(Ind.lastCross([3, 3, 3], [2, 2, 2], 5), null);
});
