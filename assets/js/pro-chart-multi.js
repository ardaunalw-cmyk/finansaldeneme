/**
 * Multi-chart layout around the main price chart (pro-chart.js): one or three side charts of
 * other symbols on the main chart's timeframe. They follow the main chart's visible dates and
 * crosshair, so the same moment lines up across all of them. Each side chart shows candles,
 * volume and SMA 20/50; its symbol is typed into its header. The layout and the symbols are
 * kept in this browser only.
 */
const ProChartMulti = (() => {
  const L = window.LightweightCharts;
  const SIDE = { 1: 0, 2: 1, 4: 3 };          // layout -> number of side charts
  const DEFAULT_SYMBOLS = ['BIST100', 'GARAN', 'USDTRY'];
  const SYMBOL = /^[A-Z0-9]{2,8}$/;

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(`verity.chart.${key}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(key, value) {
      try { localStorage.setItem(`verity.chart.${key}`, JSON.stringify(value)); } catch { return; /* private mode: keep in memory only */ }
      window.dispatchEvent(new CustomEvent('verity:data', { detail: 'charts' }));   // account sync
    }
  };

  const savedLayout = () => (SIDE[store.get('layout', 1)] !== undefined ? store.get('layout', 1) : 1);
  const savedSymbols = () => {
    const saved = store.get('multi', DEFAULT_SYMBOLS);
    return DEFAULT_SYMBOLS.map((s, i) => (Array.isArray(saved) && SYMBOL.test(saved[i]) ? saved[i] : s));
  };
  let layout = savedLayout();
  const symbols = savedSymbols();
  let panels = [];                             // { i, el, chart, candles, vol, sma20, sma50, bars, request }
  let interval = null;
  const fmt2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const $ = id => document.getElementById(id);

  function cellHtml(i) {
    return `
      <div class="absolute top-1 left-2 right-2 z-10 flex items-center gap-2 text-[11px] font-mono">
        <input data-mc="${i}" value="${symbols[i]}" maxlength="8" aria-label="${i + 2}. grafiğin sembolü"
          class="w-20 px-1.5 py-0.5 bg-[#0A101C] border border-[#1A2540] rounded text-white uppercase font-bold">
        <span data-mc-last class="text-slate-300 truncate"></span>
      </div>
      <div data-mc-chart class="absolute left-0 right-0 bottom-0 top-7"></div>`;
  }

  function paintButtons() {
    document.querySelectorAll('#proChartCard [data-pc^="layout:"]').forEach(btn => {
      const active = btn.dataset.pc === `layout:${layout}`;
      btn.className = `px-2 py-0.5 rounded-md border text-[11px] transition-all ${active ? 'bg-[#2F6BFF] text-white border-[#2F6BFF]' : 'text-slate-400 border-[#1A2540] hover:text-white'}`;
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  /** (Re)creates the side cells for the current layout. */
  function render() {
    const grid = $('proChartGrid');
    if (!grid || !L) return;
    grid.dataset.layout = String(layout);
    panels.forEach(p => { if (p.chart) p.chart.remove(); p.el.remove(); });
    panels = [];
    for (let i = 0; i < SIDE[layout]; i++) {
      const el = document.createElement('div');
      el.className = 'pc-cell relative min-w-0 rounded-lg border border-[#1A2540] bg-[#070B14]';
      el.innerHTML = cellHtml(i);
      grid.appendChild(el);
      panels.push({ i, el, chart: null, bars: null, request: 0 });
    }
    paintButtons();
    if (interval) panels.forEach(load);
  }

  function build(p) {
    const C = ProChart.COLORS;
    const chart = L.createChart(p.el.querySelector('[data-mc-chart]'), {
      ...ProChart.chartOptions(),
      // The main chart drives scrolling; side charts follow its dates
      handleScroll: false, handleScale: false
    });
    p.chart = chart;
    p.candles = chart.addSeries(L.CandlestickSeries, { upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down });
    p.vol = chart.addSeries(L.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    p.vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const quiet = { lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
    p.sma20 = chart.addSeries(L.LineSeries, { color: C.brand, ...quiet });
    p.sma50 = chart.addSeries(L.LineSeries, { color: C.amber, ...quiet });
  }

  function setData(p) {
    const C = ProChart.COLORS;
    const closes = p.bars.map(b => b.close);
    const line = values => p.bars.map((b, k) => ({ time: b.time, value: values[k] })).filter(x => x.value != null);
    p.candles.setData(p.bars);
    p.vol.setData(p.bars.map(b => ({ time: b.time, value: b.volume, color: b.close >= b.open ? C.upSoft : C.downSoft })));
    p.sma20.setData(line(Ind.sma(closes, 20)));
    p.sma50.setData(line(Ind.sma(closes, 50)));
    const last = p.bars[p.bars.length - 1], prev = p.bars[p.bars.length - 2] || last;
    const chg = (last.close / prev.close - 1) * 100;
    p.el.querySelector('[data-mc-last]').innerHTML =
      `${fmt2.format(last.close)} <b class="${chg >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${chg >= 0 ? '+' : ''}${fmt2.format(chg)}%</b>`;
    follow(p, ProChart.visibleRange());
  }

  async function load(p) {
    const id = ++p.request;
    const symbol = symbols[p.i], iv = interval;
    const last = p.el.querySelector('[data-mc-last]');
    last.textContent = 'Yükleniyor...';
    let bars;
    try { bars = await ProChart.fetchBars(symbol, iv); } catch { bars = []; }
    if (id !== p.request || !panels.includes(p)) return;
    if (bars.length < 2) { last.textContent = 'Bu zaman dilimi için veri yok'; if (p.chart) { p.chart.remove(); p.chart = null; } return; }
    // Rebuilt for each load: intraday and daily charts label the time axis differently
    if (p.chart) p.chart.remove();
    build(p);
    p.bars = bars;
    setData(p);
  }

  function follow(p, range) {
    if (!p.chart || !p.bars || !range) return;
    try { p.chart.timeScale().setVisibleRange(range); } catch { /* range outside this symbol's bars */ }
  }

  function crosshair(p, time) {
    if (!p.chart || !p.bars) return;
    const t = time == null ? null : ProChart.snapTime(p.bars, time);
    if (t == null) { p.chart.clearCrosshairPosition(); return; }
    const bar = p.bars.find(b => b.time === t);
    p.chart.setCrosshairPosition(bar.close, t, p.candles);
  }

  function setSymbol(i, raw) {
    const s = String(raw || '').toLocaleUpperCase('tr-TR').trim();
    const p = panels.find(x => x.i === i);
    if (!p) return;
    const input = p.el.querySelector(`[data-mc="${i}"]`);
    if (!SYMBOL.test(s)) { input.value = symbols[i]; return; }
    input.value = s;
    if (s === symbols[i]) return;
    symbols[i] = s;
    store.set('multi', symbols);
    load(p);
  }

  function setLayout(n) {
    if (SIDE[n] === undefined || n === layout) return;
    layout = n;
    store.set('layout', n);
    render();
  }

  /** Layout and symbols changed in storage (account sync from another device). */
  function refresh() {
    layout = savedLayout();
    symbols.splice(0, symbols.length, ...savedSymbols());
    render();
  }

  function init() {
    if (!window.ProChart || !L || !$('proChartGrid')) return;
    document.querySelectorAll('#proChartToolbar').forEach(bar => bar.addEventListener('click', e => {
      const btn = e.target.closest('[data-pc^="layout:"]');
      if (btn) setLayout(Number(btn.dataset.pc.split(':')[1]));
    }));
    const grid = $('proChartGrid');
    grid.addEventListener('change', e => { if (e.target.dataset.mc != null) setSymbol(Number(e.target.dataset.mc), e.target.value); });
    grid.addEventListener('keydown', e => {
      if (e.target.dataset.mc == null) return;
      if (e.key === 'Enter') { setSymbol(Number(e.target.dataset.mc), e.target.value); e.target.blur(); }
      if (e.key === 'Escape') { e.target.value = symbols[Number(e.target.dataset.mc)]; e.target.blur(); }
    });
    ProChart.subscribe(e => panels.forEach(p => (e.type === 'range' ? follow(p, e.range) : crosshair(p, e.time))));
    // The main chart switched timeframe (or first loaded): side charts reload on it
    window.addEventListener('verity:chart', e => {
      if (e.detail.interval === interval) return;
      interval = e.detail.interval;
      panels.forEach(load);
    });
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { setLayout, refresh };
})();

window.ProChartMulti = ProChartMulti;
