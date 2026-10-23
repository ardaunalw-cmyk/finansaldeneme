// Tools the chat assistant can call to answer with the site's real data
// (files starting with "_" are not routed by Vercel).
//
// Data comes from the same files the site uses: assets/data/*.json (balance sheet summaries,
// sector medians, dividends) and the KAP registry in assets/js/kap-database.js. Prices are
// fetched live (delayed) from Yahoo Finance. A value that can't be computed is returned as
// null, never estimated.
import { readFileSync } from 'node:fs';
import { yahooChart } from './_yahoo.mjs';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

let cached = null;

// Loaded once per warm serverless instance
export function loadData() {
  if (cached) return cached;
  const fundamentals = readJson('../assets/data/fundamentals.json');
  const multiples = readJson('../assets/data/sector-multiples.json');
  const dividends = readJson('../assets/data/dividends.json');

  const line = readFileSync(new URL('../assets/js/kap-database.js', import.meta.url), 'utf8').split('\n')[2];
  const registry = JSON.parse(line.replace(/^const KAP_RAW_COMPANIES = /, '').replace(/;\s*$/, ''));
  const companies = {};
  registry.forEach((c) => {
    const code = (c.c || '').split(',')[0].trim().toUpperCase();
    if (code) companies[code] = { name: c.n || '', sector: c.sec || '' };
  });

  cached = { fundamentals, multiples, dividends, companies };
  return cached;
}

export const TOOLS = [
  {
    name: 'hisse_ara',
    description: 'BIST şirketlerini koda veya şirket adına göre arar. Kullanıcı bir şirketi adıyla andığında (ör. "Türk Hava Yolları") önce bununla kodunu bul. En fazla 8 sonuç döner: kod, ad, KAP sektörü.',
    input_schema: {
      type: 'object',
      properties: { sorgu: { type: 'string', description: 'Hisse kodu veya şirket adının bir parçası' } },
      required: ['sorgu'],
      additionalProperties: false
    },
    strict: true
  },
  {
    name: 'hisse_verisi',
    description: 'Bir BIST hissesinin sitedeki gerçek verisini döner: gecikmeli fiyat, piyasa değeri, F/K, PD/DD, FD/FAVÖK, ROE, net borç, son 12 ay satış/FAVÖK/net kâr (TL), bilanço dönemi, sektör medyan F/K ve PD/DD, son 2 yılın nakit temettüleri ve temettü verimi. Değeri hesaplanamayan alanlar null gelir.',
    input_schema: {
      type: 'object',
      properties: { kod: { type: 'string', description: 'Hisse kodu, ör. THYAO' } },
      required: ['kod'],
      additionalProperties: false
    },
    strict: true
  },
  {
    name: 'sektor_carpanlari',
    description: 'KAP sektörlerine göre medyan F/K ve PD/DD değerlerini ve her sektördeki şirket sayısını döner (sitenin Sektör bölümündeki veri).',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true
  }
];

const normalize = (s) => String(s).toLocaleUpperCase('tr-TR').trim();
const round = (v, digits = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : null);

export function searchCompanies(data, query) {
  const q = normalize(query);
  if (!q) return { sonuclar: [] };
  const rows = Object.entries(data.companies);
  const exact = rows.filter(([code]) => code === q);
  const partial = rows.filter(([code, c]) => code !== q && (code.startsWith(q) || normalize(c.name).includes(q)));
  return {
    sonuclar: [...exact, ...partial].slice(0, 8).map(([code, c]) => ({ kod: code, ad: c.name, sektor: c.sector }))
  };
}

// Pure part of hisse_verisi: everything except the live price lookup
export function stockFacts(data, code, price) {
  const company = data.companies[code];
  const row = data.fundamentals.data[code];
  if (!company && !row) return { hata: `${code} kodlu bir şirket bulunamadı. Adıyla aramak için hisse_ara aracını kullan.` };

  const facts = {
    kod: code,
    ad: company?.name ?? null,
    sektor: company?.sector ?? null,
    fiyat_tl: round(price),
    fiyat_kaynagi: price != null ? 'Yahoo Finance (gecikmeli)' : 'fiyat alınamadı'
  };

  if (row) {
    // [period, shares, equity, totalAssets, netDebt, revenue, ebitda, netIncome], trailing 12 months
    const [period, shares, equity, totalAssets, netDebt, revenue, ebitda, netIncome] = row;
    const mcap = price != null ? price * shares : null;
    Object.assign(facts, {
      bilanco_donemi: period,
      piyasa_degeri_tl: round(mcap, 0),
      fk: mcap != null && netIncome > 0 ? round(mcap / netIncome) : null,
      pddd: mcap != null && equity > 0 ? round(mcap / equity) : null,
      fd_favok: mcap != null && ebitda > 0 ? round((mcap + netDebt) / ebitda) : null,
      roe_yuzde: equity > 0 ? round((netIncome / equity) * 100, 1) : null,
      ozkaynak_tl: equity,
      toplam_varlik_tl: totalAssets,
      net_borc_tl: netDebt,
      satis_12ay_tl: revenue,
      favok_12ay_tl: ebitda,
      net_kar_12ay_tl: netIncome
    });
  } else {
    facts.bilanco_notu = 'Bu şirketin bilanço özeti sitede yok (banka/sigorta veya eksik veri olabilir).';
  }

  const sector = company?.sector && data.multiples.sectors[company.sector];
  facts.sektor_medyan = sector ? { fk: sector.pe, pddd: sector.pb, sirket_sayisi: sector.n } : null;

  const div = data.dividends.data[code];
  if (div?.d?.length) {
    const yearAgo = Date.now() - 365 * 24 * 3600 * 1000;
    const last12 = div.d.filter(([date]) => Date.parse(date) >= yearAgo).reduce((sum, [, amount]) => sum + amount, 0);
    facts.temettuler = div.d.map(([tarih, hisse_basi_tl]) => ({ tarih, hisse_basi_tl }));
    facts.temettu_verimi_12ay_yuzde = price != null && last12 > 0 ? round((last12 / price) * 100) : null;
  } else {
    facts.temettuler = [];
  }

  facts.veri_tarihleri = {
    bilanco: data.fundamentals.generatedAt,
    sektor_medyanlari: data.multiples.generatedAt,
    temettu: data.dividends.generatedAt
  };
  return facts;
}

async function livePrice(code) {
  const meta = (await yahooChart(`${code}.IS`, { range: '1d', interval: '1d' }, 5000))?.meta;
  return typeof meta?.regularMarketPrice === 'number' && meta.regularMarketPrice > 0 ? meta.regularMarketPrice : null;
}

// Runs one tool call; always returns a JSON string for the tool_result block
export async function runTool(name, input, data = loadData()) {
  if (name === 'hisse_ara') return JSON.stringify(searchCompanies(data, input?.sorgu ?? ''));
  if (name === 'hisse_verisi') {
    const code = normalize(input?.kod ?? '').replace(/\.IS$/, '');
    if (!/^[A-Z0-9]{2,6}$/.test(code)) return JSON.stringify({ hata: 'Geçersiz hisse kodu.' });
    return JSON.stringify(stockFacts(data, code, await livePrice(code)));
  }
  if (name === 'sektor_carpanlari') {
    return JSON.stringify({ tum_piyasa: data.multiples.all, sektorler: data.multiples.sectors, tarih: data.multiples.generatedAt });
  }
  return JSON.stringify({ hata: `Bilinmeyen araç: ${name}` });
}
