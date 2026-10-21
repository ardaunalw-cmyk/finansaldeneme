// Pre-fetches full statements (balance sheet, income statement, cash-flow items, last six
// reporting periods) for every company that has fundamentals into
// assets/data/statements/<SYMBOL>.json, so the stock page opens instantly instead of waiting
// 10-20 s on Is Yatirim for an uncached request. Values are stored in thousands of TL.
//
//   npm run data:statements            (skips files fresher than 12 h; add --force to redo all)
//
// Run it after each quarterly reporting season, together with `npm run data`.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { load } from '../api/statements.mjs';

const CONCURRENCY = 6;
const DIR = 'assets/data/statements';
const force = process.argv.includes('--force');

const have = JSON.parse(readFileSync('assets/data/fundamentals.json', 'utf8')).data;
const codes = Object.keys(have);
mkdirSync(DIR, { recursive: true });

let next = 0, done = 0, ok = 0, failed = [];

async function worker() {
  while (next < codes.length) {
    const code = codes[next++];
    const file = `${DIR}/${code}.json`;
    if (!force && existsSync(file) && Date.now() - statSync(file).mtimeMs < 12 * 3600 * 1000) { done++; ok++; continue; }
    const d = await load(code, 'TRY');
    if (d.available) {
      const slim = {
        source: d.source, basis: d.basis, unit: 1000, periods: d.periods,
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