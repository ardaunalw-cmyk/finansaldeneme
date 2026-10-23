// Unit tests for the chat assistant's data tools (api/_chat-tools.mjs).
//
//   npm test
//
// Uses the real data files; the live price is passed in, so no network is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, loadData, searchCompanies, stockFacts, runTool } from '../api/_chat-tools.mjs';

const data = loadData();

test('tool definitions are strict and closed', () => {
  for (const tool of TOOLS) {
    assert.equal(tool.strict, true, tool.name);
    assert.equal(tool.input_schema.additionalProperties, false, tool.name);
    assert.ok(Array.isArray(tool.input_schema.required), tool.name);
  }
});

test('search finds a company by code and by Turkish name', () => {
  assert.equal(searchCompanies(data, 'thyao').sonuclar[0].kod, 'THYAO');
  const byName = searchCompanies(data, 'türk hava').sonuclar.map((r) => r.kod);
  assert.ok(byName.includes('THYAO'), byName.join(','));
  assert.deepEqual(searchCompanies(data, '').sonuclar, []);
});

test('stock facts compute ratios from the price and the balance sheet', () => {
  const code = Object.keys(data.fundamentals.data).find((c) => data.fundamentals.data[c][7] > 0 && data.fundamentals.data[c][2] > 0);
  const [, shares, equity, , , , , netIncome] = data.fundamentals.data[code];
  const facts = stockFacts(data, code, 10);
  assert.equal(facts.kod, code);
  assert.equal(facts.piyasa_degeri_tl, Math.round(10 * shares));
  assert.ok(Math.abs(facts.fk - (10 * shares) / netIncome) < 0.01);
  assert.ok(Math.abs(facts.pddd - (10 * shares) / equity) < 0.01);
  assert.ok(facts.veri_tarihleri.bilanco);
});

test('without a price, price-based ratios are null instead of estimated', () => {
  const code = Object.keys(data.fundamentals.data)[0];
  const facts = stockFacts(data, code, null);
  assert.equal(facts.fiyat_tl, null);
  assert.equal(facts.fk, null);
  assert.equal(facts.pddd, null);
  assert.equal(facts.fd_favok, null);
  assert.equal(facts.temettu_verimi_12ay_yuzde ?? null, null);
});

test('loss-making companies get no P/E', () => {
  const code = Object.keys(data.fundamentals.data).find((c) => data.fundamentals.data[c][7] < 0);
  assert.equal(stockFacts(data, code, 10).fk, null);
});

test('unknown codes and tools return an error object', async () => {
  assert.ok(stockFacts(data, 'ZZZZZ', 10).hata);
  assert.ok(JSON.parse(await runTool('hisse_verisi', { kod: 'not a code!' }, data)).hata);
  assert.ok(JSON.parse(await runTool('yok', {}, data)).hata);
  const sectors = JSON.parse(await runTool('sektor_carpanlari', {}, data));
  assert.ok(Object.keys(sectors.sektorler).length > 0);
});
