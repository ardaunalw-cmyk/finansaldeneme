// Unit tests for the Ekonomik Takvim and Dünya Piyasaları helpers: the calendar feed cleanup
// (api/calendar.mjs), the Turkish dates (assets/js/calendar.js) and the board rows (api/markets.mjs).
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalize } from '../api/calendar.mjs';
import { boardRow } from '../api/markets.mjs';
import { toYahoo } from '../api/_yahoo.mjs';

const context = {};
vm.createContext(context);
vm.runInContext(`${readFileSync(new URL('../assets/js/calendar.js', import.meta.url), 'utf8')}\nthis.EconCalendar = EconCalendar;`, context);
const { tuikDates, turkishEvents, trTitle } = context.EconCalendar;
const plain = v => JSON.parse(JSON.stringify(v));

test('the calendar feed is cleaned, sorted and de-duplicated', () => {
  const out = normalize([
    { title: 'CPI y/y', country: 'USD', date: '2026-10-28T08:30:00-04:00', impact: 'High', forecast: '3.0%', previous: '2.9%' },
    { title: 'CPI y/y', country: 'USD', date: '2026-10-28T08:30:00-04:00', impact: 'High' },
    { title: 'Trade Balance', country: 'NZD', date: '2026-10-27T17:45:00-04:00', impact: 'Low' },
    { title: '', country: 'EUR', date: '2026-10-27T10:00:00Z' },
    { title: 'Bad date', country: 'EUR', date: 'soon' }
  ]);
  assert.deepEqual(out.map(e => e.title), ['Trade Balance', 'CPI y/y']);
  assert.equal(out[1].impact, 3);
  assert.equal(out[1].time, Date.parse('2026-10-28T12:30:00Z'));
  assert.equal(normalize(null).length, 0);
});

test('TÜİK inflation falls on the 3rd, or the first weekday after it', () => {
  // 3 Jan 2026 is a Saturday, 3 Oct 2026 a Saturday, 3 Nov 2026 a Tuesday
  assert.deepEqual(plain(tuikDates(Date.parse('2026-01-01'), 1)), ['2026-01-05']);
  assert.deepEqual(plain(tuikDates(Date.parse('2026-10-10'), 2)), ['2026-10-05', '2026-11-03']);
});

test('Turkish events include the TCMB decisions at 14:00 Istanbul time', () => {
  const ev = plain(turkishEvents(Date.parse('2026-12-01'), Date.parse('2026-12-31')));
  const ppk = ev.find(e => e.title.includes('PPK'));
  assert.equal(new Date(ppk.time).toISOString(), '2026-12-10T11:00:00.000Z');
  assert.ok(ev.every(e => e.country === 'TR'));
  assert.equal(trTitle('Non-Farm Employment Change'), 'Tarım dışı istihdam');
  assert.equal(trTitle('Some New Index'), 'Some New Index');
});

test('a board row compares with the previous close and keeps a month of closes', () => {
  const result = { meta: { regularMarketPrice: 110, longName: 'Test Index', currency: 'USD' }, indicators: { quote: [{ close: [100, null, 105, 110] }] } };
  const row = boardRow('SP500', result);
  assert.equal(row.prev, 105);
  assert.ok(Math.abs(row.change - (110 / 105 - 1) * 100) < 1e-9);
  assert.ok(Math.abs(row.month - 10) < 1e-9);
  assert.deepEqual(row.spark, [100, 105, 110]);
  assert.equal(boardRow('X', null), null);
});

test('world keys map to Yahoo symbols, BIST codes still work', () => {
  assert.equal(toYahoo('SP500'), '^GSPC');
  assert.equal(toYahoo('BTC'), 'BTC-USD');
  assert.equal(toYahoo('THYAO'), 'THYAO.IS');
});
