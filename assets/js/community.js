/**
 * Topluluk: a public feed where users share their views on stocks. Posts live in Supabase
 * (supabase/schema.sql: posts, post_likes, post_reports and the community_feed function), read
 * through the same client as accounts (account.js). Anyone can read; posting, liking and
 * reporting need a signed-in account; a user can delete only their own posts. A post may carry
 * the author's chart (pro-chart.js idea), which opens on the chart with its drawings.
 *
 * Post text is the author's: it is escaped before anything is added to it ($THYAO links, line
 * breaks), and names, tickers and chart ideas are checked again here, not only in the database.
 */
const Community = (() => {
  const MAX_BODY = 1000;
  const PAGE = 30;
  const NAME_KEY = 'oncal.community.name';
  const STANCES = {
    al: { label: 'Al', cls: 'bg-emerald-950/60 border-emerald-700/50 text-emerald-300' },
    sat: { label: 'Sat', cls: 'bg-rose-950/60 border-rose-700/50 text-rose-300' },
    notr: { label: 'Nötr', cls: 'bg-slate-800/60 border-slate-600/50 text-slate-300' }
  };
  const TICKER = /^[A-Z0-9]{2,8}$/;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);

  /* ---------- pure helpers (tested in test/community.test.mjs) ---------- */

  /** Escaped post text with $TICKER turned into stock links and line breaks kept. */
  function formatBody(text) {
    return esc(text)
      .replace(/\$([A-Za-z0-9]{2,8})\b/g, (m, code) => {
        const c = code.toUpperCase();
        return `<button type="button" data-cm="stock:${c}" class="text-[#7FA6FF] hover:text-white font-mono font-bold">$${c}</button>`;
      })
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\n/g, '<br>');
  }

  /** "az önce", "5 dk", "3 sa", "2 gün", then the date. */
  function timeAgo(when, now = Date.now()) {
    const t = new Date(when).getTime();
    const s = Math.max(0, (now - t) / 1000);
    if (s < 60) return 'az önce';
    if (s < 3600) return `${Math.floor(s / 60)} dk`;
    if (s < 86400) return `${Math.floor(s / 3600)} sa`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} gün`;
    return new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Istanbul' });
  }

  /** null when the post can go out, else what to fix. */
  function checkPost({ author, body, ticker, stance }) {
    const name = String(author || '').trim();
    if (name.length < 2 || name.length > 30) return 'Görünen ad 2-30 karakter olmalı.';
    const text = String(body || '').trim();
    if (text.length < 3) return 'Biraz daha yaz: en az 3 karakter.';
    if (text.length > MAX_BODY) return `En fazla ${MAX_BODY} karakter yazılabilir.`;
    if (ticker && !TICKER.test(ticker)) return 'Hisse kodu geçersiz (ör. THYAO).';
    if (stance && !STANCES[stance]) return 'Görüş geçersiz.';
    return null;
  }

  /** Default display name from an e-mail address: the part before @, letters and digits only. */
  const nameFromEmail = email => String(email || '').split(/[@+]/)[0].replace(/[^\p{L}\p{N}._-]/gu, '').slice(0, 30);

  /* ---------- state ---------- */

  const state = {
    filter: 'all',          // all | watch | ticker
    ticker: '',
    sort: 'new',            // new | top
    posts: [],
    liked: new Set(),
    reported: new Set(),
    done: false,            // no more pages
    loading: false,
    error: '',
    request: 0
  };

  const db = () => (window.Account && Account.client ? Account.client() : null);
  const me = () => (window.Account && Account.userId ? Account.userId() : null);

  function savedName() {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
  }
  function saveName(v) {
    try { localStorage.setItem(NAME_KEY, v); } catch { /* not remembered */ }
  }

  function trError(e) {
    const m = String((e && e.message) || e || '');
    if (/Saatte en fazla/.test(m)) return m;
    if (/relation .* does not exist|community_feed|schema cache|could not find the function/i.test(m)) return 'Topluluk tabloları henüz kurulmamış (supabase/schema.sql çalıştırılmalı).';
    if (/JWT|not authorized|permission|row-level security/i.test(m)) return 'Bunun için giriş yapmalısın.';
    if (/network|fetch/i.test(m)) return 'Sunucuya ulaşılamadı; bağlantını kontrol et.';
    return 'Bir hata oluştu, birazdan tekrar dene.';
  }

  /* ---------- data ---------- */

  async function load(more = false) {
    const client = db();
    if (!client) return;
    const id = ++state.request;
    state.loading = true;
    state.error = '';
    if (!more) { state.posts = []; state.done = false; }
    paintFeed();
    const watch = typeof getWatchlist === 'function' ? getWatchlist().filter(t => TICKER.test(t)) : [];
    const { data, error } = await client.rpc('community_feed', {
      p_ticker: state.filter === 'ticker' && TICKER.test(state.ticker) ? state.ticker : null,
      p_tickers: state.filter === 'watch' ? watch : null,
      p_sort: state.sort,
      p_limit: PAGE,
      p_offset: more ? state.posts.length : 0
    });
    if (id !== state.request) return;
    state.loading = false;
    if (error) { state.error = trError(error); paintFeed(); return; }
    state.posts = more ? [...state.posts, ...data] : data;
    state.done = data.length < PAGE;
    await loadMine(data.map(p => p.id));
    if (id === state.request) paintFeed();
  }

  /** Which of these posts the viewer liked or reported. */
  async function loadMine(ids) {
    const client = db(), uid = me();
    if (!client || !uid || !ids.length) return;
    const [likes, reports] = await Promise.all([
      client.from('post_likes').select('post_id').eq('user_id', uid).in('post_id', ids),
      client.from('post_reports').select('post_id').eq('user_id', uid).in('post_id', ids)
    ]);
    (likes.data || []).forEach(r => state.liked.add(r.post_id));
    (reports.data || []).forEach(r => state.reported.add(r.post_id));
  }

  async function publish() {
    const client = db();
    const msg = $('cmComposeMsg');
    const say = (t, ok = false) => { if (msg) { msg.textContent = t; msg.className = `text-[11px] ${ok ? 'text-emerald-400' : 'text-rose-400'}`; } };
    if (!client || !me()) { say('Paylaşmak için giriş yapmalısın.'); return; }
    const post = {
      author: $('cmAuthor').value.trim(),
      body: $('cmBody').value.trim(),
      ticker: $('cmTicker').value.trim().toLocaleUpperCase('tr-TR') || null,
      stance: $('cmStance').value || null
    };
    const problem = checkPost(post);
    if (problem) { say(problem); return; }
    if ($('cmIdea') && $('cmIdea').checked && window.ProChart) {
      const idea = ProChart.currentIdea();
      if (idea && idea.length <= 20000) {
        post.idea = idea;
        // A chart is about one stock: the post names it
        post.ticker = post.ticker || ProChart.current().ticker;
      }
    }
    const btn = $('cmPublish');
    btn.disabled = true;
    saveName(post.author);
    const { error } = await client.from('posts').insert(post);
    btn.disabled = false;
    if (error) { say(trError(error)); return; }
    $('cmBody').value = '';
    paintCount();
    say('Paylaşıldı.', true);
    state.sort = 'new';
    load();
  }

  async function toggleLike(id) {
    const client = db(), uid = me();
    if (!client || !uid) { if (window.Account) Account.openModal('login'); return; }
    const post = state.posts.find(p => p.id === id);
    const liked = state.liked.has(id);
    // Show it at once; put it back if the server says no
    liked ? state.liked.delete(id) : state.liked.add(id);
    if (post) post.likes = Number(post.likes) + (liked ? -1 : 1);
    paintFeed();
    const { error } = liked
      ? await client.from('post_likes').delete().eq('post_id', id).eq('user_id', uid)
      : await client.from('post_likes').insert({ post_id: id });
    if (error) {
      liked ? state.liked.add(id) : state.liked.delete(id);
      if (post) post.likes = Number(post.likes) + (liked ? 1 : -1);
      paintFeed();
    }
  }

  async function remove(id) {
    const client = db();
    if (!client || !confirm('Bu paylaşım kalıcı olarak silinsin mi?')) return;
    const { error } = await client.from('posts').delete().eq('id', id).eq('user_id', me());
    if (error) { alert(trError(error)); return; }
    state.posts = state.posts.filter(p => p.id !== id);
    paintFeed();
  }

  async function report(id) {
    const client = db();
    if (!client || !me()) { if (window.Account) Account.openModal('login'); return; }
    if (!confirm('Bu paylaşımı uygunsuz olarak bildirmek istiyor musun? Üç bildirim alan paylaşım gizlenir.')) return;
    const { error } = await client.from('post_reports').insert({ post_id: id });
    if (error && !/duplicate|23505/.test(String(error.code || error.message))) { alert(trError(error)); return; }
    state.reported.add(id);
    paintFeed();
  }

  /* ---------- view ---------- */

  function paintCount() {
    const el = $('cmCount');
    if (el && $('cmBody')) el.textContent = `${$('cmBody').value.length} / ${MAX_BODY}`;
  }

  function paintComposer() {
    const el = $('cmComposer');
    if (!el) return;
    if (!db()) {
      // Accounts still starting: their verity:session event repaints this
      el.innerHTML = window.Account && Account.ready && !Account.ready()
        ? '<p class="text-xs text-slate-500"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Yükleniyor...</p>'
        : '<p class="text-xs text-slate-400">Topluluk için hesap altyapısı bu sitede kurulu değil.</p>';
      return;
    }
    if (!me()) {
      el.innerHTML = `
        <div class="flex flex-wrap items-center gap-3">
          <i class="fa-solid fa-pen-to-square text-[#7FA6FF]"></i>
          <p class="flex-1 min-w-[200px] text-sm text-slate-300">Fikrini paylaşmak, beğenmek ve bildirmek için giriş yap. Okumak için hesap gerekmez.</p>
          <button type="button" data-cm="login" class="px-4 py-2 rounded-xl bg-[#2F6BFF] hover:bg-[#4A7FFF] text-xs font-bold text-white">Giriş yap</button>
        </div>`;
      return;
    }
    const cur = window.ProChart && ProChart.current();
    el.innerHTML = `
      <div class="space-y-3">
        <textarea id="cmBody" rows="3" maxlength="${MAX_BODY}" placeholder="Ne düşünüyorsun? Hisselerden $THYAO gibi bahsedebilirsin."
          class="w-full px-3 py-2.5 rounded-xl bg-[#070B14] border border-[#1A2540] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2F6BFF] resize-y"></textarea>
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <input id="cmAuthor" maxlength="30" placeholder="Görünen ad" aria-label="Görünen ad"
            class="w-32 px-2.5 py-1.5 rounded-lg bg-[#070B14] border border-[#1A2540] text-white">
          <input id="cmTicker" maxlength="8" placeholder="Hisse (isteğe bağlı)" aria-label="Hisse kodu"
            class="w-36 px-2.5 py-1.5 rounded-lg bg-[#070B14] border border-[#1A2540] text-white uppercase placeholder:normal-case font-mono">
          <select id="cmStance" aria-label="Görüş" class="px-2 py-1.5 rounded-lg bg-[#070B14] border border-[#1A2540] text-white">
            <option value="">Görüş yok</option><option value="al">Al</option><option value="sat">Sat</option><option value="notr">Nötr</option>
          </select>
          ${cur ? `<label class="flex items-center gap-1.5 text-slate-400 cursor-pointer" title="Grafikteki çizimlerin, formüllerin ve indikatörlerin paylaşıma eklenir">
            <input id="cmIdea" type="checkbox" class="accent-[#2F6BFF]"> ${esc(cur.ticker)} grafiğimi ekle</label>` : ''}
          <span id="cmCount" class="ml-auto text-[10px] font-mono text-slate-500">0 / ${MAX_BODY}</span>
          <button type="button" id="cmPublish" data-cm="publish" class="px-4 py-1.5 rounded-xl bg-[#2F6BFF] hover:bg-[#4A7FFF] disabled:opacity-60 text-xs font-bold text-white">Paylaş</button>
        </div>
        <p id="cmComposeMsg" class="text-[11px]"></p>
        <p class="text-[10px] text-slate-500">Paylaşımlar herkese açıktır ve yatırım tavsiyesi değildir. Hakaret, spam ve yönlendirme içeren paylaşımlar bildirimlerle gizlenir.</p>
      </div>`;
    // Set as values: the name and the stock come from the viewer
    $('cmAuthor').value = savedName() || nameFromEmail(Account.email());
    if (state.filter === 'ticker') $('cmTicker').value = state.ticker;
  }

  function paintFilters() {
    const el = $('cmFilters');
    if (!el) return;
    const chip = (key, value, text) => {
      const on = state[key] === value;
      return `<button type="button" data-cm="${key}:${value}" aria-pressed="${on}"
        class="px-3 py-1.5 rounded-xl text-xs font-semibold border ${on ? 'bg-[#2F6BFF] border-[#2F6BFF] text-white' : 'border-[#1A2540] text-slate-400 hover:text-white'}">${text}</button>`;
    };
    el.innerHTML = `
      <div class="flex flex-wrap items-center gap-2">
        ${chip('filter', 'all', 'Tümü')}
        ${chip('filter', 'watch', '<i class="fa-solid fa-star text-[10px] mr-1"></i>İzleme listem')}
        <label class="flex items-center gap-1">
          <input id="cmTickerFilter" maxlength="8" placeholder="Hisse ara" aria-label="Hisseye göre filtrele"
            class="w-28 px-2.5 py-1.5 rounded-xl bg-[#070B14] border ${state.filter === 'ticker' ? 'border-[#2F6BFF]' : 'border-[#1A2540]'} text-xs text-white uppercase placeholder:normal-case font-mono">
        </label>
        <span class="ml-auto flex gap-1">${chip('sort', 'new', 'Yeni')}${chip('sort', 'top', 'Popüler')}</span>
        <button type="button" data-cm="refresh" class="px-2.5 py-1.5 rounded-xl border border-[#1A2540] text-slate-400 hover:text-white" title="Yenile" aria-label="Yenile"><i class="fa-solid fa-arrows-rotate text-[11px]"></i></button>
      </div>`;
    $('cmTickerFilter').value = state.filter === 'ticker' ? state.ticker : '';
  }

  function postHtml(p) {
    const mine = p.user_id === me();
    const stance = STANCES[p.stance];
    const liked = state.liked.has(p.id);
    const idea = p.idea && /^[A-Za-z0-9_-]+$/.test(p.idea) && TICKER.test(p.ticker || '') ? p.idea : null;
    return `
      <article class="p-4 rounded-2xl bg-[#0C1322] border border-[#1A2540] space-y-2.5">
        <header class="flex flex-wrap items-center gap-2 text-xs">
          <span class="w-7 h-7 rounded-full bg-[#2F6BFF]/20 border border-[#2F6BFF]/40 text-[#7FA6FF] flex items-center justify-center font-bold">${esc(String(p.author).charAt(0).toLocaleUpperCase('tr-TR'))}</span>
          <span class="font-semibold text-white">${esc(p.author)}</span>
          <span class="text-slate-500">· ${esc(timeAgo(p.created_at))}</span>
          ${TICKER.test(p.ticker || '') ? `<button type="button" data-cm="stock:${p.ticker}" class="px-2 py-0.5 rounded-md bg-[#162238] text-slate-200 font-mono font-bold hover:text-white">${p.ticker}</button>` : ''}
          ${stance ? `<span class="px-2 py-0.5 rounded-md border text-[11px] font-bold ${stance.cls}">${stance.label}</span>` : ''}
        </header>
        <div class="text-sm text-slate-200 leading-relaxed break-words">${formatBody(p.body)}</div>
        <footer class="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <button type="button" data-cm="like:${p.id}" aria-pressed="${liked}" class="flex items-center gap-1.5 ${liked ? 'text-rose-400' : 'hover:text-white'}">
            <i class="fa-${liked ? 'solid' : 'regular'} fa-heart"></i><span>${Number(p.likes) || 0}</span></button>
          ${idea ? `<a href="/hisse/${p.ticker}#fikir=${idea}" class="flex items-center gap-1.5 text-[#7FA6FF] hover:text-white"><i class="fa-solid fa-chart-line"></i>Grafiği aç</a>` : ''}
          <span class="ml-auto flex items-center gap-3">
            ${mine
              ? `<button type="button" data-cm="delete:${p.id}" class="hover:text-rose-400" title="Sil"><i class="fa-solid fa-trash-can"></i></button>`
              : state.reported.has(p.id)
                ? '<span class="text-[10px] text-slate-500">Bildirildi</span>'
                : `<button type="button" data-cm="report:${p.id}" class="hover:text-amber-300" title="Uygunsuz olarak bildir"><i class="fa-regular fa-flag"></i></button>`}
          </span>
        </footer>
      </article>`;
  }

  function paintFeed() {
    const el = $('cmFeed');
    if (!el) return;
    if (!db()) { el.innerHTML = ''; return; }
    const empty = state.filter === 'watch' ? 'İzleme listendeki hisseler hakkında henüz paylaşım yok.'
      : state.filter === 'ticker' ? `${esc(state.ticker)} hakkında henüz paylaşım yok. İlk sen yaz!` : 'Henüz paylaşım yok. İlk sen yaz!';
    el.innerHTML = `
      ${state.posts.map(postHtml).join('')}
      ${state.error ? `<p class="text-sm text-rose-400 text-center py-4">${esc(state.error)}</p>` : ''}
      ${state.loading ? '<p class="text-xs text-slate-500 text-center py-4"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Yükleniyor...</p>' : ''}
      ${!state.loading && !state.error && !state.posts.length ? `<p class="text-sm text-slate-400 text-center py-10">${empty}</p>` : ''}
      ${!state.loading && !state.done && state.posts.length ? '<div class="text-center"><button type="button" data-cm="more" class="px-4 py-2 rounded-xl border border-[#1A2540] text-xs text-slate-300 hover:text-white">Daha fazla</button></div>' : ''}`;
  }

  function render() {
    paintComposer();
    paintFilters();
    paintFeed();
    if (db()) load();
  }

  /** Opens the view filtered to one stock (from the stock page). */
  function openFor(ticker) {
    if (TICKER.test(ticker || '')) { state.filter = 'ticker'; state.ticker = ticker; }
    if (typeof switchView === 'function') switchView('community');
  }

  function onClick(e) {
    const btn = e.target.closest('[data-cm]');
    if (!btn) return;
    const [kind, value] = btn.dataset.cm.split(':');
    if (kind === 'login' && window.Account) Account.openModal('login');
    else if (kind === 'publish') publish();
    else if (kind === 'like') toggleLike(Number(value));
    else if (kind === 'delete') remove(Number(value));
    else if (kind === 'report') report(Number(value));
    else if (kind === 'more') load(true);
    else if (kind === 'refresh') load();
    else if (kind === 'stock' && TICKER.test(value) && typeof selectStock === 'function') selectStock(value);
    else if (kind === 'filter' || kind === 'sort') {
      state[kind] = value;
      paintFilters();
      load();
    }
  }

  function init() {
    const view = $('view-community');
    if (!view) return;
    view.addEventListener('click', onClick);
    view.addEventListener('input', e => { if (e.target.id === 'cmBody') paintCount(); });
    view.addEventListener('keydown', e => {
      if (e.target.id === 'cmTickerFilter' && e.key === 'Enter') {
        const t = e.target.value.trim().toLocaleUpperCase('tr-TR');
        state.filter = TICKER.test(t) ? 'ticker' : 'all';
        state.ticker = TICKER.test(t) ? t : '';
        paintFilters();
        load();
      }
      if (e.target.id === 'cmBody' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) publish();
    });
    // Signed in or out, or the client became ready: repaint if the view is on screen
    window.addEventListener('verity:session', () => {
      state.liked.clear();
      state.reported.clear();
      if (typeof appState !== 'undefined' && appState.activeView === 'community') render();
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { render, openFor, formatBody, timeAgo, checkPost, nameFromEmail };
})();

if (typeof window !== 'undefined') window.Community = Community;
