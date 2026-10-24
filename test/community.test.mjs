// Unit tests for the pure helpers of the Topluluk feed (assets/js/community.js).
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// A browser script: run it with no document, so only its helpers load
const context = {};
vm.createContext(context);
vm.runInContext(`${readFileSync(new URL('../assets/js/community.js', import.meta.url), 'utf8')}\nthis.Community = Community;`, context);
const { formatBody, timeAgo, checkPost, nameFromEmail } = context.Community;

test('post text is escaped before tickers and line breaks are added', () => {
  const html = formatBody('<img src=x onerror=alert(1)> $thyao yükselir\n\n\n\nbence');
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /data-cm="stock:THYAO"[^>]*>\$THYAO<\/button>/);
  assert.equal((html.match(/<br>/g) || []).length, 2);
  // A quote cannot break out of the attribute the ticker sits in
  assert.ok(!formatBody('$AB"onclick=x').includes('"onclick'));
});

test('times read as minutes, hours, days, then a date', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  assert.equal(timeAgo('2026-10-24T11:59:30Z', now), 'az önce');
  assert.equal(timeAgo('2026-10-24T11:15:00Z', now), '45 dk');
  assert.equal(timeAgo('2026-10-24T07:00:00Z', now), '5 sa');
  assert.equal(timeAgo('2026-10-21T12:00:00Z', now), '3 gün');
  assert.match(timeAgo('2026-09-01T12:00:00Z', now), /2026/);
});

test('a post is checked before it goes out', () => {
  const ok = { author: 'Arda', body: 'THYAO için hedef 300', ticker: 'THYAO', stance: 'al' };
  assert.equal(checkPost(ok), null);
  assert.match(checkPost({ ...ok, author: 'A' }), /Görünen ad/);
  assert.match(checkPost({ ...ok, body: 'ok' }), /en az 3/);
  assert.match(checkPost({ ...ok, body: 'x'.repeat(1001) }), /1000/);
  assert.match(checkPost({ ...ok, ticker: 'thy ao' }), /Hisse kodu/);
  assert.match(checkPost({ ...ok, stance: 'buy' }), /Görüş/);
  assert.equal(checkPost({ ...ok, ticker: null, stance: null }), null);
});

test('the default display name is the start of the e-mail address', () => {
  assert.equal(nameFromEmail('arda.unal+x@gmail.com'), 'arda.unal');
  assert.equal(nameFromEmail(null), '');
});
