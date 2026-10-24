// Builds assets/data/ipos.json: the companies that started trading on Borsa İstanbul in the last
// two years, with how they did since their first session (first open and close, the run of
// limit-up days after it, the peak, and today's price). Yahoo daily bars over five years tell
// when trading began. Offer prices are not in any free feed, so returns are from the first close.
//
//   npm run data:ipos     (the weekly "Data refresh" workflow runs it)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { yahooChart } from '../api/_yahoo.mjs';

const OUT = 'assets/data/ipos.json';
const CONCURRENCY = 8;
const WINDOW_DAYS = 730;
const DAY = 86400;
// A session closing 9.5% or more above the one before counts as limit-up (BIST's limit is 10%)
const LIMIT_UP = 0.095;

const r2 = v => Math.round(v * 100) / 100;
const r1 = v => Math.round(v * 10) / 10;

/**
 * One IPO row from daily bars (t seconds, o, h, c; oldest first), or null when trading began
 * before the window (`now` - WINDOW_DAYS) or there is too little to say.
 */
export function ipoRow(code, bars, now = Date.now() / 1000) {
  if (!bars.length || bars[0].t < now - WINDOW_DAYS * DAY) return null;
  const first = bars[0];
  let streak = 0;
  for (let i = 1; i < bars.length && bars[i].c / bars[i - 1].c - 1 >= LIMIT_UP; i++) streak++;
  let peak = bars[0];
  bars.forEach(b => { if (b.h > peak.h) peak = b; });
  const last = bars[bars.length - 1];
  const day = t => new Date(t * 1000).toISOString().slice(0, 10);
  return {
    code,
    first: day(first.t),
    open: r2(first.o),
    close1: r2(first.c),
    streak,
    peak: r2(peak.h),
    peakDate: day(peak.t),
    last: r2(last.c),
    sessions: bars.length,
    ret: r1((last.c / first.c - 1) * 100),
    peakRet: r1((peak.h / first.c - 1) * 100),
    fromPeak: r1((last.c / peak.h - 1) * 100)
  };
}

async function main() {
  const src = readFileSync('assets/js/kap-database.js', 'utf8').split('\n')[2];
  const raw = JSON.parse(src.replace(/^const KAP_RAW_COMPANIES = /, '').replace(/;\s*$/, ''));
  const codes = [...new Set(raw.map(c => (c.c || '').split(',')[0].trim().toUpperCase()).filter(c => /^[A-Z0-9]{2,6}$/.test(c)))];
  const rows = [];
  let next = 0, failed = 0;
  async function worker() {
    while (next < codes.length) {
      const code = codes[next++];
      let res = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) res = await yahooChart(`${code}.IS`, { range: '5y', interval: '1d' }, 12000);
      const q = res?.indicators?.quote?.[0];
      if (!q || !Array.isArray(res.timestamp)) { failed++; continue; }
      const bars = res.timestamp.map((t, i) => ({ t, o: q.open[i], h: q.high[i], c: q.close[i] }))
        .filter(b => [b.o, b.h, b.c].every(Number.isFinite));
      const row = ipoRow(code, bars);
      if (row) rows.push(row);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  rows.sort((a, b) => b.first.localeCompare(a.first));
  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'Yahoo Finance günlük fiyatları (gecikmeli)',
    note: 'Getiriler ilk işlem günü kapanışına göredir; arz fiyatı içermez. Tavan serisi: ilk günden sonra art arda %9,5 ve üzeri kapanan seanslar.',
    data: rows
  }));
  console.log(`${rows.length} listings in the last ${WINDOW_DAYS} days (${failed} lookups failed) -> ${OUT}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
