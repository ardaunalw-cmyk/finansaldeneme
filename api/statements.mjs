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

/** Indent level of a row: non-financial tables indent descriptions; bank tables number them (I., 1.1, 1.1.1). */
function levelOf(rawDesc, kind) {
  if (kind === 'bank') {
    const d = rawDesc.trim();
    if (/^\d+\.\d+\.\d+/.test(d)) return 2;
    if (/^\d+\.\d+/.test(d)) return 1;
    return 0;
  }
  if (kind === 'insurance') {
    // Totals and roman-numeral headings are top level; "A-", "B-" lines second; "1-", "1.1-" lines deeper
    const d = rawDesc.trim();
    if (/Toplamı|TOPLAMI/.test(d) || /^[IVX]+\s*-/.test(d)) return 0;
    if (/^\d+(\.\d+)+-/.test(d)) return 2;
    if (/^\d+-/.test(d)) return 2;
    return 1;
  }
  const lead = rawDesc.length - rawDesc.trimStart().length;
  return Math.min(2, Math.floor(lead / 2));
}

/** UFRS layouts share the totals 1Z / 2O: banks have 3CE (operating income), insurers have 2E (technical provisions). */
function detectKind(rows) {
  const has = code => num(rows.find(r => r.itemCode === code)?.value1) != null;
  if (has('3CE')) return 'bank';
  if (has('2E')) return 'insurance';
  return null;
}

/** Tries one statement layout (group) for the newest published period; returns data or null. */
async function tryGroup(symbol, exchange, group, totalCode, wantedKind) {
  let kind = wantedKind;
  const cands = candidateLatest();
  if (latestGuess && !cands.some(([y, p]) => y === latestGuess[0] && p === latestGuess[1])) cands.unshift(latestGuess);
  const tables = await Promise.all(cands.map(c => retry(() => table(symbol, group, exchange, periodsFrom(c, 4)))));
  const hitIdx = tables.findIndex(rows => rows && rows.length && num(rows.find(r => r.itemCode === totalCode)?.value1)
    && (wantedKind !== 'auto' || detectKind(rows)));
  if (hitIdx < 0) return { data: null, sawRows: tables.some(r => r && r.length) };
  if (wantedKind === 'auto') kind = detectKind(tables[hitIdx]);

  const latest = cands[hitIdx];
  const all = periodsFrom(latest, PERIOD_COUNT);
  const first = tables[hitIdx];
  const second = await retry(() => table(symbol, group, exchange, all.slice(4)));
  const secondBy = new Map((second || []).map(r => [r.itemCode, r]));

  const rows = [];
  for (const r of first) {
    const name = (r.itemDescTr || '').trim();
    if (!name || /^\(Ara Toplam\)/i.test(name)) continue;
    const s = secondBy.get(r.itemCode);
    const v = [r.value1, r.value2, r.value3, r.value4, s?.value1, s?.value2].map(x => num(x) ?? 0);
    if (v.every(x => x === 0)) continue;
    rows.push({ c: r.itemCode, n: name, l: levelOf(r.itemDescTr || '', kind), v });
  }
  if (!latestGuess || latest[0] * 100 + latest[1] > latestGuess[0] * 100 + latestGuess[1]) latestGuess = latest;

  // Share classes (for example ISATR next to ISCTR) can return a stub with a few thousand TL of 'assets'
  const total = rows.find(r => r.c === totalCode)?.v[0] ?? 0;
  if (Math.abs(total) < 5e6) return { data: null, sawRows: true };

  return {
    sawRows: true,
    data: {
      available: true,
      kind,
      symbol,
      exchange,
      source: 'İş Yatırım (KAP finansal raporları)',
      basis: kind === 'bank' ? 'Konsolide, banka (UFRS) formatı'
        : kind === 'insurance' ? (group === 'UFRS' ? 'Solo, sigorta (UFRS) formatı' : 'Konsolide, sigorta (UFRS) formatı')
        : 'Konsolide, TMS 29 enflasyon düzeltmeli',
      periods: all.map(([y, p]) => `${y}/${p}`),
      rows
    }
  };
}

export async function load(symbol, exchange) {
  const key = `${symbol}|${exchange}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  let data = { available: false, reason: 'no-data', symbol };

  const industrial = await tryGroup(symbol, exchange, GROUP, '1BL', 'industrial');
  if (industrial.data) {
    data = industrial.data;
  } else {
    // Banks and insurers: UFRS layouts (consolidated first, then stand-alone), totals 1Z / 2O
    const fin = await tryGroup(symbol, exchange, BANK_GROUP, '1Z', 'auto');
    if (fin.data) data = fin.data;
    else {
      const solo = await tryGroup(symbol, exchange, 'UFRS', '1Z', 'auto');
      if (solo.data) data = solo.data;
      else if (fin.sawRows || solo.sawRows) data = { available: false, reason: 'financial-company', symbol };
    }
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
