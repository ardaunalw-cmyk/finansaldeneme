// Builds assets/data/sector-multiples.json: median P/E and P/B per KAP sector, from real
// statements (assets/data/fundamentals.json) and current Yahoo Finance prices.
//
//   npm run data:multiples     (run after `npm run data`, or whenever prices have moved a lot)
//
// The stock page uses these medians for the model value and the valuation part of the score.
import { readFileSync, writeFileSync } from 'node:fs';
import { yahooChart } from '../api/_yahoo.mjs';

const CONCURRENCY = 8;
const OUT = 'assets/data/sector-multiples.json';

const src = readFileSync('assets/js/kap-database.js', 'utf8').split('\n')[2];
const raw = JSON.parse(src.replace(/^const KAP_RAW_COMPANIES = /, '').replace(/;\s*$/, ''));
const sectorOf = {};
raw.forEach(c => {
  const first = (c.c || '').split(',')[0].trim().toUpperCase();
  if (first) sectorOf[first] = c.sec || '';
});

const { data } = JSON.parse(readFileSync('assets/data/fundamentals.json', 'utf8'));
const codes = Object.keys(data);

const rows = []; // { sector, pe, pb }
let next = 0;
let priced = 0;

async function worker() {
  while (next < codes.length) {
    const code = codes[next++];
    let meta = null;
    for (let attempt = 0; attempt < 2 && !meta; attempt++) {
      meta = (await yahooChart(`${code}.IS`, { range: '1d', interval: '1d' }, 8000))?.meta;
    }
    const price = meta?.regularMarketPrice;
    if (typeof price !== 'number' || price <= 0) continue;
    priced++;
    // [period, shares, equity, totalAssets, netDebt, revenue, ebitda, netIncome]
    const [, shares, equity, , , , , netIncome] = data[code];
    const mcap = price * shares;
    rows.push({
      sector: sectorOf[code] || '',
      pe: netIncome > 0 ? mcap / netIncome : null,
      pb: equity > 0 ? mcap / equity : null
    });
  }
}

const median = list => {
  const v = list.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return Math.round((v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2) * 100) / 100;
};
// Extreme multiples (near-zero earnings, tiny equity) say nothing about the sector
const sane = (v, max) => (v !== null && v > 0 && v < max ? v : null);

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const summarize = list => ({
  n: list.length,
  pe: median(list.map(r => sane(r.pe, 100))),
  pb: median(list.map(r => sane(r.pb, 20)))
});

const sectors = {};
[...new Set(rows.map(r => r.sector))].filter(Boolean).forEach(s => {
  sectors[s] = summarize(rows.filter(r => r.sector === s));
});

writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'İş Yatırım bilançoları (KAP) ve Yahoo Finance fiyatları; sektör = KAP sektörü',
  all: summarize(rows),
  sectors
}, null, 1));
console.log(`Priced ${priced}/${codes.length}; ${Object.keys(sectors).length} sectors -> ${OUT}`);
