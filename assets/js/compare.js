/**
 * Hisse karşılaştırma: en fazla 3 hisseyi yan yana koyar.
 *
 * Fiyatlar /api/quote'tan, bilanço verisi assets/data/fundamentals.json'dan gelir; skor ve model
 * değer VerityScore ile hesaplanır, yani hisse sayfasındakiyle aynı rakamlardır.
 * Seçim tarayıcıda (localStorage) saklanır.
 */
const Compare = (() => {
  const MAX = 3;
  const STORE_KEY = 'verity.compare';
  const QUOTE_TTL_MS = 60 * 1000;

  const nf = (d) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const f2 = nf(2);
  const f1 = nf(1);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let selected = load();
  let fundamentals = null;
  const quotes = new Map(); // code -> { at, q }
  let renderToken = 0;

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      return Array.isArray(v) ? v.filter((c) => typeof c === 'string').slice(0, MAX) : [];
    } catch { return []; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(selected)); } catch { /* storage unavailable */ }
  }

  const entryFor = (code) => (typeof getFullBistStockList === 'function' ? getFullBistStockList().find((s) => s.code === code) : null);
  const trading = (code) => (typeof tradingCode === 'function' ? tradingCode(code) : code);

  async function loadFundamentals() {
    if (!fundamentals) {
      fundamentals = fetch('/assets/data/fundamentals.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (j ? j.data : {}))
        .catch(() => ({}));
    }
    return fundamentals;
  }

  async function loadQuotes(codes) {
    const stale = codes.filter((c) => !quotes.has(c) || Date.now() - quotes.get(c).at > QUOTE_TTL_MS);
    if (stale.length) {
      try {
        const res = await fetch(`/api/quote?symbols=${encodeURIComponent(stale.map(trading).join(','))}`);
        const got = res.ok ? (await res.json()).quotes || {} : {};
        stale.forEach((c) => { if (got[trading(c)]) quotes.set(c, { at: Date.now(), q: got[trading(c)] }); });
      } catch { /* shown as missing price */ }
    }
    return Object.fromEntries(codes.map((c) => [c, quotes.get(c)?.q || null]));
  }

  /** Everything the table needs for one stock; null fields render as a dash. */
  function metricsFor(code, row, q) {
    const entry = entryFor(code);
    const m = { code, name: entry ? entry.name : code, sector: entry ? entry.raw.sec : '', price: q ? q.price : null };
    if (q && q.prevClose) m.change = (q.price - q.prevClose) / q.prevClose * 100;
    if (q && q.yearLow != null && q.yearHigh > q.yearLow) m.yearPos = (q.price - q.yearLow) / (q.yearHigh - q.yearLow) * 100;
    if (!row) return m;

    const [period, shares, equity, totalAssets, netDebt, revenue, ebitda, netIncome] = row;
    m.period = period;
    m.revenue = revenue;
    m.netIncome = netIncome;
    m.roe = equity > 0 ? netIncome / equity * 100 : null;
    m.netMargin = revenue > 0 ? netIncome / revenue * 100 : null;
    m.netDebtEbitda = ebitda > 0 ? netDebt / ebitda : null;
    if (q && q.price > 0) {
      const mcap = q.price * shares;
      m.mcap = mcap;
      m.fk = netIncome > 0 ? mcap / netIncome : null;
      m.pddd = equity > 0 ? mcap / equity : null;
      m.fdFavok = ebitda > 0 ? (mcap + netDebt) / ebitda : null;
      if (window.VerityScore) {
        const r = VerityScore.compute({ price: q.price, shares, equity, totalAssets, netDebt, revenue, ebitda, netIncome, sector: m.sector });
        m.score = r.score;
        m.upside = r.model ? r.model.upside : null;
      }
    }
    return m;
  }

  // best: 'high' / 'low' marks the winning column; low-is-better ignores zero and negative values
  const ROWS = [
    { label: 'Fiyat', get: (m) => m.price, fmt: (v) => `₺${f2.format(v)}` },
    { label: 'Günlük değişim', get: (m) => m.change, fmt: (v) => `${v >= 0 ? '+' : '-'}%${f2.format(Math.abs(v))}`, tone: true },
    { label: 'Piyasa değeri', get: (m) => m.mcap, fmt: (v) => `₺${f2.format(v / 1e9)} Mlr` },
    { group: 'ONCAL değerlendirmesi' },
    { label: 'ONCAL skoru (0-10)', get: (m) => m.score, fmt: (v) => f1.format(v), best: 'high', hint: 'Kârlılık, faaliyet gücü, borç ve değerlemeden hesaplanır' },
    { label: 'Model değere uzaklık', get: (m) => m.upside, fmt: (v) => `${v >= 0 ? '+' : '-'}%${f1.format(Math.abs(v))}`, best: 'high', tone: true, hint: 'Sektör medyan çarpanlarına göre; hedef fiyat değildir' },
    { group: 'Değerleme' },
    { label: 'F/K', get: (m) => m.fk, fmt: (v) => f2.format(v), best: 'low' },
    { label: 'PD/DD', get: (m) => m.pddd, fmt: (v) => f2.format(v), best: 'low' },
    { label: 'FD/FAVÖK', get: (m) => m.fdFavok, fmt: (v) => f2.format(v), best: 'low' },
    { group: 'Kârlılık ve borç' },
    { label: 'Özsermaye kârlılığı (ROE)', get: (m) => m.roe, fmt: (v) => `%${f1.format(v)}`, best: 'high' },
    { label: 'Net kâr marjı', get: (m) => m.netMargin, fmt: (v) => `%${f1.format(v)}`, best: 'high' },
    { label: 'Net borç / FAVÖK', get: (m) => m.netDebtEbitda, fmt: (v) => `${f2.format(v)}x`, best: 'low', signed: true },
    { group: 'Son 12 ay' },
    { label: 'Satışlar', get: (m) => m.revenue, fmt: (v) => `₺${f2.format(v / 1e9)} Mlr` },
    { label: 'Net kâr', get: (m) => m.netIncome, fmt: (v) => `₺${f2.format(v / 1e9)} Mlr`, tone: true },
    { label: '52 hafta aralığındaki yeri', get: (m) => m.yearPos, fmt: (v) => `%${f1.format(v)}` }
  ];

  function winnerIndex(row, list) {
    if (!row.best || list.length < 2) return -1;
    const vals = list.map((m) => row.get(m));
    const ok = vals.map((v) => Number.isFinite(v) && (row.best !== 'low' || row.signed || v > 0));
    if (ok.filter(Boolean).length < 2) return -1;
    let best = -1;
    vals.forEach((v, i) => {
      if (!ok[i]) return;
      const better = best < 0 || (row.best === 'high' ? v > vals[best] : v < vals[best]);
      if (better) best = i;
    });
    return best;
  }

  const toneClass = (row, v) => (row.tone && Number.isFinite(v) ? (v >= 0 ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-200');

  function tableHtml(list) {
    const head = list.map((m) => `
      <th class="px-3 py-3 text-left align-top min-w-[150px]">
        <div class="flex items-start justify-between gap-2">
          <button type="button" onclick="Compare.openStock('${esc(m.code)}')" class="text-left">
            <div class="text-base font-mono font-bold text-white hover:text-[#7FA6FF]">${esc(m.code)}</div>
            <div class="text-[11px] text-slate-400 font-sans font-normal leading-snug">${esc(m.name)}</div>
            <div class="text-[10px] text-slate-500 font-sans font-normal mt-0.5">${esc(m.sector)}</div>
          </button>
          <button type="button" onclick="Compare.remove('${esc(m.code)}')" class="text-slate-500 hover:text-rose-400" title="Karşılaştırmadan çıkar" aria-label="${esc(m.code)} çıkar">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </th>`).join('');

    const body = ROWS.map((row) => {
      if (row.group) {
        return `<tr><td colspan="${list.length + 1}" class="px-3 pt-5 pb-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">${row.group}</td></tr>`;
      }
      const win = winnerIndex(row, list);
      const cells = list.map((m, i) => {
        const v = row.get(m);
        const has = Number.isFinite(v);
        const cls = i === win ? 'text-emerald-300 font-bold bg-emerald-500/10' : toneClass(row, v);
        return `<td class="px-3 py-2.5 font-mono text-sm ${has ? cls : 'text-slate-600'}">${has ? row.fmt(v) : '—'}${i === win ? ' <i class="fa-solid fa-crown text-[9px] text-emerald-400"></i>' : ''}</td>`;
      }).join('');
      const hint = row.hint ? `<div class="text-[10px] text-slate-500 font-sans">${row.hint}</div>` : '';
      return `<tr class="border-t border-oa-border/60"><td class="px-3 py-2.5 text-xs text-slate-400 font-sans">${row.label}${hint}</td>${cells}</tr>`;
    }).join('');

    return `
      <div class="overflow-x-auto rounded-2xl border border-oa-border bg-oa-card">
        <table class="w-full text-left border-collapse">
          <thead><tr class="border-b border-oa-border"><th class="px-3 py-3 w-[190px]"></th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="text-[11px] text-slate-500 font-sans leading-relaxed">
        <i class="fa-solid fa-crown text-emerald-400 text-[9px]"></i> Satırın en iyisini gösterir (F/K, PD/DD, FD/FAVÖK ve borçta düşük, diğerlerinde yüksek iyidir).
        Fiyatlar gecikmeli (Yahoo Finance), oranlar son 12 aylık gerçek bilançodan hesaplanır. Yatırım tavsiyesi değildir.
      </p>`;
  }

  /* ---------- Picker ---------- */
  function searchResults(query) {
    const q = (typeof normalizeSearchText === 'function' ? normalizeSearchText(query) : query.toLowerCase()).trim();
    if (!q || typeof getFullBistStockList !== 'function') return [];
    return getFullBistStockList()
      .filter((s) => !selected.includes(s.code) && s.searchTarget.includes(q))
      .sort((a, b) => (b.code.toLowerCase().startsWith(q) ? 1 : 0) - (a.code.toLowerCase().startsWith(q) ? 1 : 0))
      .slice(0, 8);
  }

  function onSearch(input) {
    const box = document.getElementById('compareResults');
    if (!box) return;
    const found = searchResults(input.value);
    box.innerHTML = found.map((s) => `
      <button type="button" onclick="Compare.add('${esc(s.code)}')" class="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[#162238]">
        <span class="font-mono font-bold text-white text-sm">${esc(s.code)}</span>
        <span class="text-[11px] text-slate-400 truncate">${esc(s.name)}</span>
      </button>`).join('');
    box.classList.toggle('hidden', !found.length);
  }

  function chipsHtml() {
    return selected.map((c) => `
      <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#2F6BFF]/10 border border-[#2F6BFF]/40 text-[#9DBBFF] text-xs font-mono font-bold">
        ${esc(c)}
        <button type="button" onclick="Compare.remove('${esc(c)}')" aria-label="${esc(c)} çıkar" class="hover:text-white"><i class="fa-solid fa-xmark"></i></button>
      </span>`).join('');
  }

  /* ---------- Rendering ---------- */
  async function render() {
    const root = document.getElementById('compareRoot');
    if (!root) return;
    const token = ++renderToken;

    const full = selected.length >= MAX;
    root.innerHTML = `
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex flex-wrap gap-2" id="compareChips">${chipsHtml()}</div>
        <div class="relative w-full sm:w-72 ${full ? 'opacity-50 pointer-events-none' : ''}">
          <input id="compareSearch" type="text" autocomplete="off" oninput="Compare.onSearch(this)" placeholder="${full ? `En fazla ${MAX} hisse` : 'Hisse ekle (ör. THYAO)'}"
            class="w-full px-3.5 py-2.5 rounded-xl bg-[#0C1322] border border-[#1A2540] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2F6BFF]">
          <div id="compareResults" class="hidden absolute z-20 mt-1 w-full rounded-xl bg-[#0A101D] border border-[#1A2540] shadow-xl overflow-hidden"></div>
        </div>
      </div>
      <div id="compareBody"></div>`;

    const body = document.getElementById('compareBody');
    if (selected.length < 2) {
      body.innerHTML = `
        <div class="rounded-2xl border border-dashed border-oa-border p-8 text-center text-sm text-slate-400 font-sans">
          ${selected.length ? 'Karşılaştırmak için bir hisse daha ekle.' : 'Karşılaştırmak için en az iki hisse ekle.'}
        </div>`;
      return;
    }

    body.innerHTML = '<div class="text-sm text-slate-500 font-sans p-6">Veriler yükleniyor…</div>';
    const [data, , q] = await Promise.all([loadFundamentals(), window.VerityScore ? VerityScore.ready() : null, loadQuotes(selected)]);
    if (token !== renderToken) return;

    const list = selected.map((c) => metricsFor(c, data[c] || null, q[c]));
    const missing = list.filter((m) => m.price == null).map((m) => m.code);
    body.innerHTML = tableHtml(list) + (missing.length
      ? `<p class="text-xs text-amber-400 font-sans">${missing.join(', ')} için canlı fiyat alınamadı; fiyata bağlı oranlar boş görünür.</p>`
      : '');
  }

  function add(code) {
    code = String(code || '').toUpperCase();
    if (!code || selected.includes(code) || selected.length >= MAX) {
      if (selected.length >= MAX && typeof showToast === 'function') showToast(`En fazla ${MAX} hisse karşılaştırılabilir`);
      return;
    }
    selected.push(code);
    save();
    if (appState.activeView === 'compare') render();
  }

  function remove(code) {
    selected = selected.filter((c) => c !== code);
    save();
    render();
  }

  function openStock(code) {
    if (typeof switchView === 'function') switchView('stock-detail', code);
  }

  /** From the stock page: add the current stock and jump to the comparison. */
  function addAndOpen(code) {
    add(code);
    if (typeof switchView === 'function') switchView('compare');
    else render();
  }

  return { add, remove, render, onSearch, openStock, addAndOpen };
})();

window.Compare = Compare;
