// Unit tests for the formula language (assets/js/formula.js).
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const F = require('../assets/js/formula.js');
const Ind = require('../assets/js/indicators.js');

const bars = closes => closes.map((c, i) => ({ time: i, open: c - 1, high: c + 2, low: c - 2, close: c, volume: 100 + i }));
const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 10 + i * 0.2);
const B = bars(closes);

test('arithmetic follows precedence and works per bar', () => {
  const f = F.compile('(high + low) / 2 - 1 * 2');
  assert.equal(f.type, 'number');
  assert.deepEqual(f.run(B).slice(0, 2), [closes[0] - 2, closes[1] - 2]);
  assert.equal(F.compile('-close + 10').run(B)[0], -closes[0] + 10);
  assert.equal(F.compile('close / 0').run(B)[0], null);
});

test('functions match the indicator library, with warm-up nulls', () => {
  assert.deepEqual(F.compile('sma(close, 5)').run(B), Ind.sma(closes, 5));
  assert.deepEqual(F.compile('rsi(close)').run(B), Ind.rsi(closes, 14));
  assert.deepEqual(F.compile('macdsignal(close)').run(B), Ind.macd(closes, 12, 26, 9).signal);
  // An indicator of an indicator starts after the inner warm-up
  const nested = F.compile('sma(rsi(close), 3)').run(B);
  const r = Ind.rsi(closes, 14);
  assert.equal(nested[15], null);
  assert.ok(Math.abs(nested[16] - (r[14] + r[15] + r[16]) / 3) < 1e-9);
  assert.equal(F.compile('highest(high, 3)').run(B)[2], Math.max(...closes.slice(0, 3)) + 2);
  assert.equal(F.compile('ref(close, 2)').run(B)[2], closes[0]);
  assert.equal(F.compile('change(close)').run(B)[1], closes[1] - closes[0]);
});

test('conditions combine with and/or/not, also in Turkish', () => {
  const f = F.compile('kapanış > açılış ve değil (close < 0)');
  assert.equal(f.type, 'condition');
  assert.ok(f.run(B).every(v => v === true));
  assert.ok(F.compile('close < 0 || close > 0').run(B).every(v => v === true));
  assert.ok(F.compile('!(close > 0)').run(B).every(v => v === false));
});

test('crossover fires only on the crossing bar', () => {
  const up = bars([1, 1, 1, 3, 4, 2, 1]);
  assert.deepEqual(F.compile('crossover(close, 2)').run(up), [null, false, false, true, false, false, false]);
  assert.deepEqual(F.compile('crossunder(close, 2)').run(up), [null, false, false, false, false, false, true]);
});

test('mistakes come back as readable messages', () => {
  assert.equal(F.check('sma(close, 20)'), null);
  assert.match(F.check(''), /boş/);
  assert.match(F.check('sma(close)'), /sma 2 değer alır/);
  assert.match(F.check('sma(close, n)'), /sayı olarak yazılmalı/);
  assert.match(F.check('sma(close, 0)'), /periyot/);
  assert.match(F.check('foo(close)'), /Bilinmeyen fonksiyon "foo"/);
  assert.match(F.check('price > 3'), /Bilinmeyen değer "price"/);
  assert.match(F.check('close > '), /yarım/);
  assert.match(F.check('close > 1 and 2'), /koşul/);
  assert.match(F.check('(close > 1) + 2'), /sayı olmalı/);
  assert.match(F.check('close ; 2'), /Tanınmayan karakter/);
  assert.match(F.check('close', 'condition'), /koşul olmalı/);
  assert.match(F.check('x'.repeat(301)), /en fazla/);
  // Nothing is evaluated as JavaScript
  assert.match(F.check('constructor.constructor("return 1")()'), /Tanınmayan|Bilinmeyen|Beklenmeyen/);
});
