// Unit tests for the financial calculations (assets/js/calc.js, assets/js/verity-score.js).
//
//   npm test
//
// Fixtures are the real statement files in assets/data/statements. Expected values pin the
// current results for a few well-known companies, so an accidental formula change shows up here;
// invariants are checked over every statement file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const Calc = require('../assets/js/calc.js');

const STATEMENTS = new URL('../assets/data/statements/', import.meta.url);
const load = code => Calc.fromFile(JSON.parse(readFileSync(new URL(`${code}.json`, STATEMENTS), 'utf8')));
const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} != ${expected} ± ${tol}`);

/* ---------- statement helpers ---------- */

test('fromFile scales by unit and detects the statement kind', () => {
  const d = Calc.fromFile({ unit: 1000, periods: ['2026/6'], rows: [['1Z', 'Toplam', 0, 5], ['3CE', 'Faaliyet', 0, 2]] });
  assert.equal(d.kind, 'bank');
  assert.equal(Calc.val(d, '1Z'), 5000);
  assert.equal(Calc.val(d, 'MISSING'), 0);
});

test('ttm adds the last fiscal year and removes the same period a year earlier', () => {
  // Periods newest first: H1 2026, Q1 2026, FY 2025, 9M 2025, H1 2025
  const d = Calc.fromFile({ periods: ['2026/6', '2026/3', '2025/12', '2025/9', '2025/6'], rows: [['3C', 'Satış', 0, 60, 25, 100, 70, 45]] });
  assert.equal(Calc.ttm(d, '3C'), 60 + 100 - 45);
  // A fiscal year end is already twelve months
  const fy = Calc.fromFile({ periods: ['2025/12', '2025/9', '2025/6', '2025/3', '2024/12'], rows: [['3C', 'Satış', 0, 100, 70, 45, 20, 90]] });
  assert.equal(Calc.ttm(fy, '3C'), 100);
});

/* ---------- Finansal Sağlık ratio set ---------- */

test('health ratios reproduce the course deck cases', () => {
  // One fiscal-year period built from the deck's mini cases (ABC Tekstil, XYZ, KMY Lojistik)
  const d = Calc.fromFile({ periods: ['2025/12'], rows: [
    ['1A', 'Dönen', 0, 400000], ['2A', 'KVYK', 0, 700000], ['1AF', 'Stok', 0, 850000], ['1AA', 'Nakit', 0, 50000],
    ['1AC', 'Alacak', 0, 100000], ['3C', 'Satış', 0, 1200000], ['3CA', 'SMM', 0, -900000],
    ['3DF', 'Faaliyet', 0, 2000000], ['3HC', 'Fin. gider', 0, -1800000], ['2B', 'UVYK', 0, 7300000],
    ['2N', 'Özkaynak', 0, 2000000], ['2O', 'Ana ort.', 0, 2000000], ['3Z', 'Net kâr', 0, 200000], ['2OA', 'Sermaye', 0, 100000]
  ] });
  const r = Calc.healthRatios(d, 0);
  near(r.current, 0.57, 0.005, 'cari oran');
  near(r.inventoryTurnover, 900000 / 850000, 1e-9, 'stok devir hızı (ortalama yok: dönem sonu stok)');
  near(r.inventoryDays, 345, 1, 'stok tüketim süresi');
  near(r.debtToEquity, 4, 1e-9, 'borç / özkaynak');
  near(r.interestCover, 2000000 / 1800000, 1e-9, 'faiz karşılama');
  near(r.receivableTurnover, 12, 1e-9, 'alacak devir hızı');
  near(r.eps, 2, 1e-9, 'hisse başına kâr');
  assert.equal(r.ttm, false);
});

test('health ratios on real statements', () => {
  const r = Calc.healthRatios(load('ASELS'), 0);
  assert.equal(r.ttm, true);
  near(r.current, 248765565 / 169003469, 1e-9, 'ASELS cari oran');
  assert.ok(r.inventoryTurnover > 0 && r.grossMargin > 0 && r.roe > 0);
  // A quarter that is not a year end has no flows, so flow ratios are unknown
  const q = Calc.healthRatios(load('ASELS'), 1);
  assert.equal(q.netMargin, null);
  assert.ok(q.current > 0);
});

/* ---------- DuPont, Altman, Piotroski, payout on real companies ---------- */

test('DuPont of THYAO, ARCLK and AKBNK', () => {
  near(Calc.dupont(load('THYAO')).roe, 0.1306, 0.0005, 'THYAO ROE');
  near(Calc.dupont(load('ARCLK')).roe, -0.0381, 0.0005, 'ARCLK ROE');
  const bank = Calc.dupont(load('AKBNK'));
  near(bank.roe, 0.2055, 0.0005, 'AKBNK ROE');
  assert.equal(bank.revLabel, 'faaliyet geliri');
});

test("Altman Z'' values and zones", () => {
  const thy = Calc.altman(load('THYAO'));
  near(thy.z, 1.5135, 0.001, 'THYAO Z');
  assert.equal(Calc.altmanZone(thy.z), 'grey');
  assert.equal(Calc.altmanZone(Calc.altman(load('ARCLK')).z), 'distress');
  assert.equal(Calc.altmanZone(Calc.altman(load('FROTO')).z), 'safe');
  assert.equal(Calc.altman(load('AKBNK')), null, 'banks have no industrial balance sheet lines');
});

test('Piotroski scores', () => {
  const arclk = Calc.piotroski(load('ARCLK'));
  assert.equal(arclk.score, 6);
  assert.equal(arclk.known, 9);
  assert.deepEqual(arclk.tests.map(t => t[2]), [false, true, true, true, false, true, true, true, false]);
  assert.equal(Calc.piotroski(load('THYAO')).score, 5);
});

test('payout ratio from the cash flow statement', () => {
  near(Calc.payout(load('THYAO')).ratio, 4.57, 0.01, 'THYAO payout');
  near(Calc.payout(load('FROTO')).ratio, 117.14, 0.01, 'FROTO payout');
  const loss = Calc.payout(load('ARCLK'));
  assert.equal(loss.ratio, null, 'no ratio on a net loss');
  assert.ok(loss.paid > 0);
  assert.deepEqual(Calc.payout(load('ASELS')), { missing: 'no-line' });
  assert.deepEqual(Calc.payout(load('AKBNK')), { missing: 'financial' });
});

test('invariants over every statement file', () => {
  const files = readdirSync(STATEMENTS).filter(f => f.endsWith('.json'));
  assert.ok(files.length > 500, `expected the full statement set, got ${files.length}`);
  for (const f of files) {
    const d = load(f.replace('.json', ''));
    const dp = Calc.dupont(d);
    if (dp) near(dp.margin * dp.turnover * dp.leverage, dp.roe, 1e-9, `${f} DuPont product`);
    const az = Calc.altman(d);
    if (az) assert.ok(Number.isFinite(az.z), `${f} Altman finite`);
    const pf = Calc.piotroski(d);
    assert.ok(pf.score >= 0 && pf.score <= pf.known && pf.known <= 9, `${f} Piotroski range`);
    const po = Calc.payout(d);
    if (!po.missing) assert.ok(po.paid >= 0 && (po.ratio === null || po.ratio >= 0), `${f} payout sign`);
  }
});

/* ---------- market ratios ---------- */

test('ratios from price and statement summary', () => {
  const r = Calc.ratios(10, { shares: 100, equity: 500, totalAssets: 2000, netDebt: 200, ttm: { revenue: 1000, ebitda: 300, netIncome: 100 } });
  assert.equal(r.mcap, 1000);
  assert.equal(r.fk, 10);
  assert.equal(r.pddd, 2);
  assert.equal(r.fdFavok, 4);
  near(r.netDebtFavok, 0.6667, 0.0001, 'net debt / EBITDA');
  assert.equal(r.roe, 20);
  assert.equal(r.roa, 5);
  const loss = Calc.ratios(10, { shares: 100, equity: -1, totalAssets: 0, netDebt: 0, ttm: { revenue: 1, ebitda: -1, netIncome: -5 } });
  assert.ok([loss.fk, loss.pddd, loss.fdFavok, loss.roe, loss.roa].every(Number.isNaN), 'undefined ratios are NaN, not 0');
});

/* ---------- dividends ---------- */

test('dividend yields over the last 12 months and the 12 before', () => {
  const row = { p: 100, d: [['2024-11-01', 1], ['2025-06-01', 2], ['2026-03-01', 3], ['2026-09-01', 4]] };
  const s = Calc.dividendStats(row, '2026-10-22');
  assert.equal(s.count12, 2);
  assert.equal(s.count24, 4);
  near(s.yield12, 7, 1e-9, '12-month yield');
  near(s.yieldPrev, 3, 1e-9, 'previous 12-month yield');
  assert.deepEqual(s.last, { date: '2026-09-01', amount: 4 });
  assert.deepEqual(Calc.dividendStats(null, '2026-10-22'), { paid: false });
});

/* ---------- Verity score ---------- */

async function loadVerityScore(multiples) {
  const context = { window: {}, fetch: async () => ({ ok: true, json: async () => multiples }) };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../assets/js/verity-score.js', import.meta.url), 'utf8'), context);
  await context.window.VerityScore.ready();
  return context.window.VerityScore;
}

test('Verity score: a strong, cheap company scores 10 and the model value is capped', async () => {
  const VS = await loadVerityScore({ sectors: { Sanayi: { pe: 20, pb: 6, n: 20 } }, all: { pe: 8, pb: 1.5, n: 500 } });
  // ROE 30%, net margin 15%, EBITDA margin 25%, net cash, equity 50% of assets,
  // P/E 5 and P/B 1.5: a quarter of the sector medians
  const r = VS.compute({ price: 5, shares: 100, equity: 1000 / 3, totalAssets: 2000 / 3, netDebt: -50, revenue: 2000 / 3, ebitda: 500 / 3, netIncome: 100, sector: 'Sanayi' });
  assert.equal(r.score, 10);
  assert.equal(r.model.capped, true);
  near(r.model.value, 10, 1e-9, 'model value is capped at twice the price');
  assert.equal(r.model.scope, 'Sanayi');
});

test('Verity score: losses score zero on profitability and P/E; banks skip debt metrics', async () => {
  const VS = await loadVerityScore({ sectors: {}, all: { pe: 8, pb: 1.5, n: 500 } });
  const loss = VS.compute({ price: 10, shares: 100, equity: 500, totalAssets: 1000, netDebt: 0, revenue: 1000, ebitda: 50, netIncome: -20, sector: 'Sanayi' });
  const prof = loss.breakdown.parts.find(p => p.name === 'Kârlılık');
  assert.equal(prof.score, 0);
  assert.equal(loss.model.scope, 'Tüm BIST', 'falls back to all-market medians for a small sector');

  const bank = VS.compute({ price: 10, shares: 100, equity: 500, totalAssets: 6000, netDebt: 0, revenue: 300, ebitda: 0, netIncome: 100, sector: 'Bankacılık' });
  assert.equal(bank.breakdown.parts.map(p => p.name).join(','), 'Kârlılık,Değerleme');
  assert.equal(bank.breakdown.financial, true);
});

/* ---------- price series ---------- */

test('pearson: perfect, inverse and flat series', () => {
  assert.equal(Calc.pearson([1, 2, 3], [2, 4, 6]), 1);
  near(Calc.pearson([1, 2, 3], [3, 2, 1]), -1, 1e-12, 'inverse');
  assert.equal(Calc.pearson([1, 2, 3], [5, 5, 5]), null);
});

test('returnCorrelations lines series up by Istanbul day and skips days one series lacks', () => {
  const day = d => Date.parse(`2026-03-${String(d).padStart(2, '0')}T07:00:00Z`);
  const stock = { t: [2, 3, 4, 5, 6].map(day), c: [100, 110, 99, 108.9, 119.79] };
  // Same moves, but one day missing and timestamps at 21:00 UTC the evening before (Istanbul: 00:00 same day)
  const twin = { t: [2, 3, 5, 6].map(d => day(d) - 10 * 3600 * 1000), c: [50, 55, 54.45, 59.895] };
  const r = Calc.returnCorrelations([stock, twin]);
  assert.equal(r.days, 3, 'four common days give three returns');
  assert.equal(r.from, '2026-03-02');
  near(r.values[0][1], 1, 1e-9, 'identical returns on common days');
  assert.equal(r.values[1][1], 1);
});
