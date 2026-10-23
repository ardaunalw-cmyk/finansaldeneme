/**
 * Profil: yatırımcının kendi sayfası.
 *
 *  - Portföy: alış/satış kayıtlarından ortalama maliyet, gecikmeli fiyatla değer ve kâr/zarar,
 *    sektör dağılımı, yoğunlaşma, portföyün F/K ve PD/DD'si, temettü geliri.
 *  - Uzun dönem: portföydeki her sektör için en büyük şirketlerden kurulan eşit ağırlıklı haftalık
 *    endeks (10 yıla kadar, TL ve dolar bazında), BIST 100 ile kıyas, sektör medyan oranları.
 *  - İncelenen hisseler, komut satırı (al/sat/izle/alarm/...) ve komut geçmişi.
 *
 * Her şey bu tarayıcıda saklanır (localStorage); dışa/içe aktarma ile yedeklenir. Komutlar yalnızca
 * Verity içindeki kayıtları değiştirir: hiçbir aracı kuruma emir iletilmez. Hesaplar portfolio.js'te.
 */
const Profile = (() => {
  const KEY = 'verity_profile_v1';
  const MAX_VIEWS = 60;
  const MAX_CMDS = 80;
  const MAX_SECTORS = 6;
  const MEMBERS_PER_SECTOR = 5;   // largest companies of a sector that make up its index
  const nf = (min, max = min) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max });
  const f0 = nf(0), f1 = nf(1), f2 = nf(2), fq = nf(0, 4);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  const tl = v => (Number.isFinite(v) ? `₺${f2.format(v)}` : '—');
  const pct = (v, d = 1) => (Number.isFinite(v) ? `%${nf(d).format(v)}` : '—');
  const signed = (v, d = 1) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}%${nf(d).format(Math.abs(v))}` : '—');
  const signedTl = v => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}₺${f2.format(Math.abs(v))}` : '—');
  const tone = v => (!Number.isFinite(v) || v === 0 ? 'text-slate-300' : v > 0 ? 'text-emerald-400' : 'text-rose-400');
  const mult = v => (Number.isFinite(v) && v > 0 ? `${f1.format(v)}x` : '—');
  const fullDate = s => new Date(`${s}T00:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  const HORIZONS = { short: 'Kısa vade (1 yıldan az)', mid: 'Orta vade (1–3 yıl)', long: 'Uzun vade (3 yıl ve üzeri)' };
  const RISKS = { low: 'Düşük risk', mid: 'Orta risk', high: 'Yüksek risk' };
  // Concentration thresholds per risk profile: a single holding / a single sector (% of value)
  const LIMITS = { low: { stock: 15, sector: 30 }, mid: { stock: 25, sector: 40 }, high: { stock: 35, sector: 55 } };
  // Categorical slots, validated on the dark card surface (dataviz validator: all checks pass)
  const SLOTS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'];
  const BENCH_COLOR = '#94A3B8';
  const MINE_COLOR = '#E2E8F0';

  /* ---------- storage ---------- */
  const blank = () => ({ v: 1, name: '', horizon: 'long', risk: 'mid', since: today(), txs: [], seq: 0, views: [], cmds: [], saved: [], notes: {} });
  function read() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (j && j.v === 1) return { ...blank(), ...j };
    } catch (e) { /* unreadable or blocked storage: start empty */ }
    return blank();
  }
  let store = read();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* private mode: kept for this visit only */ }
    paintMenu();
  }

  const ui = { tab: 'portfolio', window: 5, ccy: 'TRY', lastTx: null, prefill: null, cmdIndex: -1, token: 0 };

  /* ---------- data ---------- */
  const files = {};
  function json(name) {
    if (!files[name]) {
      files[name] = fetch(`/assets/data/${name}.json`)
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
        .then(j => { if (!j) delete files[name]; return j; });
    }
    return files[name];
  }

  let dir = null;   // code -> { name, sec }
  function directory() {
    if (!dir || !dir.size) {
      dir = new Map();
      (typeof getFullBistStockList === 'function' ? getFullBistStockList() : []).forEach(e => {
        if (e.code && !dir.has(e.code)) dir.set(e.code, { name: e.name, sec: (e.raw && e.raw.sec) || '' });
      });
    }
    return dir;
  }
  const company = code => directory().get(code) || { name: code, sec: '' };
  const known = code => directory().has(code);
  const sym = code => (typeof tradingCode === 'function' ? tradingCode(code) : code);

  /** Technical snapshot row as an object ({ close, m3, s200, hi52, ... }). */
  function techRow(tech, code) {
    const r = tech && tech.data[code];
    if (!r) return null;
    const o = {};
    tech.fields.forEach((f, i) => { o[f] = r[i]; });
    return o;
  }
  /** Statement summary of fundamentals.json in the shape Calc.ratios takes. */
  function fundRow(fund, code) {
    const r = fund && fund.data[code];
    if (!r) return null;
    const [period, shares, equity, totalAssets, netDebt, revenue, ebitda, netIncome] = r;
    return { period, shares, equity, totalAssets, netDebt, revenue, ebitda, netIncome, ttm: { revenue, ebitda, netIncome } };
  }

  /** Delayed quote when available, the last daily close of the snapshot otherwise. */
  async function priceOf(code) {
    if (window.LiveData) await LiveData.ensure([code]);
    const fin = typeof getCachedStockFinancials === 'function' ? getCachedStockFinancials(code) : null;
    if (fin && fin.liveTime && fin.priceNum > 0) return { price: fin.priceNum, src: 'live' };
    const t = techRow(await json('technicals'), code);
    return t && t.close > 0 ? { price: t.close, src: 'close' } : null;
  }

  /* Weekly history, at most four requests at a time (the long-term tab asks for dozens) */
  const hist = new Map();
  let active = 0;
  const waiting = [];
  function limited(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(() => { active--; if (waiting.length) waiting.shift()(); });
      };
      if (active < 4) run(); else waiting.push(run);
    });
  }
  function history(symbol) {
    if (!hist.has(symbol)) {
      hist.set(symbol, limited(() => fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=10y&interval=1wk`)
        .then(r => (r.ok ? r.json() : null))
        .then(j => Portfolio.weekly(j))
        .catch(() => new Map())));
    }
    return hist.get(symbol);
  }

  /* ---------- the portfolio model ---------- */
  async function model() {
    const [fund, tech, multiples, divFile] = await Promise.all([json('fundamentals'), json('technicals'), json('sector-multiples'), json('dividends')]);
    const pos = Portfolio.positions(store.txs);
    const open = pos.filter(p => p.qty > 0).map(p => p.code);
    if (open.length && window.LiveData) await LiveData.ensure(open);
    const prices = {}, source = {};
    open.forEach(code => {
      const fin = typeof getCachedStockFinancials === 'function' ? getCachedStockFinancials(code) : null;
      if (fin && fin.liveTime && fin.priceNum > 0) { prices[code] = fin.priceNum; source[code] = 'live'; return; }
      const t = techRow(tech, code);
      if (t && t.close > 0) { prices[code] = t.close; source[code] = 'close'; }
    });
    const val = Portfolio.valuate(pos, prices);
    val.rows.forEach(r => {
      const c = company(r.code);
      const f = fundRow(fund, r.code);
      const fin = typeof getCachedStockFinancials === 'function' ? getCachedStockFinancials(r.code) : null;
      const x = f && r.price ? Calc.ratios(r.price, f) : {};
      Object.assign(r, {
        name: c.name, sector: c.sec || 'Diğer', src: source[r.code] || null,
        fk: x.fk, pb: x.pddd, roe: x.roe, netDebtEbitda: x.netDebtFavok, loss: f ? f.netIncome < 0 : null,
        score: fin && Number.isFinite(fin.score) ? fin.score : null,
        note: store.notes[r.code] || ''
      });
    });
    const mix = Portfolio.groupWeights(val.rows, r => r.sector);
    const divs = {};
    if (divFile) Object.entries(divFile.data).forEach(([code, row]) => { divs[code] = row.d; });
    const priced = val.rows.filter(r => r.value > 0);
    return {
      fund, tech, multiples, pos, val, mix,
      conc: Portfolio.concentration(priced.map(r => r.weight)),
      pe: Portfolio.lookThrough(priced.map(r => ({ value: r.value, multiple: r.fk }))),
      pb: Portfolio.lookThrough(priced.map(r => ({ value: r.value, multiple: r.pb }))),
      roe: Portfolio.weightedAvg(priced.map(r => ({ value: r.value, x: r.roe }))),
      score: Portfolio.weightedAvg(priced.map(r => ({ value: r.value, x: r.score }))),
      received: Portfolio.dividendsReceived(store.txs, divs, today()),
      income: Portfolio.trailingIncome(val.rows, divs, today()),
      divAsOf: divFile ? divFile.generatedAt.slice(0, 10) : null
    };
  }

  /** Stable color per sector: alphabetical order of the sectors on screen, never their rank. */
  function sectorColors(names) {
    const order = [...new Set(names)].filter(n => n !== 'Diğer').sort((a, b) => a.localeCompare(b, 'tr'));
    const map = {};
    order.forEach((n, i) => { map[n] = i < SLOTS.length ? SLOTS[i] : BENCH_COLOR; });
    map['Diğer'] = BENCH_COLOR;
    return map;
  }

  /* ---------- shell ---------- */
  const card = (inner, extra = '') => `<section class="rounded-2xl border border-oa-border bg-oa-card ${extra}">${inner}</section>`;
  const cardHead = (title, sub = '', right = '') => `
    <div class="px-4 sm:px-5 pt-4 pb-3 flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="font-serif font-bold text-white text-base">${title}</h2>
        ${sub ? `<p class="text-[11px] text-slate-400 font-sans mt-0.5 leading-relaxed">${sub}</p>` : ''}
      </div>
      ${right}
    </div>`;
  const empty = text => `<div class="px-5 py-8 text-center text-sm text-slate-500 font-sans">${text}</div>`;
  const stockCell = (code, name, sub = '') => `
    <button type="button" onclick="Profile.open('${code}')" class="flex items-center gap-2.5 min-w-0 text-left group">
      ${typeof getStockLogoHtml === 'function' ? getStockLogoHtml(code, 30) : ''}
      <span class="min-w-0">
        <span class="block font-mono font-bold text-white text-sm group-hover:text-[#7FA6FF]">${code}</span>
        <span class="block text-[11px] text-slate-400 font-sans truncate max-w-[170px]">${esc(sub || name)}</span>
      </span>
    </button>`;

  function initials() {
    const n = store.name.trim();
    if (!n) return '<i class="fa-solid fa-user text-sm"></i>';
    return esc(n.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toLocaleUpperCase('tr-TR'));
  }

  function paintHeader() {
    const el = document.getElementById('pfHeader');
    if (!el) return;
    const watch = typeof getWatchlist === 'function' ? getWatchlist().length : 0;
    const alarms = typeof getAlerts === 'function' ? getAlerts().filter(a => !a.triggered).length : 0;
    const chip = (icon, text) => `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0C1322] border border-[#1A2540] text-[11px] text-slate-300 font-sans whitespace-nowrap"><i class="fa-solid ${icon} text-[10px] text-[#7FA6FF]"></i>${text}</span>`;
    el.innerHTML = `
      <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div class="w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-2xl bg-gradient-to-br from-[#2F6BFF] to-[#1B3F99] text-white flex items-center justify-center text-xl font-serif font-black shadow-lg shadow-[#2F6BFF]/20">${initials()}</div>
        <div class="min-w-0 flex-1">
          <div class="text-[10px] font-mono uppercase tracking-widest text-slate-500">Profilim</div>
          <h1 class="text-2xl sm:text-3xl font-serif font-black text-white tracking-tight truncate">${store.name.trim() ? esc(store.name) : 'Yatırımcı profili'}</h1>
        </div>
        <button type="button" onclick="Profile.setTab('settings')" aria-label="${store.name.trim() ? 'Profili düzenle' : 'Profilini oluştur'}" class="shrink-0 px-3.5 py-2 rounded-xl bg-[#0C1322] border border-[#1A2540] text-xs font-bold text-slate-300 hover:text-white flex items-center gap-2">
          <i class="fa-solid fa-pen"></i><span class="hidden sm:inline">${store.name.trim() ? 'Profili düzenle' : 'Profilini oluştur'}</span>
        </button>
        <div class="basis-full flex flex-wrap gap-2">
          ${chip('fa-hourglass-half', HORIZONS[store.horizon])}
          ${chip('fa-scale-balanced', RISKS[store.risk])}
          ${chip('fa-star', `${watch} izlenen · ${alarms} alarm`)}
          ${chip('fa-calendar', `${fullDate(store.since)} tarihinden beri`)}
        </div>
      </div>`;
  }

  function paintKpis(m) {
    const el = document.getElementById('pfKpis');
    if (!el) return;
    const v = m && m.val;
    const tile = (label, value, sub, cls = 'text-white') => `
      <div class="rounded-2xl border border-oa-border bg-oa-card p-4 min-w-0">
        <div class="text-[10px] font-mono uppercase tracking-widest text-slate-500">${label}</div>
        <div class="text-lg sm:text-xl font-mono font-bold ${cls} mt-1 truncate" title="${value}">${value}</div>
        <div class="text-[11px] text-slate-500 font-sans mt-0.5 truncate">${sub}</div>
      </div>`;
    if (!v) { el.innerHTML = ''; return; }
    const open = v.rows.length;
    const yieldOnValue = v.total > 0 ? m.income.total / v.total * 100 : null;
    el.innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3" data-no-glossary>
        ${tile('Portföy değeri', open ? tl(v.total) : '—', open ? `maliyet ${tl(v.cost)}` : 'henüz pozisyon yok')}
        ${tile('Kâr / zarar', open ? signedTl(v.pnl) : '—', open ? `${signed(v.pnlPct)} · açık pozisyonlar` : 'gerçekleşmemiş', tone(v.pnl))}
        ${tile('Gerçekleşen', signedTl(v.realized), 'satışlardan kâr/zarar', tone(v.realized))}
        ${tile('Temettü (12A)', tl(m.income.total), yieldOnValue == null ? 'mevcut adetlerle' : `${pct(yieldOnValue, 2)} verim · alınan ${tl(m.received.total)}`)}
        ${tile('Pozisyon', open ? f0.format(open) : '0', open ? `etkin ${f1.format(m.conc.effective)} · ${m.mix.length} sektör` : 'işlem ekleyin')}
      </div>`;
  }

  const TABS = [
    ['portfolio', 'fa-briefcase', 'Portföy'],
    ['sectors', 'fa-chart-line', 'Sektörler · uzun dönem'],
    ['activity', 'fa-clock-rotate-left', 'İncelediklerim'],
    ['commands', 'fa-terminal', 'Komutlar'],
    ['settings', 'fa-user-gear', 'Profil ve veriler']
  ];
  function paintTabs() {
    const el = document.getElementById('pfTabs');
    if (!el) return;
    el.innerHTML = `<div class="flex gap-2 overflow-x-auto pb-1" role="tablist">${TABS.map(([k, icon, label]) => `
      <button type="button" role="tab" aria-selected="${ui.tab === k}" onclick="Profile.setTab('${k}')" class="shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 ${ui.tab === k ? 'bg-[#2F6BFF] text-white' : 'bg-[#0C1322] border border-[#1A2540] text-slate-400 hover:text-white'}">
        <i class="fa-solid ${icon}"></i>${label}
      </button>`).join('')}</div>`;
  }

  /* ---------- portfolio tab ---------- */
  function codeOptions() {
    const list = document.getElementById('pfCodes');
    if (!list || list.childElementCount) return;
    list.innerHTML = [...directory()].map(([code, c]) => `<option value="${code}">${esc(c.name)}</option>`).join('');
  }

  function portfolioSkeleton() {
    const input = 'w-full px-3 py-2.5 rounded-xl bg-[#0C1322] border border-[#1A2540] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2F6BFF] font-mono';
    const label = 'block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1';
    return `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div class="lg:col-span-2 space-y-5 min-w-0">
          ${card(`${cardHead('İşlem ekle', 'Aldığınız ya da sattığınız hisseyi kaydedin. Fiyatı boş bırakırsanız gecikmeli güncel fiyat kullanılır. Kayıt yalnızca bu tarayıcıda tutulur; aracı kuruma emir iletilmez.')}
            <form id="pfTradeForm" onsubmit="Profile.submitTrade(event)" class="px-4 sm:px-5 pb-5 grid grid-cols-2 sm:grid-cols-6 gap-3 items-end">
              <div class="col-span-2 sm:col-span-1">
                <span class="${label}">Tür</span>
                <div class="grid grid-cols-2 rounded-xl border border-[#1A2540] overflow-hidden text-xs font-bold">
                  <label class="cursor-pointer"><input type="radio" name="pfType" value="buy" class="peer sr-only" checked><span class="block text-center py-2.5 text-slate-400 peer-checked:bg-emerald-600 peer-checked:text-white">Alış</span></label>
                  <label class="cursor-pointer"><input type="radio" name="pfType" value="sell" class="peer sr-only"><span class="block text-center py-2.5 text-slate-400 peer-checked:bg-rose-600 peer-checked:text-white">Satış</span></label>
                </div>
              </div>
              <label class="col-span-2 sm:col-span-1"><span class="${label}">Hisse</span><input id="pfCode" list="pfCodes" autocomplete="off" required placeholder="THYAO" class="${input} uppercase"></label>
              <label><span class="${label}">Adet</span><input id="pfQty" inputmode="decimal" required placeholder="100" class="${input}"></label>
              <label><span class="${label}">Fiyat (₺)</span><input id="pfPrice" inputmode="decimal" placeholder="güncel" class="${input}"></label>
              <label><span class="${label}">Tarih</span><input id="pfDate" type="date" max="${today()}" value="${today()}" class="${input}"></label>
              <label><span class="${label}">Komisyon (₺)</span><input id="pfFee" inputmode="decimal" placeholder="0" class="${input}"></label>
              <div class="col-span-2 sm:col-span-6 flex flex-wrap items-center gap-3">
                <button type="submit" class="px-4 py-2.5 rounded-xl bg-[#2F6BFF] hover:bg-[#4A7FFF] text-white text-sm font-semibold flex items-center gap-2"><i class="fa-solid fa-plus"></i>Kaydet</button>
                <span id="pfTradeMsg" class="text-xs font-sans text-slate-400" role="status"></span>
              </div>
              <datalist id="pfCodes"></datalist>
            </form>`)}
          <div id="pfHoldings">${card(empty('Portföy hesaplanıyor…'))}</div>
          <div id="pfTxs"></div>
          <div id="pfNotes"></div>
        </div>
        <div class="space-y-5 min-w-0">
          <div id="pfMix"></div>
          <div id="pfRisk"></div>
          <div id="pfDivs"></div>
        </div>
      </div>`;
  }

  function paintHoldings(m) {
    const el = document.getElementById('pfHoldings');
    if (!el) return;
    const { rows, total, cost, pnl, pnlPct } = m.val;
    if (!rows.length) {
      el.innerHTML = card(`${cardHead('Pozisyonlar')}${empty('Henüz pozisyon yok. Yukarıdaki formdan ya da komut satırından ekleyin: <code class="font-mono text-[#7FA6FF]">al THYAO 100</code>')}`);
      return;
    }
    const closeNote = rows.some(r => r.src === 'close');
    el.innerHTML = card(`
      ${cardHead('Pozisyonlar', `Ortalama maliyet yöntemi; fiyatlar gecikmeli${closeNote ? ', * işaretliler son günlük kapanış' : ''}. F/K ve PD/DD gerçek bilançodan (son 12 ay).`)}
      <div class="overflow-x-auto" data-no-glossary>
        <table class="w-full text-left border-collapse text-sm">
          <thead><tr class="border-y border-oa-border text-[10px] font-mono uppercase tracking-widest text-slate-500">
            <th class="px-4 py-2.5">Hisse</th>
            <th class="px-3 py-2.5 text-right">Adet</th>
            <th class="px-3 py-2.5 text-right hidden sm:table-cell">Ort. maliyet</th>
            <th class="px-3 py-2.5 text-right">Fiyat</th>
            <th class="px-3 py-2.5 text-right">Değer</th>
            <th class="px-3 py-2.5 text-right">K/Z</th>
            <th class="px-3 py-2.5 text-right hidden md:table-cell">Ağırlık</th>
            <th class="px-3 py-2.5 text-right hidden md:table-cell">F/K</th>
            <th class="px-3 py-2.5 text-right hidden lg:table-cell">Skor</th>
            <th class="px-3 py-2.5"><span class="sr-only">İşlemler</span></th>
          </tr></thead>
          <tbody class="font-mono">
            ${rows.map(r => `
              <tr class="border-t border-oa-border/60 hover:bg-[#121C30]/40">
                <td class="px-4 py-2.5">${stockCell(r.code, r.name, r.sector)}</td>
                <td class="px-3 py-2.5 text-right text-slate-200">${fq.format(r.qty)}</td>
                <td class="px-3 py-2.5 text-right text-slate-400 hidden sm:table-cell">${tl(r.avgCost)}</td>
                <td class="px-3 py-2.5 text-right text-white">${tl(r.price)}${r.src === 'close' ? '<span class="text-slate-500">*</span>' : ''}</td>
                <td class="px-3 py-2.5 text-right text-white">${tl(r.value)}</td>
                <td class="px-3 py-2.5 text-right whitespace-nowrap ${tone(r.pnl)}"><div>${signedTl(r.pnl)}</div><div class="text-[11px]">${signed(r.pnlPct)}</div></td>
                <td class="px-3 py-2.5 text-right text-slate-300 hidden md:table-cell">${pct(r.weight)}</td>
                <td class="px-3 py-2.5 text-right text-slate-300 hidden md:table-cell">${mult(r.fk)}</td>
                <td class="px-3 py-2.5 text-right text-amber-300 hidden lg:table-cell">${r.score == null ? '—' : f1.format(r.score)}</td>
                <td class="px-3 py-2.5 text-right whitespace-nowrap">
                  <button type="button" onclick="Profile.prefillSell('${r.code}')" class="w-7 h-7 rounded-lg bg-[#090D18] border border-[#1E2B45] text-slate-400 hover:text-rose-400 text-xs" title="${r.code} satışı gir"><i class="fa-solid fa-arrow-right-from-bracket"></i></button>
                </td>
              </tr>`).join('')}
          </tbody>
          <tfoot class="font-mono">
            <tr class="border-t border-oa-border text-white">
              <td class="px-4 py-3 font-sans text-xs text-slate-400" colspan="2">Toplam${m.val.unpriced.length ? ` · fiyatı alınamayan: ${m.val.unpriced.join(', ')}` : ''}</td>
              <td class="hidden sm:table-cell"></td>
              <td class="px-3 py-3 text-right text-slate-400 text-xs">${tl(cost)}</td>
              <td class="px-3 py-3 text-right font-bold">${tl(total)}</td>
              <td class="px-3 py-3 text-right whitespace-nowrap ${tone(pnl)}"><div>${signedTl(pnl)}</div><div class="text-[11px]">${signed(pnlPct)}</div></td>
              <td class="hidden md:table-cell"></td>
              <td class="px-3 py-3 text-right text-slate-300 hidden md:table-cell">${mult(m.pe.multiple)}</td>
              <td class="px-3 py-3 text-right text-amber-300 hidden lg:table-cell">${m.score == null ? '—' : f1.format(m.score)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>`, 'overflow-hidden');
  }

  /** Part-to-whole as one segmented bar plus a labelled list (the list doubles as the table view). */
  function mixHtml(mix, colors) {
    return `
      <div class="px-4 sm:px-5 pb-5 space-y-3">
        <div class="flex h-3 rounded-full overflow-hidden gap-[2px] bg-oa-card" role="img" aria-label="Sektör ağırlıkları">
          ${mix.map(g => `<span style="width:${g.weight}%;background:${colors[g.key]}" title="${esc(g.key)}: %${f1.format(g.weight)}"></span>`).join('')}
        </div>
        <ul class="space-y-1.5">
          ${mix.map(g => `
            <li class="flex items-center gap-2 text-xs font-sans">
              <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background:${colors[g.key]}"></span>
              <span class="flex-1 min-w-0 truncate text-slate-300" title="${esc(g.key)}">${esc(g.key)}</span>
              <span class="font-mono text-slate-500 text-[11px]">${g.codes.join(', ')}</span>
              <span class="font-mono text-white w-12 text-right">${pct(g.weight)}</span>
            </li>`).join('')}
        </ul>
      </div>`;
  }

  function paintMix(m) {
    const el = document.getElementById('pfMix');
    if (!el) return;
    if (!m.mix.length) { el.innerHTML = ''; return; }
    el.innerHTML = card(`${cardHead('Sektör dağılımı', 'Piyasa değerine göre ağırlık (KAP sektörü).', `<button type="button" onclick="Profile.setTab('sectors')" class="text-[11px] font-bold text-[#7FA6FF] hover:text-white">Uzun dönem <i class="fa-solid fa-arrow-right"></i></button>`)}${mixHtml(m.mix, sectorColors(m.mix.map(g => g.key)))}`);
  }

  function paintRisk(m) {
    const el = document.getElementById('pfRisk');
    if (!el) return;
    const rows = m.val.rows.filter(r => r.value > 0);
    if (!rows.length) { el.innerHTML = ''; return; }
    const lim = LIMITS[store.risk];
    const top = rows[0];
    const topSector = m.mix[0];
    const notes = [];
    if (top.weight > lim.stock) notes.push(['warn', `Tek hissenin (${top.code}) payı ${pct(top.weight)}; ${RISKS[store.risk].toLocaleLowerCase('tr-TR')} profili için eşik ${pct(lim.stock, 0)}.`]);
    if (topSector && topSector.weight > lim.sector && m.mix.length > 0) notes.push(['warn', `${esc(topSector.key)} sektörünün payı ${pct(topSector.weight)}; eşik ${pct(lim.sector, 0)}.`]);
    if (rows.length > 1 && m.conc.effective < 4) notes.push(['info', `${rows.length} pozisyon ağırlıklar nedeniyle yaklaşık ${f1.format(m.conc.effective)} eşit pozisyon gibi davranıyor.`]);
    const lossShare = rows.filter(r => r.loss).reduce((s, r) => s + r.weight, 0);
    if (lossShare > 0) notes.push(['info', `Son 12 ayda zarar eden şirketlerin portföydeki payı ${pct(lossShare)}.`]);
    const levered = rows.filter(r => r.netDebtEbitda > 3).map(r => r.code);
    if (levered.length) notes.push(['info', `Net borcu FAVÖK'ünün 3 katını aşan: ${levered.join(', ')}.`]);
    if (!notes.length) notes.push(['ok', 'Seçtiğiniz risk profilinin yoğunlaşma eşiklerinin içindesiniz.']);
    const icon = { warn: 'fa-triangle-exclamation text-amber-400', info: 'fa-circle-info text-sky-400', ok: 'fa-circle-check text-emerald-400' };
    const all = m.multiples && m.multiples.all;
    const stat = (label, value, sub) => `
      <div class="rounded-xl bg-[#090D18] border border-[#162238] p-3">
        <div class="text-[10px] font-mono uppercase tracking-widest text-slate-500">${label}</div>
        <div class="text-lg font-mono font-bold text-white">${value}</div>
        <div class="text-[10px] text-slate-500 font-sans">${sub}</div>
      </div>`;
    el.innerHTML = card(`
      ${cardHead('Risk ve değerleme', `Eşikler profilinizdeki “${RISKS[store.risk]}” seçimine göre. Yatırım tavsiyesi değildir.`)}
      <div class="px-4 sm:px-5 pb-5 space-y-3">
        <div class="grid grid-cols-2 gap-2" data-no-glossary>
          ${stat('Portföy F/K', mult(m.pe.multiple), all ? `BIST medyan ${mult(all.pe)}` : `kapsam ${pct(m.pe.coverage, 0)}`)}
          ${stat('Portföy PD/DD', mult(m.pb.multiple), all ? `BIST medyan ${mult(all.pb)}` : `kapsam ${pct(m.pb.coverage, 0)}`)}
          ${stat('Ağırlıklı ROE', pct(m.roe), 'son 12 ay')}
          ${stat('En büyük pozisyon', pct(top.weight), top.code)}
        </div>
        <ul class="space-y-2">
          ${notes.map(([k, t]) => `<li class="flex gap-2 text-xs text-slate-300 font-sans leading-relaxed"><i class="fa-solid ${icon[k]} mt-0.5"></i><span>${t}</span></li>`).join('')}
        </ul>
        <p class="text-[10px] text-slate-500 font-sans">F/K ve PD/DD portföyün temsil ettiği toplam kâr ve özsermayeye göre hesaplanır (zarar eden ve bilançosu olmayan şirketler hariç, F/K kapsamı ${pct(m.pe.coverage, 0)}).</p>
      </div>`);
  }

  function paintDivs(m) {
    const el = document.getElementById('pfDivs');
    if (!el) return;
    if (!store.txs.length) { el.innerHTML = ''; return; }
    const items = m.received.items.slice(0, 8);
    const by = Object.entries(m.income.byCode).sort((a, b) => b[1] - a[1]);
    el.innerHTML = card(`
      ${cardHead('Temettü', `Hak kullanım tarihinden önceki gün elinizdeki adet × hisse başı tutar (brüt, stopaj hariç).${m.divAsOf ? ` Veri: ${fullDate(m.divAsOf)}.` : ''}`)}
      <div class="px-4 sm:px-5 pb-5 space-y-4">
        <div>
          <div class="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1.5">Son 12 ay, mevcut adetlerle</div>
          ${by.length ? `<ul class="space-y-1">${by.map(([c, v]) => `<li class="flex justify-between text-xs font-mono"><span class="text-slate-300">${c}</span><span class="text-emerald-400">${tl(v)}</span></li>`).join('')}</ul>` : '<p class="text-xs text-slate-500 font-sans">Pozisyonlarınız son 12 ayda nakit temettü dağıtmadı.</p>'}
        </div>
        <div>
          <div class="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1.5">Hak kazandığınız dağıtımlar · toplam ${tl(m.received.total)}</div>
          ${items.length ? `<ul class="space-y-1">${items.map(i => `<li class="flex justify-between gap-2 text-xs font-mono"><span class="text-slate-400">${fullDate(i.date)}</span><span class="text-slate-300">${i.code} · ${fq.format(i.qty)} × ₺${fq.format(i.amount)}</span><span class="text-white">${tl(i.cash)}</span></li>`).join('')}</ul>` : '<p class="text-xs text-slate-500 font-sans">İşlem tarihlerinize göre henüz hak kazanılmış dağıtım yok.</p>'}
        </div>
      </div>`);
  }

  function paintTxs() {
    const el = document.getElementById('pfTxs');
    if (!el) return;
    if (!store.txs.length) { el.innerHTML = ''; return; }
    const list = [...store.txs].sort((a, b) => b.date.localeCompare(a.date) || (b.seq || 0) - (a.seq || 0));
    el.innerHTML = card(`
      ${cardHead('İşlem geçmişi', `${list.length} kayıt`, `<button type="button" onclick="Profile.exportCsv()" class="text-[11px] font-bold text-[#7FA6FF] hover:text-white"><i class="fa-solid fa-file-csv"></i> CSV indir</button>`)}
      <div class="max-h-[360px] overflow-y-auto">
        ${list.map(t => `
          <div class="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-t border-oa-border/60 text-xs font-mono">
            <span class="w-24 shrink-0 text-slate-400">${fullDate(t.date)}</span>
            <span class="w-12 shrink-0 font-bold ${t.type === 'buy' ? 'text-emerald-400' : 'text-rose-400'}">${t.type === 'buy' ? 'ALIŞ' : 'SATIŞ'}</span>
            <button type="button" onclick="Profile.open('${t.code}')" class="w-16 shrink-0 text-left font-bold text-white hover:text-[#7FA6FF]">${t.code}</button>
            <span class="flex-1 min-w-0 text-slate-300 truncate">${fq.format(t.qty)} × ${tl(t.price)}${t.fee ? ` + ${tl(t.fee)}` : ''}</span>
            <span class="text-white hidden sm:inline">${tl(t.qty * t.price)}</span>
            <button type="button" onclick="Profile.removeTx('${t.id}')" class="w-7 h-7 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40" title="Kaydı sil"><i class="fa-solid fa-trash-can"></i></button>
          </div>`).join('')}
      </div>`);
  }

  function paintNotes(m) {
    const el = document.getElementById('pfNotes');
    if (!el) return;
    const codes = [...new Set([...m.val.rows.map(r => r.code), ...Object.keys(store.notes).filter(c => store.notes[c])])];
    if (!codes.length) { el.innerHTML = ''; return; }
    el.innerHTML = card(`
      ${cardHead('Yatırım notlarım', 'Neden aldığınızı, neyi beklediğinizi ve hangi durumda çıkacağınızı yazın. Komutla da eklenir: <code class="font-mono text-[#7FA6FF]">not THYAO metin</code>')}
      <div class="px-4 sm:px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        ${codes.map(c => `
          <label class="block">
            <span class="block text-xs font-mono font-bold text-white mb-1">${c} <span class="font-sans font-normal text-slate-500">${esc(company(c).name)}</span></span>
            <textarea rows="3" maxlength="600" onchange="Profile.setNote('${c}', this.value)" placeholder="Tez, hedef, çıkış koşulu…" class="w-full px-3 py-2 rounded-xl bg-[#0C1322] border border-[#1A2540] text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#2F6BFF] font-sans resize-y">${esc(store.notes[c] || '')}</textarea>
          </label>`).join('')}
      </div>`);
  }

  /* ---------- long-term sectors tab ---------- */
  function sectorsSkeleton() {
    const btn = (on, onclick, label) => `<button type="button" onclick="${onclick}" class="px-3 py-1.5 rounded-lg text-[11px] font-bold ${on ? 'bg-[#2F6BFF] text-white' : 'text-slate-400 hover:text-white'}">${label}</button>`;
    return `
      ${card(`
        ${cardHead('Sektörlerin uzun dönem seyri', 'Her sektör, en büyük şirketlerinden kurulan eşit ağırlıklı haftalık endeksle gösterilir (seçilen dönemin başında 100). “Portföyüm” bugünkü ağırlıklarınızın geçmişte nasıl seyredeceğini gösterir; gerçek alım tarihlerinizden bağımsızdır.',
          `<div class="flex flex-wrap gap-2">
            <div class="flex rounded-xl bg-[#0C1322] border border-[#1A2540] p-1">${[1, 3, 5, 10].map(y => btn(ui.window === y, `Profile.setWindow(${y})`, `${y}Y`)).join('')}</div>
            <div class="flex rounded-xl bg-[#0C1322] border border-[#1A2540] p-1">${btn(ui.ccy === 'TRY', "Profile.setCcy('TRY')", 'TL')}${btn(ui.ccy === 'USD', "Profile.setCcy('USD')", 'Dolar')}</div>
          </div>`)}
        <div class="px-4 sm:px-5 pb-5">
          <div id="pfLtLegend" class="flex flex-wrap gap-x-4 gap-y-1.5 mb-3"></div>
          <div class="relative h-[320px]"><canvas id="pfLtChart" aria-label="Sektör endeksleri"></canvas></div>
          <p id="pfLtStatus" class="text-[11px] text-slate-500 font-sans mt-2" role="status">Fiyat geçmişi yükleniyor…</p>
        </div>`)}
      <div id="pfLtTable"></div>
      <div id="pfLtCards" class="grid grid-cols-1 lg:grid-cols-2 gap-5"></div>`;
  }

  /** Sectors to study: the portfolio's; with an empty portfolio, those of watched and viewed stocks. */
  function sectorsToStudy(m) {
    if (m.mix.length) return { from: 'portfolio', list: m.mix.slice(0, MAX_SECTORS).map(g => ({ sector: g.key, weight: g.weight, holdings: g.codes })) };
    const counts = new Map();
    const bump = (code, n) => { const s = company(code).sec; if (s) counts.set(s, (counts.get(s) || 0) + n); };
    (typeof getWatchlist === 'function' ? getWatchlist() : []).forEach(c => bump(c, 2));
    store.views.forEach(v => bump(v.code, 1));
    const list = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([sector]) => ({ sector, weight: null, holdings: [] }));
    return { from: 'interest', list };
  }

  /** The sector's largest companies by market value (shares x last close), holdings first. */
  function constituents(sector, holdings, fund, tech) {
    const ranked = [...directory()]
      .filter(([code, c]) => c.sec === sector && fund && fund.data[code] && techRow(tech, code))
      .map(([code]) => ({ code, mcap: fund.data[code][1] * techRow(tech, code).close }))
      .filter(x => x.mcap > 0)
      .sort((a, b) => b.mcap - a.mcap)
      .map(x => x.code);
    const out = [...holdings];
    for (const c of ranked) {
      if (out.length >= holdings.length + MEMBERS_PER_SECTOR || out.length >= 8) break;
      if (!out.includes(c)) out.push(c);
    }
    return out;
  }

  const study = { key: null, promise: null };
  function longTerm(m) {
    const { from, list } = sectorsToStudy(m);
    const weights = m.val.rows.filter(r => r.value > 0).map(r => [r.code, r.weight]);
    const key = JSON.stringify([list.map(s => [s.sector, s.holdings]), weights]);
    if (study.key === key) return study.promise;
    study.key = key;
    study.promise = (async () => {
      const [fund, tech] = [m.fund, m.tech];
      const [bist, usd] = await Promise.all([history('BIST100'), history('USDTRY')]);
      const bistIdx = Portfolio.blendIndex([bist]);
      const sectors = await Promise.all(list.map(async s => {
        const members = constituents(s.sector, s.holdings, fund, tech);
        const maps = await Promise.all(members.map(c => history(sym(c))));
        const okIdx = maps.map((mp, i) => (mp.size > 8 ? i : -1)).filter(i => i >= 0);
        const index = Portfolio.blendIndex(okIdx.map(i => maps[i]));
        const peers = [...directory()].filter(([, c]) => c.sec === s.sector).map(([code]) => code);
        return {
          ...s, members: okIdx.map(i => ({ code: members[i], from: [...maps[i].keys()][0] })), index, peers: peers.length,
          usd: Portfolio.deflate(index, usd),
          fundamentals: Portfolio.sectorFundamentals(peers.map(c => fundRow(fund, c)).filter(Boolean)),
          breadth: Portfolio.sectorBreadth(peers.map(c => techRow(tech, c)).filter(Boolean)),
          multiples: m.multiples && m.multiples.sectors[s.sector]
        };
      }));
      let mine = null;
      if (weights.length) {
        const maps = await Promise.all(weights.map(([c]) => history(sym(c))));
        const idx = Portfolio.blendIndex(maps, weights.map(w => w[1]));
        if (idx.keys.length > 8) mine = { index: idx, usd: Portfolio.deflate(idx, usd) };
      }
      return { from, sectors, bist: { index: bistIdx, usd: Portfolio.deflate(bistIdx, usd) }, mine, usdMap: usd };
    })();
    study.promise.catch(() => { study.key = null; });
    return study.promise;
  }

  /** The part of a series inside the chosen window, rebased to 100 at its start. */
  function windowed(series, years) {
    if (!series || !series.keys.length) return null;
    const last = Date.parse(`${series.keys[series.keys.length - 1]}T00:00:00Z`);
    const from = new Date(last - years * 365.25 * 864e5).toISOString().slice(0, 10);
    const i0 = series.keys.findIndex(k => k >= from);
    if (i0 < 0 || i0 >= series.keys.length - 1) return null;
    const base = series.values[i0];
    return { keys: series.keys.slice(i0), values: series.values.slice(i0).map(v => v / base * 100), partial: i0 === 0 && series.keys[0] > from };
  }

  let ltChart = null;
  function paintLongTerm(res) {
    const status = document.getElementById('pfLtStatus');
    const legend = document.getElementById('pfLtLegend');
    const canvas = document.getElementById('pfLtChart');
    if (!canvas || !legend) return;
    const pick = s => (s ? (ui.ccy === 'USD' ? s.usd : s.index) : null);
    const colors = sectorColors(res.sectors.map(s => s.sector));
    const lines = [
      ...res.sectors.map(s => ({ label: s.sector, color: colors[s.sector], data: windowed(pick(s), ui.window), dash: [] , width: 2 })),
      { label: 'BIST 100', color: BENCH_COLOR, data: windowed(pick(res.bist), ui.window), dash: [5, 4], width: 2 },
      ...(res.mine ? [{ label: 'Portföyüm (bugünkü ağırlıklar)', color: MINE_COLOR, data: windowed(pick(res.mine), ui.window), dash: [], width: 3 }] : [])
    ].filter(l => l.data);

    if (!res.sectors.length) {
      if (status) status.textContent = 'İncelenecek sektör yok: portföyünüze işlem ekleyin ya da izleme listenize hisse ekleyin.';
      legend.innerHTML = '';
      return;
    }
    const keys = [...new Set(lines.flatMap(l => l.data.keys))].sort();
    legend.innerHTML = lines.map(l => `
      <span class="inline-flex items-center gap-1.5 text-[11px] text-slate-300 font-sans">
        <span class="inline-block w-4 border-t-2" style="border-color:${l.color};border-top-style:${l.dash.length ? 'dashed' : 'solid'}"></span>${esc(l.label)}
      </span>`).join('');
    const datasets = lines.map(l => {
      const at = new Map(l.data.keys.map((k, i) => [k, l.data.values[i]]));
      return {
        label: l.label, data: keys.map(k => at.get(k) ?? null), borderColor: l.color, backgroundColor: l.color,
        borderWidth: l.width, borderDash: l.dash, pointRadius: 0, pointHoverRadius: 4, tension: 0, spanGaps: true
      };
    });
    if (ltChart) ltChart.destroy();
    if (typeof Chart === 'undefined') return;
    ltChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: keys, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0E1626', borderColor: '#1E2B45', borderWidth: 1, titleColor: '#F8FAFC', bodyColor: '#CBD5E1', padding: 10, cornerRadius: 8,
            itemSort: (a, b) => b.parsed.y - a.parsed.y,
            callbacks: {
              title: items => `${fullDate(items[0].label)} haftası`,
              label: c => (c.parsed.y == null ? null : ` ${c.dataset.label}: ${f1.format(c.parsed.y)} (${signed(c.parsed.y - 100)})`)
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#64748B', maxTicksLimit: 8, maxRotation: 0, font: { size: 10 }, callback(v) { const k = this.getLabelForValue(v); return k ? `${k.slice(5, 7)}.${k.slice(0, 4)}` : ''; } } },
          // Over 5-10 years a log scale keeps equal percentage moves the same height
          y: { type: ui.window >= 5 ? 'logarithmic' : 'linear', grid: { color: '#1E2B45' }, ticks: { color: '#64748B', font: { size: 10 }, maxTicksLimit: 7, callback: v => f0.format(v) } }
        }
      }
    });
    const partial = lines.filter(l => l.data.partial).map(l => l.label);
    if (status) {
      status.textContent = `${res.from === 'interest' ? 'Portföyünüz boş; izleme listenizdeki ve incelediğiniz hisselerin sektörleri gösteriliyor. ' : ''}`
        + `Yahoo Finance haftalık kapanışları (gecikmeli)${ui.ccy === 'USD' ? ', USD/TRY kuruyla dolara çevrilmiş' : ''}${ui.window >= 5 ? '; logaritmik ölçek' : ''}. Temettüler dahil değildir. `
        + 'Sonradan halka arz olan şirketler fiyat geçmişleri başladığında endekse katılır (kartlarda başlangıç yılı); erken dönemde endeks daha az şirketten oluşur.'
        + (partial.length ? ` Geçmişi seçilen dönemden kısa: ${partial.join(', ')}.` : '');
    }
  }

  function paintLongTermTable(res) {
    const el = document.getElementById('pfLtTable');
    if (!el) return;
    const pick = s => (ui.ccy === 'USD' ? s.usd : s.index);
    const colors = sectorColors(res.sectors.map(s => s.sector));
    const rows = [
      ...res.sectors.map(s => ({ label: s.sector, color: colors[s.sector], st: Portfolio.seriesStats(pick(s)), weight: s.weight })),
      { label: 'BIST 100', color: BENCH_COLOR, st: Portfolio.seriesStats(pick(res.bist)), weight: null },
      ...(res.mine ? [{ label: 'Portföyüm', color: MINE_COLOR, st: Portfolio.seriesStats(pick(res.mine)), weight: null }] : [])
    ];
    const cell = v => `<td class="px-3 py-2.5 text-right ${tone(v)}">${signed(v, 0)}</td>`;
    el.innerHTML = card(`
      ${cardHead(`Getiri, oynaklık ve düşüş · ${ui.ccy === 'USD' ? 'dolar bazında' : 'TL bazında'}`, 'Yıllık bileşik getiri endeksin tüm geçmişi üzerinden; oynaklık haftalık getirilerin yıllıklandırılmış standart sapması; en derin düşüş zirveden dibe.')}
      <div class="overflow-x-auto" data-no-glossary>
        <table class="w-full text-left border-collapse text-sm">
          <thead><tr class="border-y border-oa-border text-[10px] font-mono uppercase tracking-widest text-slate-500">
            <th class="px-4 py-2.5">Seri</th>
            <th class="px-3 py-2.5 text-right">1Y</th><th class="px-3 py-2.5 text-right">3Y</th><th class="px-3 py-2.5 text-right">5Y</th><th class="px-3 py-2.5 text-right hidden sm:table-cell">10Y</th>
            <th class="px-3 py-2.5 text-right hidden md:table-cell">Yıllık bileşik</th>
            <th class="px-3 py-2.5 text-right hidden md:table-cell">Oynaklık</th>
            <th class="px-3 py-2.5 text-right hidden md:table-cell">En derin düşüş</th>
          </tr></thead>
          <tbody class="font-mono">
            ${rows.map(r => `
              <tr class="border-t border-oa-border/60">
                <td class="px-4 py-2.5 font-sans text-xs text-slate-200"><span class="inline-flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background:${r.color}"></span>${esc(r.label)}${r.weight != null ? ` <span class="text-slate-500 font-mono">${pct(r.weight, 0)}</span>` : ''}</span></td>
                ${r.st ? `${cell(r.st.r1)}${cell(r.st.r3)}${cell(r.st.r5)}<td class="px-3 py-2.5 text-right hidden sm:table-cell ${tone(r.st.r10)}">${signed(r.st.r10, 0)}</td>
                <td class="px-3 py-2.5 text-right hidden md:table-cell ${tone(r.st.cagr)}">${signed(r.st.cagr)}</td>
                <td class="px-3 py-2.5 text-right hidden md:table-cell text-slate-300">${pct(r.st.vol, 0)}</td>
                <td class="px-3 py-2.5 text-right hidden md:table-cell text-rose-400">${signed(r.st.maxDD, 0)}</td>` : '<td colspan="7" class="px-3 py-2.5 text-right text-slate-500 text-xs">veri yok</td>'}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`, 'overflow-hidden');
  }

  function paintSectorCards(res, m) {
    const el = document.getElementById('pfLtCards');
    if (!el) return;
    const colors = sectorColors(res.sectors.map(s => s.sector));
    const all = m.multiples && m.multiples.all;
    el.innerHTML = res.sectors.map(s => {
      const f = s.fundamentals, b = s.breadth, mu = s.multiples;
      const usdSt = Portfolio.seriesStats(s.usd), bistUsd = Portfolio.seriesStats(res.bist.usd);
      const vsBist = usdSt && bistUsd && Number.isFinite(usdSt.r5) && Number.isFinite(bistUsd.r5) ? usdSt.r5 - bistUsd.r5 : null;
      const mine = m.val.rows.filter(r => r.sector === s.sector && r.value > 0);
      const kv = (label, value, sub = '') => `<div class="flex items-baseline justify-between gap-3 py-1.5 border-t border-oa-border/50 text-xs"><span class="text-slate-400 font-sans">${label}</span><span class="font-mono text-white text-right">${value}${sub ? ` <span class="text-slate-500">${sub}</span>` : ''}</span></div>`;
      return card(`
        <div class="px-4 sm:px-5 pt-4 pb-2 flex items-start gap-3">
          <span class="w-3 h-3 rounded-sm mt-1.5 shrink-0" style="background:${colors[s.sector]}"></span>
          <div class="min-w-0 flex-1">
            <h3 class="font-serif font-bold text-white text-base">${esc(s.sector)}</h3>
            <p class="text-[11px] text-slate-500 font-sans">Endeks: ${s.members.length ? s.members.map(x => `${x.code} <span class="text-slate-600">${x.from.slice(0, 4)}</span>`).join(', ') : '—'} · sektörde ${s.peers} şirket (bilançosu olan ${f.n})${s.weight != null ? ` · portföyde ${pct(s.weight)}` : ''}</p>
          </div>
        </div>
        <div class="px-4 sm:px-5 pb-4" data-no-glossary>
          ${kv('Medyan F/K · PD/DD', `${mult(mu && mu.pe)} · ${mult(mu && mu.pb)}`, all ? `BIST ${mult(all.pe)} · ${mult(all.pb)}` : '')}
          ${kv('Medyan ROE · net marj', `${pct(f.roe)} · ${pct(f.netMargin)}`)}
          ${kv('Medyan net borç / FAVÖK', Number.isFinite(f.netDebtEbitda) ? `${f1.format(f.netDebtEbitda)}x` : '—')}
          ${kv('Kâr eden şirket oranı', pct(f.profitable, 0))}
          ${kv('200 günlük ortalamanın üstünde', pct(b.above200, 0), `3 ay medyan ${signed(b.m3)}`)}
          ${kv('52 hafta zirvesine uzaklık (medyan)', signed(b.hi52))}
          ${kv('5 yıl dolar getirisi BIST 100\'e göre', vsBist == null ? '—' : `<span class="${tone(vsBist)}">${vsBist > 0 ? '+' : vsBist < 0 ? '−' : ''}${f0.format(Math.abs(vsBist))} puan</span>`)}
          ${mine.length ? `<div class="mt-3 space-y-1.5">${mine.map(r => `
            <div class="flex items-center justify-between gap-3 text-[11px] font-mono rounded-lg bg-[#090D18] border border-[#162238] px-3 py-2">
              <button type="button" onclick="Profile.open('${r.code}')" class="font-bold text-white hover:text-[#7FA6FF]">${r.code}</button>
              <span class="text-slate-400">F/K ${mult(r.fk)} <span class="text-slate-600">/ ${mult(mu && mu.pe)}</span></span>
              <span class="text-slate-400">PD/DD ${mult(r.pb)} <span class="text-slate-600">/ ${mult(mu && mu.pb)}</span></span>
              <span class="text-slate-400">ROE ${pct(r.roe)} <span class="text-slate-600">/ ${pct(f.roe)}</span></span>
            </div>`).join('')}<p class="text-[10px] text-slate-500 font-sans">Hisseniz / sektör medyanı.</p></div>` : ''}
        </div>`);
    }).join('');
  }

  /* ---------- activity tab ---------- */
  function ago(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return 'az önce';
    if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
    if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} gün önce`;
    return new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  }

  function activityHtml() {
    const views = store.views;
    const fin = code => (typeof getCachedStockFinancials === 'function' ? getCachedStockFinancials(code) : null);
    const interest = Portfolio.groupWeights(views.map(v => ({ code: v.code, value: v.n, sector: company(v.code).sec || 'Diğer' })), r => r.sector);
    const watch = typeof getWatchlist === 'function' ? getWatchlist() : [];
    const held = new Set(Portfolio.positions(store.txs).filter(p => p.qty > 0).map(p => p.code));
    const list = views.length ? views.map(v => {
      const f = fin(v.code);
      const live = f && f.liveTime;
      return `
        <div class="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-t border-oa-border/60">
          <div class="flex-1 min-w-0">${stockCell(v.code, company(v.code).name)}</div>
          <div class="hidden sm:block text-right text-[11px] font-sans text-slate-500 w-28">${ago(v.at)}<br>${v.n} kez</div>
          <div class="text-right font-mono text-xs w-24">${live ? `<div class="text-white">₺${f.price}</div><div class="${f.isPositive ? 'text-emerald-400' : 'text-rose-400'}">${f.change}</div>` : '<span class="text-slate-600">—</span>'}</div>
          <div class="flex gap-1">
            <button type="button" onclick="toggleStockWatchlist('${v.code}'); Profile.render()" class="w-7 h-7 rounded-lg bg-[#090D18] border border-[#1E2B45] text-xs ${watch.includes(v.code) ? 'text-amber-400' : 'text-slate-400 hover:text-amber-400'}" title="İzleme listesi"><i class="fa-${watch.includes(v.code) ? 'solid' : 'regular'} fa-star"></i></button>
            <button type="button" onclick="Profile.quickAdd('${v.code}')" class="w-7 h-7 rounded-lg bg-[#090D18] border border-[#1E2B45] text-xs ${held.has(v.code) ? 'text-emerald-400' : 'text-slate-400 hover:text-emerald-400'}" title="Portföye ekle"><i class="fa-solid fa-briefcase"></i></button>
          </div>
        </div>`;
    }).join('') : empty('Henüz hisse incelemediniz. Bir hisse sayfası açtığınızda burada listelenir.');
    return `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div class="lg:col-span-2 min-w-0">
          ${card(`${cardHead('İncelediğiniz hisseler', `Son ${MAX_VIEWS} hisse, en yeni üstte.`, views.length ? '<button type="button" onclick="Profile.clearViews()" class="text-[11px] font-bold text-slate-400 hover:text-rose-400"><i class="fa-solid fa-broom"></i> Temizle</button>' : '')}
            <div class="max-h-[560px] overflow-y-auto">${list}</div>`, 'overflow-hidden')}
        </div>
        <div class="space-y-5 min-w-0">
          ${interest.length ? card(`${cardHead('İlgi alanınız', 'İncelediğiniz hisselerin sektörleri, inceleme sayısına göre.')}${mixHtml(interest.slice(0, 7), sectorColors(interest.slice(0, 7).map(g => g.key)))}`) : ''}
          ${card(`${cardHead('İzleme listesi ve alarmlar', `${watch.length} hisse izleniyor.`)}
            <div class="px-4 sm:px-5 pb-5 space-y-3">
              <div class="flex flex-wrap gap-1.5">${watch.map(c => `<button type="button" onclick="Profile.open('${c}')" class="px-2 py-1 rounded-lg bg-[#090D18] border border-[#1E2B45] text-[11px] font-mono font-bold text-slate-300 hover:text-white">${c}</button>`).join('') || '<span class="text-xs text-slate-500 font-sans">Liste boş.</span>'}</div>
              <button type="button" onclick="toggleWatchlistDrawer(true)" class="w-full py-2 rounded-xl bg-[#0C1322] border border-[#1A2540] text-xs font-bold text-slate-300 hover:text-white"><i class="fa-solid fa-bell"></i> Listeyi ve alarmları aç</button>
            </div>`)}
        </div>
      </div>`;
  }

  /* ---------- commands tab ---------- */
  const HELP = [
    ['al KOD ADET [FİYAT] [TARİH]', 'al THYAO 100 312,50', 'Portföye alış kaydı. Fiyat yoksa gecikmeli güncel fiyat, tarih yoksa bugün.'],
    ['sat KOD ADET [FİYAT] [TARİH]', 'sat THYAO 50', 'Satış kaydı; elinizdeki adetten fazlası satılamaz.'],
    ['izle KOD', 'izle ASELS', 'İzleme listesine ekler ya da çıkarır.'],
    ['alarm KOD FİYAT', 'alarm TUPRS 180', 'Fiyat alarmı: hedef fiyatın üstündeyse yükselince, altındaysa düşünce uyarır.'],
    ['KOD veya aç KOD', 'FROTO', 'Hisse sayfasını açar.'],
    ['bilanço KOD', 'bilanço BIMAS', 'Hisse sayfasında bilanço sekmesini açar.'],
    ['kıyas KOD KOD [KOD]', 'kıyas EREGL KRDMD', 'Hisse karşılaştırmasına ekler.'],
    ['not KOD METİN', 'not FROTO ihracat büyümesi, 3 yıl', 'Hisseye yatırım notu yazar (boş metin siler).'],
    ['temettü', 'temettü', 'Temettü takvimini açar.'],
    ['portföy', 'portföy', 'Bu sayfanın portföy sekmesine döner.']
  ];

  function commandsHtml() {
    const cmds = store.cmds;
    return `
      <div class="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div class="lg:col-span-3 min-w-0">
          ${card(`${cardHead('Komut rehberi', 'Komut satırına ya da Ctrl K paletine yazın (palette başına / koyun: /al THYAO 100). Satıra tıklayınca örnek komut kutuya yazılır. Komutlar yalnızca Verity içindeki kayıtları değiştirir; aracı kuruma emir iletilmez.')}
            <div class="divide-y divide-oa-border/60 border-t border-oa-border/60">
              ${HELP.map(([syntax, example, desc]) => `
                <button type="button" data-cmd="${esc(example)}" onclick="Profile.fill(this.dataset.cmd)" class="w-full text-left px-4 sm:px-5 py-3 hover:bg-[#121C30]/40 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                  <code class="font-mono text-xs text-[#7FA6FF] sm:w-64 shrink-0">${esc(syntax)}</code>
                  <span class="text-xs text-slate-400 font-sans flex-1">${desc}</span>
                  <code class="font-mono text-[11px] text-slate-500 shrink-0">${esc(example)}</code>
                </button>`).join('')}
            </div>`, 'overflow-hidden')}
        </div>
        <div class="lg:col-span-2 space-y-5 min-w-0">
          ${card(`${cardHead('Kayıtlı komutlar', 'Sık kullandığınız komutları yıldızlayın; komut satırının altında kısayol olarak çıkar.')}
            <div class="px-4 sm:px-5 pb-5 space-y-1.5">
              ${store.saved.length ? store.saved.map((c, i) => `
                <div class="flex items-center gap-2 rounded-lg bg-[#090D18] border border-[#162238] px-3 py-2">
                  <code class="flex-1 min-w-0 truncate font-mono text-xs text-slate-200">${esc(c)}</code>
                  <button type="button" onclick="Profile.runSaved(${i})" class="text-[11px] font-bold text-[#7FA6FF] hover:text-white">Çalıştır</button>
                  <button type="button" onclick="Profile.unsave(${i})" class="text-slate-500 hover:text-rose-400 text-xs" title="Kaldır"><i class="fa-solid fa-xmark"></i></button>
                </div>`).join('') : '<p class="text-xs text-slate-500 font-sans">Henüz kayıtlı komut yok.</p>'}
            </div>`)}
          ${card(`${cardHead('Komut geçmişi', `Son ${MAX_CMDS} komut.`, cmds.length ? '<button type="button" onclick="Profile.clearCmds()" class="text-[11px] font-bold text-slate-400 hover:text-rose-400"><i class="fa-solid fa-broom"></i> Temizle</button>' : '')}
            <div class="max-h-[420px] overflow-y-auto">
              ${cmds.length ? cmds.map((c, i) => `
                <div class="flex items-start gap-2 px-4 sm:px-5 py-2.5 border-t border-oa-border/60">
                  <i class="fa-solid ${c.ok ? 'fa-check text-emerald-400' : 'fa-xmark text-rose-400'} text-xs mt-1"></i>
                  <div class="flex-1 min-w-0">
                    <code class="block font-mono text-xs text-slate-200 truncate">${esc(c.text)}</code>
                    <span class="block text-[11px] text-slate-500 font-sans truncate">${esc(c.msg || '')} · ${ago(c.at)}</span>
                  </div>
                  <button type="button" onclick="Profile.fill(Profile.cmdText(${i}))" class="text-slate-500 hover:text-white text-xs" title="Tekrar yaz"><i class="fa-solid fa-rotate-left"></i></button>
                  <button type="button" onclick="Profile.saveCmd(${i})" class="text-xs ${store.saved.includes(c.text) ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400'}" title="Kaydet"><i class="fa-${store.saved.includes(c.text) ? 'solid' : 'regular'} fa-star"></i></button>
                </div>`).join('') : empty('Henüz komut çalıştırmadınız.')}
            </div>`, 'overflow-hidden')}
        </div>
      </div>`;
  }

  /* ---------- settings tab ---------- */
  function settingsHtml() {
    const input = 'w-full px-3 py-2.5 rounded-xl bg-[#0C1322] border border-[#1A2540] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2F6BFF] font-sans';
    const label = 'block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1';
    const radios = (name, opts, cur) => Object.entries(opts).map(([k, v]) => `
      <label class="cursor-pointer"><input type="radio" name="${name}" value="${k}" class="peer sr-only" ${cur === k ? 'checked' : ''}>
        <span class="block px-3 py-2 rounded-xl border border-[#1A2540] text-xs text-slate-400 peer-checked:border-[#2F6BFF] peer-checked:bg-[#2F6BFF]/15 peer-checked:text-white">${v}</span></label>`).join('');
    return `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        ${card(`${cardHead('Yatırımcı profili', 'Vade ve risk seçiminiz portföy sayfasındaki yoğunlaşma eşiklerini belirler.')}
          <form onsubmit="Profile.saveSettings(event)" class="px-4 sm:px-5 pb-5 space-y-4">
            <label class="block"><span class="${label}">Adınız (isteğe bağlı)</span><input id="pfName" maxlength="40" value="${esc(store.name)}" placeholder="Ad Soyad" class="${input}"></label>
            <div><span class="${label}">Yatırım vadesi</span><div class="grid grid-cols-1 sm:grid-cols-3 gap-2">${radios('pfHorizon', HORIZONS, store.horizon)}</div></div>
            <div><span class="${label}">Risk tercihi</span><div class="grid grid-cols-3 gap-2">${radios('pfRisk', RISKS, store.risk)}</div></div>
            <p class="text-[11px] text-slate-500 font-sans">Eşikler: tek hisse ${pct(LIMITS[store.risk].stock, 0)}, tek sektör ${pct(LIMITS[store.risk].sector, 0)} (${RISKS[store.risk].toLocaleLowerCase('tr-TR')}).</p>
            <button type="submit" class="px-4 py-2.5 rounded-xl bg-[#2F6BFF] hover:bg-[#4A7FFF] text-white text-sm font-semibold">Kaydet</button>
          </form>`)}
        ${card(`${cardHead('Verileriniz', 'Profil, işlemler, notlar, inceleme ve komut geçmişi yalnızca bu tarayıcıda saklanır. Başka cihaza taşımak ya da yedeklemek için dışa aktarın.')}
          <div class="px-4 sm:px-5 pb-5 space-y-3">
            <div class="grid grid-cols-2 gap-2 text-xs font-mono">
              <div class="rounded-xl bg-[#090D18] border border-[#162238] p-3"><div class="text-slate-500">İşlem</div><div class="text-white text-lg font-bold">${store.txs.length}</div></div>
              <div class="rounded-xl bg-[#090D18] border border-[#162238] p-3"><div class="text-slate-500">İncelenen</div><div class="text-white text-lg font-bold">${store.views.length}</div></div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" onclick="Profile.exportJson()" class="px-3.5 py-2 rounded-xl bg-[#0C1322] border border-[#1A2540] text-xs font-bold text-slate-300 hover:text-white"><i class="fa-solid fa-download"></i> Dışa aktar (JSON)</button>
              <label class="px-3.5 py-2 rounded-xl bg-[#0C1322] border border-[#1A2540] text-xs font-bold text-slate-300 hover:text-white cursor-pointer"><i class="fa-solid fa-upload"></i> İçe aktar
                <input type="file" accept="application/json,.json" class="sr-only" onchange="Profile.importJson(this)"></label>
              <button type="button" onclick="Profile.reset()" class="px-3.5 py-2 rounded-xl bg-rose-950/40 border border-rose-800/50 text-xs font-bold text-rose-300 hover:text-white"><i class="fa-solid fa-trash-can"></i> Profili sıfırla</button>
            </div>
            <p id="pfDataMsg" class="text-xs text-slate-400 font-sans" role="status"></p>
          </div>`)}
      </div>`;
  }

  /* ---------- rendering ---------- */
  let builtTab = null;
  async function render() {
    const root = document.getElementById('pfBody');
    if (!root) return;
    paintHeader();
    paintTabs();
    paintChips();
    if (builtTab !== ui.tab || ui.tab === 'activity' || ui.tab === 'commands' || ui.tab === 'settings') {
      builtTab = ui.tab;
      if (ui.tab === 'portfolio') root.innerHTML = portfolioSkeleton();
      else if (ui.tab === 'sectors') root.innerHTML = sectorsSkeleton();
      else if (ui.tab === 'activity') root.innerHTML = activityHtml();
      else if (ui.tab === 'commands') root.innerHTML = commandsHtml();
      else root.innerHTML = settingsHtml();
    }
    if (ui.tab === 'portfolio') {
      codeOptions();
      if (ui.prefill) {
        const { code, type } = ui.prefill;
        ui.prefill = null;
        const c = document.getElementById('pfCode');
        if (c) c.value = code;
        const radio = document.querySelector(`input[name="pfType"][value="${type}"]`);
        if (radio) radio.checked = true;
        const q = document.getElementById('pfQty');
        if (q) { q.focus(); q.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      }
    }
    if (ui.tab === 'activity' && store.views.length && window.LiveData) {
      const need = store.views.slice(0, 15).map(v => v.code).filter(c => { const f = getCachedStockFinancials(c); return !f || !f.liveTime; });
      if (need.length) LiveData.ensure(need).then(() => { if (ui.tab === 'activity' && appState.activeView === 'profile') render(); });
    }
    await update();
  }

  async function update() {
    const token = ++ui.token;
    let m;
    try { m = await model(); } catch (e) { console.warn('[Profile] model failed:', e.message); return; }
    if (token !== ui.token) return;
    paintKpis(m);
    if (ui.tab === 'portfolio') {
      paintHoldings(m); paintMix(m); paintRisk(m); paintDivs(m); paintTxs(); paintNotes(m);
    } else if (ui.tab === 'sectors') {
      const status = document.getElementById('pfLtStatus');
      try {
        const res = await longTerm(m);
        if (token !== ui.token || ui.tab !== 'sectors') return;
        paintLongTerm(res);
        paintLongTermTable(res);
        paintSectorCards(res, m);
      } catch (e) {
        if (status) status.textContent = 'Fiyat geçmişi şu an alınamadı. Birazdan tekrar deneyin.';
      }
    }
  }

  /* ---------- side menu and header ---------- */
  function paintMenu() {
    const name = document.getElementById('menuProfileName');
    const sub = document.getElementById('menuProfileSub');
    const av = document.getElementById('menuProfileAvatar');
    const n = Portfolio.positions(store.txs).filter(p => p.qty > 0).length;
    if (name) name.textContent = store.name.trim() || 'Profilim';
    if (sub) sub.textContent = n ? `${n} pozisyon · portföy ve geçmiş` : 'Portföy, geçmiş ve komutlar';
    if (av) av.innerHTML = initials();
  }

  /* ---------- trades ---------- */
  function addTx(tx) {
    store.seq += 1;
    const full = { id: `tx_${Date.now().toString(36)}_${store.seq}`, seq: store.seq, fee: 0, ...tx };
    store.txs.push(full);
    save();
    study.key = null;
    ui.lastTx = full.id;
    return full;
  }

  /** Validates and records a trade; returns { ok, msg }. */
  async function trade({ type, code, qty, price, date, fee }) {
    if (!known(code)) return { ok: false, msg: `${code} BIST listesinde bulunamadı.` };
    if (!(qty > 0)) return { ok: false, msg: 'Adet pozitif olmalı.' };
    const day = date || today();
    if (day > today()) return { ok: false, msg: 'İleri tarihli işlem girilemez.' };
    if (type === 'sell') {
      const held = Portfolio.heldOn(store.txs, code, day);
      if (qty > held + 1e-9) return { ok: false, msg: held ? `${fullDate(day)} itibarıyla elinizde ${fq.format(held)} adet ${code} var.` : `Portföyünüzde ${code} yok.` };
    }
    let px = price, note = '';
    if (!(px > 0)) {
      const q = await priceOf(code);
      if (!q) return { ok: false, msg: `${code} için fiyat alınamadı; fiyatı da yazın.` };
      px = q.price;
      note = q.src === 'live' ? ' (gecikmeli güncel fiyat)' : ' (son kapanış)';
    }
    addTx({ type, code, qty, price: px, date: day, fee: fee > 0 ? fee : 0 });
    return { ok: true, msg: `${type === 'buy' ? 'Alış' : 'Satış'} kaydedildi: ${fq.format(qty)} ${code} × ${tl(px)}${note}.`, undo: true };
  }

  const parseNum = s => Portfolio.parseNumber(String(s || '').trim().replace(/^₺/, ''));

  async function submitTrade(e) {
    e.preventDefault();
    const msg = document.getElementById('pfTradeMsg');
    const val = id => (document.getElementById(id)?.value || '').trim();
    const type = document.querySelector('input[name="pfType"]:checked')?.value || 'buy';
    const code = val('pfCode').toUpperCase().replace(/İ/g, 'I');
    const qtyRaw = val('pfQty'), priceRaw = val('pfPrice'), feeRaw = val('pfFee');
    const qty = parseNum(qtyRaw);
    const price = priceRaw ? parseNum(priceRaw) : null;
    const fee = feeRaw ? parseNum(feeRaw) : 0;
    if (priceRaw && !(price > 0)) { if (msg) { msg.className = 'text-xs font-sans text-rose-400'; msg.textContent = 'Fiyat anlaşılmadı.'; } return; }
    if (feeRaw && !(fee >= 0)) { if (msg) { msg.className = 'text-xs font-sans text-rose-400'; msg.textContent = 'Komisyon anlaşılmadı.'; } return; }
    if (msg) { msg.className = 'text-xs font-sans text-slate-400'; msg.textContent = 'Kaydediliyor…'; }
    const r = await trade({ type, code, qty, price, date: val('pfDate') || today(), fee });
    if (msg) { msg.className = `text-xs font-sans ${r.ok ? 'text-emerald-400' : 'text-rose-400'}`; msg.textContent = r.msg; }
    if (r.ok) {
      ['pfQty', 'pfPrice', 'pfFee'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      update();
      paintHeader();
    }
  }

  function removeTx(id) {
    const t = store.txs.find(x => x.id === id);
    if (!t) return;
    if (!confirm(`${t.code} ${t.type === 'buy' ? 'alış' : 'satış'} kaydı (${fq.format(t.qty)} adet, ${fullDate(t.date)}) silinsin mi?`)) return;
    store.txs = store.txs.filter(x => x.id !== id);
    save();
    study.key = null;
    update();
  }

  /* ---------- commands ---------- */
  function logCmd(text, ok, msg) {
    store.cmds.unshift({ text, ok, msg, at: Date.now() });
    store.cmds = store.cmds.slice(0, MAX_CMDS);
    save();
  }

  function showResult(r) {
    const el = document.getElementById('pfCmdResult');
    if (!el) return;
    el.className = `mt-2 text-xs font-sans flex flex-wrap items-center gap-2 ${r.ok ? 'text-emerald-400' : 'text-rose-400'}`;
    el.innerHTML = `<i class="fa-solid ${r.ok ? 'fa-check' : 'fa-circle-exclamation'}"></i><span>${esc(r.msg)}</span>${r.undo ? '<button type="button" onclick="Profile.undo()" class="text-[11px] font-bold text-slate-300 hover:text-white underline">Geri al</button>' : ''}`;
  }

  function stockPage(code, tab) {
    if (typeof switchView === 'function') switchView('stock-detail', code);
    if (tab && typeof switchStockSubTab === 'function') setTimeout(() => switchStockSubTab(tab), 300);
  }

  /** Runs one command line; returns { ok, msg }. Used by the command bar and the Ctrl K palette. */
  async function run(text) {
    const line = String(text || '').trim();
    const c = Portfolio.parseCommand(line);
    let r;
    if (!c.ok) r = { ok: false, msg: c.error };
    else if (c.code && !known(c.code)) r = { ok: false, msg: `${c.code} BIST listesinde bulunamadı.` };
    else if (c.codes && c.codes.some(x => !known(x))) r = { ok: false, msg: `${c.codes.filter(x => !known(x)).join(', ')} bulunamadı.` };
    else {
      switch (c.action) {
        case 'buy':
        case 'sell':
          r = await trade({ type: c.action, code: c.code, qty: c.qty, price: c.price, date: c.date, fee: 0 });
          break;
        case 'watch': {
          const had = typeof getWatchlist === 'function' && getWatchlist().includes(c.code);
          if (typeof toggleStockWatchlist === 'function') toggleStockWatchlist(c.code);
          r = { ok: true, msg: had ? `${c.code} izleme listesinden çıkarıldı.` : `${c.code} izleme listesine eklendi.` };
          break;
        }
        case 'alarm': {
          const q = await priceOf(c.code);
          const type = q && q.price > c.target ? 'price_below' : 'price_above';
          if (typeof saveAlert === 'function') {
            saveAlert({
              id: `alt_${Date.now()}`, ticker: c.code, type, targetValue: c.target, note: 'Profil komutu',
              createdAt: `Bugün ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`,
              triggered: false, triggeredAt: null
            });
          }
          r = { ok: true, msg: `${c.code} alarmı kuruldu: fiyat ${tl(c.target)} ${type === 'price_below' ? 'altına inince' : 'üstüne çıkınca'} uyarılırsınız${q ? ` (şu an ${tl(q.price)})` : ''}.` };
          break;
        }
        case 'open':
          r = { ok: true, msg: `${c.code} açıldı.` };
          stockPage(c.code);
          break;
        case 'balance':
          r = { ok: true, msg: `${c.code} bilançosu açıldı.` };
          stockPage(c.code, 'financials');
          break;
        case 'compare':
          if (window.Compare) c.codes.forEach(x => Compare.add(x));
          if (typeof switchView === 'function') switchView('compare');
          r = { ok: true, msg: `${c.codes.join(', ')} karşılaştırmaya eklendi.` };
          break;
        case 'note':
          if (c.text) store.notes[c.code] = c.text.slice(0, 600); else delete store.notes[c.code];
          save();
          r = { ok: true, msg: c.text ? `${c.code} notu kaydedildi.` : `${c.code} notu silindi.` };
          break;
        case 'dividends':
          if (typeof switchView === 'function') switchView('dividends');
          r = { ok: true, msg: 'Temettü takvimi açıldı.' };
          break;
        case 'portfolio':
          ui.tab = 'portfolio';
          if (typeof switchView === 'function') switchView('profile');
          r = { ok: true, msg: 'Portföy sekmesi açıldı.' };
          break;
        default:
          ui.tab = 'commands';
          if (typeof switchView === 'function') switchView('profile');
          r = { ok: true, msg: 'Komut rehberi açıldı.' };
      }
    }
    logCmd(line, r.ok, r.msg);
    showResult(r);
    if (appState.activeView === 'profile') render();
    // From the Ctrl K palette on another page: say what happened, unless the page itself changed
    else if (!(r.ok && ['open', 'balance', 'compare', 'dividends'].includes(c.action)) && typeof showToast === 'function') showToast(r.msg);
    return r;
  }

  async function submitCommand(e) {
    e.preventDefault();
    const input = document.getElementById('pfCmdInput');
    if (!input || !input.value.trim()) return;
    const text = input.value;
    input.value = '';
    ui.cmdIndex = -1;
    await run(text);
    input.focus();
  }

  /** Up/down in the command bar walk the command history, like a terminal. */
  function cmdKey(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const list = store.cmds;
    if (!list.length) return;
    e.preventDefault();
    ui.cmdIndex = Math.max(-1, Math.min(list.length - 1, ui.cmdIndex + (e.key === 'ArrowUp' ? 1 : -1)));
    e.target.value = ui.cmdIndex < 0 ? '' : list[ui.cmdIndex].text;
  }

  function paintChips() {
    const el = document.getElementById('pfCmdChips');
    if (!el) return;
    const chips = store.saved.length ? store.saved : ['al THYAO 100', 'izle ASELS', 'alarm TUPRS 180', 'yardım'];
    el.innerHTML = chips.slice(0, 8).map(c => `<button type="button" data-cmd="${esc(c)}" onclick="Profile.fill(this.dataset.cmd)" class="px-2.5 py-1 rounded-lg bg-[#090D18] border border-[#162238] text-[11px] font-mono text-slate-400 hover:text-white">${esc(c)}</button>`).join('');
  }

  function fill(text) {
    const input = document.getElementById('pfCmdInput');
    if (!input) return;
    input.value = text;
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- data export / import ---------- */
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportJson() {
    download(`verity-profil-${today()}.json`, JSON.stringify(store, null, 1), 'application/json');
  }
  function exportCsv() {
    const rows = [['tarih', 'tur', 'kod', 'adet', 'fiyat', 'komisyon', 'tutar']]
      .concat([...store.txs].sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.date, t.type === 'buy' ? 'alis' : 'satis', t.code, t.qty, t.price, t.fee || 0, (t.qty * t.price).toFixed(2)]));
    download(`verity-islemler-${today()}.csv`, `﻿${rows.map(r => r.join(';')).join('\r\n')}`, 'text/csv;charset=utf-8');
  }
  /** Accepts a file written by exportJson; anything else is refused without touching the profile. */
  function importJson(input) {
    const file = input.files && input.files[0];
    const msg = document.getElementById('pfDataMsg');
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const j = JSON.parse(reader.result);
        const tx = t => t && (t.type === 'buy' || t.type === 'sell') && /^[A-Z0-9]{3,6}$/.test(t.code) && t.qty > 0 && t.price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date);
        if (!j || j.v !== 1 || !Array.isArray(j.txs) || !j.txs.every(tx)) throw new Error('shape');
        if (!confirm(`${j.txs.length} işlem içeren yedek yüklensin mi? Bu tarayıcıdaki mevcut profil yerine geçer.`)) return;
        store = { ...blank(), ...j, name: String(j.name || '').slice(0, 40), horizon: HORIZONS[j.horizon] ? j.horizon : 'long', risk: RISKS[j.risk] ? j.risk : 'mid' };
        save();
        study.key = null;
        if (msg) msg.textContent = 'Yedek yüklendi.';
        render();
      } catch (e) {
        if (msg) msg.textContent = 'Dosya bir Verity profil yedeği değil.';
      } finally {
        input.value = '';
      }
    };
    reader.readAsText(file);
  }
  function reset() {
    if (!confirm('Profil, işlemler, notlar ve geçmiş bu tarayıcıdan silinsin mi? Önce dışa aktarmanız önerilir.')) return;
    store = blank();
    save();
    study.key = null;
    render();
  }

  /* ---------- public actions ---------- */
  function setTab(tab) {
    ui.tab = TABS.some(t => t[0] === tab) ? tab : 'portfolio';
    if (appState.activeView !== 'profile' && typeof switchView === 'function') switchView('profile');
    else render();
  }

  return {
    render, setTab, run, submitCommand, cmdKey, fill, submitTrade, removeTx, exportJson, exportCsv, importJson, reset,
    setWindow(y) { ui.window = y; builtTab = null; render(); },
    setCcy(c) { ui.ccy = c; builtTab = null; render(); },
    open(code) { stockPage(code); },
    quickAdd(code) { ui.tab = 'portfolio'; ui.prefill = { code, type: 'buy' }; builtTab = null; if (appState.activeView === 'profile') render(); else switchView('profile'); },
    prefillSell(code) { ui.prefill = { code, type: 'sell' }; render(); },
    setNote(code, text) { const t = String(text || '').trim().slice(0, 600); if (t) store.notes[code] = t; else delete store.notes[code]; save(); },
    undo() {
      if (!ui.lastTx) return;
      store.txs = store.txs.filter(t => t.id !== ui.lastTx);
      ui.lastTx = null;
      save();
      study.key = null;
      showResult({ ok: true, msg: 'Son işlem geri alındı.' });
      if (appState.activeView === 'profile') render();
    },
    cmdText(i) { return store.cmds[i] ? store.cmds[i].text : ''; },
    saveCmd(i) {
      const t = store.cmds[i] && store.cmds[i].text;
      if (!t) return;
      store.saved = store.saved.includes(t) ? store.saved.filter(x => x !== t) : [t, ...store.saved].slice(0, 12);
      save();
      render();
    },
    unsave(i) { store.saved.splice(i, 1); save(); render(); },
    runSaved(i) { if (store.saved[i]) run(store.saved[i]); },
    clearCmds() { store.cmds = []; save(); render(); },
    clearViews() { store.views = []; save(); render(); },
    saveSettings(e) {
      e.preventDefault();
      store.name = (document.getElementById('pfName')?.value || '').trim().slice(0, 40);
      store.horizon = document.querySelector('input[name="pfHorizon"]:checked')?.value || store.horizon;
      store.risk = document.querySelector('input[name="pfRisk"]:checked')?.value || store.risk;
      save();
      if (typeof showToast === 'function') showToast('Profil kaydedildi');
      render();
    },
    /** Called when a stock page opens: newest first, one row per stock with a view count. */
    recordView(code) {
      if (!code) return;
      const prev = store.views.find(v => v.code === code);
      store.views = [{ code, at: Date.now(), n: (prev ? prev.n : 0) + 1 }, ...store.views.filter(v => v.code !== code)].slice(0, MAX_VIEWS);
      save();
    },
    /** Holdings and weights for the chat assistant's page context (codes and % only). */
    chatContext() {
      const rows = Portfolio.positions(store.txs).filter(p => p.qty > 0);
      if (!rows.length) return null;
      const cost = rows.reduce((s, p) => s + p.cost, 0);
      return rows.sort((a, b) => b.cost - a.cost).slice(0, 15).map(p => ({ c: p.code, w: cost > 0 ? Math.round(p.cost / cost * 1000) / 10 : null }));
    },
    paintMenu
  };
})();

window.Profile = Profile;
document.addEventListener('DOMContentLoaded', () => Profile.paintMenu());
