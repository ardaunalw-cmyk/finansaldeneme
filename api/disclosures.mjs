// Vercel serverless function: GET /api/disclosures?oid=<MKK member oid>&codes=THYAO[,OTHER]
//
// A company's recent disclosures straight from KAP (Kamuyu Aydinlatma Platformu): the same
// JSON endpoint kap.org.tr's own site uses. KAP offers no documented public API, so this can
// break if KAP changes its site; the UI then falls back to a plain "open on KAP" link.
//
// The MKK member oid comes from the company records in assets/js/kap-database.js ("mkk").

const KAP_URL = 'https://www.kap.org.tr/tr/api/disclosure/members/byCriteria';
const CACHE_MS = 5 * 60 * 1000;
const LIMIT = 15;

const cache = new Map();   // oid|codes -> { at, body }

const ymd = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(d);   // 2026-10-21

async function kapSearch(oid, days) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(KAP_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'Referer': 'https://www.kap.org.tr/tr',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fromDate: ymd(from), toDate: ymd(to), memberTypes: ['IGS'], disclosureClass: '',
        subjectList: [], bdkMemberOidList: [], index: '', inactiveMkkMemberOidList: [], mkkMemberOidList: [oid]
      })
    });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? j : null;
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

  const q = new URL(req.url, 'http://x').searchParams;
  const oid = (q.get('oid') || '').trim();
  const codes = (q.get('codes') || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
  if (!/^[0-9a-fA-F]{32}$/.test(oid) || !codes.length || codes.length > 8 || codes.some(c => !/^[A-Z0-9]{2,6}$/.test(c))) {
    return send(400, { error: 'invalid parameters' });
  }

  const key = `${oid}|${codes.join(',')}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return send(200, hit.body, { 'Cache-Control': 'public, s-maxage=300' });

  // The search also returns disclosures of other issuers that merely mention the company
  // (for example MKK announcements); keep only the company's own.
  const own = items => items.filter(i => (i.stockCodes || '').split(',').some(c => codes.includes(c.trim())));

  let items = await kapSearch(oid, 120);
  if (items === null) items = await kapSearch(oid, 120);
  if (items === null) return send(502, { error: 'KAP unavailable' });

  let mine = own(items);
  if (mine.length < 5) {
    const wider = await kapSearch(oid, 540);
    if (wider) mine = own(wider);
  }

  const body = {
    source: 'KAP (kap.org.tr)',
    fetchedAt: Date.now(),
    items: mine.slice(0, LIMIT).map(i => ({
      date: i.publishDate,
      cls: i.disclosureClass,
      type: i.disclosureType,
      subject: (i.subject || '').trim(),
      summary: (i.summary || '').trim(),
      index: i.disclosureIndex,
      late: !!i.isLate,
      attachments: i.attachmentCount || 0
    }))
  };
  cache.set(key, { at: Date.now(), body });
  return send(200, body, { 'Cache-Control': 'public, s-maxage=300' });
}
