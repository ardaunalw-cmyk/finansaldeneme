/**
 * "Strateji Testi" card on the technical tab: runs backtest.js on the bars the price chart
 * shows (same stock and timeframe), then shows the summary, the equity curve against buy and
 * hold, the trade list, and the trades as markers on the price chart.
 */
const BacktestUI = (() => {
  const COLORS = { strategy: '#2F6BFF', benchmark: '#D97706', text: '#94A3B8', grid: '#152038', border: '#1E2B45', up: '#10B981', down: '#F43F5E' };
  const IV_LABEL = { '5m': '5 dakikalık', '15m': '15 dakikalık', '30m': '30 dakikalık', '1h': 'Saatlik', '4h': '4 saatlik', '1d': 'Günlük', '1wk': 'Haftalık' };
  const REASON = { signal: 'Sinyal', stop: 'Zarar-kes', target: 'Kâr-al', open: 'Açık (son fiyat)' };
  const STORE_KEY = 'verity.backtest';

  const fmt2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
  const $ = id => document.getElementById(id);
  const pct = v => (v == null ? '—' : `${v >= 0 ? '+' : '-'}%${fmt2.format(Math.abs(v * 100))}`);
  const plainPct = v => (v == null ? '—' : `%${fmt2.format(v * 100)}`);
  const tone = v => (v == null ? 'text-slate-300' : v >= 0 ? 'text-emerald-400' : 'text-rose-400');
  const money = v => `₺${fmt0.format(v)}`;

  const store = {
    get() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } },
    set(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* settings just aren't remembered */ } }
  };

  let equityChart = null;
  let last = null;         // { key, interval, result }

  /* ---------- form ---------- */

  const FORMULA_DEFAULTS = { entry: 'crossover(ema(close, 9), ema(close, 21))', exit: 'crossunder(ema(close, 9), ema(close, 21))' };

  function paintParams(strategy, values = {}) {
    const def = Backtest.STRATEGIES[strategy];
    $('btDesc').textContent = def.desc;
    if (def.formulas) {
      const f = { ...FORMULA_DEFAULTS, ...(store.get().formula || {}) };
      const field = (key, label) => `
        <label class="block col-span-full">
          <span class="text-[10px] text-slate-400 block mb-1">${label}</span>
          <input type="text" data-bt-formula="${key}" maxlength="300" spellcheck="false" autocomplete="off"
            class="w-full px-2.5 py-1.5 bg-[#070B14] border border-[#1A2540] rounded-lg text-white text-xs font-mono">
        </label>`;
      $('btParams').innerHTML = `${field('entry', 'Giriş koşulu (doğru olunca al)')}${field('exit', 'Çıkış koşulu (doğru olunca sat)')}
        <p class="col-span-full text-[10px] text-slate-500 font-mono leading-relaxed">
          Değerler: open high low close volume · Fonksiyonlar: ${Object.keys(Formula.FUNCTIONS).join(', ')} · Bağlaçlar: and or not (ve veya değil)
        </p>`;
      // Set as values, not markup: the saved text is the viewer's own input
      $('btParams').querySelector('[data-bt-formula="entry"]').value = f.entry;
      $('btParams').querySelector('[data-bt-formula="exit"]').value = f.exit;
      return;
    }
    $('btParams').innerHTML = def.params.map(p => `
      <label class="block">
        <span class="text-[10px] text-slate-400 block mb-1">${p.label}</span>
        <input type="number" data-bt-param="${p.key}" value="${values[p.key] ?? p.def}" min="${p.min}" max="${p.max}" step="${p.step || 1}"
          class="w-full px-2.5 py-1.5 bg-[#070B14] border border-[#1A2540] rounded-lg text-white text-xs font-mono">
      </label>`).join('');
  }

  function readForm() {
    const strategy = $('btStrategy').value;
    const params = {};
    document.querySelectorAll('#btParams [data-bt-param]').forEach(el => { params[el.dataset.btParam] = parseFloat(el.value); });
    const num = id => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
    const text = key => { const el = document.querySelector(`#btParams [data-bt-formula="${key}"]`); return el ? el.value.trim() : ''; };
    return {
      strategy,
      formula: Backtest.STRATEGIES[strategy].formulas ? { entry: text('entry'), exit: text('exit') } : null,
      params: Backtest.cleanParams(strategy, params),
      commission: Math.max(0, num('btCommission') ?? 0),
      stopLoss: num('btStop'),
      takeProfit: num('btTarget'),
      capital: num('btCapital') || 100000
    };
  }

  /** Inputs that make a strategy meaningless; null when they are fine. */
  function formError(f) {
    if (['sma_cross', 'ema_cross', 'macd'].includes(f.strategy) && f.params.fast >= f.params.slow) return 'Hızlı periyot yavaş periyottan küçük olmalı.';
    if (f.strategy === 'rsi' && f.params.low >= f.params.high) return 'Alt eşik üst eşikten küçük olmalı.';
    if (f.formula) {
      const entry = Formula.check(f.formula.entry, 'condition'), exit = Formula.check(f.formula.exit, 'condition');
      if (entry) return `Giriş formülü: ${entry}`;
      if (exit) return `Çıkış formülü: ${exit}`;
    }
    if (f.stopLoss != null && (f.stopLoss <= 0 || f.stopLoss >= 100)) return 'Zarar-kes 0 ile 100 arasında bir yüzde olmalı.';
    if (f.takeProfit != null && f.takeProfit <= 0) return 'Kâr-al sıfırdan büyük bir yüzde olmalı.';
    if (f.commission >= 5) return 'Komisyon yüzde olarak girilir (ör. 0,1).';
    return null;
  }

  /* ---------- results ---------- */

  function tile(label, value, sub, valueClass = 'text-white') {
    return `
      <div class="p-3 rounded-xl bg-[#070B14] border border-[#1A2540] min-w-0">
        <div class="text-[10px] font-mono text-slate-400 uppercase tracking-wide">${label}</div>
        <div class="text-lg font-mono font-bold mt-0.5 ${valueClass}">${value}</div>
        ${sub ? `<div class="text-[10px] font-mono text-slate-500 mt-0.5">${sub}</div>` : ''}
      </div>`;
  }

  function when(time, intraday) {
    // Bar times are Istanbul-local seconds (see pro-chart.js), so format them as UTC
    return new Date(time * 1000).toLocaleString('tr-TR', intraday
      ? { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
      : { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  }

  function paintSummary(r) {
    const s = r.stats;
    const beat = s.totalReturn - s.bhReturn;
    $('btSummary').innerHTML = [
      tile('Strateji getirisi', pct(s.totalReturn), `${money(r.capital)} → ${money(s.finalValue)}`, tone(s.totalReturn)),
      tile('Al ve tut', pct(s.bhReturn), `Fark ${beat >= 0 ? '+' : '-'}${fmt2.format(Math.abs(beat * 100))} puan`, tone(s.bhReturn)),
      tile('Yıllık getiri', pct(s.annualReturn), s.annualReturn == null ? '3 aydan kısa dönem' : `Al-tut ${pct(s.bhAnnualReturn)}`, tone(s.annualReturn)),
      tile('En büyük düşüş', pct(s.maxDrawdown), `Al-tut ${pct(s.bhMaxDrawdown)}`, 'text-rose-400'),
      tile('İşlem', fmt0.format(s.trades), s.winRate == null ? 'İşlem yok' : `Kazanan ${plainPct(s.winRate)}`),
      tile('Kâr faktörü', s.profitFactor == null ? '—' : fmt2.format(s.profitFactor), 'Kazanç / kayıp (TL)'),
      tile('Ortalama işlem', pct(s.avgTrade), s.trades ? `En iyi ${pct(s.bestTrade)} · en kötü ${pct(s.worstTrade)}` : '', tone(s.avgTrade)),
      tile('Piyasada kalma', plainPct(s.exposure), s.avgBars == null ? '' : `İşlem başına ~${fmt0.format(s.avgBars)} mum`),
      tile('Sharpe', s.sharpe == null ? '—' : fmt2.format(s.sharpe), 'Risksiz faiz 0 kabul edildi')
    ].join('');
  }

  function paintTrades(r, intraday) {
    const rows = r.trades.slice().reverse().map((t, i) => `
      <tr class="border-t border-[#162238]">
        <td class="py-1.5 pr-2 text-slate-500">${r.trades.length - i}</td>
        <td class="py-1.5 pr-2 whitespace-nowrap">${when(t.entryTime, intraday)}</td>
        <td class="py-1.5 pr-2 text-right">${fmt2.format(t.entryPrice)}</td>
        <td class="py-1.5 pr-2 whitespace-nowrap">${when(t.exitTime, intraday)}</td>
        <td class="py-1.5 pr-2 text-right">${fmt2.format(t.exitPrice)}</td>
        <td class="py-1.5 pr-2 text-right font-bold ${tone(t.ret)}">${pct(t.ret)}</td>
        <td class="py-1.5 pr-2 text-right text-slate-400">${t.bars}</td>
        <td class="py-1.5 text-slate-400 whitespace-nowrap">${REASON[t.reason]}</td>
      </tr>`).join('');
    $('btTrades').innerHTML = rows
      ? `<table class="w-full text-[11px] font-mono text-slate-200">
          <thead class="text-[10px] text-slate-400 text-left sticky top-0 bg-[#0C1322]">
            <tr><th class="py-1.5 pr-2">#</th><th class="py-1.5 pr-2">Giriş</th><th class="py-1.5 pr-2 text-right">Fiyat</th><th class="py-1.5 pr-2">Çıkış</th><th class="py-1.5 pr-2 text-right">Fiyat</th><th class="py-1.5 pr-2 text-right">Getiri</th><th class="py-1.5 pr-2 text-right">Mum</th><th class="py-1.5">Neden</th></tr>
          </thead><tbody>${rows}</tbody></table>`
      : '<p class="py-4 text-center text-slate-500 text-xs font-mono">Bu dönemde stratejinin hiç alım sinyali yok.</p>';
  }

  function paintEquity(r, intraday) {
    const L = window.LightweightCharts;
    const el = $('btEquity');
    if (!L || !el) return;
    if (equityChart) equityChart.remove();
    equityChart = L.createChart(el, {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: COLORS.text, fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border, timeVisible: intraday, secondsVisible: false },
      crosshair: { mode: L.CrosshairMode.Normal },
      localization: { locale: 'tr-TR', priceFormatter: p => fmt0.format(p) }
    });
    const strat = equityChart.addSeries(L.LineSeries, { color: COLORS.strategy, lineWidth: 2, priceLineVisible: false });
    strat.setData(r.equity);
    const bh = equityChart.addSeries(L.LineSeries, { color: COLORS.benchmark, lineWidth: 2, lineStyle: L.LineStyle.Dashed, priceLineVisible: false });
    bh.setData(r.benchmark);
    equityChart.timeScale().fitContent();

    const legend = param => {
      const at = series => {
        const p = param && param.seriesData ? param.seriesData.get(series) : null;
        if (p) return p.value;
        const d = series.data();
        return d[d.length - 1].value;
      };
      const time = param && param.time != null ? param.time : r.equity[r.equity.length - 1].time;
      const s = at(strat), b = at(bh);
      $('btEquityLegend').innerHTML = `
        <span class="text-slate-500">${when(time, intraday)}</span>
        <span class="flex items-center gap-1.5"><span class="inline-block w-4 h-0.5 rounded" style="background:${COLORS.strategy}"></span><span class="text-slate-300">Strateji</span> <b class="text-white">${money(s)}</b> <span class="${tone(s / r.capital - 1)}">${pct(s / r.capital - 1)}</span></span>
        <span class="flex items-center gap-1.5"><span class="inline-block w-4 border-t-2 border-dashed" style="border-color:${COLORS.benchmark}"></span><span class="text-slate-300">Al ve tut</span> <b class="text-white">${money(b)}</b> <span class="${tone(b / r.capital - 1)}">${pct(b / r.capital - 1)}</span></span>`;
    };
    equityChart.subscribeCrosshairMove(legend);
    legend(null);
  }

  function markersFor(r) {
    const list = [];
    r.trades.forEach(t => {
      list.push({ time: t.entryTime, position: 'belowBar', shape: 'arrowUp', color: COLORS.up, text: 'AL' });
      if (t.reason !== 'open') list.push({ time: t.exitTime, position: 'aboveBar', shape: 'arrowDown', color: COLORS.down, text: t.reason === 'stop' ? 'STOP' : t.reason === 'target' ? 'HEDEF' : 'SAT' });
    });
    return list.sort((a, b) => a.time - b.time);
  }

  function syncMarkers() {
    if (!window.ProChart) return;
    const on = $('btShowMarkers') && $('btShowMarkers').checked && last;
    ProChart.setMarkers(on ? last.key : null, on ? markersFor(last.result) : null);
  }

  function paintContext() {
    const el = $('btContext');
    const cur = window.ProChart && ProChart.current();
    if (!el) return;
    if (!cur) { el.textContent = 'Grafik yükleniyor...'; return; }
    const first = cur.bars[0].time, lastT = cur.bars[cur.bars.length - 1].time;
    el.textContent = `${cur.ticker} · ${IV_LABEL[cur.interval]} · ${fmt0.format(cur.bars.length)} mum · ${when(first, false)} – ${when(lastT, false)}`;
    const stale = $('btStale');
    if (stale) stale.classList.toggle('hidden', !last || last.key === cur.key);
  }

  /* ---------- run ---------- */

  function runNow() {
    const cur = window.ProChart && ProChart.current();
    const msg = $('btMessage');
    msg.textContent = '';
    if (!cur || cur.loading) { msg.textContent = 'Önce fiyat grafiğinin yüklenmesini bekle.'; return; }
    const form = readForm();
    const error = formError(form);
    if (error) { msg.textContent = error; return; }
    // Remember the inputs, keeping the parameters of the other strategies too
    const saved = store.get();
    store.set({
      strategy: form.strategy,
      params: { ...(saved.params || {}), [form.strategy]: form.params },
      formula: form.formula || saved.formula,
      commission: form.commission, stopLoss: form.stopLoss, takeProfit: form.takeProfit, capital: form.capital
    });

    const result = Backtest.run(cur.bars, form.strategy, {
      params: form.params,
      formula: form.formula,
      commission: form.commission / 100,
      stopLoss: form.stopLoss != null ? form.stopLoss / 100 : null,
      takeProfit: form.takeProfit != null ? form.takeProfit / 100 : null,
      capital: form.capital
    });
    if (!result.ok) { msg.textContent = result.reason; return; }
    last = { key: cur.key, interval: cur.interval, result };
    const intraday = !['1d', '1wk'].includes(cur.interval);
    $('btResult').classList.remove('hidden');
    paintSummary(result);
    paintEquity(result, intraday);
    paintTrades(result, intraday);
    paintContext();
    syncMarkers();
  }

  function init() {
    const sel = $('btStrategy');
    if (!sel || !window.Backtest) return;
    const saved = store.get();
    sel.innerHTML = Object.entries(Backtest.STRATEGIES).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('');
    if (saved.strategy && Backtest.STRATEGIES[saved.strategy]) sel.value = saved.strategy;
    const savedParams = saved.params || {};
    paintParams(sel.value, savedParams[sel.value]);
    if (saved.commission != null) $('btCommission').value = saved.commission;
    if (saved.stopLoss != null) $('btStop').value = saved.stopLoss;
    if (saved.takeProfit != null) $('btTarget').value = saved.takeProfit;
    if (saved.capital) $('btCapital').value = saved.capital;

    sel.addEventListener('change', () => paintParams(sel.value, (store.get().params || {})[sel.value]));
    $('btRun').addEventListener('click', runNow);
    $('btShowMarkers').addEventListener('change', syncMarkers);
    window.addEventListener('verity:chart', () => {
      paintContext();
      // Another stock: an old result says nothing about it
      const cur = ProChart.current();
      if (last && cur && last.key.split('|')[0] !== cur.ticker) {
        last = null;
        $('btResult').classList.add('hidden');
        if (equityChart) { equityChart.remove(); equityChart = null; }
        ProChart.setMarkers(null, null);
      }
    });
    paintContext();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { run: runNow };
})();

window.BacktestUI = BacktestUI;
