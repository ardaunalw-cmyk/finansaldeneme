// Vercel serverless function: GET /api/config
//
// Public settings the browser needs at start-up. For accounts: the Supabase project URL and its
// anon (public) key, read from SUPABASE_URL and SUPABASE_ANON_KEY. The anon key is meant to be
// public; what a signed-in user may read or write is enforced by row level security in the
// database (supabase/schema.sql). Without both variables accounts stay switched off.

const URL_RE = /^https:\/\/[a-z0-9-]+\.supabase\.co$/;
const KEY_RE = /^[A-Za-z0-9._-]{20,}$/;

/** SUPABASE_GOOGLE=1 shows "Google ile giriş" (the Google provider must be enabled in Supabase). */
export function supabaseConfig(env = process.env) {
  const url = (env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anonKey = (env.SUPABASE_ANON_KEY || '').trim();
  if (!URL_RE.test(url) || !KEY_RE.test(anonKey)) return null;
  return { url, anonKey, google: env.SUPABASE_GOOGLE === '1' };
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, s-maxage=300' });
  res.end(JSON.stringify({ supabase: supabaseConfig() }));
}
