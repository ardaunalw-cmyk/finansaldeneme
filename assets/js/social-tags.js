/**
 * BIST ticker tags for social posts: which listed codes a post mentions, and the aggregate
 * figures (summarize) the social media bulletin is written from.
 * Pure functions (no DOM), shared by assets/js/social.js and test/social.test.mjs.
 *
 * "#ASELS", "$asels" and "ASELS.IS" always count. A bare uppercase word counts only when it is
 * a known code and not one of the codes that are also ordinary words ("ARTI", "EKIM", "HEDEF"),
 * since posts are often written in capitals.
 */
(function (root) {
  const WORDS = new Set([
    'ADEL', 'ARAT', 'ARTI', 'ATAC', 'AYEN', 'BERA', 'CASA', 'DAGI', 'DESA', 'DEVA', 'EFES', 'EKER',
    'EKIM', 'EKIZ', 'ESEN', 'GIMA', 'HEDEF', 'KENT', 'KIPA', 'KULE', 'LINK', 'LOGO', 'MARTI',
    'MAVI', 'OTTO', 'SABAH', 'SODA', 'SOKE', 'TOKI', 'UFUK', 'ULAS', 'UNLU', 'USAK', 'UYUM'
  ]);

  const TAGGED = /(?:[#$]([A-Za-z]{4,6})|(?<![\p{L}\p{N}])([A-Z]{4,6})\.IS)(?![\p{L}\p{N}])/gu;
  const BARE = /(?<![\p{L}\p{N}#$])([A-Z]{4,6})(?![\p{L}\p{N}])/gu;

  /** Codes mentioned in `text`, in first-mention order. `codes` is a Set of known tickers. */
  function extractTickers(text, codes) {
    const s = String(text || '');
    const found = [];
    const add = c => { if (codes.has(c) && !found.includes(c)) found.push(c); };
    const hits = [];
    for (const m of s.matchAll(TAGGED)) hits.push([m.index, (m[1] || m[2]).toUpperCase()]);
    for (const m of s.matchAll(BARE)) if (!WORDS.has(m[1])) hits.push([m.index, m[1]]);
    hits.sort((a, b) => a[0] - b[0]).forEach(([, c]) => add(c));
    return found;
  }

  /** Mention counts per code over posts newer than `since` (ms), most mentioned first. */
  function topMentions(posts, since, limit = 10) {
    const counts = new Map();
    for (const p of posts) {
      if (p.date < since) continue;
      for (const c of p.tickers || []) counts.set(c, (counts.get(c) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit)
      .map(([code, count]) => ({ code, count }));
  }

  // Agenda topics for the bulletin, matched on the lowercased (tr) text
  const TOPICS = [
    ['Temettü ve kâr payı', /temett[üu]|k[âa]r pay/],
    ['Bedelsiz / bedelli sermaye artırımı', /bedelsiz|bedelli|sermaye art[ıi]r/],
    ['Halka arz', /halka arz/],
    ['Faiz ve para politikası', /faiz|tcmb|merkez bankas|ppk/],
    ['Enflasyon', /enflasyon|tüfe|üfe/],
    ['Döviz ve altın', /dolar|euro|döviz|altın(?!\p{L})/u],
    ['Bilanço ve finansal sonuçlar', /bilan[çc]o|net k[âa]r|çeyrek|finansal sonu[çc]/],
    ['BIST 100 endeksi', /bist ?100|xu100|endeks/]
  ];

  function topicsOf(text) {
    const s = String(text || '').toLocaleLowerCase('tr');
    return TOPICS.filter(([, re]) => re.test(s)).map(([name]) => name);
  }

  /**
   * Figures for the bulletin: posts of the last 24 hours (to `now`) against the 24 hours before.
   * A company is flagged `surge` when it is in 3+ posts across 2+ channels and at least twice
   * its previous-day count, the pattern a coordinated promotion leaves.
   */
  function summarize(posts, now) {
    const DAY = 24 * 60 * 60 * 1000;
    const cur = posts.filter(p => now - p.date < DAY);
    const prevTotal = posts.filter(p => now - p.date >= DAY && now - p.date < 2 * DAY).length;
    const byCode = new Map();
    const channels = new Map();
    const topics = new Map();
    for (const p of posts) {
      const age = now - p.date;
      if (age >= 2 * DAY) continue;
      for (const c of p.tickers || []) {
        if (!byCode.has(c)) byCode.set(c, { code: c, count: 0, prev: 0, channels: new Set() });
        const e = byCode.get(c);
        if (age < DAY) { e.count++; e.channels.add(p.channel); } else e.prev++;
      }
    }
    for (const p of cur) {
      const ch = channels.get(p.channel) || { channel: p.channel, count: 0, withCodes: 0 };
      ch.count++;
      if ((p.tickers || []).length) ch.withCodes++;
      channels.set(p.channel, ch);
      for (const t of topicsOf(p.text)) topics.set(t, (topics.get(t) || 0) + 1);
    }
    const companies = [...byCode.values()].filter(e => e.count > 0)
      .sort((a, b) => b.count - a.count || b.channels.size - a.channels.size || a.code.localeCompare(b.code))
      .map(e => ({ code: e.code, count: e.count, prev: e.prev, channels: [...e.channels], surge: e.count >= 3 && e.channels.size >= 2 && e.count >= 2 * Math.max(1, e.prev) }));
    return {
      total: cur.length,
      prevTotal,
      withCodes: cur.filter(p => (p.tickers || []).length).length,
      companies,
      topics: [...topics].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })),
      channels: [...channels.values()].sort((a, b) => b.count - a.count)
    };
  }

  const SocialTags = { extractTickers, topMentions, topicsOf, summarize, WORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = SocialTags;
  else root.SocialTags = SocialTags;
})(typeof window !== 'undefined' ? window : globalThis);
