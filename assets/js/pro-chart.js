/**
 * Interactive price chart on the stock page, built on TradingView Lightweight Charts
 * (assets/lib/lightweight-charts-*, Apache-2.0; the attribution logo stays on as the licence asks).
 *
 * Real bars from /api/history (Yahoo Finance, delayed) in seven timeframes, from 5-minute to
 * weekly; 4-hour bars are built here from hourly ones. Times are shifted to Istanbul time so
 * the axis reads like the exchange clock. Indicators are the pure functions in indicators.js;
 * oscillators get their own panes under the price. Drawings (horizontal level, trend line,
 * Fibonacci, ray, rectangle, parallel channel, text note) are kept per stock in this browser
 * only and follow the stock across timeframes. Shapes the library has no series for are
 * painted on a canvas primitive attached to the price series, which also draws the preview of
 * an unfinished drawing and the measure tool.
 */
const ProChart = (() => {
  const L = window.LightweightCharts;
  const COLORS = {
    text: '#94A3B8', grid: '#152038', border: '#1E2B45',
    up: '#10B981', down: '#F43F5E', upSoft: 'rgba(16, 185, 129, 0.45)', downSoft: 'rgba(244, 63, 94, 0.45)',
    brand: '#2F6BFF', amber: '#F59E0B', emerald: '#10B981', sky: '#38BDF8', violet: '#C084FC',
    slate: '#64748B', draw: '#FBBF24', alarm: '#F97316'
  };
  const DAY = 86400;

  /** Timeframes: the /api/history request behind each, and the window shown when picked. */
  // tol: how far (seconds) a compared symbol's bar may sit from the stock's bar it is matched to
  const INTERVALS = {
    '5m': { api: '5m', range: '60d', intraday: true, view: '1G', tol: 150 },
    '15m': { api: '15m', range: '60d', intraday: true, view: '5G', tol: 450 },
    '30m': { api: '30m', range: '60d', intraday: true, view: '5G', tol: 900 },
    '1h': { api: '60m', range: '2y', intraday: true, view: '1A', tol: 1800 },
    '4h': { api: '60m', range: '2y', intraday: true, view: '3A', group: 4, tol: 7200 },
    '1d': { api: '1d', range: '5y', view: '6A', tol: 12 * 3600 },
    '1wk': { api: '1wk', range: '10y', view: '5Y', tol: 3.5 * 86400 }
  };
  /** Compare mode: up to three symbols, each keeping its colour (validated on the dark card). */
  const COMPARE_COLORS = ['#2F6BFF', '#D97706', '#A855F7'];
  const MAX_COMPARE = 3;
  const QUICK_COMPARE = { BIST100: 'BIST 100', USDTRY: 'USD/TRY', ALTIN: 'Altın ($/ons)' };
  const compareLabel = s => QUICK_COMPARE[s] || s;
  /** Visible windows: trading days for 1G/5G, calendar days for the rest. */
  const SPANS = { '1G': { trading: 1 }, '5G': { trading: 5 }, '1A': 30, '3A': 91, '6A': 182, '1Y': 365, '5Y': 1826, all: Infinity };
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const REFRESH_MS = 60 * 1000;

  /** Every indicator the toolbar can switch on; `pane: true` ones get a pane of their own. */
  const INDICATORS = {
    sma20: { label: 'SMA 20', color: COLORS.brand },
    sma50: { label: 'SMA 50', color: COLORS.amber },
    sma200: { label: 'SMA 200', color: COLORS.emerald },
    ema9: { label: 'EMA 9', color: COLORS.sky },
    ema21: { label: 'EMA 21', color: COLORS.violet },
    bb: { label: 'Bollinger', color: COLORS.slate },
    volume: { label: 'Hacim', color: COLORS.slate },
    vp: { label: 'Hacim Profili', color: COLORS.slate },
    rsi: { label: 'RSI 14', color: COLORS.brand, pane: true },
    macd: { label: 'MACD', color: COLORS.sky, pane: true },
    stoch: { label: 'Stokastik', color: COLORS.sky, pane: true }
  };
  const DEFAULT_ON = ['sma20', 'sma50', 'sma200', 'volume', 'rsi'];

  /**
   * Inputs of each indicator, editable in the settings panel. The keys stay sma20, ema9, ...
   * (saved toggles use them); the periods behind them are whatever the viewer set.
   */
  const period = (def, max = 500) => ({ key: 'n', label: 'Periyot', def, min: 1, max });
  const SETTINGS = {
    sma20: [period(20)], sma50: [period(50)], sma200: [period(200)],
    ema9: [period(9)], ema21: [period(21)],
    bb: [{ ...period(20, 200), min: 2 }, { key: 'k', label: 'Sapma (σ)', def: 2, min: 0.5, max: 5, step: 0.1 }],
    rsi: [{ ...period(14, 100), min: 2 }, { key: 'upper', label: 'Üst çizgi', def: 70, min: 1, max: 99 }, { key: 'lower', label: 'Alt çizgi', def: 30, min: 1, max: 99 }],
    macd: [{ key: 'fast', label: 'Hızlı', def: 12, min: 2, max: 100 }, { key: 'slow', label: 'Yavaş', def: 26, min: 3, max: 200 }, { key: 'signal', label: 'Sinyal', def: 9, min: 2, max: 100 }],
    stoch: [{ key: 'k', label: '%K periyodu', def: 14, min: 2, max: 100 }, { key: 'd', label: '%D düzleştirme', def: 3, min: 1, max: 20 },
      { key: 'upper', label: 'Üst çizgi', def: 80, min: 1, max: 99 }, { key: 'lower', label: 'Alt çizgi', def: 20, min: 1, max: 99 }]
  };

  /** Settings clamped to their limits; anything missing or invalid takes the default. */
  function cleanSettings(saved = {}) {
    const out = {};
    Object.entries(SETTINGS).forEach(([ind, fields]) => {
      out[ind] = {};
      fields.forEach(f => {
        const v = Number(saved[ind] && saved[ind][f.key]);
        out[ind][f.key] = Number.isFinite(v) ? Math.min(f.max, Math.max(f.min, f.step ? v : Math.round(v))) : f.def;
      });
    });
    return out;
  }

  /** Toolbar and legend name of an indicator with its current inputs, e.g. "SMA 34". */
  function indLabel(key, cfg) {
    const c = cfg[key] || {};
    if (key.startsWith('sma')) return `SMA ${c.n}`;
    if (key.startsWith('ema')) return `EMA ${c.n}`;
    if (key === 'bb') return `BB ${c.n},${fmtNum(c.k)}`;
    if (key === 'rsi') return `RSI ${c.n}`;
    if (key === 'macd') return `MACD ${c.fast},${c.slow},${c.signal}`;
    if (key === 'stoch') return `Stok ${c.k},${c.d}`;
    return INDICATORS[key].label;
  }
  const fmtNum = v => String(v).replace('.', ',');

  /** Chart preferences and drawings; a change is announced so a signed-in account syncs it (account.js). */
  const PREFIX = 'verity.chart.';
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(PREFIX + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(key, value) {
      try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { return; /* private mode: keep in memory only */ }
      window.dispatchEvent(new CustomEvent('verity:data', { detail: 'charts' }));
    }
  };

  /** Custom formula indicators (formula.js): up to three, each a line or, for a condition, signal arrows. */
  const MAX_FORMULAS = 3;
  const FORMULA_COLORS = ['#22D3EE', '#F472B6', '#A3E635'];
  const cleanFormulas = list => (Array.isArray(list) ? list : [])
    .filter(f => f && typeof f.expr === 'string')
    .slice(0, MAX_FORMULAS)
    .map(f => ({ expr: f.expr.slice(0, 300), pane: !!f.pane }));

  const savedInterval = store.get('interval', '1d');
  const savedRange = store.get('range', '6A');
  const state = {
    ticker: null,
    bars: null,                 // [{ time, open, high, low, close, volume }], time in Istanbul-local seconds
    interval: INTERVALS[savedInterval] ? savedInterval : '1d',
    type: store.get('type', 'candle'),
    on: new Set(store.get('indicators', DEFAULT_ON)),
    cfg: cleanSettings(store.get('settings', {})),
    formulas: cleanFormulas(store.get('formulas', [])),
    formulaOpen: false,
    compare: store.get('compare', []).filter(s => /^[A-Z0-9]{2,8}$/.test(s)).slice(0, MAX_COMPARE),
    compareBars: { key: null, data: {} },   // bars of the compared symbols for state.barsKey
    compareOpen: false,
    range: SPANS[savedRange] ? savedRange : '6A',
    tool: 'cursor',
    pending: null,              // first click of a two-point drawing
    pending2: null,             // second click of a channel (the third sets its width)
    hover: null,                // { x, y, time, price } under the mouse while a drawing is unfinished
    measure: null,              // { a, b } of the last measurement, shown until the next click or Esc
    overlay: null,              // canvas primitive on the price series
    replay: null,               // { all, idx, playing, speed, timer }: bars after idx are hidden
    drawList: [],               // drawings of the stock on screen, as last saved
    chart: null,
    main: null,
    binds: [],                  // re-set each series' data from state.bars (periodic refresh)
    legendSeries: [],           // [{ label, color, series }] shown in the crosshair legend
    marks: null,                // { key: 'TICKER|interval', list } trade markers from the backtest
    barsKey: null,              // 'TICKER|interval' of state.bars (the toolbar switches before new bars arrive)
    request: 0                  // id of the latest load, so a slow older response is dropped
  };
  const viewKey = () => state.barsKey;

  const fmt2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtVol = v => (v >= 1e9 ? `${fmt2.format(v / 1e9)} Mr` : v >= 1e6 ? `${fmt2.format(v / 1e6)} Mn` : v >= 1e3 ? `${fmt2.format(v / 1e3)} B` : String(v));
  const $ = id => document.getElementById(id);

  /* ---------- data ---------- */

  /** /api/history arrays -> ascending bars, times shifted by the exchange's UTC offset. */
  function toBars(h, offset = 0) {
    const out = [];
    for (let i = 0; i < h.t.length; i++) {
      const [o, hi, lo, c] = [h.o[i], h.h[i], h.l[i], h.c[i]];
      if (![o, hi, lo, c].every(Number.isFinite)) continue;
      const time = Math.floor(h.t[i] / 1000) + offset;
      if (out.length && time <= out[out.length - 1].time) continue;   // Yahoo occasionally repeats the last bar
      out.push({ time, open: o, high: hi, low: lo, close: c, volume: h.v ? h.v[i] || 0 : 0 });
    }
    return out;
  }

  /** Merges every `size` consecutive bars of the same (local) day: hourly -> 4-hour. */
  function groupBars(bars, size) {
    const out = [];
    let day = null, k = 0, cur = null;
    bars.forEach(b => {
      const d = Math.floor(b.time / DAY);
      if (d !== day) { day = d; k = 0; }
      if (k % size === 0) {
        cur = { ...b };
        out.push(cur);
      } else {
        cur.high = Math.max(cur.high, b.high);
        cur.low = Math.min(cur.low, b.low);
        cur.close = b.close;
        cur.volume += b.volume;
      }
      k++;
    });
    return out;
  }

  function heikinAshi(bars) {
    const out = [];
    bars.forEach((b, i) => {
      const close = (b.open + b.high + b.low + b.close) / 4;
      const open = i ? (out[i - 1].open + out[i - 1].close) / 2 : (b.open + b.close) / 2;
      out.push({ time: b.time, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close) });
    });
    return out;
  }

  /** First bar index of a visible window (see SPANS), at least 10 bars back from the end. */
  function startIndex(bars, range) {
    const n = bars.length;
    const span = SPANS[range];
    let from = 0;
    if (span && span !== Infinity) {
      if (typeof span === 'object') {
        let seen = 0, prev = null, i = n - 1;
        for (; i >= 0; i--) {
          const d = Math.floor(bars[i].time / DAY);
          if (d !== prev) { prev = d; if (++seen > span.trading) break; }
        }
        from = i + 1;
      } else {
        const cut = bars[n - 1].time - span * DAY;
        from = bars.findIndex(b => b.time >= cut);
      }
    }
    return Math.max(0, Math.min(from, n - 10));
  }

  /** Nearest bar time to `time`, or null outside the loaded bars (drawings across timeframes). */
  function snapTime(bars, time) {
    if (!bars.length || time < bars[0].time || time > bars[bars.length - 1].time) return null;
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].time < time) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && time - bars[lo - 1].time < bars[lo].time - time) lo--;
    return bars[lo].time;
  }

  /**
   * A compared symbol's closes on the stock's bar times: each bar goes to the nearest stock bar
   * within `tol` seconds (an index or currency stamps its bars a little differently, and a
   * currency trades outside the exchange's hours); bars with no match are dropped.
   */
  function alignTo(main, other, tol) {
    const out = [];
    if (!main.length) return out;
    other.forEach(b => {
      let lo = 0, hi = main.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (main[mid].time < b.time) lo = mid + 1; else hi = mid;
      }
      if (lo > 0 && b.time - main[lo - 1].time < main[lo].time - b.time) lo--;
      const t = main[lo].time;
      if (Math.abs(t - b.time) > tol) return;
      if (out.length && out[out.length - 1].time === t) out[out.length - 1].value = b.close;   // later bar wins
      else out.push({ time: t, value: b.close });
    });
    return out;
  }

  async function fetchCompare(ticker, interval, fresh = false) {
    const data = {};
    await Promise.all(state.compare.filter(s => s !== ticker).map(async s => {
      try { data[s] = await fetchBars(s, interval, fresh); } catch { /* left out; the panel says so */ }
    }));
    return data;
  }

  /** Compared symbols that have bars for what the chart shows now. */
  const activeCompare = () => (state.compareBars.key === state.barsKey
    ? state.compare.filter(s => s !== state.ticker && state.compareBars.data[s] && state.compareBars.data[s].length)
    : []);

  async function fetchBars(ticker, interval, fresh = false) {
    const cfg = INTERVALS[interval];
    const h = await TechData.history(ticker, cfg.range, cfg.api, fresh);
    const bars = toBars(h, Number.isFinite(h.gmtoffset) ? h.gmtoffset : 10800);
    return cfg.group ? groupBars(bars, cfg.group) : bars;
  }

  /** Pairs an indicator array with bar times, dropping the warm-up nulls. */
  const line = (values) => state.bars
    .map((b, i) => ({ time: b.time, value: values[i] }))
    .filter(p => p.value != null && Number.isFinite(p.value));

  /* ---------- chart ---------- */

  function chartOptions() {
    const intraday = !!INTERVALS[state.interval].intraday;
    return {
      autoSize: true,
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: COLORS.text,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 11,
        attributionLogo: true,
        panes: { separatorColor: COLORS.border, separatorHoverColor: 'rgba(47, 107, 255, 0.25)', enableResize: true }
      },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      crosshair: { mode: L.CrosshairMode.Normal },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border, rightOffset: 4, minBarSpacing: 1, timeVisible: intraday, secondsVisible: false },
      localization: { locale: 'tr-TR', priceFormatter: p => fmt2.format(p) }
    };
  }

  const quiet = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };

  /** Sets a series' data now and on every refresh. */
  function bind(series, compute) {
    const apply = () => series.setData(compute());
    apply();
    state.binds.push(apply);
    return series;
  }

  function addMain(chart) {
    if (state.type === 'line') {
      return chart.addSeries(L.LineSeries, { color: COLORS.sky, lineWidth: 2 });
    }
    if (state.type === 'area') {
      return chart.addSeries(L.AreaSeries, { lineColor: COLORS.brand, topColor: 'rgba(47, 107, 255, 0.35)', bottomColor: 'rgba(47, 107, 255, 0)', lineWidth: 2 });
    }
    return chart.addSeries(L.CandlestickSeries, {
      upColor: COLORS.up, downColor: COLORS.down, borderVisible: false,
      wickUpColor: COLORS.up, wickDownColor: COLORS.down
    });
  }

  function mainData() {
    if (state.type === 'line' || state.type === 'area') return state.bars.map(b => ({ time: b.time, value: b.close }));
    return state.type === 'heikin' ? heikinAshi(state.bars) : state.bars;
  }

  /** comparing: the price axis is in percent, so indicators drawn on the price are left out. */
  function addIndicators(chart, comparing) {
    const closes = () => state.bars.map(b => b.close);
    const highs = () => state.bars.map(b => b.high);
    const lows = () => state.bars.map(b => b.low);
    const overlay = (key, compute, opts = {}) =>
      bind(chart.addSeries(L.LineSeries, { color: INDICATORS[key].color, lineWidth: 1.5, ...quiet, ...opts }), () => line(compute()));
    const legend = (label, color, series) => state.legendSeries.push({ label, color, series });
    const cfg = state.cfg;
    const name = key => indLabel(key, cfg);

    const onPrice = key => state.on.has(key) && !comparing;
    ['sma20', 'sma50', 'sma200'].forEach(key => {
      if (onPrice(key)) legend(name(key), INDICATORS[key].color, overlay(key, () => Ind.sma(closes(), cfg[key].n), key === 'sma200' ? { lineStyle: L.LineStyle.Dashed } : {}));
    });
    ['ema9', 'ema21'].forEach(key => {
      if (onPrice(key)) legend(name(key), INDICATORS[key].color, overlay(key, () => Ind.ema(closes(), cfg[key].n)));
    });
    if (onPrice('bb')) {
      const bands = () => Ind.bollinger(closes(), cfg.bb.n, cfg.bb.k);
      overlay('bb', () => bands().upper, { lineStyle: L.LineStyle.Dotted });
      legend(`${name('bb')} orta`, COLORS.slate, overlay('bb', () => bands().mid, { lineWidth: 1 }));
      overlay('bb', () => bands().lower, { lineStyle: L.LineStyle.Dotted });
    }
    if (state.on.has('volume')) {
      const vol = chart.addSeries(L.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, ...quiet });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      bind(vol, () => state.bars.map(b => ({ time: b.time, value: b.volume, color: b.close >= b.open ? COLORS.upSoft : COLORS.downSoft })));
      legend('Hacim', COLORS.slate, vol);
    }

    // Oscillator panes, in a fixed order under the price pane
    let pane = 0;
    const guide = (series, price, color) => series.createPriceLine({ price, color, lineWidth: 1, lineStyle: L.LineStyle.Dashed, axisLabelVisible: false });
    const paneLine = (color, compute) =>
      bind(chart.addSeries(L.LineSeries, { color, lineWidth: 1.5, priceLineVisible: false }, pane), () => line(compute()));
    if (state.on.has('rsi')) {
      pane++;
      const s = paneLine(COLORS.brand, () => Ind.rsi(closes(), cfg.rsi.n));
      guide(s, cfg.rsi.upper, COLORS.down); guide(s, cfg.rsi.lower, COLORS.up);
      legend(name('rsi'), COLORS.brand, s);
    }
    if (state.on.has('macd')) {
      pane++;
      const m = () => Ind.macd(closes(), cfg.macd.fast, cfg.macd.slow, cfg.macd.signal);
      const hist = chart.addSeries(L.HistogramSeries, { ...quiet }, pane);
      bind(hist, () => line(m().histogram).map(p => ({ ...p, color: p.value >= 0 ? COLORS.upSoft : COLORS.downSoft })));
      const ml = paneLine(COLORS.sky, () => m().line);
      const sl = paneLine(COLORS.amber, () => m().signal);
      legend(name('macd'), COLORS.sky, ml); legend('Sinyal', COLORS.amber, sl);
    }
    if (state.on.has('stoch')) {
      pane++;
      const st = () => Ind.stochastic(highs(), lows(), closes(), cfg.stoch.k, cfg.stoch.d);
      const k = paneLine(COLORS.sky, () => st().k);
      const d = paneLine(COLORS.violet, () => st().d);
      guide(k, cfg.stoch.upper, COLORS.down); guide(k, cfg.stoch.lower, COLORS.up);
      legend('%K', COLORS.sky, k); legend('%D', COLORS.violet, d);
    }
    // Formula lines: on the price, or in a pane of their own (conditions become markers, see formulaMarks)
    formulaList().forEach(({ f, i, compiled }) => {
      if (!compiled || compiled.type !== 'number' || (!f.pane && comparing)) return;
      if (f.pane) pane++;
      const color = FORMULA_COLORS[i];
      const s = bind(chart.addSeries(L.LineSeries, { color, lineWidth: 1.5, ...(f.pane ? { priceLineVisible: false } : quiet) }, f.pane ? pane : 0),
        () => line(compiled.run(state.bars)));
      legend(`F${i + 1}`, color, s);
    });
    // Price pane keeps most of the height; each oscillator pane gets a share of it
    chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
  }

  /** The saved formulas, compiled; a formula with a mistake has compiled null and its message. */
  function formulaList() {
    return state.formulas.map((f, i) => {
      if (!window.Formula || !f.expr.trim()) return { f, i, compiled: null, error: f.expr.trim() ? 'Formül modülü yüklenmedi' : null };
      try { return { f, i, compiled: Formula.compile(f.expr), error: null }; } catch (e) { return { f, i, compiled: null, error: e.message }; }
    });
  }

  /** Arrows where a condition formula turns true (false or unknown on the bar before). */
  function formulaMarks() {
    const out = [];
    formulaList().forEach(({ i, compiled }) => {
      if (!compiled || compiled.type !== 'condition') return;
      const v = compiled.run(state.bars);
      v.forEach((x, k) => {
        if (x === true && k > 0 && v[k - 1] !== true) out.push({ time: state.bars[k].time, position: 'belowBar', shape: 'arrowUp', color: FORMULA_COLORS[i], text: `F${i + 1}` });
      });
    });
    return out;
  }

  function paintFormulas() {
    const el = $('proChartFormula');
    if (!el) return;
    el.classList.toggle('hidden', !state.formulaOpen);
    if (!state.formulaOpen) return;
    const rows = formulaList().map(({ f, i, compiled, error }) => `
      <div class="flex flex-wrap items-center gap-2">
        <span class="inline-block w-3 h-3 rounded-sm shrink-0" style="background:${FORMULA_COLORS[i]}"></span>
        <span class="text-slate-300 font-bold">F${i + 1}</span>
        <input type="text" data-pc-formula="${i}" maxlength="300" spellcheck="false" autocomplete="off" aria-label="F${i + 1} formülü"
          placeholder="ör. ema(close, 9) - ema(close, 21) ya da crossover(close, sma(close, 50))"
          class="flex-1 min-w-[12rem] px-2 py-1 bg-[#070B14] border ${error ? 'border-rose-700' : 'border-[#1A2540]'} rounded text-white text-[11px] font-mono">
        <label class="flex items-center gap-1 text-slate-400" title="Değerleri fiyattan çok farklıysa (RSI gibi) ayrı panelde çiz">
          <input type="checkbox" data-pc-formula-pane="${i}" ${f.pane ? 'checked' : ''} class="accent-[#2F6BFF]">Ayrı panel</label>
        <span class="text-[10px] ${error ? 'text-rose-400' : 'text-slate-500'}">${error ? '' : compiled ? (compiled.type === 'condition' ? 'koşul: doğru olduğu mumda ok' : 'çizgi') : ''}</span>
        <button type="button" data-pc="formula-del:${i}" class="px-1 text-slate-500 hover:text-white" aria-label="F${i + 1} formülünü sil">×</button>
        ${error ? '<p data-pc-formula-error class="basis-full text-[10px] text-rose-400"></p>' : ''}
      </div>`).join('');
    el.innerHTML = `
      <div class="space-y-2">
        ${rows || '<p class="text-slate-500">Henüz formül yok.</p>'}
        <div class="flex flex-wrap items-center justify-between gap-2">
          ${state.formulas.length < MAX_FORMULAS ? '<button type="button" data-pc="formula-add" class="px-2 py-0.5 rounded-md border border-[#2F6BFF] text-white bg-[#2F6BFF]/20 hover:bg-[#2F6BFF]/40">+ Formül ekle</button>' : `<span class="text-[10px] text-slate-500">En fazla ${MAX_FORMULAS} formül</span>`}
          <span class="text-[10px] text-slate-500">Değerler: open high low close volume · Fonksiyonlar: ${window.Formula ? Object.keys(Formula.FUNCTIONS).join(', ') : ''} · and or not</span>
        </div>
      </div>`;
    // Texts go in as values: they are the viewer's own (or a shared idea's) input
    const errors = el.querySelectorAll('[data-pc-formula-error]');
    let e = 0;
    formulaList().forEach(({ f, i, error }) => {
      el.querySelector(`[data-pc-formula="${i}"]`).value = f.expr;
      if (error) errors[e++].textContent = error;
    });
  }

  function saveFormulas(list) {
    state.formulas = cleanFormulas(list);
    store.set('formulas', state.formulas);
    paintFormulas();
    build(true);
  }

  /* ---------- drawings ---------- */

  const drawingsKey = () => `drawings.${state.ticker}`;
  const drawings = () => store.get(drawingsKey(), []);
  const saveDrawings = list => store.set(drawingsKey(), list);

  function paintDrawings(chart, main) {
    drawings().forEach(d => {
      if (d.type === 'h') {
        main.createPriceLine({ price: d.price, color: COLORS.draw, lineWidth: 1, lineStyle: L.LineStyle.Solid, axisLabelVisible: true, title: '' });
      } else if (d.type === 't') {
        // Drawn on another timeframe: pin both ends to this timeframe's nearest bars
        const a = snapTime(state.bars, d.a.time), b = snapTime(state.bars, d.b.time);
        if (a == null || b == null || a === b) return;
        const s = chart.addSeries(L.LineSeries, { color: COLORS.draw, lineWidth: 2, ...quiet });
        s.setData([{ time: a, value: d.a.price }, { time: b, value: d.b.price }].sort((x, y) => x.time - y.time));
      } else if (d.type === 'f') {
        const span = d.b.price - d.a.price;
        FIB.forEach(r => main.createPriceLine({
          price: d.b.price - span * r,
          color: r === 0.618 ? COLORS.emerald : COLORS.draw,
          lineWidth: 1, lineStyle: r === 0 || r === 1 ? L.LineStyle.Solid : L.LineStyle.Dashed,
          axisLabelVisible: true, title: `${fmt2.format(r * 100)}%`
        }));
      }
    });
  }

  /** Untriggered price alerts for this stock (app.js keeps them), as dashed lines with a label. */
  function paintAlerts(main) {
    if (typeof getAlerts !== 'function') return;
    getAlerts()
      .filter(a => !a.triggered && a.ticker === state.ticker && (a.type === 'price_above' || a.type === 'price_below'))
      .forEach(a => main.createPriceLine({
        price: Number(a.targetValue),
        color: COLORS.alarm, lineWidth: 1, lineStyle: L.LineStyle.LargeDashed,
        axisLabelVisible: true, title: `Alarm ${a.type === 'price_above' ? '>=' : '<='}`
      }));
  }

  /** Distance in pixels from point p to the segment a-b. */
  function segmentDistance(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  /* ---------- canvas drawings (ray, rectangle, channel, note, measure) ---------- */

  const DRAW_FILL = 'rgba(251, 191, 36, 0.10)';
  const NOTE_FONT = '11px JetBrains Mono, ui-monospace, monospace';

  /** Screen point of a stored { time, price }, or null when its bar is not loaded. */
  function toXY(p) {
    const t = snapTime(state.bars, p.time);
    const x = t == null ? null : state.chart.timeScale().timeToCoordinate(t);
    const y = state.main.priceToCoordinate(p.price);
    return x == null || y == null ? null : { x, y };
  }

  const yOnLine = (a, b, x) => (b.x === a.x ? a.y : a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x));

  /** Where the line a->b leaves the pane on b's side: a ray runs to the edge. */
  const rayEnd = (a, b, width) => (b.x === a.x ? b : { x: b.x > a.x ? width : 0, y: yOnLine(a, b, b.x > a.x ? width : 0) });

  /** Pixel shift of a channel's parallel line (its width is kept in price units). */
  function channelDy(d) {
    const base = state.main.priceToCoordinate(d.a.price), moved = state.main.priceToCoordinate(d.a.price + d.off);
    return base == null || moved == null ? 0 : moved - base;
  }

  /** Box of a note's label next to its anchor (monospace, so the width follows the length). */
  const noteBox = (p, text) => ({ x: p.x + 6, y: p.y - 22, w: text.length * 6.7 + 12, h: 18 });

  const barIndex = p => state.bars.findIndex(b => b.time === snapTime(state.bars, p.time));

  /** "+12,40 (+5,31%) · 23 mum" between two prices `bars` candles apart. */
  function measureLabel(from, to, bars) {
    const diff = to - from;
    const sign = diff >= 0 ? '+' : '';
    return `${sign}${fmt2.format(diff)} (${sign}${fmt2.format(from ? diff / from * 100 : 0)}%) · ${Math.abs(bars)} mum`;
  }

  function paintOverlay(ctx, size) {
    if (!state.bars || !state.main || !state.chart) return;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.font = NOTE_FONT;
    ctx.textBaseline = 'middle';
    const seg = (a, b, dash = []) => { ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); };
    const ink = () => { ctx.strokeStyle = COLORS.draw; ctx.fillStyle = DRAW_FILL; };
    const rect = (a, b) => {
      ink();
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    };
    const channel = (a, b, dy) => {
      ink();
      const a2 = { x: a.x, y: a.y + dy }, b2 = { x: b.x, y: b.y + dy };
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(a2.x, a2.y); ctx.closePath(); ctx.fill();
      seg(a, b); seg(a2, b2);
      seg({ x: a.x, y: a.y + dy / 2 }, { x: b.x, y: b.y + dy / 2 }, [4, 4]);
    };
    const note = (p, text) => {
      const box = noteBox(p, text);
      ctx.fillStyle = 'rgba(7, 11, 20, 0.92)'; ctx.strokeStyle = COLORS.draw;
      ctx.fillRect(box.x, box.y, box.w, box.h); ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = COLORS.draw; ctx.fillText(text, box.x + 6, box.y + box.h / 2 + 0.5);
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill();
    };
    const measure = (a, b, label) => {
      const up = b.y <= a.y;
      ctx.strokeStyle = up ? COLORS.up : COLORS.down;
      ctx.fillStyle = up ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)';
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      seg(a, b, [4, 3]);
      const w = label.length * 6.7 + 12, x = (a.x + b.x) / 2 - w / 2, y = up ? Math.min(a.y, b.y) - 24 : Math.max(a.y, b.y) + 6;
      ctx.fillStyle = up ? COLORS.up : COLORS.down;
      ctx.fillRect(x, y, w, 18);
      ctx.fillStyle = '#FFFFFF'; ctx.fillText(label, x + 6, y + 9.5);
    };

    state.drawList.forEach(d => {
      if (!['r', 'y', 'c', 'n'].includes(d.type)) return;
      const a = toXY(d.a);
      if (!a) return;
      if (d.type === 'n') { note(a, d.text); return; }
      const b = toXY(d.b);
      if (!b) return;
      if (d.type === 'r') rect(a, b);
      else if (d.type === 'y') { ink(); seg(a, rayEnd(a, b, size.width)); }
      else channel(a, b, channelDy(d));
    });

    if (state.measure) {
      const a = toXY(state.measure.a), b = toXY(state.measure.b);
      if (a && b) measure(a, b, measureLabel(state.measure.a.price, state.measure.b.price, barIndex(state.measure.b) - barIndex(state.measure.a)));
    }

    // Unfinished drawing: its shape follows the mouse
    const h = state.hover;
    const a = state.pending && h ? toXY(state.pending) : null;
    if (a) {
      ctx.globalAlpha = 0.75;
      const tool = state.tool;
      if (tool === 'c' && state.pending2) {
        const b = toXY(state.pending2);
        if (b) channel(a, b, h.y - yOnLine(a, b, h.x));
      } else if (tool === 'c' || tool === 't' || tool === 'f') { ink(); seg(a, h, tool === 'f' ? [4, 4] : []); }
      else if (tool === 'y') { ink(); seg(a, rayEnd(a, h, size.width)); }
      else if (tool === 'r') rect(a, h);
      else if (tool === 'm' && h.price != null) {
        const logical = state.chart.timeScale().coordinateToLogical(h.x);
        measure(a, h, measureLabel(state.pending.price, h.price, logical == null ? 0 : Math.round(logical) - barIndex(state.pending)));
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* ---------- volume profile (visible range) ---------- */

  /**
   * Volume by price over `bars`: each bar's volume is spread evenly over the price rows its
   * high-low range covers, split into up (close >= open) and down volume. poc is the row with
   * the most volume; the value area grows from it towards the heavier neighbour until it
   * holds 70% of the volume. Returns null when there is nothing to profile.
   */
  function volumeProfile(bars, rows = 24) {
    const used = bars.filter(b => b.volume > 0);
    if (!used.length) return null;
    const lo = Math.min(...used.map(b => b.low)), hi = Math.max(...used.map(b => b.high));
    if (!(hi > lo)) return null;
    const step = (hi - lo) / rows;
    const out = Array.from({ length: rows }, () => ({ up: 0, down: 0 }));
    used.forEach(b => {
      const from = Math.min(rows - 1, Math.floor((b.low - lo) / step));
      // A high exactly on a row's floor does not reach into that row
      const to = Math.max(from, Math.min(rows - 1, Math.ceil((b.high - lo) / step) - 1));
      const share = b.volume / (to - from + 1);
      for (let r = from; r <= to; r++) out[r][b.close >= b.open ? 'up' : 'down'] += share;
    });
    const total = out.reduce((s, r) => s + r.up + r.down, 0);
    const vol = r => (r >= 0 && r < rows ? out[r].up + out[r].down : -1);
    let poc = 0;
    out.forEach((_, r) => { if (vol(r) > vol(poc)) poc = r; });
    let a = poc, b = poc, inside = vol(poc);
    while (inside < total * 0.7 && (a > 0 || b < rows - 1)) {
      if (vol(b + 1) >= vol(a - 1)) inside += vol(++b); else inside += vol(--a);
    }
    return { lo, step, rows: out, poc, vaLow: a, vaHigh: b };
  }

  /** The profile of the bars on screen, drawn from the right edge behind the candles. */
  function paintProfile(ctx, size) {
    if (!state.bars || !state.main || !state.chart) return;
    const range = state.chart.timeScale().getVisibleLogicalRange();
    if (!range) return;
    const from = Math.max(0, Math.floor(range.from)), to = Math.min(state.bars.length - 1, Math.ceil(range.to));
    const p = volumeProfile(state.bars.slice(from, to + 1));
    if (!p) return;
    const max = Math.max(...p.rows.map(r => r.up + r.down));
    const width = size.width * 0.25;
    p.rows.forEach((r, i) => {
      const yTop = state.main.priceToCoordinate(p.lo + (i + 1) * p.step), yBot = state.main.priceToCoordinate(p.lo + i * p.step);
      if (yTop == null || yBot == null) return;
      const h = Math.max(1, yBot - yTop - 1);
      const inVa = i >= p.vaLow && i <= p.vaHigh;
      const wUp = width * r.up / max, wDown = width * r.down / max;
      ctx.fillStyle = inVa ? 'rgba(16, 185, 129, 0.38)' : 'rgba(16, 185, 129, 0.18)';
      ctx.fillRect(size.width - wUp - wDown, yTop, wUp, h);
      ctx.fillStyle = inVa ? 'rgba(244, 63, 94, 0.38)' : 'rgba(244, 63, 94, 0.18)';
      ctx.fillRect(size.width - wDown, yTop, wDown, h);
      if (i === p.poc) {
        ctx.strokeStyle = COLORS.amber;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(0, yTop + h / 2); ctx.lineTo(size.width, yTop + h / 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }

  /** Series primitive that paints `paint(ctx, size)` above (or behind) the candles. */
  function makeOverlay(paint = paintOverlay, z = 'top') {
    let request = null;
    const renderer = { draw: target => target.useMediaCoordinateSpace(({ context, mediaSize }) => paint(context, mediaSize)) };
    const view = { renderer: () => renderer, zOrder: () => z };
    return {
      attached: p => { request = p.requestUpdate; },
      detached: () => { request = null; },
      updateAllViews: () => {},
      paneViews: () => [view],
      redraw: () => { if (request) request(); }
    };
  }
  const redrawOverlay = () => { if (state.overlay) state.overlay.redraw(); };

  function trackHover(param) {
    if (!state.pending) { if (state.hover) { state.hover = null; redrawOverlay(); } return; }
    state.hover = param.point
      ? { x: param.point.x, y: param.point.y, time: param.time ?? null, price: state.main.coordinateToPrice(param.point.y) }
      : null;
    redrawOverlay();
  }

  /** Index of the drawing closest to a click (within 8 px on screen), or -1. */
  function drawingAt(point) {
    const y = price => state.main.priceToCoordinate(price);
    const width = $('proChart') ? $('proChart').clientWidth : 0;
    let best = -1, bestDist = 8;
    state.drawList.forEach((d, i) => {
      let dist = Infinity;
      if (d.type === 'h') dist = Math.abs(y(d.price) - point.y);
      else if (d.type === 'f') {
        const span = d.b.price - d.a.price;
        dist = Math.min(...FIB.map(r => Math.abs(y(d.b.price - span * r) - point.y)));
      } else if (d.type === 'n') {
        const a = toXY(d.a);
        const box = a && noteBox(a, d.text);
        if (box && point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) dist = 0;
        else if (a) dist = Math.hypot(point.x - a.x, point.y - a.y);
      } else {
        const a = toXY(d.a), b = toXY(d.b);
        if (!a || !b) return;
        if (d.type === 't') dist = segmentDistance(point, a, b);
        else if (d.type === 'y') dist = segmentDistance(point, a, rayEnd(a, b, width));
        else if (d.type === 'r') {
          const inside = point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y);
          dist = inside ? 0 : Math.min(...[[a, { x: b.x, y: a.y }], [{ x: b.x, y: a.y }, b], [b, { x: a.x, y: b.y }], [{ x: a.x, y: b.y }, a]].map(([p, q]) => segmentDistance(point, p, q)));
        } else if (d.type === 'c') {
          const dy = channelDy(d);
          const lo = Math.min(yOnLine(a, b, point.x), yOnLine(a, b, point.x) + dy), hi = Math.max(yOnLine(a, b, point.x), yOnLine(a, b, point.x) + dy);
          const within = point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x);
          dist = within && point.y >= lo && point.y <= hi ? 0
            : Math.min(segmentDistance(point, a, b), segmentDistance(point, { x: a.x, y: a.y + dy }, { x: b.x, y: b.y + dy }));
        }
      }
      if (Number.isFinite(dist) && dist < bestDist) { best = i; bestDist = dist; }
    });
    return best;
  }

  const SECOND_CLICK = {
    t: 'Trend çizgisi: ikinci noktaya tıkla',
    f: 'Fibonacci: ikinci noktaya (diğer uç) tıkla',
    y: 'Işın: yönü belirleyen ikinci noktaya tıkla',
    r: 'Dikdörtgen: karşı köşeye tıkla',
    c: 'Kanal: ana çizginin ikinci noktasına tıkla',
    m: 'Ölç: bitiş noktasına tıkla'
  };

  function onClick(param) {
    if (!param.point) return;
    if (state.tool === 'cursor') {
      if (state.measure) { state.measure = null; redrawOverlay(); }
      return;
    }
    if (state.tool === 'x') {
      if (activeCompare().length) { hint('Karşılaştırma açıkken çizimler gizli; önce karşılaştırmayı kapat'); return; }
      const i = drawingAt(param.point);
      if (i < 0) { hint('Silmek için bir çizgiye tıkla (Esc: vazgeç)'); return; }
      const list = drawings();
      list.splice(i, 1);
      saveDrawings(list);
      // Stay in delete mode while there is something left to delete
      if (!list.length) setTool('cursor'); else hint('Silindi. Başka bir çizgiye tıklayabilir ya da Esc ile çıkabilirsin');
      build(true);
      return;
    }
    if (param.time == null) return;
    if (state.tool === 'p') {
      const i = state.bars.findIndex(b => b.time === param.time);
      if (i >= 0) replayEnter(i);
      return;
    }
    const price = state.main.coordinateToPrice(param.point.y);
    if (price == null) return;
    const point = { time: param.time, price: Math.round(price * 100) / 100 };
    if (state.tool === 'a') {
      // Above the last close: alert when the price rises to it; below: when it falls to it
      const last = state.bars[state.bars.length - 1].close;
      setTool('cursor');
      if (typeof openSetAlertModal === 'function') openSetAlertModal(state.ticker, { value: point.price, type: point.price >= last ? 'price_above' : 'price_below' });
      return;
    }
    const list = drawings();
    if (state.tool === 'n') {
      setTool('cursor');
      const text = (window.prompt('Not metni (en fazla 80 karakter)', '') || '').trim().slice(0, 80);
      if (!text) return;
      list.push({ type: 'n', a: point, text });
    } else if (state.tool === 'h') {
      list.push({ type: 'h', price: point.price });
    } else if (!state.pending) {
      state.pending = point;
      hint(SECOND_CLICK[state.tool]);
      return;
    } else if (state.tool === 'm') {
      state.measure = { a: state.pending, b: point };
      setTool('cursor');
      redrawOverlay();
      return;
    } else {
      if (state.pending.time === point.time) return;      // same bar: wait for a real second point
      if (state.tool === 'c' && !state.pending2) {
        state.pending2 = point;
        hint('Kanal: genişlik için üçüncü noktaya tıkla');
        return;
      }
      if (state.tool === 'c') {
        // Width: the click's distance from the main line, measured where it was clicked
        const a = toXY(state.pending), b = toXY(state.pending2);
        const onLine = a && b ? state.main.coordinateToPrice(yOnLine(a, b, param.point.x)) : null;
        if (onLine == null) return;
        list.push({ type: 'c', a: state.pending, b: state.pending2, off: Math.round((price - onLine) * 10000) / 10000 });
      } else {
        list.push({ type: state.tool, a: state.pending, b: point });
      }
      state.pending = null;
    }
    saveDrawings(list);
    setTool('cursor');
    build(true);
  }

  /* ---------- legend ---------- */

  function paintLegend(param) {
    const el = $('proChartLegend');
    if (!el || !state.bars) return;
    let idx = param && param.time != null ? state.bars.findIndex(b => b.time === param.time) : -1;
    if (idx < 0) idx = state.bars.length - 1;
    const b = state.bars[idx];
    const prev = state.bars[Math.max(0, idx - 1)];
    const chg = prev ? (b.close / prev.close - 1) * 100 : 0;
    const tone = b.close >= b.open ? 'text-emerald-400' : 'text-rose-400';
    // Bar times are already Istanbul-local, so format them as UTC
    const when = new Date(b.time * 1000).toLocaleString('tr-TR', INTERVALS[state.interval].intraday
      ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
      : { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    // Compare mode: change since the first visible bar, the same base the percent axis uses
    const comparing = state.legendSeries.some(x => x.compare);
    const range = comparing && state.chart ? state.chart.timeScale().getVisibleLogicalRange() : null;
    const first = range ? Math.min(state.bars.length - 1, Math.max(0, Math.ceil(range.from))) : null;
    const sinceFirst = (v, base) => (base > 0 ? ` <span class="${v >= base ? 'text-emerald-400' : 'text-rose-400'}">${v >= base ? '+' : ''}${fmt2.format((v / base - 1) * 100)}%</span>` : '');
    const values = state.legendSeries.map(({ label, color, series, compare }) => {
      const p = param && param.seriesData ? param.seriesData.get(series) : null;
      const data = series.data();
      const v = p ? p.value : data.length ? data[data.length - 1].value : null;
      if (v == null) return '';
      const base = compare && first != null ? (series.dataByIndex(first, L.MismatchDirection.NearestRight) || {}).value : null;
      // Identity from the swatch; the text stays in the legend's own ink
      return `<span class="inline-flex items-center gap-1"><span class="inline-block w-2.5 h-0.5 rounded" style="background:${color}"></span>${label} ${label === 'Hacim' ? fmtVol(v) : fmt2.format(v)}${compare ? sinceFirst(v, base) : ''}</span>`;
    }).filter(Boolean).join(' ');
    el.innerHTML = `
      <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span class="text-white font-bold">${state.ticker}</span><span class="text-slate-500">${when}</span>
        <span>A <b class="${tone}">${fmt2.format(b.open)}</b></span>
        <span>Y <b class="${tone}">${fmt2.format(b.high)}</b></span>
        <span>D <b class="${tone}">${fmt2.format(b.low)}</b></span>
        <span>K <b class="${tone}">${fmt2.format(b.close)}</b></span>
        <b class="${chg >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${chg >= 0 ? '+' : ''}${fmt2.format(chg)}%</b>
        ${first != null ? `<span class="text-slate-400">görünen başlangıçtan${sinceFirst(b.close, state.bars[first].close)}</span>` : ''}
      </div>
      <div class="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">${values}</div>`;
  }

  /* ---------- toolbar ---------- */

  function hint(text) {
    const el = $('proChartHint');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
  }

  function setTool(tool) {
    state.tool = tool;
    state.pending = null;
    state.pending2 = null;
    state.hover = null;
    if (tool !== 'cursor') state.measure = null;
    hint({
      h: 'Yatay seviye: fiyata tıkla',
      t: 'Trend çizgisi: ilk noktaya tıkla',
      f: 'Fibonacci: dip ya da zirveye tıkla',
      y: 'Işın: başlangıç noktasına tıkla',
      r: 'Dikdörtgen: bir köşeye tıkla',
      c: 'Kanal: ana çizginin ilk noktasına tıkla',
      n: 'Not: notun yerine tıkla',
      m: 'Ölç: başlangıç noktasına tıkla',
      p: 'Replay: oynatmanın başlayacağı muma tıkla',
      a: 'Alarm: hedef fiyata tıkla',
      x: 'Sil: silmek istediğin çizime tıkla'
    }[tool] || '');
    paintToolbar();
    redrawOverlay();
  }

  function paintToolbar() {
    const comparing = activeCompare().length > 0;
    const on = 'bg-[#2F6BFF] text-white border-[#2F6BFF]';
    const off = 'text-slate-400 border-[#1A2540] hover:text-white';
    document.querySelectorAll('#proChartToolbar [data-pc], #proChartLeft [data-pc]').forEach(btn => {
      const [kind, value] = btn.dataset.pc.split(':');
      const active = (kind === 'iv' && state.interval === value) || (kind === 'range' && state.range === value)
        || (kind === 'type' && state.type === value) || (kind === 'ind' && state.on.has(value)) || (kind === 'tool' && state.tool === value)
        || (kind === 'replay' && (!!state.replay || state.tool === 'p'));
      if (['iv', 'range', 'type', 'ind', 'tool', 'replay'].includes(kind)) {
        btn.className = `px-2 py-0.5 rounded-md border text-[11px] font-semibold transition-all ${active ? on : off}`;
        btn.setAttribute('aria-pressed', String(active));
      }
      if (kind === 'ind' && SETTINGS[value]) btn.textContent = indLabel(value, state.cfg);
      // Price overlays are not drawn while comparing (the axis is in percent)
      if (kind === 'ind' && PRICE_OVERLAYS.includes(value)) {
        const hidden = comparing;
        btn.classList.toggle('opacity-40', hidden);
        btn.title = hidden ? 'Karşılaştırma açıkken gizli' : '';
      }
    });
  }
  const PRICE_OVERLAYS = ['sma20', 'sma50', 'sma200', 'ema9', 'ema21', 'bb', 'vp'];

  /* ---------- indicator settings panel ---------- */

  const PANEL_NAMES = { sma20: '1. SMA', sma50: '2. SMA', sma200: '3. SMA', ema9: '1. EMA', ema21: '2. EMA', bb: 'Bollinger', rsi: 'RSI', macd: 'MACD', stoch: 'Stokastik' };

  function paintSettings() {
    const el = $('proChartSettings');
    if (!el) return;
    el.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        ${Object.entries(SETTINGS).map(([ind, fields]) => `
          <fieldset class="p-2 rounded-lg border border-[#1A2540] bg-[#070B14] min-w-0">
            <legend class="px-1 text-[10px] text-slate-300 font-bold">${PANEL_NAMES[ind]}</legend>
            <div class="grid grid-cols-2 gap-2">
              ${fields.map(f => `
                <label class="block min-w-0"><span class="text-[10px] text-slate-500 block">${f.label}</span>
                  <input type="number" data-pc-set="${ind}.${f.key}" value="${state.cfg[ind][f.key]}" min="${f.min}" max="${f.max}" step="${f.step || 1}"
                    class="w-full px-2 py-1 bg-[#0C1322] border border-[#1A2540] rounded text-white text-[11px] font-mono"></label>`).join('')}
            </div>
          </fieldset>`).join('')}
      </div>
      <div class="flex items-center justify-between gap-2 mt-2">
        <span class="text-[10px] text-slate-500">Değerler her zaman diliminde mum sayısıdır (5 dakikalıkta SMA 20 = son 20 beş dakikalık mum).</span>
        <button type="button" data-pc="defaults" class="px-2 py-0.5 rounded-md border border-[#1A2540] text-slate-400 hover:text-white text-[11px]">Varsayılana dön</button>
      </div>`;
  }

  /* ---------- compare panel ---------- */

  function paintCompare() {
    const el = $('proChartCompare');
    if (!el) return;
    const shown = state.compareOpen || state.compare.length > 0;
    el.classList.toggle('hidden', !shown);
    if (!shown) return;
    const active = activeCompare();
    const chips = state.compare.map(s => {
      const color = COMPARE_COLORS[state.compare.indexOf(s) % COMPARE_COLORS.length];
      const loading = s !== state.ticker && state.compareBars.key === state.barsKey && state.compareBars.data[s] === undefined;
      const missing = !loading && !active.includes(s);
      return `<span class="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-md border border-[#1A2540] bg-[#070B14] text-slate-200">
          <span class="inline-block w-3 h-0.5 rounded" style="background:${color}"></span>${compareLabel(s)}
          ${loading ? '<span class="text-slate-500" title="Yükleniyor">…</span>' : ''}
          ${missing ? `<span class="text-amber-300" title="${s === state.ticker ? 'Grafikteki hisseyle aynı' : 'Bu zaman dilimi için veri yok'}">!</span>` : ''}
          <button type="button" data-pc="cmp-del:${s}" class="px-1 text-slate-500 hover:text-white" aria-label="${compareLabel(s)} karşılaştırmasını kaldır">×</button>
        </span>`;
    }).join('');
    const quick = Object.keys(QUICK_COMPARE).filter(s => !state.compare.includes(s))
      .map(s => `<button type="button" data-pc="cmp-add:${s}" class="px-2 py-0.5 rounded-md border border-[#1A2540] text-slate-400 hover:text-white">+ ${QUICK_COMPARE[s]}</button>`).join('');
    const canAdd = state.compare.length < MAX_COMPARE;
    el.innerHTML = `
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[10px] text-slate-400">Karşılaştır:</span>
        ${chips}
        ${canAdd ? `
          <input id="proChartCompareInput" type="text" maxlength="8" placeholder="Hisse kodu" aria-label="Karşılaştırılacak hisse kodu"
            class="w-24 px-2 py-0.5 bg-[#070B14] border border-[#1A2540] rounded text-white uppercase text-[11px]">
          <button type="button" data-pc="cmp-input" class="px-2 py-0.5 rounded-md border border-[#2F6BFF] text-white bg-[#2F6BFF]/20 hover:bg-[#2F6BFF]/40">Ekle</button>
          ${quick}` : `<span class="text-[10px] text-slate-500">En fazla ${MAX_COMPARE} seri</span>`}
      </div>
      ${active.length ? `<p class="text-[10px] text-slate-500 mt-1.5">Eksen, görünen ilk mumdan bu yana yüzde değişimi gösterir. Karşılaştırma açıkken fiyat üstü indikatörler, çizimler ve alarm çizgileri gizlenir.</p>` : ''}`;
  }

  const compareFetching = new Set();   // 'SYMBOL|TICKER|interval' requests in flight

  /**
   * Fetches compared symbols that have no bars yet for what the chart shows (just added, or added
   * while a load was running). A symbol with no history stays listed with an empty series.
   */
  function ensureCompare() {
    const key = state.barsKey;
    if (!key || state.compareBars.key !== key) return;
    const interval = key.split('|')[1];
    state.compare.filter(s => s !== state.ticker && !state.compareBars.data[s]).forEach(s => {
      const tag = `${s}|${key}`;
      if (compareFetching.has(tag)) return;
      compareFetching.add(tag);
      fetchBars(s, interval)
        .then(bars => {
          if (state.compareBars.key !== key || !state.compare.includes(s)) return;
          state.compareBars.data[s] = bars;
          if (bars.length) build(true); else paintCompare();
        })
        .catch(() => {
          if (state.compareBars.key !== key) return;
          state.compareBars.data[s] = [];
          paintCompare();
          hint(`${s} için fiyat geçmişi alınamadı`);
          setTimeout(() => { if (state.tool === 'cursor') hint(''); }, 4000);
        })
        .finally(() => compareFetching.delete(tag));
    });
  }

  function addCompare(raw) {
    const s = String(raw || '').toLocaleUpperCase('tr-TR').trim();
    if (!/^[A-Z0-9]{2,8}$/.test(s)) { hint('Geçerli bir hisse kodu yaz (ör. GARAN)'); return; }
    if (s === state.ticker) { hint('Grafikteki hisseyle aynı'); return; }
    if (state.compare.includes(s) || state.compare.length >= MAX_COMPARE) return;
    state.compare.push(s);
    store.set('compare', state.compare);
    paintCompare();
    ensureCompare();
  }

  function removeCompare(s) {
    state.compare = state.compare.filter(x => x !== s);
    store.set('compare', state.compare);
    delete state.compareBars.data[s];
    build(true);
  }

  let settingsTimer = null;
  function onSettingsInput(e) {
    const input = e.target.closest('[data-pc-set]');
    if (!input) return;
    const [ind, key] = input.dataset.pcSet.split('.');
    const next = JSON.parse(JSON.stringify(state.cfg));
    next[ind][key] = parseFloat(input.value);
    state.cfg = cleanSettings(next);
    store.set('settings', state.cfg);
    // Typing "21" passes through "2": redraw once the viewer pauses
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => build(true), 350);
  }

  function applyRange() {
    if (!state.chart || !state.bars) return;
    const n = state.bars.length;
    state.chart.timeScale().setVisibleLogicalRange({ from: startIndex(state.bars, state.range) - 0.5, to: n + 3 });
  }

  function setRange(range) {
    state.range = range;
    store.set('range', range);
    applyRange();
    paintToolbar();
  }

  function onToolbar(e) {
    const btn = e.target.closest('[data-pc]');
    if (!btn) return;
    const [kind, value] = btn.dataset.pc.split(':');
    if (kind === 'iv') {
      if (value === state.interval || !INTERVALS[value]) return;
      const prev = { interval: state.interval, range: state.range };
      state.interval = value;
      state.range = INTERVALS[value].view;
      paintToolbar();
      load(state.ticker, { reframe: true }).then(ok => {
        if (ok) { store.set('interval', value); store.set('range', state.range); return; }
        // No bars for this timeframe: keep showing (and saying) the previous one
        if (state.interval === value) { Object.assign(state, prev); paintToolbar(); }
      });
      return;
    }
    if (kind === 'range') { setRange(value); return; }
    if (kind === 'type') { state.type = value; store.set('type', value); build(true); return; }
    if (kind === 'ind') {
      state.on.has(value) ? state.on.delete(value) : state.on.add(value);
      store.set('indicators', [...state.on]);
      build(true);
      return;
    }
    if (kind === 'tool') { setTool(state.tool === value ? 'cursor' : value); return; }
    if (kind === 'compare') {
      state.compareOpen = !state.compareOpen;
      btn.setAttribute('aria-expanded', String(state.compareOpen));
      paintCompare();
      if (state.compareOpen && $('proChartCompareInput')) $('proChartCompareInput').focus();
      return;
    }
    if (kind === 'cmp-add') { addCompare(value); return; }
    if (kind === 'cmp-input') { addCompare($('proChartCompareInput') && $('proChartCompareInput').value); return; }
    if (kind === 'cmp-del') { removeCompare(value); return; }
    if (kind === 'settings') {
      const panel = $('proChartSettings');
      const open = panel.classList.toggle('hidden') === false;
      btn.setAttribute('aria-expanded', String(open));
      if (open) paintSettings();
      return;
    }
    if (kind === 'defaults') {
      state.cfg = cleanSettings({});
      store.set('settings', state.cfg);
      paintSettings();
      build(true);
      return;
    }
    if (kind === 'undo') { const list = drawings(); list.pop(); saveDrawings(list); build(true); return; }
    if (kind === 'clear') { saveDrawings([]); build(true); return; }
    if (kind === 'shot' && state.chart) { snapshot(); return; }
    if (kind === 'formula') {
      state.formulaOpen = !state.formulaOpen;
      btn.setAttribute('aria-expanded', String(state.formulaOpen));
      if (state.formulaOpen && !state.formulas.length) state.formulas = [{ expr: '', pane: false }];
      paintFormulas();
      const first = document.querySelector('[data-pc-formula="0"]');
      if (state.formulaOpen && first && !first.value) first.focus();
      return;
    }
    if (kind === 'formula-add') {
      if (state.formulas.length >= MAX_FORMULAS) return;
      state.formulas.push({ expr: '', pane: false });
      paintFormulas();
      const input = document.querySelector(`[data-pc-formula="${state.formulas.length - 1}"]`);
      if (input) input.focus();
      return;
    }
    if (kind === 'formula-del') { saveFormulas(state.formulas.filter((_, i) => i !== Number(value))); return; }
    if (kind === 'replay') {
      if (state.replay) replayExit();
      else setTool(state.tool === 'p' ? 'cursor' : 'p');
      paintReplay();
      return;
    }
    if (kind === 'rp-pick') { replayExit(); setTool('p'); paintReplay(); return; }
    if (kind === 'rp-play') { replayToggle(); return; }
    if (kind === 'rp-step') { replayPause(); replayStep(); return; }
    if (kind === 'rp-speed') { replaySpeed(value); return; }
    if (kind === 'rp-exit') { replayExit(); return; }
    if (kind === 'keys') { paintKeys($('proChartKeys') && $('proChartKeys').classList.contains('hidden')); return; }
    if (kind === 'full') { setFull(!isFull()); return; }
    if (kind === 'go') { goTo(value); return; }
    if (kind === 'watch') { if (typeof toggleStockWatchlist === 'function') toggleStockWatchlist(state.ticker); paintWatch(); }
  }

  /* ---------- bar replay ---------- */

  /** Milliseconds per bar at each speed. */
  const REPLAY_SPEEDS = { 1: 1000, 2: 500, 5: 200, 10: 100 };

  function paintReplay() {
    const el = $('proChartReplay');
    if (!el) return;
    const r = state.replay;
    el.classList.toggle('hidden', !r);
    const btn = document.querySelector('#proChartToolbar [data-pc="replay"]');
    if (btn) btn.setAttribute('aria-pressed', String(!!r || state.tool === 'p'));
    if (!r) return;
    const b = r.all[r.idx];
    const when = new Date(b.time * 1000).toLocaleString('tr-TR', INTERVALS[state.interval].intraday
      ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
      : { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const ctl = 'px-2 py-0.5 rounded-md border border-[#1A2540] text-slate-300 hover:text-white';
    el.innerHTML = `
      <div class="flex flex-wrap items-center gap-2">
        <span class="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-700/50 text-amber-300 font-bold">REPLAY</span>
        <button type="button" data-pc="rp-pick" class="${ctl}" title="Başka bir başlangıç mumu seç"><i class="fa-solid fa-backward-fast text-[10px]"></i></button>
        <button type="button" data-pc="rp-play" class="${ctl}" title="${r.playing ? 'Duraklat' : 'Oynat'} (Boşluk)"><i class="fa-solid ${r.playing ? 'fa-pause' : 'fa-play'} text-[10px]"></i></button>
        <button type="button" data-pc="rp-step" class="${ctl}" title="Bir mum ileri (Shift + →)"><i class="fa-solid fa-forward-step text-[10px]"></i></button>
        <span class="flex items-center gap-1" role="group" aria-label="Oynatma hızı">
          ${Object.keys(REPLAY_SPEEDS).map(s => `<button type="button" data-pc="rp-speed:${s}" aria-pressed="${String(r.speed) === s}"
            class="px-1.5 py-0.5 rounded-md border ${String(r.speed) === s ? 'bg-[#2F6BFF] text-white border-[#2F6BFF]' : 'border-[#1A2540] text-slate-400 hover:text-white'}">${s}x</button>`).join('')}
        </span>
        <span class="text-slate-400">${when} · ${r.idx + 1} / ${r.all.length}</span>
        <button type="button" data-pc="rp-exit" class="${ctl} ml-auto" title="Replay'den çık, bugüne dön"><i class="fa-solid fa-xmark text-[10px] mr-1"></i>Çık</button>
      </div>`;
  }

  /** Hides every bar after index i; indicators, drawings and the legend see only the past. */
  function replayEnter(i) {
    const all = state.replay ? state.replay.all : state.bars;
    replayPause();
    state.replay = { all, idx: Math.max(1, Math.min(i, all.length - 1)), playing: false, speed: store.get('replaySpeed', 2), timer: null };
    state.bars = all.slice(0, state.replay.idx + 1);
    setTool('cursor');
    build(true);
    state.chart.timeScale().scrollToRealTime();
    paintReplay();
  }

  function replayStep() {
    const r = state.replay;
    if (!r) return;
    if (r.idx >= r.all.length - 1) {
      replayPause();
      hint('Replay sonu: bugüne gelindi');
      setTimeout(() => { if (state.tool === 'cursor') hint(''); }, 3000);
      paintReplay();
      return;
    }
    r.idx++;
    state.bars = r.all.slice(0, r.idx + 1);
    state.binds.forEach(apply => apply());
    paintLegend(null);
    paintReplay();
  }

  function replayPause() {
    const r = state.replay;
    if (!r) return;
    clearInterval(r.timer);
    r.timer = null;
    r.playing = false;
  }

  function replayToggle() {
    const r = state.replay;
    if (!r) return;
    if (r.playing) replayPause();
    else {
      r.playing = true;
      r.timer = setInterval(replayStep, REPLAY_SPEEDS[r.speed] || 500);
    }
    paintReplay();
  }

  function replaySpeed(s) {
    const r = state.replay;
    if (!r || !REPLAY_SPEEDS[s]) return;
    r.speed = Number(s);
    store.set('replaySpeed', r.speed);
    if (r.playing) { replayPause(); replayToggle(); } else paintReplay();
  }

  /** Back to the present. rebuild: false when a new load replaces the bars anyway. */
  function replayExit(rebuild = true) {
    const r = state.replay;
    if (!r) return;
    replayPause();
    state.replay = null;
    state.bars = r.all;
    if (rebuild) build(true);
    paintReplay();
  }

  /* ---------- snapshot ---------- */

  const IV_NAMES = { '5m': '5 dk', '15m': '15 dk', '30m': '30 dk', '1h': '1 saat', '4h': '4 saat', '1d': 'Günlük', '1wk': 'Haftalık' };

  /**
   * PNG of the chart under a caption strip (stock, timeframe, last bar, date), downloaded and,
   * where the browser allows it, also copied to the clipboard for pasting into a message.
   */
  function snapshot() {
    const shot = state.chart.takeScreenshot();
    const head = 34 * (window.devicePixelRatio || 1);
    const out = document.createElement('canvas');
    out.width = shot.width;
    out.height = shot.height + head;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#070B14';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(shot, 0, head);
    const b = state.bars[state.bars.length - 1], prev = state.bars[state.bars.length - 2] || b;
    const chg = (b.close / prev.close - 1) * 100;
    const s = head / 34;
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${13 * s}px JetBrains Mono, ui-monospace, monospace`;
    ctx.fillStyle = '#FFFFFF';
    const title = `${state.ticker} · ${IV_NAMES[state.interval]}`;
    ctx.fillText(title, 10 * s, head / 2);
    let x = 10 * s + ctx.measureText(title).width + 12 * s;
    ctx.font = `${12 * s}px JetBrains Mono, ui-monospace, monospace`;
    ctx.fillStyle = chg >= 0 ? COLORS.up : COLORS.down;
    const last = `${fmt2.format(b.close)}  ${chg >= 0 ? '+' : ''}${fmt2.format(chg)}%`;
    ctx.fillText(last, x, head / 2);
    x += ctx.measureText(last).width;
    ctx.fillStyle = COLORS.text;
    const stamp = `ONCAL · ${new Date().toLocaleString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    ctx.textAlign = 'right';
    ctx.fillText(stamp, out.width - 10 * s, head / 2);
    const name = `${state.ticker}-${state.interval}-${new Date().toISOString().slice(0, 10)}.png`;
    out.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      const copy = navigator.clipboard && window.ClipboardItem
        ? navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => true, () => false)
        : Promise.resolve(false);
      copy.then(ok => {
        hint(ok ? 'Görüntü indirildi ve panoya kopyalandı' : 'Görüntü indirildi');
        setTimeout(() => { if (state.tool === 'cursor') hint(''); }, 3000);
      });
    }, 'image/png');
  }

  /* ---------- chart mode (full screen with tools and watchlist) ---------- */

  const isFull = () => !!$('proChartCard') && $('proChartCard').classList.contains('pc-full');
  let drawHome = null;          // where the drawing tools sit outside chart mode
  let cardHome = null;          // where the chart card sits outside chart mode
  let watchTimer = null;

  /** Native full screen where the browser allows it (not iPhone), else the card is just fixed. */
  function setFull(on) {
    const card = $('proChartCard'), tools = $('proChartDraw'), left = $('proChartLeft');
    if (!card || on === isFull()) return;
    // A transformed ancestor would pin a fixed card to itself, not the screen: lift it to <body>
    if (on) {
      cardHome = { parent: card.parentNode, next: card.nextSibling };
      document.body.appendChild(card);
    } else if (cardHome) {
      cardHome.parent.insertBefore(card, cardHome.next);
      cardHome = null;
    }
    card.classList.toggle('pc-full', on);
    document.body.classList.toggle('overflow-hidden', on);
    if (on && tools && left) {
      drawHome = { parent: tools.parentNode, next: tools.nextSibling };
      left.appendChild(tools);
    } else if (drawHome) {
      drawHome.parent.insertBefore(tools, drawHome.next);
      drawHome = null;
    }
    const icon = document.querySelector('#proChartCard [data-pc="full"] i');
    if (icon) icon.className = `fa-solid ${on ? 'fa-compress' : 'fa-expand'} text-[10px]`;
    clearInterval(watchTimer);
    if (on) {
      paintWatch();
      watchTimer = setInterval(paintWatch, 30 * 1000);
      if (card.requestFullscreen && !document.fullscreenElement) card.requestFullscreen().catch(() => { /* fixed layout is enough */ });
    } else if (document.fullscreenElement === card) {
      document.exitFullscreen().catch(() => {});
    }
  }

  /** Another stock from chart mode: the whole stock page follows, so leaving shows the same stock. */
  function goTo(code) {
    if (!code || code === state.ticker) return;
    if (typeof selectStock === 'function') selectStock(code); else load(code);
  }

  const fmtPrice = v => (Number.isFinite(v) ? fmt2.format(v) : '—');

  function watchRow(code) {
    const fin = typeof getOrGenerateStockFinancials === 'function' ? getOrGenerateStockFinancials(code) : null;
    const live = fin && fin.liveTime;
    const price = live ? String(fin.price).replace('₺', '') : '—';
    const tone = !live ? 'text-slate-500' : fin.isPositive ? 'text-emerald-400' : 'text-rose-400';
    const active = code === state.ticker ? 'bg-[#2F6BFF]/15 border-[#2F6BFF]/50' : 'border-transparent hover:bg-[#121C30]';
    return `<li><button type="button" data-pc="go:${code}" class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border ${active} text-left">
        <span class="text-white font-bold">${code}</span>
        <span class="text-right"><span class="text-slate-200 block">${price}</span><span class="${tone} text-[10px]">${live ? fin.change : ''}</span></span>
      </button></li>`;
  }

  function paintWatch() {
    const el = $('proChartWatch');
    if (!el || !isFull()) return;
    const list = typeof getWatchlist === 'function' ? getWatchlist() : [];
    const watched = list.includes(state.ticker);
    const query = $('proChartSymbol') ? $('proChartSymbol').value : '';
    el.innerHTML = `
      <div class="p-2 border-b border-[#1A2540] space-y-2">
        <label class="relative block">
          <i class="fa-solid fa-magnifying-glass absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500"></i>
          <input id="proChartSymbol" type="text" maxlength="30" placeholder="Hisse ara" aria-label="Grafikte açılacak hisse" autocomplete="off"
            class="w-full pl-6 pr-2 py-1 bg-[#070B14] border border-[#1A2540] rounded text-white text-[11px]">
        </label>
        <ul id="proChartSymbolHits" class="space-y-0.5"></ul>
      </div>
      <div class="flex items-center justify-between px-2 pt-2">
        <span class="text-slate-400 text-[10px] uppercase tracking-widest">İzleme listesi</span>
        <button type="button" data-pc="watch" class="px-1.5 py-0.5 rounded border border-[#1A2540] ${watched ? 'text-amber-300' : 'text-slate-400 hover:text-white'}" title="${state.ticker} ${watched ? 'listeden çıkar' : 'listeye ekle'}">
          <i class="fa-${watched ? 'solid' : 'regular'} fa-star text-[10px]"></i></button>
      </div>
      <ul class="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">${list.length ? list.map(watchRow).join('') : '<li class="text-slate-500 px-2">Liste boş; yıldızla ekle.</li>'}</ul>`;
    if (query) { $('proChartSymbol').value = query; paintHits(query); }
  }

  /** Stocks matching the chart-mode search: ticker first, then name. */
  function paintHits(q) {
    const el = $('proChartSymbolHits');
    if (!el) return;
    const n = String(q || '').trim().toLocaleUpperCase('tr-TR');
    if (!n || typeof getFullBistStockList !== 'function') { el.innerHTML = ''; return; }
    const all = getFullBistStockList();
    const rank = s => (s.code === n ? 0 : s.code.startsWith(n) ? 1 : s.code.includes(n) ? 2 : String(s.name || '').toLocaleUpperCase('tr-TR').includes(n) ? 3 : -1);
    const hits = all.map(s => ({ s, r: rank(s) })).filter(x => x.r >= 0)
      .sort((a, b) => a.r - b.r || (b.s.capRaw || 0) - (a.s.capRaw || 0)).slice(0, 8);
    el.innerHTML = hits.length
      ? hits.map(({ s }) => `<li><button type="button" data-pc="go:${s.code}" class="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-[#121C30] text-left">
          <span class="text-white font-bold">${s.code}</span><span class="text-slate-500 truncate">${s.name || ''}</span></button></li>`).join('')
      : '<li class="text-slate-500 px-2">Eşleşme yok</li>';
  }

  /* ---------- keyboard ---------- */

  /** Alt + key picks a drawing tool (e.code, so a Mac's Option characters do not matter). */
  const TOOL_KEYS = { KeyH: 'h', KeyT: 't', KeyF: 'f', KeyY: 'y', KeyR: 'r', KeyC: 'c', KeyN: 'n', KeyM: 'm', KeyA: 'a' };
  const IV_KEYS = Object.keys(INTERVALS);       // 1..7 -> 5dk .. H
  const SHORTCUTS = [
    ['A–Z', 'Hisse ara (yazmaya başla)'],
    ['1 – 7', 'Zaman dilimi: 5dk, 15dk, 30dk, 1s, 4s, G, H'],
    ['Alt + H / T / F', 'Seviye, trend, Fibonacci'],
    ['Alt + Y / R / C', 'Işın, dikdörtgen, kanal'],
    ['Alt + N / M / A', 'Not, ölç, alarm'],
    ['Del', 'Silgi'],
    ['Ctrl + Z', 'Son çizimi geri al'],
    ['Alt + S', 'Grafiği PNG indir'],
    ['Shift + F', 'Grafik modu (tam ekran)'],
    ['Shift + R', 'Bar Replay aç / kapat'],
    ['Boşluk', 'Replay: oynat / duraklat'],
    ['Shift + →', 'Replay: bir mum ileri'],
    ['Esc', 'Aracı ve ölçümü kapat'],
    ['?', 'Bu listeyi aç / kapat']
  ];

  function paintKeys(open) {
    const el = $('proChartKeys');
    if (!el) return;
    el.classList.toggle('hidden', !open);
    if (!open) return;
    el.innerHTML = `
      <div class="flex items-center justify-between gap-3 mb-1.5">
        <span class="text-white font-bold"><i class="fa-solid fa-keyboard text-[10px] mr-1"></i>Kısayollar</span>
        <button type="button" data-pc="keys" class="px-1 text-slate-500 hover:text-white" aria-label="Kısayolları kapat">×</button>
      </div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        ${SHORTCUTS.map(([k, v]) => `<dt class="text-amber-300 whitespace-nowrap">${k}</dt><dd class="text-slate-300">${v}</dd>`).join('')}
      </dl>`;
  }

  /** True while the chart is on screen (its tab open and some of it in view). */
  function chartInView() {
    const el = $('proChart');
    if (!el || !state.chart || !el.clientWidth) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }

  /** Opens the site search with the first letter typed on the chart. */
  function openSearch(letter) {
    // Chart mode covers the site header: its own search box takes the letter
    const input = isFull() ? $('proChartSymbol') : [...document.querySelectorAll('.global-search-input')].find(i => i.offsetParent !== null);
    if (!input) return false;
    input.focus();
    input.value = letter;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function onKey(e) {
    const t = e.target;
    if (e.defaultPrevented || !chartInView()) return;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
    const press = sel => { const b = document.querySelector(`#proChartCard [data-pc="${sel}"]`); if (b) b.click(); };
    let handled = true;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (state.replay && plain && e.code === 'Space') replayToggle();
    else if (state.replay && plain && e.shiftKey && e.key === 'ArrowRight') { replayPause(); replayStep(); }
    else if (plain && e.shiftKey && e.code === 'KeyR') press('replay');
    else if (e.altKey && !e.ctrlKey && !e.metaKey && TOOL_KEYS[e.code]) setTool(state.tool === TOOL_KEYS[e.code] ? 'cursor' : TOOL_KEYS[e.code]);
    else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyS') press('shot');
    else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyZ') {
      if (!state.drawList.length) return;
      press('undo');
    } else if (e.ctrlKey || e.metaKey || e.altKey) handled = false;
    else if (e.key === 'Delete') setTool(state.tool === 'x' ? 'cursor' : 'x');
    else if (e.key === '?') paintKeys($('proChartKeys') && $('proChartKeys').classList.contains('hidden'));
    else if (e.shiftKey && e.code === 'KeyF') press('full');
    else if (/^[1-7]$/.test(e.key)) press(`iv:${IV_KEYS[Number(e.key) - 1]}`);
    else if (e.key.length === 1 && /\p{L}/u.test(e.key)) handled = openSearch(e.key.toLocaleUpperCase('tr-TR'));
    else handled = false;
    if (handled) e.preventDefault();
  }

  /* ---------- build ---------- */

  /** (Re)creates the chart. With keepView the visible window survives the rebuild. */
  function build(keepView = false) {
    const el = $('proChart');
    if (!el || !state.bars || !L) return;
    const view = keepView && state.chart ? state.chart.timeScale().getVisibleLogicalRange() : null;
    if (state.chart) state.chart.remove();
    state.legendSeries = [];
    state.binds = [];

    const chart = L.createChart(el, chartOptions());
    const main = bind(addMain(chart), mainData);
    state.chart = chart;
    state.main = main;
    const compared = activeCompare();
    const comparing = compared.length > 0;
    if (comparing) {
      // Each series is rebased to its first visible bar, so the lines start together
      chart.priceScale('right').applyOptions({ mode: L.PriceScaleMode.Percentage });
      const tol = INTERVALS[state.interval].tol;
      compared.forEach(s => {
        const color = COMPARE_COLORS[state.compare.indexOf(s) % COMPARE_COLORS.length];
        const series = bind(chart.addSeries(L.LineSeries, { color, lineWidth: 2, priceLineVisible: false, title: compareLabel(s) }),
          () => alignTo(state.bars, state.compareBars.data[s], tol));
        state.legendSeries.push({ label: compareLabel(s), color, series, compare: true });
      });
    }
    addIndicators(chart, comparing);
    // Levels, drawings and alert lines are prices; in percent mode they would sit in the wrong place
    state.drawList = drawings();
    state.overlay = null;
    if (!comparing) {
      paintDrawings(chart, main);
      paintAlerts(main);
      state.overlay = makeOverlay();
      main.attachPrimitive(state.overlay);
      if (state.on.has('vp')) main.attachPrimitive(makeOverlay(paintProfile, 'bottom'));
    }
    // Backtest trades (only on the stock and timeframe they were computed for) and formula signals,
    // re-set with the bars so a replay never shows an arrow from a bar still hidden
    const markers = L.createSeriesMarkers(main, []);
    const applyMarks = () => {
      const last = state.bars[state.bars.length - 1].time;
      const backtest = state.marks && state.marks.key === viewKey() ? state.marks.list.filter(m => m.time <= last) : [];
      markers.setMarkers([...backtest, ...(comparing ? [] : formulaMarks())].sort((a, b) => a.time - b.time));
    };
    applyMarks();
    state.binds.push(applyMarks);

    chart.subscribeCrosshairMove(param => { paintLegend(param); trackHover(param); emit({ type: 'crosshair', time: param.time ?? null }); });
    // The side charts of a multi-chart layout follow the visible dates
    chart.timeScale().subscribeVisibleTimeRangeChange(range => emit({ type: 'range', range }));
    // The percent base is the first visible bar, so scrolling changes the figures
    if (comparing) chart.timeScale().subscribeVisibleLogicalRangeChange(() => paintLegend(null));
    chart.subscribeClick(onClick);
    // A quick second click elsewhere arrives as a double click, not a click
    // (not for the eraser: one double click would delete two drawings)
    chart.subscribeDblClick(param => { if (state.tool !== 'x') onClick(param); });
    if (view) chart.timeScale().setVisibleLogicalRange(view);
    else if (el.clientWidth) applyRange();
    else {
      // Built inside a hidden tab: the range only sticks once the chart has a width
      const ro = new ResizeObserver(() => {
        if (!el.clientWidth) return;
        ro.disconnect();
        if (state.chart === chart) applyRange();
      });
      ro.observe(el);
    }
    paintLegend(null);
    paintToolbar();
    paintCompare();
  }

  /** New bars every minute while the chart is on screen; series update in place, the view stays. */
  async function refresh() {
    const el = $('proChart');
    if (!state.chart || !state.ticker || document.hidden || !el || !el.clientWidth || state.pending || state.replay) return;
    const { ticker, interval } = state;
    if (state.barsKey !== `${ticker}|${interval}`) return;     // a timeframe or stock is still loading
    let bars, cmp;
    try { [bars, cmp] = await Promise.all([fetchBars(ticker, interval, true), fetchCompare(ticker, interval, true)]); } catch { return; }
    if (ticker !== state.ticker || interval !== state.interval || state.barsKey !== `${ticker}|${interval}` || bars.length < 2) return;
    const a = state.bars[state.bars.length - 1], b = bars[bars.length - 1];
    if (bars.length === state.bars.length && a.time === b.time && a.close === b.close && a.volume === b.volume) return;
    state.bars = bars;
    // Keep a compared symbol's old bars if its refresh failed; the series list must not change here
    activeCompare().forEach(s => { if (cmp[s] && cmp[s].length) state.compareBars.data[s] = cmp[s]; });
    state.binds.forEach(apply => apply());
    paintLegend(null);
  }

  let wired = false;

  /**
   * Loads and shows the chart for a stock in the current timeframe. Returns false when no
   * price history is available. reframe: show the timeframe's default window, not the old one.
   */
  async function load(ticker, { reframe = false } = {}) {
    if (!L || !window.TechData) return false;
    if (!wired) {
      const bar = $('proChartToolbar');
      if (bar) bar.addEventListener('click', onToolbar);
      // Chart mode moves the drawing tools here
      const left = $('proChartLeft');
      if (left) left.addEventListener('click', onToolbar);
      const panel = $('proChartSettings');
      if (panel) {
        panel.addEventListener('click', onToolbar);
        panel.addEventListener('input', onSettingsInput);
      }
      const cmp = $('proChartCompare');
      if (cmp) {
        cmp.addEventListener('click', onToolbar);
        cmp.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'proChartCompareInput') addCompare(e.target.value); });
      }
      // Capture phase: the site's own shortcuts stop Escape before it bubbles up
      document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (state.tool === 'cursor' && !state.measure) {
          // Native full screen exits on Esc by itself; the fixed fallback needs this
          if (isFull() && !document.fullscreenElement && !(e.target && e.target.id === 'proChartSymbol')) setFull(false);
          return;
        }
        state.measure = null;
        setTool('cursor');
      }, true);
      document.addEventListener('keydown', onKey);
      // Esc or the browser's own control left full screen: leave chart mode as well
      document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && isFull()) setFull(false); });
      const replay = $('proChartReplay');
      if (replay) replay.addEventListener('click', onToolbar);
      const formula = $('proChartFormula');
      if (formula) {
        formula.addEventListener('click', onToolbar);
        // A formula applies when its field is left or Enter is pressed, not on every keystroke
        formula.addEventListener('change', e => {
          const i = e.target.dataset.pcFormula ?? e.target.dataset.pcFormulaPane;
          if (i == null) return;
          const list = state.formulas.map(f => ({ ...f }));
          if (e.target.dataset.pcFormula != null) list[i].expr = e.target.value.trim();
          else list[i].pane = e.target.checked;
          saveFormulas(list);
        });
        formula.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.pcFormula != null) e.target.blur(); });
      }
      const keys = $('proChartKeys');
      if (keys) keys.addEventListener('click', e => { if (e.target.closest('[data-pc="keys"]')) paintKeys(false); });
      const watch = $('proChartWatch');
      if (watch) {
        watch.addEventListener('click', onToolbar);
        watch.addEventListener('input', e => { if (e.target.id === 'proChartSymbol') paintHits(e.target.value); });
        watch.addEventListener('keydown', e => {
          if (e.target.id !== 'proChartSymbol') return;
          if (e.key === 'Enter') { const first = watch.querySelector('#proChartSymbolHits [data-pc]'); if (first) first.click(); }
          if (e.key === 'Escape') { e.target.value = ''; paintHits(''); e.target.blur(); }
        });
      }
      window.addEventListener('verity:data', e => { if (e.detail === 'watchlist') paintWatch(); });
      setInterval(refresh, REFRESH_MS);
      // Alert added, deleted or triggered anywhere on the site: redraw the alert lines
      window.addEventListener('verity:alerts', () => { if (state.chart && state.pending == null) build(true); });
      wired = true;
    }
    const id = ++state.request;
    const interval = state.interval;
    hint('Yükleniyor...');
    const comparePromise = fetchCompare(ticker, interval);
    let bars;
    try {
      bars = await fetchBars(ticker, interval);
    } catch (e) {
      if (id === state.request) {
        hint(state.ticker === ticker ? 'Bu zaman dilimi için veri alınamadı' : '');
        setTimeout(() => { if (id === state.request && state.tool === 'cursor') hint(''); }, 4000);
      }
      console.warn('[ProChart] history unavailable:', e.message);
      return false;
    }
    const compareData = await comparePromise;
    if (id !== state.request) return false;
    hint('');
    if (bars.length < 2) return false;
    replayExit(false);
    const changed = state.ticker !== ticker;
    state.ticker = ticker;
    state.bars = bars;
    state.barsKey = `${ticker}|${interval}`;
    state.compareBars = { key: state.barsKey, data: compareData };
    if (changed) setTool('cursor');
    build(!changed && !reframe);
    ensureCompare();
    if (changed) paintWatch();
    window.dispatchEvent(new CustomEvent('verity:chart', { detail: { ticker, interval } }));
    return true;
  }

  /**
   * What the chart shows now, for the backtest: stock, timeframe and its bars. While a new
   * timeframe is loading this still describes the bars on screen; loading is true then.
   */
  function current() {
    if (!state.bars) return null;
    const [ticker, interval] = state.barsKey.split('|');
    return { ticker, interval, key: state.barsKey, bars: state.bars, loading: state.barsKey !== `${state.ticker}|${state.interval}` };
  }

  /** Trade markers on the price ([{ time, position, shape, color, text }]); null clears them. */
  function setMarkers(key, list) {
    state.marks = list && list.length ? { key, list } : null;
    if (state.chart) build(true);
  }

  /** View changes of the main chart ({ type: 'crosshair', time } or { type: 'range', range }). */
  const viewListeners = new Set();
  function emit(e) { viewListeners.forEach(fn => { try { fn(e); } catch (err) { console.warn('[ProChart] listener:', err); } }); }
  function subscribe(fn) { viewListeners.add(fn); return () => viewListeners.delete(fn); }

  /** Every chart key of this browser ({ 'drawings.THYAO': [...], interval: '1d', ... }) for account sync. */
  function exportData() {
    const out = {};
    try {
      Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => {
        try { out[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k)); } catch { /* not ours */ }
      });
    } catch { /* storage blocked */ }
    return out;
  }

  /**
   * Takes the chart keys of another device: drawings of stocks it does not have are removed (they
   * were deleted there), everything it has replaces ours. Written without announcing a change.
   */
  function importData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(`${PREFIX}drawings.`) && !(k.slice(PREFIX.length) in data))
        .forEach(k => localStorage.removeItem(k));
      Object.entries(data).forEach(([k, v]) => localStorage.setItem(PREFIX + k, JSON.stringify(v)));
    } catch { return; }
    state.type = store.get('type', 'candle');
    state.on = new Set(store.get('indicators', DEFAULT_ON));
    state.cfg = cleanSettings(store.get('settings', {}));
    state.compare = store.get('compare', []).filter(s => /^[A-Z0-9]{2,8}$/.test(s)).slice(0, MAX_COMPARE);
    state.formulas = cleanFormulas(store.get('formulas', []));
    paintFormulas();
    if (window.ProChartMulti) ProChartMulti.refresh();
    if (state.chart && state.pending == null) build(true);
  }

  /** Visible date range of the main chart, or null before it is built. */
  const visibleRange = () => (state.chart ? state.chart.timeScale().getVisibleRange() : null);

  /** Vertical position (px inside the chart) of a price on the price pane, or null. */
  const priceToY = price => (state.main ? state.main.priceToCoordinate(price) : null);

  return { load, current, setMarkers, priceToY, subscribe, exportData, importData, visibleRange, fetchBars, chartOptions, COLORS, heikinAshi, toBars, groupBars, startIndex, snapTime, cleanSettings, indLabel, alignTo, rayEnd, measureLabel, volumeProfile };
})();

window.ProChart = ProChart;
