// Vercel serverless function: GET /api/quote?symbols=THYAO,GARAN,BIST100,USDTRY
//
// Returns delayed market prices from Yahoo Finance's public chart endpoint (no key needed).
// Prices only: Yahoo's fundamentals endpoints need a login crumb, so ratios and balance
// sheet data are NOT served here and stay labelled as sample data in the UI.

const SPECIAL = {
  BIST100: 'XU100.IS',
  USDTRY: 'USDTRY=X',
  EURTRY: 'EURTRY=X',
  ALTIN: 'GC=F',
  BRENT: 'BZ=F'
};
const MAX_SYMBOLS = 60;
const BATCH = 12;
const CACHE_MS = 45 * 1000;
const FETCH_TIMEOUT_MS = 5000;

const cache = new Map(); // key -> { at, data }

function toYahoo(key) {
  if (SPECIAL[key]) return SPECIAL[key];
  return /^[A-Z0-9]{2,6}$/.test(key) ? `${key}.IS` : null;
}

async function fetchOne(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  // Yahoo sometimes drops a request in a burst; one retry recovers most of them
  const first = await fetchOnce(key);
  if (first) return first;
  await new Promise(r => setTimeout(r, 400));
  return fetchOnce(key);
}

async function fetchOnce(key) {
  const yahoo = toYahoo(key);
  if (!yahoo) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=1d&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal }
    );
    if (!r.ok) return null;
    const meta = (await r.json())?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null;

    const prev = meta.previousClose ?? meta.chartPreviousClose;
    const data = {
      key,
      price: meta.regularMarketPrice,
      prevClose: typeof prev === 'number' ? prev : null,
      dayHigh: meta.regularMarketDayHigh ?? null,
      dayLow: meta.regularMarketDayLow ?? null,
      yearHigh: meta.fiftyTwoWeekHigh ?? null,
      yearLow: meta.fiftyTwoWeekLow ?? null,
      volume: meta.regularMarketVolume ?? null,
      time: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null
    };
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  const send = (status, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(JSON.stringify(body));
  };

  if (req.method !== 'GET') return send(405, { error: 'Method not allowed' });

  const url = new URL(req.url, 'http://x');
  const keys = [...new Set(
    (url.searchParams.get('symbols') || '')
      .toUpperCase()
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  )].slice(0, MAX_SYMBOLS);

  if (!keys.length) return send(400, { error: 'symbols is required' });

  const quotes = {};
  for (let i = 0; i < keys.length; i += BATCH) {
    const rows = await Promise.all(keys.slice(i, i + BATCH).map(fetchOne));
    rows.forEach(q => { if (q) quotes[q.key] = q; });
  }

  return send(200, { source: 'Yahoo Finance', delayed: true, fetchedAt: Date.now(), quotes }, {
    'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60'
  });
}
