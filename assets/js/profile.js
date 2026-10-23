/**
 * Profil: yatırımcının kendi sayfası.
 *
 *  - Portföy: alış/satış kayıtlarından ortalama maliyet, gecikmeli fiyatla değer ve kâr/zarar,
 *    bugünkü değişim, sektör dağılımı, yoğunlaşma, portföyün F/K ve PD/DD'si, temettü geliri ve
 *    önümüzdeki 12 ayın temettü tahmini. Birden çok portföy tutulabilir.
 *  - Performans ve risk: portföyün gerçek haftalık değer geçmişi, zaman ve para ağırlıklı getiri
 *    (XIRR), aynı nakit akışlarının BIST 100, dolar ve altına yatırılmış hali, aylık getiriler,
 *    beta, oynaklık, en derin düşüş ve hisseler arası korelasyon.
 *  - Sektörler: portföydeki her sektör için en büyük şirketlerden kurulan eşit ağırlıklı haftalık
 *    endeks (10 yıla kadar, TL ve dolar bazında), BIST 100 ile kıyas, sektör medyan oranları.
 *  - Plan ve hedefler: hedef dağılım ve dengeleme işlemleri, nakit, finansal hedef planı,
 *    zarar-kes / hedef fiyat seviyeleri (alarm olarak kurulur).
 *  - Gündem ve günlük: portföydeki şirketlerin KAP bildirimleri, yatırım günlüğü ve zaman çizelgesi.
 *  - İncelenen hisseler, komut satırı ve komut geçmişi, yedekleme (JSON/CSV), yazdırma.
 *
 * Her şey bu tarayıcıda saklanır (localStorage). Komutlar yalnızca Verity içindeki kayıtları
 * değiştirir: hiçbir aracı kuruma emir iletilmez. Hesaplar portfolio.js'te (test/portfolio.test.mjs).
 */
const Profile = (() => {
  const KEY = 'verity_profile_v1';
  const MAX_VIEWS = 60;
  const MAX_CMDS = 80;
  const MAX_SECTORS = 6;
  const MEMBERS_PER_SECTOR = 5;   // largest companies of a sector that make up its index
  const MAX_CORR = 10;            // holdings in the correlation matrix
  const MAX_KAP = 8;              // companies whose disclosures the news tab asks KAP for
  const OZ = 31.1035;             // grams in a troy ounce (gold is quoted in USD per ounce)
  const nf = (min, max = min) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max });
  const f0 = nf(0), f1 = nf(1), f2 = nf(2), fq = nf(0, 4);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  const MASK = '₺•••••';
  /** A share price (public): always shown. */
  const tl = v => (Number.isFinite(v) ? `₺${f2.format(v)}` : '—');
  /** An amount of the user's money: hidden in privacy mode. */
  const amt = v => (!Number.isFinite(v) ? '—' : store.hide ? MASK : `₺${f2.format(v)}`);
  const signedAmt = v => (!Number.isFinite(v) ? '—' : store.hide ? MASK : `${v > 0 ? '+' : v < 0 ? '−' : ''}₺${f2.format(Math.abs(v))}`);
  const compact = v => {
    if (store.hide) return '';
    const a = Math.abs(v);
    if (a >= 1e9) return `₺${f1.format(v / 1e9)} Mr`;
    if (a >= 1e6) return `₺${f1.format(v / 1e6)} Mn`;
    if (a >= 1e3) return `₺${f0.format(v / 1e3)} B`;
    return `₺${f0.format(v)}`;
  };
  const pct = (v, d = 1) => (Number.isFinite(v) ? `%${nf(d).format(v)}` : '—');
  const signed = (v, d = 1) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}%${nf(d).format(Math.abs(v))}` : '—');
  const tone = v => (!Number.isFinite(v) || Math.abs(v) < 1e-9 ? 'text-slate-300' : v > 0 ? 'text-emerald-400' : 'text-rose-400');
  const mult = v => (Number.isFinite(v) && v > 0 ? `${f1.format(v)}x` : '—');
  const fullDate = s => new Date(`${s}T00:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const monthLabel = key => new Date(`${key}-01T00:00:00Z`).toLocaleDateString('tr-TR', { month: 'short', timeZone: 'UTC' });
  const parseNum = s => Portfolio.parseNumber(String(s ?? '').trim().replace(/^₺/, ''));

  const HORIZONS = { short: 'Kısa vade (1 yıldan az)', mid: 'Orta vade (1–3 yıl)', long: 'Uzun vade (3 yıl ve üzeri)' };
  const RISKS = { low: 'Düşük risk', mid: 'Orta risk', high: 'Yüksek risk' };
  // Concentration thresholds per risk profile: a single holding / a single sector (% of value)
  const LIMITS = { low: { stock: 15, sector: 30 }, mid: { stock: 25, sector: 40 }, high: { stock: 35, sector: 55 } };
  // Categorical slots, validated on the dark card surface (dataviz validator: all checks pass)
  const SLOTS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'];
  const BENCH_COLOR = '#94A3B8';
  const MINE_COLOR = '#E2E8F0';
  const USD_COLOR = SLOTS[2];
  const GOLD_COLOR = SLOTS[3];
  // Diverging pair for correlations: blue (move apart) <-> red (move together), grey midpoint
  const DIV_NEG = [57, 135, 229], DIV_POS = [230, 103, 103], DIV_MID = [56, 56, 53];

  /* ---------- storage ---------- */
  const blank = () => ({
    v: 2, name: '', horizon: 'long', risk: 'mid', since: today(),
    portfolios: [{ id: 'main', name: 'Ana portföy' }], active: 'main',
    txs: [], seq: 0, views: [], cmds: [], saved: [], notes: {}, levels: {}, targets: {}, cash: {}, journal: [],
    goal: { target: null, years: 10, monthly: null, rate: null, inflation: null }, hide: false,
    gone: [], updatedAt: 0
  });
  /** Any saved shape (v1 had a single portfolio) -> the current one; unknown fields are dropped. */
  function migrate(j) {
    const b = blank();
    const s = { ...b, ...j, v: 2 };
    if (!Array.isArray(s.portfolios) || !s.portfolios.length) s.portfolios = b.portfolios;
    s.portfolios = s.portfolios.filter(p => p && typeof p.id === 'string').map(p => ({ id: p.id, name: String(p.name || 'Portföy').slice(0, 40) }));
    const ids = new Set(s.portfolios.map(p => p.id));
    s.txs = (Array.isArray(s.txs) ? s.txs : []).map(t => ({ ...t, pf: ids.has(t.pf) ? t.pf : s.portfolios[0].id }));
    if (s.active !== 'all' && !ids.has(s.active)) s.active = s.portfolios[0].id;
    ['notes', 'levels', 'targets', 'cash'].forEach(k => { if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = {}; });
    ['views', 'cmds', 'saved', 'journal'].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
    s.goal = { ...b.goal, ...(s.goal && typeof s.goal === 'object' ? s.goal : {}) };
    s.name = String(s.name || '').slice(0, 40);
    if (!HORIZONS[s.horizon]) s.horizon = 'long';
    if (!RISKS[s.risk]) s.risk = 'mid';
    s.hide = !!s.hide;
    s.gone = Array.isArray(s.gone) ? s.gone.filter(x => typeof x === 'string').slice(-2000) : [];
    s.updatedAt = Number.isFinite(s.updatedAt) ? s.updatedAt : 0;
    return s;
  }
  function read() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (j && (j.v === 1 || j.v === 2)) return migrate(j);
    } catch (e) { /* unreadable or blocked storage: start empty */ }
    return blank();
  }
  let store = read();
  /** Writes the store; quiet is for data that came from the account (it is not a local change). */
  function save(quiet = false) {
    if (!quiet) store.updatedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* private mode: kept for this visit only */ }
    paintMenu();
    // account.js pushes local changes to the user's account
    if (!quiet) window.dispatchEvent(new CustomEvent('verity:data', { detail: 'profile' }));
  }

  /** Remembers ids deleted on purpose, so syncing with another device does not bring them back. */
  function forget(...ids) {
    store.gone = [...(store.gone || []), ...ids.filter(Boolean)].slice(-2000);
  }

  const ui = { tab: 'portfolio', window: 5, ccy: 'TRY', lastTx: null, prefill: null, cmdIndex: -1, token: 0, rbMode: 'full', rbCash: null, perfView: 'value' };

  /* ---------- the selected portfolio ---------- */
  const isAll = () => store.active === 'all';
  const pfName = id => (store.portfolios.find(p => p.id === id) || {}).name || 'Portföy';
  /** Transactions of the portfolio on screen ("Tümü" = every portfolio together). */
  const pfTxs = () => (isAll() ? store.txs : store.txs.filter(t => t.pf === store.active));
  /** Where new trades go: the selected portfolio, or the first one while "Tümü" is shown. */
  const writePf = () => (isAll() ? store.portfolios[0].id : store.active);
  const cashOf = () => (isAll() ? store.portfolios.reduce((s, p) => s + (store.cash[p.id] || 0), 0) : store.cash[store.active] || 0);
  const targetsOf = () => store.targets[store.active] || (store.targets[store.active] = {});
  function invalidate() { study.key = null; perf.key = null; }

  /* ---------- data ---------- */
  const files = {};
  function json(name) {
    if (!files[name]) {
      files[name] = fetch(`/assets/data/${name}.json`)
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
        .then(j => { if (!j) delete files[name]; return j; });
    }
    return files[name];
  }

  let dir = null;   // code -> { name, sec }
  function directory() {
    if (!dir || !dir.size) {
      dir = new Map();
      (typeof getFullBistStockList === 'function' ? getFullBistStockList() : []).forEach(e => {
        if (e.code && !dir.has(e.code)) dir.set(e.code, { name: e.name, sec: (e.raw && e.raw.sec) || '' });
      });
    }
    return dir;
  }
  const company = code => directory().get(code) || { name: code, sec: '' };
  const known = code => directory().has(code);
  const sym = code => (typeof tradingCode === 'function' ? tradingCode(code) : code);
  const finOf = code => (typeof getCachedStockFinancials === 'function' ? getCachedStockFinancials(code) : null);

  /** Technical snapshot row as an object ({ close, m3, s200, hi52, ... }). */
  function techRow(tech, code) {
    const r = tech && tech.data[code];
    if (!r) return null;
    const o = {};
    tech.fields.forEach((f, i) => { o[f] = r[i]; });
    return o;
  }
  /** Statement summary of fundamentals.json in the shape Calc.ratios takes. */
  function fundRow(fund, code) {
    const r = fund && fund.data[code];
    if (!r) return null;
    const [period, shares, equity, totalAssets, netDebt, revenue, ebitda, netIncome] = r;
    return { period, shares, equity, totalAssets, netDebt, revenue, ebitda, netIncome, ttm: { revenue, ebitda, netIncome } };
  }

  /** Delayed quote when available, the last daily close of the snapshot otherwise. */
  async function priceOf(code) {
    if (window.LiveData) await LiveData.ensure([code]);
    const fin = finOf(code);
    if (fin && fin.liveTime && fin.priceNum > 0) return { price: fin.priceNum, src: 'live' };
    const t = techRow(await json('technicals'), code);
    return t && t.close > 0 ? { price: t.close, src: 'close' } : null;
  }

  /** Today's quotes with the previous close (for the day's change), cached for a minute. */
  const dayCache = { key: '', at: 0, data: null };
  async function dayQuotes(codes) {
    const key = codes.join(',');
    if (dayCache.key === key && Date.now() - dayCache.at < 60000) return dayCache.data;
    const syms = codes.map(sym);
    const r = await fetch(`/api/quote?symbols=${encodeURIComponent([...syms, 'BIST100'].join(','))}`);
    if (!r.ok) throw new Error(`quote ${r.status}`);
    const q = (await r.json()).quotes || {};
    const data = { BIST100: q.BIST100 || null };
    codes.forEach((c, i) => { data[c] = q[syms[i]] || null; });
    Object.assign(dayCache, { key, at: Date.now(), data });
    return data;
  }

  /* Weekly history, at most four requests at a time (the long-term tabs ask for dozens) */
  const hist = new Map();
  let active = 0;
  const waiting = [];
  function limited(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(() => { active--; if (waiting.length) waiting.shift()(); });
      };
      if (active < 4) run(); else waiting.push(run);
    });
  }
  function history(symbol) {
    if (!hist.has(symbol)) {
      hist.set(symbol, limited(() => fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=10y&interval=1wk`)
        .then(r => (r.ok ? r.json() : null))
        .then(j => Portfolio.weekly(j))
        .catch(() => new Map())));
    }
    return hist.get(symbol);
  }

  /* ---------- the portfolio model ---------- */
  async function model() {
    const [fund, tech, multiples, divFile] = await Promise.all([json('fundamentals'), json('technicals'), json('sector-multiples'), json('dividends')]);
    const txs = pfTxs();
    const pos = Portfolio.positions(txs);
    const open = pos.filter(p => p.qty > 0).map(p => p.code);
    if (open.length && window.LiveData) await LiveData.ensure(open);
    const prices = {}, source = {};
    open.forEach(code => {
      const fin = finOf(code);
      if (fin && fin.liveTime && fin.priceNum > 0) { prices[code] = fin.priceNum; source[code] = 'live'; return; }
      const t = techRow(tech, code);
      if (t && t.close > 0) { prices[code] = t.close; source[code] = 'close'; }
    });
    const val = Portfolio.valuate(pos, prices);
    val.rows.forEach(r => {
      const c = company(r.code);
      const f = fundRow(fund, r.code);
      const fin = finOf(r.code);
      const x = f && r.price ? Calc.ratios(r.price, f) : {};
      Object.assign(r, {
        name: c.name, sector: c.sec || 'Diğer', src: source[r.code] || null,
        fk: x.fk, pb: x.pddd, roe: x.roe, netDebtEbitda: x.netDebtFavok, loss: f ? f.netIncome < 0 : null,
        score: fin && Number.isFinite(fin.score) ? fin.score : null,
        note: store.notes[r.code] || '', level: store.levels[r.code] || null
      });
    });
    const mix = Portfolio.groupWeights(val.rows, r => r.sector);
    const divs = {};
    if (divFile) Object.entries(divFile.data).forEach(([code, row]) => { divs[code] = row.d; });
    const priced = val.rows.filter(r => r.value > 0);
    return {
      fund, tech, multiples, txs, pos, val, mix, prices, divs,
      cash: cashOf(),
      conc: Portfolio.concentration(priced.map(r => r.weight)),
      pe: Portfolio.lookThrough(priced.map(r => ({ value: r.value, multiple: r.fk }))),
      pb: Portfolio.lookThrough(priced.map(r => ({ value: r.value, multiple: r.pb }))),
      roe: Portfolio.weightedAvg(priced.map(r => ({ value: r.value, x: r.roe }))),
      score: Portfolio.weightedAvg(priced.map(r => ({ value: r.value, x: r.score }))),
      received: Portfolio.dividendsReceived(txs, divs, today()),
      income: Portfolio.trailingIncome(val.rows, divs, today()),
      forecast: Portfolio.dividendForecast(val.rows, divs, today()),
      divAsOf: divFile ? divFile.generatedAt.slice(0, 10) : null
    };
  }

  /** Stable color per sector: alphabetical order of the sectors on screen, never their rank. */
  function sectorColors(names) {
    const order = [...new Set(names)].filter(n => n !== 'Diğer').sort((a, b) => a.localeCompare(b, 'tr'));
    const map = {};
    order.forEach((n, i) => { map[n] = i < SLOTS.length ? SLOTS[i] : BENCH_COLOR; });
    map['Diğer'] = BENCH_COLOR;
    return map;
  }

  /* ---------- shared pieces ---------- */
  const card = (inner, extra = '') => `<section class="rounded-2xl border border-oa-border bg-oa-card ${extra}">${inner}</section>`;
  const cardHead = (title, sub = '', right = '') => `
    <div class="px-4 sm:px-5 pt-4 pb-3 flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="font-serif font-bold text-white text-base">${title}</h2>
        ${sub ? `<p class="text-[11px] text-slate-400 font-sans mt-0.5 leading-relaxed">${sub}</p>` : ''}
      </div>
      ${right}
    </div>`;
  const empty = text => `<div class="px-5 py-8 text-center text-sm text-slate-500 font-sans">${text}</div>`;
  const loading = text => `<div class="px-5 py-8 text-center text-xs text-slate-500 font-sans"><i class="fa-solid fa-circle-notch fa-spin mr-1"></i>${text}</div>`;
  const stockCell = (code, name, sub = '') => `
    <button type="button" onclick="Profile.open('${code}')" class="flex items-center gap-2.5 min-w-0 text-left group">
      ${typeof getStockLogoHtml === 'function' ? getStockLogoHtml(code, 30) : ''}
      <span class="min-w-0">
        <span class="block font-mono font-bold text-white text-sm group-hover:text-[#7FA6FF]">${code}</span>
        <span class="block text-[11px] text-slate-400 font-sans truncate max-w-[170px]">${esc(sub || name)}</span>
      </span>
    </button>`;
  const INPUT = 'w-full px-3 py-2.5 rounded-xl bg-[#0C1322] border border-[#1A2540] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2F6BFF] font-mono';
  const LABEL = 'block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1';
  const linkBtn = (onclick, icon, text) => `<button type="button" onclick="${onclick}" class="text-[11px] font-bold text-[#7FA6FF] hover:text-white"><i class="fa-solid ${icon}"></i> ${text}</button>`;
  const stat = (label, value, sub = '', cls = 'text-white') => `
    <div class="rounded-xl bg-[#090D18] border border-[#162238] p-3 min-w-0">
      <div class="text-[10px] font-mono uppercase tracking-widest text-slate-500 truncate">${label}</div>
      <div class="text-lg font-mono font-bold ${cls} truncate">${value}</div>
      <div class="text-[10px] text-slate-500 font-sans truncate">${sub}</div>
    </div>`;
  const legendHtml = lines => lines.map(l => `
    <span class="inline-flex items-center gap-1.5 text-[11px] text-slate-300 font-sans">
      <span class="inline-block w-4 border-t-2" style="border-color:${l.color};border-top-style:${l.dash && l.dash.length ? 'dashed' : 'solid'}"></span>${esc(l.label)}
    </span>`).join('');

  /** One Chart.js line chart per canvas id, rebuilt on every paint. */
  const charts = {};
  function lineChart(id, keys, lines, { log = false, money = false, title = k => `${fullDate(k)} haftası`, fmt } = {}) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === 'undefined') return;
    const show = fmt || (money ? amt : v => f1.format(v));
    charts[id] = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: keys,
        datasets: lines.map(l => ({
          label: l.label, data: l.data, borderColor: l.color, backgroundColor: l.fill || l.color, fill: l.fill ? 'origin' : false,
          borderWidth: l.width || 2, borderDash: l.dash || [], stepped: !!l.stepped, pointRadius: 0, pointHoverRadius: 4, tension: 0, spanGaps: true
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0E1626', borderColor: '#1E2B45', borderWidth: 1, titleColor: '#F8FAFC', bodyColor: '#CBD5E1', padding: 10, cornerRadius: 8,
            itemSort: (a, b) => b.parsed.y - a.parsed.y,
            callbacks: {
              title: items => title(items[0].label),
              label: c => (c.parsed.y == null ? null : ` ${c.dataset.label}: ${show(c.parsed.y)}`)
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#64748B', maxTicksLimit: 8, maxRotation: 0, font: { size: 10 }, callback(v) { const k = this.getLabelForValue(v); return /^\d{4}-\d{2}/.test(k) ? `${k.slice(5, 7)}.${k.slice(0, 4)}` : k; } } },
          y: { type: log ? 'logarithmic' : 'linear', grid: { color: '#1E2B45' }, ticks: { color: '#64748B', font: { size: 10 }, maxTicksLimit: 7, callback: v => (money ? compact(v) : f0.format(v)) } }
        }
      }
    });
  }

  /**
   * Repaints after a "change" without losing the field the user tabbed to: the change fires before
   * focus moves, so wait a tick, note the focused field's data-fk and focus its replacement.
   */
  function keepFocus(paint) {
    setTimeout(async () => {
      const k = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
      await paint();
      const el = k && document.querySelector(`[data-fk="${k}"]`);
      if (el) { el.focus(); if (el.select) el.select(); }
    }, 0);
  }

  function initials() {
    const n = store.name.trim();
    if (!n) return '<i class="fa-solid fa-user text-sm"></i>';
    return esc(n.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toLocaleUpperCase('tr-TR'));
  }

  /* ---------- header, KPIs, portfolio switcher, tabs ---------- */
  function paintHeader() {
    const el = document.getElementById('pfHeader');
    if (!el) return;
    const watch = typeof getWatchlist === 'function' ? getWatchlist().length : 0;
    const alarms = typeof getAlerts === 'function' ? getAlerts().filter(a => !a.triggered).length : 0;
    const chip = (icon, text) => `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0C1322] border border-[#1A2540] text-[11px] text-slate-300 font-sans whitespace-nowrap"><i class="fa-solid ${icon} text-[10px] text-[#7FA6FF]"></i>${text}</span>`;
    const iconBtn = (onclick, icon, label, on = false) => `<button type="button" onclick="${onclick}" aria-label="${label}" title="${label}" class="shrink-0 w-9 h-9 rounded-xl border text-sm flex items-center justify-center ${on ? 'bg-[#2F6BFF]/20 border-[#2F6BFF] text-white' : 'bg-[#0C1322] border-[#1A2540] text-slate-400 hover:text-white'}"><i class="fa-solid ${icon}"></i></button>`;
    el.innerHTML = `
      <div class="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div class="w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-2xl bg-gradient-to-br from-[#2F6BFF] to-[#1B3F99] text-white flex items-center justify-center text-xl font-serif font-black shadow-lg shadow-[#2F6BFF]/20">${initials()}</div>
        <div class="min-w-0 flex-1">
          <div class="text-[10px] font-mono uppercase tracking-widest text-slate-500">Profilim</div>
          <h1 class="text-2xl sm:text-3xl font-serif font-black text-white tracking-tight truncate">${store.name.trim() ? esc(store.name) : 'Yatırımcı profili'}</h1>
        </div>
        <div class="flex gap-2 pf-noprint">
          ${iconBtn('Profile.togglePrivacy()', store.hide ? 'fa-eye-slash' : 'fa-eye', store.hide ? 'Tutarları göster' : 'Tutarları gizle', store.hide)}
          ${iconBtn('Profile.print()', 'fa-print', 'Bu sekmeyi yazdır / PDF')}
          <button type="button" onclick="Profile.setTab('settings')" aria-label="${store.name.trim() ? 'Profili düzenle' : 'Profilini oluştur'}" class="shrink-0 px-3.5 h-9 rounded-xl bg-[#0C1322] border border-[#1A2540] text-xs font-bold text-slate-300 hover:text-white flex items-center gap-2">
            <i class="fa-solid fa-pen"></i><span class="hidden sm:inline">${store.name.trim() ? 'Profili düzenle' : 'Profilini oluştur'}</span>
          </button>
        </div>
        <div class="basis-full flex flex-wrap gap-2">
          ${chip('fa-hourglass-half', HORIZONS[store.horizon])}
          ${chip('fa-scale-balanced', RISKS[store.risk])}
          ${chip('fa-star', `${watch} izlenen · ${alarms} alarm`)}
          ${chip('fa-calendar', `${fullDate(store.since)} tarihinden beri`)}
        </div>
      </div>`;
  }

  function paintSwitcher() {
    const el = document.getElementById('pfSwitch');
    if (!el) return;
    const pill = (id, label, count) => `
      <button type="button" onclick="Profile.selectPortfolio('${id}')" class="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border flex items-center gap-1.5 ${store.active === id ? 'bg-white text-[#0B1220] border-white' : 'bg-[#0C1322] border-[#1A2540] text-slate-300 hover:text-white'}">
        ${esc(label)}<span class="font-mono ${store.active === id ? 'text-slate-600' : 'text-slate-500'}">${count}</span>
      </button>`;
    const open = id => Portfolio.positions(id === 'all' ? store.txs : store.txs.filter(t => t.pf === id)).filter(p => p.qty > 0).length;
    el.innerHTML = `
      <div class="flex items-center gap-2 overflow-x-auto pb-1 pf-noprint" aria-label="Portföyler">
        <span class="text-[10px] font-mono uppercase tracking-widest text-slate-500 shrink-0 mr-1">Portföy</span>
        ${store.portfolios.map(p => pill(p.id, p.name, open(p.id))).join('')}
        ${store.portfolios.length > 1 ? pill('all', 'Tümü', open('all')) : ''}
        <button type="button" onclick="Profile.newPortfolio()" class="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border border-dashed border-[#1A2540] text-slate-400 hover:text-white"><i class="fa-solid fa-plus"></i> Yeni portföy</button>
      </div>`;
  }

  function paintKpis(m) {
    const el = document.getElementById('pfKpis');
    if (!el) return;
    const v = m && m.val;
    if (!v) { el.innerHTML = ''; return; }
    const tile = (label, value, sub, cls = 'text-white', id = '') => `
      <div class="rounded-2xl border border-oa-border bg-oa-card p-4 min-w-0">
        <div class="text-[10px] font-mono uppercase tracking-widest text-slate-500">${label}</div>
        <div ${id ? `id="${id}"` : ''} class="text-lg sm:text-xl font-mono font-bold ${cls} mt-1 truncate" title="${esc(value)}">${value}</div>
        <div ${id ? `id="${id}Sub"` : ''} class="text-[11px] text-slate-500 font-sans mt-0.5 truncate">${sub}</div>
      </div>`;
    const open = v.rows.length;
    const yieldOnValue = v.total > 0 ? m.income.total / v.total * 100 : null;
    el.innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" data-no-glossary>
        ${tile('Portföy değeri', open ? amt(v.total) : '—', m.cash ? `nakit dahil ${amt(v.total + m.cash)}` : open ? `maliyet ${amt(v.cost)}` : 'henüz pozisyon yok')}
        ${tile('Kâr / zarar', open ? signedAmt(v.pnl) : '—', open ? `${signed(v.pnlPct)} · açık pozisyonlar` : 'gerçekleşmemiş', tone(v.pnl))}
        ${tile('Bugün', open ? '…' : '—', open ? 'gecikmeli fiyatlarla' : '', 'text-slate-300', 'pfKpiDay')}
        ${tile('Gerçekleşen', signedAmt(v.realized), `satışlar · alınan temettü ${amt(m.received.total)}`, tone(v.realized))}
        ${tile('Temettü (12A)', amt(m.income.total), yieldOnValue == null ? 'mevcut adetlerle' : `${pct(yieldOnValue, 2)} verim`)}
        ${tile('Pozisyon', open ? f0.format(open) : '0', open ? `etkin ${f1.format(m.conc.effective)} · ${m.mix.length} sektör` : 'işlem ekleyin')}
      </div>`;
  }

  const TABS = [
    ['portfolio', 'fa-briefcase', 'Portföy'],
    ['performance', 'fa-chart-area', 'Performans ve risk'],
    ['sectors', 'fa-chart-line', 'Sektörler'],
    ['plan', 'fa-bullseye', 'Plan ve hedefler'],
    ['news', 'fa-newspaper', 'Gündem ve günlük'],
    ['activity', 'fa-clock-rotate-left', 'İncelediklerim'],
    ['commands', 'fa-terminal', 'Komutlar'],
    ['settings', 'fa-user-gear', 'Profil ve veriler']
  ];
  function paintTabs() {
    const el = document.getElementById('pfTabs');
    if (!el) return;
    el.innerHTML = `<div class="flex gap-2 overflow-x-auto pb-1 pf-noprint" role="tablist">${TABS.map(([k, icon, label]) => `
      <button type="button" role="tab" aria-selected="${ui.tab === k}" onclick="Profile.setTab('${k}')" class="shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 ${ui.tab === k ? 'bg-[#2F6BFF] text-white' : 'bg-[#0C1322] border border-[#1A2540] text-slate-400 hover:text-white'}">
        <i class="fa-solid ${icon}"></i>${label}
      </button>`).join('')}</div>`;
  }

  /* ---------- portfolio tab ---------- */
  function codeOptions() {
    const list = document.getElementById('pfCodes');
    if (!list || list.childElementCount) return;
    list.innerHTML = [...directory()].map(([code, c]) => `<option value="${code}">${esc(c.name)}</option>`).join('');
  }

  function portfolioSkeleton() {
    return `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div class="lg:col-span-2 space-y-5 min-w-0">
          ${card(`${cardHead('İşlem ekle', `Kayıt yeri: <b class="text-slate-300">${esc(pfName(writePf()))}</b>. Fiyatı boş bırakırsanız gecikmeli güncel fiyat kullanılır. Kayıt yalnızca bu tarayıcıda tutulur; aracı kuruma emir iletilmez.`)}
            <form id="pfTradeForm" onsubmit="Profile.submitTrade(event)" class="px-4 sm:px-5 pb-5 grid grid-cols-2 sm:grid-cols-6 gap-3 items-end pf-noprint">
              <div class="col-span-2 sm:col-span-1">
                <span class="${LABEL}">Tür</span>
                <div class="grid grid-cols-2 rounded-xl border border-[#1A2540] overflow-hidden text-xs font-bold">
                  <label class="cursor-pointer"><input type="radio" name="pfType" value="buy" class="peer sr-only" checked><span class="block text-center py-2.5 text-slate-400 peer-checked:bg-emerald-600 peer-checked:text-white">Alış</span></label>
                  <label class="cursor-pointer"><input type="radio" name="pfType" value="sell" class="peer sr-only"><span class="block text-center py-2.5 text-slate-400 peer-checked:bg-rose-600 peer-checked:text-white">Satış</span></label>
                </div>
              </div>
              <label class="col-span-2 sm:col-span-1"><span class="${LABEL}">Hisse</span><input id="pfCode" list="pfCodes" autocomplete="off" required placeholder="THYAO" class="${INPUT} uppercase"></label>
              <label><span class="${LABEL}">Adet</span><input id="pfQty" inputmode="decimal" required placeholder="100" class="${INPUT}"></label>
              <label><span class="${LABEL}">Fiyat (₺)</span><input id="pfPrice" inputmode="decimal" placeholder="güncel" class="${INPUT}"></label>
              <label><span class="${LABEL}">Tarih</span><input id="pfDate" type="date" max="${today()}" value="${today()}" class="${INPUT}"></label>
              <label><span class="${LABEL}">Komisyon (₺)</span><input id="pfFee" inputmode="decimal" placeholder="0" class="${INPUT}"></label>
              <div class="col-span-2 sm:col-span-6 flex flex-wrap items-center gap-3">
                <button type="submit" class="px-4 py-2.5 rounded-xl bg-[#2F6BFF] hover:bg-[#4A7FFF] text-white text-sm font-semibold flex items-center gap-2"><i class="fa-solid fa-plus"></i>Kaydet</button>
                <span id="pfTradeMsg" class="text-xs font-sans text-slate-400" role="status"></span>
              </div>
              <datalist id="pfCodes"></datalist>
            </form>`)}
          <div id="pfHoldings">${card(loading('Portföy hesaplanıyor…'))}</div>
          <div id="pfTxs"></div>
          <div id="pfNotes"></div>
        </div>
        <div class="space-y-5 min-w-0">
          <div id="pfToday"></div>
          <div id="pfMix"></div>
          <div id="pfRisk"></div>
          <div id="pfDivs"></div>
        </div>
      </div>`;
  }

  function levelBadge(r) {
    const l = r.level;
    if (!l || !r.price) return '';
    const parts = [];
    if (l.stop > 0) {
      const d = (r.price / l.stop - 1) * 100;
      parts.push(`<span class="${d < 5 ? 'text-rose-400' : 'text-slate-500'}" title="Zarar-kes ${tl(l.stop)}">S ${signed(-d, 0)}</span>`);
    }
    if (l.target > 0) {
      const d = (l.target / r.price - 1) * 100;
      parts.push(`<span class="${d < 5 ? 'text-emerald-400' : 'text-slate-500'}" title="Hedef ${tl(l.target)}">H ${signed(d, 0)}</span>`);
    }
    return parts.length ? `<div class="text-[10px] font-mono flex gap-2 mt-0.5">${parts.join('')}</div>` : '';
  }

  function paintHoldings(m) {
    const el = document.getElementById('pfHoldings');
    if (!el) return;
    const { rows, total, cost, pnl, pnlPct } = m.val;
    if (!rows.length) {
      el.innerHTML = card(`${cardHead('Pozisyonlar')}${empty(`Bu portföyde pozisyon yok. Yukarıdaki formdan, komut satırından (<code class="font-mono text-[#7FA6FF]">al THYAO 100</code>) ya da “Profil ve veriler” sekmesinden CSV ile ekleyin.`)}`);
      return;
    }
    const closeNote = rows.some(r => r.src === 'close');
    el.innerHTML = card(`
      ${cardHead(`Pozisyonlar${isAll() ? ' · tüm portföyler' : ''}`, `Ortalama maliyet yöntemi; fiyatlar gecikmeli${closeNote ? ', * işaretliler son günlük kapanış' : ''}. F/K gerçek bilançodan (son 12 ay). S/H: zarar-kes ve hedef fiyata uzaklık.`)}
      <div class="overflow-x-auto" data-no-glossary>
        <table class="w-full text-left border-collapse text-sm">
          <thead><tr class="border-y border-oa-border text-[10px] font-mono uppercase tracking-widest text-slate-500">
            <th class="px-4 py-2.5">Hisse</th>
            <th class="px-3 py-2.5 text-right">Adet</th>
            <th class="px-3 py-2.5 text-right hidden sm:table-cell">Ort. maliyet</th>
            <th class="px-3 py-2.5 text-right">Fiyat</th>
            <th class="px-3 py-2.5 text-right hidden md:table-cell">Gün</th>
            <th class="px-3 py-2.5 text-right">Değer</th>
            <th class="px-3 py-2.5 text-right">K/Z</th>
            <th class="px-3 py-2.5 text-right hidden md:table-cell">Ağırlık</th>
            <th class="px-3 py-2.5 text-right hidden lg:table-cell">F/K</th>
            <th class="px-3 py-2.5 text-right hidden lg:table-cell">Skor</th>
            <th class="px-3 py-2.5 pf-noprint" aria-label="İşlemler"></th>
          </tr></thead>
          <tbody class="font-mono">
            ${rows.map(r => `
              <tr class="border-t border-oa-border/60 hover:bg-[#121C30]/40">
                <td class="px-4 py-2.5">${stockCell(r.code, r.name, r.sector)}${levelBadge(r)}</td>
                <td class="px-3 py-2.5 text-right text-slate-200">${fq.format(r.qty)}</td>
                <td class="px-3 py-2.5 text-right text-slate-400 hidden sm:table-cell">${tl(r.avgCost)}</td>
                <td class="px-3 py-2.5 text-right text-white">${tl(r.price)}${r.src === 'close' ? '<span class="text-slate-500">*</span>' : ''}</td>
                <td id="pfDay-${r.code}" class="px-3 py-2.5 text-right text-slate-500 hidden md:table-cell">…</td>
                <td class="px-3 py-2.5 text-right text-white">${amt(r.value)}</td>
                <td class="px-3 py-2.5 text-right whitespace-nowrap ${tone(r.pnl)}"><div>${signedAmt(r.pnl)}</div><div class="text-[11px]">${signed(r.pnlPct)}</div></td>
                <td class="px-3 py-2.5 text-right text-slate-300 hidden md:table-cell">${pct(r.weight)}</td>
                <td class="px-3 py-2.5 text-right text-slate-300 hidden lg:table-cell">${mult(r.fk)}</td>
                <td class="px-3 py-2.5 text-right text-amber-300 hidden lg:table-cell">${r.score == null ? '—' : f1.format(r.score)}</td>
                <td class="px-3 py-2.5 text-right whitespace-nowrap pf-noprint">
                  ${isAll() ? '' : `<button type="button" onclick="Profile.prefillSell('${r.code}')" class="w-7 h-7 rounded-lg bg-[#090D18] border border-[#1E2B45] text-slate-400 hover:text-rose-400 text-xs" title="${r.code} satışı gir"><i class="fa-solid fa-arrow-right-from-bracket"></i></button>`}
                </td>
              </tr>`).join('')}
          </tbody>
          <tfoot class="font-mono">
            <tr class="border-t border-oa-border text-white">
              <td class="px-4 py-3 font-sans text-xs text-slate-400" colspan="2">Toplam${m.val.unpriced.length ? ` · fiyatı alınamayan: ${m.val.unpriced.join(', ')}` : ''}</td>
              <td class="hidden sm:table-cell"></td>
              <td class="px-3 py-3 text-right text-slate-400 text-xs">${amt(cost)}</td>
              <td id="pfDayTotal" class="px-3 py-3 text-right text-slate-500 hidden md:table-cell"></td>
              <td class="px-3 py-3 text-right font-bold">${amt(total)}</td>
              <td class="px-3 py-3 text-right whitespace-nowrap ${tone(pnl)}"><div>${signedAmt(pnl)}</div><div class="text-[11px]">${signed(pnlPct)}</div></td>
              <td class="hidden md:table-cell"></td>
              <td class="px-3 py-3 text-right text-slate-300 hidden lg:table-cell">${mult(m.pe.multiple)}</td>
              <td class="px-3 py-3 text-right text-amber-300 hidden lg:table-cell">${m.score == null ? '—' : f1.format(m.score)}</td>
              <td class="pf-noprint"></td>
            </tr>
          </tfoot>
        </table>
      </div>`, 'overflow-hidden');
  }

  /** The day's change of the holdings against yesterday's close (KPI tile, table column, card). */
  async function paintToday(m, token) {
    const el = document.getElementById('pfToday');
    const rows = m.val.rows.filter(r => r.qty > 0);
    const kpi = document.getElementById('pfKpiDay');
    if (!rows.length) { if (el) el.innerHTML = ''; return; }
    let q;
    try { q = await dayQuotes(rows.map(r => r.code)); } catch (e) {
      if (kpi) kpi.textContent = '—';
      if (el) el.innerHTML = '';
      return;
    }
    if (token !== ui.token) return;
    const moves = rows.map(r => {
      const x = q[r.code];
      if (!x || !(x.prevClose > 0) || !(x.price > 0)) return { ...r, d: null, dTl: null };
      return { ...r, d: (x.price / x.prevClose - 1) * 100, dTl: r.qty * (x.price - x.prevClose), prevValue: r.qty * x.prevClose };
    });
    const ok = moves.filter(x => x.d != null);
    const dTl = ok.reduce((s, x) => s + x.dTl, 0);
    const base = ok.reduce((s, x) => s + x.prevValue, 0);
    const d = base > 0 ? dTl / base * 100 : null;
    const bist = q.BIST100 && q.BIST100.prevClose > 0 ? (q.BIST100.price / q.BIST100.prevClose - 1) * 100 : null;
    if (kpi) {
      kpi.textContent = ok.length ? signedAmt(dTl) : '—';
      kpi.className = `text-lg sm:text-xl font-mono font-bold mt-1 truncate ${tone(dTl)}`;
      const sub = document.getElementById('pfKpiDaySub');
      if (sub) sub.textContent = ok.length ? `${signed(d, 2)} · BIST 100 ${signed(bist, 2)}` : 'fiyat alınamadı';
    }
    moves.forEach(x => {
      const c = document.getElementById(`pfDay-${x.code}`);
      if (c) { c.textContent = signed(x.d, 2); c.className = `px-3 py-2.5 text-right hidden md:table-cell ${tone(x.d)}`; }
    });
    const tot = document.getElementById('pfDayTotal');
    if (tot) { tot.textContent = signed(d, 2); tot.className = `px-3 py-3 text-right hidden md:table-cell ${tone(d)}`; }
    if (!el) return;
    const sorted = [...ok].sort((a, b) => b.d - a.d);
    const row = x => `
      <li class="flex items-center justify-between gap-2 text-xs font-mono">
        <button type="button" onclick="Profile.open('${x.code}')" class="font-bold text-white hover:text-[#7FA6FF]">${x.code}</button>
        <span class="flex-1 border-b border-dotted border-[#1E2B45] mx-1"></span>
        <span class="${tone(x.d)}">${signed(x.d, 2)}</span>
        <span class="w-24 text-right ${tone(x.dTl)}">${signedAmt(x.dTl)}</span>
      </li>`;
    const time = ok.length && q[ok[0].code].time ? new Date(q[ok[0].code].time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) : '';
    el.innerHTML = card(`
      ${cardHead('Bugün', `Dünkü kapanışa göre, gecikmeli${time ? ` · ${time}` : ''}. Bugün alınan hisseler de dünkü kapanışa göre sayılır.`)}
      <div class="px-4 sm:px-5 pb-5 space-y-3">
        <div class="grid grid-cols-2 gap-2" data-no-glossary>
          ${stat('Portföy', signed(d, 2), signedAmt(dTl), tone(d))}
          ${stat('BIST 100', signed(bist, 2), d != null && bist != null ? `fark ${signed(d - bist, 2).replace('%', '')} puan` : '', tone(bist))}
        </div>
        ${sorted.length ? `<ul class="space-y-1.5">${sorted.slice(0, 3).map(row).join('')}${sorted.length > 5 ? '<li class="text-center text-slate-600 text-xs">···</li>' : ''}${sorted.length > 3 ? sorted.slice(Math.max(3, sorted.length - 2)).map(row).join('') : ''}</ul>` : ''}
      </div>`);
  }

  /** Part-to-whole as one segmented bar plus a labelled list (the list doubles as the table view). */
  function mixHtml(mix, colors) {
    return `
      <div class="px-4 sm:px-5 pb-5 space-y-3">
        <div class="flex h-3 rounded-full overflow-hidden gap-[2px] bg-oa-card" role="img" aria-label="Ağırlıklar">
          ${mix.map(g => `<span style="width:${g.weight}%;background:${colors[g.key]}" title="${esc(g.key)}: %${f1.format(g.weight)}"></span>`).join('')}
        </div>
        <ul class="space-y-1.5">
          ${mix.map(g => `
            <li class="flex items-center gap-2 text-xs font-sans">
              <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background:${colors[g.key]}"></span>
              <span class="flex-1 min-w-0 truncate text-slate-300" title="${esc(g.key)}">${esc(g.key)}</span>
              <span class="font-mono text-slate-500 text-[11px] truncate max-w-[110px]">${g.codes.join(', ')}</span>
              <span class="font-mono text-white w-12 text-right">${pct(g.weight)}</span>
            </li>`).join('')}
        </ul>
      </div>`;
  }

  function paintMix(m) {
    const el = document.getElementById('pfMix');
    if (!el) return;
    if (!m.mix.length) { el.innerHTML = ''; return; }
    el.innerHTML = card(`${cardHead('Sektör dağılımı', 'Piyasa değerine göre ağırlık (KAP sektörü).', `<span class="pf-noprint">${linkBtn("Profile.setTab('sectors')", 'fa-arrow-right', 'Uzun dönem')}</span>`)}${mixHtml(m.mix, sectorColors(m.mix.map(g => g.key)))}`);
  }

  function paintRisk(m) {
    const el = document.getElementById('pfRisk');
    if (!el) return;
    const rows = m.val.rows.filter(r => r.value > 0);
    if (!rows.length) { el.innerHTML = ''; return; }
    const lim = LIMITS[store.risk];
    const top = rows[0];
    const topSector = m.mix[0];
    const notes = [];
    if (top.weight > lim.stock) notes.push(['warn', `Tek hissenin (${top.code}) payı ${pct(top.weight)}; ${RISKS[store.risk].toLocaleLowerCase('tr-TR')} profili için eşik ${pct(lim.stock, 0)}.`]);
    if (topSector && topSector.weight > lim.sector) notes.push(['warn', `${esc(topSector.key)} sektörünün payı ${pct(topSector.weight)}; eşik ${pct(lim.sector, 0)}.`]);
    if (rows.length > 1 && m.conc.effective < 4) notes.push(['info', `${rows.length} pozisyon ağırlıklar nedeniyle yaklaşık ${f1.format(m.conc.effective)} eşit pozisyon gibi davranıyor.`]);
    const lossShare = rows.filter(r => r.loss).reduce((s, r) => s + r.weight, 0);
    if (lossShare > 0) notes.push(['info', `Son 12 ayda zarar eden şirketlerin portföydeki payı ${pct(lossShare)}.`]);
    const levered = rows.filter(r => r.netDebtEbitda > 3).map(r => r.code);
    if (levered.length) notes.push(['info', `Net borcu FAVÖK'ünün 3 katını aşan: ${levered.join(', ')}.`]);
    const noStop = rows.filter(r => !(r.level && r.level.stop > 0)).map(r => r.code);
    if (noStop.length && noStop.length < rows.length) notes.push(['info', `Zarar-kes seviyesi olmayan: ${noStop.join(', ')} (Plan ve hedefler sekmesi).`]);
    if (!notes.length) notes.push(['ok', 'Seçtiğiniz risk profilinin yoğunlaşma eşiklerinin içindesiniz.']);
    const icon = { warn: 'fa-triangle-exclamation text-amber-400', info: 'fa-circle-info text-sky-400', ok: 'fa-circle-check text-emerald-400' };
    const all = m.multiples && m.multiples.all;
    el.innerHTML = card(`
      ${cardHead('Risk ve değerleme', `Eşikler profilinizdeki “${RISKS[store.risk]}” seçimine göre. Yatırım tavsiyesi değildir.`, `<span class="pf-noprint">${linkBtn("Profile.setTab('performance')", 'fa-arrow-right', 'Ayrıntılı risk')}</span>`)}
      <div class="px-4 sm:px-5 pb-5 space-y-3">
        <div class="grid grid-cols-2 gap-2" data-no-glossary>
          ${stat('Portföy F/K', mult(m.pe.multiple), all ? `BIST medyan ${mult(all.pe)}` : `kapsam ${pct(m.pe.coverage, 0)}`)}
          ${stat('Portföy PD/DD', mult(m.pb.multiple), all ? `BIST medyan ${mult(all.pb)}` : `kapsam ${pct(m.pb.coverage, 0)}`)}
          ${stat('Ağırlıklı ROE', pct(m.roe), 'son 12 ay')}
          ${stat('En büyük pozisyon', pct(top.weight), top.code)}
        </div>
        <ul class="space-y-2">
          ${notes.map(([k, t]) => `<li class="flex gap-2 text-xs text-slate-300 font-sans leading-relaxed"><i class="fa-solid ${icon[k]} mt-0.5"></i><span>${t}</span></li>`).join('')}
        </ul>
        <p class="text-[10px] text-slate-500 font-sans">F/K ve PD/DD portföyün temsil ettiği toplam kâr ve özsermayeye göre hesaplanır (zarar eden ve bilançosu olmayan şirketler hariç, F/K kapsamı ${pct(m.pe.coverage, 0)}).</p>
      </div>`);
  }

  function paintDivs(m) {
    const el = document.getElementById('pfDivs');
    if (!el) return;
    if (!m.txs.length) { el.innerHTML = ''; return; }
    const items = m.received.items.slice(0, 6);
    const months = m.forecast.months;
    const max = Math.max(...months.map(x => x.total), 0);
    const bars = max > 0 ? `
      <div class="flex items-end gap-1 h-24" role="img" aria-label="Önümüzdeki 12 ayın tahmini temettüsü">
        ${months.map(x => `
          <div class="flex-1 flex flex-col items-center justify-end h-full gap-1" title="${monthLabel(x.key)} ${x.key.slice(0, 4)}: ${x.total ? `${amt(x.total)} (${x.items.map(i => i.code).join(', ')})` : 'yok'}">
            <div class="w-full rounded-t-[4px] ${x.total ? '' : 'bg-[#162238]'}" style="height:${x.total ? Math.max(4, x.total / max * 76) : 2}px;${x.total ? `background:${SLOTS[0]}` : ''}"></div>
            <span class="text-[9px] font-mono text-slate-500">${monthLabel(x.key).slice(0, 3)}</span>
          </div>`).join('')}
      </div>` : '<p class="text-xs text-slate-500 font-sans">Pozisyonlarınız geçen yıl bu aylarda temettü dağıtmadı.</p>';
    el.innerHTML = card(`
      ${cardHead('Temettü', `Hak kullanım tarihinden önceki gün elinizdeki adet × hisse başı tutar (brüt).${m.divAsOf ? ` Veri: ${fullDate(m.divAsOf)}.` : ''}`)}
      <div class="px-4 sm:px-5 pb-5 space-y-4">
        <div>
          <div class="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">Önümüzdeki 12 ay · tahmini ${amt(m.forecast.total)}</div>
          ${bars}
          <p class="text-[10px] text-slate-500 font-sans mt-1.5">Her hisse geçen yıl aynı ayda ödediğini öderse; kesin tarih ve tutar KAP duyurusuyla belli olur.</p>
        </div>
        <div>
          <div class="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1.5">Hak kazandığınız dağıtımlar · toplam ${amt(m.received.total)}</div>
          ${items.length ? `<ul class="space-y-1">${items.map(i => `<li class="flex justify-between gap-2 text-xs font-mono"><span class="text-slate-400">${fullDate(i.date)}</span><span class="text-slate-300">${i.code} · ${fq.format(i.qty)} × ₺${fq.format(i.amount)}</span><span class="text-white">${amt(i.cash)}</span></li>`).join('')}</ul>` : '<p class="text-xs text-slate-500 font-sans">İşlem tarihlerinize göre henüz hak kazanılmış dağıtım yok.</p>'}
        </div>
      </div>`);
  }

  function paintTxs() {
    const el = document.getElementById('pfTxs');
    if (!el) return;
    const txs = pfTxs();
    if (!txs.length) { el.innerHTML = ''; return; }
    const list = [...txs].sort((a, b) => b.date.localeCompare(a.date) || (b.seq || 0) - (a.seq || 0));
    el.innerHTML = card(`
      ${cardHead('İşlem geçmişi', `${list.length} kayıt`, `<span class="pf-noprint">${linkBtn('Profile.exportCsv()', 'fa-file-csv', 'CSV indir')}</span>`)}
      <div class="max-h-[360px] overflow-y-auto">
        ${list.map(t => `
          <div class="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-t border-oa-border/60 text-xs font-mono">
            <span class="w-24 shrink-0 text-slate-400">${fullDate(t.date)}</span>
            <span class="w-12 shrink-0 font-bold ${t.type === 'buy' ? 'text-emerald-400' : 'text-rose-400'}">${t.type === 'buy' ? 'ALIŞ' : 'SATIŞ'}</span>
            <button type="button" onclick="Profile.open('${t.code}')" class="w-16 shrink-0 text-left font-bold text-white hover:text-[#7FA6FF]">${t.code}</button>
            <span class="flex-1 min-w-0 text-slate-300 truncate">${fq.format(t.qty)} × ${tl(t.price)}${t.fee ? ` + ${amt(t.fee)}` : ''}${isAll() ? ` <span class="text-slate-500 font-sans">· ${esc(pfName(t.pf))}</span>` : ''}</span>
            <span class="text-white hidden sm:inline">${amt(t.qty * t.price)}</span>
            <button type="button" onclick="Profile.removeTx('${t.id}')" class="w-7 h-7 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 pf-noprint" title="Kaydı sil"><i class="fa-solid fa-trash-can"></i></button>
          </div>`).join('')}
      </div>`);
  }

  function paintNotes(m) {
    const el = document.getElementById('pfNotes');
    if (!el) return;
    const codes = [...new Set([...m.val.rows.map(r => r.code), ...Object.keys(store.notes).filter(c => store.notes[c])])];
    if (!codes.length) { el.innerHTML = ''; return; }
    el.innerHTML = card(`
      ${cardHead('Yatırım notlarım', 'Neden aldığınızı, neyi beklediğinizi ve hangi durumda çıkacağınızı yazın. Komutla da eklenir: <code class="font-mono text-[#7FA6FF]">not THYAO metin</code>')}
      <div class="px-4 sm:px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        ${codes.map(c => `
          <label class="block">
            <span class="block text-xs font-mono font-bold text-white mb-1">${c} <span class="font-sans font-normal text-slate-500">${esc(company(c).name)}</span></span>
            <textarea rows="3" maxlength="600" onchange="Profile.setNote('${c}', this.value)" placeholder="Tez, hedef, çıkış koşulu…" class="w-full px-3 py-2 rounded-xl bg-[#0C1322] border border-[#1A2540] text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#2F6BFF] font-sans resize-y">${esc(store.notes[c] || '')}</textarea>
          </label>`).join('')}
      </div>`);
  }

  /* ---------- performance and risk tab ---------- */
  function performanceSkeleton() {
    const btn = (on, onclick, label) => `<button type="button" onclick="${onclick}" class="px-3 py-1.5 rounded-lg text-[11px] font-bold ${on ? 'bg-[#2F6BFF] text-white' : 'text-slate-400 hover:text-white'}">${label}</button>`;
    return `
      <div id="pfPerfKpis">${card(loading('Fiyat geçmişi yükleniyor ve portföyün haftalık değeri hesaplanıyor…'))}</div>
      ${card(`
        ${cardHead('Portföyün seyri', 'Her hafta sonundaki gerçek pozisyonlarınızın değeri (Yahoo Finance haftalık kapanış). “Aynı parayla” görünümü, her alışınızın tutarını aynı hafta BIST 100\'e, dolara ya da gram altına yatırmış, satışlarınızı da oradan çekmiş olsaydınız ne olacağını gösterir.',
          `<div class="flex rounded-xl bg-[#0C1322] border border-[#1A2540] p-1 pf-noprint">${btn(ui.perfView === 'value', "Profile.setPerfView('value')", 'Değer ve yatırılan')}${btn(ui.perfView === 'alt', "Profile.setPerfView('alt')", 'Aynı parayla')}${btn(ui.perfView === 'twr', "Profile.setPerfView('twr')", 'Getiri endeksi')}</div>`)}
        <div class="px-4 sm:px-5 pb-5">
          <div id="pfPerfLegend" class="flex flex-wrap gap-x-4 gap-y-1.5 mb-3"></div>
          <div class="relative h-[300px]"><canvas id="pfPerfChart" aria-label="Portföyün seyri"></canvas></div>
          <p id="pfPerfStatus" class="text-[11px] text-slate-500 font-sans mt-2" role="status"></p>
        </div>`)}
      <div id="pfPerfAlt"></div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div id="pfPerfRisk"></div>
        <div id="pfPerfCorr"></div>
      </div>
      <div id="pfPerfMonthly"></div>`;
  }

  const perf = { key: null, promise: null };
  /** Everything the performance tab shows, computed once per set of transactions and day. */
  function performance(m) {
    const txs = m.txs;
    const key = JSON.stringify([txs.map(t => [t.code, t.type, t.qty, t.price, t.date, t.fee]), today(), Math.round(m.val.total)]);
    if (perf.key === key) return perf.promise;
    perf.key = key;
    perf.promise = (async () => {
      const trades = Portfolio.normalized(txs);
      if (!trades.length) return null;
      const codes = [...new Set(txs.map(t => t.code))];
      const [maps, bist, usd, goldUsd] = await Promise.all([
        Promise.all(codes.map(c => history(sym(c)))), history('BIST100'), history('USDTRY'), history('ALTIN')
      ]);
      const closes = Object.fromEntries(codes.map((c, i) => [c, maps[i]]));
      const h = Portfolio.valueHistory(txs, closes, today());
      const twr = Portfolio.twrIndex(h);
      const gold = Portfolio.times(goldUsd, usd, 1 / OZ);
      const alt = {
        bist: Portfolio.replay(txs, bist, h.keys),
        usd: Portfolio.replay(txs, usd, h.keys),
        gold: Portfolio.replay(txs, gold, h.keys)
      };
      const value = m.val.total;
      const flows = Portfolio.cashFlows(txs, m.received.items, value, today());
      const first = trades[0].date;
      const days = (Date.parse(`${today()}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 864e5;
      // Annualising a few weeks of returns gives meaningless numbers
      const irr = days >= 90 ? Portfolio.xirr(flows) : null;
      const netIn = trades.reduce((s, t) => s + t.cash, 0);
      const gain = value - netIn + m.received.total;
      const bistIdx = rebaseOn(bist, twr.keys);
      const twrUsd = Portfolio.deflate(twr, usd);
      // Risk of today's holdings with today's weights over the last year (a stable composition)
      const held = m.val.rows.filter(r => r.value > 0);
      const heldMaps = held.map(r => closes[r.code] || new Map());
      const now = held.length ? Portfolio.blendIndex(heldMaps, held.map(r => r.weight)) : null;
      const riskNow = now ? Portfolio.riskVs(now, bist, 52) : null;
      const riskReal = twr.keys.length > 12 ? Portfolio.riskVs(twr, bist, 52) : null;
      const corrCodes = held.slice(0, MAX_CORR).map(r => r.code);
      const corr = corrCodes.length >= 2 ? Portfolio.correlations(corrCodes.map(c => closes[c]), 52) : null;
      return { h, twr, twrUsd, bistIdx, alt, irr, days, gain, netIn, value, riskNow, riskReal, corr, corrCodes, monthly: Portfolio.monthlyReturns(twr), first };
    })();
    perf.promise.catch(() => { perf.key = null; });
    return perf.promise;
  }

  /** A weekly Map as an index on the given weeks, 100 at the first one with a value. */
  function rebaseOn(map, keys) {
    const vals = Portfolio.carried(map, keys);
    const i0 = vals.findIndex(v => v > 0);
    if (i0 < 0) return null;
    return { keys: keys.slice(i0), values: vals.slice(i0).map(v => v / vals[i0] * 100) };
  }

  function paintPerformance(p, m) {
    const kpiEl = document.getElementById('pfPerfKpis');
    if (!p) {
      if (kpiEl) kpiEl.innerHTML = card(empty('Performans için önce işlem ekleyin.'));
      ['pfPerfAlt', 'pfPerfRisk', 'pfPerfCorr', 'pfPerfMonthly'].forEach(id => { const e = document.getElementById(id); if (e) e.innerHTML = ''; });
      return;
    }
    const last = s => (s && s.values.length ? s.values[s.values.length - 1] : null);
    const twrTotal = last(p.twr) != null ? last(p.twr) - 100 : null;
    const years = p.days / 365;
    const twrAnn = twrTotal != null && years >= 1 ? ((1 + twrTotal / 100) ** (1 / years) - 1) * 100 : null;
    const bistTotal = p.bistIdx ? last(p.bistIdx) - 100 : null;
    const usdTotal = last(p.twrUsd) != null ? last(p.twrUsd) - 100 : null;
    const r = p.riskNow;
    if (kpiEl) {
      kpiEl.innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" data-no-glossary>
          ${stat('Zaman ağırlıklı getiri', signed(twrTotal), twrAnn != null ? `yıllık ${signed(twrAnn)}` : `${f0.format(p.days)} gün`, tone(twrTotal))}
          ${stat('Para ağırlıklı (XIRR)', p.irr == null ? '—' : signed(p.irr), p.irr == null ? 'en az 3 aylık geçmiş gerekir' : 'yıllık, temettü dahil', tone(p.irr))}
          ${stat('Toplam kazanç', signedAmt(p.gain), `değer + satışlar + temettü − alışlar`, tone(p.gain))}
          ${stat('BIST 100 aynı dönem', signed(bistTotal), twrTotal != null && bistTotal != null ? `fark ${signed(twrTotal - bistTotal).replace('%', '')} puan` : '', tone(bistTotal))}
          ${stat('Dolar bazında', signed(usdTotal), 'zaman ağırlıklı', tone(usdTotal))}
          ${stat('Beta (1 yıl)', r && Number.isFinite(r.beta) ? f2.format(r.beta) : '—', r ? `BIST 100 ile korelasyon ${f2.format(r.corr)}` : 'yetersiz geçmiş')}
        </div>`;
    }
    paintPerfChart(p);
    paintPerfAlt(p);
    paintPerfRisk(p);
    paintPerfCorr(p);
    paintPerfMonthly(p);
  }

  function paintPerfChart(p) {
    const legend = document.getElementById('pfPerfLegend');
    const status = document.getElementById('pfPerfStatus');
    if (!legend) return;
    const keys = p.h.keys;
    let lines, opts;
    if (ui.perfView === 'value') {
      lines = [
        { label: 'Portföy değeri', color: SLOTS[0], data: p.h.value, fill: 'rgba(57,135,229,.12)' },
        { label: 'Yatırılan para (net)', color: BENCH_COLOR, data: p.h.invested, dash: [5, 4], stepped: true }
      ];
      opts = { money: true };
    } else if (ui.perfView === 'alt') {
      lines = [
        { label: 'Portföyüm', color: MINE_COLOR, data: p.h.value, width: 3 },
        { label: 'BIST 100', color: BENCH_COLOR, data: p.alt.bist, dash: [5, 4] },
        { label: 'Dolar', color: USD_COLOR, data: p.alt.usd },
        { label: 'Gram altın', color: GOLD_COLOR, data: p.alt.gold }
      ];
      opts = { money: true };
    } else {
      const at = s => { const mp = new Map(s.keys.map((k, i) => [k, s.values[i]])); return keys.map(k => mp.get(k) ?? null); };
      lines = [
        { label: 'Portföyüm (zaman ağırlıklı)', color: MINE_COLOR, data: at(p.twr), width: 3 },
        ...(p.bistIdx ? [{ label: 'BIST 100', color: BENCH_COLOR, data: at(p.bistIdx), dash: [5, 4] }] : []),
        { label: 'Portföyüm (dolar bazında)', color: USD_COLOR, data: at(p.twrUsd) }
      ];
      opts = { fmt: v => `${f1.format(v)} (${signed(v - 100)})` };
    }
    legend.innerHTML = legendHtml(lines);
    lineChart('pfPerfChart', keys, lines, opts);
    if (status) status.textContent = `${fullDate(p.first)} tarihindeki ilk işlemden bugüne ${f0.format(keys.length)} hafta. `
      + (ui.perfView === 'twr' ? 'Zaman ağırlıklı getiri para giriş-çıkışlarından bağımsızdır; alışlar hafta başında, satışlar hafta sonunda sayılır. ' : '')
      + 'Temettüler grafikte yoktur (XIRR ve toplam kazançta vardır).';
  }

  function paintPerfAlt(p) {
    const el = document.getElementById('pfPerfAlt');
    if (!el) return;
    const lastOf = a => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
    const mine = lastOf(p.h.value);
    const rows = [
      ['Portföyüm', MINE_COLOR, mine],
      ['BIST 100', BENCH_COLOR, lastOf(p.alt.bist)],
      ['Dolar', USD_COLOR, lastOf(p.alt.usd)],
      ['Gram altın', GOLD_COLOR, lastOf(p.alt.gold)]
    ];
    el.innerHTML = card(`
      ${cardHead('Aynı parayı başka yere yatırsaydınız', 'Her alışın tutarı aynı hafta o varlığa yatırılır, her satışın tutarı oradan çekilir. Son haftanın kapanışıyla; temettüler hariç.')}
      <div class="overflow-x-auto" data-no-glossary>
        <table class="w-full text-left border-collapse text-sm">
          <thead><tr class="border-y border-oa-border text-[10px] font-mono uppercase tracking-widest text-slate-500">
            <th class="px-4 py-2.5">Varlık</th><th class="px-3 py-2.5 text-right">Bugünkü değer</th><th class="px-3 py-2.5 text-right">Portföyünüz bundan</th><th class="px-3 py-2.5 text-right hidden sm:table-cell">Net yatırılana göre</th>
          </tr></thead>
          <tbody class="font-mono">
            ${rows.map(([label, color, v]) => `
              <tr class="border-t border-oa-border/60">
                <td class="px-4 py-2.5 font-sans text-xs text-slate-200"><span class="inline-flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-sm" style="background:${color}"></span>${label}</span></td>
                <td class="px-3 py-2.5 text-right text-white">${amt(v)}</td>
                <td class="px-3 py-2.5 text-right ${label === 'Portföyüm' || v == null || mine == null ? 'text-slate-500' : tone(mine - v)}">${label === 'Portföyüm' || v == null || mine == null ? '—' : `${signedAmt(mine - v)} ${mine >= v ? 'fazla' : 'az'}`}</td>
                <td class="px-3 py-2.5 text-right hidden sm:table-cell ${tone(v - p.netIn)}">${v == null || !(p.netIn > 0) ? '—' : signed((v / p.netIn - 1) * 100)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`, 'overflow-hidden');
  }

  function paintPerfRisk(p) {
    const el = document.getElementById('pfPerfRisk');
    if (!el) return;
    const a = p.riskNow, b = p.riskReal;
    const val = (x, f) => (x && Number.isFinite(f(x)) ? f(x) : null);
    const row = (label, x, y, fmt) => `
      <tr class="border-t border-oa-border/60">
        <td class="px-4 py-2.5 font-sans text-xs text-slate-300">${label}</td>
        <td class="px-3 py-2.5 text-right font-mono text-white">${x == null ? '—' : fmt(x)}</td>
        <td class="px-3 py-2.5 text-right font-mono text-slate-300">${y == null ? '—' : fmt(y)}</td>
      </tr>`;
    el.innerHTML = card(`
      ${cardHead('Risk', 'Son 1 yılın haftalık getirileriyle. Beta 1\'den büyükse portföy BIST 100\'den daha sert hareket etmiştir. Yatırım tavsiyesi değildir.')}
      <div class="overflow-x-auto" data-no-glossary>
        <table class="w-full text-left border-collapse text-sm">
          <thead><tr class="border-y border-oa-border text-[10px] font-mono uppercase tracking-widest text-slate-500">
            <th class="px-4 py-2.5">Ölçü</th><th class="px-3 py-2.5 text-right">Bugünkü ağırlıklarla</th><th class="px-3 py-2.5 text-right">Gerçekleşen</th>
          </tr></thead>
          <tbody>
            ${row('Beta (BIST 100)', val(a, x => x.beta), val(b, x => x.beta), v => f2.format(v))}
            ${row('BIST 100 ile korelasyon', val(a, x => x.corr), val(b, x => x.corr), v => f2.format(v))}
            ${row('Yıllık oynaklık', val(a, x => x.vol), val(b, x => x.vol), v => pct(v, 0))}
            ${row('En derin düşüş', val(a, x => x.maxDD), val(b, x => x.maxDD), v => signed(v, 0))}
          </tbody>
        </table>
      </div>
      <p class="px-4 sm:px-5 py-3 text-[10px] text-slate-500 font-sans">“Bugünkü ağırlıklarla”: elinizdeki hisseler bir yıl boyunca bugünkü oranlarda tutulmuş gibi. “Gerçekleşen”: işlemlerinizle oluşan gerçek portföyün zaman ağırlıklı getirisi (${b ? `${b.weeks} hafta` : 'en az 12 hafta gerekir'}).</p>`, 'overflow-hidden');
  }

  function corrColor(v) {
    if (!Number.isFinite(v)) return 'transparent';
    const pole = v >= 0 ? DIV_POS : DIV_NEG;
    const t = Math.min(1, Math.abs(v));
    const c = DIV_MID.map((x, i) => Math.round(x + (pole[i] - x) * t));
    return `rgb(${c.join(',')})`;
  }

  function paintPerfCorr(p) {
    const el = document.getElementById('pfPerfCorr');
    if (!el) return;
    if (!p.corr) { el.innerHTML = card(`${cardHead('Hisseler arası korelasyon')}${empty('En az iki açık pozisyon gerekir.')}`); return; }
    const { values, weeks } = p.corr;
    const codes = p.corrCodes;
    const pairs = [];
    values.forEach((r, i) => r.forEach((v, j) => { if (j > i && Number.isFinite(v)) pairs.push(v); }));
    const avg = pairs.length ? pairs.reduce((s, x) => s + x, 0) / pairs.length : null;
    el.innerHTML = card(`
      ${cardHead('Hisseler arası korelasyon', `Son ${weeks} haftanın haftalık getirileri. Kırmızı birlikte hareket, mavi ters hareket demektir; ortalama ${avg == null ? '—' : f2.format(avg)}. Ortalama düştükçe çeşitlendirme artar.`)}
      <div class="px-4 sm:px-5 pb-5 overflow-x-auto" data-no-glossary>
        <table class="border-separate text-[11px] font-mono" style="border-spacing:2px">
          <thead><tr><th></th>${codes.map(c => `<th class="px-1 py-1 text-slate-400 font-bold">${c}</th>`).join('')}</tr></thead>
          <tbody>
            ${values.map((r, i) => `
              <tr><th class="pr-2 text-left text-slate-400 font-bold">${codes[i]}</th>
                ${r.map((v, j) => `<td class="w-12 h-8 text-center rounded text-white" style="background:${i === j ? '#1E2B45' : corrColor(v)}" title="${codes[i]} · ${codes[j]}: ${Number.isFinite(v) ? f2.format(v) : '—'}">${i === j ? '' : Number.isFinite(v) ? f2.format(v) : '—'}</td>`).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="flex items-center gap-2 mt-3 text-[10px] text-slate-500 font-sans">
          <span>−1 ters</span><span class="h-2 w-32 rounded-full" style="background:linear-gradient(90deg, rgb(${DIV_NEG}), rgb(${DIV_MID}), rgb(${DIV_POS}))"></span><span>+1 birlikte</span>
        </div>
      </div>`);
  }

  function paintPerfMonthly(p) {
    const el = document.getElementById('pfPerfMonthly');
    if (!el) return;
    const years = Object.keys(p.monthly).sort().reverse();
    if (!years.length) { el.innerHTML = ''; return; }
    const mm = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    const cell = v => (Number.isFinite(v)
      ? `<td class="px-2 py-2 text-right ${tone(v)}" style="background:${v > 0 ? `rgba(16,185,129,${Math.min(0.28, Math.abs(v) / 60)})` : `rgba(244,63,94,${Math.min(0.28, Math.abs(v) / 60)})`}">${signed(v)}</td>`
      : '<td class="px-2 py-2 text-right text-slate-700">·</td>');
    el.innerHTML = card(`
      ${cardHead('Aylık getiriler', 'Zaman ağırlıklı, ayın son haftasının kapanışına göre; yıl sütunu ayların bileşiği.')}
      <div class="overflow-x-auto" data-no-glossary>
        <table class="w-full border-collapse text-[11px] font-mono">
          <thead><tr class="border-y border-oa-border text-[10px] uppercase tracking-widest text-slate-500">
            <th class="px-3 py-2 text-left">Yıl</th>${mm.map(x => `<th class="px-2 py-2 text-right">${monthLabel(`2021-${x}`)}</th>`).join('')}<th class="px-3 py-2 text-right">Yıl</th>
          </tr></thead>
          <tbody>
            ${years.map(y => {
              const row = p.monthly[y];
              const yr = (Object.values(row).reduce((s, v) => s * (1 + v / 100), 1) - 1) * 100;
              return `<tr class="border-t border-oa-border/60"><td class="px-3 py-2 text-slate-300">${y}</td>${mm.map(x => cell(row[x])).join('')}<td class="px-3 py-2 text-right font-bold ${tone(yr)}">${signed(yr)}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`, 'overflow-hidden');
  }

  /* ---------- long-term sectors tab ---------- */
  function sectorsSkeleton() {
    const btn = (on, onclick, label) => `<button type="button" onclick="${onclick}" class="px-3 py-1.5 rounded-lg text-[11px] font-bold ${on ? 'bg-[#2F6BFF] text-white' : 'text-slate-400 hover:text-white'}">${label}</button>`;
    return `
      ${card(`
        ${cardHead('Sektörlerin uzun dönem seyri', 'Her sektör, en büyük şirketlerinden kurulan eşit ağırlıklı haftalık endeksle gösterilir (seçilen dönemin başında 100). “Portföyüm” bugünkü ağırlıklarınızın geçmişte nasıl seyredeceğini gösterir; gerçek alım tarihlerinizden bağımsızdır.',
          `<div class="flex flex-wrap gap-2 pf-noprint">
            <div class="flex rounded-xl bg-[#0C1322] border border-[#1A2540] p-1">${[1, 3, 5, 10].map(y => btn(ui.window === y, `Profile.setWindow(${y})`, `${y}Y`)).join('')}</div>
            <div class="flex rounded-xl bg-[#0C1322] border border-[#1A2540] p-1">${btn(ui.ccy === 'TRY', "Profile.setCcy('TRY')", 'TL')}${btn(ui.ccy === 'USD', "Profile.setCcy('USD')", 'Dolar')}</div>
          </div>`)}
        <div class="px-4 sm:px-5 pb-5">
          <div id="pfLtLegend" class="flex flex-wrap gap-x-4 gap-y-1.5 mb-3"></div>
          <div class="relative h-[320px]"><canvas id="pfLtChart" aria-label="Sektör endeksleri"></canvas></div>
          <p id="pfLtStatus" class="text-[11px] text-slate-500 font-sans mt-2" role="status">Fiyat geçmişi yükleniyor…</p>
        </div>`)}
      <div id="pfLtTable"></div>
      <div id="pfLtCards" class="grid grid-cols-1 lg:grid-cols-2 gap-5"></div>`;
  }

  /** Sectors to study: the portfolio's; with an empty portfolio, those of watched and viewed stocks. */
  function sectorsToStudy(m) {
    if (m.mix.length) return { from: 'portfolio', list: m.mix.slice(0, MAX_SECTORS).map(g => ({ sector: g.key, weight: g.weight, holdings: g.codes })) };
    const counts = new Map();
    const bump = (code, n) => { const s = company(code).sec; if (s) counts.set(s, (counts.get(s) || 0) + n); };
    (typeof getWatchlist === 'function' ? getWatchlist() : []).forEach(c => bump(c, 2));
    store.views.forEach(v => bump(v.code, 1));
    const list = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([sector]) => ({ sector, weight: null, holdings: [] }));
    return { from: 'interest', list };
  }

  /** The sector's largest companies by market value (shares x last close), holdings first. */
  function constituents(sector, holdings, fund, tech) {
    const ranked = [...directory()]
      .filter(([code, c]) => c.sec === sector && fund && fund.data[code] && techRow(tech, code))
      .map(([code]) => ({ code, mcap: fund.data[code][1] * techRow(tech, code).close }))
      .filter(x => x.mcap > 0)
      .sort((a, b) => b.mcap - a.mcap)
      .map(x => x.code);
    const out = [...holdings];
    for (const c of ranked) {
      if (out.length >= holdings.length + MEMBERS_PER_SECTOR || out.length >= 8) break;
      if (!out.includes(c)) out.push(c);
    }
    return out;
  }

  const study = { key: null, promise: null };
  function longTerm(m) {
    const { from, list } = sectorsToStudy(m);
    const weights = m.val.rows.filter(r => r.value > 0).map(r => [r.code, r.weight]);
    const key = JSON.stringify([list.map(s => [s.sector, s.holdings]), weights]);
    if (study.key === key) return study.promise;
    study.key = key;
    study.promise = (async () => {
      const [fund, tech] = [m.fund, m.tech];
      const [bist, usd] = await Promise.all([history('BIST100'), history('USDTRY')]);
      const bistIdx = Portfolio.blendIndex([bist]);
      const sectors = await Promise.all(list.map(async s => {
        const members = constituents(s.sector, s.holdings, fund, tech);
        const maps = await Promise.all(members.map(c => history(sym(c))));
        const okIdx = maps.map((mp, i) => (mp.size > 8 ? i : -1)).filter(i => i >= 0);
        const index = Portfolio.blendIndex(okIdx.map(i => maps[i]));
        const peers = [...directory()].filter(([, c]) => c.sec === s.sector).map(([code]) => code);
        return {
          ...s, members: okIdx.map(i => ({ code: members[i], from: [...maps[i].keys()][0] })), index, peers: peers.length,
          usd: Portfolio.deflate(index, usd),
          fundamentals: Portfolio.sectorFundamentals(peers.map(c => fundRow(fund, c)).filter(Boolean)),
          breadth: Portfolio.sectorBreadth(peers.map(c => techRow(tech, c)).filter(Boolean)),
          multiples: m.multiples && m.multiples.sectors[s.sector]
        };
      }));
      let mine = null;
      if (weights.length) {
        const maps = await Promise.all(weights.map(([c]) => history(sym(c))));
        const idx = Portfolio.blendIndex(maps, weights.map(w => w[1]));
        if (idx.keys.length > 8) mine = { index: idx, usd: Portfolio.deflate(idx, usd) };
      }
      return { from, sectors, bist: { index: bistIdx, usd: Portfolio.deflate(bistIdx, usd) }, mine };
    })();
    study.promise.catch(() => { study.key = null; });
    return study.promise;
  }

  /** The part of a series inside the chosen window, rebased to 100 at its start. */
  function windowed(series, years) {
    if (!series || !series.keys.length) return null;
    const last = Date.parse(`${series.keys[series.keys.length - 1]}T00:00:00Z`);
    const from = new Date(last - years * 365.25 * 864e5).toISOString().slice(0, 10);
    const i0 = series.keys.findIndex(k => k >= from);
    if (i0 < 0 || i0 >= series.keys.length - 1) return null;
    const base = series.values[i0];
    return { keys: series.keys.slice(i0), values: series.values.slice(i0).map(v => v / base * 100), partial: i0 === 0 && series.keys[0] > from };
  }

  function paintLongTerm(res) {
    const status = document.getElementById('pfLtStatus');
    const legend = document.getElementById('pfLtLegend');
    if (!legend) return;
    if (!res.sectors.length) {
      if (status) status.textContent = 'İncelenecek sektör yok: portföyünüze işlem ekleyin ya da izleme listenize hisse ekleyin.';
      legend.innerHTML = '';
      return;
    }
    const pick = s => (s ? (ui.ccy === 'USD' ? s.usd : s.index) : null);
    const colors = sectorColors(res.sectors.map(s => s.sector));
    const lines = [
      ...res.sectors.map(s => ({ label: s.sector, color: colors[s.sector], series: windowed(pick(s), ui.window) })),
      { label: 'BIST 100', color: BENCH_COLOR, series: windowed(pick(res.bist), ui.window), dash: [5, 4] },
      ...(res.mine ? [{ label: 'Portföyüm (bugünkü ağırlıklar)', color: MINE_COLOR, series: windowed(pick(res.mine), ui.window), width: 3 }] : [])
    ].filter(l => l.series);
    const keys = [...new Set(lines.flatMap(l => l.series.keys))].sort();
    lines.forEach(l => { const at = new Map(l.series.keys.map((k, i) => [k, l.series.values[i]])); l.data = keys.map(k => at.get(k) ?? null); });
    legend.innerHTML = legendHtml(lines);
    // Over 5-10 years a log scale keeps equal percentage moves the same height
    lineChart('pfLtChart', keys, lines, { log: ui.window >= 5, fmt: v => `${f1.format(v)} (${signed(v - 100)})` });
    const partial = lines.filter(l => l.series.partial).map(l => l.label);
    if (status) {
      status.textContent = `${res.from === 'interest' ? 'Portföyünüz boş; izleme listenizdeki ve incelediğiniz hisselerin sektörleri gösteriliyor. ' : ''}`
        + `Yahoo Finance haftalık kapanışları (gecikmeli)${ui.ccy === 'USD' ? ', USD/TRY kuruyla dolara çevrilmiş' : ''}${ui.window >= 5 ? '; logaritmik ölçek' : ''}. Temettüler dahil değildir. `
        + 'Sonradan halka arz olan şirketler fiyat geçmişleri başladığında endekse katılır (kartlarda başlangıç yılı); erken dönemde endeks daha az şirketten oluşur.'
        + (partial.length ? ` Geçmişi seçilen dönemden kısa: ${partial.join(', ')}.` : '');
    }
  }

  function paintLongTermTable(res) {
    const el = document.getElementById('pfLtTable');
    if (!el) return;
    const pick = s => (ui.ccy === 'USD' ? s.usd : s.index);
    const colors = sectorColors(res.sectors.map(s => s.sector));
    const rows = [
      ...res.sectors.map(s => ({ label: s.sector, color: colors[s.sector], st: Portfolio.seriesStats(pick(s)), weight: s.weight })),
      { label: 'BIST 100', color: BENCH_COLOR, st: Portfolio.seriesStats(pick(res.bist)), weight: null },
      ...(res.mine ? [{ label: 'Portföyüm', color: MINE_COLOR, st: Portfolio.seriesStats(pick(res.mine)), weight: null }] : [])
    ];
    const cell = v => `<td class="px-3 py-2.5 text-right ${tone(v)}">${signed(v, 0)}</td>`;
    el.innerHTML = card(`
      ${cardHead(`Getiri, oynaklık ve düşüş · ${ui.ccy === 'USD' ? 'dolar bazında' : 'TL bazında'}`, 'Yıllık bileşik getiri endeksin tüm geçmişi üzerinden; oynaklık haftalık getirilerin yıllıklandırılmış standart sapması; en derin düşüş zirveden dibe.')}
      <div class="overflow-x-auto" data-no-glossary>
        <table class="w-full text-left border-collapse text-sm">
          <thead><tr class="border-y border-oa-border text-[10px] font-mono uppercase tracking-widest text-slate-500">
            <th class="px-4 py-2.5">Seri</th>
            <th class="px-3 py-2.5 text-right">1Y</th><th class="px-3 py-2.5 text-right">3Y</th><th class="px-3 py-2.5 text-right">5Y</th><th class="px-3 py-2.5 text-right hidden sm:table-cell">10Y</th>
            <th class="px-3 py-2.5 text-right hidden md:table-cell">Yıllık bileşik</th>
            <th class="px-3 py-2.5 text-right hidden md:table-cell">Oynaklık</th>
            <th class="px-3 py-2.5 text-right hidden md:table-cell">En derin düşüş</th>
          </tr></thead>
          <tbody class="font-mono">
            ${rows.map(r => `
              <tr class="border-t border-oa-border/60">
                <td class="px-4 py-2.5 font-sans text-xs text-slate-200"><span class="inline-flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background:${r.color}"></span>${esc(r.label)}${r.weight != null ? ` <span class="text-slate-500 font-mono">${pct(r.weight, 0)}</span>` : ''}</span></td>
                ${r.st ? `${cell(r.st.r1)}${cell(r.st.r3)}${cell(r.st.r5)}<td class="px-3 py-2.5 text-right hidden sm:table-cell ${tone(r.st.r10)}">${signed(r.st.r10, 0)}</td>
                <td class="px-3 py-2.5 text-right hidden md:table-cell ${tone(r.st.cagr)}">${signed(r.st.cagr)}</td>
                <td class="px-3 py-2.5 text-right hidden md:table-cell text-slate-300">${pct(r.st.vol, 0)}</td>
                <td class="px-3 py-2.5 text-right hidden md:table-cell text-rose-400">${signed(r.st.maxDD, 0)}</td>` : '<td colspan="7" class="px-3 py-2.5 text-right text-slate-500 text-xs">veri yok</td>'}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`, 'overflow-hidden');
  }

  function paintSectorCards(res, m) {
    const el = document.getElementById('pfLtCards');
    if (!el) return;
    const colors = sectorColors(res.sectors.map(s => s.sector));
    const all = m.multiples && m.multiples.all;
    el.innerHTML = res.sectors.map(s => {
      const f = s.fundamentals, b = s.breadth, mu = s.multiples;
      const usdSt = Portfolio.seriesStats(s.usd), bistUsd = Portfolio.seriesStats(res.bist.usd);
      const vsBist = usdSt && bistUsd && Number.isFinite(usdSt.r5) && Number.isFinite(bistUsd.r5) ? usdSt.r5 - bistUsd.r5 : null;
      const mine = m.val.rows.filter(r => r.sector === s.sector && r.value > 0);
      const kv = (label, value, sub = '') => `<div class="flex items-baseline justify-between gap-3 py-1.5 border-t border-oa-border/50 text-xs"><span class="text-slate-400 font-sans">${label}</span><span class="font-mono text-white text-right">${value}${sub ? ` <span class="text-slate-500">${sub}</span>` : ''}</span></div>`;
      return card(`
        <div class="px-4 sm:px-5 pt-4 pb-2 flex items-start gap-3">
          <span class="w-3 h-3 rounded-sm mt-1.5 shrink-0" style="background:${colors[s.sector]}"></span>
          <div class="min-w-0 flex-1">
            <h3 class="font-serif font-bold text-white text-base">${esc(s.sector)}</h3>
            <p class="text-[11px] text-slate-500 font-sans">Endeks: ${s.members.length ? s.members.map(x => `${x.code} <span class="text-slate-600">${x.from.slice(0, 4)}</span>`).join(', ') : '—'} · sektörde ${s.peers} şirket (bilançosu olan ${f.n})${s.weight != null ? ` · portföyde ${pct(s.weight)}` : ''}</p>
          </div>
        </div>
        <div class="px-4 sm:px-5 pb-4" data-no-glossary>
          ${kv('Medyan F/K · PD/DD', `${mult(mu && mu.pe)} · ${mult(mu && mu.pb)}`, all ? `BIST ${mult(all.pe)} · ${mult(all.pb)}` : '')}
          ${kv('Medyan ROE · net marj', `${pct(f.roe)} · ${pct(f.netMargin)}`)}
          ${kv('Medyan net borç / FAVÖK', Number.isFinite(f.netDebtEbitda) ? `${f1.format(f.netDebtEbitda)}x` : '—')}
          ${kv('Kâr eden şirket oranı', pct(f.profitable, 0))}
          ${kv('200 günlük ortalamanın üstünde', pct(b.above200, 0), `3 ay medyan ${signed(b.m3)}`)}
          ${kv('52 hafta zirvesine uzaklık (medyan)', signed(b.hi52))}
          ${kv('5 yıl dolar getirisi BIST 100\'e göre', vsBist == null ? '—' : `<span class="${tone(vsBist)}">${vsBist > 0 ? '+' : vsBist < 0 ? '−' : ''}${f0.format(Math.abs(vsBist))} puan</span>`)}
          ${mine.length ? `<div class="mt-3 space-y-1.5">${mine.map(r => `
            <div class="flex items-center justify-between gap-3 text-[11px] font-mono rounded-lg bg-[#090D18] border border-[#162238] px-3 py-2">
              <button type="button" onclick="Profile.open('${r.code}')" class="font-bold text-white hover:text-[#7FA6FF]">${r.code}</button>
              <span class="text-slate-400">F/K ${mult(r.fk)} <span class="text-slate-600">/ ${mult(mu && mu.pe)}</span></span>
              <span class="text-slate-400">PD/DD ${mult(r.pb)} <span class="text-slate-600">/ ${mult(mu && mu.pb)}</span></span>
              <span class="text-slate-400">ROE ${pct(r.roe)} <span class="text-slate-600">/ ${pct(f.roe)}</span></span>
            </div>`).join('')}<p class="text-[10px] text-slate-500 font-sans">Hisseniz / sektör medyanı.</p></div>` : ''}
        </div>`);
    }).join('');
  }

  /* ---------- plan tab ---------- */
  function planSkeleton() {
    const g = store.goal;
    const val = v => (v == null || v === '' ? '' : String(v).replace('.', ','));
    return `
      <div id="pfRebalance">${card(loading('Hedef dağılım hesaplanıyor…'))}</div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        ${card(`${cardHead('Finansal hedef', 'Bugünkü portföy değeri (nakit dahil) ve aylık birikimle, sizin varsayımlarınıza göre aylık bileşik hesap. Getiri ve enflasyon tahmin değildir; kendi beklentinizi yazın.')}
          <form oninput="Profile.goalInput()" onsubmit="event.preventDefault()" class="px-4 sm:px-5 pb-4 grid grid-cols-2 gap-3 pf-noprint">
            <label class="col-span-2 sm:col-span-1"><span class="${LABEL}">Hedef tutar (bugünün parasıyla)</span><input id="pfGoalTarget" inputmode="decimal" value="${val(g.target)}" placeholder="ör. 1.000.000" class="${INPUT}"></label>
            <label><span class="${LABEL}">Süre (yıl)</span><input id="pfGoalYears" inputmode="decimal" value="${val(g.years)}" placeholder="10" class="${INPUT}"></label>
            <label><span class="${LABEL}">Aylık birikim (₺)</span><input id="pfGoalMonthly" inputmode="decimal" value="${val(g.monthly)}" placeholder="ör. 5000" class="${INPUT}"></label>
            <label><span class="${LABEL}">Beklenen yıllık getiri (%)</span><input id="pfGoalRate" inputmode="decimal" value="${val(g.rate)}" placeholder="varsayımınız" class="${INPUT}"></label>
            <label><span class="${LABEL}">Beklenen yıllık enflasyon (%)</span><input id="pfGoalInfl" inputmode="decimal" value="${val(g.inflation)}" placeholder="varsayımınız" class="${INPUT}"></label>
          </form>
          <div id="pfGoalOut" class="px-4 sm:px-5 pb-5"></div>`)}
        <div class="space-y-5 min-w-0">
          <div id="pfCash"></div>
          <div id="pfLevels"></div>
        </div>
      </div>`;
  }

  function rebalanceRows(m) {
    const targets = targetsOf();
    const prices = { ...m.prices };
    Object.keys(targets).forEach(c => {
      if (!(prices[c] > 0)) { const f = finOf(c); if (f && f.priceNum > 0) prices[c] = f.priceNum; else { const t = techRow(m.tech, c); if (t) prices[c] = t.close; } }
    });
    const cash = ui.rbCash == null ? cashOf() : ui.rbCash;
    return Portfolio.rebalance(m.val.rows.map(r => ({ code: r.code, value: r.value })), targets, prices, cash, ui.rbMode);
  }

  let lastPlanModel = null;
  function paintRebalance(m) {
    lastPlanModel = m;
    const el = document.getElementById('pfRebalance');
    if (!el) return;
    if (isAll()) {
      el.innerHTML = card(`${cardHead('Hedef dağılım ve dengeleme')}${empty('Hedef dağılım portföy başına tutulur: yukarıdan bir portföy seçin.')}`);
      return;
    }
    const rb = rebalanceRows(m);
    const cash = ui.rbCash == null ? cashOf() : ui.rbCash;
    const btn = (on, onclick, label) => `<button type="button" onclick="${onclick}" class="px-3 py-1.5 rounded-lg text-[11px] font-bold ${on ? 'bg-[#2F6BFF] text-white' : 'text-slate-400 hover:text-white'}">${label}</button>`;
    el.innerHTML = card(`
      ${cardHead('Hedef dağılım ve dengeleme', 'Her hisse için istediğiniz ağırlığı yazın; hedefsiz pozisyonlar olduğu gibi kalır, hedefler kendi aralarında %100\'e ölçeklenir. Adetler tam sayıya aşağı yuvarlanır; işlemler siz kaydedene kadar portföye işlenmez. Yatırım tavsiyesi değildir.',
        `<div class="flex rounded-xl bg-[#0C1322] border border-[#1A2540] p-1 pf-noprint">${btn(ui.rbMode === 'full', "Profile.setRbMode('full')", 'Al ve sat')}${btn(ui.rbMode === 'buy', "Profile.setRbMode('buy')", 'Yalnız alım')}</div>`)}
      <div class="px-4 sm:px-5 pb-3 flex flex-wrap items-end gap-3 pf-noprint">
        <label class="w-40"><span class="${LABEL}">Eklenecek para (₺)</span><input id="pfRbCash" inputmode="decimal" value="${cash ? String(cash).replace('.', ',') : ''}" placeholder="0" onchange="Profile.setRbCash(this.value)" class="${INPUT}"></label>
        <label class="w-40"><span class="${LABEL}">Hisse ekle</span><input id="pfRbAdd" list="pfCodes" placeholder="KOD" onchange="Profile.addTarget(this.value)" class="${INPUT} uppercase"></label>
        <div class="flex flex-wrap gap-2">
          <button type="button" onclick="Profile.targetsFrom('equal')" class="px-3 py-2 rounded-xl bg-[#0C1322] border border-[#1A2540] text-[11px] font-bold text-slate-300 hover:text-white">Eşit ağırlık</button>
          <button type="button" onclick="Profile.targetsFrom('current')" class="px-3 py-2 rounded-xl bg-[#0C1322] border border-[#1A2540] text-[11px] font-bold text-slate-300 hover:text-white">Bugünkü ağırlıklar</button>
          <button type="button" onclick="Profile.targetsFrom('clear')" class="px-3 py-2 rounded-xl bg-[#0C1322] border border-[#1A2540] text-[11px] font-bold text-slate-400 hover:text-rose-400">Temizle</button>
        </div>
        <datalist id="pfCodes"></datalist>
      </div>
      ${rb.rows.length ? `
      <div class="overflow-x-auto" data-no-glossary>
        <table class="w-full text-left border-collapse text-sm">
          <thead><tr class="border-y border-oa-border text-[10px] font-mono uppercase tracking-widest text-slate-500">
            <th class="px-4 py-2.5">Hisse</th><th class="px-3 py-2.5 text-right">Şimdi</th><th class="px-3 py-2.5 text-right w-28">Hedef %</th>
            <th class="px-3 py-2.5 text-right">İşlem</th><th class="px-3 py-2.5 text-right hidden sm:table-cell">Tutar</th><th class="px-3 py-2.5 text-right hidden md:table-cell">Sonra</th>
          </tr></thead>
          <tbody class="font-mono">
            ${rb.rows.map(r => `
              <tr class="border-t border-oa-border/60">
                <td class="px-4 py-2"><button type="button" onclick="Profile.open('${r.code}')" class="font-bold text-white hover:text-[#7FA6FF]">${r.code}</button> <span class="text-[11px] text-slate-500 font-sans">${r.price ? tl(r.price) : 'fiyat yok'}</span></td>
                <td class="px-3 py-2 text-right text-slate-300">${pct(r.weightNow)}</td>
                <td class="px-3 py-2 text-right"><input inputmode="decimal" data-fk="w-${r.code}" value="${r.target ? String(r.target).replace('.', ',') : ''}" placeholder="—" onchange="Profile.setWeight('${r.code}', this.value)" class="w-20 px-2 py-1.5 rounded-lg bg-[#0C1322] border border-[#1A2540] text-right text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#2F6BFF] pf-noprint"><span class="hidden print:inline">${r.target ? pct(r.target) : '—'}</span></td>
                <td class="px-3 py-2 text-right font-bold ${r.shares > 0 ? 'text-emerald-400' : r.shares < 0 ? 'text-rose-400' : 'text-slate-500'}">${r.shares > 0 ? `AL ${f0.format(r.shares)}` : r.shares < 0 ? `SAT ${f0.format(-r.shares)}` : '—'}</td>
                <td class="px-3 py-2 text-right text-slate-300 hidden sm:table-cell">${r.trade ? signedAmt(r.trade) : '—'}</td>
                <td class="px-3 py-2 text-right text-slate-300 hidden md:table-cell">${pct(r.weightAfter)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-3 border-t border-oa-border/60">
        <div class="flex flex-wrap gap-x-5 gap-y-1 text-xs font-mono">
          <span class="text-slate-400">Hedef toplamı <span class="${Math.abs(rb.tsum - 100) < 0.01 || !rb.tsum ? 'text-white' : 'text-amber-400'}">${pct(rb.tsum)}</span></span>
          <span class="text-slate-400">Alış <span class="text-emerald-400">${amt(rb.buy)}</span></span>
          <span class="text-slate-400">Satış <span class="text-rose-400">${amt(rb.sell)}</span></span>
          <span class="text-slate-400">Artan nakit <span class="text-white">${amt(rb.left)}</span></span>
        </div>
        ${rb.buy || rb.sell ? '<button type="button" onclick="Profile.applyRebalance()" class="px-4 py-2 rounded-xl bg-[#2F6BFF] hover:bg-[#4A7FFF] text-white text-xs font-semibold pf-noprint"><i class="fa-solid fa-check"></i> İşlemleri portföye kaydet</button>' : ''}
      </div>` : empty('Portföyde pozisyon ya da hedef yok. Yukarıdan hisse ekleyin ya da komutla: <code class="font-mono text-[#7FA6FF]">ağırlık THYAO 20</code>')}`, 'overflow-hidden');
    codeOptions();
  }

  function paintCash(m) {
    const el = document.getElementById('pfCash');
    if (!el) return;
    const total = m.val.total + m.cash;
    el.innerHTML = card(`
      ${cardHead('Nakit', isAll() ? 'Tüm portföylerin nakdi; değiştirmek için bir portföy seçin.' : 'Aracı kurumdaki ya da yatırım için ayırdığınız nakit. Portföy değerine eklenir, hedef dağılımda “eklenecek para” olarak kullanılır.')}
      <div class="px-4 sm:px-5 pb-5 space-y-3">
        ${isAll() ? '' : `<label class="block pf-noprint"><span class="${LABEL}">Nakit (₺)</span><input inputmode="decimal" value="${m.cash ? String(m.cash).replace('.', ',') : ''}" placeholder="0" onchange="Profile.setCash(this.value)" class="${INPUT}"></label>`}
        <div class="grid grid-cols-2 gap-2" data-no-glossary>
          ${stat('Toplam varlık', amt(total), 'hisseler + nakit')}
          ${stat('Nakit payı', total > 0 ? pct(m.cash / total * 100) : '—', amt(m.cash))}
        </div>
      </div>`);
  }

  function paintLevels(m) {
    const el = document.getElementById('pfLevels');
    if (!el) return;
    const rows = m.val.rows;
    if (!rows.length) { el.innerHTML = ''; return; }
    const input = (code, kind, v) => `<input inputmode="decimal" data-fk="lv-${code}-${kind}" value="${v ? String(v).replace('.', ',') : ''}" placeholder="—" onchange="Profile.setLevel('${code}', '${kind}', this.value)" class="w-20 px-2 py-1.5 rounded-lg bg-[#0C1322] border border-[#1A2540] text-right text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#2F6BFF]">`;
    el.innerHTML = card(`
      ${cardHead('Zarar-kes ve hedef fiyat', 'Bir seviye yazınca fiyat alarmı da kurulur (izleme listesi ve alarmlar menüsünde görünür). Komutla: <code class="font-mono text-[#7FA6FF]">stop THYAO 250</code>, <code class="font-mono text-[#7FA6FF]">hedef THYAO 400</code>')}
      <div class="overflow-x-auto" data-no-glossary>
        <table class="w-full text-left border-collapse text-xs font-mono">
          <thead><tr class="border-y border-oa-border text-[10px] uppercase tracking-widest text-slate-500">
            <th class="px-4 py-2">Hisse</th><th class="px-2 py-2 text-right">Fiyat</th><th class="px-2 py-2 text-right">Zarar-kes</th><th class="px-2 py-2 text-right">Hedef</th><th class="px-3 py-2 text-right">Risk / getiri</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => {
              const l = store.levels[r.code] || {};
              const down = l.stop > 0 && r.price ? (l.stop / r.price - 1) * 100 : null;
              const up = l.target > 0 && r.price ? (l.target / r.price - 1) * 100 : null;
              const rr = down < 0 && up > 0 ? up / -down : null;
              return `
                <tr class="border-t border-oa-border/60">
                  <td class="px-4 py-2 font-bold text-white">${r.code}</td>
                  <td class="px-2 py-2 text-right text-slate-300">${tl(r.price)}</td>
                  <td class="px-2 py-2 text-right">${input(r.code, 'stop', l.stop)}<div class="text-[10px] ${tone(down)}">${signed(down)}</div></td>
                  <td class="px-2 py-2 text-right">${input(r.code, 'target', l.target)}<div class="text-[10px] ${tone(up)}">${signed(up)}</div></td>
                  <td class="px-3 py-2 text-right text-slate-300">${rr == null ? '—' : `1 : ${f1.format(rr)}`}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`, 'overflow-hidden');
  }

  function goalValues() {
    const n = id => { const v = parseNum(document.getElementById(id)?.value); return Number.isFinite(v) ? v : null; };
    return { target: n('pfGoalTarget'), years: n('pfGoalYears'), monthly: n('pfGoalMonthly'), rate: n('pfGoalRate'), inflation: n('pfGoalInfl') };
  }

  function paintGoal(m) {
    const el = document.getElementById('pfGoalOut');
    if (!el) return;
    const g = document.getElementById('pfGoalTarget') ? goalValues() : store.goal;
    const now = m.val.total + m.cash;
    if (!(g.target > 0) || !(g.years > 0) || !Number.isFinite(g.rate) || !Number.isFinite(g.inflation)) {
      el.innerHTML = '<p class="text-xs text-slate-500 font-sans">Hedef tutarı, süreyi, beklenen yıllık getiriyi ve enflasyonu yazınca plan burada çıkar.</p>';
      if (charts.pfGoalChart) { charts.pfGoalChart.destroy(); delete charts.pfGoalChart; }
      return;
    }
    const plan = Portfolio.goalPlan({ now, monthly: g.monthly || 0, rate: g.rate, years: g.years, target: g.target, inflation: g.inflation });
    const progress = Math.min(100, now / g.target * 100);
    const ok = plan.real >= g.target;
    const reach = plan.reach == null ? '50 yıl içinde ulaşılmıyor' : plan.reach <= 0 ? 'zaten ulaşıldı' : `${Math.floor(plan.reach / 12)} yıl ${plan.reach % 12} ay`;
    el.innerHTML = `
      <div class="space-y-3">
        <div>
          <div class="flex justify-between text-[11px] font-mono text-slate-400 mb-1"><span>Bugün ${amt(now)}</span><span>${pct(progress, 0)}</span></div>
          <div class="h-2 rounded-full bg-[#162238] overflow-hidden"><div class="h-full rounded-full bg-[#3987e5]" style="width:${progress}%"></div></div>
        </div>
        <div class="grid grid-cols-2 gap-2" data-no-glossary>
          ${stat(`${f0.format(g.years)} yıl sonra`, amt(plan.fv), `bugünün parasıyla ${amt(plan.real)}`, ok ? 'text-emerald-400' : 'text-white')}
          ${stat('Hedefe ulaşma', reach, ok ? 'bu birikimle hedef aşılıyor' : `hedef o gün ${amt(plan.targetNominal)}`)}
          ${stat('Gereken aylık birikim', amt(plan.need), 'hedefe tam süresinde ulaşmak için', plan.need > (g.monthly || 0) ? 'text-amber-300' : 'text-emerald-400')}
          ${stat('Reel getiri varsayımı', signed(((1 + g.rate / 100) / (1 + g.inflation / 100) - 1) * 100), 'yıllık, enflasyondan arındırılmış')}
        </div>
        <div id="pfGoalLegend" class="flex flex-wrap gap-x-4 gap-y-1.5"></div>
        <div class="relative h-[200px]"><canvas id="pfGoalChart" aria-label="Hedef planı"></canvas></div>
      </div>`;
    const lines = [
      { label: 'Tahmini değer', color: SLOTS[0], data: plan.path.map(x => x.value) },
      { label: 'Hedef (enflasyonla)', color: BENCH_COLOR, data: plan.path.map(x => x.target), dash: [5, 4] },
      { label: 'Yatırdığınız', color: SLOTS[1], data: plan.path.map(x => x.paid) }
    ];
    document.getElementById('pfGoalLegend').innerHTML = legendHtml(lines);
    lineChart('pfGoalChart', plan.path.map(x => `${x.year}. yıl`), lines, { money: true, title: k => k });
  }

  /* ---------- news and journal tab ---------- */
  function newsSkeleton() {
    return `
      <div class="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div class="lg:col-span-3 min-w-0" id="pfKap">${card(loading('KAP bildirimleri yükleniyor…'))}</div>
        <div class="lg:col-span-2 space-y-5 min-w-0">
          ${card(`${cardHead('Yatırım günlüğü', 'Kararlarınızı ve nedenlerini tarihleriyle yazın; zamanla en değerli kayıt bu olur. Komutla: <code class="font-mono text-[#7FA6FF]">günlük THYAO bilanço iyi geldi</code>')}
            <form onsubmit="Profile.addJournal(event)" class="px-4 sm:px-5 pb-5 space-y-2 pf-noprint">
              <textarea id="pfJournalText" rows="3" maxlength="800" required placeholder="Bugün ne düşündünüz, ne yaptınız, neden?" class="w-full px-3 py-2 rounded-xl bg-[#0C1322] border border-[#1A2540] text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#2F6BFF] font-sans resize-y"></textarea>
              <div class="flex gap-2">
                <input id="pfJournalCode" list="pfCodes" placeholder="Hisse (isteğe bağlı)" class="${INPUT} uppercase text-xs">
                <button type="submit" class="shrink-0 px-4 py-2 rounded-xl bg-[#2F6BFF] hover:bg-[#4A7FFF] text-white text-xs font-semibold">Ekle</button>
              </div>
              <datalist id="pfCodes"></datalist>
            </form>`)}
          <div id="pfTimeline"></div>
        </div>
      </div>`;
  }

  /** "05.08.2026 08:01:20" -> "2026-08-05 08:01" (sortable). */
  const kapSort = s => { const x = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}):(\d{2}))?/.exec(s || ''); return x ? `${x[3]}-${x[2]}-${x[1]} ${x[4] || '00'}:${x[5] || '00'}` : ''; };
  const kapCache = new Map();
  async function kapFor(code) {
    const raw = typeof getRawCompany === 'function' ? getRawCompany(code) : null;
    if (!raw || !raw.mkk) return { code, items: [], ok: false };
    const codes = [...new Set([code, ...String(raw.c || '').split(',').map(s => s.trim().toUpperCase())])].filter(c => /^[A-Z0-9]{2,6}$/.test(c)).slice(0, 8);
    const hit = kapCache.get(code);
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.body;
    try {
      const r = await limited(() => fetch(`/api/disclosures?oid=${encodeURIComponent(raw.mkk)}&codes=${encodeURIComponent(codes.join(','))}`));
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const body = { code, ok: true, items: (j.items || []).map(i => ({ ...i, code, sort: kapSort(i.date) })) };
      kapCache.set(code, { at: Date.now(), body });
      return body;
    } catch (e) {
      return { code, items: [], ok: false };
    }
  }

  async function paintKap(m, token) {
    const el = document.getElementById('pfKap');
    if (!el) return;
    const codes = m.val.rows.slice(0, MAX_KAP).map(r => r.code);
    if (!codes.length) { el.innerHTML = card(`${cardHead('Portföyünüzün KAP bildirimleri')}${empty('Portföyde pozisyon olunca şirketlerin KAP bildirimleri burada toplanır.')}`); return; }
    const res = await Promise.all(codes.map(kapFor));
    if (token !== ui.token || ui.tab !== 'news') return;
    const items = res.flatMap(r => r.items).sort((a, b) => b.sort.localeCompare(a.sort)).slice(0, 40);
    const failed = res.filter(r => !r.ok).map(r => r.code);
    const CLS = { ODA: ['ÖZEL DURUM', 'text-red-400 border-red-800/50 bg-red-950/40'], FR: ['FİNANSAL RAPOR', 'text-emerald-400 border-emerald-800/50 bg-emerald-950/60'], DG: ['DİĞER', 'text-slate-300 border-slate-700 bg-slate-800'], DKB: ['DÜZENLEYİCİ', 'text-indigo-400 border-indigo-800/50 bg-indigo-950/60'], GKB: ['GENEL KURUL', 'text-indigo-400 border-indigo-800/50 bg-indigo-950/60'] };
    el.innerHTML = card(`
      ${cardHead('Portföyünüzün KAP bildirimleri', `${codes.join(', ')} · en yeni üstte · kaynak: kap.org.tr${failed.length ? ` · alınamayan: ${failed.join(', ')}` : ''}`)}
      <div class="max-h-[640px] overflow-y-auto">
        ${items.length ? items.map(d => {
          const c = CLS[d.cls] || [d.type || 'BİLDİRİM', 'text-slate-300 border-slate-700 bg-slate-800'];
          return `
            <a href="https://www.kap.org.tr/tr/Bildirim/${encodeURIComponent(d.index)}" target="_blank" rel="noopener" class="block px-4 sm:px-5 py-3 border-t border-oa-border/60 hover:bg-[#121C30]/40">
              <div class="flex items-center gap-2 text-[10px] font-mono">
                <span class="font-bold text-white">${d.code}</span>
                <span class="px-1.5 py-0.5 rounded border ${c[1]}">${esc(c[0])}</span>
                <span class="ml-auto text-slate-500">${esc(d.date || '')}</span>
              </div>
              <div class="text-xs text-slate-200 font-sans mt-1 leading-snug">${esc(d.summary || d.subject)}</div>
              ${d.summary && d.subject ? `<div class="text-[11px] text-slate-500 font-sans mt-0.5">${esc(d.subject)}</div>` : ''}
            </a>`;
        }).join('') : empty(failed.length === codes.length ? 'KAP şu an yanıt vermiyor; birazdan tekrar deneyin.' : 'Son dönemde bildirim yok.')}
      </div>`, 'overflow-hidden');
  }

  function paintTimeline(m) {
    const el = document.getElementById('pfTimeline');
    if (!el) return;
    const events = [
      ...store.journal.map(j => ({ date: new Date(j.at).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }), at: j.at, kind: 'journal', j })),
      ...m.txs.map(t => ({ date: t.date, at: Date.parse(`${t.date}T12:00:00Z`) + (t.seq || 0), kind: 'trade', t })),
      ...m.received.items.map(d => ({ date: d.date, at: Date.parse(`${d.date}T09:00:00Z`), kind: 'div', d }))
    ].sort((a, b) => b.at - a.at).slice(0, 80);
    const line = e => {
      if (e.kind === 'journal') return `
        <div class="flex gap-3"><i class="fa-solid fa-pen-nib text-[#7FA6FF] text-xs mt-1"></i><div class="flex-1 min-w-0">
          <div class="text-[10px] font-mono text-slate-500">${fullDate(e.date)}${e.j.code ? ` · <button type="button" onclick="Profile.open('${e.j.code}')" class="text-white font-bold">${e.j.code}</button>` : ''}
            <button type="button" onclick="Profile.removeJournal('${e.j.id}')" class="ml-2 text-slate-600 hover:text-rose-400 pf-noprint" title="Sil"><i class="fa-solid fa-xmark"></i></button></div>
          <p class="text-xs text-slate-200 font-sans whitespace-pre-wrap leading-relaxed">${esc(e.j.text)}</p></div></div>`;
      if (e.kind === 'trade') return `
        <div class="flex gap-3"><i class="fa-solid ${e.t.type === 'buy' ? 'fa-arrow-down text-emerald-400' : 'fa-arrow-up text-rose-400'} text-xs mt-1"></i><div class="text-xs font-mono text-slate-300">
          <span class="text-[10px] text-slate-500">${fullDate(e.date)}</span> ${e.t.type === 'buy' ? 'Alış' : 'Satış'} <b class="text-white">${e.t.code}</b> ${fq.format(e.t.qty)} × ${tl(e.t.price)}</div></div>`;
      return `
        <div class="flex gap-3"><i class="fa-solid fa-coins text-amber-300 text-xs mt-1"></i><div class="text-xs font-mono text-slate-300">
          <span class="text-[10px] text-slate-500">${fullDate(e.date)}</span> Temettü <b class="text-white">${e.d.code}</b> ${amt(e.d.cash)}</div></div>`;
    };
    el.innerHTML = card(`
      ${cardHead('Zaman çizelgesi', 'Günlük notlarınız, işlemleriniz ve hak kazandığınız temettüler bir arada.')}
      <div class="px-4 sm:px-5 pb-5 space-y-3 max-h-[560px] overflow-y-auto">${events.length ? events.map(line).join('') : '<p class="text-xs text-slate-500 font-sans">Henüz kayıt yok.</p>'}</div>`);
  }

  /* ---------- activity tab ---------- */
  function ago(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return 'az önce';
    if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
    if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} gün önce`;
    return new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  }

  function activityHtml() {
    const views = store.views;
    const interest = Portfolio.groupWeights(views.map(v => ({ code: v.code, value: v.n, sector: company(v.code).sec || 'Diğer' })), r => r.sector);
    const watch = typeof getWatchlist === 'function' ? getWatchlist() : [];
    const held = new Set(Portfolio.positions(store.txs).filter(p => p.qty > 0).map(p => p.code));
    const list = views.length ? views.map(v => {
      const f = finOf(v.code);
      const live = f && f.liveTime;
      return `
        <div class="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-t border-oa-border/60">
          <div class="flex-1 min-w-0">${stockCell(v.code, company(v.code).name)}</div>
          <div class="hidden sm:block text-right text-[11px] font-sans text-slate-500 w-28">${ago(v.at)}<br>${v.n} kez</div>
          <div class="text-right font-mono text-xs w-24">${live ? `<div class="text-white">₺${f.price}</div><div class="${f.isPositive ? 'text-emerald-400' : 'text-rose-400'}">${f.change}</div>` : '<span class="text-slate-600">—</span>'}</div>
          <div class="flex gap-1 pf-noprint">
            <button type="button" onclick="toggleStockWatchlist('${v.code}'); Profile.render()" class="w-7 h-7 rounded-lg bg-[#090D18] border border-[#1E2B45] text-xs ${watch.includes(v.code) ? 'text-amber-400' : 'text-slate-400 hover:text-amber-400'}" title="İzleme listesi"><i class="fa-${watch.includes(v.code) ? 'solid' : 'regular'} fa-star"></i></button>
            <button type="button" onclick="Profile.quickAdd('${v.code}')" class="w-7 h-7 rounded-lg bg-[#090D18] border border-[#1E2B45] text-xs ${held.has(v.code) ? 'text-emerald-400' : 'text-slate-400 hover:text-emerald-400'}" title="Portföye ekle"><i class="fa-solid fa-briefcase"></i></button>
          </div>
        </div>`;
    }).join('') : empty('Henüz hisse incelemediniz. Bir hisse sayfası açtığınızda burada listelenir.');
    return `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div class="lg:col-span-2 min-w-0">
          ${card(`${cardHead('İncelediğiniz hisseler', `Son ${MAX_VIEWS} hisse, en yeni üstte.`, views.length ? '<button type="button" onclick="Profile.clearViews()" class="text-[11px] font-bold text-slate-400 hover:text-rose-400 pf-noprint"><i class="fa-solid fa-broom"></i> Temizle</button>' : '')}
            <div class="max-h-[560px] overflow-y-auto">${list}</div>`, 'overflow-hidden')}
        </div>
        <div class="space-y-5 min-w-0">
          ${interest.length ? card(`${cardHead('İlgi alanınız', 'İncelediğiniz hisselerin sektörleri, inceleme sayısına göre.')}${mixHtml(interest.slice(0, 7), sectorColors(interest.slice(0, 7).map(g => g.key)))}`) : ''}
          ${card(`${cardHead('İzleme listesi ve alarmlar', `${watch.length} hisse izleniyor.`)}
            <div class="px-4 sm:px-5 pb-5 space-y-3">
              <div class="flex flex-wrap gap-1.5">${watch.map(c => `<button type="button" onclick="Profile.open('${c}')" class="px-2 py-1 rounded-lg bg-[#090D18] border border-[#1E2B45] text-[11px] font-mono font-bold text-slate-300 hover:text-white">${c}</button>`).join('') || '<span class="text-xs text-slate-500 font-sans">Liste boş.</span>'}</div>
              <button type="button" onclick="toggleWatchlistDrawer(true)" class="w-full py-2 rounded-xl bg-[#0C1322] border border-[#1A2540] text-xs font-bold text-slate-300 hover:text-white pf-noprint"><i class="fa-solid fa-bell"></i> Listeyi ve alarmları aç</button>
            </div>`)}
        </div>
      </div>`;
  }

  /* ---------- commands tab ---------- */
  const HELP = [
    ['İşlemler', [
      ['al KOD ADET [FİYAT] [TARİH]', 'al THYAO 100 312,50', 'Alış kaydı. Fiyat yoksa gecikmeli güncel fiyat, tarih yoksa bugün.'],
      ['sat KOD ADET [FİYAT] [TARİH]', 'sat THYAO 50', 'Satış kaydı; elinizdeki adetten fazlası satılamaz.'],
      ['nakit TUTAR · +TUTAR · −TUTAR', 'nakit +5000', 'Portföyün nakdini yazar, ekler ya da düşer.'],
      ['portföy [AD]', 'portföy Temettü', 'Portföye geçer; yoksa o adla yenisini açar. “portföy tümü” hepsini gösterir.'],
      ['geri al', 'geri al', 'Bu ziyarette eklediğiniz son işlemi siler.']
    ]],
    ['Plan ve takip', [
      ['stop KOD FİYAT', 'stop THYAO 250', 'Zarar-kes seviyesi; altına inince alarm çalar (“sil” kaldırır).'],
      ['hedef KOD FİYAT', 'hedef THYAO 400', 'Hedef fiyat; üstüne çıkınca alarm çalar.'],
      ['ağırlık KOD %', 'ağırlık ASELS 20', 'Hedef dağılımdaki payı (0 kaldırır).'],
      ['alarm KOD FİYAT', 'alarm TUPRS 180', 'Fiyat alarmı: hedef fiyatın üstündeyse yükselince, altındaysa düşünce uyarır.'],
      ['izle KOD', 'izle ASELS', 'İzleme listesine ekler ya da çıkarır.']
    ]],
    ['Notlar', [
      ['not KOD METİN', 'not FROTO ihracat büyümesi, 3 yıl', 'Hisseye yatırım notu (boş metin siler).'],
      ['günlük [KOD] METİN', 'günlük faiz kararı sonrası bekle', 'Yatırım günlüğüne tarihli kayıt.']
    ]],
    ['Gezinme', [
      ['KOD veya aç KOD', 'FROTO', 'Hisse sayfasını açar.'],
      ['bilanço KOD', 'bilanço BIMAS', 'Hisse sayfasında bilanço sekmesini açar.'],
      ['kıyas KOD KOD [KOD]', 'kıyas EREGL KRDMD', 'Hisse karşılaştırmasına ekler.'],
      ['performans · plan · gündem · sektör · geçmiş', 'performans', 'Bu sayfanın ilgili sekmesini açar.'],
      ['temettü', 'temettü', 'Temettü takvimini açar.'],
      ['gizle · göster · rapor', 'gizle', 'Tutarları gizler/gösterir; rapor bu sekmeyi yazdırır.']
    ]]
  ];

  function commandsHtml() {
    const cmds = store.cmds;
    return `
      <div class="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div class="lg:col-span-3 min-w-0">
          ${card(`${cardHead('Komut rehberi', 'Komut satırına ya da Ctrl K paletine yazın (palette başına / koyun: /al THYAO 100). Satıra tıklayınca örnek komut kutuya yazılır. Komutlar yalnızca Verity içindeki kayıtları değiştirir; aracı kuruma emir iletilmez.')}
            ${HELP.map(([group, rows]) => `
              <div class="px-4 sm:px-5 pt-3 pb-1 text-[10px] font-mono uppercase tracking-widest text-slate-500 border-t border-oa-border/60">${group}</div>
              <div class="divide-y divide-oa-border/40">
                ${rows.map(([syntax, example, desc]) => `
                  <button type="button" data-cmd="${esc(example)}" onclick="Profile.fill(this.dataset.cmd)" class="w-full text-left px-4 sm:px-5 py-2.5 hover:bg-[#121C30]/40 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                    <code class="font-mono text-xs text-[#7FA6FF] sm:w-64 shrink-0">${esc(syntax)}</code>
                    <span class="text-xs text-slate-400 font-sans flex-1">${desc}</span>
                    <code class="font-mono text-[11px] text-slate-500 shrink-0">${esc(example)}</code>
                  </button>`).join('')}
              </div>`).join('')}`, 'overflow-hidden')}
        </div>
        <div class="lg:col-span-2 space-y-5 min-w-0">
          ${card(`${cardHead('Kayıtlı komutlar', 'Sık kullandığınız komutları yıldızlayın; komut satırının altında kısayol olarak çıkar.')}
            <div class="px-4 sm:px-5 pb-5 space-y-1.5">
              ${store.saved.length ? store.saved.map((c, i) => `
                <div class="flex items-center gap-2 rounded-lg bg-[#090D18] border border-[#162238] px-3 py-2">
                  <code class="flex-1 min-w-0 truncate font-mono text-xs text-slate-200">${esc(c)}</code>
                  <button type="button" onclick="Profile.runSaved(${i})" class="text-[11px] font-bold text-[#7FA6FF] hover:text-white">Çalıştır</button>
                  <button type="button" onclick="Profile.unsave(${i})" class="text-slate-500 hover:text-rose-400 text-xs" title="Kaldır"><i class="fa-solid fa-xmark"></i></button>
                </div>`).join('') : '<p class="text-xs text-slate-500 font-sans">Henüz kayıtlı komut yok.</p>'}
            </div>`)}
          ${card(`${cardHead('Komut geçmişi', `Son ${MAX_CMDS} komut.`, cmds.length ? '<button type="button" onclick="Profile.clearCmds()" class="text-[11px] font-bold text-slate-400 hover:text-rose-400"><i class="fa-solid fa-broom"></i> Temizle</button>' : '')}
            <div class="max-h-[420px] overflow-y-auto">
              ${cmds.length ? cmds.map((c, i) => `
                <div class="flex items-start gap-2 px-4 sm:px-5 py-2.5 border-t border-oa-border/60">
                  <i class="fa-solid ${c.ok ? 'fa-check text-emerald-400' : 'fa-xmark text-rose-400'} text-xs mt-1"></i>
                  <div class="flex-1 min-w-0">
                    <code class="block font-mono text-xs text-slate-200 truncate">${esc(c.text)}</code>
                    <span class="block text-[11px] text-slate-500 font-sans truncate">${esc(c.msg || '')} · ${ago(c.at)}</span>
                  </div>
                  <button type="button" onclick="Profile.fill(Profile.cmdText(${i}))" class="text-slate-500 hover:text-white text-xs" title="Tekrar yaz"><i class="fa-solid fa-rotate-left"></i></button>
                  <button type="button" onclick="Profile.saveCmd(${i})" class="text-xs ${store.saved.includes(c.text) ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400'}" title="Kaydet"><i class="fa-${store.saved.includes(c.text) ? 'solid' : 'regular'} fa-star"></i></button>
                </div>`).join('') : empty('Henüz komut çalıştırmadınız.')}
            </div>`, 'overflow-hidden')}
        </div>
      </div>`;
  }

  /* ---------- settings tab ---------- */
  function settingsHtml() {
    const radios = (name, opts, cur) => Object.entries(opts).map(([k, v]) => `
      <label class="cursor-pointer"><input type="radio" name="${name}" value="${k}" class="peer sr-only" ${cur === k ? 'checked' : ''}>
        <span class="block px-3 py-2 rounded-xl border border-[#1A2540] text-xs text-slate-400 peer-checked:border-[#2F6BFF] peer-checked:bg-[#2F6BFF]/15 peer-checked:text-white">${v}</span></label>`).join('');
    const btn = 'px-3.5 py-2 rounded-xl bg-[#0C1322] border border-[#1A2540] text-xs font-bold text-slate-300 hover:text-white cursor-pointer';
    return `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        ${card(`${cardHead('Yatırımcı profili', 'Vade ve risk seçiminiz portföy sayfasındaki yoğunlaşma eşiklerini belirler.')}
          <form onsubmit="Profile.saveSettings(event)" class="px-4 sm:px-5 pb-5 space-y-4">
            <label class="block"><span class="${LABEL}">Adınız (isteğe bağlı)</span><input id="pfName" maxlength="40" value="${esc(store.name)}" placeholder="Ad Soyad" class="${INPUT} font-sans"></label>
            <div><span class="${LABEL}">Yatırım vadesi</span><div class="grid grid-cols-1 sm:grid-cols-3 gap-2">${radios('pfHorizon', HORIZONS, store.horizon)}</div></div>
            <div><span class="${LABEL}">Risk tercihi</span><div class="grid grid-cols-3 gap-2">${radios('pfRisk', RISKS, store.risk)}</div></div>
            <p class="text-[11px] text-slate-500 font-sans">Eşikler: tek hisse ${pct(LIMITS[store.risk].stock, 0)}, tek sektör ${pct(LIMITS[store.risk].sector, 0)} (${RISKS[store.risk].toLocaleLowerCase('tr-TR')}).</p>
            <label class="flex items-center gap-2 text-xs text-slate-300 font-sans cursor-pointer"><input id="pfHide" type="checkbox" ${store.hide ? 'checked' : ''} class="accent-[#2F6BFF]"> Tutarları gizle (ekranı paylaşırken; yüzdeler görünür kalır)</label>
            <button type="submit" class="px-4 py-2.5 rounded-xl bg-[#2F6BFF] hover:bg-[#4A7FFF] text-white text-sm font-semibold">Kaydet</button>
          </form>`)}
        ${card(`${cardHead('Portföyler', 'Örneğin “Uzun vade”, “Temettü”, “Deneme” gibi ayrı portföyler tutabilirsiniz. Silinen portföyün işlemleri de silinir.')}
          <div class="px-4 sm:px-5 pb-5 space-y-2">
            ${store.portfolios.map(p => `
              <div class="flex items-center gap-2">
                <input value="${esc(p.name)}" maxlength="40" onchange="Profile.renamePortfolio('${p.id}', this.value)" class="${INPUT} font-sans flex-1">
                <span class="text-[11px] font-mono text-slate-500 w-16 text-right">${store.txs.filter(t => t.pf === p.id).length} işlem</span>
                ${store.portfolios.length > 1 ? `<button type="button" onclick="Profile.deletePortfolio('${p.id}')" class="w-9 h-9 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 hover:text-white text-xs" title="Portföyü sil"><i class="fa-solid fa-trash-can"></i></button>` : ''}
              </div>`).join('')}
            <button type="button" onclick="Profile.newPortfolio()" class="${btn}"><i class="fa-solid fa-plus"></i> Yeni portföy</button>
          </div>`)}
        ${card(`${cardHead('İşlemleri içe aktar (CSV)', `Aracı kurum ekstrenizi ya da bir tabloyu şuraya ekler: <b class="text-slate-300">${esc(pfName(writePf()))}</b>. Sütunlar: <code class="font-mono text-[#7FA6FF]">tarih;tür;kod;adet;fiyat;komisyon</code> (tür: alış/satış; tarih 2026-01-05 ya da 05.01.2026). Bu sayfanın CSV dışa aktarımı da aynı biçimdedir.`)}
          <div class="px-4 sm:px-5 pb-5 space-y-2">
            <label class="${btn} inline-flex items-center gap-2"><i class="fa-solid fa-file-import"></i> CSV dosyası seç<input type="file" accept=".csv,text/csv,text/plain" class="sr-only" onchange="Profile.importCsv(this)"></label>
            <p id="pfCsvMsg" class="text-xs text-slate-400 font-sans" role="status"></p>
          </div>`)}
        ${card(`${cardHead('Verileriniz', 'Profil, işlemler, notlar, günlük, plan, inceleme ve komut geçmişi yalnızca bu tarayıcıda saklanır. Başka cihaza taşımak ya da yedeklemek için dışa aktarın.')}
          <div class="px-4 sm:px-5 pb-5 space-y-3">
            <div class="grid grid-cols-3 gap-2 text-xs font-mono">
              <div class="rounded-xl bg-[#090D18] border border-[#162238] p-3"><div class="text-slate-500">İşlem</div><div class="text-white text-lg font-bold">${store.txs.length}</div></div>
              <div class="rounded-xl bg-[#090D18] border border-[#162238] p-3"><div class="text-slate-500">Günlük</div><div class="text-white text-lg font-bold">${store.journal.length}</div></div>
              <div class="rounded-xl bg-[#090D18] border border-[#162238] p-3"><div class="text-slate-500">İncelenen</div><div class="text-white text-lg font-bold">${store.views.length}</div></div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" onclick="Profile.exportJson()" class="${btn}"><i class="fa-solid fa-download"></i> Dışa aktar (JSON)</button>
              <label class="${btn}"><i class="fa-solid fa-upload"></i> Yedeği yükle<input type="file" accept="application/json,.json" class="sr-only" onchange="Profile.importJson(this)"></label>
              <button type="button" onclick="Profile.exportCsv()" class="${btn}"><i class="fa-solid fa-file-csv"></i> İşlemler (CSV)</button>
              <button type="button" onclick="Profile.reset()" class="px-3.5 py-2 rounded-xl bg-rose-950/40 border border-rose-800/50 text-xs font-bold text-rose-300 hover:text-white"><i class="fa-solid fa-trash-can"></i> Profili sıfırla</button>
            </div>
            <p id="pfDataMsg" class="text-xs text-slate-400 font-sans" role="status"></p>
          </div>`)}
      </div>`;
  }

  /* ---------- rendering ---------- */
  let builtTab = null;
  const REBUILD_ALWAYS = new Set(['activity', 'commands']);
  async function render() {
    const root = document.getElementById('pfBody');
    if (!root) return;
    paintHeader();
    paintSwitcher();
    paintTabs();
    paintChips();
    if (builtTab !== ui.tab || REBUILD_ALWAYS.has(ui.tab)) {
      builtTab = ui.tab;
      Object.keys(charts).forEach(id => { charts[id].destroy(); delete charts[id]; });
      root.innerHTML = {
        portfolio: portfolioSkeleton, performance: performanceSkeleton, sectors: sectorsSkeleton, plan: planSkeleton,
        news: newsSkeleton, activity: activityHtml, commands: commandsHtml, settings: settingsHtml
      }[ui.tab]();
      codeOptions();
    }
    if (ui.tab === 'portfolio' && ui.prefill) {
      const { code, type } = ui.prefill;
      ui.prefill = null;
      const c = document.getElementById('pfCode');
      if (c) c.value = code;
      const radio = document.querySelector(`input[name="pfType"][value="${type}"]`);
      if (radio) radio.checked = true;
      const q = document.getElementById('pfQty');
      if (q) { q.focus(); q.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }
    if (ui.tab === 'activity' && store.views.length && window.LiveData) {
      const need = store.views.slice(0, 15).map(v => v.code).filter(c => { const f = finOf(c); return !f || !f.liveTime; });
      if (need.length) LiveData.ensure(need).then(() => { if (ui.tab === 'activity' && appState.activeView === 'profile') render(); });
    }
    await update();
  }

  /** Rebuilds the current tab from scratch (after a change of portfolio, window or view). */
  function rebuild() { builtTab = null; return render(); }

  async function update() {
    const token = ++ui.token;
    let m;
    try { m = await model(); } catch (e) { console.warn('[Profile] model failed:', e.message); return; }
    if (token !== ui.token) return;
    paintKpis(m);
    if (m.val.rows.length) paintToday(m, token);
    if (ui.tab === 'portfolio') {
      paintHoldings(m); paintMix(m); paintRisk(m); paintDivs(m); paintTxs(); paintNotes(m);
      if (!m.val.rows.length) { const t = document.getElementById('pfToday'); if (t) t.innerHTML = ''; }
    } else if (ui.tab === 'performance') {
      const status = document.getElementById('pfPerfStatus');
      try {
        const p = await performance(m);
        if (token !== ui.token || ui.tab !== 'performance') return;
        paintPerformance(p, m);
      } catch (e) {
        console.warn('[Profile] performance failed:', e.message);
        if (status) status.textContent = 'Fiyat geçmişi şu an alınamadı. Birazdan tekrar deneyin.';
      }
    } else if (ui.tab === 'sectors') {
      const status = document.getElementById('pfLtStatus');
      try {
        const res = await longTerm(m);
        if (token !== ui.token || ui.tab !== 'sectors') return;
        paintLongTerm(res);
        paintLongTermTable(res);
        paintSectorCards(res, m);
      } catch (e) {
        if (status) status.textContent = 'Fiyat geçmişi şu an alınamadı. Birazdan tekrar deneyin.';
      }
    } else if (ui.tab === 'plan') {
      paintRebalance(m); paintCash(m); paintLevels(m); paintGoal(m);
    } else if (ui.tab === 'news') {
      paintTimeline(m);
      paintKap(m, token);
    }
  }

  /* ---------- side menu ---------- */
  function paintMenu() {
    const name = document.getElementById('menuProfileName');
    const sub = document.getElementById('menuProfileSub');
    const av = document.getElementById('menuProfileAvatar');
    const n = Portfolio.positions(store.txs).filter(p => p.qty > 0).length;
    if (name) name.textContent = store.name.trim() || 'Profilim';
    const email = window.Account && Account.email ? Account.email() : null;
    if (sub) sub.textContent = email || (n ? `${n} pozisyon · ${store.portfolios.length > 1 ? `${store.portfolios.length} portföy` : 'portföy ve geçmiş'}` : 'Portföy, geçmiş ve komutlar');
    if (av) av.innerHTML = initials();
  }

  /* ---------- trades ---------- */
  function addTx(tx) {
    store.seq += 1;
    const full = { id: `tx_${Date.now().toString(36)}_${store.seq}`, seq: store.seq, fee: 0, pf: writePf(), ...tx };
    store.txs.push(full);
    save();
    invalidate();
    ui.lastTx = full.id;
    return full;
  }

  /** Validates and records a trade in the selected portfolio; returns { ok, msg }. */
  async function trade({ type, code, qty, price, date, fee }) {
    if (!known(code)) return { ok: false, msg: `${code} BIST listesinde bulunamadı.` };
    if (!(qty > 0)) return { ok: false, msg: 'Adet pozitif olmalı.' };
    const day = date || today();
    if (day > today()) return { ok: false, msg: 'İleri tarihli işlem girilemez.' };
    const heldIn = id => Portfolio.heldOn(store.txs.filter(t => t.pf === id), code, day);
    let pf = writePf();
    // While "Tümü" is shown a sale goes to the portfolio that holds the shares
    if (type === 'sell' && isAll()) pf = (store.portfolios.find(p => heldIn(p.id) >= qty - 1e-9) || { id: pf }).id;
    if (type === 'sell') {
      const held = heldIn(pf);
      if (qty > held + 1e-9) return { ok: false, msg: held ? `${fullDate(day)} itibarıyla “${pfName(pf)}” içinde ${fq.format(held)} adet ${code} var.` : `“${pfName(pf)}” içinde ${code} yok.` };
    }
    let px = price, note = '';
    if (!(px > 0)) {
      const q = await priceOf(code);
      if (!q) return { ok: false, msg: `${code} için fiyat alınamadı; fiyatı da yazın.` };
      px = q.price;
      note = q.src === 'live' ? ' (gecikmeli güncel fiyat)' : ' (son kapanış)';
    }
    addTx({ type, code, qty, price: px, date: day, fee: fee > 0 ? fee : 0, pf });
    return { ok: true, msg: `${type === 'buy' ? 'Alış' : 'Satış'} kaydedildi (${pfName(pf)}): ${fq.format(qty)} ${code} × ${tl(px)}${note}.`, undo: true };
  }

  async function submitTrade(e) {
    e.preventDefault();
    const msg = document.getElementById('pfTradeMsg');
    const say = (text, cls) => { if (msg) { msg.className = `text-xs font-sans ${cls}`; msg.textContent = text; } };
    const val = id => (document.getElementById(id)?.value || '').trim();
    const type = document.querySelector('input[name="pfType"]:checked')?.value || 'buy';
    const code = val('pfCode').toUpperCase().replace(/İ/g, 'I');
    const priceRaw = val('pfPrice'), feeRaw = val('pfFee');
    const qty = parseNum(val('pfQty'));
    const price = priceRaw ? parseNum(priceRaw) : null;
    const fee = feeRaw ? parseNum(feeRaw) : 0;
    if (priceRaw && !(price > 0)) { say('Fiyat anlaşılmadı.', 'text-rose-400'); return; }
    if (feeRaw && !(fee >= 0)) { say('Komisyon anlaşılmadı.', 'text-rose-400'); return; }
    say('Kaydediliyor…', 'text-slate-400');
    const r = await trade({ type, code, qty, price, date: val('pfDate') || today(), fee });
    say(r.msg, r.ok ? 'text-emerald-400' : 'text-rose-400');
    if (r.ok) {
      ['pfQty', 'pfPrice', 'pfFee'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      paintSwitcher();
      update();
    }
  }

  function removeTx(id) {
    const t = store.txs.find(x => x.id === id);
    if (!t) return;
    if (!confirm(`${t.code} ${t.type === 'buy' ? 'alış' : 'satış'} kaydı (${fq.format(t.qty)} adet, ${fullDate(t.date)}) silinsin mi?`)) return;
    store.txs = store.txs.filter(x => x.id !== id);
    forget(id);
    save();
    invalidate();
    paintSwitcher();
    update();
  }

  /* ---------- levels (stop / target), weights, cash, journal ---------- */
  /** Writes a stop or target level and keeps exactly one matching price alert for it. */
  function setLevelValue(code, kind, price) {
    const l = { ...(store.levels[code] || {}) };
    const alertKey = kind === 'stop' ? 'stopAlert' : 'targetAlert';
    if (l[alertKey] && typeof deleteAlert === 'function') deleteAlert(l[alertKey]);
    delete l[alertKey];
    if (price > 0) {
      l[kind] = price;
      if (typeof saveAlert === 'function') {
        const id = `alt_${Date.now()}_${kind}`;
        saveAlert({
          id, ticker: code, type: kind === 'stop' ? 'price_below' : 'price_above', targetValue: price,
          note: kind === 'stop' ? 'Profil: zarar-kes' : 'Profil: hedef fiyat',
          createdAt: `Bugün ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`, triggered: false, triggeredAt: null
        });
        l[alertKey] = id;
      }
    } else {
      delete l[kind];
    }
    if (l.stop || l.target) store.levels[code] = l; else delete store.levels[code];
    save();
  }

  function addJournalEntry(text, code) {
    store.journal.unshift({ id: `j_${Date.now().toString(36)}`, at: Date.now(), code: code && known(code) ? code : null, text: String(text).slice(0, 800) });
    store.journal = store.journal.slice(0, 500);
    save();
  }

  /* ---------- commands ---------- */
  function logCmd(text, ok, msg) {
    store.cmds.unshift({ text, ok, msg, at: Date.now() });
    store.cmds = store.cmds.slice(0, MAX_CMDS);
    save();
  }

  function showResult(r) {
    const el = document.getElementById('pfCmdResult');
    if (!el) return;
    el.className = `mt-2 text-xs font-sans flex flex-wrap items-center gap-2 ${r.ok ? 'text-emerald-400' : 'text-rose-400'}`;
    el.innerHTML = `<i class="fa-solid ${r.ok ? 'fa-check' : 'fa-circle-exclamation'}"></i><span>${esc(r.msg)}</span>${r.undo ? '<button type="button" onclick="Profile.undo()" class="text-[11px] font-bold text-slate-300 hover:text-white underline">Geri al</button>' : ''}`;
  }

  function stockPage(code, tab) {
    if (typeof switchView === 'function') switchView('stock-detail', code);
    if (tab && typeof switchStockSubTab === 'function') setTimeout(() => switchStockSubTab(tab), 300);
  }
  function goTab(tab) {
    ui.tab = tab;
    if (appState.activeView !== 'profile' && typeof switchView === 'function') switchView('profile');
  }

  const NAVIGATES = new Set(['open', 'balance', 'compare', 'dividends']);
  /** Runs one command line; returns { ok, msg }. Used by the command bar and the Ctrl K palette. */
  async function run(text) {
    const line = String(text || '').trim();
    const c = Portfolio.parseCommand(line);
    let r;
    const needsCode = c.ok && c.code && c.action !== 'journal';
    if (!c.ok) r = { ok: false, msg: c.error };
    else if (needsCode && !known(c.code)) r = { ok: false, msg: `${c.code} BIST listesinde bulunamadı.` };
    else if (c.codes && c.codes.some(x => !known(x))) r = { ok: false, msg: `${c.codes.filter(x => !known(x)).join(', ')} bulunamadı.` };
    else {
      switch (c.action) {
        case 'buy':
        case 'sell':
          r = await trade({ type: c.action, code: c.code, qty: c.qty, price: c.price, date: c.date, fee: 0 });
          if (r.ok) paintSwitcher();
          break;
        case 'watch': {
          const had = typeof getWatchlist === 'function' && getWatchlist().includes(c.code);
          if (typeof toggleStockWatchlist === 'function') toggleStockWatchlist(c.code);
          r = { ok: true, msg: had ? `${c.code} izleme listesinden çıkarıldı.` : `${c.code} izleme listesine eklendi.` };
          break;
        }
        case 'alarm': {
          const q = await priceOf(c.code);
          const type = q && q.price > c.target ? 'price_below' : 'price_above';
          if (typeof saveAlert === 'function') {
            saveAlert({
              id: `alt_${Date.now()}`, ticker: c.code, type, targetValue: c.target, note: 'Profil komutu',
              createdAt: `Bugün ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`,
              triggered: false, triggeredAt: null
            });
          }
          r = { ok: true, msg: `${c.code} alarmı kuruldu: fiyat ${tl(c.target)} ${type === 'price_below' ? 'altına inince' : 'üstüne çıkınca'} uyarılırsınız${q ? ` (şu an ${tl(q.price)})` : ''}.` };
          break;
        }
        case 'stop':
        case 'target': {
          setLevelValue(c.code, c.action, c.price);
          const what = c.action === 'stop' ? 'zarar-kes' : 'hedef fiyat';
          r = { ok: true, msg: c.price ? `${c.code} ${what} ${tl(c.price)}; fiyat alarmı da kuruldu.` : `${c.code} ${what} kaldırıldı.` };
          break;
        }
        case 'weight': {
          if (isAll()) { r = { ok: false, msg: 'Hedef dağılım portföy başına tutulur: önce bir portföy seçin (ör. portföy Ana portföy).' }; break; }
          const t = targetsOf();
          if (c.weight > 0) t[c.code] = c.weight; else delete t[c.code];
          save();
          r = { ok: true, msg: c.weight > 0 ? `${c.code} hedef ağırlığı ${pct(c.weight, 1)} (${pfName(store.active)}).` : `${c.code} hedef ağırlığı kaldırıldı.` };
          break;
        }
        case 'cash': {
          if (isAll()) { r = { ok: false, msg: 'Nakit portföy başına tutulur: önce bir portföy seçin.' }; break; }
          const now = store.cash[store.active] || 0;
          const next = Math.max(0, c.delta ? now + c.amount : c.amount);
          store.cash[store.active] = next;
          save();
          r = { ok: true, msg: `${pfName(store.active)} nakdi: ${amt(next)}.` };
          break;
        }
        case 'journal':
          addJournalEntry(c.text, c.code);
          r = { ok: true, msg: `Günlüğe yazıldı${c.code && known(c.code) ? ` (${c.code})` : ''}.` };
          break;
        case 'note':
          if (c.text) store.notes[c.code] = c.text.slice(0, 600); else delete store.notes[c.code];
          save();
          r = { ok: true, msg: c.text ? `${c.code} notu kaydedildi.` : `${c.code} notu silindi.` };
          break;
        case 'privacy':
          store.hide = c.hide == null ? !store.hide : c.hide;
          save();
          r = { ok: true, msg: store.hide ? 'Tutarlar gizlendi.' : 'Tutarlar gösteriliyor.' };
          break;
        case 'undo': {
          const t = ui.lastTx && store.txs.find(x => x.id === ui.lastTx);
          if (!t) { r = { ok: false, msg: 'Geri alınacak bir işlem yok (yalnızca bu ziyarette eklenen son işlem geri alınır).' }; break; }
          store.txs = store.txs.filter(x => x.id !== t.id);
          forget(t.id);
          ui.lastTx = null;
          save();
          invalidate();
          paintSwitcher();
          r = { ok: true, msg: `Geri alındı: ${t.type === 'buy' ? 'alış' : 'satış'} ${fq.format(t.qty)} ${t.code}.` };
          break;
        }
        case 'report':
          goTab(ui.tab);
          r = { ok: true, msg: 'Yazdırma penceresi açıldı.' };
          setTimeout(() => window.print(), 400);
          break;
        case 'tab':
          goTab(c.tab);
          r = { ok: true, msg: `${(TABS.find(t => t[0] === c.tab) || [, , c.tab])[2]} sekmesi açıldı.` };
          break;
        case 'open':
          r = { ok: true, msg: `${c.code} açıldı.` };
          stockPage(c.code);
          break;
        case 'balance':
          r = { ok: true, msg: `${c.code} bilançosu açıldı.` };
          stockPage(c.code, 'financials');
          break;
        case 'compare':
          if (window.Compare) c.codes.forEach(x => Compare.add(x));
          if (typeof switchView === 'function') switchView('compare');
          r = { ok: true, msg: `${c.codes.join(', ')} karşılaştırmaya eklendi.` };
          break;
        case 'dividends':
          if (typeof switchView === 'function') switchView('dividends');
          r = { ok: true, msg: 'Temettü takvimi açıldı.' };
          break;
        case 'portfolio': {
          if (c.name) {
            const lower = s => s.toLocaleLowerCase('tr-TR');
            if (['tümü', 'tumu', 'hepsi'].includes(lower(c.name))) { store.active = store.portfolios.length > 1 ? 'all' : store.portfolios[0].id; }
            else {
              let p = store.portfolios.find(x => lower(x.name) === lower(c.name));
              if (!p) { p = { id: `pf_${Date.now().toString(36)}`, name: c.name.slice(0, 40) }; store.portfolios.push(p); }
              store.active = p.id;
            }
            save();
            invalidate();
            builtTab = null;
          }
          goTab('portfolio');
          r = { ok: true, msg: c.name ? `${isAll() ? 'Tüm portföyler' : `“${pfName(store.active)}”`} açıldı.` : 'Portföy sekmesi açıldı.' };
          break;
        }
        default:
          goTab('commands');
          r = { ok: true, msg: 'Komut rehberi açıldı.' };
      }
    }
    logCmd(line, r.ok, r.msg);
    showResult(r);
    if (appState.activeView === 'profile') render();
    // From the Ctrl K palette on another page: say what happened, unless the page itself changed
    else if (!(r.ok && NAVIGATES.has(c.action)) && typeof showToast === 'function') showToast(r.msg);
    return r;
  }

  async function submitCommand(e) {
    e.preventDefault();
    const input = document.getElementById('pfCmdInput');
    if (!input || !input.value.trim()) return;
    const text = input.value;
    input.value = '';
    ui.cmdIndex = -1;
    await run(text);
    input.focus();
  }

  /** Up/down in the command bar walk the command history, like a terminal. */
  function cmdKey(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const list = store.cmds;
    if (!list.length) return;
    e.preventDefault();
    ui.cmdIndex = Math.max(-1, Math.min(list.length - 1, ui.cmdIndex + (e.key === 'ArrowUp' ? 1 : -1)));
    e.target.value = ui.cmdIndex < 0 ? '' : list[ui.cmdIndex].text;
  }

  function paintChips() {
    const el = document.getElementById('pfCmdChips');
    if (!el) return;
    const chips = store.saved.length ? store.saved : ['al THYAO 100', 'stop THYAO 250', 'nakit +5000', 'günlük ', 'performans', 'yardım'];
    el.innerHTML = chips.slice(0, 8).map(c => `<button type="button" data-cmd="${esc(c)}" onclick="Profile.fill(this.dataset.cmd)" class="px-2.5 py-1 rounded-lg bg-[#090D18] border border-[#162238] text-[11px] font-mono text-slate-400 hover:text-white">${esc(c.trim())}</button>`).join('');
  }

  function fill(text) {
    const input = document.getElementById('pfCmdInput');
    if (!input) return;
    input.value = text;
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- data export / import ---------- */
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportJson() {
    download(`verity-profil-${today()}.json`, JSON.stringify(store, null, 1), 'application/json');
  }
  function exportCsv() {
    const rows = [['tarih', 'tur', 'kod', 'adet', 'fiyat', 'komisyon', 'tutar', 'portfoy']]
      .concat([...pfTxs()].sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.date, t.type === 'buy' ? 'alis' : 'satis', t.code, t.qty, String(t.price).replace('.', ','), String(t.fee || 0).replace('.', ','), (t.qty * t.price).toFixed(2).replace('.', ','), pfName(t.pf).replace(/;/g, ',')]));
    download(`verity-islemler-${today()}.csv`, `﻿${rows.map(r => r.join(';')).join('\r\n')}`, 'text/csv;charset=utf-8');
  }
  function readFile(input, then) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { try { then(String(reader.result)); } finally { input.value = ''; } };
    reader.readAsText(file);
  }
  /** Accepts a file written by exportJson; anything else is refused without touching the profile. */
  function importJson(input) {
    const msg = document.getElementById('pfDataMsg');
    readFile(input, text => {
      try {
        const j = JSON.parse(text);
        const tx = t => t && (t.type === 'buy' || t.type === 'sell') && /^[A-Z0-9]{3,6}$/.test(t.code) && t.qty > 0 && t.price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date);
        if (!j || (j.v !== 1 && j.v !== 2) || !Array.isArray(j.txs) || !j.txs.every(tx)) throw new Error('shape');
        if (!confirm(`${j.txs.length} işlem içeren yedek yüklensin mi? Bu tarayıcıdaki mevcut profil yerine geçer.`)) return;
        store = migrate(j);
        save();
        invalidate();
        if (msg) msg.textContent = 'Yedek yüklendi.';
        rebuild();
      } catch (e) {
        if (msg) msg.textContent = 'Dosya bir Verity profil yedeği değil.';
      }
    });
  }
  function importCsv(input) {
    const msg = document.getElementById('pfCsvMsg');
    readFile(input, text => {
      const { txs, errors } = Portfolio.parseCsv(text);
      const unknown = txs.filter(t => !known(t.code)).map(t => t.code);
      const ok = txs.filter(t => known(t.code));
      if (!ok.length) { if (msg) msg.textContent = `Okunabilen işlem bulunamadı${errors.length ? ` (hatalı satırlar: ${errors.slice(0, 10).join(', ')})` : ''}.`; return; }
      const pf = writePf();
      if (!confirm(`${ok.length} işlem “${pfName(pf)}” içine eklensin mi?${errors.length ? `\nOkunamayan satırlar: ${errors.slice(0, 10).join(', ')}` : ''}${unknown.length ? `\nBulunamayan kodlar: ${[...new Set(unknown)].join(', ')}` : ''}`)) return;
      ok.forEach(t => { store.seq += 1; store.txs.push({ ...t, id: `tx_${Date.now().toString(36)}_${store.seq}`, seq: store.seq, pf }); });
      save();
      invalidate();
      if (msg) msg.textContent = `${ok.length} işlem eklendi${errors.length ? `; ${errors.length} satır okunamadı` : ''}${unknown.length ? `; bulunamayan: ${[...new Set(unknown)].join(', ')}` : ''}.`;
      paintSwitcher();
      update();
    });
  }
  function reset() {
    if (!confirm('Profil, tüm portföyler, işlemler, notlar, günlük ve geçmiş bu tarayıcıdan silinsin mi? Önce dışa aktarmanız önerilir.')) return;
    store = blank();
    save();
    invalidate();
    rebuild();
  }

  /* ---------- public actions ---------- */
  function setTab(tab) {
    ui.tab = TABS.some(t => t[0] === tab) ? tab : 'portfolio';
    if (appState.activeView !== 'profile' && typeof switchView === 'function') switchView('profile');
    else render();
  }

  return {
    render, setTab, run, submitCommand, cmdKey, fill, submitTrade, removeTx, exportJson, exportCsv, importJson, importCsv, reset,
    setWindow(y) { ui.window = y; rebuild(); },
    setCcy(c) { ui.ccy = c; rebuild(); },
    setPerfView(v) { ui.perfView = v; rebuild(); },
    open(code) { stockPage(code); },
    quickAdd(code) {
      if (isAll()) store.active = writePf();
      ui.tab = 'portfolio'; ui.prefill = { code, type: 'buy' }; builtTab = null;
      if (appState.activeView === 'profile') render(); else switchView('profile');
    },
    prefillSell(code) { ui.prefill = { code, type: 'sell' }; render(); },
    setNote(code, text) { const t = String(text || '').trim().slice(0, 600); if (t) store.notes[code] = t; else delete store.notes[code]; save(); },
    undo() {
      if (!ui.lastTx) return;
      store.txs = store.txs.filter(t => t.id !== ui.lastTx);
      forget(ui.lastTx);
      ui.lastTx = null;
      save();
      invalidate();
      showResult({ ok: true, msg: 'Son işlem geri alındı.' });
      if (appState.activeView === 'profile') render();
    },
    cmdText(i) { return store.cmds[i] ? store.cmds[i].text : ''; },
    saveCmd(i) {
      const t = store.cmds[i] && store.cmds[i].text;
      if (!t) return;
      store.saved = store.saved.includes(t) ? store.saved.filter(x => x !== t) : [t, ...store.saved].slice(0, 12);
      save();
      render();
    },
    unsave(i) { store.saved.splice(i, 1); save(); render(); },
    runSaved(i) { if (store.saved[i]) run(store.saved[i]); },
    clearCmds() { store.cmds = []; save(); render(); },
    clearViews() { store.views = []; save(); render(); },
    saveSettings(e) {
      e.preventDefault();
      store.name = (document.getElementById('pfName')?.value || '').trim().slice(0, 40);
      store.horizon = document.querySelector('input[name="pfHorizon"]:checked')?.value || store.horizon;
      store.risk = document.querySelector('input[name="pfRisk"]:checked')?.value || store.risk;
      store.hide = !!document.getElementById('pfHide')?.checked;
      save();
      if (typeof showToast === 'function') showToast('Profil kaydedildi');
      rebuild();
    },
    togglePrivacy() { store.hide = !store.hide; save(); rebuild(); },
    print() { window.print(); },
    /* portfolios */
    selectPortfolio(id) { store.active = id === 'all' || store.portfolios.some(p => p.id === id) ? id : store.portfolios[0].id; ui.rbCash = null; save(); invalidate(); rebuild(); },
    newPortfolio() {
      const name = (prompt('Yeni portföyün adı (ör. Temettü, Uzun vade, Deneme):') || '').trim();
      if (!name) return;
      const p = { id: `pf_${Date.now().toString(36)}`, name: name.slice(0, 40) };
      store.portfolios.push(p);
      store.active = p.id;
      save();
      invalidate();
      rebuild();
    },
    renamePortfolio(id, name) {
      const p = store.portfolios.find(x => x.id === id);
      const n = String(name || '').trim().slice(0, 40);
      if (!p || !n) return;
      p.name = n;
      save();
      paintSwitcher();
    },
    deletePortfolio(id) {
      if (store.portfolios.length < 2) return;
      const n = store.txs.filter(t => t.pf === id).length;
      if (!confirm(`“${pfName(id)}” portföyü${n ? ` ve ${n} işlemi` : ''} silinsin mi?`)) return;
      store.portfolios = store.portfolios.filter(p => p.id !== id);
      forget(id, ...store.txs.filter(t => t.pf === id).map(t => t.id));
      store.txs = store.txs.filter(t => t.pf !== id);
      delete store.targets[id];
      delete store.cash[id];
      if (store.active === id || (store.active === 'all' && store.portfolios.length < 2)) store.active = store.portfolios[0].id;
      save();
      invalidate();
      rebuild();
    },
    /* plan */
    setWeight(code, value) {
      const w = parseNum(String(value).replace(/%/g, ''));
      const t = targetsOf();
      if (w > 0 && w <= 100) t[code] = w; else delete t[code];
      save();
      keepFocus(() => lastPlanModel && paintRebalance(lastPlanModel));
    },
    async addTarget(value) {
      const code = String(value || '').trim().toUpperCase().replace(/İ/g, 'I');
      if (!code) return;
      if (!known(code)) { if (typeof showToast === 'function') showToast(`${code} bulunamadı`); return; }
      const t = targetsOf();
      if (!t[code]) t[code] = 5;
      save();
      if (window.LiveData) await LiveData.ensure([code]);
      if (lastPlanModel) paintRebalance(lastPlanModel);
      const el = document.querySelector(`[data-fk="w-${code}"]`);
      if (el) { el.focus(); el.select(); }
    },
    targetsFrom(kind) {
      if (!lastPlanModel || isAll()) return;
      const rows = lastPlanModel.val.rows.filter(r => r.value > 0);
      const t = {};
      if (kind === 'equal') rows.forEach(r => { t[r.code] = Math.round(10000 / rows.length) / 100; });
      if (kind === 'current') rows.forEach(r => { t[r.code] = Math.round(r.weight * 100) / 100; });
      store.targets[store.active] = t;
      save();
      paintRebalance(lastPlanModel);
    },
    setRbMode(mode) { ui.rbMode = mode; if (lastPlanModel) paintRebalance(lastPlanModel); },
    setRbCash(value) { const v = parseNum(value); ui.rbCash = Number.isFinite(v) && v >= 0 ? v : null; if (lastPlanModel) paintRebalance(lastPlanModel); },
    async applyRebalance() {
      if (!lastPlanModel || isAll()) return;
      const rb = rebalanceRows(lastPlanModel).rows.filter(r => r.shares && r.price);
      if (!rb.length) return;
      const list = rb.map(r => `${r.shares > 0 ? 'AL' : 'SAT'} ${Math.abs(r.shares)} ${r.code} × ${tl(r.price)}`).join('\n');
      if (!confirm(`Bu işlemler bugünün tarihiyle ve gösterilen fiyatlarla “${pfName(store.active)}” içine kaydedilsin mi? Aracı kuruma emir iletilmez.\n\n${list}`)) return;
      rb.filter(r => r.shares < 0).concat(rb.filter(r => r.shares > 0)).forEach(r => addTx({ type: r.shares > 0 ? 'buy' : 'sell', code: r.code, qty: Math.abs(r.shares), price: r.price, date: today() }));
      ui.rbCash = null;
      if (typeof showToast === 'function') showToast(`${rb.length} işlem kaydedildi`);
      paintSwitcher();
      update();
    },
    setCash(value) {
      if (isAll()) return;
      const v = parseNum(value);
      store.cash[store.active] = Number.isFinite(v) && v > 0 ? v : 0;
      save();
      update();
    },
    setLevel(code, kind, value) {
      const v = parseNum(value);
      setLevelValue(code, kind, Number.isFinite(v) && v > 0 ? v : null);
      keepFocus(update);
    },
    goalInput() {
      const g = goalValues();
      store.goal = { ...store.goal, ...g };
      save();
      if (lastPlanModel) paintGoal(lastPlanModel);
    },
    /* journal */
    addJournal(e) {
      e.preventDefault();
      const text = (document.getElementById('pfJournalText')?.value || '').trim();
      const code = (document.getElementById('pfJournalCode')?.value || '').trim().toUpperCase().replace(/İ/g, 'I');
      if (!text) return;
      addJournalEntry(text, code);
      document.getElementById('pfJournalText').value = '';
      document.getElementById('pfJournalCode').value = '';
      update();
    },
    removeJournal(id) {
      if (!confirm('Bu günlük kaydı silinsin mi?')) return;
      store.journal = store.journal.filter(j => j.id !== id);
      forget(id);
      save();
      update();
    },
    /** Called when a stock page opens: newest first, one row per stock with a view count. */
    recordView(code) {
      if (!code) return;
      const prev = store.views.find(v => v.code === code);
      store.views = [{ code, at: Date.now(), n: (prev ? prev.n : 0) + 1 }, ...store.views.filter(v => v.code !== code)].slice(0, MAX_VIEWS);
      save();
    },
    /* account sync (account.js) */
    snapshot() { return JSON.parse(JSON.stringify(store)); },
    /** Takes data from the account: replaces the store without counting it as a local change. */
    replace(data) {
      store = migrate(data && (data.v === 1 || data.v === 2) ? data : blank());
      save(true);
      invalidate();
      if (appState.activeView === 'profile') rebuild();
    },
    /** Holdings and weights for the chat assistant's page context (codes and % only). */
    chatContext() {
      const rows = Portfolio.positions(pfTxs()).filter(p => p.qty > 0);
      if (!rows.length) return null;
      const cost = rows.reduce((s, p) => s + p.cost, 0);
      return rows.sort((a, b) => b.cost - a.cost).slice(0, 15).map(p => ({ c: p.code, w: cost > 0 ? Math.round(p.cost / cost * 1000) / 10 : null }));
    },
    paintMenu
  };
})();

window.Profile = Profile;
document.addEventListener('DOMContentLoaded', () => Profile.paintMenu());
