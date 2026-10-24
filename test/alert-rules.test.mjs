// Unit tests for the alert conditions (assets/js/alert-rules.js) and the e-mail check
// (scripts/check-alerts.mjs).
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { applyHits, mailFor, pendingEmailAlerts } from '../scripts/check-alerts.mjs';

const require = createRequire(import.meta.url);
const R = require('../assets/js/alert-rules.js');

const alert = (type, targetValue = 0, extra = {}) => ({ id: 'a1', ticker: 'THYAO', type, targetValue, triggered: false, ...extra });
// 60 flat days at 100, then the last close set by the test
const flat = (last, n = 60) => [...Array(n - 1).fill(100), last];

test('targets are checked per condition', () => {
  assert.equal(R.validTarget('price_above', 12.5), true);
  assert.equal(R.validTarget('price_above', 0), false);
  assert.equal(R.validTarget('rsi_below', 30), true);
  assert.equal(R.validTarget('rsi_below', 120), false);
  assert.equal(R.validTarget('sma_cross_up', 50), true);
  assert.equal(R.validTarget('sma_cross_up', 50.5), false);
  assert.equal(R.validTarget('golden_cross', NaN), true);
  assert.equal(R.validTarget('nope', 1), false);
  assert.equal(R.needsCloses('price_below'), false);
  assert.equal(R.needsCloses('macd_cross_up'), true);
});

test('price alerts compare the price with the target', () => {
  assert.ok(R.evaluate(alert('price_above', 300), { price: 301 }));
  assert.equal(R.evaluate(alert('price_above', 300), { price: 299 }), null);
  assert.ok(R.evaluate(alert('price_below', 300), { price: 300 }));
  assert.equal(R.evaluate(alert('price_below', 300, { triggered: true }), { price: 1 }), null);
});

test('RSI alerts use the given RSI, else RSI 14 of the closes', () => {
  assert.ok(R.evaluate(alert('rsi_above', 70), { rsi: 75 }));
  assert.equal(R.evaluate(alert('rsi_above', 70), { rsi: 65 }), null);
  // Falling every day: RSI near 0
  const down = Array.from({ length: 40 }, (_, i) => 200 - i);
  assert.ok(R.evaluate(alert('rsi_below', 30), { closes: down }));
  assert.equal(R.evaluate(alert('rsi_below', 30), { closes: [] }), null);
});

test('a cross fires only on the bar where it happened', () => {
  assert.equal(R.crossed([1, 3], [2, 2], true), true);
  assert.equal(R.crossed([3, 4], [2, 2], true), false);   // already above
  assert.equal(R.crossed([3, 1], [2, 2], false), true);
  assert.equal(R.crossed([null, 1], [2, 2], false), false);
  // Price jumps over its flat SMA 20 on the last day; the next day it is simply above
  assert.ok(R.evaluate(alert('sma_cross_up', 20), { closes: flat(110) }));
  assert.equal(R.evaluate(alert('sma_cross_up', 20), { closes: [...flat(110), 111] }), null);
  assert.ok(R.evaluate(alert('sma_cross_down', 20), { closes: flat(90) }));
  assert.equal(R.evaluate(alert('sma_cross_up', 20), { closes: [100, 110] }), null);   // too short
});

test('golden cross: SMA 50 rises over SMA 200 on the last bar', () => {
  // 200 days at 100, then a climb; find the first day SMA 50 is above SMA 200
  const closes = [...Array(200).fill(100)];
  let fired = -1;
  for (let i = 0; i < 60 && fired < 0; i++) {
    closes.push(100 + i);
    if (R.evaluate(alert('golden_cross'), { closes })) fired = i;
  }
  assert.ok(fired >= 0);
  assert.equal(R.evaluate(alert('golden_cross'), { closes: [...closes, 200] }), null);
  assert.equal(R.evaluate(alert('death_cross'), { closes }), null);
});

test('MACD crosses its signal line', () => {
  // A speeding-up fall keeps the MACD line under its signal; a sharp turn up crosses it
  const closes = Array.from({ length: 80 }, (_, i) => 200 - (i * i) / 40);
  assert.equal(R.evaluate(alert('macd_cross_up'), { closes }), null);
  let fired = false;
  for (let i = 0; i < 20 && !fired; i++) {
    closes.push(closes[closes.length - 1] + 4);
    fired = !!R.evaluate(alert('macd_cross_up'), { closes });
  }
  assert.ok(fired);
});

test('badges name the condition', () => {
  assert.equal(R.badge(alert('sma_cross_up', 50)), 'Fiyat ↑ SMA 50');
  assert.equal(R.badge(alert('golden_cross')), 'Golden cross');
});

test('the e-mail check marks hits triggered and moves alertsAt', () => {
  const data = {
    v: 1, alertsAt: 5,
    alerts: [
      alert('price_above', 300, { id: 'mail', email: true }),
      alert('price_above', 300, { id: 'page-only' }),
      alert('price_above', 900, { id: 'not-yet', email: true }),
      alert('price_above', 300, { id: 'other', ticker: 'GARAN', email: true })
    ]
  };
  assert.deepEqual(pendingEmailAlerts(data).map(a => a.id), ['mail', 'not-yet', 'other']);
  const now = new Date('2026-10-24T08:30:00Z');
  const { data: out, hits } = applyHits(data, { THYAO: { price: 310, closes: [] } }, now);
  assert.deepEqual(hits.map(h => h.alert.id), ['mail']);
  assert.equal(out.alerts[0].triggered, true);
  assert.equal(out.alerts[0].triggeredAt, '11:30');
  assert.equal(out.alerts[1].triggered, false);
  assert.equal(out.alerts[3].triggered, false);      // GARAN had no prices
  assert.equal(out.alertsAt, now.getTime());
  // Nothing fired: the data comes back as it was
  const none = applyHits(data, { THYAO: { price: 1 } }, now);
  assert.equal(none.data, data);
  assert.equal(none.hits.length, 0);
});

test('one mail per account lists every hit with a link', () => {
  const mail = mailFor([{ alert: alert('price_above', 300, { note: '<direnç>' }), text: 'Fiyat hedefe ulaştı' }], 'https://x.test');
  assert.equal(mail.subject, 'ONCAL alarmı: THYAO');
  assert.match(mail.text, /https:\/\/x\.test\/hisse\/THYAO/);
  assert.match(mail.html, /&lt;direnç&gt;/);
});
