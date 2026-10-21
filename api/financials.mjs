// Vercel serverless function: GET /api/financials?symbol=THYAO
//
// Real balance-sheet figures for non-financial BIST companies, taken from Is Yatirim's public
// "MaliTablo" JSON (a compilation of the companies' KAP financial reports, TMS 29 inflation
// adjusted, consolidated). Returns raw TL figures; the browser combines them with the live
// price to get F/K, PD/DD, FD/FAVOK, ROE etc.
//
// Not covered yet: banks and other financial companies (different statement layout), and
// companies Is Yatirim has no data for. Those return { available: false } and the UI keeps
// showing sample data for them.

const BASE = 'https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo';
const GROUP = 'XI_29';           // consolidated, TMS 29 (industrial / service companies)
const BANK_GROUP = 'UFRS_K';     // only used to tell banks apart from "no data"
const CACHE_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20000;   // Is Yatirim can take 10+ seconds on a cold request

const cache = new Map();         // symbol -> { at, data }
let latestGuess = null;          // newest period that returned data for some company

async function getTable(symbol, group, year, period) {
  const q = new URLSearchParams({
    companyCode: symbol, exchange: 'TRY', financialGroup: group,
    year1: year, period1: period,          // latest period (YTD)
    year2: year - 1, period2: 12,          // previous full year
    year3: year - 1, period3: period,      // same period last year
    year4: year - 1, period4: 9
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE}?${q}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return j.ok && Array.isArray(j.value) ? j.value : null;   // [] = period not published
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Candidate (year, period) pairs, newest first, starting from the last quarter that has ended
function candidatePeriods(now = new Date()) {
  const out = [];
  let y = now.getUTCFullYear();
  let p = [3, 6, 9, 12].filter(m => m <= now.getUTCMonth() + 1 - 0).pop();
  if (!p) { y -= 1; p = 12; }
  for (let i = 0; i < 6; i++) {
    out.push([y, p]);
    if (p === 3) { y -= 1; p = 12; } else p -= 3;
  }
  return out;
}

const num = v => {
  const n = Number(v);
  return v == null || v === '' || Number.isNaN(n) ? null : n;
};

function reader(rows) {
  const byCode = new Map(rows.map(r => [r.itemCode, r]));
  // col: 1 = latest YTD, 2 = previous FY, 3 = same period last year
  return (code, col) => num(byCode.get(code)?.[`value${col}`]) ?? 0;
}

function build(symbol, rows, year, period) {
  const get = reader(rows);

  // Income / cash-flow lines are cumulative within a year, so last twelve months =
  // latest YTD + previous FY - same YTD a year earlier.
  const ttm = code => period === 12 ? get(code, 1) : get(code, 1) + get(code, 2) - get(code, 3);

  const opProfit = ttm('3DF');
  const amort = ttm('4B');
  const finDebt = get('2AA', 1) + get('2BA', 1);
  const cash = get('1AA', 1) + get('1AB', 1);

  return {
    available: true,
    symbol,
    source: 'İş Yatırım (KAP finansal raporları)',
    basis: 'Konsolide, TMS 29 enflasyon düzeltmeli',
    period: `${year}/${period}`,
    shares: get('2OA', 1),                 // paid-in capital in TL; BIST par value is 1 TL
    equity: get('2O', 1),                  // equity attributable to parent
    totalAssets: get('1BL', 1),
    finDebt,
    cash,
    netDebt: finDebt - cash,
    ttm: {
      revenue: ttm('3C'),
      grossProfit: ttm('3D'),
      operatingProfit: opProfit,
      ebitda: opProfit + amort,
      netIncome: ttm('3Z')
    }
  };
}

/** Bank layout: 1Z total assets, 2O equity (2OVA minority), 3ZA group net income, 3CE total operating income. */
function buildBank(symbol, rows, year, period) {
  const get = reader(rows);
  const ttm = code => period === 12 ? get(code, 1) : get(code, 1) + get(code, 2) - get(code, 3);
  return {
    available: true,
    kind: 'bank',
    symbol,
    source: 'İş Yatırım (KAP finansal raporları)',
    basis: 'Konsolide, banka (UFRS) formatı',
    period: `${year}/${period}`,
    shares: get('2OA', 1),
    equity: get('2O', 1) - get('2OVA', 1),
    totalAssets: get('1Z', 1),
    finDebt: 0,
    cash: 0,
    netDebt: 0,                             // not meaningful for banks
    ttm: {
      revenue: ttm('3CE'),                  // total operating income
      grossProfit: ttm('3C'),               // net interest income
      operatingProfit: ttm('3CH'),          // net operating profit
      ebitda: 0,                            // not defined for banks
      netIncome: ttm('3ZA')
    }
  };
}
export async function load(symbol) {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  let data = { available: false, reason: 'no-data', symbol };
  const periods = candidatePeriods().slice(0, 3);
  if (latestGuess && !periods.some(([y, p]) => y === latestGuess[0] && p === latestGuess[1])) periods.unshift(latestGuess);

  // Ask for the newest few periods at once; the newest one that is published wins
  const tables = await Promise.all(periods.map(async ([year, period]) =>
    (await getTable(symbol, GROUP, year, period)) ?? (await getTable(symbol, GROUP, year, period))));
  for (let i = 0; i < periods.length; i++) {
    const rows = tables[i];
    if (rows && rows.length && num(rows.find(r => r.itemCode === '1BL')?.value1)) {
      const [year, period] = periods[i];
      data = build(symbol, rows, year, period);
      if (!latestGuess || year * 100 + period > latestGuess[0] * 100 + latestGuess[1]) latestGuess = [year, period];
      break;
    }
  }
  if (!data.available) {
    // Banks use a different statement layout (UFRS_K): totals are 1Z (assets) and 2O (equity)
    const bankTables = await Promise.all(periods.map(async ([year, period]) =>
      (await getTable(symbol, BANK_GROUP, year, period)) ?? (await getTable(symbol, BANK_GROUP, year, period))));
    let sawRows = false;
    for (let i = 0; i < periods.length; i++) {
      const rows = bankTables[i];
      if (rows && rows.length) sawRows = true;
      if (rows && rows.length && num(rows.find(r => r.itemCode === '1Z')?.value1) && num(rows.find(r => r.itemCode === '3CE')?.value1) != null) {
        const [year, period] = periods[i];
        data = buildBank(symbol, rows, year, period);
        break;
      }
    }
    if (!data.available && sawRows) data = { available: false, reason: 'financial-company', symbol };
  }

  // Implausible capital/equity (share classes with no statements of their own) counts as no data
  if (data.available && !(data.shares >= 1e6 && data.equity > 0)) data = { available: false, reason: 'no-data', symbol };

  cache.set(symbol, { at: Date.now(), data });
  return data;
}

export default async function handler(req, res) {
  const send = (status, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(JSON.stringify(body));
  };

  if (req.method !== 'GET') return send(405, { error: 'Method not allowed' });

  const symbol = (new URL(req.url, 'http://x').searchParams.get('symbol') || '').toUpperCase().trim();
  if (!/^[A-Z0-9]{2,6}$/.test(symbol)) return send(400, { error: 'valid symbol is required' });

  const data = await load(symbol);
  return send(200, data, { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' });
}
