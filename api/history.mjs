// Vercel serverless function: GET /api/history?symbol=THYAO&range=2y&interval=1d
//
// Real historical OHLCV bars from Yahoo Finance (delayed, no key). The browser computes the
// technical indicators from these bars.
import { toYahoo, yahooChart } from './_yahoo.mjs';

// 60d is Yahoo's limit for 5m-30m bars; 10y is for weekly bars
const RANGES = new Set(['1d', '5d', '1mo', '60d', '3mo', '6mo', 'ytd', '1y', '2y', '5y', '10y']);
const INTERVALS = new Set(['5m', '15m', '30m', '60m', '1d', '1wk']);

const cache = new Map();   // key -> { at, body }

export default async function handler(req, res) {
  const send = (status, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'GET') return send(405, { error: 'Method not allowed' });

  const q = new URL(req.url, 'http://x').searchParams;
  const symbol = (q.get('symbol') || '').toUpperCase().trim();
  const range = q.get('range') || '1y';
  const interval = q.get('interval') || '1d';
  const yahoo = toYahoo(symbol);
  if (!yahoo || !RANGES.has(range) || !INTERVALS.has(interval)) return send(400, { error: 'invalid parameters' });

  const key = `${symbol}|${range}|${interval}`;
  const intraday = interval.endsWith('m');
  const ttl = (intraday ? 60 : 600) * 1000;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return send(200, hit.body, { 'Cache-Control': `public, s-maxage=${intraday ? 60 : 600}` });

  let result = await yahooChart(yahoo, { range, interval });
  if (!result) result = await yahooChart(yahoo, { range, interval });   // one retry
  const quote = result?.indicators?.quote?.[0];
  const stamps = result?.timestamp;
  if (!quote || !Array.isArray(stamps)) return send(502, { error: 'no data' });

  // Drop bars where Yahoo has no close (halted days, partial intraday bars)
  const t = [], o = [], h = [], l = [], c = [], v = [];
  stamps.forEach((ts, i) => {
    if (quote.close[i] == null || quote.open[i] == null || quote.high[i] == null || quote.low[i] == null) return;
    t.push(ts * 1000);
    o.push(quote.open[i]); h.push(quote.high[i]); l.push(quote.low[i]); c.push(quote.close[i]);
    v.push(quote.volume?.[i] ?? 0);
  });

  // gmtoffset (seconds) lets the chart show exchange-local times; Istanbul is UTC+3 all year
  const gmtoffset = Number.isFinite(result.meta?.gmtoffset) ? result.meta.gmtoffset : 10800;
  const body = { symbol, range, interval, source: 'Yahoo Finance', delayed: true, fetchedAt: Date.now(), gmtoffset, t, o, h, l, c, v };
  cache.set(key, { at: Date.now(), body });
  return send(200, body, { 'Cache-Control': `public, s-maxage=${intraday ? 60 : 600}` });
}
