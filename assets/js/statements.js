/**
 * Real financial statements on the stock page (balance sheet, income statement, quarterly
 * charts). Data comes from Is Yatirim's compilation of the companies' KAP reports: consolidated,
 * TMS 29 inflation adjusted. Static per-company files are used when present
 * (assets/data/statements/<SYMBOL>.json), otherwise /api/statements fetches them live.
 *
 * Companies without statements (banks and other financials, or no data) get an explicit
 * message instead of generated numbers.
 */
const Statements = (() => {
  const nf1 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
  const pct1 = v => `${nf1.format(v)}`;

  const cache = new Map();           // "CODE|EX" -> Promise<data>
  const state = { code: null, ex: 'TRY', status: 'idle', data: null, usd: null };

  /* ---------- loading ---------- */
  async function fetchStatic(code) {
    const r = await fetch(`/assets/data/statements/${code}.json`);
    if (!r.ok) return null;
    const j = await r.json();
    return {
      available: true, source: j.source, basis: j.basis, periods: j.periods,
      rows: j.rows.map(([c, n, l, ...v]) => ({ c, n, l, v: v.map(x => x * (j.unit || 1)) }))
    };
  }

  async function fetchLive(code, ex) {
    const r = await fetch(`/api/statements?symbol=${encodeURIComponent(code)}&exchange=${ex}`);
    return r.ok ? r.json() : { available: false, reason: 'error' };
  }

  function getData(code, ex) {
    const key = `${code}|${ex}`;
    if (!cache.has(key)) {
      const p = (async () => {
        try {
          if (ex === 'TRY') {
            const s = await fetchStatic(code).catch(() => null);
            if (s) return s;
          }
          return await fetchLive(code, ex);
        } catch {
          return { available: false, reason: 'error' };
        }
      })();
      cache.set(key, p);
      p.then(d => { if (!d.available && d.reason === 'error') cache.delete(key); });
    }
    return cache.get(key);
  }

  /* ---------- helpers over a data set ---------- */
  const rowMap = d => d._map || (d._map = new Map(d.rows.map(r => [r.c, r])));
  const val = (d, code, i = 0) => rowMap(d).get(code)?.v[i] ?? 0;
  const lastP = d => parseInt(d.periods[0].split('/')[1], 10);
  const prevFyIdx = d => Math.max(1, d.periods.findIndex((p, i) => i > 0 && p.endsWith('/12')));
  const LY = 4;                                    // same period one year earlier
  const ttm = (d, code) => (lastP(d) === 12 ? val(d, code, 0) : val(d, code, 0) + val(d, code, prevFyIdx(d)) - val(d, code, LY));
  const flow = (d, code, i) => (parseInt(d.periods[i].split('/')[1], 10) === 3 ? val(d, code, i) : val(d, code, i) - val(d, code, i + 1));

  function money(v, ex) {
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (ex === 'USD') {
      if (abs >= 1e9) return `${sign}$${nf1.format(abs / 1e9)} Mlr`;
      if (abs >= 1e6) return `${sign}$${nf0.format(abs / 1e6)} Mn`;
      return `${sign}$${nf0.format(abs)}`;
    }
    return v < 0 ? `-${formatKapMoney(abs)}` : formatKapMoney(abs);
  }

  const yoy = (now, before) => {
    if (!before) return null;
    const p = (now - before) / Math.abs(before) * 100;
    return `${p >= 0 ? '+' : '-'}%${nf1.format(Math.abs(p))}`;
  };

  function category(code) {
    if (code.startsWith('1')) return 'varlik';
    if (/^2[AB]/.test(code)) return 'yukumluluk';
    if (code.startsWith('2')) return 'ozkaynak';
    if (code.startsWith('3')) return 'gelir';
    return 'nakit';
  }

  const set = (id, text) => { const n = document.getElementById(id); if (n) n.textContent = text; };
  const cls = (id, c) => { const n = document.getElementById(id); if (n) n.className = c; };

  /* ---------- status messages ---------- */
  function messageFor(reason) {
    if (reason === 'financial-company') return 'Banka ve finans şirketlerinin bilanço tablosu farklı yapıda; bu şirket için henüz bağlanmadı.';
    if (reason === 'no-data') return 'Bu şirket için bilanço verisi bulunamadı.';
    return 'Bilanço verisi şu an alınamadı. Birazdan tekrar deneyin.';
  }

  function showCanvas(id) {
    const c = document.getElementById(id);
    if (!c) return;
    c.style.display = '';
    c.parentElement.querySelector('.stmt-msg')?.remove();
  }

  /** Replaces a chart with a text message while data is loading or unavailable. */
  function placeholder(id) {
    const c = document.getElementById(id);
    if (!c) return;
    Chart.getChart(c)?.destroy();
    c.style.display = 'none';
    let m = c.parentElement.querySelector('.stmt-msg');
    if (!m) {
      m = document.createElement('div');
      m.className = 'stmt-msg';
      c.parentElement.appendChild(m);
    }
    m.textContent = state.status === 'loading' || state.status === 'idle'
      ? 'Gerçek bilanço verisi yükleniyor...'
      : messageFor(state.reason);
  }

  const chartReady = fin => !!(fin && fin.quarterlyLive);

  function renderUnavailable() {
    const msg = state.status === 'loading' ? 'Gerçek bilanço verisi yükleniyor...' : messageFor(state.reason);
    const tbody = document.getElementById('stockBalanceSheetTbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-8 px-4 text-center text-xs font-mono ${state.status === 'loading' ? 'text-slate-500' : 'text-amber-400'}">${msg}</td></tr>`;
    ['bsCardTotalAssets', 'bsCardTotalEquity', 'bsCardNetDebt', 'bsCardNetIncome', 'bsCardMonetaryGain',
      'inc5Revenue', 'inc5Cost', 'inc5Gross', 'inc5Favok', 'inc5NetProfit'].forEach(id => set(id, '—'));
    ['bsCardAssetsYoY', 'bsCardEquityRoe', 'bsCardNetDebtRatio', 'bsCardNetMargin', 'bsCardMonetaryRatio',
      'inc5RevYoY', 'inc5CostRatio', 'inc5GrossMargin', 'inc5FavokMargin', 'inc5NetMargin'].forEach(id => set(id, '—'));
    set('inc5AuditNote', msg);
    set('bsPeriodBadge', 'VERİ YOK');
    set('income5PeriodBadge', 'VERİ YOK');
    placeholder('stockIncomeChart');
    placeholder('stockProjectionChart');
  }

  /* ---------- rendering ---------- */
  function active() {
    return state.ex === 'USD' ? state.usd : state.data;
  }

  function renderPeriodButtons(d) {
    const opts = [...new Set([0, prevFyIdx(d), LY])].map(i => d.periods[i]);
    const ids = ['btnPeriod2024Q3', 'btnPeriod2023Q4', 'btnPeriod2023Q3'];
    ids.forEach((id, k) => {
      const b = document.getElementById(id);
      if (!b) return;
      if (!opts[k]) { b.style.display = 'none'; return; }
      b.style.display = '';
      b.textContent = opts[k];
      b.onclick = () => setPeriod(opts[k]);
      b.className = `balance-period-btn px-2.5 py-1 rounded-lg text-xs ${opts[k] === currentBalancePeriod ? 'font-bold bg-[#2F6BFF] text-white shadow-sm' : 'font-medium text-slate-400 hover:text-white'}`;
    });
  }

  function renderIncome(fin) {
    const d = active();
    if (!d || !d.available) { renderUnavailable(); return; }
    const ex = state.ex;
    let idx = d.periods.indexOf(currentBalancePeriod);
    if (idx < 0) { idx = 0; currentBalancePeriod = d.periods[0]; }

    const rev = val(d, '3C', idx);
    const cost = val(d, '3CA', idx);
    const gross = val(d, '3D', idx);
    const ebitda = val(d, '3DF', idx) + val(d, '4B', idx);
    const net = val(d, '3Z', idx);
    const pctOf = v => (rev ? `%${pct1(v / rev * 100)}` : '—');

    set('inc5Revenue', money(rev, ex));
    const y = idx === 0 ? yoy(rev, val(d, '3C', LY)) : null;
    set('inc5RevYoY', y || '—');
    cls('inc5RevYoY', `font-mono font-bold ${y && y.startsWith('-') ? 'text-rose-400' : 'text-emerald-400'}`);
    set('inc5Cost', money(cost, ex));
    set('inc5CostRatio', rev ? `%${pct1(Math.abs(cost) / rev * 100)}` : '—');
    set('inc5Gross', money(gross, ex));
    set('inc5GrossMargin', pctOf(gross));
    set('inc5Favok', money(ebitda, ex));
    set('inc5FavokMargin', pctOf(ebitda));
    set('inc5NetProfit', money(net, ex));
    set('inc5NetMargin', pctOf(net));

    const ytd = d.periods[idx].endsWith('/12') ? 'yıllık' : 'yılbaşından itibaren';
    set('income5PeriodBadge', `${d.periods[idx]} (${ytd}, ${ex === 'USD' ? 'USD' : 'TL'})`);
    set('inc5AuditNote',
      `${fin.name}: ${d.periods[idx]} döneminde (${ytd}) ${money(rev, ex)} hasılat, ${money(gross, ex)} brüt kâr ve ${money(net, ex)} net kâr; brüt marj ${pctOf(gross)}, FAVÖK marjı ${pctOf(ebitda)}. FAVÖK = faaliyet kârı + amortisman.`);
    renderPeriodButtons(d);
  }

  function renderBalance(fin) {
    const d = active();
    if (!d || !d.available) { renderUnavailable(); return; }
    const ex = state.ex;
    const fy = prevFyIdx(d);

    // KPI cards
    const assets = val(d, '1BL', 0);
    set('bsCardTotalAssets', money(assets, ex));
    const ay = yoy(assets, val(d, '1BL', LY));
    set('bsCardAssetsYoY', ay || '—');
    cls('bsCardAssetsYoY', `font-mono font-bold ${ay && ay.startsWith('-') ? 'text-rose-400' : 'text-emerald-400'}`);

    const equity = val(d, '2N', 0);
    set('bsCardTotalEquity', money(equity, ex));
    const equityParent = val(d, '2O', 0);
    const niTtm = ttm(d, '3Z');
    set('bsCardEquityRoe', equityParent > 0 ? `%${pct1(niTtm / equityParent * 100)}` : '—');

    const finDebt = val(d, '2AA', 0) + val(d, '2BA', 0);
    const cash = val(d, '1AA', 0) + val(d, '1AB', 0);
    const netDebt = finDebt - cash;
    const ebitdaTtm = ttm(d, '3DF') + ttm(d, '4B');
    set('bsCardNetDebt', money(netDebt, ex));
    set('bsCardNetDebtRatio', ebitdaTtm > 0 ? `${(netDebt / ebitdaTtm).toFixed(2).replace('.', ',')}x` : 'N/A');

    const ni = val(d, '3Z', 0);
    const rev = val(d, '3C', 0);
    set('bsCardNetIncome', money(ni, ex));
    set('bsCardNetMargin', rev ? `%${pct1(ni / rev * 100)}` : '—');

    // Fifth card: current ratio (replaces the former TMS 29 monetary position card, which the source does not provide)
    const cur = val(d, '1A', 0), curLiab = val(d, '2A', 0);
    set('bsCardMonetaryTitle', 'CARİ ORAN (LİKİDİTE)');
    set('bsCardMonetaryBadge', 'HESAPLANDI');
    set('bsCardMonetaryGain', curLiab ? `${(cur / curLiab).toFixed(2).replace('.', ',')}x` : '—');
    cls('bsCardMonetaryGain', 'text-2xl font-mono font-bold text-amber-300 tracking-tight');
    set('bsCardMonetaryLabel', 'Nakit / Kısa Vadeli Yük.');
    set('bsCardMonetaryRatio', curLiab ? `%${pct1(cash / curLiab * 100)}` : '—');
    cls('bsCardMonetaryRatio', 'font-mono font-bold text-amber-400');
    set('bsCardMonetaryNote', 'Dönen varlıklar / kısa vadeli yükümlülükler');

    // Headers
    const unit = ex === 'USD' ? '$' : '₺';
    set('bsPeriodBadge', `${d.periods[0]} (Son Dönem)`);
    set('bsThCol1', `${d.periods[0]} (${unit})`);
    set('bsThCol2', `${d.periods[fy]} (YIL SONU)`);
    set('bsThCol3', `${d.periods[LY]} (ÖNCEKİ YIL)`);
    set('bsThCol4', 'YILLIK DEĞİŞİM (YoY)');
    set('bsThCol5', 'PAY (%)');
    set('bsCurrencyFooterNote', ex === 'USD'
      ? `Para Birimi: ABD Doları ($) • İş Yatırım'ın dönem sonu kurlarıyla çevirisi • ${d.basis}`
      : `Para Birimi: Türk Lirası (₺) • ${d.basis} (cari dönem satın alma gücü)`);
    set('bsSourceNote', `Kaynak: ${d.source}. Gelir ve nakit akışı kalemleri yılbaşından itibaren birikimli raporlanır.`);

    // Table
    const tbody = document.getElementById('stockBalanceSheetTbody');
    if (!tbody) return;
    const groups = {
      varlik: 'VARLIKLAR', yukumluluk: 'YÜKÜMLÜLÜKLER', ozkaynak: 'ÖZKAYNAKLAR',
      gelir: 'GELİR TABLOSU (YILBAŞINDAN İTİBAREN)', nakit: 'NAKİT AKIŞI VE DİĞER KALEMLER'
    };
    let lastCat = null;
    const html = [];
    d.rows.forEach(r => {
      const cat = category(r.c);
      if (currentBalanceCategory !== 'all' && cat !== currentBalanceCategory) return;
      if (cat !== lastCat) {
        lastCat = cat;
        html.push(`
          <tr class="bg-[#090D18]/90 border-t-2 border-b border-[#1E2B45]">
            <td colspan="6" class="py-2.5 px-4 font-mono font-bold text-xs uppercase tracking-wider text-red-400">
              <i class="fa-solid fa-folder-open text-[10px] mr-2"></i><span>${groups[cat]}</span>
            </td>
          </tr>`);
      }
      const v0 = r.v[0], vFy = r.v[fy], vLy = r.v[LY];
      const change = yoy(v0, vLy);
      const share = cat === 'gelir' ? (val(d, '3C', 0) ? v0 / val(d, '3C', 0) * 100 : null)
        : cat === 'nakit' ? null : (assets ? v0 / assets * 100 : null);
      const up = !change || !change.startsWith('-');
      const top = r.l === 0;
      html.push(`
        <tr class="${top ? 'bg-[#121C30]/80 font-bold border-t border-b border-[#1E2B45] text-white' : 'hover:bg-[#121C30]/40 transition-colors border-b border-[#162238]/60 text-slate-300'}">
          <td class="py-2.5 px-4 ${top ? 'font-bold text-slate-100' : 'text-xs font-normal text-slate-300'}" style="padding-left:${top ? 1 : 1.75 + r.l * 0.9}rem">${r.n}</td>
          <td class="py-2.5 px-4 text-right font-mono ${top ? 'text-red-400 font-bold' : 'text-white font-medium'}">${money(v0, ex)}</td>
          <td class="py-2.5 px-4 text-right font-mono text-slate-400">${money(vFy, ex)}</td>
          <td class="py-2.5 px-4 text-right font-mono text-slate-500">${money(vLy, ex)}</td>
          <td class="py-2.5 px-4 text-right font-mono text-xs font-medium ${up ? 'text-emerald-400' : 'text-rose-400'}">${change || '—'}</td>
          <td class="py-2.5 px-4 text-center font-mono text-[11px] text-slate-400">${share == null ? '—' : `%${pct1(share)}`}</td>
        </tr>`);
    });
    tbody.innerHTML = html.join('');
  }

  /* ---------- quarterly series, annual figures and charts ---------- */
  function applyDerived(fin, d) {
    // Five quarters of flows (oldest first); a quarter needs its in-year predecessor unless it is Q1
    const qs = [];
    for (let i = 4; i >= 0; i--) {
      const [y, p] = d.periods[i].split('/').map(Number);
      const rev = flow(d, '3C', i) / 1e9;
      const fav = (flow(d, '3DF', i) + flow(d, '4B', i)) / 1e9;
      qs.push({ label: `${String(y).slice(2)}/${p}`, rev, fav });
    }
    const r1 = x => Math.round(x * 10) / 10;
    fin.quarterly = {
      periods: qs.map(q => q.label),
      revenue: qs.map(q => r1(q.rev)),
      favok: qs.map(q => r1(q.fav)),
      margin: qs.map(q => (q.rev > 0 ? r1(q.fav / q.rev * 100) : 0))
    };

    // Simple trend projection: each of the next four quarters = the same quarter a year earlier x latest YoY growth
    const growth = qs[0].rev > 0 ? Math.min(1.8, Math.max(0.6, qs[4].rev / qs[0].rev)) : 1;
    // Next four quarters correspond to the year-earlier quarters qs[1..4]
    const prior = [qs[1], qs[2], qs[3], qs[4]];
    const projected = prior.map(q => r1(q.rev * growth));
    const lastLabel = d.periods[0].split('/').map(Number);
    const labels = [...fin.quarterly.periods];
    let [y, p] = lastLabel;
    for (let k = 0; k < 4; k++) {
      if (p === 12) { y += 1; p = 3; } else p += 3;
      labels.push(`${String(y).slice(2)}/${p}T`);
    }
    fin.projections = fin.projections || {};
    fin.projections.chart = {
      labels,
      historical: [...fin.quarterly.revenue, null, null, null, null],
      projected: [null, null, null, null, fin.quarterly.revenue[4], ...projected]
    };
    fin.projections.growth = growth;

    // Annual (last twelve months) figures
    const revTtm = ttm(d, '3C'), favTtm = ttm(d, '3DF') + ttm(d, '4B'), niTtm = ttm(d, '3Z');
    fin.annualRevenue = formatKapMoney(revTtm);
    fin.annualFavok = formatKapMoney(favTtm);
    fin.netIncome = formatKapMoney(niTtm);
    set('stockAnnualRevenue', fin.annualRevenue);
    set('stockAnnualFavok', fin.annualFavok);

    // Summary used by the capital / bonus-share module
    const equity = val(d, '2N', 0);
    const finDebt = val(d, '2AA', 0) + val(d, '2BA', 0), cash = val(d, '1AA', 0) + val(d, '1AB', 0);
    fin.balanceSheet = {
      summary: {
        totalAssets: formatKapMoney(val(d, '1BL', 0)),
        totalEquity: formatKapMoney(equity),
        netDebt: formatKapMoney(Math.max(0, finDebt - cash)),
        netIncome: formatKapMoney(niTtm),
        roe: val(d, '2O', 0) > 0 ? `%${pct1(niTtm / val(d, '2O', 0) * 100)}` : 'N/A',
        netDebtRatio: favTtm > 0 ? `${((finDebt - cash) / favTtm).toFixed(2)}x` : 'N/A',
        netMargin: revTtm ? `%${pct1(niTtm / revTtm * 100)}` : 'N/A'
      },
      items: []
    };
    fin.quarterlyLive = true;

    // Chart captions
    set('projGrowthBadge', `Son çeyrek YoY ${growth >= 1 ? '+' : '-'}%${pct1(Math.abs(growth - 1) * 100)}`);
  }

  /* ---------- public flow ---------- */
  async function ensure(fin) {
    const code = fin.code;
    if (state.code === code && state.status === 'ready') return;
    if (state.code === code && state.status === 'loading') return;

    state.code = code;
    state.status = 'loading';
    state.ex = 'TRY';
    state.data = state.usd = null;
    state.reason = null;
    fin.quarterlyLive = false;
    setCurrencyButtons();
    renderUnavailable();

    const d = await getData(code, 'TRY');
    if (state.code !== code) return;           // user moved on to another stock
    state.data = d;
    if (!d.available) {
      state.status = 'unavailable';
      state.reason = d.reason;
      renderUnavailable();
      return;
    }

    state.status = 'ready';
    currentBalancePeriod = d.periods[0];
    applyDerived(fin, d);
    showCanvas('stockIncomeChart');
    showCanvas('stockProjectionChart');
    renderIncome(fin);
    renderBalance(fin);
    if (typeof initStockIncomeChart === 'function') initStockIncomeChart();
    if (typeof initProjectionChart === 'function') initProjectionChart();
    if (typeof renderCapitalAndDividendIntelligence === 'function') renderCapitalAndDividendIntelligence(fin);
  }

  function setCurrencyButtons() {
    const labels = { btnCurNominal: 'TL (TMS 29)', btnCurUSD: 'USD ($)' };
    Object.entries(labels).forEach(([id, text]) => {
      const b = document.getElementById(id);
      if (!b) return;
      const on = (id === 'btnCurUSD') === (state.ex === 'USD');
      b.className = `balance-cur-btn px-2.5 py-1 rounded-lg ${on ? 'font-bold bg-[#2F6BFF] text-white shadow-sm' : 'font-medium text-slate-400 hover:text-white'} transition-all`;
      const icon = b.querySelector('i');
      b.textContent = '';
      if (icon) { b.appendChild(icon); b.appendChild(document.createTextNode(text)); } else b.textContent = text;
    });
    const tms = document.getElementById('btnCurTMS29');
    if (tms) tms.style.display = 'none';
  }

  async function setCurrency(currency) {
    const fin = appState.currentCompanyData;
    if (!fin || state.status !== 'ready') return;
    const want = currency === 'usd' ? 'USD' : 'TRY';
    if (want === 'USD' && !state.usd) {
      state.ex = 'USD';
      setCurrencyButtons();
      const code = state.code;
      const tbody = document.getElementById('stockBalanceSheetTbody');
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="py-8 px-4 text-center text-xs font-mono text-slate-500">USD verisi yükleniyor (ilk istek birkaç saniye sürebilir)...</td></tr>';
      const d = await getData(code, 'USD');
      if (state.code !== code) return;
      if (!d.available) { state.ex = 'TRY'; setCurrencyButtons(); renderBalance(fin); renderIncome(fin); showToast?.('USD verisi alınamadı.'); return; }
      state.usd = d;
    }
    state.ex = want;
    currentBalanceCurrency = currency;
    setCurrencyButtons();
    renderIncome(fin);
    renderBalance(fin);
  }

  function setPeriod(period) {
    currentBalancePeriod = period;
    const fin = appState.currentCompanyData;
    if (fin && state.status === 'ready') renderIncome(fin);
  }

  /** Entry point used by the stock page: render what we have, or start loading. */
  function show(fin) {
    if (state.code === fin.code && state.status === 'ready') { renderIncome(fin); renderBalance(fin); return; }
    if (state.code === fin.code && state.status === 'unavailable') { renderUnavailable(); return; }
    ensure(fin);
  }

  return { show, ensure, renderIncome, renderBalance, setCurrency, setPeriod, placeholder, chartReady, state };
})();

window.Statements = Statements;
