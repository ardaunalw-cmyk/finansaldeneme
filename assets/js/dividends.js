/**
 * Temettü takvimi: nakit temettü hak kullanım (ex-date) tarihleri ve hisse başına tutarlar.
 *
 * Veri assets/data/dividends.json'dan gelir (npm run data:dividends, Yahoo Finance). Dosya yalnızca
 * gerçekleşmiş dağıtımları içerir; ileri tarihli duyuru yoktur. "Geçen yıl bu dönemde" bölümü bu
 * yüzden tahmin değil, bir yıl önceki gerçek dağıtımları gösterir.
 * Verim, tutarın dosya üretildiği andaki fiyata oranıdır.
 */
const Dividends = (() => {
  const nf = (d) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const f2 = nf(2);
  const f4 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 864e5;
  const AHEAD_DAYS = 90;

  let file = null;
  const ui = { tab: 'calendar', query: '', sort: 'yield', dir: -1 };

  const iso = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  const time = (s) => Date.parse(`${s}T00:00:00Z`);
  const dayMonth = (s) => new Date(time(s)).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fullDate = (s) => new Date(time(s)).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const monthTitle = (key) => new Date(time(`${key}-01`)).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const entryFor = (code) => (typeof getFullBistStockList === 'function' ? getFullBistStockList().find((s) => s.code === code) : null);
  const norm = (s) => (typeof normalizeSearchText === 'function' ? normalizeSearchText(s) : String(s).toLowerCase()).trim();

  function load() {
    if (!file) {
      file = fetch('/assets/data/dividends.json')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((j) => {
          if (!j) { file = null; return null; }
          return j;
        });
    }
    return file;
  }

  /** Flat list of payments: { code, name, sector, date, amount, yield }. */
  function payments(j) {
    const out = [];
    Object.entries(j.data).forEach(([code, { p, d }]) => {
      const e = entryFor(code);
      d.forEach(([date, amount]) => out.push({
        code, name: e ? e.name : code, sector: e ? e.raw.sec : '', search: e ? e.searchTarget : norm(code),
        date, amount, yield: p > 0 ? amount / p * 100 : null
      }));
    });
    return out;
  }

  function matches(x) {
    const q = norm(ui.query);
    return !q || x.code.toLowerCase().includes(q) || x.search.includes(q);
  }

  const stockLink = (x) => `
    <button type="button" onclick="Dividends.openStock('${esc(x.code)}')" class="block w-full min-w-0 text-left">
      <span class="font-mono font-bold text-white hover:text-[#7FA6FF] text-sm">${esc(x.code)}</span>
      <span class="block text-[11px] text-slate-400 font-sans truncate">${esc(x.name)}</span>
    </button>`;
  const yieldCell = (v) => (v == null ? '<span class="text-slate-600">—</span>' : `<span class="text-emerald-400">%${f2.format(v)}</span>`);

  /* ---------- sections ---------- */
  function summaryHtml(j, all, today) {
    const yearAgo = iso(time(today) - 365 * DAY);
    const last12 = all.filter((x) => x.date > yearAgo);
    const payers = new Set(last12.map((x) => x.code)).size;
    const yields = rankRows(all, today).map((r) => r.yield).filter((v) => v != null).sort((a, b) => a - b);
    const median = yields.length ? yields[Math.floor(yields.length / 2)] : null;
    const tile = (label, value, sub) => `
      <div class="rounded-2xl border border-oa-border bg-oa-card p-4">
        <div class="text-[10px] font-mono uppercase tracking-widest text-slate-500">${label}</div>
        <div class="text-2xl font-mono font-bold text-white mt-1">${value}</div>
        <div class="text-[11px] text-slate-500 font-sans mt-0.5">${sub}</div>
      </div>`;
    return `
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        ${tile('Temettü dağıtan', payers, 'son 12 ayda şirket')}
        ${tile('Dağıtım sayısı', last12.length, 'son 12 ayda hak kullanımı')}
        ${tile('Medyan verim', median == null ? '—' : `%${f2.format(median)}`, 'son 12 ay toplamı / fiyat')}
        ${tile('Veri tarihi', dayMonth(j.generatedAt.slice(0, 10)), 'Yahoo Finance')}
      </div>`;
  }

  /** Payments made in the same window one year ago (today .. today + AHEAD_DAYS, minus a year). */
  function lastYearHtml(all, today) {
    const from = iso(time(today) - 365 * DAY);
    const to = iso(time(today) - (365 - AHEAD_DAYS) * DAY);
    const rows = all.filter((x) => x.date >= from && x.date <= to && matches(x)).sort((a, b) => a.date.localeCompare(b.date));
    const list = rows.length
      ? rows.map((x) => `
          <div class="flex items-center gap-3 px-4 py-2.5 border-t border-oa-border/60">
            <div class="w-16 shrink-0 text-xs font-mono text-slate-400">${dayMonth(x.date)}</div>
            <div class="flex-1 min-w-0">${stockLink(x)}</div>
            <div class="text-right font-mono text-sm">
              <div class="text-white">₺${f4.format(x.amount)}</div>
              <div class="text-[11px]">${yieldCell(x.yield)}</div>
            </div>
          </div>`).join('')
      : '<div class="px-4 py-6 text-sm text-slate-500 font-sans border-t border-oa-border/60">Bu aralıkta geçen yıl dağıtım yok.</div>';
    return `
      <section class="rounded-2xl border border-oa-border bg-oa-card overflow-hidden">
        <div class="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="font-serif font-bold text-white text-base">Geçen yıl bu dönemde dağıtanlar</h2>
            <p class="text-[11px] text-slate-400 font-sans">${fullDate(from)} – ${fullDate(to)} arasındaki gerçek dağıtımlar. Bu yılın tarihleri değildir; şirketler genelde benzer dönemde dağıtır, kesin tarih KAP duyurusuyla belli olur.</p>
          </div>
          <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border border-amber-800/50 bg-amber-950/40 text-amber-300">GEÇMİŞ VERİ</span>
        </div>
        <div class="max-h-[360px] overflow-y-auto">${list}</div>
      </section>`;
  }

  function calendarHtml(all, today) {
    const yearAgo = iso(time(today) - 365 * DAY);
    const rows = all.filter((x) => x.date > yearAgo && matches(x)).sort((a, b) => b.date.localeCompare(a.date));
    if (!rows.length) return '<div class="rounded-2xl border border-dashed border-oa-border p-8 text-center text-sm text-slate-400 font-sans">Eşleşen dağıtım yok.</div>';
    const months = new Map();
    rows.forEach((x) => {
      const k = x.date.slice(0, 7);
      if (!months.has(k)) months.set(k, []);
      months.get(k).push(x);
    });
    return [...months].map(([k, list]) => `
      <section class="rounded-2xl border border-oa-border bg-oa-card overflow-hidden">
        <div class="px-4 py-2.5 flex items-center justify-between bg-[#090D18]/80">
          <h3 class="font-serif font-bold text-white text-sm capitalize">${monthTitle(k)}</h3>
          <span class="text-[11px] font-mono text-slate-500">${list.length} dağıtım</span>
        </div>
        ${list.map((x) => `
          <div class="flex items-center gap-3 px-4 py-2.5 border-t border-oa-border/60">
            <div class="w-16 shrink-0 text-xs font-mono text-slate-400">${dayMonth(x.date)}</div>
            <div class="flex-1 min-w-0">${stockLink(x)}</div>
            <div class="hidden sm:block w-40 text-[11px] text-slate-500 font-sans truncate">${esc(x.sector)}</div>
            <div class="w-24 text-right font-mono text-sm text-white">₺${f4.format(x.amount)}</div>
            <div class="w-16 text-right font-mono text-sm">${yieldCell(x.yield)}</div>
          </div>`).join('')}
      </section>`).join('');
  }

  /** One row per company: payments in the last 12 months, summed. */
  function rankRows(all, today) {
    const yearAgo = iso(time(today) - 365 * DAY);
    const by = new Map();
    all.filter((x) => x.date > yearAgo).forEach((x) => {
      const r = by.get(x.code) || { ...x, amount: 0, yield: 0, count: 0, last: x.date };
      r.amount += x.amount;
      r.yield = x.yield == null ? null : (r.yield ?? 0) + x.yield;
      r.count += 1;
      if (x.date > r.last) r.last = x.date;
      by.set(x.code, r);
    });
    return [...by.values()];
  }

  const SORTS = {
    yield: (r) => r.yield ?? -1,
    amount: (r) => r.amount,
    count: (r) => r.count,
    last: (r) => r.last,
    code: (r) => r.code
  };

  function rankingHtml(all, today) {
    const key = SORTS[ui.sort];
    const rows = rankRows(all, today).filter(matches).sort((a, b) => {
      const va = key(a), vb = key(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * ui.dir;
    });
    const th = (k, label, align = 'text-right') => `
      <th class="px-3 py-2.5 ${align}">
        <button type="button" onclick="Dividends.sortBy('${k}')" class="text-[10px] font-mono uppercase tracking-widest ${ui.sort === k ? 'text-[#7FA6FF]' : 'text-slate-500 hover:text-slate-300'}">
          ${label}${ui.sort === k ? ` <i class="fa-solid ${ui.dir < 0 ? 'fa-arrow-down' : 'fa-arrow-up'}"></i>` : ''}
        </button>
      </th>`;
    return `
      <div class="overflow-x-auto rounded-2xl border border-oa-border bg-oa-card">
        <table class="w-full text-left border-collapse">
          <thead><tr class="border-b border-oa-border">
            <th class="px-3 py-2.5 w-10 text-[10px] font-mono text-slate-500 hidden sm:table-cell">#</th>
            ${th('code', 'Hisse', 'text-left')}
            ${th('yield', 'Verim (12A)')}
            ${th('amount', 'Hisse başı (12A)')}
            ${th('count', 'Dağıtım', 'text-right hidden sm:table-cell')}
            ${th('last', 'Son tarih', 'text-right hidden sm:table-cell')}
          </tr></thead>
          <tbody>
            ${rows.map((r, i) => `
              <tr class="border-t border-oa-border/60 hover:bg-[#121C30]/40">
                <td class="px-3 py-2.5 text-xs font-mono text-slate-500 hidden sm:table-cell">${i + 1}</td>
                <td class="px-3 py-2.5"><div class="w-[130px] sm:w-[260px]">${stockLink(r)}</div></td>
                <td class="px-3 py-2.5 text-right font-mono text-sm">${yieldCell(r.yield)}</td>
                <td class="px-3 py-2.5 text-right font-mono text-sm text-white">₺${f4.format(r.amount)}</td>
                <td class="px-3 py-2.5 text-right font-mono text-sm text-slate-300 hidden sm:table-cell">${r.count}</td>
                <td class="px-3 py-2.5 text-right font-mono text-xs text-slate-400 hidden sm:table-cell">${dayMonth(r.last)}</td>
              </tr>`).join('') || '<tr><td colspan="6" class="px-3 py-8 text-center text-sm text-slate-500 font-sans">Eşleşen hisse yok.</td></tr>'}
          </tbody>
        </table>
      </div>`;
  }

  /* ---------- rendering ---------- */
  function tabsHtml() {
    const tab = (k, icon, label) => `
      <button type="button" onclick="Dividends.setTab('${k}')" class="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 ${ui.tab === k ? 'bg-[#2F6BFF] text-white' : 'bg-[#0C1322] border border-[#1A2540] text-slate-400 hover:text-white'}">
        <i class="fa-solid ${icon}"></i>${label}
      </button>`;
    return `<div class="flex gap-2">${tab('calendar', 'fa-calendar-days', 'Aylık takvim')}${tab('ranking', 'fa-ranking-star', 'Verim sıralaması')}</div>`;
  }

  async function render() {
    const root = document.getElementById('dividendsRoot');
    if (!root) return;
    if (!root.dataset.ready) root.innerHTML = '<div class="text-sm text-slate-500 font-sans p-6">Temettü verisi yükleniyor…</div>';
    const j = await load();
    if (!j) {
      root.innerHTML = '<div class="rounded-2xl border border-dashed border-oa-border p-8 text-center text-sm text-amber-400 font-sans">Temettü verisi şu an alınamadı. Birazdan tekrar deneyin.</div>';
      return;
    }
    const today = iso(Date.now());
    const all = payments(j);
    const focused = document.activeElement && document.activeElement.id === 'dividendSearch';
    root.dataset.ready = '1';
    root.innerHTML = `
      ${summaryHtml(j, all, today)}
      ${lastYearHtml(all, today)}
      <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
        ${tabsHtml()}
        <input id="dividendSearch" type="text" autocomplete="off" value="${esc(ui.query)}" oninput="Dividends.search(this.value)" placeholder="Hisse ara (ör. TUPRS)"
          class="w-full sm:w-64 px-3.5 py-2.5 rounded-xl bg-[#0C1322] border border-[#1A2540] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2F6BFF]">
      </div>
      <div class="space-y-4">${ui.tab === 'ranking' ? rankingHtml(all, today) : calendarHtml(all, today)}</div>
      <p class="text-[11px] text-slate-500 font-sans leading-relaxed">
        Kaynak: ${esc(j.source)}. Tarihler hak kullanım (temettüsüz işlem) tarihidir; ödeme genelde birkaç gün sonra yapılır.
        Tutarlar hisse başına ve kaynağın bildirdiği şekliyledir (bedelsiz sermaye artırımlarına göre düzeltilmiş olabilir).
        Verim, ${fullDate(j.generatedAt.slice(0, 10))} tarihli fiyata göre hesaplanır. Yatırım tavsiyesi değildir.
      </p>`;
    if (focused) {
      const input = document.getElementById('dividendSearch');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function setTab(tab) { ui.tab = tab; render(); }
  function search(q) { ui.query = q; render(); }
  function sortBy(k) {
    if (ui.sort === k) ui.dir = -ui.dir;
    else { ui.sort = k; ui.dir = k === 'code' ? 1 : -1; }
    render();
  }
  function openStock(code) {
    if (typeof switchView === 'function') switchView('stock-detail', code);
  }

  return { render, setTab, search, sortBy, openStock };
})();

window.Dividends = Dividends;
