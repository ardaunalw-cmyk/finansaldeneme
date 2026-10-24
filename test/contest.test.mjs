// Unit tests for the Sanal Portföy Yarışması book keeping (assets/js/contest.js) and the price
// feed it trades at (scripts/update-prices.mjs).
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { pricesFromSpark } from '../scripts/update-prices.mjs';

const context = {};
vm.createContext(context);
vm.runInContext(`${readFileSync(new URL('../assets/js/contest.js', import.meta.url), 'utf8')}\nthis.Contest = Contest;`, context);
const { book, value } = context.Contest;
const plain = v => JSON.parse(JSON.stringify(v));

test('the book tracks cash, lots and the average cost of what is still held', () => {
  const b = book([
    { ticker: 'A', side: 'buy', qty: 100, price: 10 },
    { ticker: 'A', side: 'buy', qty: 100, price: 20 },
    { ticker: 'A', side: 'sell', qty: 50, price: 30 },
    { ticker: 'B', side: 'buy', qty: 10, price: 5 },
    { ticker: 'B', side: 'sell', qty: 10, price: 6 }
  ]);
  assert.equal(b.cash, 100000 - 1000 - 2000 + 1500 - 50 + 60);
  assert.deepEqual(plain(b.positions.map(p => [p.ticker, p.qty, p.avg])), [['A', 150, 15]]);
  // Valued at the latest price; a stock without one counts at its cost
  assert.equal(value(b, { A: 20 }), b.cash + 150 * 20);
  assert.equal(value(b, {}), b.cash + 150 * 15);
});

test('spark prices keep BIST codes with a real price', () => {
  assert.deepEqual(pricesFromSpark({
    'THYAO.IS': { fulldayPrice: 258 },
    'GARAN.IS': { close: [126.5, null] },
    'BAD.IS': { fulldayPrice: 0 },
    'X-Y.IS': { fulldayPrice: 3 }
  }), [{ ticker: 'THYAO', price: 258 }, { ticker: 'GARAN', price: 126.5 }]);
});
