// Builds assets/data/technicals.json: a daily technical snapshot of every listed company (RSI,
// distance to the moving averages and the 52-week range, recent returns, volume, MACD) for the
// screener on the overview page. Computed from a year of Yahoo Finance daily bars with the same
// indicator functions the stock page uses (assets/js/indicators.js).
//
//   npm run data:technicals     (the "Technicals refresh" workflow runs it after every session)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { yahooChart } from '../api/_yahoo.mjs';

const require = createRequire(import.meta.url);
const Ind = require('../assets/js/indicators.js');

const CONCURRENCY = 8;
const OUT = 'assets/data/technicals.json';
export const FIELDS = ['close', 'd1', 'w1', 'm1', 'm3', 'rsi', 's20', 's50', 's200', 'hi52', 'lo52', 'vol', 'macd'];

const src = readFileSync('assets/js/kap-database.js', 'utf8').split('\n')[2];
const raw = JSON.parse(src.replace(/^const KAP_RAW_COMPANIES = /, '').replace(/;\s*$/, ''));
const codes = [...new Set(raw.map(c => (c.c || '').split(',')[0].trim().toUpperCase()).filter(c => /^[A-Z0-9]{2,6}$/.test(c)))];

const r1 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const pct = (a, b) => (a > 0 && b > 0 ? (a / b - 1) * 100 : null);
const last = a => a[a.length - 1];

/** One row of FIELDS from daily bars (oldest first); null with too little history. */
export function snapshot(h, l, c, v) {
  const n = c.length;
  if (n < 30) return null;
  const px = c[n - 1];
  const back = k => (n > k ? c[n - 1 - k] : null);
  const sma = k => last(Ind.sma(c, k));
  const year = Math.min(n, 252);
  const hi = Math.max(...h.slice(-year)), lo = Math.min(...l.slice(-year));
  const vol20 = v.slice(-21, -1);
  const avgVol = vol20.length ? vol20.reduce((s, x) => s + x, 0) / vol20.length : 0;
  const hist = last(Ind.macd(c).histogram);
  return [
    r2(px),
    r1(pct(px, back(1))), r1(pct(px, back(5))), r1(pct(px, back(21))), r1(pct(px, back(63))),
    r1(last(Ind.rsi(c))),
    r1(pct(px, sma(20))), r1(pct(px, sma(50))), r1(pct(px, sma(200))),
    r1(pct(px, hi)), r1(pct(px, lo)),
    avgVol > 0 ? r2(last(v) / avgVol) : null,
    hist == null ? null : hist > 0 ? 1 : hist < 0 ? -1 : 0
  ];
}

async function main() {
  const out = {};
  let next = 0, failed = 0, latest = 0;
  async function worker() {
    while (next < codes.length) {
      const code = codes[next++];
      let res = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) res = await yahooChart(`${code}.IS`, { range: '1y', interval: '1d' }, 10000);
      const q = res?.indicators?.quote?.[0];
      if (!q || !Array.isArray(res.timestamp)) { failed++; continue; }
      const h = [], l = [], c = [], v = [];
      res.timestamp.forEach((t, i) => {
        if ([q.open[i], q.high[i], q.low[i], q.close[i]].some(x => x == null)) return;
        h.push(q.high[i]); l.push(q.low[i]); c.push(q.close[i]); v.push(q.volume?.[i] ?? 0);
        latest = Math.max(latest, t);
      });
      const row = snapshot(h, l, c, v);
      if (row) out[code] = row;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    asOf: latest ? new Date(latest * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }) : null,
    source: 'Yahoo Finance günlük fiyatları (gecikmeli); göstergeler assets/js/indicators.js ile',
    // close TL; d1/w1/m1/m3 % return over 1/5/21/63 sessions; rsi RSI(14); s20/s50/s200 % above the
    // moving average; hi52/lo52 % from the 52-week high/low; vol last volume / 20-day average;
    // macd sign of the MACD histogram (1 up, -1 down)
    fields: FIELDS,
    data: out
  }));
  console.log(`${Object.keys(out).length} of ${codes.length} companies (${failed} lookups failed) -> ${OUT}`);
}

// Run only as a script, so the tests can import snapshot()
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
