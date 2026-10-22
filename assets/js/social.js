/**
 * Social media: recent public posts about BIST (Telegram channel previews, r/Borsa, Mastodon
 * #bist100) through /api/social. Posts are third parties' words, shown as escaped plain text with
 * a link to the original; each is tagged with the BIST codes it mentions (assets/js/social-tags.js).
 * A source that cannot be fetched is shown as "alınamadı", never filled in.
 */
const SocialFeed = (() => {
  const KIND = {
    telegram: { label: 'Telegram', icon: 'fa-brands fa-telegram', cls: 'text-sky-400 bg-sky-950/40 border-sky-800/40' },
    reddit: { label: 'Reddit', icon: 'fa-brands fa-reddit-alien', cls: 'text-orange-400 bg-orange-950/40 border-orange-800/40' },
    mastodon: { label: 'Mastodon', icon: 'fa-brands fa-mastodon', cls: 'text-violet-400 bg-violet-950/40 border-violet-800/40' }
  };
  const DAY = 24 * 60 * 60 * 1000;
  const state = { status: 'idle', items: [], sources: [], fetchedAt: 0, channel: 'all', ticker: '', query: '' };
  let pending = null;
  let loadedAt = 0;
  let codeSet = null;

  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Post links are third-party: only http(s) may become an href (no javascript:, data:, ...)
  const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '#');

  function codes() {
    if (!codeSet) codeSet = new Set(typeof KAP_RAW_COMPANIES !== 'undefined' ? KAP_RAW_COMPANIES.map(c => c.c) : []);
    return codeSet;
  }

  function ago(ms) {
    const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (min < 1) return 'Az önce';
    if (min < 60) return `${min} dakika önce`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} saat önce`;
    return `${Math.round(h / 24)} gün önce`;
  }

  /** One request per 5 minutes at most; every caller shares it. */
  function load(force = false) {
    if (!force && pending && Date.now() - loadedAt < 5 * 60 * 1000) return pending;
    loadedAt = Date.now();
    pending = fetch('/api/social')
      .then(r => r.json().then(body => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) { const e = new Error('social unavailable'); e.sources = body && body.sources; throw e; }
        body.items.forEach(p => { p.tickers = SocialTags.extractTickers(p.text, codes()); });
        return body;
      });
    pending.catch(() => { pending = null; });
    return pending;
  }

  const visible = () => {
    const q = state.query.toLocaleLowerCase('tr').trim();
    return state.items.filter(p =>
      (state.channel === 'all' || p.channel === state.channel) &&
      (!state.ticker || p.tickers.includes(state.ticker)) &&
      (!q || p.text.toLocaleLowerCase('tr').includes(q) || (p.author || '').toLocaleLowerCase('tr').includes(q)));
  };

  function tickerChips(p, active) {
    const shown = p.tickers.length > 8 ? [...new Set([active, ...p.tickers].filter(c => p.tickers.includes(c)))].slice(0, 8) : p.tickers;
    const more = p.tickers.length - shown.length;
    return shown.map(c => `<button type="button" data-social-ticker="${esc(c)}" class="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border transition-colors ${c === active ? 'bg-[#2F6BFF] text-white border-[#2F6BFF]' : 'bg-[#070B14] text-slate-300 border-[#1A2540] hover:border-red-500/60'}">${esc(c)}</button>`).join('') +
      (more > 0 ? `<span class="px-1.5 py-0.5 text-[10px] font-mono text-slate-500">+${more} kod</span>` : '');
  }

  function cardHtml(p, compact, active = state.ticker) {
    const k = KIND[p.source] || KIND.telegram;
    return `
      <article class="utl-card p-5 flex flex-col justify-between gap-3 hover:border-red-500/50 transition-all duration-200">
        <div class="space-y-2.5 min-w-0">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <span class="text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-md border ${k.cls}"><i class="${k.icon} mr-1"></i>${esc(p.channel)}</span>
            <span class="text-[11px] font-mono text-slate-400 flex items-center gap-1" title="${esc(new Date(p.date).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }))}"><i class="fa-regular fa-clock text-slate-500 text-[10px]"></i>${esc(ago(p.date))}</span>
          </div>
          <p class="text-sm text-slate-200 leading-relaxed whitespace-pre-line break-words ${compact ? 'line-clamp-4' : 'line-clamp-[12]'}">${esc(p.text)}</p>
          ${p.tickers.length ? `<div class="flex flex-wrap gap-1.5">${tickerChips(p, active)}</div>` : ''}
        </div>
        <div class="pt-3 border-t border-[#162238] flex items-center justify-between text-xs">
          <span class="text-[11px] font-mono text-slate-400 truncate">${esc(p.author || k.label)}</span>
          <a href="${safeUrl(p.url)}" target="_blank" rel="noopener noreferrer" class="text-red-400 hover:text-red-300 font-bold flex items-center gap-1 flex-shrink-0 ml-2">
            <span>Gönderiye git</span><i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
          </a>
        </div>
      </article>`;
  }

  function paintSources() {
    const box = document.getElementById('socialSourcesStatus');
    if (!box) return;
    box.innerHTML = state.sources.map(s => {
      const k = KIND[s.kind] || KIND.telegram;
      return `<a href="${safeUrl(s.home)}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-xl bg-[#0C1322] border border-[#1A2540] flex items-center gap-2 text-[11px] font-mono hover:border-red-500/50">
        <i class="${k.icon} ${k.cls.split(' ')[0]}"></i><span class="text-white font-bold">${esc(s.name)}</span>
        ${s.ok ? `<span class="text-emerald-400">${s.count} gönderi</span>` : '<span class="text-amber-400">alınamadı</span>'}
      </a>`;
    }).join('');
  }

  function paintChannels() {
    const box = document.getElementById('socialChannelTabs');
    if (!box) return;
    const tabs = [{ id: 'all', name: 'Tüm Kaynaklar' }, ...state.sources.filter(s => s.ok).map(s => ({ id: s.name, name: s.name }))];
    box.innerHTML = '<span class="text-[11px] font-mono text-slate-500 uppercase mr-1 flex-shrink-0">Kaynak:</span>' + tabs.map(t => {
      const on = t.id === state.channel;
      return `<button type="button" data-social-channel="${esc(t.id)}" class="px-3.5 py-1.5 rounded-xl transition-all flex-shrink-0 font-medium ${on ? 'bg-[#2F6BFF] text-white shadow-md' : 'bg-[#070B14] text-slate-400 hover:text-white border border-[#1A2540]'}">${esc(t.name)}</button>`;
    }).join('');
  }

  function paintTop() {
    const box = document.getElementById('socialTopMentions');
    if (!box) return;
    const top = SocialTags.topMentions(state.items, Date.now() - DAY, 12);
    box.innerHTML = top.length
      ? top.map(t => `<button type="button" data-social-ticker="${esc(t.code)}" class="px-3 py-2 rounded-xl border text-xs font-mono flex items-center gap-2 transition-colors ${t.code === state.ticker ? 'bg-[#2F6BFF] border-[#2F6BFF] text-white' : 'bg-[#070B14] border-[#1A2540] text-slate-200 hover:border-red-500/60'}"><span class="font-bold">${esc(t.code)}</span><span class="text-[10px] ${t.code === state.ticker ? 'text-white' : 'text-slate-400'}">${t.count} gönderi</span></button>`).join('')
      : '<span class="text-xs text-slate-500 font-mono">Son 24 saatte hisse kodu geçen gönderi yok.</span>';
  }

  function paintCards() {
    const box = document.getElementById('socialCardsContainer');
    const count = document.getElementById('socialTotalCount');
    if (!box) return;
    if (state.status === 'loading') {
      box.innerHTML = '<div class="col-span-full py-16 text-center text-xs font-mono text-slate-500">Gönderiler yükleniyor...</div>';
      if (count) count.textContent = 'Yükleniyor...';
      return;
    }
    if (state.status === 'error') {
      box.innerHTML = '<div class="col-span-full py-16 text-center utl-card text-sm text-amber-400 font-mono">Sosyal medya kaynakları şu an alınamadı. Birazdan tekrar deneyin.</div>';
      if (count) count.textContent = 'Alınamadı';
      return;
    }
    const list = visible();
    if (count) count.textContent = `${list.length} / ${state.items.length} gönderi`;
    const clear = document.getElementById('socialTickerClear');
    if (clear) clear.classList.toggle('hidden', !state.ticker);
    box.innerHTML = list.length
      ? list.map(p => cardHtml(p, false)).join('')
      : '<div class="col-span-full py-16 text-center utl-card text-sm text-slate-400">Bu filtrelere uygun gönderi yok.</div>';
  }

  function paint() {
    paintSources();
    paintChannels();
    paintTop();
    paintCards();
  }

  async function refresh(force = false) {
    state.status = 'loading';
    paintCards();
    try {
      const body = await load(force);
      Object.assign(state, { status: 'ready', items: body.items, sources: body.sources, fetchedAt: body.fetchedAt });
    } catch (e) {
      console.warn('[Social] unavailable:', e.message);
      Object.assign(state, { status: 'error', items: [], sources: e.sources || [] });
    }
    paint();
    const t = document.getElementById('socialFetchedAt');
    if (t) t.textContent = state.fetchedAt ? new Date(state.fetchedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) : '—';
  }

  function setTicker(code) {
    state.ticker = state.ticker === code ? '' : code;
    const input = document.getElementById('socialTickerInput');
    if (input) input.value = state.ticker;
    paintTop();
    paintCards();
  }

  /** Small card on the stock page: the latest posts that mention this code. */
  async function showForStock(code) {
    const box = document.getElementById('stockSocialContainer');
    if (!box) return;
    box.innerHTML = '<div class="py-6 text-center text-xs font-mono text-slate-500">Sosyal medya gönderileri yükleniyor...</div>';
    try {
      const body = await load();
      if (appState.currentStock !== code) return;
      const posts = body.items.filter(p => p.tickers.includes(code)).slice(0, 4);
      box.innerHTML = posts.length
        ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">${posts.map(p => cardHtml(p, true, code)).join('')}</div>`
        : `<div class="py-6 text-center text-xs text-slate-500 font-mono">Son 7 günde izlenen kanallarda ${esc(code)} geçen gönderi yok.</div>`;
    } catch {
      if (appState.currentStock === code) box.innerHTML = '<div class="py-6 text-center text-xs text-amber-400 font-mono">Sosyal medya gönderileri şu an alınamadı.</div>';
    }
  }

  function init() {
    const view = document.getElementById('view-social');
    if (view) {
      view.addEventListener('click', e => {
        const t = e.target.closest('[data-social-ticker]');
        if (t) { setTicker(t.getAttribute('data-social-ticker')); return; }
        const c = e.target.closest('[data-social-channel]');
        if (c) { state.channel = c.getAttribute('data-social-channel'); paintChannels(); paintCards(); }
      });
    }
    // A code on the stock page card opens the social view filtered to that code
    const stockBox = document.getElementById('stockSocialContainer');
    if (stockBox) {
      stockBox.addEventListener('click', e => {
        const t = e.target.closest('[data-social-ticker]');
        if (!t) return;
        state.ticker = '';
        setTicker(t.getAttribute('data-social-ticker'));
        switchView('social');
      });
    }
    const search = document.getElementById('socialSearchInput');
    if (search) {
      let timer;
      search.addEventListener('input', e => {
        clearTimeout(timer);
        timer = setTimeout(() => { state.query = e.target.value; paintCards(); }, 120);
      });
    }
    const ticker = document.getElementById('socialTickerInput');
    if (ticker) {
      ticker.addEventListener('input', e => {
        const v = e.target.value.trim().toUpperCase();
        state.ticker = codes().has(v) ? v : '';
        paintTop();
        paintCards();
      });
    }
    const clear = document.getElementById('socialTickerClear');
    if (clear) clear.addEventListener('click', () => setTicker(state.ticker));
    const again = document.getElementById('socialRefreshBtn');
    if (again) again.addEventListener('click', () => refresh(true));
  }

  /** Called when the view is opened: the first visit loads, later visits repaint. */
  function render() {
    if (state.status === 'idle' || state.status === 'error') refresh();
    else paint();
  }

  return { init, render, refresh, showForStock, state };
})();

window.SocialFeed = SocialFeed;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', SocialFeed.init);
else SocialFeed.init();
