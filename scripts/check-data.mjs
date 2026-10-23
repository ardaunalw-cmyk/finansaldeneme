// Guards the scheduled data refresh: compares the regenerated data files with the committed
// ones and exits non-zero when a file shrank sharply, so a blocked or failing data source
// never gets committed as an empty dataset.
//
//   node scripts/check-data.mjs          (run after the data:* scripts, before committing)
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const MAX_DROP = 0.1;   // fail when more than 10% of the entries disappear

const committed = path => {
  // A file new in this refresh is not in HEAD yet: no baseline, and no git error on the console
  try { return execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
};
const count = {
  'assets/data/fundamentals.json': s => Object.keys(JSON.parse(s).data).length,
  'assets/data/dividends.json': s => Object.keys(JSON.parse(s).data).length,
  'assets/data/sector-multiples.json': s => Object.keys(JSON.parse(s).sectors).length,
  'assets/data/technicals.json': s => Object.keys(JSON.parse(s).data).length
};

let failed = false;
const report = (name, before, after) => {
  const drop = before ? (before - after) / before : 0;
  const bad = after === 0 || drop > MAX_DROP;
  if (bad) failed = true;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${name}: ${before ?? '-'} -> ${after}`);
};

for (const [path, fn] of Object.entries(count)) {
  const old = committed(path);
  report(path, old ? fn(old) : null, fn(readFileSync(path, 'utf8')));
}

const dir = 'assets/data/statements';
const oldFiles = execFileSync('git', ['ls-tree', '--name-only', 'HEAD', `${dir}/`], { encoding: 'utf8' }).split('\n').filter(Boolean).length;
report(dir, oldFiles, readdirSync(dir).filter(f => f.endsWith('.json')).length);

process.exit(failed ? 1 : 0);
