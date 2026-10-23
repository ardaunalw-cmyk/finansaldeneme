// Tests for the service worker's offline fallbacks (sw.js), run in a fake worker scope.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** Loads sw.js with a cache holding `cached` (url -> body) and a network that is down. */
function worker(cached = {}) {
  const listeners = {};
  const store = new Map(Object.entries(cached).map(([u, body]) => [new URL(u, 'https://site.test/').href, new Response(body)]));
  const match = async req => {
    const r = store.get(new URL(typeof req === 'string' ? req : req.url, 'https://site.test/').href);
    return r ? r.clone() : undefined;
  };
  const self = {
    location: new URL('https://site.test/sw.js'),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: () => {} }
  };
  const context = {
    self, URL, Response,
    caches: { match, open: async () => ({ match, put: async () => {}, addAll: async () => {}, keys: async () => [], delete: async () => {} }), keys: async () => [] },
    fetch: () => Promise.reject(new TypeError('offline')),
    console
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), context);
  return async (url, mode = 'cors') => {
    let responded = null;
    listeners.fetch({ request: { method: 'GET', url: new URL(url, 'https://site.test/').href, mode }, respondWith: p => { responded = p; } });
    return responded;
  };
}

test('offline: a cached file comes from the cache', async () => {
  const res = await worker({ '/assets/data/technicals.json': '{"ok":1}' })('/assets/data/technicals.json');
  assert.equal(await res.text(), '{"ok":1}');
});

test('offline: a page navigation falls back to the cached app shell', async () => {
  const res = await worker({ './index.html': '<html>shell</html>' })('/hisse/THYAO', 'navigate');
  assert.equal(await res.text(), '<html>shell</html>');
});

test('offline: anything else is a network error response, not undefined', async () => {
  const res = await worker()('/assets/data/fundamentals.json');
  assert.ok(res instanceof Response, 'respondWith always gets a Response');
  assert.equal(res.type, 'error');
  const nav = await worker()('/', 'navigate');
  assert.equal(nav.type, 'error');
});

test('API calls are left to the network', async () => {
  assert.equal(await worker()('/api/quote?symbols=THYAO'), null);
});
