// Prices for the Sanal Portföy Yarışması: run by .github/workflows/alerts.yml every 15 minutes in
// BIST trading hours. Takes the delayed last price of every listed company from Yahoo's spark
// endpoint (20 symbols a request) and writes them to Supabase's market_prices table with the
// service key. The database fills the game's orders at these prices (supabase/schema.sql).
//
//   node scripts/update-prices.mjs          # fetch and write
//   node scripts/update-prices.mjs --dry    # fetch and print a few; writes nothing
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Without them the run is skipped.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BATCH = 20;

/** Every company code of the technical snapshot (the listed ones with price history). */
export function codes() {
  const j = JSON.parse(readFileSync(new URL('../assets/data/technicals.json', import.meta.url), 'utf8'));
  return Object.keys(j.data).filter(c => /^[A-Z0-9]{2,8}$/.test(c));
}

/** Spark response -> [{ ticker, price }] for the BIST symbols in it. */
export function pricesFromSpark(json) {
  return Object.entries(json || {})
    .map(([sym, v]) => ({ ticker: sym.replace(/\.IS$/, ''), price: Number(v && (v.fulldayPrice ?? (v.close || []).filter(Number.isFinite).pop())) }))
    .filter(r => /^[A-Z0-9]{2,8}$/.test(r.ticker) && Number.isFinite(r.price) && r.price > 0);
}

async function spark(list) {
  const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${list.map(c => `${c}.IS`).join(',')}&range=1d&interval=1d`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
      if (r.ok) return pricesFromSpark(await r.json());
    } catch { /* retried once */ }
  }
  return [];
}

async function main() {
  const dry = process.argv.includes('--dry');
  const env = process.env;
  const url = (env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/\s+/g, '').replace(/^["']|["']$/g, '');
  if (!dry && (!url || !key)) { console.log('Skipped: not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing).'); return; }

  const list = codes();
  const rows = [];
  for (let i = 0; i < list.length; i += BATCH) rows.push(...await spark(list.slice(i, i + BATCH)));
  console.log(`${rows.length} of ${list.length} prices.`);
  if (dry) { console.log(rows.slice(0, 5)); return; }
  if (!rows.length) { console.error('No prices fetched; nothing written.'); process.exit(1); }

  const now = new Date().toISOString();
  const headers = {
    apikey: key, ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }),
    'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal'
  };
  const r = await fetch(`${url}/rest/v1/market_prices?on_conflict=ticker`, {
    method: 'POST', headers, body: JSON.stringify(rows.map(x => ({ ...x, updated_at: now })))
  });
  if (!r.ok) { console.error(`Write failed: ${r.status} ${await r.text()}`); process.exit(1); }
  console.log(`Wrote ${rows.length} prices.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => { console.error(e.message || e); process.exit(1); });
}
