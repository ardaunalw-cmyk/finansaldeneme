// Unit tests for the portfolio calculations of the profile page (assets/js/portfolio.js).
//
//   npm test
//
// Small hand-made transaction lists and price series with answers you can work out on paper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../assets/js/portfolio.js');

const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} != ${expected} ± ${tol}`);
const buy = (code, qty, price, date, fee = 0) => ({ type: 'buy', code, qty, price, date, fee });
const sell = (code, qty, price, date, fee = 0) => ({ type: 'sell', code, qty, price, date, fee });

/* ---------- positions ---------- */

test('average cost: buys average in, a sale books profit and keeps the average', () => {
  const [p] = P.positions([
    buy('THYAO', 100, 300, '2026-01-10', 30),
    buy('THYAO', 100, 340, '2026-02-10', 34),
    sell('THYAO', 50, 400, '2026-03-10', 20)
  ]);
  // Cost 30000+30 + 34000+34 = 64064 for 200 shares -> 320.32 a share
  near(p.realized, 50 * 400 - 20 - 50 * 320.32, 1e-9, 'realized');
  assert.equal(p.qty, 150);
  near(p.avgCost, 320.32, 1e-9, 'average cost after the sale');
  near(p.cost, 150 * 320.32, 1e-9, 'cost of what is left');
  assert.equal(p.trades, 3);
});

test('trades are applied in date order whatever order they were entered in', () => {
  const [p] = P.positions([sell('ASELS', 10, 60, '2026-05-01'), buy('ASELS', 10, 50, '2026-04-01')]);
  assert.equal(p.qty, 0);
  near(p.realized, 100, 1e-9, 'realized');
});

test('a sale larger than the holding is capped, and a sold-out holding starts over', () => {
  const [p] = P.positions([buy('X', 10, 5, '2026-01-01'), sell('X', 25, 6, '2026-01-02'), buy('X', 4, 8, '2026-02-01')]);
  near(p.realized, 10, 1e-9, 'only the 10 held shares count');
  assert.equal(p.qty, 4);
  assert.equal(p.avgCost, 8);
  assert.equal(p.first, '2026-02-01');
});

test('heldOn counts trades up to and including the day', () => {
  const txs = [buy('A', 10, 1, '2026-01-05'), sell('A', 4, 1, '2026-01-07')];
  assert.equal(P.heldOn(txs, 'A', '2026-01-04'), 0);
  assert.equal(P.heldOn(txs, 'A', '2026-01-05'), 10);
  assert.equal(P.heldOn(txs, 'A', '2026-01-07'), 6);
  assert.equal(P.heldOn(txs, 'B', '2026-01-07'), 0);
});

/* ---------- valuation ---------- */

test('valuation, weights and the unpriced list', () => {
  const pos = P.positions([buy('A', 10, 10, '2026-01-01'), buy('B', 5, 20, '2026-01-01'), buy('C', 1, 1, '2026-01-01')]);
  const v = P.valuate(pos, { A: 15, B: 10 });
  assert.equal(v.total, 150 + 50);
  assert.equal(v.cost, 100 + 100);
  assert.equal(v.pnl, 0);
  assert.deepEqual(v.rows.map(r => r.code), ['A', 'B', 'C']);
  assert.equal(v.rows[0].weight, 75);
  assert.equal(v.rows[0].pnlPct, 50);
  assert.equal(v.rows[2].value, null);
  assert.deepEqual(v.unpriced, ['C']);
});

test('group weights and concentration', () => {
  const rows = [{ code: 'A', value: 50, s: 'X' }, { code: 'B', value: 30, s: 'Y' }, { code: 'C', value: 20, s: 'X' }];
  const g = P.groupWeights(rows, r => r.s);
  assert.deepEqual(g.map(x => [x.key, x.weight]), [['X', 70], ['Y', 30]]);
  assert.deepEqual(g[0].codes, ['A', 'C']);
  const c = P.concentration([50, 30, 20]);
  near(c.hhi, 0.38, 1e-12, 'HHI');
  near(c.effective, 1 / 0.38, 1e-12, 'effective holdings');
  assert.equal(c.largest, 50);
  assert.equal(P.concentration([25, 25, 25, 25]).effective, 4);
});

test('look-through multiple is value over the earnings the holdings stand for', () => {
  // 100 at P/E 10 (earnings 10) and 100 at P/E 20 (earnings 5): 200 / 15
  const r = P.lookThrough([{ value: 100, multiple: 10 }, { value: 100, multiple: 20 }, { value: 50, multiple: NaN }]);
  near(r.multiple, 200 / 15, 1e-12, 'portfolio P/E');
  assert.equal(r.coverage, 80);
  assert.equal(P.lookThrough([]).multiple, null);
  assert.equal(P.weightedAvg([{ value: 1, x: 8 }, { value: 3, x: 4 }, { value: 5, x: null }]), 5);
});

/* ---------- dividends ---------- */

test('dividends go to the shares held the day before the ex-date', () => {
  const txs = [buy('A', 100, 10, '2025-03-01'), buy('A', 50, 10, '2025-06-10'), sell('A', 150, 12, '2026-02-01')];
  const divs = { A: [['2025-06-10', 1], ['2025-06-11', 0.5], ['2026-03-01', 2]] };
  const r = P.dividendsReceived(txs, divs, '2026-10-01');
  // 06-10: 100 held on 06-09; 06-11: 150 held on 06-10; 2026-03-01: sold out
  assert.deepEqual(r.items.map(i => [i.date, i.qty]), [['2025-06-11', 150], ['2025-06-10', 100]]);
  assert.equal(r.total, 100 + 75);
});

test('trailing income uses the last 12 months of payments and today\'s quantity', () => {
  const rows = [{ code: 'A', qty: 10 }, { code: 'B', qty: 5 }];
  const divs = { A: [['2025-09-01', 3], ['2026-04-01', 1], ['2026-09-01', 2]], B: [['2024-01-01', 9]] };
  const r = P.trailingIncome(rows, divs, '2026-10-01');
  assert.deepEqual(r.byCode, { A: 30 });
  assert.equal(r.total, 30);
});

/* ---------- long-term series ---------- */

const MON = Date.UTC(2021, 0, 4);   // a Monday
const W = 7 * 864e5;
const series = closes => ({ t: closes.map((_, i) => MON + i * W + 7 * 3600e3), c: closes });

test('weekKey is the Monday of the Istanbul week', () => {
  assert.equal(P.weekKey(Date.UTC(2021, 0, 6, 12)), '2021-01-04');   // Wednesday
  assert.equal(P.weekKey(Date.UTC(2021, 0, 10, 22)), '2021-01-11');  // Sunday 22:00 UTC is Monday 01:00 in Istanbul
  assert.equal(P.weekly(series([1, 2, 3])).get('2021-01-11'), 2);
});

test('blended index averages member returns and lets late members join', () => {
  const a = P.weekly(series([100, 110, 121]));
  const b = P.weekly({ t: [MON + W, MON + 2 * W], c: [50, 40] });
  const idx = P.blendIndex([a, b]);
  // Week 1: only A (+10%); week 2: A +10%, B -20% -> average -5%
  assert.deepEqual(idx.keys, ['2021-01-04', '2021-01-11', '2021-01-18']);
  near(idx.values[1], 110, 1e-9, 'week 1');
  near(idx.values[2], 110 * 0.95, 1e-9, 'week 2');
  const weighted = P.blendIndex([a, b], [3, 1]);
  near(weighted.values[2], 110 * (1 + (3 * 0.1 + 1 * -0.2) / 4), 1e-9, 'weighted week 2');
});

test('deflate turns a TL index into a USD one', () => {
  const idx = { keys: ['2021-01-04', '2021-01-11'], values: [100, 120] };
  const usd = new Map([['2021-01-04', 7], ['2021-01-11', 8.4]]);
  const r = P.deflate(idx, usd);
  near(r.values[1], 100, 1e-9, 'a 20% rise eaten by a 20% weaker lira');
});

test('series stats: returns by period, annual growth, drawdown, volatility', () => {
  // 5 years + a bit of steady 10% a year growth, one dip
  const weeks = 5 * 52 + 4;
  const closes = Array.from({ length: weeks }, (_, i) => 100 * 1.1 ** (i / 52.18));
  closes[100] = closes[99] * 0.8;
  const idx = P.blendIndex([P.weekly(series(closes))]);
  const s = P.seriesStats(idx);
  near(s.r1, 10, 0.3, '1y');
  near(s.r3, 33.1, 1, '3y');
  near(s.r5, 61.05, 1.5, '5y');
  near(s.cagr, 10, 0.3, 'annual growth');
  near(s.maxDD, -20, 0.1, 'drawdown');
  assert.ok(s.vol > 0);
  const short = P.seriesStats(P.blendIndex([P.weekly(series([1, 2, 3]))]));
  assert.equal(short.r1, null);
  assert.equal(short.cagr, null);
});

/* ---------- sector snapshot ---------- */

test('sector medians leave out what cannot be computed', () => {
  const f = P.sectorFundamentals([
    { equity: 100, netIncome: 20, revenue: 200, ebitda: 40, netDebt: 80 },
    { equity: 100, netIncome: -10, revenue: 100, ebitda: 10, netDebt: 10 },
    { equity: -5, netIncome: 5, revenue: 0, ebitda: -1, netDebt: 5 }
  ]);
  assert.equal(f.n, 3);
  assert.equal(f.roe, 5);            // median of 20 and -10
  assert.equal(f.netMargin, 0);      // median of 10 and -10
  assert.equal(f.netDebtEbitda, 1.5);
  near(f.profitable, 200 / 3, 1e-9, 'profitable share');
  const b = P.sectorBreadth([{ m3: 5, s200: 2, hi52: -10 }, { m3: -5, s200: -1, hi52: -30 }, { m3: 1, s200: null, hi52: -20 }]);
  assert.equal(b.above200, 50);
  assert.equal(b.m3, 1);
  assert.equal(b.hi52, -20);
});

/* ---------- commands ---------- */

test('buy and sell commands with optional price and date', () => {
  assert.deepEqual(P.parseCommand('al THYAO 100'), { ok: true, action: 'buy', code: 'THYAO', qty: 100, price: null, date: null });
  assert.deepEqual(P.parseCommand('/sat thyao 50 312,50 2026-10-01'), { ok: true, action: 'sell', code: 'THYAO', qty: 50, price: 312.5, date: '2026-10-01' });
  assert.equal(P.parseCommand('AL asels 10 ₺1.234,5').price, 1234.5);
  assert.equal(P.parseCommand('al THYAO').ok, false);
  assert.equal(P.parseCommand('al THYAO 10 abc').ok, false);
  assert.equal(P.parseCommand('al T 10').ok, false);
});

test('other commands, Turkish and ASCII spellings, and a bare code', () => {
  assert.deepEqual(P.parseCommand('alarm TUPRS 180'), { ok: true, action: 'alarm', code: 'TUPRS', target: 180 });
  assert.deepEqual(P.parseCommand('kiyas eregl krdmd'), { ok: true, action: 'compare', codes: ['EREGL', 'KRDMD'] });
  assert.deepEqual(P.parseCommand('İZLE asels'), { ok: true, action: 'watch', code: 'ASELS' });
  assert.deepEqual(P.parseCommand('not FROTO uzun vade, ihracat'), { ok: true, action: 'note', code: 'FROTO', text: 'uzun vade, ihracat' });
  assert.deepEqual(P.parseCommand('bimas'), { ok: true, action: 'open', code: 'BIMAS' });
  assert.equal(P.parseCommand('bilanço SISE').action, 'balance');
  assert.equal(P.parseCommand('yardım').action, 'help');
  assert.equal(P.parseCommand('portföy').action, 'portfolio');
  assert.equal(P.parseCommand('uç THYAO').ok, false);
  assert.equal(P.parseCommand('').ok, false);
});

test('new commands: levels, weights, cash, journal, tabs and portfolios', () => {
  assert.deepEqual(P.parseCommand('stop THYAO 250'), { ok: true, action: 'stop', code: 'THYAO', price: 250 });
  assert.deepEqual(P.parseCommand('hedef thyao sil'), { ok: true, action: 'target', code: 'THYAO', price: null });
  assert.equal(P.parseCommand('hedef THYAO').ok, false);
  assert.deepEqual(P.parseCommand('ağırlık THYAO %20'), { ok: true, action: 'weight', code: 'THYAO', weight: 20 });
  assert.equal(P.parseCommand('agirlik THYAO 120').ok, false);
  assert.deepEqual(P.parseCommand('nakit 5000'), { ok: true, action: 'cash', amount: 5000, delta: false });
  assert.deepEqual(P.parseCommand('nakit +1000'), { ok: true, action: 'cash', amount: 1000, delta: true });
  assert.deepEqual(P.parseCommand('nakit -500'), { ok: true, action: 'cash', amount: -500, delta: true });
  assert.equal(P.parseCommand('nakit abc').ok, false);
  assert.deepEqual(P.parseCommand('günlük THYAO bilanço iyi geldi'), { ok: true, action: 'journal', code: 'THYAO', text: 'bilanço iyi geldi' });
  assert.deepEqual(P.parseCommand('gunluk piyasa sakin'), { ok: true, action: 'journal', code: null, text: 'piyasa sakin' });
  assert.deepEqual(P.parseCommand('performans'), { ok: true, action: 'tab', tab: 'performance' });
  assert.deepEqual(P.parseCommand('portföy Temettü sepeti'), { ok: true, action: 'portfolio', name: 'Temettü sepeti' });
  assert.equal(P.parseCommand('gizle').hide, true);
  assert.equal(P.parseCommand('rapor').action, 'report');
  assert.equal(P.parseCommand('geri al').action, 'undo');
});

/* ---------- the portfolio's own history ---------- */

const wk = (...pairs) => new Map(pairs);

test('value history: holdings at each week close and the net money put in', () => {
  const txs = [buy('A', 10, 10, '2021-01-05'), buy('A', 10, 12, '2021-01-13'), sell('A', 5, 15, '2021-01-20')];
  const closes = { A: wk(['2021-01-04', 11], ['2021-01-11', 12], ['2021-01-18', 15]) };
  const h = P.valueHistory(txs, closes, '2021-01-20');
  assert.deepEqual(h.keys, ['2021-01-04', '2021-01-11', '2021-01-18']);
  assert.deepEqual(h.value, [110, 240, 225]);
  assert.deepEqual(h.invested, [100, 220, 145]);
  assert.deepEqual(h.flow, [100, 120, -75]);
  const t = P.twrIndex(h);
  // Buys count from the start of their week, sales at its end
  near(t.values[0], 110, 1e-9, 'week 1');
  near(t.values[1], 110 * (1 + 10 / 230), 1e-9, 'week 2');
  near(t.values[2], 110 * (1 + 10 / 230) * 1.25, 1e-9, 'week 3');
});

test('a stock without a close yet is valued at its trade price', () => {
  const h = P.valueHistory([buy('NEW', 4, 25, '2021-01-06')], { NEW: new Map() }, '2021-01-12');
  assert.deepEqual(h.value, [100, 100]);
  assert.deepEqual(P.twrIndex(h).values, [100, 100]);
});

test('XIRR of simple flows', () => {
  near(P.xirr([{ date: '2021-01-01', amount: -100 }, { date: '2022-01-01', amount: 110 }]), 10, 1e-6, 'one year');
  near(P.xirr([{ date: '2021-01-01', amount: -100 }, { date: '2023-01-01', amount: 121 }]), 10, 0.02, 'two years');
  assert.equal(P.xirr([{ date: '2021-01-01', amount: -100 }]), null);
  const f = P.cashFlows([buy('A', 10, 10, '2021-01-01', 1), sell('A', 4, 12, '2021-06-01', 1)], [{ date: '2021-03-01', cash: 5 }], 80, '2022-01-01');
  assert.deepEqual(f.map(x => x.amount), [-101, 5, 47, 80]);
});

test('replay moves the same money into a benchmark', () => {
  const keys = ['2021-01-04', '2021-01-11'];
  const price = wk(['2021-01-04', 10], ['2021-01-11', 20]);
  const v = P.replay([buy('A', 10, 10, '2021-01-05'), sell('A', 5, 15, '2021-01-12')], price, keys);
  // 100 TL buys 10 units; the 75 TL sale sells 3.75 units at 20
  assert.deepEqual(v, [100, 125]);
  assert.deepEqual(P.carried(wk(['2021-01-04', 1]), ['2020-12-28', '2021-01-04', '2021-01-11']), [null, 1, 1]);
  assert.equal(P.times(wk(['k', 2000]), wk(['k', 8]), 1 / 31.1035).get('k'), 2000 * 8 / 31.1035);
});

/* ---------- risk ---------- */

const zig = n => Array.from({ length: n }, (_, i) => 100 * (1 + 0.03 * Math.sin(i)) * 1.01 ** i);
const keysOf = n => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2021, 0, 4) + i * 7 * 864e5).toISOString().slice(0, 10));

test('correlations, beta and drawdown', () => {
  const ks = keysOf(30), a = zig(30);
  const A = new Map(ks.map((k, i) => [k, a[i]]));
  const B = new Map(ks.map((k, i) => [k, a[i] * 2]));
  const C = new Map(ks.map((k, i) => [k, 10000 / a[i]]));
  const c = P.correlations([A, B, C]);
  near(c.values[0][1], 1, 1e-9, 'same moves');
  near(c.values[0][2], -1, 1e-9, 'opposite moves');
  assert.equal(c.weeks, 29);
  const r = P.riskVs({ keys: ks, values: a.map(x => x * 3) }, A);
  near(r.beta, 1, 1e-9, 'beta');
  near(r.corr, 1, 1e-9, 'correlation');
  assert.ok(r.vol > 0 && r.maxDD <= 0);
  assert.equal(P.riskVs({ keys: ks.slice(0, 5), values: a.slice(0, 5) }, A), null);
});

test('monthly returns use the last week of each month', () => {
  const idx = { keys: ['2021-01-04', '2021-01-11', '2021-01-18', '2021-01-25', '2021-02-01'], values: [100, 105, 110, 120, 132] };
  const m = P.monthlyReturns(idx);
  assert.deepEqual(Object.keys(m), ['2021']);
  near(m['2021']['02'], 10, 1e-9, 'February');
  assert.equal(m['2021']['01'], undefined);
});

/* ---------- planning ---------- */

test('rebalance to target weights, with and without selling', () => {
  const rows = [{ code: 'A', value: 600 }, { code: 'B', value: 400 }];
  const full = P.rebalance(rows, { A: 50, B: 50 }, { A: 10, B: 20 });
  assert.deepEqual(full.rows.map(r => [r.code, r.shares, r.trade]), [['A', -10, -100], ['B', 5, 100]]);
  assert.equal(full.buy, 100);
  assert.equal(full.sell, 100);
  const withFree = P.rebalance([...rows, { code: 'C', value: 1000 }], { A: 50, B: 50 }, { A: 10, B: 20, C: 1 });
  assert.equal(withFree.rows.find(r => r.code === 'C').trade, 0);
  assert.equal(withFree.rows.find(r => r.code === 'B').trade, 100);
  const buyOnly = P.rebalance(rows, { A: 50, B: 50 }, { A: 10, B: 20 }, 100, 'buy');
  assert.deepEqual(buyOnly.rows.map(r => [r.code, r.trade]), [['A', 0], ['B', 100]]);
  assert.equal(buyOnly.left, 0);
  const odd = P.rebalance(rows, { A: 50, B: 50 }, { A: 10, B: 30 }, 100, 'buy');
  assert.equal(odd.rows.find(r => r.code === 'B').trade, 90);
  assert.equal(odd.left, 10);
  const fresh = P.rebalance([], { X: 100 }, { X: 50 }, 1000, 'buy');
  assert.equal(fresh.rows[0].shares, 20);
});

test('goal plan with and without growth and inflation', () => {
  const flat = P.goalPlan({ now: 1000, monthly: 100, rate: 0, years: 1, target: 2200, inflation: 0 });
  near(flat.fv, 2200, 1e-9, 'saved');
  near(flat.need, 100, 1e-9, 'needed monthly');
  assert.equal(flat.reach, 12);
  const grow = P.goalPlan({ now: 1000, monthly: 0, rate: 12, years: 1, target: 1000, inflation: 12 });
  near(grow.fv, 1120, 1e-9, 'a year at 12%');
  near(grow.real, 1000, 1e-9, 'in today\'s money');
  near(grow.targetNominal, 1120, 1e-9, 'target grows with prices');
  assert.equal(grow.path.length, 2);
});

test('dividend forecast repeats last year\'s payments a year later', () => {
  const divs = { A: [['2025-10-01', 5], ['2025-11-05', 2], ['2026-04-10', 1]] };
  const f = P.dividendForecast([{ code: 'A', qty: 10 }], divs, '2026-10-23');
  assert.equal(f.months[0].key, '2026-10');
  assert.equal(f.months.length, 12);
  assert.equal(f.months.find(m => m.key === '2026-11').total, 20);
  assert.equal(f.months.find(m => m.key === '2027-04').total, 10);
  assert.equal(f.total, 30);
});

test('CSV import: header, Turkish numbers and dates, bad lines reported', () => {
  const bom = String.fromCharCode(0xfeff);
  const r = P.parseCsv(`${bom}tarih;tur;kod;adet;fiyat;komisyon\r\n2026-01-05;alis;THYAO;100;280,50;5\r\n15.02.2026;satış;thyao;50;300\r\n2026-03-01;xx;THYAO;1;1\r\n`);
  assert.deepEqual(r.txs, [
    { date: '2026-01-05', type: 'buy', code: 'THYAO', qty: 100, price: 280.5, fee: 5 },
    { date: '2026-02-15', type: 'sell', code: 'THYAO', qty: 50, price: 300, fee: 0 }
  ]);
  assert.deepEqual(r.errors, [4]);
  assert.equal(P.parseCsv('2026-01-05,buy,ASELS,10,150.5').txs[0].price, 150.5);
});
