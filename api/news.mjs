// Vercel serverless function: GET /api/news?cat=all|monetary|energy|macro|defense|industry|tech|retail
//
// Real, current headlines from Google News' public RSS search (Turkish edition). Only the
// headline, publisher, time and link are returned; the articles belong to their publishers and
// the UI links out to them.

const QUERIES = {
  all: 'Borsa İstanbul BIST 100 hisse',
  monetary: 'TCMB faiz kararı enflasyon Türkiye ekonomi',
  energy: 'Brent petrol doğalgaz altın fiyatları',
  macro: 'Fed faiz kararı küresel piyasalar dolar',
  defense: 'savunma sanayii havacılık ihracat Türkiye',
  industry: 'sanayi üretimi ihracat Türkiye',
  tech: 'yapay zeka yazılım teknoloji şirketi Türkiye borsa',
  retail: 'perakende market tüketici güven endeksi Türkiye'
};
const CACHE_MS = 10 * 60 * 1000;
const LIMIT = 24;

const cache = new Map();   // cat -> { at, body }

const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const tag = (xml, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decode(m[1]).trim() : '';
};

function parseItems(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const raw = tag(block, 'title');
    const source = tag(block, 'source');
    // Google appends " - Publisher" to every title
    const title = source && raw.endsWith(` - ${source}`) ? raw.slice(0, -(source.length + 3)) : raw;
    const date = Date.parse(tag(block, 'pubDate'));
    const link = tag(block, 'link');
    if (title && link && !Number.isNaN(date)) items.push({ title, source, url: link, date });
  }
  return items;
}

export default async function handler(req, res) {
  const send = (status, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'GET') return send(405, { error: 'Method not allowed' });

  const cat = new URL(req.url, 'http://x').searchParams.get('cat') || 'all';
  if (!QUERIES[cat]) return send(400, { error: 'unknown category' });

  const hit = cache.get(cat);
  if (hit && Date.now() - hit.at < CACHE_MS) return send(200, hit.body, { 'Cache-Control': 'public, s-maxage=600' });

  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(QUERIES[cat] + ' when:3d')}&hl=tr&gl=TR&ceid=TR:tr`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
    if (!r.ok) return send(502, { error: 'news unavailable' });
    const items = parseItems(await r.text())
      .sort((a, b) => b.date - a.date)
      .slice(0, LIMIT);
    const body = { source: 'Google Haberler', category: cat, fetchedAt: Date.now(), items };
    if (items.length) cache.set(cat, { at: Date.now(), body });
    return send(200, body, { 'Cache-Control': 'public, s-maxage=600' });
  } catch {
    return send(502, { error: 'news unavailable' });
  } finally {
    clearTimeout(timer);
  }
}
