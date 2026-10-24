/**
 * Ekonomik Takvim: this and next week's releases of the major economies (/api/calendar, from
 * the public Forex Factory feed) together with Turkey's own dates: the TCMB rate decisions,
 * inflation and financial stability reports as the bank published them for 2026, and TÜİK's
 * monthly inflation release (the 3rd of each month, the next working day when it falls on a
 * weekend). Times are shown in Istanbul time.
 */
const EconCalendar = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 86400000;

  /** TCMB 2026 calendar (Para Politikası Kurulu at 14:00; reports at 10:30), Istanbul time. */
  const TCMB = [
    ...['2026-01-22', '2026-03-12', '2026-04-22', '2026-06-11', '2026-07-23', '2026-09-10', '2026-10-22', '2026-12-10', '2027-01-21']
      .map(d => ({ date: d, hour: '14:00', title: 'TCMB faiz kararı (PPK)', impact: 3 })),
    ...['2026-02-12', '2026-05-14', '2026-08-13', '2026-11-12']
      .map(d => ({ date: d, hour: '10:30', title: 'TCMB Enflasyon Raporu', impact: 2 })),
    ...['2026-05-22', '2026-11-27']
      .map(d => ({ date: d, hour: '10:30', title: 'TCMB Finansal İstikrar Raporu', impact: 1 }))
  ];

  const COUNTRIES = {
    TR: { name: 'Türkiye', flag: '🇹🇷' }, USD: { name: 'ABD', flag: '🇺🇸' }, EUR: { name: 'Euro Bölgesi', flag: '🇪🇺' },
    GBP: { name: 'İngiltere', flag: '🇬🇧' }, JPY: { name: 'Japonya', flag: '🇯🇵' }, CNY: { name: 'Çin', flag: '🇨🇳' },
    CHF: { name: 'İsviçre', flag: '🇨🇭' }, CAD: { name: 'Kanada', flag: '🇨🇦' }, AUD: { name: 'Avustralya', flag: '🇦🇺' },
    NZD: { name: 'Yeni Zelanda', flag: '🇳🇿' }, All: { name: 'Küresel', flag: '🌐' }
  };

  /** Turkish names for the releases investors here follow most; the rest keep their English title. */
  const TITLES = [
    [/^Federal Funds Rate$/i, 'Fed faiz kararı'], [/^FOMC Statement$/i, 'FOMC açıklaması'], [/^FOMC Press Conference$/i, 'Fed Başkanı basın toplantısı'],
    [/^FOMC Meeting Minutes$/i, 'FOMC tutanakları'], [/^Non-Farm Employment Change$/i, 'Tarım dışı istihdam'],
    [/^Unemployment Rate$/i, 'İşsizlik oranı'], [/^CPI y\/y$/i, 'TÜFE (yıllık)'], [/^CPI m\/m$/i, 'TÜFE (aylık)'],
    [/^Core CPI m\/m$/i, 'Çekirdek TÜFE (aylık)'], [/^Core CPI y\/y$/i, 'Çekirdek TÜFE (yıllık)'], [/^Core PCE Price Index m\/m$/i, 'Çekirdek PCE (aylık)'],
    [/^PPI m\/m$/i, 'ÜFE (aylık)'], [/^Advance GDP q\/q$/i, 'GSYH öncü (çeyreklik)'], [/^GDP q\/q$/i, 'GSYH (çeyreklik)'],
    [/^Retail Sales m\/m$/i, 'Perakende satışlar (aylık)'], [/^Core Retail Sales m\/m$/i, 'Çekirdek perakende satışlar'],
    [/^ISM Manufacturing PMI$/i, 'ISM imalat PMI'], [/^ISM Services PMI$/i, 'ISM hizmet PMI'], [/Flash Manufacturing PMI$/i, 'İmalat PMI (öncü)'],
    [/Flash Services PMI$/i, 'Hizmet PMI (öncü)'], [/^Unemployment Claims$/i, 'Haftalık işsizlik başvuruları'],
    [/^Main Refinancing Rate$/i, 'ECB faiz kararı'], [/^ECB Press Conference$/i, 'ECB basın toplantısı'],
    [/^Official Bank Rate$/i, 'BoE faiz kararı'], [/^BOJ Policy Rate$/i, 'BoJ faiz kararı'], [/^Crude Oil Inventories$/i, 'Ham petrol stokları'],
    [/^JOLTS Job Openings$/i, 'JOLTS açık iş ilanları'], [/^ADP Non-Farm Employment Change$/i, 'ADP özel sektör istihdamı'],
    [/^CB Consumer Confidence$/i, 'Tüketici güveni (CB)'], [/^Prelim UoM Consumer Sentiment$/i, 'Michigan tüketici güveni (öncü)'],
    [/^Durable Goods Orders m\/m$/i, 'Dayanıklı mal siparişleri'], [/^Bank Holiday$/i, 'Resmi tatil']
  ];
  const trTitle = t => { const hit = TITLES.find(([re]) => re.test(t)); return hit ? hit[1] : t; };

  /** A date at an Istanbul wall-clock time (UTC+3 all year) as ms. */
  const istanbul = (date, hour = '10:00') => Date.parse(`${date}T${hour}:00+03:00`);

  /** TÜİK's monthly inflation releases from `from` for `months` months: the 3rd, or the next weekday. */
  function tuikDates(from, months) {
    const out = [];
    const d0 = new Date(from);
    for (let k = 0; k < months; k++) {
      const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + k, 3));
      while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  /** Turkey's events from `from` to `to` (ms). */
  function turkishEvents(from, to) {
    const tcmb = TCMB.map(e => ({ time: istanbul(e.date, e.hour), title: e.title, impact: e.impact }));
    const tuik = tuikDates(from - 40 * DAY, 4).map(d => ({ time: istanbul(d, '10:00'), title: 'TÜİK enflasyon (TÜFE)', impact: 3, note: 'Tarih kurala göre hesaplandı' }));
    return [...tcmb, ...tuik]
      .filter(e => e.time >= from && e.time <= to)
      .map(e => ({ ...e, country: 'TR', forecast: '', previous: '' }));
  }

  const state = { events: [], status: 'idle', country: 'all', impact: 1, past: 'no', loadedAt: 0 };

  async function load() {
    state.status = 'loading';
    paint();
    let world = [];
    try {
      const r = await fetch('/api/calendar');
      if (r.ok) world = (await r.json()).events || [];
    } catch { /* Turkey's dates still show */ }
    const now = Date.now();
    const from = world.length ? Math.min(world[0].time, now - DAY) : now - DAY;
    const to = Math.max(world.length ? world[world.length - 1].time : 0, now + 45 * DAY);
    state.events = [...world, ...turkishEvents(from, to)].sort((a, b) => a.time - b.time);
    state.status = world.length ? 'ok' : 'partial';
    state.loadedAt = now;
    paint();
  }

  const dayKey = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  const dayLabel = t => new Date(t).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Istanbul' });
  const hhmm = t => new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
  const dots = n => [1, 2, 3].map(i => `<span class="inline-block w-1.5 h-1.5 rounded-full ${i <= n ? (n === 3 ? 'bg-rose-500' : n === 2 ? 'bg-amber-400' : 'bg-slate-400') : 'bg-slate-700'}"></span>`).join('');

  function until(ms) {
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} dk sonra`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h} sa ${m % 60} dk sonra`;
    return `${Math.floor(h / 24)} gün sonra`;
  }

  function visible() {
    const today = dayKey(Date.now());
    return state.events.filter(e => e.impact >= state.impact)
      .filter(e => state.past === 'yes' || dayKey(e.time) >= today)
      .filter(e => state.country === 'all' || (state.country === 'other' ? !['TR', 'USD', 'EUR', 'GBP', 'JPY', 'CNY'].includes(e.country) : e.country === state.country));
  }

  function paint() {
    const el = $('calBody');
    if (!el) return;
    const filters = $('calFilters');
    const chip = (key, value, text) => {
      const on = String(state[key]) === String(value);
      return `<button type="button" data-cal="${key}:${value}" aria-pressed="${on}" class="px-3 py-1.5 rounded-xl text-xs font-semibold border ${on ? 'bg-[#2F6BFF] border-[#2F6BFF] text-white' : 'border-[#1A2540] text-slate-400 hover:text-white'}">${text}</button>`;
    };
    if (filters) {
      filters.innerHTML = `
        <div class="flex flex-wrap items-center gap-2">
          ${chip('country', 'all', 'Tümü')}${chip('country', 'TR', '🇹🇷 Türkiye')}${chip('country', 'USD', '🇺🇸 ABD')}${chip('country', 'EUR', '🇪🇺 Euro')}
          ${chip('country', 'GBP', '🇬🇧 İngiltere')}${chip('country', 'JPY', '🇯🇵 Japonya')}${chip('country', 'CNY', '🇨🇳 Çin')}${chip('country', 'other', 'Diğer')}
          <span class="ml-auto flex flex-wrap gap-1">${chip('impact', 1, 'Tüm önem')}${chip('impact', 2, 'Orta ve yüksek')}${chip('impact', 3, 'Yüksek')}
            ${chip('past', state.past === 'yes' ? 'no' : 'yes', state.past === 'yes' ? 'Geçmişi gizle' : 'Geçmiş günler')}</span>
        </div>`;
    }
    if (state.status === 'loading' && !state.events.length) {
      el.innerHTML = '<p class="text-xs text-slate-500 text-center py-10"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Takvim yükleniyor...</p>';
      return;
    }
    const now = Date.now();
    const next = state.events.find(e => e.time > now && e.impact === 3);
    const rows = visible();
    const groups = [];
    rows.forEach(e => {
      const k = dayKey(e.time);
      if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, label: dayLabel(e.time), items: [] });
      groups[groups.length - 1].items.push(e);
    });
    const today = dayKey(now);
    el.innerHTML = `
      ${next ? `<div class="p-4 rounded-2xl border border-rose-800/40 bg-rose-950/20 flex flex-wrap items-center gap-3">
        <i class="fa-solid fa-bell text-rose-400"></i>
        <div class="flex-1 min-w-[200px]"><div class="text-[10px] font-mono uppercase tracking-widest text-rose-300">Sıradaki yüksek önemli veri</div>
          <div class="text-sm text-white font-semibold">${(COUNTRIES[next.country] || {}).flag || ''} ${esc(trTitle(next.title))}</div></div>
        <div class="text-right font-mono"><div class="text-sm text-white">${esc(hhmm(next.time))}</div><div class="text-[11px] text-slate-400">${esc(until(next.time - now))}</div></div>
      </div>` : ''}
      ${state.status === 'partial' ? '<p class="text-[11px] text-amber-300">Dünya verileri şu an alınamadı; yalnızca Türkiye takvimi gösteriliyor.</p>' : ''}
      ${groups.map(g => `
        <section class="rounded-2xl border ${g.key === today ? 'border-[#2F6BFF]/50' : 'border-[#1A2540]'} bg-[#0C1322] overflow-hidden">
          <h3 class="px-4 py-2 text-xs font-bold ${g.key === today ? 'text-[#7FA6FF]' : 'text-slate-300'} bg-[#0A101C] border-b border-[#1A2540] capitalize">${esc(g.label)}${g.key === today ? ' · Bugün' : ''}</h3>
          <div class="divide-y divide-[#162238]">
            ${g.items.map(e => {
              const c = COUNTRIES[e.country] || { name: e.country, flag: '' };
              const past = e.time < now;
              return `<div class="grid grid-cols-[3.2rem_1fr] sm:grid-cols-[3.5rem_7rem_1fr_auto] gap-x-3 gap-y-1 items-center px-4 py-2.5 text-xs ${past ? 'opacity-55' : ''}">
                <span class="font-mono text-slate-300">${esc(hhmm(e.time))}</span>
                <span class="hidden sm:flex items-center gap-1.5 text-slate-400"><span>${c.flag}</span>${esc(c.name)}</span>
                <span class="min-w-0"><span class="flex items-center gap-1.5"><span class="sm:hidden">${c.flag}</span><span class="text-white font-medium">${esc(trTitle(e.title))}</span></span>
                  ${trTitle(e.title) !== e.title ? `<span class="block text-[10px] text-slate-500">${esc(e.title)}</span>` : ''}
                  ${e.note ? `<span class="block text-[10px] text-slate-500">${esc(e.note)}</span>` : ''}</span>
                <span class="col-start-2 sm:col-start-auto flex items-center gap-3 font-mono text-[11px] text-slate-400">
                  <span class="flex gap-0.5" title="Önem">${dots(e.impact)}</span>
                  ${e.forecast ? `<span>Bkl. <b class="text-slate-200">${esc(e.forecast)}</b></span>` : ''}
                  ${e.previous ? `<span>Önc. <b class="text-slate-200">${esc(e.previous)}</b></span>` : ''}
                </span>
              </div>`;
            }).join('')}
          </div>
        </section>`).join('') || '<p class="text-sm text-slate-400 text-center py-10">Bu filtrelerle görünen veri yok.</p>'}
      <p class="text-[10px] text-slate-500 font-mono">Saatler İstanbul saatidir. Dünya verileri: Forex Factory (bu ve gelecek hafta). Türkiye: TCMB'nin 2026 takvimi; TÜİK enflasyonu ayın 3'ü (hafta sonuysa ilk iş günü) kabul edilir. Bkl.: beklenti, Önc.: önceki.</p>`;
  }

  function render() {
    if (!state.loadedAt || Date.now() - state.loadedAt > 15 * 60000) load();
    else paint();
  }

  function init() {
    const view = $('view-calendar');
    if (!view) return;
    view.addEventListener('click', e => {
      const btn = e.target.closest('[data-cal]');
      if (!btn) return;
      const [key, value] = btn.dataset.cal.split(':');
      state[key] = key === 'impact' ? Number(value) : value;
      paint();
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { render, tuikDates, turkishEvents, trTitle };
})();

if (typeof window !== 'undefined') window.EconCalendar = EconCalendar;
