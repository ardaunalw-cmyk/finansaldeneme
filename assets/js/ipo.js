/**
 * Halka Arzlar: companies that began trading in the last two years (assets/data/ipos.json, built
 * weekly by scripts/fetch-ipos.mjs) with their first session, the run of limit-up days after it,
 * the peak and today's price. Offer prices are not in any free feed, so every return is measured
 * from the first day's close, and the page says so.
 */
const Ipos = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 86400000;
  const state = { rows: null, generatedAt: '', period: 365, sort: ['first', -1], status: 'idle' };

  const pct = v => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}%` : '—');
  const tone = v => (!Number.isFinite(v) ? 'text-slate-400' : v >= 0 ? 'text-emerald-400' : 'text-rose-400');
  const tl = v => (Number.isFinite(v) ? v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
  const date = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });

  /** Count, median return, share above the first close, the longest limit-up run. */
  function summary(rows) {
    const rets = rows.map(r => r.ret).filter(Number.isFinite).sort((a, b) => a - b);
    const mid = rets.length ? (rets.length % 2 ? rets[(rets.length - 1) / 2] : (rets[rets.length / 2 - 1] + rets[rets.length / 2]) / 2) : null;
    const top = rows.reduce((b, r) => (!b || r.streak > b.streak ? r : b), null);
    return { n: rows.length, median: mid, up: rows.length ? rows.filter(r => r.ret > 0).length / rows.length * 100 : null, top };
  }

  async function load() {
    state.status = 'loading';
    paint();
    try {
      const j = await (await fetch('/assets/data/ipos.json')).json();
      const names = new Map((typeof getFullBistStockList === 'function' ? getFullBistStockList() : []).map(c => [c.code, c]));
      state.rows = j.data.map(r => ({ ...r, name: (names.get(r.code) || {}).name || r.code, sector: (names.get(r.code) || {}).sector || '' }));
      state.generatedAt = j.generatedAt;
      state.status = 'ok';
    } catch {
      state.status = 'error';
    }
    paint();
  }

  function visible() {
    const cut = new Date(Date.now() - state.period * DAY).toISOString().slice(0, 10);
    const [f, dir] = state.sort;
    return state.rows.filter(r => r.first >= cut).sort((a, b) => {
      const x = a[f], y = b[f];
      return (typeof x === 'string' ? x.localeCompare(y) : (x ?? -Infinity) - (y ?? -Infinity)) * dir;
    });
  }

  function paint() {
    const el = $('ipoBody');
    if (!el) return;
    if (state.status !== 'ok') {
      el.innerHTML = state.status === 'error' ? '<p class="text-sm text-rose-400 text-center py-10">Halka arz verisi yüklenemedi.</p>'
        : '<p class="text-xs text-slate-500 text-center py-10"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Yükleniyor...</p>';
      return;
    }
    const rows = visible();
    const s = summary(rows);
    const chip = (v, t) => `<button type="button" data-ipo-period="${v}" class="px-3 py-1.5 rounded-xl text-xs font-semibold border ${state.period === v ? 'bg-[#2F6BFF] border-[#2F6BFF] text-white' : 'border-[#1A2540] text-slate-400 hover:text-white'}">${t}</button>`;
    const th = (f, t, right = true) => `<th class="py-2 px-2 ${right ? 'text-right' : 'text-left'}"><button type="button" data-ipo-sort="${f}" class="${state.sort[0] === f ? 'text-white' : 'text-slate-400 hover:text-white'}">${t}${state.sort[0] === f ? (state.sort[1] > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
    const card = (label, value, cls = 'text-white', sub = '') => `<div class="p-3 rounded-xl bg-[#0C1322] border border-[#1A2540] min-w-0"><div class="text-[10px] font-mono uppercase tracking-wide text-slate-400">${label}</div><div class="text-lg font-mono font-bold ${cls}">${value}</div>${sub ? `<div class="text-[10px] text-slate-500 truncate">${sub}</div>` : ''}</div>`;
    el.innerHTML = `
      <div class="flex flex-wrap gap-2">${chip(180, 'Son 6 ay')}${chip(365, 'Son 1 yıl')}${chip(730, 'Son 2 yıl')}</div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        ${card('Halka arz', String(s.n))}
        ${card('Medyan getiri', pct(s.median), tone(s.median), 'ilk gün kapanışından bugüne')}
        ${card('İlk kapanışın üstünde', s.up == null ? '—' : `%${Math.round(s.up)}`)}
        ${card('En uzun tavan serisi', s.top ? `${s.top.streak} gün` : '—', 'text-amber-300', s.top ? esc(s.top.code) : '')}
      </div>
      <div class="overflow-x-auto rounded-2xl border border-[#1A2540] bg-[#0C1322]">
        <table class="w-full text-[11px] font-mono">
          <thead class="bg-[#0A101C]"><tr>${th('code', 'Şirket', false)}${th('first', 'İlk işlem')}${th('close1', 'İlk kapanış')}${th('streak', 'Tavan serisi')}${th('peakRet', 'Zirve')}${th('last', 'Son fiyat')}${th('ret', 'Getiri')}${th('fromPeak', 'Zirveden')}</tr></thead>
          <tbody>${rows.map(r => `
            <tr data-ipo-go="${esc(r.code)}" class="border-t border-[#162238] hover:bg-[#121C30] cursor-pointer">
              <td class="py-1.5 px-2"><span class="text-white font-bold">${esc(r.code)}</span><span class="block text-[10px] text-slate-500 font-sans truncate max-w-[12rem]">${esc(r.name)}</span></td>
              <td class="px-2 text-right text-slate-300">${esc(date(r.first))}<span class="block text-[10px] text-slate-500">${r.sessions} seans</span></td>
              <td class="px-2 text-right text-slate-200">${tl(r.close1)}</td>
              <td class="px-2 text-right ${r.streak ? 'text-amber-300 font-bold' : 'text-slate-500'}">${r.streak ? `${r.streak} gün` : '—'}</td>
              <td class="px-2 text-right ${tone(r.peakRet)}">${pct(r.peakRet)}<span class="block text-[10px] text-slate-500">${esc(date(r.peakDate))}</span></td>
              <td class="px-2 text-right text-white">${tl(r.last)}</td>
              <td class="px-2 text-right font-bold ${tone(r.ret)}">${pct(r.ret)}</td>
              <td class="px-2 text-right ${tone(r.fromPeak)}">${pct(r.fromPeak)}</td>
            </tr>`).join('') || '<tr><td colspan="8" class="py-8 text-center text-slate-400 font-sans">Bu dönemde halka arz yok.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="text-[10px] text-slate-500 font-mono leading-relaxed">Getiriler ilk işlem gününün kapanışına göredir; arz fiyatı ücretsiz veri kaynaklarında olmadığından dahil değildir. Tavan serisi: ilk günden sonra art arda %9,5 ve üzeri kapanan seanslar. Zirve: ilk kapanıştan en yüksek fiyata. Yahoo Finance; ${state.generatedAt ? `güncelleme ${new Date(state.generatedAt).toLocaleDateString('tr-TR')}` : ''}, haftalık yenilenir. Yatırım tavsiyesi değildir.</p>`;
  }

  function render() { if (!state.rows && state.status !== 'loading') load(); else paint(); }

  function init() {
    const view = $('view-ipo');
    if (!view) return;
    view.addEventListener('click', e => {
      const p = e.target.closest('[data-ipo-period]');
      if (p) { state.period = Number(p.dataset.ipoPeriod); paint(); return; }
      const s = e.target.closest('[data-ipo-sort]');
      if (s) { const f = s.dataset.ipoSort; state.sort = state.sort[0] === f ? [f, -state.sort[1]] : [f, f === 'code' ? 1 : -1]; paint(); return; }
      const go = e.target.closest('[data-ipo-go]');
      if (go && typeof selectStock === 'function') selectStock(go.dataset.ipoGo);
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { render, summary };
})();

if (typeof window !== 'undefined') window.Ipos = Ipos;
