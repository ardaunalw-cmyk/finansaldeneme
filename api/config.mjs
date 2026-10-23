// Vercel serverless function: GET /api/config
//
// Public settings the browser needs at start-up. For accounts: the Supabase project URL and its
// anon (public) key, read from SUPABASE_URL and SUPABASE_ANON_KEY. The anon key is meant to be
// public; what a signed-in user may read or write is enforced by row level security in the
// database (supabase/schema.sql). Without both variables accounts stay switched off.

const URL_RE = /^https:\/\/[a-z0-9-]+\.supabase\.co$/;
const KEY_RE = /^[A-Za-z0-9._-]{20,}$/;

// Also the names Supabase's own "Connect" snippet uses, so its .env lines can be pasted as they are
const URL_NAMES = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'];
const KEY_NAMES = ['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
/** The first of the names that holds a well-formed value (else the first one set, for the error). */
const pick = (env, names, re) => {
  const vals = names.map(n => (env[n] || '').trim().replace(/\/+$/, '')).filter(Boolean);
  return vals.find(v => re.test(v)) || vals[0] || '';
};

/** SUPABASE_GOOGLE=1 shows "Google ile giriş" (the Google provider must be enabled in Supabase). */
export function supabaseConfig(env = process.env) {
  const url = pick(env, URL_NAMES, URL_RE);
  const anonKey = pick(env, KEY_NAMES, KEY_RE);
  if (!URL_RE.test(url) || !KEY_RE.test(anonKey)) return null;
  return { url, anonKey, google: env.SUPABASE_GOOGLE === '1' };
}

/** Why accounts are off, for setup (no values are revealed): missing, bad-url or bad-key. */
export function offReason(env = process.env) {
  const url = pick(env, URL_NAMES, URL_RE);
  const key = pick(env, KEY_NAMES, KEY_RE);
  if (!url && !key) return 'missing';
  if (!URL_RE.test(url)) return url ? 'bad-url' : 'missing-url';
  if (!KEY_RE.test(key)) return key ? `bad-key (${key.length} karakter)` : 'missing-key';
  return null;
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, s-maxage=300' });
  const supabase = supabaseConfig();
  res.end(JSON.stringify({ supabase, ...(supabase ? {} : { off: offReason() }) }));
}
