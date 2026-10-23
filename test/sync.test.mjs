// Unit tests for the account sync merge rules (assets/js/sync.js) and the /api/config gate.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../assets/js/sync.js');

const tx = (id, code, pf = 'main') => ({ id, type: 'buy', code, qty: 1, price: 1, date: '2026-01-01', pf, seq: Number(id.replace(/\D/g, '')) || 0 });
const profile = over => ({ v: 2, name: '', portfolios: [{ id: 'main', name: 'Ana portföy' }], active: 'main', txs: [], journal: [], views: [], cmds: [], saved: [], notes: {}, levels: {}, targets: {}, cash: {}, gone: [], updatedAt: 0, ...over });

test('both sides keep what they added; the newer side sets the settings', () => {
  const a = profile({ name: 'Telefon', txs: [tx('tx_1', 'THYAO')], updatedAt: 100, since: '2026-02-01' });
  const b = profile({ name: 'Bilgisayar', txs: [tx('tx_2', 'ASELS')], updatedAt: 200, since: '2026-01-01' });
  const m = S.mergeProfiles(a, b);
  assert.equal(m.name, 'Bilgisayar');
  assert.deepEqual(m.txs.map(t => t.id).sort(), ['tx_1', 'tx_2']);
  assert.equal(m.since, '2026-01-01');
  assert.equal(m.updatedAt, 200);
  assert.equal(m.seq, 2);
  assert.deepEqual(S.mergeProfiles(b, a), m, 'the order of the sides does not matter');
});

test('deleted items stay deleted on both sides', () => {
  const a = profile({ txs: [tx('tx_1', 'THYAO'), tx('tx_2', 'ASELS')], journal: [{ id: 'j_1', at: 1, text: 'x' }], updatedAt: 100 });
  const b = profile({ txs: [tx('tx_2', 'ASELS')], gone: ['tx_1', 'j_1'], updatedAt: 50 });
  const m = S.mergeProfiles(a, b);
  assert.deepEqual(m.txs.map(t => t.id), ['tx_2']);
  assert.deepEqual(m.journal, []);
  assert.deepEqual(m.gone.sort(), ['j_1', 'tx_1']);
});

test('portfolios merge, a deleted portfolio takes its trades with it', () => {
  const a = profile({ portfolios: [{ id: 'main', name: 'Ana' }, { id: 'pf_t', name: 'Temettü' }], txs: [tx('tx_1', 'TUPRS', 'pf_t')], active: 'pf_t', updatedAt: 10 });
  const b = profile({ portfolios: [{ id: 'main', name: 'Ana portföy' }], gone: ['pf_t'], updatedAt: 20 });
  const m = S.mergeProfiles(a, b);
  assert.deepEqual(m.portfolios, [{ id: 'main', name: 'Ana portföy' }]);
  assert.deepEqual(m.txs, []);
  assert.equal(m.active, 'main');
});

test('views keep the latest visit and the highest count; commands and saved commands union', () => {
  const a = profile({ views: [{ code: 'THYAO', at: 5, n: 3 }], cmds: [{ text: 'al THYAO 1', at: 1, ok: true }], saved: ['yardım'], updatedAt: 1 });
  const b = profile({ views: [{ code: 'THYAO', at: 9, n: 1 }, { code: 'ASELS', at: 2, n: 1 }], cmds: [{ text: 'izle ASELS', at: 2, ok: true }], saved: ['performans'], updatedAt: 2 });
  const m = S.mergeProfiles(a, b);
  assert.deepEqual(m.views, [{ code: 'THYAO', at: 9, n: 3 }, { code: 'ASELS', at: 2, n: 1 }]);
  assert.deepEqual(m.cmds.map(c => c.text), ['izle ASELS', 'al THYAO 1']);
  assert.deepEqual(m.saved, ['performans', 'yardım']);
});

test('per-key settings: notes, levels and targets merge key by key', () => {
  const a = profile({ notes: { THYAO: 'eski', ASELS: 'a' }, targets: { main: { THYAO: 20 } }, levels: { THYAO: { stop: 1 } }, updatedAt: 1 });
  const b = profile({ notes: { THYAO: 'yeni' }, targets: { main: { ASELS: 30 } }, levels: { THYAO: { target: 9 } }, updatedAt: 2 });
  const m = S.mergeProfiles(a, b);
  assert.deepEqual(m.notes, { THYAO: 'yeni', ASELS: 'a' });
  assert.deepEqual(m.targets, { main: { THYAO: 20, ASELS: 30 } });
  assert.deepEqual(m.levels, { THYAO: { stop: 1, target: 9 } });
});

test('bundles: the watchlist and alerts come from the side that changed them last', () => {
  const local = { v: 1, profile: profile({}), watchlist: ['A'], watchAt: 5, alerts: [{ id: 1 }], alertsAt: 1 };
  const remote = { v: 1, profile: profile({}), watchlist: ['B'], watchAt: 3, alerts: [{ id: 2 }], alertsAt: 9 };
  const m = S.mergeBundles(local, remote);
  assert.deepEqual(m.watchlist, ['A']);
  assert.deepEqual(m.alerts, [{ id: 2 }]);
  assert.equal(m.watchAt, 5);
  assert.equal(S.mergeBundles(null, remote), remote);
});

test('an untouched browser counts as empty', () => {
  assert.equal(S.isEmptyBundle(null), true);
  assert.equal(S.isEmptyBundle({ profile: profile({}), watchlist: ['THYAO', 'GARAN'], alerts: [] }), true);
  assert.equal(S.isEmptyBundle({ profile: profile({ txs: [tx('tx_1', 'A')] }), alerts: [] }), false);
  assert.equal(S.isEmptyBundle({ profile: profile({}), alerts: [], watchAt: 7 }), false);
  assert.deepEqual(S.summary({ profile: profile({ txs: [tx('tx_1', 'A')] }), alerts: [{}], watchlist: ['A', 'B'] }), { txs: 1, portfolios: 1, journal: 0, alerts: 1, watchlist: 2 });
});

test('/api/config only hands out a well-formed Supabase project', async () => {
  const { supabaseConfig } = await import('../api/config.mjs');
  assert.equal(supabaseConfig({}), null);
  assert.equal(supabaseConfig({ SUPABASE_URL: 'https://evil.example.com', SUPABASE_ANON_KEY: 'x'.repeat(40) }), null);
  assert.equal(supabaseConfig({ SUPABASE_URL: 'https://abcd.supabase.co', SUPABASE_ANON_KEY: 'short' }), null);
  assert.deepEqual(supabaseConfig({ SUPABASE_URL: 'https://abcd.supabase.co/', SUPABASE_ANON_KEY: 'eyJ.abc-def_ghi.0123456789' }), { url: 'https://abcd.supabase.co', anonKey: 'eyJ.abc-def_ghi.0123456789', google: false });
  assert.equal(supabaseConfig({ SUPABASE_URL: 'https://abcd.supabase.co', SUPABASE_ANON_KEY: 'eyJ.abc-def_ghi.0123456789', SUPABASE_GOOGLE: '1' }).google, true);
  // Supabase's "Connect" .env names work too, and a broken SUPABASE_ANON_KEY does not hide a good one
  const pasted = supabaseConfig({ SUPABASE_ANON_KEY: 'sb_publishable_x', NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_0123456789abcdef' });
  assert.equal(pasted.anonKey, 'sb_publishable_0123456789abcdef');
});
