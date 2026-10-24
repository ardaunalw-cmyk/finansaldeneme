/**
 * Strateji Laboratuvarı: one strategy of the backtester (backtest.js, formula strategies too) run
 * over a whole group of stocks at once (BIST 30, or the 50 / 100 largest by market value) on
 * daily bars, then ranked: each stock's return against buy and hold, trades, hit rate, drawdown,
 * and the group's median and how many stocks the strategy beat buy and hold on.
 */
const StrategyLab = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CONCURRENCY = 5;
  const RANGES = { '1y': '1 yıl', '2y': '2 yıl', '5y': '5 yıl' };

  const pct = v => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}%` : '—');
  const tone = v => (!Number.isFinite(v) ? 'text-slate-400' : v >= 0 ? 'text-emerald-400' : 'text-rose-400');

  /** Median of the finite values; null for none. */
  function median(values) {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return null;
    return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  }

  /** Group figures from per-stock results ({ ok, stats }). */
  function aggregate(results) {
    const ok = results.filter(r => r.ok);
    const beat = ok.filter(r => r.stats.totalReturn > r.stats.bhReturn).length;
    return {
      n: ok.length,
      median: median(ok.map(r => r.stats.totalReturn)),
      bhMedian: median(ok.map(r => r.stats.bhReturn)),
      beat: ok.length ? beat / ok.length : null,
      positive: ok.length ? ok.filter(r => r.stats.totalReturn > 0).length / ok.length : null,
      trades: ok.reduce((s, r) => s + r.stats.trades, 0)
    };
  }

  /** The stocks of a universe: BIST 30, or the n largest listed companies by market value. */
  async function universe(kind) {
    const all = typeof getFullBistStockList === 'function' ? getFullBistStockList() : [];
    if (kind === 'bist30') return all.filter(c => c.isBist30).map(c => c.code);
    let listed = null;
    try { listed = new Set(Object.keys((await (await fetch('/assets/data/technicals.json')).json()).data)); } catch { /* every company */ }
    const n = kind === 'top100' ? 100 : 50;
    return all.filter(c => !listed || listed.has(c.code)).sort((a, b) => (b.capRaw || 0) - (a.capRaw || 0)).slice(0, n).map(c => c.code);
  }

  const state = { running: false, results: [], done: 0, total: 0, sort: ['ret', -1], error: '', key: '' };

  function paintForm() {
    const el = $('labForm');
    if (!el || !window.Backtest) return;
    const S = Backtest.STRATEGIES;
    el.innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <label class="block"><span class="text-[10px] text-slate-400 block mb-1">Hisse grubu</span>
          <select data-lab="universe" class="w-full px-2 py-1.5 rounded-lg bg-[#070B14] border border-[#1A2540] text-white">
            <option value="bist30">BIST 30</option><option value="top50">En büyük 50 şirket</option><option value="top100">En büyük 100 şirket</option></select></label>
        <label class="block"><span class="text-[10px] text-slate-400 block mb-1">Strateji</span>
          <select data-lab="strategy" class="w-full px-2 py-1.5 rounded-lg bg-[#070B14] border border-[#1A2540] text-white">
            ${Object.entries(S).map(([k, s]) => `<option value="${k}">${esc(s.label)}</option>`).join('')}</select></label>
        <label class="block"><span class="text-[10px] text-slate-400 block mb-1">Dönem (günlük mumlar)</span>
          <select data-lab="range" class="w-full px-2 py-1.5 rounded-lg bg-[#070B14] border border-[#1A2540] text-white">
            ${Object.entries(RANGES).map(([k, t]) => `<option value="${k}" ${k === '2y' ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="block"><span class="text-[10px] text-slate-400 block mb-1">Komisyon (% her işlem)</span>
          <input data-lab="commission" type="number" step="0.01" min="0" value="0.1" class="w-full px-2 py-1.5 rounded-lg bg-[#070B14] border border-[#1A2540] text-white font-mono"></label>
      </div>
      <p data-lab-desc class="text-[11px] text-slate-400"></p>
      <div data-lab-params class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs"></div>
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" data-lab-run class="px-5 py-2 rounded-xl bg-[#2F6BFF] hover:bg-[#4A7FFF] disabled:opacity-60 text-xs font-bold text-white"><i class="fa-solid fa-play mr-1"></i>Testi çalıştır</button>
        <span data-lab-msg class="text-[11px] text-rose-400"></span>
      </div>`;
    paintParams();
  }

  function paintParams() {
    const el = document.querySelector('[data-lab-params]');
    const strategy = document.querySelector('[data-lab="strategy"]').value;
    const def = Backtest.STRATEGIES[strategy];
    document.querySelector('[data-lab-desc]').textContent = def.desc;
    if (def.formulas) {
      el.innerHTML = ['entry', 'exit'].map(k => `
        <label class="block col-span-2 sm:col-span-4"><span class="text-[10px] text-slate-400 block mb-1">${k === 'entry' ? 'Giriş koşulu' : 'Çıkış koşulu'}</span>
          <input data-lab-formula="${k}" maxlength="300" spellcheck="false" class="w-full px-2.5 py-1.5 rounded-lg bg-[#070B14] border border-[#1A2540] text-white font-mono"></label>`).join('');
      el.querySelector('[data-lab-formula="entry"]').value = 'crossover(ema(close, 9), ema(close, 21))';
      el.querySelector('[data-lab-formula="exit"]').value = 'crossunder(ema(close, 9), ema(close, 21))';
      return;
    }
    el.innerHTML = def.params.map(p => `
      <label class="block"><span class="text-[10px] text-slate-400 block mb-1">${esc(p.label)}</span>
        <input data-lab-param="${p.key}" type="number" value="${p.def}" min="${p.min}" max="${p.max}" step="${p.step || 1}" class="w-full px-2 py-1.5 rounded-lg bg-[#070B14] border border-[#1A2540] text-white font-mono"></label>`).join('');
  }

  /** Daily bars of one stock for Backtest.run (times in seconds). */
  async function bars(code, range) {
    const h = await TechData.history(code, range, '1d');
    const out = [];
    h.t.forEach((t, i) => {
      if (![h.o[i], h.h[i], h.l[i], h.c[i]].every(Number.isFinite)) return;
      const time = Math.floor(t / 1000);
      if (out.length && time <= out[out.length - 1].time) return;
      out.push({ time, open: h.o[i], high: h.h[i], low: h.l[i], close: h.c[i], volume: h.v ? h.v[i] || 0 : 0 });
    });
    return out;
  }

  async function run() {
    if (state.running) return;
    const msg = document.querySelector('[data-lab-msg]');
    msg.textContent = '';
    const strategy = document.querySelector('[data-lab="strategy"]').value;
    const def = Backtest.STRATEGIES[strategy];
    const params = {};
    document.querySelectorAll('[data-lab-param]').forEach(el => { params[el.dataset.labParam] = parseFloat(el.value); });
    const formula = def.formulas ? {
      entry: document.querySelector('[data-lab-formula="entry"]').value.trim(),
      exit: document.querySelector('[data-lab-formula="exit"]').value.trim()
    } : null;
    if (formula) {
      const bad = Formula.check(formula.entry, 'condition') || Formula.check(formula.exit, 'condition');
      if (bad) { msg.textContent = bad; return; }
    }
    const commission = Math.max(0, parseFloat(document.querySelector('[data-lab="commission"]').value) || 0) / 100;
    const range = document.querySelector('[data-lab="range"]').value;
    const codes = await universe(document.querySelector('[data-lab="universe"]').value);
    if (!codes.length) { msg.textContent = 'Hisse listesi yüklenemedi.'; return; }

    Object.assign(state, { running: true, results: [], done: 0, total: codes.length, key: `${strategy}|${range}` });
    document.querySelector('[data-lab-run]').disabled = true;
    paintResults();
    let next = 0;
    const worker = async () => {
      while (next < codes.length) {
        const code = codes[next++];
        let result;
        try {
          const b = await bars(code, range);
          result = b.length > 30 ? Backtest.run(b, strategy, { params, formula, commission }) : { ok: false, reason: 'Yetersiz geçmiş' };
        } catch {
          result = { ok: false, reason: 'Veri alınamadı' };
        }
        state.results.push({ code, ...result });
        state.done++;
        paintResults();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    state.running = false;
    document.querySelector('[data-lab-run]').disabled = false;
    paintResults();
  }

  function paintResults() {
    const el = $('labResults');
    if (!el) return;
    if (!state.total) { el.innerHTML = ''; return; }
    const a = aggregate(state.results);
    const value = r => ({ ret: r.stats.totalReturn, bh: r.stats.bhReturn, diff: r.stats.totalReturn - r.stats.bhReturn, trades: r.stats.trades, win: r.stats.winRate, dd: r.stats.maxDrawdown, sharpe: r.stats.sharpe, code: r.code })[state.sort[0]];
    const ok = state.results.filter(r => r.ok).sort((x, y) => {
      const p = value(x), q = value(y);
      if (typeof p === 'string') return p.localeCompare(q) * state.sort[1];
      return ((Number.isFinite(p) ? p : -Infinity) - (Number.isFinite(q) ? q : -Infinity)) * state.sort[1];
    });
    const failed = state.results.filter(r => !r.ok);
    const th = (k, t, right = true) => `<th class="py-2 px-2 ${right ? 'text-right' : 'text-left'}"><button type="button" data-lab-sort="${k}" class="${state.sort[0] === k ? 'text-white' : 'text-slate-400 hover:text-white'}">${t}${state.sort[0] === k ? (state.sort[1] > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
    const card = (label, v, cls = 'text-white', sub = '') => `<div class="p-3 rounded-xl bg-[#0C1322] border border-[#1A2540] min-w-0"><div class="text-[10px] font-mono uppercase tracking-wide text-slate-400">${label}</div><div class="text-lg font-mono font-bold ${cls}">${v}</div>${sub ? `<div class="text-[10px] text-slate-500">${sub}</div>` : ''}</div>`;
    el.innerHTML = `
      ${state.running ? `<div class="space-y-1"><div class="text-[11px] text-slate-400 font-mono">${state.done} / ${state.total} hisse test edildi...</div>
        <div class="h-1.5 rounded-full bg-[#1A2540] overflow-hidden"><div class="h-full bg-[#2F6BFF]" style="width:${Math.round(state.done / state.total * 100)}%"></div></div></div>` : ''}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        ${card('Medyan strateji getirisi', pct(a.median), tone(a.median), `Al-tut medyanı ${pct(a.bhMedian)}`)}
        ${card('Al-tut\'u geçtiği hisse', a.beat == null ? '—' : `%${Math.round(a.beat * 100)}`, a.beat >= 0.5 ? 'text-emerald-400' : 'text-amber-300', `${a.n} hissede`)}
        ${card('Kâr ettiren hisse', a.positive == null ? '—' : `%${Math.round(a.positive * 100)}`)}
        ${card('Toplam işlem', a.trades.toLocaleString('tr-TR'))}
      </div>
      ${ok.length ? `<div class="overflow-x-auto rounded-2xl border border-[#1A2540] bg-[#0C1322]">
        <table class="w-full text-[11px] font-mono">
          <thead class="bg-[#0A101C]"><tr>${th('code', 'Hisse', false)}${th('ret', 'Strateji')}${th('bh', 'Al-tut')}${th('diff', 'Fark')}${th('trades', 'İşlem')}${th('win', 'Kazanan')}${th('dd', 'Maks. düşüş')}${th('sharpe', 'Sharpe')}</tr></thead>
          <tbody>${ok.map(r => {
            const s = r.stats, diff = s.totalReturn - s.bhReturn;
            return `<tr data-lab-go="${esc(r.code)}" class="border-t border-[#162238] hover:bg-[#121C30] cursor-pointer">
              <td class="py-1.5 px-2 text-white font-bold">${esc(r.code)}</td>
              <td class="px-2 text-right font-bold ${tone(s.totalReturn)}">${pct(s.totalReturn)}</td>
              <td class="px-2 text-right ${tone(s.bhReturn)}">${pct(s.bhReturn)}</td>
              <td class="px-2 text-right ${tone(diff)}" title="Strateji ile al-tut arasındaki fark (yüzde puan)">${Number.isFinite(diff) ? `${diff >= 0 ? '+' : ''}${(diff * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} puan` : '—'}</td>
              <td class="px-2 text-right text-slate-200">${s.trades}</td>
              <td class="px-2 text-right text-slate-300">${s.winRate == null ? '—' : `%${Math.round(s.winRate * 100)}`}</td>
              <td class="px-2 text-right text-rose-400">${pct(s.maxDrawdown)}</td>
              <td class="px-2 text-right text-slate-300">${s.sharpe == null ? '—' : s.sharpe.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</td></tr>`;
          }).join('')}</tbody></table></div>` : ''}
      ${failed.length && !state.running ? `<p class="text-[10px] text-slate-500">Test edilemeyen: ${failed.map(r => `${esc(r.code)} (${esc(r.reason || 'hata')})`).join(', ')}</p>` : ''}
      <p class="text-[10px] text-slate-500 font-mono leading-relaxed">Sinyal mumun kapanışında oluşur, ertesi mumun açılışında işlem yapılır; komisyon iki yönde alınır. Satıra tıklayınca hisse açılır, aynı stratejiyi grafikte Teknik sekmesindeki Strateji Testi ile görebilirsin. Geçmiş performans geleceği göstermez.</p>`;
  }

  function render() {
    if (!$('labForm').children.length) paintForm();
    paintResults();
  }

  function init() {
    const view = $('view-lab');
    if (!view) return;
    view.addEventListener('change', e => { if (e.target.dataset.lab === 'strategy') paintParams(); });
    view.addEventListener('click', e => {
      if (e.target.closest('[data-lab-run]')) { run(); return; }
      const s = e.target.closest('[data-lab-sort]');
      if (s) { const k = s.dataset.labSort; state.sort = state.sort[0] === k ? [k, -state.sort[1]] : [k, k === 'code' || k === 'dd' ? 1 : -1]; paintResults(); return; }
      const go = e.target.closest('[data-lab-go]');
      if (go && typeof selectStock === 'function') selectStock(go.dataset.labGo);
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { render, median, aggregate };
})();

if (typeof window !== 'undefined') window.StrategyLab = StrategyLab;
