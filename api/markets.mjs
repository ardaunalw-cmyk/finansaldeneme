// Vercel serverless function: GET /api/markets?keys=SP500,BTC,GLDTR
//
// A board of symbols for the Dünya Piyasaları and Fonlar views: delayed price, change against the
// previous close, a one-month close series for the sparkline and Yahoo's name for the symbol.
// Keys are the ones /api/history takes (assets/api/_yahoo.mjs: SPECIAL, or a BIST code).
import { toYahoo, yahooChart } from './_yahoo.mjs';

const MAX_KEYS = 40;
const BATCH = 10;
const CACHE_MS = 120 * 1000;
const cache = new Map();   // key -> { at, row }

/** One board row from a Yahoo chart result (range 1mo, interval 1d); null without a price. */
export function boardRow(key, result) {
  const meta = result?.meta;
  const closes = (result?.indicators?.quote?.[0]?.close || []).filter(Number.isFinite);
  const price = Number.isFinite(meta?.regularMarketPrice) ? meta.regularMarketPrice : closes[closes.length - 1];
  if (!Number.isFinite(price)) return null;
  // The last daily close is today's while the market is open: compare with the one before it
  const last = closes[closes.length - 1];
  const prev = closes.length > 1 ? (Math.abs(last - price) / price < 1e-9 ? closes[closes.length - 2] : last) : meta?.chartPreviousClose;
  return {
    key,
    name: meta?.longName || meta?.shortName || key,
    currency: meta?.currency || null,
    price,
    prev: Number.isFinite(prev) ? prev : null,
    change: Number.isFinite(prev) && prev ? (price / prev - 1) * 100 : null,
    month: closes.length > 1 ? (price / closes[0] - 1) * 100 : null,
    spark: closes.slice(-22).map(v => Math.round(v * 10000) / 10000),
    time: meta?.regularMarketTime ? meta.regularMarketTime * 1000 : null
  };
}

async function fetchRow(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.row;
  const yahoo = toYahoo(key);
  if (!yahoo) return null;
  let result = await yahooChart(yahoo, { range: '1mo', interval: '1d' }, 6000);
  if (!result) result = await yahooChart(yahoo, { range: '1mo', interval: '1d' }, 6000);
  const row = boardRow(key, result);
  if (row) cache.set(key, { at: Date.now(), row });
  return row;
}

export default async function handler(req, res) {
  const send = (status, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'GET') return send(405, { error: 'Method not allowed' });
  const keys = [...new Set((new URL(req.url, 'http://x').searchParams.get('keys') || '')
    .toUpperCase().split(',').map(s => s.trim()).filter(k => /^[A-Z0-9]{2,8}$/.test(k)))].slice(0, MAX_KEYS);
  if (!keys.length) return send(400, { error: 'keys is required' });
  const rows = {};
  for (let i = 0; i < keys.length; i += BATCH) {
    (await Promise.all(keys.slice(i, i + BATCH).map(fetchRow))).forEach(r => { if (r) rows[r.key] = r; });
  }
  return send(200, { source: 'Yahoo Finance', delayed: true, fetchedAt: Date.now(), rows }, {
    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120'
  });
}
