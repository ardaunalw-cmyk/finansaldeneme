/**
 * Interactive price chart on the stock page, built on TradingView Lightweight Charts
 * (assets/lib/lightweight-charts-*, Apache-2.0; the attribution logo stays on as the licence asks).
 *
 * Real bars from /api/history (Yahoo Finance, delayed) in seven timeframes, from 5-minute to
 * weekly; 4-hour bars are built here from hourly ones. Times are shifted to Istanbul time so
 * the axis reads like the exchange clock. Indicators are the pure functions in indicators.js;
 * oscillators get their own panes under the price. Drawings (horizontal level, trend line,
 * Fibonacci) are kept per stock in this browser only and follow the stock across timeframes.
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
  const INTERVALS = {
    '5m': { api: '5m', range: '60d', intraday: true, view: '1G' },
    '15m': { api: '15m', range: '60d', intraday: true, view: '5G' },
    '30m': { api: '30m', range: '60d', intraday: true, view: '5G' },
    '1h': { api: '60m', range: '2y', intraday: true, view: '1A' },
    '4h': { api: '60m', range: '2y', intraday: true, view: '3A', group: 4 },
    '1d': { api: '1d', range: '5y', view: '6A' },
    '1wk': { api: '1wk', range: '10y', view: '5Y' }
  };
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
    rsi: { label: 'RSI 14', color: COLORS.brand, pane: true },
    macd: { label: 'MACD', color: COLORS.sky, pane: true },
    stoch: { label: 'Stokastik', color: COLORS.sky, pane: true }
  };
  const DEFAULT_ON = ['sma20', 'sma50', 'sma200', 'volume', 'rsi'];

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(`verity.chart.${key}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(`verity.chart.${key}`, JSON.stringify(value)); } catch { /* private mode: keep in memory only */ } }
  };

  const savedInterval = store.get('interval', '1d');
  const savedRange = store.get('range', '6A');
  const state = {
    ticker: null,
    bars: null,                 // [{ time, open, high, low, close, volume }], time in Istanbul-local seconds
    interval: INTERVALS[savedInterval] ? savedInterval : '1d',
    type: store.get('type', 'candle'),
    on: new Set(store.get('indicators', DEFAULT_ON)),
    range: SPANS[savedRange] ? savedRange : '6A',
    tool: 'cursor',
    pending: null,              // first click of a two-point drawing
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

  function addIndicators(chart) {
    const closes = () => state.bars.map(b => b.close);
    const highs = () => state.bars.map(b => b.high);
    const lows = () => state.bars.map(b => b.low);
    const overlay = (key, compute, opts = {}) =>
      bind(chart.addSeries(L.LineSeries, { color: INDICATORS[key].color, lineWidth: 1.5, ...quiet, ...opts }), () => line(compute()));
    const legend = (label, color, series) => state.legendSeries.push({ label, color, series });

    [['sma20', 20], ['sma50', 50], ['sma200', 200]].forEach(([key, n]) => {
      if (state.on.has(key)) legend(INDICATORS[key].label, INDICATORS[key].color, overlay(key, () => Ind.sma(closes(), n), n === 200 ? { lineStyle: L.LineStyle.Dashed } : {}));
    });
    [['ema9', 9], ['ema21', 21]].forEach(([key, n]) => {
      if (state.on.has(key)) legend(INDICATORS[key].label, INDICATORS[key].color, overlay(key, () => Ind.ema(closes(), n)));
    });
    if (state.on.has('bb')) {
      overlay('bb', () => Ind.bollinger(closes()).upper, { lineStyle: L.LineStyle.Dotted });
      legend('BB orta', COLORS.slate, overlay('bb', () => Ind.bollinger(closes()).mid, { lineWidth: 1 }));
      overlay('bb', () => Ind.bollinger(closes()).lower, { lineStyle: L.LineStyle.Dotted });
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
      const s = paneLine(COLORS.brand, () => Ind.rsi(closes()));
      guide(s, 70, COLORS.down); guide(s, 30, COLORS.up);
      legend('RSI', COLORS.brand, s);
    }
    if (state.on.has('macd')) {
      pane++;
      const hist = chart.addSeries(L.HistogramSeries, { ...quiet }, pane);
      bind(hist, () => line(Ind.macd(closes()).histogram).map(p => ({ ...p, color: p.value >= 0 ? COLORS.upSoft : COLORS.downSoft })));
      const ml = paneLine(COLORS.sky, () => Ind.macd(closes()).line);
      const sl = paneLine(COLORS.amber, () => Ind.macd(closes()).signal);
      legend('MACD', COLORS.sky, ml); legend('Sinyal', COLORS.amber, sl);
    }
    if (state.on.has('stoch')) {
      pane++;
      const k = paneLine(COLORS.sky, () => Ind.stochastic(highs(), lows(), closes()).k);
      const d = paneLine(COLORS.violet, () => Ind.stochastic(highs(), lows(), closes()).d);
      guide(k, 80, COLORS.down); guide(k, 20, COLORS.up);
      legend('%K', COLORS.sky, k); legend('%D', COLORS.violet, d);
    }
    // Price pane keeps most of the height; each oscillator pane gets a share of it
    chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
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

  function onClick(param) {
    if (state.tool === 'cursor' || !param.point || param.time == null) return;
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
    if (state.tool === 'h') {
      list.push({ type: 'h', price: point.price });
    } else if (!state.pending) {
      state.pending = point;
      hint(state.tool === 't' ? 'Trend çizgisi: ikinci noktaya tıkla' : 'Fibonacci: ikinci noktaya (diğer uç) tıkla');
      return;
    } else {
      if (state.pending.time === point.time) return;      // same bar: wait for a real second point
      list.push({ type: state.tool, a: state.pending, b: point });
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
    const values = state.legendSeries.map(({ label, color, series }) => {
      const p = param && param.seriesData ? param.seriesData.get(series) : null;
      const data = series.data();
      const v = p ? p.value : data.length ? data[data.length - 1].value : null;
      if (v == null) return '';
      return `<span style="color:${color}">${label} ${label === 'Hacim' ? fmtVol(v) : fmt2.format(v)}</span>`;
    }).filter(Boolean).join(' ');
    el.innerHTML = `
      <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span class="text-white font-bold">${state.ticker}</span><span class="text-slate-500">${when}</span>
        <span>A <b class="${tone}">${fmt2.format(b.open)}</b></span>
        <span>Y <b class="${tone}">${fmt2.format(b.high)}</b></span>
        <span>D <b class="${tone}">${fmt2.format(b.low)}</b></span>
        <span>K <b class="${tone}">${fmt2.format(b.close)}</b></span>
        <b class="${chg >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${chg >= 0 ? '+' : ''}${fmt2.format(chg)}%</b>
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
    hint({
      h: 'Yatay seviye: fiyata tıkla',
      t: 'Trend çizgisi: ilk noktaya tıkla',
      f: 'Fibonacci: dip ya da zirveye tıkla',
      a: 'Alarm: hedef fiyata tıkla'
    }[tool] || '');
    paintToolbar();
  }

  function paintToolbar() {
    const on = 'bg-[#2F6BFF] text-white border-[#2F6BFF]';
    const off = 'text-slate-400 border-[#1A2540] hover:text-white';
    document.querySelectorAll('#proChartToolbar [data-pc]').forEach(btn => {
      const [kind, value] = btn.dataset.pc.split(':');
      const active = (kind === 'iv' && state.interval === value) || (kind === 'range' && state.range === value)
        || (kind === 'type' && state.type === value) || (kind === 'ind' && state.on.has(value)) || (kind === 'tool' && state.tool === value);
      if (['iv', 'range', 'type', 'ind', 'tool'].includes(kind)) {
        btn.className = `px-2 py-0.5 rounded-md border text-[11px] font-semibold transition-all ${active ? on : off}`;
        btn.setAttribute('aria-pressed', String(active));
      }
    });
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
    if (kind === 'undo') { const list = drawings(); list.pop(); saveDrawings(list); build(true); return; }
    if (kind === 'clear') { saveDrawings([]); build(true); return; }
    if (kind === 'shot' && state.chart) {
      const a = document.createElement('a');
      a.href = state.chart.takeScreenshot().toDataURL('image/png');
      a.download = `${state.ticker}-${state.interval}-grafik.png`;
      a.click();
      return;
    }
    if (kind === 'full') {
      const card = $('proChartCard');
      if (document.fullscreenElement) document.exitFullscreen();
      else if (card && card.requestFullscreen) card.requestFullscreen();
    }
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
    addIndicators(chart);
    paintDrawings(chart, main);
    paintAlerts(main);
    // Backtest trades, only on the stock and timeframe they were computed for
    if (state.marks && state.marks.key === viewKey()) L.createSeriesMarkers(main, state.marks.list);

    chart.subscribeCrosshairMove(paintLegend);
    chart.subscribeClick(onClick);
    // A quick second click elsewhere arrives as a double click, not a click
    chart.subscribeDblClick(onClick);
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
  }

  /** New bars every minute while the chart is on screen; series update in place, the view stays. */
  async function refresh() {
    const el = $('proChart');
    if (!state.chart || !state.ticker || document.hidden || !el || !el.clientWidth || state.pending) return;
    const { ticker, interval } = state;
    if (state.barsKey !== `${ticker}|${interval}`) return;     // a timeframe or stock is still loading
    let bars;
    try { bars = await fetchBars(ticker, interval, true); } catch { return; }
    if (ticker !== state.ticker || interval !== state.interval || state.barsKey !== `${ticker}|${interval}` || bars.length < 2) return;
    const a = state.bars[state.bars.length - 1], b = bars[bars.length - 1];
    if (bars.length === state.bars.length && a.time === b.time && a.close === b.close && a.volume === b.volume) return;
    state.bars = bars;
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
      // Capture phase: the site's own shortcuts stop Escape before it bubbles up
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.tool !== 'cursor') setTool('cursor'); }, true);
      setInterval(refresh, REFRESH_MS);
      // Alert added, deleted or triggered anywhere on the site: redraw the alert lines
      window.addEventListener('verity:alerts', () => { if (state.chart && state.pending == null) build(true); });
      wired = true;
    }
    const id = ++state.request;
    const interval = state.interval;
    hint('Yükleniyor...');
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
    if (id !== state.request) return false;
    hint('');
    if (bars.length < 2) return false;
    const changed = state.ticker !== ticker;
    state.ticker = ticker;
    state.bars = bars;
    state.barsKey = `${ticker}|${interval}`;
    if (changed) setTool('cursor');
    build(!changed && !reframe);
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

  return { load, current, setMarkers, heikinAshi, toBars, groupBars, startIndex, snapTime };
})();

window.ProChart = ProChart;
