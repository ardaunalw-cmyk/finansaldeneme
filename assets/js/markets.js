/**
 * Dünya Piyasaları: indices, currencies, commodities, crypto and US yields from /api/markets
 * (Yahoo Finance, delayed), each with the day's change, the month's change and a sparkline, plus
 * gram gold in TL worked out from the ounce price and USD/TRY. A row opens its chart (/api/history).
 *
 * MarketBoard (the table, the sparkline, the chart panel) is shared with the Fonlar view (funds.js).
 */
const MarketBoard = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = d => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const NF = { 0: nf(0), 2: nf(2), 4: nf(4) };

  /** Price with as many decimals as its size needs (USD/JPY 4, BIST 100 2, bitcoin 0). */
  function fmtPrice(v, kind) {
    if (!Number.isFinite(v)) return '—';
    if (kind === 'yield') return `%${NF[2].format(v)}`;
    if (Math.abs(v) >= 10000) return NF[0].format(v);
    if (Math.abs(v) < 10) return NF[4].format(v);
    return NF[2].format(v);
  }
  const fmtPct = v => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${NF[2].format(v)}%` : '—');
  const tone = v => (!Number.isFinite(v) ? 'text-slate-400' : v >= 0 ? 'text-emerald-400' : 'text-rose-400');

  /** A 100x28 polyline of the closes, green when the period ends higher. */
  function sparkSvg(values) {
    const v = (values || []).filter(Number.isFinite);
    if (v.length < 2) return '<svg width="100" height="28" aria-hidden="true"></svg>';
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
    const pts = v.map((x, i) => `${(i / (v.length - 1) * 98 + 1).toFixed(1)},${(26 - (x - lo) / span * 24).toFixed(1)}`).join(' ');
    const up = v[v.length - 1] >= v[0];
    return `<svg width="100" height="28" viewBox="0 0 100 28" aria-hidden="true"><polyline fill="none" stroke="${up ? '#10B981' : '#F43F5E'}" stroke-width="1.5" points="${pts}"/></svg>`;
  }

  /** A group card: rows of { key, label, row, kind }; a row button carries data-mb="KEY". */
  function groupHtml(title, items, icon = 'fa-chart-line') {
    return `
      <section class="rounded-2xl border border-[#1A2540] bg-[#0C1322] overflow-hidden">
        <h3 class="px-4 py-2.5 text-xs font-bold text-slate-200 bg-[#0A101C] border-b border-[#1A2540] flex items-center gap-2"><i class="fa-solid ${icon} text-[10px] text-[#7FA6FF]"></i>${esc(title)}</h3>
        <div class="divide-y divide-[#162238]">
          ${items.map(({ key, label, sub, row, kind }) => `
            <button type="button" data-mb="${esc(key)}" class="w-full grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_6.5rem_4.5rem_4.5rem_100px] gap-x-3 items-center px-4 py-2.5 text-left hover:bg-[#121C30]">
              <span class="min-w-0"><span class="block text-sm text-white font-medium truncate">${esc(label)}</span>${sub ? `<span class="block text-[10px] text-slate-500 truncate">${esc(sub)}</span>` : ''}</span>
              <span class="text-right font-mono text-sm text-white">${row ? fmtPrice(row.price, kind) : '<span class="text-slate-500">—</span>'}
                <span class="sm:hidden block text-[11px] ${tone(row && row.change)}">${row ? fmtPct(row.change) : ''}</span></span>
              <span class="hidden sm:block text-right font-mono text-xs ${tone(row && row.change)}">${row ? fmtPct(row.change) : ''}</span>
              <span class="hidden sm:block text-right font-mono text-[11px] ${tone(row && row.month)}" title="Son 1 ay">${row ? fmtPct(row.month) : ''}</span>
              <span class="hidden sm:block">${row ? sparkSvg(row.spark) : ''}</span>
            </button>`).join('')}
        </div>
      </section>`;
  }

  async function fetchRows(keys) {
    const out = {};
    for (let i = 0; i < keys.length; i += 40) {
      const r = await fetch(`/api/markets?keys=${encodeURIComponent(keys.slice(i, i + 40).join(','))}`);
      if (r.ok) Object.assign(out, (await r.json()).rows || {});
    }
    return out;
  }

  /** Chart panel inside `host`: candles of KEY over a range, built on Lightweight Charts. */
  let openChart = null;
  function chartPanel(host, key, label, kind) {
    const L = window.LightweightCharts;
    if (!host || !L) return;
    if (openChart) { openChart.remove(); openChart = null; }
    const RANGES = { '1A': ['1mo', '1d'], '6A': ['6mo', '1d'], '1Y': ['1y', '1d'], '5Y': ['5y', '1wk'] };
    host.classList.remove('hidden');
    host.innerHTML = `
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <span class="text-sm font-bold text-white">${esc(label)}</span>
        <span data-mb-range class="flex gap-1">${Object.keys(RANGES).map(r => `<button type="button" data-mb-r="${r}" class="px-2 py-0.5 rounded-md border border-[#1A2540] text-[11px] text-slate-400 hover:text-white">${r}</button>`).join('')}</span>
        <button type="button" data-mb-close class="ml-auto px-2 text-slate-500 hover:text-white" aria-label="Grafiği kapat">×</button>
      </div>
      <div class="relative h-[320px]"><div data-mb-chart class="absolute inset-0"></div></div>`;
    const box = host.querySelector('[data-mb-chart]');
    const chart = L.createChart(box, {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#94A3B8', fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: '#152038' }, horzLines: { color: '#152038' } },
      rightPriceScale: { borderColor: '#1E2B45' }, timeScale: { borderColor: '#1E2B45' },
      localization: { locale: 'tr-TR', priceFormatter: p => fmtPrice(p, kind) }
    });
    const series = chart.addSeries(L.CandlestickSeries, { upColor: '#10B981', downColor: '#F43F5E', borderVisible: false, wickUpColor: '#10B981', wickDownColor: '#F43F5E' });
    async function show(r) {
      host.querySelectorAll('[data-mb-r]').forEach(b => b.classList.toggle('text-white', b.dataset.mbR === r));
      const [range, interval] = RANGES[r];
      try {
        const res = await fetch(`/api/history?symbol=${encodeURIComponent(key)}&range=${range}&interval=${interval}`);
        if (!res.ok) throw new Error(res.status);
        const h = await res.json();
        const bars = h.t.map((t, i) => ({ time: Math.floor(t / 1000), open: h.o[i], high: h.h[i], low: h.l[i], close: h.c[i] }))
          .filter((b, i, a) => !i || b.time > a[i - 1].time);
        series.setData(bars);
        chart.timeScale().fitContent();
      } catch {
        box.insertAdjacentHTML('afterend', '<p class="text-xs text-rose-400 mt-1">Grafik verisi alınamadı.</p>');
      }
    }
    host.onclick = e => {
      if (e.target.closest('[data-mb-close]')) { chart.remove(); openChart = null; host.classList.add('hidden'); host.innerHTML = ''; return; }
      const b = e.target.closest('[data-mb-r]');
      if (b) show(b.dataset.mbR);
    };
    show('6A');
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    openChart = chart;
    return chart;
  }

  return { fmtPrice, fmtPct, tone, sparkSvg, groupHtml, fetchRows, chartPanel, esc };
})();

const Markets = (() => {
  const $ = id => document.getElementById(id);

  /** label, sub (what the number is), kind ('yield' prints a percent). */
  const LABELS = {
    BIST100: ['BIST 100', 'Borsa İstanbul'], BIST30: ['BIST 30', 'Borsa İstanbul'],
    USDTRY: ['Dolar / TL'], EURTRY: ['Euro / TL'], GBPTRY: ['Sterlin / TL'],
    GRAM: ['Gram altın (TL)', 'Ons fiyatı × dolar kuru ÷ 31,1035'],
    SP500: ['S&P 500', 'ABD'], NASDAQ: ['Nasdaq Composite', 'ABD'], DOWJONES: ['Dow Jones', 'ABD'], VIX: ['VIX korku endeksi', 'S&P 500 oynaklık beklentisi'],
    DAX: ['DAX', 'Almanya'], FTSE: ['FTSE 100', 'İngiltere'], CAC40: ['CAC 40', 'Fransa'], NIKKEI: ['Nikkei 225', 'Japonya'], HANGSENG: ['Hang Seng', 'Hong Kong'],
    EURUSD: ['Euro / Dolar'], GBPUSD: ['Sterlin / Dolar'], USDJPY: ['Dolar / Yen'], DXY: ['Dolar endeksi (DXY)', 'Dolar, 6 büyük para birimine karşı'],
    ALTIN: ['Altın', '$/ons, vadeli'], GUMUS: ['Gümüş', '$/ons, vadeli'], PLATIN: ['Platin', '$/ons, vadeli'],
    BRENT: ['Brent petrol', '$/varil, vadeli'], WTI: ['WTI petrol', '$/varil, vadeli'], DOGALGAZ: ['Doğal gaz', '$/MMBtu, vadeli'], BAKIR: ['Bakır', '$/libre, vadeli'],
    BTC: ['Bitcoin', '$'], ETH: ['Ethereum', '$'], SOL: ['Solana', '$'],
    US5Y: ['ABD 5 yıllık faiz', 'Hazine tahvili getirisi', 'yield'], US10Y: ['ABD 10 yıllık faiz', 'Hazine tahvili getirisi', 'yield'], US30Y: ['ABD 30 yıllık faiz', 'Hazine tahvili getirisi', 'yield']
  };
  const GROUPS = [
    ['Türkiye', ['BIST100', 'BIST30', 'USDTRY', 'EURTRY', 'GBPTRY', 'GRAM'], 'fa-flag'],
    ['ABD endeksleri', ['SP500', 'NASDAQ', 'DOWJONES', 'VIX'], 'fa-landmark'],
    ['Avrupa ve Asya', ['DAX', 'FTSE', 'CAC40', 'NIKKEI', 'HANGSENG'], 'fa-earth-europe'],
    ['Döviz', ['EURUSD', 'GBPUSD', 'USDJPY', 'DXY'], 'fa-money-bill-transfer'],
    ['Emtia', ['ALTIN', 'GUMUS', 'PLATIN', 'BRENT', 'WTI', 'DOGALGAZ', 'BAKIR'], 'fa-gem'],
    ['Kripto', ['BTC', 'ETH', 'SOL'], 'fa-bitcoin-sign'],
    ['ABD tahvil faizleri', ['US5Y', 'US10Y', 'US30Y'], 'fa-percent']
  ];
  const OUNCE = 31.1035;

  /** Gram gold in TL from the ounce (USD) and USD/TRY rows; null when either is missing. */
  function gramGold(gold, usd) {
    if (!gold || !usd) return null;
    const g = (o, u) => (Number.isFinite(o) && Number.isFinite(u) ? o * u / OUNCE : null);
    const n = Math.min(gold.spark.length, usd.spark.length);
    const spark = Array.from({ length: n }, (_, i) => g(gold.spark[gold.spark.length - n + i], usd.spark[usd.spark.length - n + i]));
    const price = g(gold.price, usd.price), prev = g(gold.prev, usd.prev);
    return {
      key: 'GRAM', price, prev, spark,
      change: price && prev ? (price / prev - 1) * 100 : null,
      month: price && spark[0] ? (price / spark[0] - 1) * 100 : null
    };
  }

  const state = { rows: {}, loadedAt: 0, timer: null };

  async function load() {
    const keys = [...new Set(GROUPS.flatMap(g => g[1]).filter(k => k !== 'GRAM'))];
    try { state.rows = await MarketBoard.fetchRows(keys); } catch { /* keeps the last rows */ }
    state.rows.GRAM = gramGold(state.rows.ALTIN, state.rows.USDTRY);
    state.loadedAt = Date.now();
    paint();
  }

  function paint() {
    const el = $('mkBody');
    if (!el) return;
    const items = keys => keys.map(k => ({ key: k, label: LABELS[k][0], sub: LABELS[k][1], kind: LABELS[k][2], row: state.rows[k] }));
    el.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">${GROUPS.map(([t, keys, icon]) => MarketBoard.groupHtml(t, items(keys), icon)).join('')}</div>
      <p class="text-[10px] text-slate-500 font-mono">Yahoo Finance, gecikmeli. Sütunlar: son fiyat, günlük değişim, 1 aylık değişim, 1 aylık seyir. Satıra tıklayınca grafik açılır. ${state.loadedAt ? `Güncellendi: ${new Date(state.loadedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : ''}</p>`;
  }

  function render() {
    if (!state.loadedAt) {
      const el = $('mkBody');
      if (el) el.innerHTML = '<p class="text-xs text-slate-500 text-center py-10"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Piyasalar yükleniyor...</p>';
    }
    if (Date.now() - state.loadedAt > 60000) load(); else paint();
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      if (document.hidden || typeof appState === 'undefined' || appState.activeView !== 'markets') return;
      load();
    }, 60000);
  }

  function init() {
    const view = $('view-markets');
    if (!view) return;
    view.addEventListener('click', e => {
      const btn = e.target.closest('[data-mb]');
      if (!btn) return;
      const key = btn.dataset.mb;
      if (key === 'GRAM') { MarketBoard.chartPanel($('mkChart'), 'ALTIN', 'Altın ($/ons) · gram altın bu fiyattan hesaplanır'); return; }
      if (key === 'BIST100' || key === 'BIST30' || LABELS[key]) MarketBoard.chartPanel($('mkChart'), key, LABELS[key][0], LABELS[key][2]);
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { render, gramGold };
})();

if (typeof window !== 'undefined') { window.MarketBoard = MarketBoard; window.Markets = Markets; }
