// Guards for addresses like /hisse/THYAO: the server must hand them the app, and the page must
// resolve its relative asset paths from the site root.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('<base href="/"> comes before the first relative asset path', () => {
  const base = html.indexOf('<base href="/">');
  const firstRelative = html.search(/(src|href)="(assets\/|manifest\.json)/);
  assert.ok(base > 0, 'base tag present');
  assert.ok(base < firstRelative, 'base tag precedes relative URLs');
});

test('every non-API path is rewritten to the app', () => {
  const rule = vercel.rewrites.find(r => r.destination === '/index.html');
  const re = new RegExp(`^${rule.source}$`);
  assert.ok(re.test('/hisse/THYAO'));
  assert.ok(!re.test('/api/quote'));
});

test('hash links that only run code do not navigate', () => {
  // With <base href="/">, a bare href="#" would leave a /hisse/... page; each needs a handler
  const bare = [...html.matchAll(/<a href="#"([^>]*)>/g)].filter(m => !/onclick=|data-view-target/.test(m[1]));
  assert.deepEqual(bare.map(m => m[0]), []);
});
