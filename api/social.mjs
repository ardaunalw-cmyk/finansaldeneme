// Vercel serverless function: GET /api/social
//
// Recent public posts about Borsa İstanbul from open, keyless sources: public Telegram channel
// previews (t.me/s/<channel>), the r/Borsa Atom feed and the Mastodon #bist100 hashtag. Private
// groups cannot be read, and X/Twitter needs a paid API, so neither is included. The posts are
// third parties' words, returned as plain text with a link to the original; nothing is
// verified. Each source is fetched independently: one failing is reported, not hidden.
import { parseMastodon, parseRedditAtom, parseTelegram } from './_social-parse.mjs';

const UA = 'Mozilla/5.0 (compatible; ONCAL/1.0; +https://finansaldeneme.vercel.app)';
const SOURCES = [
  { id: 'tg:borsa', kind: 'telegram', name: '@borsa', home: 'https://t.me/borsa', url: 'https://t.me/s/borsa', parse: t => parseTelegram(t, 'borsa') },
  { id: 'tg:ekonomi', kind: 'telegram', name: '@ekonomi', home: 'https://t.me/ekonomi', url: 'https://t.me/s/ekonomi', parse: t => parseTelegram(t, 'ekonomi') },
  { id: 'rd:Borsa', kind: 'reddit', name: 'r/Borsa', home: 'https://www.reddit.com/r/Borsa/', url: 'https://www.reddit.com/r/Borsa/new/.rss', parse: t => parseRedditAtom(t, 'Borsa') },
  { id: 'md:bist100', kind: 'mastodon', name: '#bist100', home: 'https://mastodon.social/tags/bist100', url: 'https://mastodon.social/api/v1/timelines/tag/bist100?limit=20', parse: t => parseMastodon(JSON.parse(t), 'bist100') }
];
const CACHE_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let cache = null;   // { at, ttl, body }

async function fetchSource(src) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(src.url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return src.parse(await r.text());
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

  if (cache && Date.now() - cache.at < cache.ttl) return send(200, cache.body, { 'Cache-Control': `public, s-maxage=${cache.ttl / 1000}` });

  const results = await Promise.allSettled(SOURCES.map(fetchSource));
  const cutoff = Date.now() - MAX_AGE_MS;
  const sources = [];
  const items = [];
  results.forEach((r, i) => {
    const { id, kind, name, home } = SOURCES[i];
    if (r.status === 'fulfilled') {
      const fresh = r.value.filter(p => p.date >= cutoff);
      sources.push({ id, kind, name, home, ok: true, count: fresh.length });
      items.push(...fresh);
    } else {
      console.warn(`[social] ${name} unavailable:`, r.reason && r.reason.message);
      sources.push({ id, kind, name, home, ok: false, count: 0 });
    }
  });

  if (!sources.some(s => s.ok)) return send(502, { error: 'social feeds unavailable', sources });

  items.sort((a, b) => b.date - a.date);
  const body = { fetchedAt: Date.now(), sources, items };
  // A partial result is kept for a minute only, so a failed source is retried soon
  const ttl = sources.every(s => s.ok) ? CACHE_MS : 60 * 1000;
  cache = { at: Date.now(), ttl, body };
  return send(200, body, { 'Cache-Control': `public, s-maxage=${ttl / 1000}` });
}
