// Pre-fetches full statements (balance sheet, income statement, cash-flow items, last six
// reporting periods) for every company that has fundamentals into
// assets/data/statements/<SYMBOL>.json, so the stock page opens instantly instead of waiting
// 10-20 s on Is Yatirim for an uncached request. Values are stored in thousands of TL.
//
//   npm run data:statements            (skips companies whose file already exists; add --force to refresh all)
//
// Run it after each quarterly reporting season, together with `npm run data`.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { load } from '../api/statements.mjs';

const CONCURRENCY = 6;
const DIR = 'assets/data/statements';
const force = process.argv.includes('--force');

const have = JSON.parse(readFileSync('assets/data/fundamentals.json', 'utf8')).data;
const codes = Object.keys(have);
// All tickers of each company (data providers know only some of them)
const raw = JSON.parse(readFileSync('assets/js/kap-database.js', 'utf8').split('\n')[2].replace(/^const KAP_RAW_COMPANIES = /, '').replace(/;\s*$/, ''));
const allCodes = {};
raw.forEach(c => {
  const list = (c.c || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
  if (list.length) allCodes[list[0]] = list;
});
mkdirSync(DIR, { recursive: true });

let next = 0, done = 0, ok = 0, failed = [];

async function worker() {
  while (next < codes.length) {
    const code = codes[next++];
    const file = `${DIR}/${code}.json`;
    if (!force && existsSync(file)) { done++; ok++; continue; }
    let d = { available: false };
    for (const tryCode of allCodes[code] || [code]) {
      d = await load(tryCode, 'TRY');
      if (d.available) break;
    }
    if (d.available) {
      const slim = {
        source: d.source, basis: d.basis, kind: d.kind, unit: 1000, periods: d.periods,
        rows: d.rows.map(r => [r.c, r.n, r.l, ...r.v.map(x => Math.round(x / 1000))])
      };
      writeFileSync(file, JSON.stringify(slim));
      ok++;
    } else {
      failed.push(code);
    }
    if (++done % 25 === 0) console.log(`${done}/${codes.length} ok=${ok} failed=${failed.length}`);
  }
}

console.log(`Fetching statements for ${codes.length} companies...`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`Done: ${ok} saved, ${failed.length} without data`, failed.slice(0, 30).join(','));