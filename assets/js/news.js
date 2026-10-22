/**
 * Market news: real, current headlines (Google News RSS through /api/news).
 * Each card shows headline, publisher and time, and links to the publisher's article.
 */
const NewsFeed = (() => {
  const CATEGORIES = {
    all: 'Piyasa', monetary: 'TCMB ve Faiz', energy: 'Enerji ve Emtia', macro: 'Küresel Fed ve Makro',
    defense: 'Savunma ve Havacılık', industry: 'Sanayi ve İhracat', tech: 'Yapay Zeka ve Bilişim', retail: 'Perakende ve Tüketim'
  };
  const state = { cat: 'all', query: '', items: [], status: 'idle', fetchedAt: 0 };
  const cache = new Map();   // cat -> Promise<body>

  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Feed links are third-party: only http(s) may become an href (no javascript:, data:, ...)
  const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '#');

  function ago(ms) {
    const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (min < 1) return 'Az önce';
    if (min < 60) return `${min} dakika önce`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} saat önce`;
    const d = Math.round(h / 24);
    return `${d} gün önce`;
  }

  async function load(cat) {
    if (!cache.has(cat)) {
      const p = fetch(`/api/news?cat=${encodeURIComponent(cat)}`)
        .then(r => { if (!r.ok) throw new Error(`news ${r.status}`); return r.json(); });
      p.catch(() => cache.delete(cat));
      cache.set(cat, p);
      setTimeout(() => cache.delete(cat), 5 * 60 * 1000);
    }
    return cache.get(cat);
  }

  const visible = () => {
    const q = state.query.toLowerCase().trim();
    return q ? state.items.filter(i => i.title.toLowerCase().includes(q) || (i.source || '').toLowerCase().includes(q)) : state.items;
  };

  function cardHtml(item, compact) {
    const cat = CATEGORIES[item.cat] || CATEGORIES[state.cat] || 'Piyasa';
    return `
      <article class="utl-card p-5 flex flex-col justify-between gap-3 hover:border-red-500/50 transition-all duration-200 group">
        <div class="space-y-2.5">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <span class="text-[10px] font-mono font-bold uppercase tracking-wider text-red-400 bg-red-950/40 px-2.5 py-0.5 rounded-md border border-red-800/40">${esc(cat)}</span>
            <span class="text-[11px] font-mono text-slate-400 flex items-center gap-1"><i class="fa-regular fa-clock text-slate-500 text-[10px]"></i>${esc(ago(item.date))}</span>
          </div>
          <a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer" class="block font-serif font-bold text-white ${compact ? 'text-base line-clamp-3' : 'text-lg'} leading-snug group-hover:text-red-300 transition-colors">${esc(item.title)}</a>
        </div>
        <div class="pt-3 border-t border-[#162238] flex items-center justify-between text-xs">
          <span class="text-[11px] font-mono text-slate-400 truncate">${esc(item.source || 'Kaynak')}</span>
          <a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer" class="text-red-400 hover:text-red-300 font-bold flex items-center gap-1 flex-shrink-0 ml-2">
            <span>Habere git</span><i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
          </a>
        </div>
      </article>`;
  }

  function paintCenter() {
    const box = document.getElementById('newsCardsContainer');
    const count = document.getElementById('newsTotalCount');
    if (!box) return;
    if (state.status === 'loading') {
      box.innerHTML = '<div class="col-span-full py-16 text-center text-xs font-mono text-slate-500">Haberler yükleniyor...</div>';
      return;
    }
    if (state.status === 'error') {
      box.innerHTML = '<div class="col-span-full py-16 text-center utl-card text-sm text-amber-400 font-mono">Haber akışı şu an alınamadı. Birazdan tekrar deneyin.</div>';
      if (count) count.textContent = 'Haber alınamadı';
      return;
    }
    const list = visible();
    if (count) count.textContent = `${list.length} Haber Listeleniyor`;
    const total = document.getElementById('newsStatNumber');
    if (total) total.textContent = String(list.length);
    box.innerHTML = list.length
      ? list.map(i => cardHtml(i, false)).join('')
      : '<div class="col-span-full py-16 text-center utl-card text-sm text-slate-400">Aramanıza uygun haber bulunamadı.</div>';
  }

  function paintPreview() {
    const box = document.getElementById('overviewNewsPreviewContainer');
    if (!box) return;
    if (state.status === 'error') {
      box.innerHTML = '<div class="col-span-full py-8 text-center text-xs text-amber-400 font-mono">Haber akışı şu an alınamadı.</div>';
      return;
    }
    box.innerHTML = state.status === 'loading' || !state.items.length
      ? '<div class="col-span-full py-8 text-center text-xs font-mono text-slate-500">Haberler yükleniyor...</div>'
      : state.items.slice(0, 3).map(i => cardHtml(i, true)).join('');
  }

  async function refresh(cat = state.cat) {
    state.cat = cat;
    state.status = 'loading';
    paintCenter();
    try {
      const body = await load(cat);
      if (state.cat !== cat) return;
      state.items = body.items.map(i => ({ ...i, cat }));
      state.fetchedAt = body.fetchedAt;
      state.status = 'ready';
    } catch (e) {
      console.warn('[News] unavailable:', e.message);
      if (state.cat !== cat) return;
      state.items = [];
      state.status = 'error';
    }
    paintCenter();
    if (cat === 'all') paintPreview();
  }

  /** Overview preview always shows the general market feed. */
  async function loadPreview() {
    try {
      const body = await load('all');
      const items = body.items.map(i => ({ ...i, cat: 'all' }));
      const box = document.getElementById('overviewNewsPreviewContainer');
      if (box) box.innerHTML = items.slice(0, 3).map(i => cardHtml(i, true)).join('');
    } catch {
      state.status = 'error';
      paintPreview();
    }
  }

  function setCategoryButtons(cat) {
    document.querySelectorAll('.news-cat-tab').forEach(b => {
      const on = b.getAttribute('data-news-cat') === cat;
      b.classList.toggle('bg-[#2F6BFF]', on);
      b.classList.toggle('text-white', on);
      b.classList.toggle('shadow-md', on);
      b.classList.toggle('shadow-red-600/30', on);
      b.classList.toggle('bg-[#070B14]', !on);
      b.classList.toggle('text-slate-400', !on);
      b.classList.toggle('border', !on);
      b.classList.toggle('border-[#1A2540]', !on);
    });
  }

  function init() {
    document.querySelectorAll('.news-cat-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.getAttribute('data-news-cat') || 'all';
        setCategoryButtons(cat);
        refresh(cat);
      });
    });
    const input = document.getElementById('newsSearchInput');
    if (input) {
      let timer;
      input.addEventListener('input', e => {
        clearTimeout(timer);
        timer = setTimeout(() => { state.query = e.target.value; paintCenter(); }, 120);
      });
    }
    refresh('all');
    loadPreview();
  }

  function reset() {
    state.query = '';
    const input = document.getElementById('newsSearchInput');
    if (input) input.value = '';
    setCategoryButtons('all');
    refresh('all');
  }

  return { init, refresh, reset, paintCenter, loadPreview, state };
})();

window.NewsFeed = NewsFeed;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', NewsFeed.init);
else NewsFeed.init();
