// Unit tests for the Strateji Laboratuvarı group figures (assets/js/lab.js).
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = {};
vm.createContext(context);
vm.runInContext(`${readFileSync(new URL('../assets/js/lab.js', import.meta.url), 'utf8')}\nthis.StrategyLab = StrategyLab;`, context);
const { median, aggregate } = context.StrategyLab;

test('median of the finite values', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2, NaN, null]), 2.5);
  assert.equal(median([]), null);
});

test('group figures count only the stocks that ran', () => {
  const r = (ret, bh, trades) => ({ ok: true, stats: { totalReturn: ret, bhReturn: bh, trades } });
  const a = aggregate([r(0.2, 0.1, 3), r(-0.1, 0.05, 2), r(0.05, 0.3, 1), { ok: false, reason: 'Veri alınamadı' }]);
  assert.equal(a.n, 3);
  assert.equal(a.median, 0.05);
  assert.equal(a.bhMedian, 0.1);
  assert.ok(Math.abs(a.beat - 1 / 3) < 1e-12);
  assert.ok(Math.abs(a.positive - 2 / 3) < 1e-12);
  assert.equal(a.trades, 6);
});
