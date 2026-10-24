// Vercel serverless function: GET /api/calendar
//
// This and next week's economic releases of the major economies (USD, EUR, GBP, JPY, CNY, ...)
// from the public Forex Factory calendar feed, with impact, forecast and previous value. Turkish
// releases (TCMB, TÜİK) are not in it; assets/js/calendar.js adds them from their published dates.
const FEEDS = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  'https://nfs.faireconomy.media/ff_calendar_nextweek.json'
];
const CACHE_MS = 30 * 60 * 1000;
let cache = null;   // { at, events }

const IMPACTS = { High: 3, Medium: 2, Low: 1, Holiday: 0 };

/** Feed items -> { title, country, time (ms), impact 0-3, forecast, previous }, by time, no repeats. */
export function normalize(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map(e => ({
      title: String(e?.title || '').slice(0, 120),
      country: String(e?.country || '').slice(0, 8),
      time: Date.parse(e?.date),
      impact: IMPACTS[e?.impact] ?? 1,
      forecast: String(e?.forecast || '').slice(0, 20),
      previous: String(e?.previous || '').slice(0, 20)
    }))
    .filter(e => e.title && Number.isFinite(e.time))
    .filter(e => {
      const k = `${e.time}|${e.country}|${e.title}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.time - b.time);
}

async function fetchFeed(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ONCAL/1.0)' }, signal: ctrl.signal });
    return r.ok ? await r.json() : [];
  } catch {
    return [];
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
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const lists = await Promise.all(FEEDS.map(fetchFeed));
    const events = normalize(lists.flat());
    if (events.length || !cache) cache = { at: Date.now(), events };
  }
  return send(200, { source: 'Forex Factory', fetchedAt: cache.at, events: cache.events }, {
    'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800'
  });
}
