/**
 * Fonlar: exchange-traded funds on Borsa İstanbul (BYF: gold, silver, index and dollar funds)
 * with delayed prices from /api/markets, and a TEFAS lookup. TEFAS's own fund data sits behind
 * a bot check that refuses server requests, so mutual funds open on tefas.gov.tr by their code.
 */
const Funds = (() => {
  const $ = id => document.getElementById(id);
  const GROUPS = [
    ['Altın ve gümüş fonları', ['GLDTR', 'ZGOLD', 'ISGLK', 'GMSTR'], 'fa-coins'],
    ['Hisse endeksi fonları', ['ZPX30', 'OPX30', 'APX30', 'ZPLIB', 'ZPBDL', 'ZELOT', 'ZSR25', 'ZPT10', 'ZRE20'], 'fa-chart-pie'],
    ['Döviz ve tahvil fonları', ['USDTR'], 'fa-dollar-sign']
  ];
  const FUND_CODE = /^[A-Z0-9]{3}$/;
  const tefasUrl = code => `https://www.tefas.gov.tr/FonAnaliz.aspx?FonKod=${encodeURIComponent(code)}`;

  /**
   * "ZIRAAT PORTFOY BIST 30 HY BYF" -> "Ziraat Portfoy BIST 30 HY BYF". Yahoo spells the names in
   * ASCII, so the plain (not Turkish) case rules keep "Ziraat" from becoming "Zıraat".
   */
  const tidy = s => String(s || '').trim().toLowerCase().replace(/(^|\s)(\S)/g, (m, sp, c) => sp + c.toUpperCase())
    .replace(/\b(Bist|Byf|Etf|Hy|Yp|Abd|Usa)\b/g, w => w.toUpperCase());

  const state = { rows: {}, loadedAt: 0 };

  async function load() {
    try { state.rows = await MarketBoard.fetchRows(GROUPS.flatMap(g => g[1])); } catch { /* keeps the last rows */ }
    state.loadedAt = Date.now();
    paint();
  }

  function paint() {
    const el = $('fdBody');
    if (!el) return;
    const items = keys => keys.map(k => ({ key: k, label: k, sub: state.rows[k] ? tidy(state.rows[k].name) : '', row: state.rows[k] }));
    el.innerHTML = `
      <section class="p-4 rounded-2xl border border-[#2F6BFF]/40 bg-[#2F6BFF]/10 space-y-3">
        <div class="flex items-center gap-2 text-sm font-bold text-white"><i class="fa-solid fa-magnifying-glass-chart text-[#7FA6FF]"></i>TEFAS'ta fon ara</div>
        <p class="text-xs text-slate-300">Yatırım fonlarının (TEFAS) fiyat ve getirileri resmi sitede, fon koduyla açılır. Üç harfli kodu yaz:</p>
        <form data-fd-form class="flex flex-wrap gap-2">
          <input name="code" maxlength="3" autocomplete="off" placeholder="ör. AFT" aria-label="TEFAS fon kodu"
            class="w-28 px-3 py-2 rounded-xl bg-[#070B14] border border-[#1A2540] text-white uppercase placeholder:normal-case font-mono text-sm">
          <button class="px-4 py-2 rounded-xl bg-[#2F6BFF] hover:bg-[#4A7FFF] text-xs font-bold text-white">TEFAS'ta aç</button>
          <a href="https://www.tefas.gov.tr/FonKarsilastirma.aspx" target="_blank" rel="noopener" class="px-4 py-2 rounded-xl border border-[#1A2540] text-xs font-semibold text-slate-300 hover:text-white">Fon karşılaştırma ↗</a>
        </form>
        <p data-fd-msg class="text-[11px] text-rose-400"></p>
      </section>
      <div class="flex items-center gap-2 pt-2"><h2 class="text-lg font-serif text-white">Borsada işlem gören fonlar (BYF)</h2><span class="text-[11px] text-slate-500">hisse gibi alınıp satılır</span></div>
      <div class="grid grid-cols-1 gap-4">${GROUPS.map(([t, keys, icon]) => MarketBoard.groupHtml(t, items(keys), icon)).join('')}</div>
      <p class="text-[10px] text-slate-500 font-mono">Yahoo Finance, gecikmeli. Bazı BYF'lerde işlem az olduğundan fiyat günlerce değişmeyebilir. Satıra tıklayınca grafik açılır. Yatırım tavsiyesi değildir.</p>`;
  }

  function render() {
    if (!state.loadedAt) {
      const el = $('fdBody');
      if (el) el.innerHTML = '<p class="text-xs text-slate-500 text-center py-10"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Fonlar yükleniyor...</p>';
    }
    if (Date.now() - state.loadedAt > 5 * 60000) load(); else paint();
  }

  function init() {
    const view = $('view-funds');
    if (!view) return;
    view.addEventListener('click', e => {
      const btn = e.target.closest('[data-mb]');
      if (btn) MarketBoard.chartPanel($('fdChart'), btn.dataset.mb, `${btn.dataset.mb} · ${state.rows[btn.dataset.mb] ? tidy(state.rows[btn.dataset.mb].name) : ''}`);
    });
    view.addEventListener('submit', e => {
      if (!e.target.matches('[data-fd-form]')) return;
      e.preventDefault();
      const code = e.target.code.value.trim().toLocaleUpperCase('tr-TR');
      const msg = view.querySelector('[data-fd-msg]');
      if (!FUND_CODE.test(code)) { msg.textContent = 'Fon kodu üç harf ya da rakamdır (ör. AFT).'; return; }
      msg.textContent = '';
      window.open(tefasUrl(code), '_blank', 'noopener');
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { render, tidy, tefasUrl };
})();

if (typeof window !== 'undefined') window.Funds = Funds;
