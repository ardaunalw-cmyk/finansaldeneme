/**
 * Pure financial calculations shared by the page and the tests (test/calc.test.mjs).
 * No DOM, no fetch: every function takes data in and returns numbers out.
 *
 * Statement data ("d") is the shape statements.js works with:
 *   { kind: 'industrial' | 'bank' | 'insurance', periods: ['2026/6', ...], rows: [{ c, n, l, v: [...] }] }
 * Periods run newest first; flow items (income, cash flow) are year-to-date cumulative.
 */
(function (root) {
  /* ---------- statement access ---------- */

  /** Converts a static statement file (assets/data/statements/<CODE>.json) to the working shape. */
  function fromFile(j) {
    // Older files have no "kind"; banks are recognisable by total assets 1Z plus operating income 3CE
    const kind = j.kind || (j.rows.some(r => r[0] === '1Z') && j.rows.some(r => r[0] === '3CE') ? 'bank' : 'industrial');
    return {
      available: true, kind, source: j.source, basis: j.basis, periods: j.periods,
      rows: j.rows.map(([c, n, l, ...v]) => ({ c, n, l, v: v.map(x => x * (j.unit || 1)) }))
    };
  }

  const rowMap = d => d._map || (d._map = new Map(d.rows.map(r => [r.c, r])));
  const has = (d, code) => rowMap(d).has(code);
  const val = (d, code, i = 0) => rowMap(d).get(code)?.v[i] ?? 0;
  const lastP = d => parseInt(d.periods[0].split('/')[1], 10);
  /** Index of the latest full fiscal year (period ending in /12) before the newest period. */
  const prevFyIdx = d => Math.max(1, d.periods.findIndex((p, i) => i > 0 && p.endsWith('/12')));
  /** Index of the same period one year earlier (statements hold quarterly periods). */
  const LY = 4;
  /** Last twelve months of a year-to-date flow item. */
  const ttm = (d, code) => (lastP(d) === 12 ? val(d, code, 0) : val(d, code, 0) + val(d, code, prevFyIdx(d)) - val(d, code, LY));
  /** One quarter of a year-to-date flow item. */
  const flow = (d, code, i) => (parseInt(d.periods[i].split('/')[1], 10) === 3 ? val(d, code, i) : val(d, code, i) - val(d, code, i + 1));

  const isBank = d => d.kind === 'bank';
  const isIns = d => d.kind === 'insurance';
  // Premiums and claims of insurers (non-life + life)
  const premium = (d, i) => val(d, '3AA', i) + val(d, '3DAA', i);
  const claims = (d, i) => val(d, '3BA', i) + val(d, '3EA', i);

  /* ---------- financial health ---------- */

  /** ROE = net margin x asset turnover x leverage; last-twelve-months profit over the latest balance sheet. */
  function dupont(d) {
    const bank = isBank(d), ins = isIns(d);
    const ni = bank ? ttm(d, '3ZA') : ttm(d, '3Z');
    const rev = bank ? ttm(d, '3CE') : ins ? ttm(d, '3AA') + ttm(d, '3DAA') : ttm(d, '3C');
    const assets = bank || ins ? val(d, '1Z', 0) : val(d, '1BL', 0);
    const eq = bank ? val(d, '2O', 0) - val(d, '2OVA', 0) : val(d, '2O', 0);
    if (!(rev > 0 && assets > 0 && eq > 0)) return null;
    return { margin: ni / rev, turnover: rev / assets, leverage: assets / eq, roe: ni / eq, revLabel: bank ? 'faaliyet geliri' : ins ? 'prim' : 'hasılat' };
  }

  /** Altman Z'' (non-manufacturing / emerging markets): book values only, no market price. */
  function altman(d) {
    const ta = val(d, '1BL', 0);
    const liab = val(d, '2A', 0) + val(d, '2B', 0);
    if (!(ta > 0 && liab > 0)) return null;
    const x1 = (val(d, '1A', 0) - val(d, '2A', 0)) / ta;
    const x2 = (val(d, '2OCD', 0) + val(d, '2OCE', 0) + val(d, '2OCF', 0)) / ta;
    const x3 = ttm(d, '3DF') / ta;
    const x4 = val(d, '2N', 0) / liab;
    return { z: 6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4, x1, x2, x3, x4 };
  }

  /** Altman Z'' zone: > 2.60 safe, 1.10 - 2.60 grey, < 1.10 distress. */
  const altmanZone = z => (z > 2.6 ? 'safe' : z >= 1.1 ? 'grey' : 'distress');

  /**
   * Piotroski F: nine pass/fail tests. Changes compare the latest period with the same period a
   * year earlier (equal year-to-date lengths, both in current purchasing power under TMS 29).
   * A test without data is null and does not count.
   */
  function piotroski(d) {
    const v = (c, i) => val(d, c, i);
    const ta0 = v('1BL', 0), ta1 = v('1BL', LY);
    const ratio = (a, b) => (b ? a / b : null);
    const up = (a, b) => (a == null || b == null ? null : a > b);
    const niTtm = ttm(d, '3Z'), cfoTtm = ttm(d, '4C');
    const ltd0 = ratio(v('2BA', 0), ta0), ltd1 = ratio(v('2BA', LY), ta1);
    const rev = has(d, '3C') && v('3C', 0) && v('3C', LY);
    const tests = [
      ['Kârlılık', 'Son 12 ay net kâr pozitif', niTtm > 0],
      ['Kârlılık', 'Son 12 ay işletme nakit akışı pozitif', has(d, '4C') ? cfoTtm > 0 : null],
      ['Kârlılık', 'Aktif kârlılığı (ROA) yükseldi', up(ratio(v('3Z', 0), ta0), ratio(v('3Z', LY), ta1))],
      ['Kârlılık', 'Nakit akışı net kârdan büyük', has(d, '4C') ? cfoTtm > niTtm : null],
      ['Borçluluk', 'Uzun vadeli borç / aktif azaldı', !has(d, '2BA') || (ltd0 === 0 && ltd1 === 0) ? true : ltd0 < ltd1],
      ['Borçluluk', 'Cari oran yükseldi', up(ratio(v('1A', 0), v('2A', 0)), ratio(v('1A', LY), v('2A', LY)))],
      ['Borçluluk', 'Ödenmiş sermaye artmadı', v('2OA', 0) <= v('2OA', LY)],
      ['Verimlilik', 'Brüt kâr marjı yükseldi', rev && has(d, '3D') ? up(v('3D', 0) / v('3C', 0), v('3D', LY) / v('3C', LY)) : null],
      ['Verimlilik', 'Aktif devir hızı yükseldi', rev ? up(v('3C', 0) / ta0, v('3C', LY) / ta1) : null]
    ];
    return { tests, score: tests.filter(t => t[2] === true).length, known: tests.filter(t => t[2] != null).length };
  }

  /**
   * Payout: cash dividends paid (cash flow statement, incl. to minorities) / net profit for the
   * period incl. minorities, both last twelve months. Many companies report dividends inside
   * "other financing" without a separate line; those get { missing } rather than a guessed 0.
   */
  function payout(d) {
    if (!has(d, '4CBB')) return { missing: isBank(d) || isIns(d) ? 'financial' : 'no-line' };
    const paid = Math.abs(ttm(d, '4CBB'));
    const profit = has(d, '3L') ? ttm(d, '3L') : ttm(d, '3Z');
    return { paid, profit, ratio: profit > 0 ? paid / profit * 100 : null, period: d.periods[0] };
  }

  /**
   * The ratio set of the "Finansal Sağlık" tab (liquidity, activity, leverage, profitability and
   * per-share profit) at period index i, from an industrial company's statements. Flow items are
   * the last twelve months at i = 0 and the fiscal year itself at a year-end period; at any other
   * period they are unknown and so are the ratios that need them. A ratio that cannot be computed
   * (zero or negative denominator, missing flows) is null. `inputs` holds the figures behind the
   * fractions so the page can show them.
   */
  function healthRatios(d, i = 0) {
    const v = c => val(d, c, i);
    const month = parseInt(d.periods[i].split('/')[1], 10);
    const f = i === 0 ? c => ttm(d, c) : month === 12 ? c => val(d, c, i) : null;
    const q = (a, b) => (a != null && b > 0 ? a / b : null);
    // Average inventory: this period and the same period a year earlier, when both are present
    const avgStock = i + LY < d.periods.length ? (v('1AF') + val(d, '1AF', i + LY)) / 2 : null;
    const inputs = {
      current: v('1A'), shortDebt: v('2A'), longDebt: v('2B'), debt: v('2A') + v('2B'),
      stock: v('1AF'), avgStock, cash: v('1AA'), receivables: v('1AC'), assets: v('1BL'), fixed: v('1AK'),
      equity: v('2N'), parentEquity: v('2O'), permanent: v('2N') + v('2B'), shares: v('2OA'),
      sales: f && f('3C'), cogs: f && Math.abs(f('3CA')), gross: f && f('3D'), ebit: f && f('3DF'),
      netIncome: f && f('3Z'), interest: f && Math.abs(f('3HC'))
    };
    const n = inputs;
    const rt = q(n.sales, n.receivables);
    const it = q(n.cogs, avgStock ?? n.stock);
    return {
      period: d.periods[i], ttm: i === 0 && month !== 12, inputs,
      current: q(n.current, n.shortDebt),
      quick: q(n.current - n.stock, n.shortDebt),
      cash: q(n.cash, n.shortDebt),
      receivableTurnover: rt,
      collectionDays: rt ? 365 / rt : null,
      inventoryTurnover: it,
      inventoryDays: it ? 365 / it : null,
      assetTurnover: q(n.sales, n.assets),
      fixedTurnover: q(n.sales, n.fixed),
      debtRatio: q(n.debt, n.assets),
      debtToEquity: q(n.debt, n.equity),
      shortDebtShare: q(n.shortDebt, n.debt),
      // No financial expense at all: covered without limit (Infinity), shown as such
      interestCover: !f ? null : n.interest > 0 ? n.ebit / n.interest : Infinity,
      fixedToPermanent: q(n.fixed, n.permanent),
      grossMargin: q(n.gross, n.sales),
      operatingMargin: q(n.ebit, n.sales),
      netMargin: q(n.netIncome, n.sales),
      roa: q(n.netIncome, n.assets),
      roe: q(n.netIncome, n.parentEquity),
      eps: q(n.netIncome, n.shares)        // BIST par value is 1 TL, so paid-in capital = share count
    };
  }

  /* ---------- market ratios ---------- */

  /**
   * Price multiples and returns from a statement summary and a share price.
   * f: { shares, equity, totalAssets, netDebt, ttm: { revenue, ebitda, netIncome } }
   * Values that cannot be computed (loss, negative equity) are NaN.
   */
  function ratios(price, f) {
    const mcap = price * f.shares;               // BIST par value is 1 TL, so capital = share count
    const t = f.ttm;
    return {
      mcap,
      fk: t.netIncome > 0 ? mcap / t.netIncome : NaN,
      pddd: f.equity > 0 ? mcap / f.equity : NaN,
      fdFavok: t.ebitda > 0 ? (mcap + f.netDebt) / t.ebitda : NaN,
      netDebtFavok: t.ebitda > 0 ? f.netDebt / t.ebitda : NaN,
      roe: f.equity > 0 ? t.netIncome / f.equity * 100 : NaN,
      roa: f.totalAssets > 0 ? t.netIncome / f.totalAssets * 100 : NaN
    };
  }

  /* ---------- dividends ---------- */

  const DAY = 864e5;
  const isoDay = t => new Date(t).toISOString().slice(0, 10);

  /**
   * One company's cash dividends: yield over the last 12 months and the 12 months before, both
   * against the price stored with the data. row: { p: price, d: [[YYYY-MM-DD, amount], ...] }
   */
  function dividendStats(row, today) {
    if (!row || !row.d.length) return { paid: false };
    const t = Date.parse(`${today}T00:00:00Z`);
    const y1 = isoDay(t - 365 * DAY), y2 = isoDay(t - 730 * DAY);
    const sum = (from, to) => row.d.filter(([dt]) => dt > from && dt <= to).reduce((a, [, amt]) => a + amt, 0);
    const last = row.d[row.d.length - 1];
    return {
      paid: true, price: row.p,
      count12: row.d.filter(([dt]) => dt > y1 && dt <= today).length,
      count24: row.d.filter(([dt]) => dt > y2 && dt <= today).length,
      yield12: sum(y1, today) / row.p * 100,
      yieldPrev: sum(y2, y1) / row.p * 100,
      last: { date: last[0], amount: last[1] }
    };
  }

  /* ---------- price series ---------- */

  /** Pearson correlation of two equal-length arrays; null when either one does not move. */
  function pearson(a, b) {
    const n = a.length;
    if (n < 2) return null;
    const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < n; i++) {
      cov += (a[i] - ma) * (b[i] - mb);
      va += (a[i] - ma) ** 2;
      vb += (b[i] - mb) ** 2;
    }
    return va && vb ? cov / Math.sqrt(va * vb) : null;
  }

  /**
   * Correlation matrix of daily log returns. series: [{ t: [ms, ...], c: [close, ...] }, ...]
   * (the /api/history shape). Only days on which every series has a close are used, keyed by the
   * Istanbul calendar day, so stocks, the index and USD/TRY (which trades on other days) line up.
   */
  function returnCorrelations(series) {
    const TR = 3 * 3600 * 1000;
    const byDay = series.map(s => new Map(s.t.map((t, i) => [isoDay(t + TR), s.c[i]])));
    const days = [...byDay[0].keys()].filter(day => byDay.every(m => m.get(day) > 0)).sort();
    const returns = byDay.map(m => days.slice(1).map((day, i) => Math.log(m.get(day) / m.get(days[i]))));
    const values = returns.map((a, i) => returns.map((b, j) => (i === j ? 1 : pearson(a, b))));
    return { days: Math.max(0, days.length - 1), from: days[0] || null, to: days[days.length - 1] || null, values };
  }

  const Calc = {
    fromFile, rowMap, has, val, ttm, flow, prevFyIdx, LY, isBank, isIns, premium, claims,
    dupont, altman, altmanZone, piotroski, payout, healthRatios, ratios, dividendStats, pearson, returnCorrelations
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(typeof window !== 'undefined' ? window : globalThis);
