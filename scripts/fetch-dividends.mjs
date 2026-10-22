// Builds assets/data/dividends.json: cash dividend history (ex-dividend dates and amounts per
// share, last ~2 years) for every covered company, from Yahoo Finance's chart endpoint.
//
//   npm run data:dividends     (run now and then; the calendar page reads this file)
//
// Only companies that paid at least one dividend in the window are kept. "p" is the price at
// generation time, used to turn per-share amounts into a yield.
import { readFileSync, writeFileSync } from 'node:fs';
import { yahooChart } from '../api/_yahoo.mjs';

const CONCURRENCY = 8;
const OUT = 'assets/data/dividends.json';

const { data } = JSON.parse(readFileSync('assets/data/fundamentals.json', 'utf8'));
const codes = Object.keys(data);
const ymd = (sec) => new Date(sec * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

const out = {};
let next = 0;
let failed = 0;

async function worker() {
  while (next < codes.length) {
    const code = codes[next++];
    let res = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      res = await yahooChart(`${code}.IS`, { range: '2y', interval: '3mo', events: 'div' }, 10000);
    }
    if (!res) { failed++; continue; }
    const price = res.meta?.regularMarketPrice;
    const divs = Object.values(res.events?.dividends || {})
      .filter((d) => d.amount > 0)
      .sort((a, b) => a.date - b.date)
      .map((d) => [ymd(d.date), Math.round(d.amount * 1e4) / 1e4]);
    if (divs.length && typeof price === 'number' && price > 0) out[code] = { p: price, d: divs };
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'Yahoo Finance (temettü olayları)',
  data: out
}));
console.log(`${Object.keys(out).length} dividend payers of ${codes.length} companies (${failed} lookups failed) -> ${OUT}`);
