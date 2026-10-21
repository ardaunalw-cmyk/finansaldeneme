// Refreshes assets/data/fundamentals.json: real balance-sheet figures for every BIST company
// that Is Yatirim has statements for (non-financial companies, TMS 29, consolidated).
//
//   npm run data          (takes a few minutes; run after each quarterly reporting season)
//
// The overview table loads this file and combines it with live prices, so it does not have
// to call Is Yatirim ~1000 times per visit. Same figures as /api/financials.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { load } from '../api/financials.mjs';

const CONCURRENCY = 5;
const OUT = 'assets/data/fundamentals.json';

const src = readFileSync('assets/js/kap-database.js', 'utf8').split('\n')[2];
const raw = JSON.parse(src.replace(/^const KAP_RAW_COMPANIES = /, '').replace(/;\s*$/, ''));
// A company can have several tickers (share classes, KAP internal codes); data providers know only some of them
const allCodes = {};
raw.forEach(c => {
  const list = (c.c || '').split(',').map(x => x.trim().toUpperCase()).filter(x => /^[A-Z0-9]{2,6}$/.test(x));
  if (list.length) allCodes[list[0]] = list;
});
const codes = Object.keys(allCodes);
const aliases = {};

const missingOnly = process.argv.includes('--missing');
const onlyArg = process.argv.find(a => a.startsWith('--only='));   // --only=AGESA,ANSGR: just these companies
let data = {};
let codesToFetch = codes;
if (missingOnly && existsSync(OUT)) {
  // Only companies without data yet (for example after adding a new statement layout); keep the rest
  data = JSON.parse(readFileSync(OUT, 'utf8')).data;
  codesToFetch = codes.filter(c => !data[c]);
}
if (onlyArg) {
  data = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).data : {};
  const only = onlyArg.slice(7).split(',').map(x => x.trim().toUpperCase());
  codesToFetch = codes.filter(c => only.includes(c));
}
const skipped = { 'financial-company': 0, 'no-data': 0 };
let done = 0;
let next = 0;

async function worker() {
  while (next < codesToFetch.length) {
    const code = codesToFetch[next++];
    let f = { available: false, reason: 'no-data' };
    for (const tryCode of allCodes[code]) {
      f = await load(tryCode);
      if (f.available) { if (tryCode !== code) aliases[code] = tryCode; break; }
    }
    if (f.available) {
      // [period, shares, equity, totalAssets, netDebt, revenue, ebitda, netIncome]
      data[code] = [f.period, f.shares, f.equity, f.totalAssets, f.netDebt,
        f.ttm.revenue, f.ttm.ebitda, f.ttm.netIncome].map(v => (typeof v === 'number' ? Math.round(v) : v));
    } else {
      skipped[f.reason] = (skipped[f.reason] || 0) + 1;
    }
    if (++done % 50 === 0) console.log(`${done}/${codes.length}  ok=${Object.keys(data).length}`);
  }
}

console.log(`Fetching ${codesToFetch.length} companies...`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

mkdirSync('assets/data', { recursive: true });
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'İş Yatırım (KAP finansal raporları), konsolide, TMS 29',
  fields: ['period', 'shares', 'equity', 'totalAssets', 'netDebt', 'revenue', 'ebitda', 'netIncome'],
  data
}));
if (Object.keys(aliases).length) console.log('Aliases (raw code -> ticker the data provider knows):', JSON.stringify(aliases));
console.log(`Done: ${Object.keys(data).length} with data, skipped`, skipped, `-> ${OUT}`);
