/**
 * BIST ticker tags for social posts: which listed codes a post mentions.
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

  const SocialTags = { extractTickers, topMentions, WORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = SocialTags;
  else root.SocialTags = SocialTags;
})(typeof window !== 'undefined' ? window : globalThis);
