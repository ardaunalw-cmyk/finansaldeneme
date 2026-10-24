/**
 * Sanal Portföy Yarışması: trade Borsa İstanbul stocks with 100.000 TL of play money and race the
 * other players. Orders go to Supabase (supabase/schema.sql: paper_players, paper_trades), where a
 * trigger fills them at the price in market_prices (written every 15 minutes in trading hours by
 * scripts/update-prices.mjs) and refuses spending more cash or selling more lots than held. The
 * leaderboard is the paper_leaderboard function, readable by anyone.
 */
const Contest = (() => {
  const START = 100000;
  const NAME_KEY = 'oncal.community.name';
  const TICKER = /^[A-Z0-9]{2,8}$/;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tl = v => (Number.isFinite(v) ? `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—');
  const pct = v => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '—');
  const tone = v => (!Number.isFinite(v) ? 'text-slate-300' : v >= 0 ? 'text-emerald-400' : 'text-rose-400');

  /**
   * The player's book from their orders (oldest first): cash, and per stock the lots and the
   * average cost of the lots still held (a sale takes lots at that average, so it stays put).
   */
  function book(trades) {
    let cash = START;
    const pos = {};
    trades.forEach(t => {
      const p = pos[t.ticker] || (pos[t.ticker] = { ticker: t.ticker, qty: 0, cost: 0 });
      const amount = t.qty * Number(t.price);
      if (t.side === 'buy') { cash -= amount; p.cost += amount; p.qty += t.qty; }
      else { const avg = p.qty ? p.cost / p.qty : 0; cash += amount; p.cost -= avg * t.qty; p.qty -= t.qty; }
    });
    const positions = Object.values(pos).filter(p => p.qty > 0).map(p => ({ ...p, avg: p.cost / p.qty }));
    return { cash, positions };
  }

  /** Value at the given prices ({ TICKER: price }); a stock with no price counts at its cost. */
  function value(b, prices) {
    return b.cash + b.positions.reduce((s, p) => s + p.qty * (Number.isFinite(prices[p.ticker]) ? prices[p.ticker] : p.avg), 0);
  }

  const state = { player: null, trades: [], prices: {}, board: [], status: 'idle', error: '', quote: null };
  const db = () => (window.Account && Account.client ? Account.client() : null);
  const me = () => (window.Account && Account.userId ? Account.userId() : null);

  function trError(e) {
    const m = String((e && e.message) || e || '');
    if (/Yetersiz nakit|lot yok|güncel fiyat|katılmalısın|Dakikada/.test(m)) return m;
    if (/does not exist|schema cache|could not find/i.test(m)) return 'Yarışma tabloları henüz kurulmamış.';
    if (/JWT|permission|row-level/i.test(m)) return 'Bunun için giriş yapmalısın.';
    return 'Bir hata oluştu, birazdan tekrar dene.';
  }

  async function loadPrices(tickers) {
    const list = [...new Set(tickers)].filter(t => TICKER.test(t));
    if (!list.length || !db()) return;
    const { data } = await db().from('market_prices').select('ticker,price,updated_at').in('ticker', list);
    (data || []).forEach(r => { state.prices[r.ticker] = Number(r.price); state.pricesAt = r.updated_at; });
  }

  async function load() {
    const client = db();
    if (!client) { state.status = 'off'; paint(); return; }
    state.status = 'loading';
    paint();
    const board = await client.rpc('paper_leaderboard', { p_limit: 50 });
    if (board.error) { state.status = 'error'; state.error = trError(board.error); paint(); return; }
    state.board = board.data || [];
    state.player = null;
    state.trades = [];
    if (me()) {
      const [pl, tr] = await Promise.all([
        client.from('paper_players').select('author,started_at').eq('user_id', me()).maybeSingle(),
        client.from('paper_trades').select('id,ticker,side,qty,price,created_at').eq('user_id', me()).order('created_at', { ascending: true }).limit(2000)
      ]);
      state.player = pl.data || null;
      state.trades = tr.data || [];
      await loadPrices(state.trades.map(t => t.ticker));
    }
    state.status = 'ok';
    paint();
  }

  async function join() {
    const name = ($('ctName') && $('ctName').value.trim()) || '';
    if (name.length < 2 || name.length > 30) { say('Görünen ad 2-30 karakter olmalı.'); return; }
    try { localStorage.setItem(NAME_KEY, name); } catch { /* not remembered */ }
    const { error } = await db().from('paper_players').insert({ author: name });
    if (error) { say(trError(error)); return; }
    load();
  }

  async function quote() {
    const t = ($('ctTicker').value || '').trim().toLocaleUpperCase('tr-TR');
    $('ctTicker').value = t;
    state.quote = null;
    if (TICKER.test(t)) {
      await loadPrices([t]);
      if (Number.isFinite(state.prices[t])) state.quote = { ticker: t, price: state.prices[t] };
    }
    paintQuote();
  }

  function paintQuote() {
    const el = $('ctQuote');
    if (!el) return;
    const q = state.quote;
    const qty = Math.floor(Number($('ctQty') && $('ctQty').value) || 0);
    if (!q) { el.innerHTML = ($('ctTicker') && $('ctTicker').value) ? '<span class="text-amber-300">Bu kod için fiyat yok (BIST hisse kodu yaz, ör. THYAO).</span>' : ''; return; }
    const b = book(state.trades);
    const held = (b.positions.find(p => p.ticker === q.ticker) || {}).qty || 0;
    const maxBuy = Math.floor(b.cash / q.price);
    el.innerHTML = `<span class="text-white font-bold">${esc(q.ticker)}</span> fiyat <b class="text-white">${tl(q.price)}</b>
      · tutar <b class="text-white">${tl(qty * q.price)}</b> · en fazla alınabilir <button type="button" data-ct="max" class="text-[#7FA6FF] underline">${maxBuy.toLocaleString('tr-TR')} lot</button>
      ${held ? `· elindeki <b class="text-white">${held.toLocaleString('tr-TR')} lot</b>` : ''}`;
  }

  async function order(side) {
    const ticker = ($('ctTicker').value || '').trim().toLocaleUpperCase('tr-TR');
    const qty = Math.floor(Number($('ctQty').value));
    if (!TICKER.test(ticker)) { say('Geçerli bir hisse kodu yaz.'); return; }
    if (!(qty > 0)) { say('Lot sayısı en az 1 olmalı.'); return; }
    const btns = document.querySelectorAll('[data-ct="buy"],[data-ct="sell"]');
    btns.forEach(b => { b.disabled = true; });
    const { data, error } = await db().from('paper_trades').insert({ ticker, side, qty }).select('price').single();
    btns.forEach(b => { b.disabled = false; });
    if (error) { say(trError(error)); return; }
    say(`${ticker}: ${qty.toLocaleString('tr-TR')} lot ${side === 'buy' ? 'alındı' : 'satıldı'}, fiyat ${tl(Number(data.price))}.`, true);
    $('ctQty').value = '';
    load();
  }

  async function reset() {
    if (!confirm('Tüm emirlerin silinecek ve 100.000 TL ile baştan başlayacaksın. Emin misin?')) return;
    const { error } = await db().rpc('paper_reset');
    if (error) { say(trError(error)); return; }
    load();
  }

  function say(text, ok = false) {
    const el = $('ctMsg');
    if (el) { el.textContent = text; el.className = `text-[11px] ${ok ? 'text-emerald-400' : 'text-rose-400'}`; }
  }

  function boardHtml() {
    return `
      <section class="rounded-2xl border border-[#1A2540] bg-[#0C1322] overflow-hidden">
        <h3 class="px-4 py-2.5 text-xs font-bold text-slate-200 bg-[#0A101C] border-b border-[#1A2540] flex items-center gap-2"><i class="fa-solid fa-trophy text-amber-400 text-[11px]"></i>Sıralama</h3>
        ${state.board.length ? `<table class="w-full text-[11px] font-mono">
          <thead class="text-slate-500"><tr><th class="py-1.5 px-3 text-left">#</th><th class="py-1.5 text-left">Oyuncu</th><th class="py-1.5 px-2 text-right">Değer</th><th class="py-1.5 px-3 text-right">Getiri</th></tr></thead>
          <tbody>${state.board.map(r => `<tr class="border-t border-[#162238] ${r.is_me ? 'bg-[#2F6BFF]/10' : ''}">
            <td class="py-1.5 px-3 ${Number(r.rank) <= 3 ? 'text-amber-300 font-bold' : 'text-slate-400'}">${Number(r.rank)}</td>
            <td class="py-1.5 text-white font-sans truncate max-w-[9rem]">${esc(r.author)}${r.is_me ? ' <span class="text-[#7FA6FF]">(sen)</span>' : ''}<span class="block text-[10px] text-slate-500 font-mono">${Number(r.trades)} emir</span></td>
            <td class="py-1.5 px-2 text-right text-slate-200">${tl(Number(r.value))}</td>
            <td class="py-1.5 px-3 text-right ${tone(Number(r.ret))}">${pct(Number(r.ret))}</td></tr>`).join('')}</tbody></table>`
          : '<p class="text-xs text-slate-400 text-center py-8">Henüz oyuncu yok. İlk sen katıl!</p>'}
      </section>`;
  }

  function playerHtml() {
    if (!me()) {
      return `<section class="p-5 rounded-2xl border border-[#1A2540] bg-[#0C1322] space-y-3">
        <p class="text-sm text-slate-300">Yarışmaya katılmak için giriş yap. Herkes 100.000 TL sanal parayla başlar; gerçek para kullanılmaz.</p>
        <button type="button" data-ct="login" class="px-4 py-2 rounded-xl bg-[#2F6BFF] hover:bg-[#4A7FFF] text-xs font-bold text-white">Giriş yap</button></section>`;
    }
    if (!state.player) {
      let name = '';
      try { name = localStorage.getItem(NAME_KEY) || ''; } catch { /* none */ }
      return `<section class="p-5 rounded-2xl border border-[#2F6BFF]/40 bg-[#2F6BFF]/10 space-y-3">
        <div class="text-sm font-bold text-white">100.000 TL sanal parayla başla</div>
        <p class="text-xs text-slate-300">Borsa İstanbul hisselerini gecikmeli gerçek fiyatlarla al-sat, sıralamada yerini gör. Adın sıralamada görünür.</p>
        <div class="flex flex-wrap gap-2">
          <input id="ctName" maxlength="30" value="${esc(name)}" placeholder="Görünen ad" class="w-44 px-3 py-2 rounded-xl bg-[#070B14] border border-[#1A2540] text-white text-sm">
          <button type="button" data-ct="join" class="px-4 py-2 rounded-xl bg-[#2F6BFF] hover:bg-[#4A7FFF] text-xs font-bold text-white">Yarışmaya katıl</button>
        </div>
        <p id="ctMsg" class="text-[11px]"></p></section>`;
    }
    const b = book(state.trades);
    const v = value(b, state.prices);
    const rank = (state.board.find(r => r.is_me) || {}).rank;
    const card = (label, val, cls = 'text-white') => `<div class="p-3 rounded-xl bg-[#070B14] border border-[#1A2540] min-w-0"><div class="text-[10px] font-mono uppercase tracking-wide text-slate-400">${label}</div><div class="text-lg font-mono font-bold ${cls}">${val}</div></div>`;
    return `
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        ${card('Toplam değer', tl(v))}${card('Getiri', pct((v / START - 1) * 100), tone(v - START))}
        ${card('Nakit', tl(b.cash))}${card('Sıra', rank ? `${Number(rank)}.` : '—', 'text-amber-300')}
      </div>
      <section class="p-4 rounded-2xl border border-[#1A2540] bg-[#0C1322] space-y-2">
        <div class="text-xs font-bold text-white">Emir ver</div>
        <div class="flex flex-wrap items-center gap-2">
          <input id="ctTicker" maxlength="8" placeholder="Hisse (ör. THYAO)" class="w-36 px-3 py-2 rounded-xl bg-[#070B14] border border-[#1A2540] text-white uppercase placeholder:normal-case font-mono text-sm">
          <input id="ctQty" type="number" min="1" step="1" placeholder="Lot" class="w-28 px-3 py-2 rounded-xl bg-[#070B14] border border-[#1A2540] text-white font-mono text-sm">
          <button type="button" data-ct="buy" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-xs font-bold text-white">AL</button>
          <button type="button" data-ct="sell" class="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-xs font-bold text-white">SAT</button>
        </div>
        <div id="ctQuote" class="text-[11px] text-slate-400"></div>
        <p id="ctMsg" class="text-[11px]"></p>
      </section>
      <section class="rounded-2xl border border-[#1A2540] bg-[#0C1322] overflow-hidden">
        <h3 class="px-4 py-2.5 text-xs font-bold text-slate-200 bg-[#0A101C] border-b border-[#1A2540]">Portföyüm</h3>
        ${b.positions.length ? `<div class="overflow-x-auto"><table class="w-full text-[11px] font-mono">
          <thead class="text-slate-500"><tr><th class="py-1.5 px-3 text-left">Hisse</th><th class="px-2 text-right">Lot</th><th class="px-2 text-right">Ort. maliyet</th><th class="px-2 text-right">Fiyat</th><th class="px-2 text-right">Değer</th><th class="px-3 text-right">K/Z</th></tr></thead>
          <tbody>${b.positions.map(p => {
            const px = state.prices[p.ticker];
            const val = p.qty * (Number.isFinite(px) ? px : p.avg);
            const pl = Number.isFinite(px) ? (px / p.avg - 1) * 100 : null;
            return `<tr class="border-t border-[#162238]"><td class="py-1.5 px-3"><button type="button" data-ct-pick="${esc(p.ticker)}" class="text-white font-bold hover:text-[#7FA6FF]">${esc(p.ticker)}</button></td>
              <td class="px-2 text-right text-slate-200">${p.qty.toLocaleString('tr-TR')}</td><td class="px-2 text-right text-slate-300">${tl(p.avg)}</td>
              <td class="px-2 text-right text-slate-200">${tl(px)}</td><td class="px-2 text-right text-white">${tl(val)}</td><td class="px-3 text-right ${tone(pl)}">${pct(pl)}</td></tr>`;
          }).join('')}</tbody></table></div>` : '<p class="text-xs text-slate-400 text-center py-6">Henüz hisse yok. Yukarıdan ilk emrini ver.</p>'}
      </section>
      ${state.trades.length ? `<details class="rounded-2xl border border-[#1A2540] bg-[#0C1322]"><summary class="px-4 py-2.5 text-xs font-bold text-slate-200 cursor-pointer">Emir geçmişi (${state.trades.length})</summary>
        <div class="max-h-64 overflow-y-auto"><table class="w-full text-[11px] font-mono"><tbody>${state.trades.slice().reverse().slice(0, 100).map(t => `<tr class="border-t border-[#162238]">
          <td class="py-1 px-3 text-slate-400">${new Date(t.created_at).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
          <td class="px-2 ${t.side === 'buy' ? 'text-emerald-400' : 'text-rose-400'}">${t.side === 'buy' ? 'AL' : 'SAT'}</td><td class="px-2 text-white">${esc(t.ticker)}</td>
          <td class="px-2 text-right text-slate-200">${Number(t.qty).toLocaleString('tr-TR')}</td><td class="px-3 text-right text-slate-300">${tl(Number(t.price))}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      <div class="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500 font-mono">
        <span>Oyuncu: ${esc(state.player.author)} · başlangıç ${new Date(state.player.started_at).toLocaleDateString('tr-TR')}</span>
        <button type="button" data-ct="reset" class="px-3 py-1.5 rounded-xl border border-[#1A2540] text-slate-400 hover:text-rose-300">Baştan başla</button>
      </div>`;
  }

  function paint() {
    const el = $('ctBody');
    if (!el) return;
    if (state.status === 'off') { el.innerHTML = '<p class="text-sm text-slate-400">Yarışma için hesap altyapısı bu sitede kurulu değil.</p>'; return; }
    if (state.status === 'loading' && !state.board.length) { el.innerHTML = '<p class="text-xs text-slate-500 text-center py-10"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Yükleniyor...</p>'; return; }
    if (state.status === 'error') { el.innerHTML = `<p class="text-sm text-rose-400 text-center py-10">${esc(state.error)}</p>`; return; }
    el.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-5 items-start">
        <div class="space-y-4">${playerHtml()}</div>
        <div class="space-y-2">${boardHtml()}
          <p class="text-[10px] text-slate-500 font-mono leading-relaxed">Emirler, işlem saatlerinde 15 dakikada bir güncellenen gecikmeli fiyattan anında gerçekleşir; komisyon yok. Sıralama nakit + hisselerin son fiyattan değeridir. Gerçek para kullanılmaz, yatırım tavsiyesi değildir.</p>
        </div>
      </div>`;
  }

  function render() {
    if (!db()) { state.status = window.Account && Account.enabled ? 'loading' : 'off'; paint(); return; }
    load();
  }

  function init() {
    const view = $('view-contest');
    if (!view) return;
    view.addEventListener('click', e => {
      const b = e.target.closest('[data-ct]');
      const pick = e.target.closest('[data-ct-pick]');
      if (pick) { $('ctTicker').value = pick.dataset.ctPick; quote(); return; }
      if (!b) return;
      const k = b.dataset.ct;
      if (k === 'login' && window.Account) Account.openModal('login');
      else if (k === 'join') join();
      else if (k === 'buy' || k === 'sell') order(k);
      else if (k === 'reset') reset();
      else if (k === 'max' && state.quote) { $('ctQty').value = Math.floor(book(state.trades).cash / state.quote.price); paintQuote(); }
    });
    view.addEventListener('change', e => { if (e.target.id === 'ctTicker') quote(); });
    view.addEventListener('input', e => { if (e.target.id === 'ctQty') paintQuote(); });
    view.addEventListener('keydown', e => { if (e.target.id === 'ctTicker' && e.key === 'Enter') { e.preventDefault(); quote(); } });
    window.addEventListener('verity:session', () => { if (typeof appState !== 'undefined' && appState.activeView === 'contest') render(); });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { render, book, value };
})();

if (typeof window !== 'undefined') window.Contest = Contest;
