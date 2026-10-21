// Vercel serverless function: GET /api/statements?symbol=THYAO&exchange=TRY|USD
//
// Full consolidated statements (balance sheet, income statement, cash-flow items) for the last
// six reporting periods, taken from Is Yatirim's public "MaliTablo" JSON, which compiles the
// companies' KAP financial reports (TMS 29 inflation adjusted). Income and cash-flow lines are
// cumulative within a year (year-to-date), exactly as reported.
//
// Banks and other financial companies use a different statement layout and are not covered;
// they return { available: false, reason: 'financial-company' }.

const BASE = 'https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo';
const GROUP = 'XI_29';
const BANK_GROUP = 'UFRS_K';
const CACHE_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20000;
const PERIOD_COUNT = 6;

const cache = new Map();   // symbol|exchange -> { at, data }
let latestGuess = null;    // newest [year, period] that returned data for some company

/** n consecutive quarter-end periods going back from [year, period]. */
function periodsFrom([year, period], n) {
  const out = [];
  let y = year, p = period;
  for (let i = 0; i < n; i++) {
    out.push([y, p]);
    if (p === 3) { y -= 1; p = 12; } else p -= 3;
  }
  return out;
}

function candidateLatest(now = new Date()) {
  let y = now.getUTCFullYear();
  let p = [3, 6, 9, 12].filter(m => m <= now.getUTCMonth() + 1).pop();
  if (!p) { y -= 1; p = 12; }
  const out = [];
  let cur = [y, p];
  for (let i = 0; i < 3; i++) {
    out.push(cur);
    cur = periodsFrom(cur, 2)[1];
  }
  return out;
}

async function table(symbol, group, exchange, periods) {
  const four = [...periods, ...periods].slice(0, 4);   // the API always wants four columns
  const q = new URLSearchParams({ companyCode: symbol, exchange, financialGroup: group });
  four.forEach(([y, p], i) => { q.set(`year${i + 1}`, y); q.set(`period${i + 1}`, p); });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE}?${q}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return j.ok && Array.isArray(j.value) ? j.value : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const num = v => {
  const n = Number(v);
  return v == null || v === '' || Number.isNaN(n) ? null : n;
};

async function retry(fn) {
  return (await fn()) ?? (await fn());
}

export async function load(symbol, exchange) {
  const key = `${symbol}|${exchange}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  let data = { available: false, reason: 'no-data', symbol };

  // 1) newest published period among the last three quarter-ends (asked in parallel)
  const cands = candidateLatest();
  if (latestGuess && !cands.some(([y, p]) => y === latestGuess[0] && p === latestGuess[1])) cands.unshift(latestGuess);
  const tables = await Promise.all(cands.map(c => retry(() => table(symbol, GROUP, exchange, periodsFrom(c, 4)))));
  const hitIdx = tables.findIndex(rows => rows && rows.length && num(rows.find(r => r.itemCode === '1BL')?.value1));

  if (hitIdx >= 0) {
    const latest = cands[hitIdx];
    const all = periodsFrom(latest, PERIOD_COUNT);
    const first = tables[hitIdx];
    const second = await retry(() => table(symbol, GROUP, exchange, all.slice(4)));
    const secondBy = new Map((second || []).map(r => [r.itemCode, r]));

    const rows = [];
    for (const r of first) {
      const name = (r.itemDescTr || '').trim();
      if (!name || /^\(Ara Toplam\)/i.test(name)) continue;
      const s = secondBy.get(r.itemCode);
      const v = [r.value1, r.value2, r.value3, r.value4, s?.value1, s?.value2].map(x => num(x) ?? 0);
      if (v.every(x => x === 0)) continue;
      const lead = (r.itemDescTr || '').length - (r.itemDescTr || '').trimStart().length;
      rows.push({ c: r.itemCode, n: name, l: Math.min(2, Math.floor(lead / 2)), v });
    }

    data = {
      available: true,
      symbol,
      exchange,
      source: 'İş Yatırım (KAP finansal raporları)',
      basis: 'Konsolide, TMS 29 enflasyon düzeltmeli',
      periods: all.map(([y, p]) => `${y}/${p}`),
      rows
    };
    if (!latestGuess || latest[0] * 100 + latest[1] > latestGuess[0] * 100 + latestGuess[1]) latestGuess = latest;
  } else {
    const bank = await table(symbol, BANK_GROUP, exchange, periodsFrom(cands[1] || cands[0], 4));
    if (bank && bank.length) data = { available: false, reason: 'financial-company', symbol };
  }

  cache.set(key, { at: Date.now(), data });
  return data;
}

export default async function handler(req, res) {
  const send = (status, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'GET') return send(405, { error: 'Method not allowed' });

  const q = new URL(req.url, 'http://x').searchParams;
  const symbol = (q.get('symbol') || '').toUpperCase().trim();
  const exchange = (q.get('exchange') || 'TRY').toUpperCase();
  if (!/^[A-Z0-9]{2,6}$/.test(symbol) || !['TRY', 'USD'].includes(exchange)) return send(400, { error: 'invalid parameters' });

  return send(200, await load(symbol, exchange), { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' });
}
