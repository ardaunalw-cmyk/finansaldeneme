/**
 * Tarayıcı: a full-page technical screener over every listed company, from the daily snapshot
 * in assets/data/technicals.json (scripts/fetch-technicals.mjs) and the company list (sector,
 * BIST 30). Ready-made scans, a rule builder (field, comparison, value), a sortable result table,
 * scans saved in this browser and a CSV download.
 */
const Screener = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SAVE_KEY = 'oncal.screener.saved';

  /** The snapshot's columns: label, short header, and whether it is a percent. */
  const FIELDS = {
    close: ['Fiyat (TL)', 'Fiyat'], d1: ['1 günlük getiri %', '1G', true], w1: ['1 haftalık getiri %', '1H', true],
    m1: ['1 aylık getiri %', '1A', true], m3: ['3 aylık getiri %', '3A', true], rsi: ['RSI (14)', 'RSI'],
    s20: ['SMA 20 uzaklığı %', 'S20', true], s50: ['SMA 50 uzaklığı %', 'S50', true], s200: ['SMA 200 uzaklığı %', 'S200', true],
    hi52: ['52 hafta zirvesine uzaklık %', 'Zirve', true], lo52: ['52 hafta dibinden uzaklık %', 'Dip', true],
    vol: ['Hacim / 20 günlük ortalama', 'Hacim×'], macd: ['MACD histogram yönü (1 / -1)', 'MACD']
  };
  const OPS = { '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b };

  /**
   * Ready scans: rules, or a test on the whole row (SMA 50 above SMA 200 is s50 < s200, both being
   * the price's distance from the average), and the column to sort by.
   */
  const PRESETS = {
    oversold: { label: 'Aşırı satım', desc: 'RSI 30 altında', rules: [['rsi', '<', 30]], sort: ['rsi', 1] },
    overbought: { label: 'Aşırı alım', desc: 'RSI 70 üstünde', rules: [['rsi', '>', 70]], sort: ['rsi', -1] },
    trend: { label: 'Güçlü yükseliş trendi', desc: 'Fiyat SMA 50 ve 200 üstünde, SMA 50 > SMA 200', rules: [['s50', '>', 0], ['s200', '>', 0]], test: r => r.s50 < r.s200, sort: ['m3', -1] },
    golden: { label: 'Golden cross bölgesi', desc: 'SMA 50, SMA 200 üstünde ve aralarındaki fark %3 içinde (yeni kesişim)', rules: [], test: r => r.s50 < r.s200 && (1 + r.s200 / 100) / (1 + r.s50 / 100) < 1.03, sort: ['w1', -1] },
    nearHigh: { label: '52 hafta zirvesinde', desc: 'Zirveye %3 ya da daha yakın', rules: [['hi52', '>=', -3]], sort: ['hi52', -1] },
    nearLow: { label: '52 hafta dibinde', desc: 'Dibin en fazla %5 üstünde', rules: [['lo52', '<=', 5]], sort: ['lo52', 1] },
    volume: { label: 'Hacim patlaması', desc: 'Hacim 20 günlük ortalamanın 2 katından fazla', rules: [['vol', '>=', 2]], sort: ['vol', -1] },
    macdTurn: { label: 'MACD pozitif, RSI dengeli', desc: 'MACD histogramı artıda, RSI 45-65 arası', rules: [['macd', '>', 0], ['rsi', '>=', 45], ['rsi', '<=', 65]], sort: ['w1', -1] },
    weekly: { label: 'Haftanın yükselenleri', desc: '1 haftalık getiriye göre', rules: [['w1', '>', 0]], sort: ['w1', -1] },
    downtrend: { label: 'Düşüş trendi', desc: 'Fiyat SMA 50 ve 200 altında', rules: [['s50', '<', 0], ['s200', '<', 0]], sort: ['m3', 1] }
  };

  /** Rows that pass every rule ([field, op, value]) and the optional test; missing values fail. */
  function applyRules(rows, rules, test) {
    return rows.filter(r => rules.every(([f, op, v]) => r[f] != null && Number.isFinite(r[f]) && OPS[op] && OPS[op](r[f], Number(v)))
      && (!test || test(r)));
  }

  function sortRows(rows, [field, dir]) {
    return rows.slice().sort((a, b) => {
      const x = a[field], y = b[field];
      if (x == null) return 1;
      if (y == null) return -1;
      return typeof x === 'string' ? x.localeCompare(y, 'tr') * dir : (x - y) * dir;
    });
  }

  const state = {
    rows: null, asOf: '', status: 'idle',
    rules: [['rsi', '<', 30]], test: null, preset: 'oversold',
    sector: '', bist30: false, sort: ['rsi', 1], limit: 100
  };

  async function load() {
    state.status = 'loading';
    paint();
    try {
      const r = await fetch('/assets/data/technicals.json');
      const j = await r.json();
      const companies = typeof getFullBistStockList === 'function' ? getFullBistStockList() : [];
      const byCode = new Map(companies.map(c => [c.code, c]));
      state.rows = Object.entries(j.data).map(([code, vals]) => {
        const row = { code };
        j.fields.forEach((f, i) => { row[f] = vals[i]; });
        const c = byCode.get(code);
        row.name = c ? c.name : code;
        row.sector = c ? c.sector : '';
        row.bist30 = !!(c && c.isBist30);
        return row;
      });
      state.asOf = j.asOf || '';
      state.status = 'ok';
    } catch {
      state.status = 'error';
    }
    paint();
  }

  function results() {
    if (!state.rows) return [];
    let rows = applyRules(state.rows, state.rules, state.test);
    if (state.sector) rows = rows.filter(r => r.sector === state.sector);
    if (state.bist30) rows = rows.filter(r => r.bist30);
    return sortRows(rows, state.sort);
  }

  const fmt = (v, pct) => (v == null || !Number.isFinite(v) ? '—'
    : pct ? `${v > 0 ? '+' : ''}${v.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}` : v.toLocaleString('tr-TR', { maximumFractionDigits: 2 }));
  const tone = (f, v) => {
    if (v == null) return 'text-slate-500';
    if (f === 'rsi') return v < 30 ? 'text-emerald-400' : v > 70 ? 'text-rose-400' : 'text-slate-200';
    if (f === 'macd') return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-400';
    if (f === 'vol') return v >= 2 ? 'text-amber-300' : 'text-slate-200';
    if (FIELDS[f] && FIELDS[f][2]) return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-300';
    return 'text-slate-200';
  };

  function savedScans() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || []; } catch { return []; } }
  function saveScans(list) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(list.slice(0, 20))); } catch { /* not kept */ } }

  function paintControls() {
    const el = $('scControls');
    if (!el) return;
    const sectors = state.rows ? [...new Set(state.rows.map(r => r.sector).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr')) : [];
    const select = (name, value, options) => `<select data-sc="${name}" class="px-2 py-1.5 rounded-lg bg-[#070B14] border border-[#1A2540] text-white text-xs">${options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    const saved = savedScans();
    el.innerHTML = `
      <div class="flex flex-wrap gap-2">
        ${Object.entries(PRESETS).map(([k, p]) => `<button type="button" data-sc-preset="${k}" title="${esc(p.desc)}"
          class="px-3 py-1.5 rounded-xl text-xs font-semibold border ${state.preset === k ? 'bg-[#2F6BFF] border-[#2F6BFF] text-white' : 'border-[#1A2540] text-slate-400 hover:text-white'}">${esc(p.label)}</button>`).join('')}
      </div>
      <div class="p-4 rounded-2xl border border-[#1A2540] bg-[#0C1322] space-y-2">
        <div class="text-[10px] font-mono uppercase tracking-widest text-slate-500">Kriterler ${state.test ? `· ${esc(PRESETS[state.preset] ? PRESETS[state.preset].desc : '')}` : ''}</div>
        ${state.rules.map(([f, op, v], i) => `
          <div class="flex flex-wrap items-center gap-2">
            ${select(`field:${i}`, f, Object.entries(FIELDS).map(([k, d]) => [k, d[0]]))}
            ${select(`op:${i}`, op, Object.keys(OPS).map(o => [o, o]))}
            <input data-sc="value:${i}" type="number" step="any" value="${esc(v)}" class="w-24 px-2 py-1.5 rounded-lg bg-[#070B14] border border-[#1A2540] text-white text-xs font-mono">
            <button type="button" data-sc-del="${i}" class="px-2 text-slate-500 hover:text-white" aria-label="Kriteri sil">×</button>
          </div>`).join('') || '<p class="text-xs text-slate-500">Kriter yok: tüm şirketler listelenir.</p>'}
        <div class="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" data-sc-add class="px-3 py-1.5 rounded-xl border border-[#2F6BFF] bg-[#2F6BFF]/20 text-xs text-white">+ Kriter ekle</button>
          ${select('sector', state.sector, [['', 'Tüm sektörler'], ...sectors.map(s => [s, s])])}
          <label class="flex items-center gap-1.5 text-xs text-slate-300"><input type="checkbox" data-sc="bist30" ${state.bist30 ? 'checked' : ''} class="accent-[#2F6BFF]">Yalnızca BIST 30</label>
          <span class="ml-auto flex gap-2">
            <button type="button" data-sc-save class="px-3 py-1.5 rounded-xl border border-[#1A2540] text-xs text-slate-300 hover:text-white"><i class="fa-regular fa-floppy-disk mr-1"></i>Taramayı kaydet</button>
            <button type="button" data-sc-csv class="px-3 py-1.5 rounded-xl border border-[#1A2540] text-xs text-slate-300 hover:text-white"><i class="fa-solid fa-file-csv mr-1"></i>CSV</button>
          </span>
        </div>
        ${saved.length ? `<div class="flex flex-wrap items-center gap-2 pt-1 text-xs"><span class="text-slate-500">Kayıtlı:</span>
          ${saved.map((s, i) => `<span class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md border border-[#1A2540]"><button type="button" data-sc-load="${i}" class="text-slate-200 hover:text-white">${esc(s.name)}</button><button type="button" data-sc-unsave="${i}" class="px-1 text-slate-500 hover:text-white" aria-label="Kaydı sil">×</button></span>`).join('')}</div>` : ''}
      </div>`;
  }

  const COLUMNS = ['close', 'd1', 'w1', 'm1', 'm3', 'rsi', 's50', 's200', 'hi52', 'vol', 'macd'];

  function paintTable() {
    const el = $('scTable');
    if (!el) return;
    if (state.status === 'loading' || state.status === 'idle') { el.innerHTML = '<p class="text-xs text-slate-500 text-center py-10"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Veriler yükleniyor...</p>'; return; }
    if (state.status === 'error') { el.innerHTML = '<p class="text-sm text-rose-400 text-center py-10">Teknik veriler yüklenemedi.</p>'; return; }
    const rows = results();
    const head = (f, label, right = true) => {
      const on = state.sort[0] === f;
      return `<th class="py-2 px-2 ${right ? 'text-right' : 'text-left'}"><button type="button" data-sc-sort="${f}" class="${on ? 'text-white' : 'text-slate-400 hover:text-white'}">${label}${on ? (state.sort[1] > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
    };
    el.innerHTML = `
      <div class="flex items-center justify-between text-xs text-slate-400 mb-2">
        <span><b class="text-white">${rows.length}</b> şirket eşleşti${rows.length > state.limit ? ` · ilk ${state.limit} gösteriliyor` : ''}</span>
        <span class="font-mono text-[10px]">Veri tarihi: ${esc(state.asOf)} (günlük kapanış)</span>
      </div>
      <div class="overflow-x-auto rounded-2xl border border-[#1A2540] bg-[#0C1322]">
        <table class="w-full text-[11px] font-mono">
          <thead class="bg-[#0A101C] sticky top-0"><tr>${head('code', 'Kod', false)}${head('sector', 'Sektör', false)}${COLUMNS.map(f => head(f, FIELDS[f][1])).join('')}</tr></thead>
          <tbody>${rows.slice(0, state.limit).map(r => `
            <tr data-sc-go="${esc(r.code)}" class="border-t border-[#162238] hover:bg-[#121C30] cursor-pointer">
              <td class="py-1.5 px-2"><span class="text-white font-bold">${esc(r.code)}</span>${r.bist30 ? ' <span class="text-[9px] text-red-300">30</span>' : ''}<span class="block text-[10px] text-slate-500 font-sans truncate max-w-[10rem]">${esc(r.name)}</span></td>
              <td class="py-1.5 px-2 text-slate-400 font-sans truncate max-w-[9rem]">${esc(r.sector)}</td>
              ${COLUMNS.map(f => `<td class="py-1.5 px-2 text-right ${tone(f, r[f])}">${fmt(r[f], FIELDS[f][2])}</td>`).join('')}
            </tr>`).join('')}</tbody>
        </table>
      </div>
      ${rows.length > state.limit ? '<div class="text-center mt-3"><button type="button" data-sc-more class="px-4 py-2 rounded-xl border border-[#1A2540] text-xs text-slate-300 hover:text-white">Daha fazla göster</button></div>' : ''}
      <p class="text-[10px] text-slate-500 font-mono mt-2">S50/S200: fiyatın ortalamaya uzaklığı (%). Zirve: 52 hafta zirvesine uzaklık (%). Hacim×: son günün hacmi / 20 günlük ortalama. Yatırım tavsiyesi değildir.</p>`;
  }

  function paint() { paintControls(); paintTable(); }

  function render() {
    if (!state.rows && state.status !== 'loading') load(); else paint();
  }

  function preset(k) {
    const p = PRESETS[k];
    state.preset = k;
    state.rules = p.rules.map(r => r.slice());
    state.test = p.test || null;
    state.sort = p.sort.slice();
    state.limit = 100;
    paint();
  }

  /** Any edit to the rules leaves the preset (its extra test included). */
  const custom = () => { state.preset = ''; state.test = null; };

  function csv() {
    const rows = results();
    const cols = ['code', 'name', 'sector', ...COLUMNS];
    const cell = v => (v == null ? '' : /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const text = [cols.join(';'), ...rows.map(r => cols.map(c => cell(r[c])).join(';'))].join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `tarama-${state.asOf || 'bugun'}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function init() {
    const view = $('view-screener');
    if (!view) return;
    view.addEventListener('click', e => {
      const t = e.target;
      const p = t.closest('[data-sc-preset]');
      if (p) { preset(p.dataset.scPreset); return; }
      if (t.closest('[data-sc-add]')) { custom(); state.rules.push(['rsi', '<', 50]); paint(); return; }
      const del = t.closest('[data-sc-del]');
      if (del) { custom(); state.rules.splice(Number(del.dataset.scDel), 1); paint(); return; }
      const sort = t.closest('[data-sc-sort]');
      if (sort) {
        const f = sort.dataset.scSort;
        state.sort = state.sort[0] === f ? [f, -state.sort[1]] : [f, ['code', 'sector'].includes(f) ? 1 : -1];
        paintTable();
        return;
      }
      if (t.closest('[data-sc-more]')) { state.limit += 100; paintTable(); return; }
      if (t.closest('[data-sc-csv]')) { csv(); return; }
      if (t.closest('[data-sc-save]')) {
        const name = (prompt('Taramaya bir ad ver', PRESETS[state.preset] ? PRESETS[state.preset].label : 'Taramam') || '').trim().slice(0, 30);
        if (!name) return;
        saveScans([{ name, rules: state.rules, sector: state.sector, bist30: state.bist30, sort: state.sort, preset: state.preset }, ...savedScans()]);
        paintControls();
        return;
      }
      const load = t.closest('[data-sc-load]');
      if (load) {
        const s = savedScans()[Number(load.dataset.scLoad)];
        if (!s) return;
        Object.assign(state, { rules: s.rules || [], sector: s.sector || '', bist30: !!s.bist30, sort: s.sort || ['code', 1], preset: s.preset || '', limit: 100 });
        state.test = PRESETS[state.preset] && PRESETS[state.preset].test || null;
        paint();
        return;
      }
      const un = t.closest('[data-sc-unsave]');
      if (un) { const list = savedScans(); list.splice(Number(un.dataset.scUnsave), 1); saveScans(list); paintControls(); return; }
      const go = t.closest('[data-sc-go]');
      if (go && typeof selectStock === 'function') selectStock(go.dataset.scGo);
    });
    view.addEventListener('change', e => {
      const key = e.target.dataset.sc;
      if (!key) return;
      const [what, i] = key.split(':');
      if (what === 'sector') state.sector = e.target.value;
      else if (what === 'bist30') state.bist30 = e.target.checked;
      else {
        custom();
        const slot = { field: 0, op: 1, value: 2 }[what];
        state.rules[Number(i)][slot] = what === 'value' ? Number(e.target.value) : e.target.value;
      }
      paint();
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { render, applyRules, sortRows, PRESETS };
})();

if (typeof window !== 'undefined') window.Screener = Screener;
