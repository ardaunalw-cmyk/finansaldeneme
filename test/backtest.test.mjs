// Unit tests for the strategy backtester (assets/js/backtest.js).
//
//   npm test
//
// Synthetic bars with an answer you can work out by hand: when each order fills, what the
// commission takes, where a stop fills on a gap, and that the result never uses a future bar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Backtest = require('../assets/js/backtest.js');

const DAY = 86400;
const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} != ${expected} ± ${tol}`);
/** Daily bars from closes; open = previous close unless given, high/low 1% around. */
const fromCloses = (closes, opens) => closes.map((c, i) => {
  const o = opens ? opens[i] : (i ? closes[i - 1] : c);
  return { time: i * DAY, open: o, high: Math.max(o, c) * 1.01, low: Math.min(o, c) * 0.99, close: c };
});

test('every strategy runs and keeps its books straight', () => {
  // Two years of bars from a deterministic up-and-down walk
  let p = 100;
  const closes = Array.from({ length: 500 }, (_, i) => (p *= 1 + Math.sin(i / 7) * 0.02 + Math.cos(i / 31) * 0.01));
  const bars = fromCloses(closes);
  const formula = { entry: 'crossover(ema(close, 9), ema(close, 21))', exit: 'rsi(close) > 70' };
  for (const key of Object.keys(Backtest.STRATEGIES)) {
    const r = Backtest.run(bars, key, { commission: 0.001, formula });
    assert.ok(r.ok, key);
    assert.equal(r.equity.length, bars.length - r.start, `${key} equity length`);
    // Compounding the trades reproduces the final value (all capital in, one position at a time)
    const compounded = r.trades.reduce((v, t) => v * (1 + t.ret), r.capital);
    near(compounded, r.stats.finalValue, 1e-6 * r.capital, `${key} compounding`);
    r.trades.forEach(t => assert.ok(t.exitTime >= t.entryTime, `${key} trade order`));
    assert.ok(r.stats.maxDrawdown <= 0 && r.stats.maxDrawdown >= -1, `${key} drawdown range`);
  }
});

test('a cross signal on a close fills at the next open, and commission is charged twice', () => {
  // SMA 2 vs SMA 3: flat, then a jump on bar 4 makes the fast one cross above
  const closes = [10, 10, 10, 10, 13, 14, 15, 9, 8, 8];
  const opens = [10, 10, 10, 10, 10, 12, 14, 15, 9, 8];
  const r = Backtest.run(fromCloses(closes, opens), 'sma_cross', { params: { fast: 2, slow: 3 }, commission: 0.01 });
  assert.ok(r.ok);
  const t = r.trades[0];
  // Cross on bar 4's close -> buy at bar 5's open (12)
  assert.equal(t.entryTime, 5 * DAY);
  assert.equal(t.entryPrice, 12);
  // Bar 7 closes at 9: SMA2 8.5... falls below SMA3 -> sell at bar 8's open (9)
  assert.equal(t.exitTime, 8 * DAY);
  assert.equal(t.exitPrice, 9);
  near(t.ret, (9 / 12) * 0.99 * 0.99 - 1, 1e-12, 'net return');
});

test('a stop-loss fills at its level, or at the open when the price gaps through it', () => {
  // Donchian 2/2: bar 3 breaks out, buy at bar 4's open (12)
  const closes = [10, 10, 10, 12, 12, 11.5, 11, 11];
  const opens = [10, 10, 10, 10, 12, 12, 11.5, 11];
  const bars = fromCloses(closes, opens);
  // Bar 5 low is 11.385: a 4% stop (11.52) is inside the bar -> fills at 11.52
  let r = Backtest.run(bars, 'donchian', { params: { entry: 2, exit: 2 }, stopLoss: 0.04 });
  assert.equal(r.trades[0].reason, 'stop');
  near(r.trades[0].exitPrice, 12 * 0.96, 1e-9, 'stop fill');

  // Gap down: bar 5 opens at 10, far under the stop -> fills at the open, not the stop level
  const gap = bars.map((b, i) => (i === 5 ? { ...b, open: 10, low: 9.9 } : b));
  r = Backtest.run(gap, 'donchian', { params: { entry: 2, exit: 2 }, stopLoss: 0.04 });
  assert.equal(r.trades[0].exitPrice, 10);
});

test('a take-profit fills at its level and an open position is valued at the last close', () => {
  const closes = [10, 10, 10, 12, 13, 14, 15];
  const opens = [10, 10, 10, 10, 12, 13, 14];
  const r = Backtest.run(fromCloses(closes, opens), 'donchian', { params: { entry: 2, exit: 2 }, takeProfit: 0.1 });
  assert.equal(r.trades[0].reason, 'target');
  near(r.trades[0].exitPrice, 13.2, 1e-9, 'target fill');
  // The breakout keeps going, so it buys again and is still in at the end
  const last = r.trades[r.trades.length - 1];
  assert.equal(last.reason, 'open');
  assert.equal(last.exitPrice, 15);
  assert.equal(r.open, last);
});

test('results never depend on bars after the signal (no look-ahead)', () => {
  let p = 50;
  const closes = Array.from({ length: 300 }, (_, i) => (p *= 1 + Math.sin(i / 5) * 0.03));
  const bars = fromCloses(closes);
  const full = Backtest.run(bars, 'ema_cross', {});
  // Cutting the history after a closed trade must not change that trade
  const t = full.trades.find(x => x.reason === 'signal' && x.exitTime < 250 * DAY);
  const cut = Backtest.run(bars.slice(0, t.exitTime / DAY + 1), 'ema_cross', {});
  const same = cut.trades.find(x => x.entryTime === t.entryTime);
  assert.equal(same.exitTime, t.exitTime);
  assert.equal(same.exitPrice, t.exitPrice);
});

test('buy and hold and the summary figures', () => {
  const bars = fromCloses([100, 110, 121, 133.1, 146.41]);
  const r = Backtest.run(bars, 'bollinger', { params: { period: 2, k: 2 }, commission: 0.01 });
  assert.ok(r.ok);
  // Bought at the open of the first tradable bar, held to the last close, commission both ways
  near(r.stats.bhReturn, (146.41 / bars[r.start].open) * 0.99 * 0.99 - 1, 1e-12, 'buy and hold');
  // Steady rise, never below the lower band: no trades, money stays in cash
  assert.equal(r.stats.trades, 0);
  assert.equal(r.stats.totalReturn, 0);
  assert.equal(r.stats.winRate, null);
  assert.equal(Backtest.maxDrawdown([{ value: 100 }, { value: 120 }, { value: 90 }, { value: 130 }]), 90 / 120 - 1);
});

test('inputs are clamped to their limits and too little history is reported', () => {
  assert.deepEqual(Backtest.cleanParams('sma_cross', { fast: 0, slow: 'x' }), { fast: 2, slow: 50 });
  assert.deepEqual(Backtest.cleanParams('bollinger', { period: 20.6, k: 2.25 }), { period: 21, k: 2.25 });
  const r = Backtest.run(fromCloses([1, 2, 3, 4, 5]), 'sma_cross', {});
  assert.equal(r.ok, false);
  assert.ok(r.reason);
  assert.throws(() => Backtest.run([], 'nope', {}));
});

test('a formula strategy trades like the built-in one it spells out', () => {
  let p = 100;
  const bars = fromCloses(Array.from({ length: 300 }, (_, i) => (p *= 1 + Math.sin(i / 6) * 0.02)));
  const built = Backtest.run(bars, 'sma_cross', { params: { fast: 5, slow: 20 } });
  const written = Backtest.run(bars, 'formula', { formula: { entry: 'crossover(sma(close, 5), sma(close, 20))', exit: 'crossunder(sma(close, 5), sma(close, 20))' } });
  assert.ok(built.trades.length > 2);
  assert.deepEqual(written.trades, built.trades);
  // A mistake in the text is reported, not thrown
  const bad = Backtest.run(bars, 'formula', { formula: { entry: 'sma(close, 5)', exit: 'close > 1' } });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /^Giriş formülü: .*koşul/);
});

test('the page loads the backtester after the indicators', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const at = file => html.indexOf(`<script src="assets/js/${file}"`);
  assert.ok(at('indicators.js') > 0 && at('indicators.js') < at('backtest.js'));
  assert.ok(at('indicators.js') < at('formula.js') && at('formula.js') < at('backtest.js'));
  assert.ok(at('backtest.js') < at('backtest-ui.js'));
});
