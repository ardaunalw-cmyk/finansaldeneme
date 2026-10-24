// E-mail alerts: run by .github/workflows/alerts.yml every 15 minutes in BIST trading hours.
//
// Reads every account's alerts (Supabase user_data, with the service role key), checks the
// untriggered ones marked "e-posta ile de haber ver" with the page's own rules
// (assets/js/alert-rules.js) on Yahoo daily bars, marks the hits as triggered in the account and
// only then mails the account's address. The write names the rev it read, so when a device wrote
// in between the write fails, nothing is sent and the next run tries again on fresh data.
//
//   node scripts/check-alerts.mjs          # check, update, send
//   node scripts/check-alerts.mjs --dry    # print what would be sent; writes and sends nothing
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, SITE_URL (optional).
// Without them the run is skipped, so the schedule stays green until accounts are set up.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { toYahoo, yahooChart } from '../api/_yahoo.mjs';

const require = createRequire(import.meta.url);
const Rules = require('../assets/js/alert-rules.js');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Alerts of one account that the e-mail check handles. */
export function pendingEmailAlerts(data) {
  return (data && Array.isArray(data.alerts) ? data.alerts : []).filter(a => a && a.email && !a.triggered && Rules.TYPES[a.type]);
}

/**
 * One account's data with its e-mail alerts checked against market ({ TICKER: { price, closes } }).
 * Hits are marked triggered (as the page would) and alertsAt moves, so devices take the change.
 */
export function applyHits(data, market, now = new Date()) {
  const hits = [];
  const at = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
  const alerts = (data && Array.isArray(data.alerts) ? data.alerts : []).map(a => {
    if (!pendingEmailAlerts({ alerts: [a] }).length || !market[a.ticker]) return a;
    const r = Rules.evaluate(a, market[a.ticker]);
    if (!r) return a;
    const done = { ...a, triggered: true, triggeredAt: at, emailedAt: now.toISOString() };
    hits.push({ alert: done, text: r.text });
    return done;
  });
  return hits.length ? { data: { ...data, alerts, alertsAt: now.getTime() }, hits } : { data, hits };
}

/** Subject and bodies of the one mail an account gets for this run's hits. */
export function mailFor(hits, site) {
  const tickers = [...new Set(hits.map(h => h.alert.ticker))];
  const subject = `ONCAL alarmı: ${tickers.join(', ')}`;
  const text = hits.map(h => `${h.alert.ticker}: ${h.text}${h.alert.note ? ` (${h.alert.note})` : ''}\n${site}/hisse/${h.alert.ticker}`).join('\n\n')
    + '\n\nBu e-postayı ONCAL\'da "e-posta ile de haber ver" seçerek kurduğun alarmlar için aldın. Alarmları siteden silebilirsin.';
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">
    ${hits.map(h => `<p style="margin:0 0 14px"><b>${esc(h.alert.ticker)}</b>: ${esc(h.text)}${h.alert.note ? `<br><span style="color:#64748b">${esc(h.alert.note)}</span>` : ''}<br>
      <a href="${esc(site)}/hisse/${encodeURIComponent(h.alert.ticker)}">Grafiği aç</a></p>`).join('')}
    <p style="color:#94a3b8;font-size:12px">Bu e-postayı ONCAL'da "e-posta ile de haber ver" seçerek kurduğun alarmlar için aldın. Alarmları siteden silebilirsin.</p></div>`;
  return { subject, text, html };
}

/* ---------- network ---------- */

async function marketFor(ticker) {
  const symbol = toYahoo(ticker);
  if (!symbol) return null;
  const r = await yahooChart(symbol, { range: '2y', interval: '1d' }, 15000);
  const closes = (r?.indicators?.quote?.[0]?.close || []).filter(Number.isFinite);
  if (!closes.length) return null;
  const price = Number.isFinite(r.meta?.regularMarketPrice) ? r.meta.regularMarketPrice : closes[closes.length - 1];
  return { price, closes };
}

function supabase(url, key) {
  // A new-style secret key (sb_secret_...) goes in apikey only; a legacy service_role JWT in both
  const headers = { apikey: key, ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }), 'Content-Type': 'application/json' };
  const call = async (path, init = {}) => {
    const r = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...init.headers } });
    if (r.status === 401) {
      // Which kind of key arrived, without revealing it
      const kind = key.startsWith('sb_secret_') ? 'a secret key (sb_secret_)' : key.startsWith('eyJ') ? 'a JWT (legacy key)' : `an unknown format (${key.length} characters)`;
      throw new Error(`Supabase refused the key: it looks like ${kind}. Check that it is this project's service_role / secret key.`);
    }
    if (!r.ok) throw new Error(`${init.method || 'GET'} ${path.split('?')[0]}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  };
  return {
    rows: () => call('/rest/v1/user_data?select=user_id,rev,data&limit=10000'),
    /** True when the row still had `rev`, so the write went in. */
    update: async (id, rev, data) => (await call(`/rest/v1/user_data?user_id=eq.${id}&rev=eq.${rev}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ data, rev: rev + 1 })
    })).length > 0,
    email: async id => (await call(`/auth/v1/admin/users/${id}`)).email || null
  };
}

async function main() {
  const dry = process.argv.includes('--dry');
  const env = process.env;
  const url = (env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', ...(dry ? [] : ['GMAIL_USER', 'GMAIL_APP_PASSWORD'])].filter(k => !env[k]);
  if (missing.length) { console.log(`Skipped: not configured (${missing.join(', ')} missing).`); return; }
  const site = (env.SITE_URL || 'https://finansaldeneme.vercel.app').replace(/\/+$/, '');
  // A pasted secret often carries quotes or a line break, even in the middle; keys have no spaces
  const key = env.SUPABASE_SERVICE_ROLE_KEY.replace(/\s+/g, '').replace(/^["']|["']$/g, '');
  if (/^sb_publishable_/.test(key)) { console.error('SUPABASE_SERVICE_ROLE_KEY is the publishable (anon) key; the secret / service_role key is needed.'); process.exit(1); }
  const db = supabase(url, key);

  const rows = await db.rows();
  const tickers = [...new Set(rows.flatMap(r => pendingEmailAlerts(r.data).map(a => a.ticker)))];
  console.log(`${rows.length} accounts, ${tickers.length} stocks with e-mail alerts.`);
  if (!tickers.length) return;

  const market = {};
  for (const t of tickers) {
    market[t] = await marketFor(t);
    if (!market[t]) { delete market[t]; console.warn(`No prices for ${t}; its alerts wait.`); }
  }

  let mailer = null;
  for (const row of rows) {
    const { data, hits } = applyHits(row.data, market);
    if (!hits.length) continue;
    const mail = mailFor(hits, site);
    if (dry) { console.log(`[dry] ${row.user_id}: ${mail.subject}\n${mail.text}\n`); continue; }
    if (!(await db.update(row.user_id, row.rev, data))) { console.log(`${row.user_id}: changed meanwhile; next run.`); continue; }
    const to = await db.email(row.user_id);
    if (!to) { console.warn(`${row.user_id}: no e-mail address.`); continue; }
    if (!mailer) {
      const nodemailer = (await import('nodemailer')).default;
      mailer = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: env.GMAIL_USER.trim(), pass: env.GMAIL_APP_PASSWORD.replace(/\s+/g, '') } });
    }
    await mailer.sendMail({ from: `"ONCAL" <${env.GMAIL_USER}>`, to, ...mail });
    console.log(`${row.user_id}: sent ${hits.length} alert(s).`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => { console.error(e.message || e); process.exit(1); });
}
