/**
 * Gecikmeli piyasa fiyatları (Yahoo Finance, /api/quote üzerinden).
 *
 * Sadece fiyat verisi gelir: son fiyat, günlük değişim, gün ve 52 hafta aralığı, hacim.
 * F/K, PD/DD, ROE, skor, hedef fiyat gibi bilanço türevleri hâlâ örnek veridir ve
 * arayüzde "ÖRNEK" etiketiyle gösterilir.
 */
const LiveData = (() => {
  const TTL_MS = 60 * 1000;
  const TICKER_KEYS = ['BIST100', 'USDTRY', 'EURTRY', 'ALTIN', 'BRENT'];
  const fmt = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fetchedAt = new Map();   // ticker -> ms when its quote was last applied
  const misses = new Map();      // ticker -> failed lookups (stops retrying unknown tickers)
  const MAX_MISSES = 2;
  let tableSyncing = false;
  let retryScheduled = false;

  async function getQuotes(keys) {
    const res = await fetch(`/api/quote?symbols=${encodeURIComponent(keys.join(','))}`);
    if (!res.ok) throw new Error(`quote ${res.status}`);
    return (await res.json()).quotes || {};
  }

  function clock(ms) {
    return new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
  }

  function isBistOpen() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Istanbul', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false
    }).formatToParts(new Date());
    const get = t => parts.find(p => p.type === t)?.value;
    const mins = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
    return !['Sat', 'Sun'].includes(get('weekday')) && mins >= 10 * 60 && mins < 18 * 60;
  }

  /** Writes a quote into the cached financials object that every view reads from. */
  function applyQuote(code, q) {
    const fin = typeof getCachedStockFinancials === 'function' ? getCachedStockFinancials(code) : null;
    if (!fin || !q) return false;

    fin.priceNum = q.price;
    fin.price = fmt.format(q.price);
    if (q.prevClose) {
      const diff = q.price - q.prevClose;
      const up = diff >= 0;
      fin.isPositive = up;
      fin.change = `${up ? '+' : '-'}%${fmt.format(Math.abs(diff / q.prevClose * 100))}`;
      fin.changeAmount = `${up ? '+' : '-'}₺${fmt.format(Math.abs(diff))}`;
    }
    if (q.dayLow != null) fin.dayLow = `₺${fmt.format(q.dayLow)}`;
    if (q.dayHigh != null) fin.dayHigh = `₺${fmt.format(q.dayHigh)}`;
    if (q.yearLow != null) fin.yearLow = `₺${fmt.format(q.yearLow)}`;
    if (q.yearHigh != null) fin.yearHigh = `₺${fmt.format(q.yearHigh)}`;
    if (q.volume) {
      fin.volumeNum = q.volume;
      fin.volume = `${fmt.format(q.volume / 1e6)} Mn lot`;
    }
    fin.liveTime = q.time;
    fetchedAt.set(code, Date.now());
    return true;
  }

  /* ---------- Top ticker bar and BIST 100 card ---------- */
  function paintTicker(quotes) {
    const items = document.querySelectorAll('.top-ticker-bar .ticker-price-jiggle');
    TICKER_KEYS.forEach((key, i) => {
      const q = quotes[key];
      const el = items[i];
      if (!q || !el) return;
      const [, priceEl, changeEl] = el.children;
      const dollar = key === 'ALTIN' || key === 'BRENT' ? '$' : '';
      priceEl.textContent = `${dollar}${fmt.format(q.price)}`;
      if (q.prevClose) {
        const pct = (q.price - q.prevClose) / q.prevClose * 100;
        changeEl.textContent = `${pct >= 0 ? '▲' : '▼'} %${fmt.format(Math.abs(pct))}`;
        changeEl.className = `${pct >= 0 ? 'text-emerald-400' : 'text-rose-400'} font-mono`;
      }
    });

    const bist = quotes.BIST100;
    if (bist) {
      const set = (id, text) => { const n = document.getElementById(id); if (n) n.textContent = text; };
      set('bistCardPrice', fmt.format(bist.price));
      if (bist.prevClose) {
        const diff = bist.price - bist.prevClose;
        const pct = diff / bist.prevClose * 100;
        const chg = document.getElementById('bistCardChange');
        if (chg) {
          chg.textContent = `${pct >= 0 ? '▲ +' : '▼ -'}%${fmt.format(Math.abs(pct))}`;
          chg.className = pct >= 0
            ? 'font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded text-[11px] font-bold'
            : 'font-mono text-rose-400 bg-rose-950/60 border border-rose-800/40 px-2 py-0.5 rounded text-[11px] font-bold';
        }
        set('bistCardPoints', `${diff >= 0 ? '+' : '-'}${fmt.format(Math.abs(diff))} Puan`);
      }
      set('bistCardExtraLabel', 'Gün Aralığı:');
      if (bist.dayLow != null && bist.dayHigh != null) {
        set('bistCardExtraValue', `${fmt.format(bist.dayLow)} - ${fmt.format(bist.dayHigh)}`);
      }
    }
  }

  function paintTickerStatus(live, time) {
    const bar = document.querySelector('.top-ticker-bar');
    if (!bar) return;
    const [label, , status] = bar.querySelectorAll('.flex-shrink-0 > span:not(.animate-pulse)');
    if (label) label.textContent = live ? 'GECİKMELİ PİYASA' : 'ÖRNEK VERİ';
    if (status) status.textContent = live
      ? `${isBistOpen() ? 'BIST Seansı Açık' : 'BIST Seansı Kapalı'} · Yahoo Finance · ${clock(time)}`
      : 'Canlı veri alınamadı';
  }

  async function refreshTicker() {
    try {
      const quotes = await getQuotes(TICKER_KEYS);
      paintTicker(quotes);
      const times = Object.values(quotes).map(q => q.time).filter(Boolean);
      paintTickerStatus(true, Math.max(...times, Date.now() - 1));
    } catch {
      paintTickerStatus(false);
    }
  }

  /* ---------- Overview table ---------- */
  async function syncTable(codes) {
    if (tableSyncing) return;
    const stale = codes.filter(c => (misses.get(c) || 0) < MAX_MISSES
      && (!fetchedAt.has(c) || Date.now() - fetchedAt.get(c) > TTL_MS));
    if (!stale.length) return;
    tableSyncing = true;
    try {
      const quotes = await getQuotes(stale);
      let changed = false;
      stale.forEach(c => { if (applyQuote(c, quotes[c])) changed = true; });
      if (await applyStaticFundamentals(codes)) changed = true;
      stale.forEach(c => { if (!quotes[c]) misses.set(c, (misses.get(c) || 0) + 1); });
      // Tickers the first attempt missed get one more try shortly after
      if (stale.some(c => !quotes[c] && misses.get(c) < MAX_MISSES) && !retryScheduled) {
        retryScheduled = true;
        setTimeout(() => { retryScheduled = false; syncTable(codes); }, 6000);
      }
      if (changed && appState.activeView === 'overview' && typeof renderOverviewStockTable === 'function') {
        renderOverviewStockTable();
      }
    } catch (e) {
      console.warn('[LiveData] table quotes unavailable:', e.message);
    } finally {
      tableSyncing = false;
    }
  }

  /* ---------- Stock detail header ---------- */
  function position(v, lo, hi) {
    return hi > lo ? Math.min(100, Math.max(0, (v - lo) / (hi - lo) * 100)) : 50;
  }

  async function syncStockHeader(fin) {
    const code = fin.code;
    const note = document.getElementById('stockDetailDataNote');
    try {
      const q = (await getQuotes([code]))[code];
      if (!q || !applyQuote(code, q) || appState.currentStock !== code) throw new Error('no quote');

      const set = (id, text) => { const n = document.getElementById(id); if (n) n.textContent = text; };
      set('stockDetailPrice', `₺${fin.price}`);
      const chg = document.getElementById('stockDetailChange');
      if (chg) {
        chg.textContent = `${fin.change} (${fin.changeAmount})`;
        chg.className = `${fin.isPositive ? 'text-emerald-400' : 'text-rose-400'} font-bold text-xs sm:text-sm font-mono`;
      }
      set('stockDetailVolume', `Hacim: ${fin.volume}`);
      set('stockDayLow', fin.dayLow);
      set('stockDayHigh', fin.dayHigh);
      set('stockYearLow', fin.yearLow);
      set('stockYearHigh', fin.yearHigh);
      const dayInd = document.getElementById('stockDayRangeInd');
      const yearInd = document.getElementById('stockYearRangeInd');
      if (dayInd && q.dayLow != null) dayInd.style.left = `${position(q.price, q.dayLow, q.dayHigh)}%`;
      if (yearInd && q.yearLow != null) yearInd.style.left = `${position(q.price, q.yearLow, q.yearHigh)}%`;

      const priceBadge = `<i class="data-badge live">GECİKMELİ FİYAT</i> Yahoo Finance · ${clock(q.time)} `;
      if (note) {
        note.innerHTML = priceBadge +
          '<i class="data-badge sample">ÖRNEK</i> F/K, PD/DD, ROE, skor ve hedef fiyat örnek veridir; resmi KAP bilançosu değildir.';
      }
      syncFundamentals(fin, note, priceBadge);
    } catch {
      if (note) {
        note.innerHTML = '<i class="data-badge sample">ÖRNEK VERİ</i> Canlı fiyat alınamadı; gösterilen fiyat ve rasyolar örnek veridir.';
      }
    }
  }

  /* ---------- Real balance-sheet ratios (stock detail only) ---------- */
  const mlr = v => `₺${fmt.format(v / 1e9)} Mlr`;
  const ratio = (v, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : 'N/A');

  /** Combines a statement summary with the stock's current price into the ratio fields. */
  function applyFundamentals(fin, f) {
    const mcap = fin.priceNum * f.shares;          // BIST par value is 1 TL, so capital = share count
    const t = f.ttm;
    const fk = t.netIncome > 0 ? mcap / t.netIncome : NaN;
    const pddd = f.equity > 0 ? mcap / f.equity : NaN;
    const fdFavok = t.ebitda > 0 ? (mcap + f.netDebt) / t.ebitda : NaN;
    const netDebtFavok = t.ebitda > 0 ? f.netDebt / t.ebitda : NaN;
    const roe = f.equity > 0 ? t.netIncome / f.equity * 100 : NaN;
    const roa = f.totalAssets > 0 ? t.netIncome / f.totalAssets * 100 : NaN;

    Object.assign(fin, {
      fk: ratio(fk), pddd: ratio(pddd), fdFavok: ratio(fdFavok),
      netDebt: Number.isFinite(netDebtFavok) ? `${ratio(netDebtFavok)}x` : 'N/A',
      roe: Number.isFinite(roe) ? `%${ratio(roe, 1)}` : 'N/A',
      roa: Number.isFinite(roa) ? `%${ratio(roa, 1)}` : 'N/A',
      fkNum: fk, pdddNum: pddd, fdFavokNum: fdFavok, netDebtNum: netDebtFavok, roeNum: roe, roaNum: roa,
      annualRevenue: mlr(t.revenue), annualFavok: mlr(t.ebitda), netIncome: mlr(t.netIncome),
      fundamentalsLive: true
    });
  }

  /** Pre-fetched statements for every covered company (assets/data/fundamentals.json). */
  let staticFund = null;
  function loadStaticFundamentals() {
    if (!staticFund) {
      staticFund = fetch('/assets/data/fundamentals.json')
        .then(r => (r.ok ? r.json() : null))
        .then(j => (j ? j.data : {}))
        .catch(() => ({}));
    }
    return staticFund;
  }

  async function applyStaticFundamentals(codes) {
    const data = await loadStaticFundamentals();
    let changed = false;
    codes.forEach(code => {
      const row = data[code];
      const fin = getCachedStockFinancials(code);
      // Ratios need the real price; a sample price would give meaningless multiples
      if (!row || !fin || !fin.liveTime || fin.fundamentalsLive) return;
      const [period, shares, equity, totalAssets, netDebt, revenue, ebitda, netIncome] = row;
      applyFundamentals(fin, { period, shares, equity, totalAssets, netDebt, ttm: { revenue, ebitda, netIncome } });
      changed = true;
    });
    return changed;
  }
  async function syncFundamentals(fin, note, priceBadge) {
    const code = fin.code;
    try {
      const res = await fetch(`/api/financials?symbol=${encodeURIComponent(code)}`);
      const f = res.ok ? await res.json() : null;
      if (appState.currentStock !== code) return;
      if (!f || !f.available) {
        if (note) {
          const why = f && f.reason === 'financial-company'
            ? 'Banka ve finans şirketlerinin bilanço verisi henüz bağlanmadı'
            : 'Bu şirket için bilanço verisi bulunamadı';
          note.innerHTML = priceBadge + `<i class="data-badge sample">ÖRNEK</i> ${why}; rasyolar, skor ve hedef fiyat örnek veridir.`;
        }
        return;
      }

      applyFundamentals(fin, f);

      const set = (id, text) => { const n = document.getElementById(id); if (n) n.textContent = text; };
      set('stockDetailFK', fin.fk);
      set('stockDetailPDDD', fin.pddd);
      set('stockDetailFDFavok', fin.fdFavok);
      set('stockDetailNetDebt', fin.netDebt);
      set('stockDetailROE', fin.roe);
      set('stockDetailROA', fin.roa);

      if (note) {
        note.innerHTML = priceBadge +
          `<i class="data-badge live">GERÇEK BİLANÇO</i> ${f.source} · ${f.period} · ${f.basis}; son 12 ay toplamı. ` +
          '<i class="data-badge sample">ÖRNEK</i> Skor, hedef fiyat, analist sayıları ve "sektör ort." değerleri örnektir.';
      }
    } catch (e) {
      console.warn('[LiveData] fundamentals unavailable:', e.message);
    }
  }

  /* ---------- Price / RSI alerts and watchlist prices ---------- */
  let alertsRunning = false;

  /** Checks every untriggered alert against real prices (and real RSI for RSI alerts). */
  async function checkAlerts() {
    if (alertsRunning || typeof getAlerts !== 'function' || typeof checkActivePriceAlerts !== 'function') return;
    const pending = getAlerts().filter(a => !a.triggered);
    if (!pending.length) return;

    alertsRunning = true;
    try {
      const tickers = [...new Set(pending.map(a => a.ticker))];
      const quotes = await getQuotes(tickers);
      for (const t of tickers) {
        const q = quotes[t];
        if (!q) continue;
        let rsiNow = null;
        if (pending.some(a => a.ticker === t && a.type.startsWith('rsi'))) {
          try { rsiNow = await TechData.rsiLast(t); } catch { /* RSI alerts wait for data */ }
        }
        checkActivePriceAlerts(t, q.price, rsiNow);
      }
    } catch (e) {
      console.warn('[LiveData] alert check failed:', e.message);
    } finally {
      alertsRunning = false;
    }
  }

  /** Replaces sample prices in the watchlist drawer with real ones. */
  async function syncWatchlist(codes) {
    const stale = codes.filter(c => !fetchedAt.has(c) || Date.now() - fetchedAt.get(c) > TTL_MS);
    if (!stale.length) return;
    try {
      const quotes = await getQuotes(stale);
      let changed = false;
      stale.forEach(c => { if (applyQuote(c, quotes[c])) changed = true; });
      if (changed && typeof renderWatchlistItems === 'function') renderWatchlistItems();
    } catch (e) {
      console.warn('[LiveData] watchlist quotes unavailable:', e.message);
    }
  }
  function init() {
    refreshTicker();
    setTimeout(checkAlerts, 4000);
    setInterval(() => {
      if (document.hidden) return;
      refreshTicker();
      checkAlerts();
      misses.clear();
      // Re-rendering the overview table re-requests prices that have gone stale
      if (appState.activeView === 'overview' && typeof renderOverviewStockTable === 'function') renderOverviewStockTable();
    }, TTL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTicker(); });
  }

  return { init, syncTable, syncStockHeader, checkAlerts, syncWatchlist };
})();

window.LiveData = LiveData;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', LiveData.init);
else LiveData.init();
