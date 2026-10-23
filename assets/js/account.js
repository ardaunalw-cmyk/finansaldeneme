/**
 * Hesap: Supabase ile giriş ve cihazlar arası eşitleme.
 *
 * Eşitlenen veri: Profilim (portföyler, işlemler, notlar, günlük, plan, geçmiş), izleme listesi ve
 * alarmlar. Hepsi tek satırda tutulur (supabase/schema.sql, user_data tablosu); satırı yalnızca
 * sahibi okuyup yazabilir (row level security).
 *
 * Akış: yerel bir değişiklik (verity:data / verity:alerts olayları) 1,5 sn sonra hesaba yazılır.
 * Yazma, okunan sürüm numarasını (rev) şart koşar; arada başka bir cihaz yazdıysa iki taraf
 * sync.js kurallarıyla birleştirilip tekrar yazılır. Sekmeye dönünce ve iki dakikada bir hesaptaki
 * sürüme bakılır. Kurulmamışsa (/api/config boş) hesap bölümü görünmez, site eskisi gibi çalışır.
 */
const Account = (() => {
  const META_KEY = 'verity_sync_meta';
  const LIB = 'assets/lib/supabase-2.117.3/supabase.js';
  const AFTER_AUTH = 'verity_after_auth';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let cfg = null;      // { url, anonKey, google }
  let sb = null;       // Supabase client
  let user = null;
  let applying = false;
  let pushTimer = null;
  let queue = Promise.resolve();
  const status = { kind: 'loading', at: null, text: '' };   // loading | off | out | syncing | synced | offline | error

  /* ---------- sync bookkeeping (this device) ---------- */
  function readMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || 'null') || {}; } catch (e) { return {}; }
  }
  let meta = readMeta();   // { uid, rev, dirty, watchAt, alertsAt }
  function writeMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* storage blocked */ } }

  function setStatus(kind, text = '') {
    status.kind = kind;
    status.text = text;
    if (kind === 'synced') status.at = Date.now();
    paint();
  }

  /* ---------- the data that travels ---------- */
  function collect() {
    return {
      v: 1,
      profile: window.Profile ? Profile.snapshot() : null,
      watchlist: typeof getWatchlist === 'function' ? getWatchlist() : [],
      alerts: typeof getAlerts === 'function' ? getAlerts() : [],
      watchAt: meta.watchAt || 0,
      alertsAt: meta.alertsAt || 0
    };
  }

  /** Writes a bundle into this device without counting it as a local change. */
  function apply(b) {
    if (!b) return;
    applying = true;
    try {
      if (b.profile && window.Profile) Profile.replace(b.profile);
      if (Array.isArray(b.watchlist) && typeof setWatchlist === 'function') setWatchlist(b.watchlist);
      if (Array.isArray(b.alerts)) {
        try { localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(b.alerts)); } catch (e) { /* storage blocked */ }
        if (typeof renderAlertsItems === 'function') renderAlertsItems();
        if (typeof updateWatchlistHeaderBadges === 'function') updateWatchlistHeaderBadges();
        window.dispatchEvent(new Event('verity:alerts'));
      }
      meta.watchAt = b.watchAt || 0;
      meta.alertsAt = b.alertsAt || 0;
      writeMeta();
    } finally {
      applying = false;
    }
  }

  function localChange(kind) {
    if (applying) return;
    if (kind === 'watchlist') meta.watchAt = Date.now();
    if (kind === 'alerts') meta.alertsAt = Date.now();
    meta.dirty = true;
    writeMeta();
    if (user) {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => serial(pushNow), 1500);
    }
  }

  /** One sync step at a time: pushes and pulls never overlap. */
  function serial(fn) {
    queue = queue.then(fn).catch(fail);
    return queue;
  }
  function fail(e) {
    console.warn('[Account] sync failed:', e && (e.message || e));
    if (!navigator.onLine) setStatus('offline', 'Çevrimdışı; bağlantı gelince eşitlenecek');
    else setStatus('error', 'Eşitlenemedi; birazdan tekrar denenecek');
  }

  /* ---------- talking to the database ---------- */
  async function fetchRow() {
    const { data, error } = await sb.from('user_data').select('data, rev').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data;   // null when the user has no row yet
  }

  /** Writes this device's data under the rev it last read; merges and retries when another device wrote first. */
  async function pushNow() {
    if (!user) return;
    setStatus('syncing', 'Eşitleniyor…');
    for (let attempt = 0; attempt < 3; attempt++) {
      const bundle = collect();
      const res = meta.rev
        ? await sb.from('user_data').update({ data: bundle, rev: meta.rev + 1 }).eq('user_id', user.id).eq('rev', meta.rev).select('rev')
        : await sb.from('user_data').insert({ user_id: user.id, data: bundle, rev: 1 }).select('rev');
      if (res.error && res.error.code !== '23505') throw res.error;   // 23505: the row exists already
      if (!res.error && res.data && res.data.length) {
        meta.rev = res.data[0].rev;
        meta.dirty = false;
        writeMeta();
        setStatus('synced');
        return;
      }
      // Someone else wrote in between: take theirs, merge ours in, try again on their rev
      const row = await fetchRow();
      apply(Sync.mergeBundles(collect(), row ? row.data : null));
      meta.rev = row ? row.rev : 0;
      writeMeta();
    }
    throw new Error('conflict did not settle');
  }

  /** Brings in what other devices wrote since this one last synced. */
  async function pullNow() {
    if (!user) return;
    const row = await fetchRow();
    if (!row) { await pushNow(); return; }
    if (row.rev === meta.rev) {
      if (meta.dirty) await pushNow(); else setStatus('synced');
      return;
    }
    if (!meta.dirty) {
      apply(row.data);
      meta.rev = row.rev;
      writeMeta();
      setStatus('synced');
      return;
    }
    // Both sides changed: merge, then write the result
    apply(Sync.mergeBundles(collect(), row.data));
    meta.rev = row.rev;
    meta.dirty = true;
    writeMeta();
    await pushNow();
  }

  /** First sign-in on this device (or another user): decide what to do with the two sets of data. */
  async function firstSync() {
    setStatus('syncing', 'Hesap verileri yükleniyor…');
    const row = await fetchRow();
    const local = collect();
    const remote = row ? row.data : null;
    let choice;
    if (!row) choice = 'local';
    else if (Sync.isEmptyBundle(local)) choice = 'remote';
    else if (Sync.isEmptyBundle(remote)) choice = 'local';
    else choice = await ask(local, remote);
    meta = { uid: user.id, rev: row ? row.rev : 0, dirty: false, watchAt: local.watchAt, alertsAt: local.alertsAt };
    if (choice === 'remote') {
      apply(remote);
      writeMeta();
      setStatus('synced');
      return;
    }
    if (choice === 'merge') apply(Sync.mergeBundles(local, remote));
    meta.dirty = true;
    writeMeta();
    await pushNow();
  }

  /* ---------- session ---------- */
  function onSession(session) {
    const next = session && session.user ? session.user : null;
    const changed = (next && next.id) !== (user && user.id);
    user = next;
    if (!user) { setStatus('out'); paintMenuHint(); return; }
    paintMenuHint();
    if (!changed) return;
    closeModal();
    serial(meta.uid === user.id ? pullNow : firstSync);
    try {
      if (sessionStorage.getItem(AFTER_AUTH)) {
        sessionStorage.removeItem(AFTER_AUTH);
        if (typeof switchView === 'function') switchView('profile');
        if (typeof showToast === 'function') showToast(`Giriş yapıldı: ${user.email}`);
      }
    } catch (e) { /* storage blocked */ }
  }

  /** After an e-mail link or Google returns here, the ?code=... is no longer needed in the address. */
  function cleanUrl() {
    const u = new URL(window.location.href);
    const err = u.searchParams.get('error_description');
    if (!['code', 'error', 'error_code', 'error_description', 'type'].some(k => u.searchParams.has(k))) return;
    ['code', 'error', 'error_code', 'error_description', 'type'].forEach(k => u.searchParams.delete(k));
    try { window.history.replaceState(window.history.state, '', u.pathname + (u.search || '') + u.hash); } catch (e) { /* sandboxed frame */ }
    if (err) setTimeout(() => openModal('login', `Bağlantı geçersiz ya da süresi dolmuş: ${err}`), 300);
  }

  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB;
      s.onload = resolve;
      s.onerror = () => reject(new Error('supabase library did not load'));
      document.head.appendChild(s);
    });
  }

  async function init() {
    window.addEventListener('verity:data', e => localChange(e.detail));
    window.addEventListener('verity:alerts', () => localChange('alerts'));
    try {
      const r = await fetch('/api/config');
      cfg = r.ok ? (await r.json()).supabase : null;
    } catch (e) { cfg = null; }
    if (!cfg) { setStatus('off'); return; }
    try {
      await loadLib();
      sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    } catch (e) {
      console.warn('[Account] unavailable:', e.message);
      setStatus('off');
      return;
    }
    // Supabase calls must not run inside this callback (they would wait on its own lock)
    sb.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        if (event === 'PASSWORD_RECOVERY') openModal('recovery');
        onSession(session);
      }, 0);
    });
    const { data } = await sb.auth.getSession();
    onSession(data && data.session);
    cleanUrl();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && user) serial(pullNow); });
    window.addEventListener('online', () => { if (user) serial(meta.dirty ? pushNow : pullNow); });
    setInterval(() => { if (!document.hidden && user) serial(pullNow); }, 120000);
  }

  /* ---------- auth actions ---------- */
  const redirect = () => `${window.location.origin}/`;
  function trMessage(e) {
    const m = String((e && (e.message || e.error_description)) || e || '');
    if (/invalid login credentials/i.test(m)) return 'E-posta ya da şifre hatalı.';
    if (/email not confirmed/i.test(m)) return 'E-postanız henüz onaylanmadı: gelen kutunuzdaki bağlantıya tıklayın.';
    if (/already registered|already been registered/i.test(m)) return 'Bu e-postayla bir hesap var; giriş yapın ya da şifrenizi sıfırlayın.';
    if (/rate limit|too many/i.test(m)) return 'Çok fazla deneme yapıldı; birkaç dakika sonra tekrar deneyin.';
    if (/password/i.test(m) && /(characters|short|weak)/i.test(m)) return 'Şifre çok kısa ya da zayıf: en az 8 karakter kullanın.';
    if (/network|fetch/i.test(m)) return 'Sunucuya ulaşılamadı; bağlantınızı kontrol edin.';
    return m || 'Bir hata oluştu.';
  }

  async function submit(e, mode) {
    e.preventDefault();
    const f = e.target;
    const email = (f.email && f.email.value || '').trim();
    const password = f.password ? f.password.value : '';
    const say = (text, ok = false) => {
      const el = f.querySelector('[data-msg]');
      if (el) { el.textContent = text; el.className = `text-xs font-sans ${ok ? 'text-emerald-400' : 'text-rose-400'}`; }
    };
    const btn = f.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Şifre en az 8 karakter olmalı.');
        if (password !== f.password2.value) throw new Error('Şifreler aynı değil.');
        try { sessionStorage.setItem(AFTER_AUTH, '1'); } catch (x) { /* storage blocked */ }
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect() } });
        if (error) throw error;
        if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) throw new Error('already registered');
        if (!data.session) say(`${email} adresine onay bağlantısı gönderdik. Bağlantıya tıklayınca hesabınız açılır.`, true);
      } else if (mode === 'forgot') {
        try { sessionStorage.setItem(AFTER_AUTH, '1'); } catch (x) { /* storage blocked */ }
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() });
        if (error) throw error;
        say(`${email} adresine şifre sıfırlama bağlantısı gönderdik.`, true);
      } else if (mode === 'recovery') {
        if (password.length < 8) throw new Error('Şifre en az 8 karakter olmalı.');
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        closeModal();
        if (typeof showToast === 'function') showToast('Yeni şifreniz kaydedildi');
      }
    } catch (err) {
      say(trMessage(err));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function google() {
    try { sessionStorage.setItem(AFTER_AUTH, '1'); } catch (x) { /* storage blocked */ }
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect() } });
    if (error) openModal('login', trMessage(error));
  }

  /** Signs out; with wipe the portfolio data, watchlist and alerts leave this device too. */
  async function signOut(wipe) {
    if (wipe && !confirm('Bu cihazdaki portföy, izleme listesi ve alarmlar silinecek (hesabınızdakiler kalır). Devam edilsin mi?')) return;
    clearTimeout(pushTimer);
    if (meta.dirty && user && !wipe) { try { await serial(pushNow); } catch (e) { /* signed out anyway */ } }
    await sb.auth.signOut();
    if (wipe) {
      applying = true;
      try {
        if (window.Profile) Profile.replace(null);
        ['oa_terminal_watchlist', 'oa_terminal_alerts'].forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } });
        if (typeof renderWatchlistItems === 'function') renderWatchlistItems();
        if (typeof renderAlertsItems === 'function') renderAlertsItems();
        if (typeof updateWatchlistHeaderBadges === 'function') updateWatchlistHeaderBadges();
      } finally { applying = false; }
    }
    meta = {};
    writeMeta();
    closeModal();
    if (typeof showToast === 'function') showToast(wipe ? 'Çıkış yapıldı; bu cihazdaki veriler silindi' : 'Çıkış yapıldı');
  }

  async function deleteAccount() {
    if (!user) return;
    const typed = prompt(`Hesabınız ve hesaptaki tüm verileriniz kalıcı olarak silinecek. Onaylamak için e-postanızı yazın:\n${user.email}`);
    if ((typed || '').trim().toLowerCase() !== String(user.email).toLowerCase()) return;
    const { error } = await sb.rpc('delete_my_account');
    if (error) { if (typeof showToast === 'function') showToast(`Hesap silinemedi: ${trMessage(error)}`); return; }
    meta = {};
    writeMeta();
    await sb.auth.signOut();
    closeModal();
    if (typeof showToast === 'function') showToast('Hesabınız silindi. Bu cihazdaki veriler duruyor.');
  }

  /* ---------- the "merge or replace" question ---------- */
  let answer = null;
  function ask(local, remote) {
    return new Promise(resolve => {
      answer = resolve;
      const a = Sync.summary(local), b = Sync.summary(remote);
      const line = s => `${s.txs} işlem · ${s.portfolios} portföy · ${s.journal} günlük · ${s.alerts} alarm · ${s.watchlist} izlenen`;
      openModal('choose', '', `
        <div class="grid grid-cols-1 gap-2 text-xs font-sans">
          <div class="rounded-xl bg-[#090D18] border border-[#162238] p-3"><div class="text-[10px] font-mono uppercase tracking-widest text-slate-500">Bu cihazda</div><div class="text-slate-200 mt-1">${line(a)}</div></div>
          <div class="rounded-xl bg-[#090D18] border border-[#162238] p-3"><div class="text-[10px] font-mono uppercase tracking-widest text-slate-500">Hesabınızda</div><div class="text-slate-200 mt-1">${line(b)}</div></div>
        </div>`);
    });
  }
  function choose(c) {
    const r = answer;
    answer = null;
    closeModal();
    if (r) r(c);
  }

  /* ---------- modal ---------- */
  const INPUT = 'w-full px-3 py-2.5 rounded-xl bg-[#0C1322] border border-[#1A2540] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2F6BFF] font-sans';
  const LABEL = 'block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1';
  const PRIMARY = 'w-full py-2.5 rounded-xl bg-[#2F6BFF] hover:bg-[#4A7FFF] disabled:opacity-60 text-white text-sm font-semibold';
  const SECOND = 'w-full py-2.5 rounded-xl bg-[#0C1322] border border-[#1A2540] text-sm font-semibold text-slate-200 hover:text-white';
  const link = (mode, text) => `<button type="button" onclick="Account.openModal('${mode}')" class="text-[11px] font-bold text-[#7FA6FF] hover:text-white">${text}</button>`;
  const googleBtn = () => (cfg && cfg.google ? `
    <button type="button" onclick="Account.google()" class="${SECOND} flex items-center justify-center gap-2"><i class="fa-brands fa-google"></i> Google ile devam et</button>
    <div class="flex items-center gap-3 text-[10px] font-mono text-slate-600"><span class="flex-1 border-t border-[#1A2540]"></span>ya da<span class="flex-1 border-t border-[#1A2540]"></span></div>` : '');

  function modalBody(mode, msg, extra) {
    const note = msg ? `<p data-msg class="text-xs font-sans text-rose-400">${esc(msg)}</p>` : '<p data-msg class="text-xs font-sans"></p>';
    if (mode === 'login') return {
      title: 'Giriş yap',
      sub: 'Portföyünüz, izleme listeniz ve alarmlarınız telefonda ve bilgisayarda aynı olsun.',
      html: `${googleBtn()}
        <form onsubmit="Account.submit(event, 'login')" class="space-y-3">
          <label class="block"><span class="${LABEL}">E-posta</span><input name="email" type="email" autocomplete="email" required class="${INPUT}"></label>
          <label class="block"><span class="${LABEL}">Şifre</span><input name="password" type="password" autocomplete="current-password" required class="${INPUT}"></label>
          ${note}
          <button type="submit" class="${PRIMARY}">Giriş yap</button>
        </form>
        <div class="flex justify-between">${link('signup', 'Hesap oluştur')}${link('forgot', 'Şifremi unuttum')}</div>`
    };
    if (mode === 'signup') return {
      title: 'Hesap oluştur',
      sub: 'Ücretsiz. Bu cihazdaki portföyünüz hesabınıza taşınır; sonra her cihazdan aynı verilerle devam edersiniz.',
      html: `${googleBtn()}
        <form onsubmit="Account.submit(event, 'signup')" class="space-y-3">
          <label class="block"><span class="${LABEL}">E-posta</span><input name="email" type="email" autocomplete="email" required class="${INPUT}"></label>
          <label class="block"><span class="${LABEL}">Şifre (en az 8 karakter)</span><input name="password" type="password" autocomplete="new-password" minlength="8" required class="${INPUT}"></label>
          <label class="block"><span class="${LABEL}">Şifre tekrar</span><input name="password2" type="password" autocomplete="new-password" minlength="8" required class="${INPUT}"></label>
          ${note}
          <button type="submit" class="${PRIMARY}">Hesap oluştur</button>
          <p class="text-[10px] text-slate-500 font-sans leading-relaxed">Hesabınızda yalnızca bu sitede girdiğiniz portföy, not ve ayar verileri tutulur; aracı kurum bilgisi istenmez. Hesabınızı ve verilerinizi istediğiniz an silebilirsiniz.</p>
        </form>
        <div>${link('login', 'Zaten hesabım var')}</div>`
    };
    if (mode === 'forgot') return {
      title: 'Şifremi unuttum',
      sub: 'E-postanıza bir sıfırlama bağlantısı gönderelim; bağlantıya tıklayınca yeni şifrenizi belirlersiniz.',
      html: `<form onsubmit="Account.submit(event, 'forgot')" class="space-y-3">
          <label class="block"><span class="${LABEL}">E-posta</span><input name="email" type="email" autocomplete="email" required class="${INPUT}"></label>
          ${note}
          <button type="submit" class="${PRIMARY}">Bağlantı gönder</button>
        </form>
        <div>${link('login', 'Girişe dön')}</div>`
    };
    if (mode === 'recovery') return {
      title: 'Yeni şifre',
      sub: 'Hesabınız için yeni bir şifre belirleyin.',
      html: `<form onsubmit="Account.submit(event, 'recovery')" class="space-y-3">
          <label class="block"><span class="${LABEL}">Yeni şifre (en az 8 karakter)</span><input name="password" type="password" autocomplete="new-password" minlength="8" required class="${INPUT}"></label>
          ${note}
          <button type="submit" class="${PRIMARY}">Kaydet</button>
        </form>`
    };
    if (mode === 'choose') return {
      title: 'Verileri nasıl birleştirelim?',
      sub: 'Hem bu cihazda hem hesabınızda veri var.',
      closable: false,
      html: `${extra}
        <button type="button" onclick="Account.choose('merge')" class="${PRIMARY}">Birleştir (önerilen)</button>
        <button type="button" onclick="Account.choose('remote')" class="${SECOND}">Hesabımdakini kullan, bu cihazdakini bırak</button>
        <button type="button" onclick="Account.choose('local')" class="${SECOND}">Bu cihazdakini kullan, hesaptakinin yerine yaz</button>
        <p class="text-[10px] text-slate-500 font-sans">Birleştirmede iki taraftaki işlemler, portföyler ve günlük kayıtları korunur; ayarlar en son değiştirilen taraftan alınır.</p>`
    };
    // manage
    return {
      title: 'Hesabım',
      sub: esc(user ? user.email : ''),
      html: `
        <div class="rounded-xl bg-[#090D18] border border-[#162238] p-3 text-xs font-sans text-slate-300">${statusLine()}</div>
        <button type="button" onclick="Account.syncNow()" class="${PRIMARY}"><i class="fa-solid fa-rotate"></i> Şimdi eşitle</button>
        <button type="button" onclick="Account.openModal('recovery')" class="${SECOND}">Şifremi değiştir</button>
        <button type="button" onclick="Account.signOut(false)" class="${SECOND}">Çıkış yap</button>
        <button type="button" onclick="Account.signOut(true)" class="${SECOND}">Çıkış yap ve bu cihazdaki verileri sil</button>
        <button type="button" onclick="Account.deleteAccount()" class="w-full py-2.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-sm font-semibold text-rose-300 hover:text-white">Hesabımı ve hesaptaki verilerimi sil</button>`
    };
  }

  function openModal(mode, msg = '', extra = '') {
    if (!sb && mode !== 'choose') return;
    let el = document.getElementById('accountModal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'accountModal';
      el.className = 'fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.addEventListener('click', e => { if (e.target === el && el.dataset.closable === '1') closeModal(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('accountModal')?.dataset.closable === '1') closeModal(); });
      document.body.appendChild(el);
    }
    const b = modalBody(mode, msg, extra);
    el.dataset.closable = b.closable === false ? '0' : '1';
    el.setAttribute('aria-label', b.title);
    el.innerHTML = `
      <div class="w-full max-w-md mt-10 sm:mt-0 rounded-2xl border border-oa-border bg-oa-card shadow-2xl">
        <div class="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#7FA6FF]"><i class="fa-solid fa-cloud"></i> <span lang="en">Verity</span> hesabı</div>
            <h2 class="font-serif font-bold text-white text-xl mt-1">${b.title}</h2>
            <p class="text-xs text-slate-400 font-sans mt-1 leading-relaxed">${b.sub}</p>
          </div>
          ${b.closable === false ? '' : '<button type="button" onclick="Account.closeModal()" aria-label="Kapat" class="w-8 h-8 rounded-lg text-slate-400 hover:text-white"><i class="fa-solid fa-xmark"></i></button>'}
        </div>
        <div class="px-5 pb-5 space-y-3">${b.html}</div>
      </div>`;
    el.classList.remove('hidden');
    const first = el.querySelector('input');
    if (first) setTimeout(() => first.focus(), 50);
  }
  function closeModal() {
    const el = document.getElementById('accountModal');
    if (el && el.dataset.closable !== '0') el.remove();
    else if (el && !answer) el.remove();
  }

  /* ---------- on-page status ---------- */
  function statusLine() {
    const t = status.at ? new Date(status.at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
    const map = {
      syncing: '<i class="fa-solid fa-rotate fa-spin text-[#7FA6FF]"></i> Eşitleniyor…',
      synced: `<i class="fa-solid fa-circle-check text-emerald-400"></i> Eşitlendi${t ? ` · ${t}` : ''}`,
      offline: '<i class="fa-solid fa-plug-circle-xmark text-amber-400"></i> Çevrimdışı; bağlantı gelince eşitlenecek',
      error: `<i class="fa-solid fa-triangle-exclamation text-amber-400"></i> ${esc(status.text || 'Eşitlenemedi')}`,
      loading: '<i class="fa-solid fa-circle-notch fa-spin"></i> Hesap bilgisi yükleniyor…'
    };
    return map[status.kind] || '';
  }

  function paint() {
    const el = document.getElementById('pfAccount');
    const dot = document.getElementById('headerProfileDot');
    if (dot) dot.classList.toggle('hidden', !user);
    if (!el) return;
    if (status.kind === 'off' || status.kind === 'loading' || !sb) { el.innerHTML = ''; return; }
    if (!user) {
      el.innerHTML = `
        <section class="rounded-2xl border border-[#2F6BFF]/40 bg-gradient-to-r from-[#2F6BFF]/15 to-transparent p-4 flex flex-wrap items-center gap-3 pf-noprint">
          <i class="fa-solid fa-cloud-arrow-up text-[#7FA6FF] text-xl"></i>
          <div class="flex-1 min-w-[200px]">
            <div class="text-sm font-bold text-white font-sans">Verileriniz şu an yalnızca bu tarayıcıda</div>
            <div class="text-[11px] text-slate-400 font-sans">Ücretsiz hesapla portföyünüz, izleme listeniz ve alarmlarınız telefonda ve bilgisayarda aynı olur; tarayıcı temizlense de kaybolmaz.</div>
          </div>
          <div class="flex gap-2">
            <button type="button" onclick="Account.openModal('login')" class="px-4 py-2 rounded-xl bg-[#0C1322] border border-[#1A2540] text-xs font-bold text-slate-200 hover:text-white">Giriş yap</button>
            <button type="button" onclick="Account.openModal('signup')" class="px-4 py-2 rounded-xl bg-[#2F6BFF] hover:bg-[#4A7FFF] text-xs font-bold text-white">Hesap oluştur</button>
          </div>
        </section>`;
      return;
    }
    el.innerHTML = `
      <section class="rounded-2xl border border-oa-border bg-oa-card px-4 py-3 flex flex-wrap items-center gap-3 pf-noprint">
        <span class="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-800/50 text-emerald-400 flex items-center justify-center"><i class="fa-solid fa-cloud"></i></span>
        <div class="flex-1 min-w-0">
          <div class="text-xs font-bold text-white font-sans truncate">${esc(user.email)}</div>
          <div class="text-[11px] text-slate-400 font-sans">${statusLine()}</div>
        </div>
        <button type="button" onclick="Account.syncNow()" class="w-9 h-9 rounded-xl bg-[#0C1322] border border-[#1A2540] text-slate-400 hover:text-white" title="Şimdi eşitle" aria-label="Şimdi eşitle"><i class="fa-solid fa-rotate"></i></button>
        <button type="button" onclick="Account.openModal('manage')" class="px-3.5 h-9 rounded-xl bg-[#0C1322] border border-[#1A2540] text-xs font-bold text-slate-300 hover:text-white">Hesabım</button>
      </section>`;
    const modal = document.getElementById('accountModal');
    if (modal && modal.getAttribute('aria-label') === 'Hesabım') openModal('manage');
  }

  function paintMenuHint() {
    if (window.Profile) Profile.paintMenu();
  }

  return {
    init, submit, google, signOut, deleteAccount, choose, openModal, closeModal,
    syncNow() { if (user) serial(meta.dirty ? pushNow : pullNow); },
    email() { return user ? user.email : null; },
    enabled() { return !!sb; },
    paint
  };
})();

window.Account = Account;
document.addEventListener('DOMContentLoaded', () => Account.init());
