// Tests for the Vercel functions in api/ that need no network: method and parameter checks on
// every endpoint, and the gates of the chat endpoint (origin, rate limit, missing key, bad
// messages). Requests and responses are small fakes of Node's http objects.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ORIGIN = 'https://finansaldeneme.vercel.app';

/** Calls a handler and resolves with { status, body } once it ends the response. */
function call(handler, { method = 'GET', url = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      writeHead(status, h = {}) { this.statusCode = status; Object.entries(h).forEach(([k, v]) => this.setHeader(k, v)); return this; },
      end(data) {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch { /* not JSON */ }
        resolve({ status: this.statusCode, body: parsed, headers: this.headers });
      }
    };
    const req = { method, url, headers, body, socket: { remoteAddress: headers['x-forwarded-for'] || '127.0.0.1' } };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const endpoints = ['quote', 'history', 'financials', 'statements', 'disclosures', 'news', 'social'];

test('every GET endpoint refuses other methods', async () => {
  for (const name of endpoints) {
    const { default: handler } = await import(`../api/${name}.mjs`);
    const r = await call(handler, { method: 'POST', url: `/api/${name}` });
    assert.equal(r.status, 405, name);
  }
});

test('invalid parameters are refused before any data source is called', async () => {
  const cases = [
    ['quote', '/api/quote'],
    ['history', '/api/history?symbol=THYAO&range=99y&interval=1d'],
    ['history', '/api/history?symbol=THYAO&range=1y&interval=2m'],
    ['history', '/api/history?symbol=../etc&range=1y&interval=1d'],
    ['financials', '/api/financials?symbol=TOO-LONG-CODE'],
    ['statements', '/api/statements?symbol=THYAO&exchange=EUR'],
    ['news', '/api/news?cat=nope']
  ];
  for (const [name, url] of cases) {
    const { default: handler } = await import(`../api/${name}.mjs`);
    const r = await call(handler, { url });
    assert.equal(r.status, 400, url);
  }
});

const chatBody = (content = 'THYAO nasıl?') => ({ messages: [{ role: 'user', content }], context: { view: 'stock-detail', stock: 'THYAO' } });

test('chat: the page context keeps only codes and weights of the portfolio', async () => {
  const { contextNote } = await import('../api/chat.mjs');
  assert.equal(contextNote(null), null);
  assert.equal(contextNote({}), null);
  const note = contextNote({
    view: 'profile', stock: null,
    portfolio: [{ c: 'THYAO', w: 60 }, { c: 'ASELS' }, { c: '<script>', w: 5 }, { c: 'BIMAS', w: 900 }, 'x']
  });
  assert.match(note, /sayfa=profile/);
  assert.match(note, /THYAO %60, ASELS, BIMAS\./);
  assert.ok(!note.includes('script'));
});

test('chat: only POST, only from the site', async () => {
  const { default: chat } = await import('../api/chat.mjs');
  assert.equal((await call(chat, { method: 'GET' })).status, 405);
  assert.equal((await call(chat, { method: 'POST', headers: {}, body: chatBody() })).status, 403);
  assert.equal((await call(chat, { method: 'POST', headers: { origin: 'https://evil.example' }, body: chatBody() })).status, 403);
});

test('chat: without an API key it says so instead of failing', async () => {
  const { default: chat } = await import('../api/chat.mjs');
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const r = await call(chat, { method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': '10.0.0.1' }, body: chatBody() });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'not_configured');
    assert.ok(r.body.reply);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('chat: malformed conversations are refused before the model is called', async () => {
  const { default: chat } = await import('../api/chat.mjs');
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
  try {
    const bad = [
      {},
      { messages: [] },
      { messages: [{ role: 'system', content: 'x' }] },
      { messages: [{ role: 'user', content: 42 }] },
      { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] },
      { messages: Array.from({ length: 10 }, () => ({ role: 'user', content: 'x'.repeat(2000) })) }
    ];
    for (const [i, body] of bad.entries()) {
      const r = await call(chat, { method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': `10.0.1.${i}` }, body });
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    }
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('chat: one client is rate limited after a burst', async () => {
  const { default: chat } = await import('../api/chat.mjs');
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;   // each call stops at the key check, no model call
  try {
    const statuses = [];
    for (let i = 0; i < 14; i++) {
      statuses.push((await call(chat, { method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': '10.9.9.9' }, body: chatBody() })).status);
    }
    assert.deepEqual(statuses.slice(0, 12), Array(12).fill(503));
    assert.equal(statuses[12], 429);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});
