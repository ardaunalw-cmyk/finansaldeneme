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
    // Older files have no "kind"; banks are recognisable by total assets 1Z plus operating income 3CE
    const kind = j.kind || (j.rows.some(r => r[0] === '1Z') && j.rows.some(r => r[0] === '3CE') ? 'bank' : 'industrial');
    return {
      available: true, kind, source: j.source, basis: j.basis, periods: j.periods,
      rows: j.rows.map(([c, n, l, ...v]) => ({ c, n, l, v: v.map(x => x * (j.unit || 1)) }))
    };
  }

  async function fetchLive(code, ex) {
    const r = await fetch(`/api/statements?symbol=${encodeURIComponent(typeof tradingCode === 'function' ? tradingCode(code) : code)}&exchange=${ex}`);
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

  const isBank = d => d.kind === 'bank';

  function category(code, kind) {
    if (code.startsWith('1')) return 'varlik';
    if (kind === 'bank') {
      if (/^2O/.test(code) || code === '2Z') return 'ozkaynak';
      if (code.startsWith('2')) return 'yukumluluk';
    } else {
      if (/^2[AB]/.test(code)) return 'yukumluluk';
      if (code.startsWith('2')) return 'ozkaynak';
    }
    if (code.startsWith('3')) return 'gelir';
    return 'nakit';
  }

  /** Relabels a KPI card (title, sub-label) and remembers the original text so it can be restored. */
  function relabel(valueId, title, sub) {
    const el = document.getElementById(valueId);
    const card = el && el.closest('.p-4');
    if (!card) return;
    const t = card.querySelector('span.font-mono');
    const row = el.nextElementSibling && el.nextElementSibling.querySelector('span');
    [[t, title], [row, sub]].forEach(([node, text]) => {
      if (!node || text == null) return;
      if (node.dataset.orig === undefined) node.dataset.orig = node.textContent;
      node.textContent = text === null ? node.dataset.orig : text;
    });
  }
  const restore = id => {
    const el = document.getElementById(id);
    const card = el && el.closest('.p-4');
    if (!card) return;
    card.querySelectorAll('[data-orig]').forEach(n => { n.textContent = n.dataset.orig; });
  };
  const INCOME_IDS = ['inc5Revenue', 'inc5Cost', 'inc5Gross', 'inc5Favok', 'inc5NetProfit'];
  const BALANCE_IDS = ['bsCardNetDebt', 'bsCardNetIncome'];
  const set = (id, text) => { const n = document.getElementById(id); if (n) n.textContent = text; };
  const cls = (id, c) => { const n = document.getElementById(id); if (n) n.className = c; };

  /* ---------- status messages ---------- */
  function messageFor(reason) {
    if (reason === 'financial-company') return 'Bu finansal şirketin (sigorta, faktoring, varlık yönetimi vb.) bilanço yapısı henüz bağlanmadı.';
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
    const bank = isBank(d);
    let idx = d.periods.indexOf(currentBalancePeriod);
    if (idx < 0) { idx = 0; currentBalancePeriod = d.periods[0]; }
    const v = code => val(d, code, idx);
    const pctOf = (x, base) => (base ? `%${pct1(x / base * 100)}` : '—');

    let cards, base, revCode, note;
    if (bank) {
      const opInc = v('3CE');
      base = opInc;
      revCode = '3C';
      cards = [
        { id: 'inc5Revenue', title: '1. NET FAİZ GELİRİ', value: v('3C'), sub: 'Yıllık Değişim' },
        { id: 'inc5Cost', title: '2. FAİZ GİDERLERİ', value: -v('3B'), sub: 'Faiz Gelirine Oranı', ratio: pctOf(v('3B'), v('3A')) },
        { id: 'inc5Gross', title: '3. NET ÜCRET VE KOMİSYON', value: v('3CA'), sub: 'Faaliyet Gelirine Payı', ratio: pctOf(v('3CA'), opInc) },
        { id: 'inc5Favok', title: '4. FAALİYET GELİRLERİ', value: opInc, sub: 'Net Faaliyet Kâr Marjı', ratio: pctOf(v('3CH'), opInc) },
        { id: 'inc5NetProfit', title: '5. NET DÖNEM KÂRI', value: v('3ZA'), sub: 'Net Kâr / Faaliyet Geliri', ratio: pctOf(v('3ZA'), opInc) }
      ];
      note = `${fin.name}: ${d.periods[idx]} döneminde net faiz geliri ${money(v('3C'), ex)}, net ücret ve komisyon geliri ${money(v('3CA'), ex)}, faaliyet gelirleri ${money(opInc, ex)} ve net kâr ${money(v('3ZA'), ex)}.`;
    } else {
      const rev = v('3C');
      const ebitda = v('3DF') + v('4B');
      base = rev;
      revCode = '3C';
      cards = [
        { id: 'inc5Revenue', title: null, value: rev, sub: null },
        { id: 'inc5Cost', title: null, value: v('3CA'), ratio: rev ? `%${pct1(Math.abs(v('3CA')) / rev * 100)}` : '—' },
        { id: 'inc5Gross', title: null, value: v('3D'), ratio: pctOf(v('3D'), rev) },
        { id: 'inc5Favok', title: null, value: ebitda, ratio: pctOf(ebitda, rev) },
        { id: 'inc5NetProfit', title: null, value: v('3Z'), ratio: pctOf(v('3Z'), rev) }
      ];
      note = `${fin.name}: ${d.periods[idx]} döneminde (${d.periods[idx].endsWith('/12') ? 'yıllık' : 'yılbaşından itibaren'}) ${money(rev, ex)} hasılat, ${money(v('3D'), ex)} brüt kâr ve ${money(v('3Z'), ex)} net kâr; brüt marj ${pctOf(v('3D'), rev)}, FAVÖK marjı ${pctOf(ebitda, rev)}. FAVÖK = faaliyet kârı + amortisman.`;
    }
    if (!bank) INCOME_IDS.forEach(restore);

    cards.forEach(c => {
      set(c.id, money(c.value, ex));
      if (bank) relabel(c.id, c.title, c.sub);
    });
    // ratio line of each card
    const ratioIds = { inc5Cost: 'inc5CostRatio', inc5Gross: 'inc5GrossMargin', inc5Favok: 'inc5FavokMargin', inc5NetProfit: 'inc5NetMargin' };
    cards.forEach(c => { if (ratioIds[c.id] && c.ratio) set(ratioIds[c.id], c.ratio); });

    const cur = bank ? val(d, '3C', idx) : val(d, revCode, idx);
    const y = idx === 0 ? yoy(cur, val(d, revCode, LY)) : null;
    set('inc5RevYoY', y || '—');
    cls('inc5RevYoY', `font-mono font-bold ${y && y.startsWith('-') ? 'text-rose-400' : 'text-emerald-400'}`);

    const ytd = d.periods[idx].endsWith('/12') ? 'yıllık' : 'yılbaşından itibaren';
    set('income5PeriodBadge', `${d.periods[idx]} (${ytd}, ${ex === 'USD' ? 'USD' : 'TL'})`);
    set('inc5AuditNote', note);
    renderPeriodButtons(d);
    void base;
  }
  function renderBalance(fin) {
    const d = active();
    if (!d || !d.available) { renderUnavailable(); return; }
    const ex = state.ex;
    const fy = prevFyIdx(d);

    // KPI cards
    const bank = isBank(d);
    const assets = bank ? val(d, '1Z', 0) : val(d, '1BL', 0);
    set('bsCardTotalAssets', money(assets, ex));
    const ay = yoy(assets, bank ? val(d, '1Z', LY) : val(d, '1BL', LY));
    set('bsCardAssetsYoY', ay || '—');
    cls('bsCardAssetsYoY', `font-mono font-bold ${ay && ay.startsWith('-') ? 'text-rose-400' : 'text-emerald-400'}`);

    if (bank) {
      const equity = val(d, '2O', 0);
      const equityParent = equity - val(d, '2OVA', 0);
      const niTtm = ttm(d, '3ZA');
      const opInc = val(d, '3CE', 0);
      const deposits = val(d, '2A', 0), loans = val(d, '1AF', 0);
      set('bsCardTotalEquity', money(equity, ex));
      set('bsCardEquityRoe', equityParent > 0 ? `%${pct1(niTtm / equityParent * 100)}` : '—');
      relabel('bsCardNetDebt', 'TOPLAM MEVDUAT', 'Mevduat / Toplam Pasif');
      set('bsCardNetDebt', money(deposits, ex));
      set('bsCardNetDebtRatio', assets ? `%${pct1(deposits / assets * 100)}` : '—');
      relabel('bsCardNetIncome', 'DÖNEM NET KÂRI', 'Net Kâr / Faaliyet Geliri');
      set('bsCardNetIncome', money(val(d, '3ZA', 0), ex));
      set('bsCardNetMargin', opInc ? `%${pct1(val(d, '3ZA', 0) / opInc * 100)}` : '—');
      set('bsCardMonetaryTitle', 'KREDİ / MEVDUAT');
      set('bsCardMonetaryBadge', 'HESAPLANDI');
      set('bsCardMonetaryGain', deposits ? `%${pct1(loans / deposits * 100)}` : '—');
      cls('bsCardMonetaryGain', 'text-2xl font-mono font-bold text-amber-300 tracking-tight');
      set('bsCardMonetaryLabel', 'Krediler / Toplam Aktif');
      set('bsCardMonetaryRatio', assets ? `%${pct1(loans / assets * 100)}` : '—');
      cls('bsCardMonetaryRatio', 'font-mono font-bold text-amber-400');
      set('bsCardMonetaryNote', 'Krediler / toplam mevduat');
    } else {
      BALANCE_IDS.forEach(restore);
      const equity = val(d, '2N', 0);
      const equityParent = val(d, '2O', 0);
      const niTtm = ttm(d, '3Z');
      set('bsCardTotalEquity', money(equity, ex));
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

      // Fifth card: current ratio (the source has no TMS 29 monetary position line)
      const cur = val(d, '1A', 0), curLiab = val(d, '2A', 0);
      set('bsCardMonetaryTitle', 'CARİ ORAN (LİKİDİTE)');
      set('bsCardMonetaryBadge', 'HESAPLANDI');
      set('bsCardMonetaryGain', curLiab ? `${(cur / curLiab).toFixed(2).replace('.', ',')}x` : '—');
      cls('bsCardMonetaryGain', 'text-2xl font-mono font-bold text-amber-300 tracking-tight');
      set('bsCardMonetaryLabel', 'Nakit / Kısa Vadeli Yük.');
      set('bsCardMonetaryRatio', curLiab ? `%${pct1(cash / curLiab * 100)}` : '—');
      cls('bsCardMonetaryRatio', 'font-mono font-bold text-amber-400');
      set('bsCardMonetaryNote', 'Dönen varlıklar / kısa vadeli yükümlülükler');
    }
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
      const cat = category(r.c, d.kind);
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
      const incBase = bank ? val(d, '3CE', 0) : val(d, '3C', 0);
      const share = cat === 'gelir' ? (incBase ? v0 / incBase * 100 : null)
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
    const bank = isBank(d);
    // Five quarters of flows (oldest first); a quarter needs its in-year predecessor unless it is Q1
    const qs = [];
    for (let i = 4; i >= 0; i--) {
      const [y, p] = d.periods[i].split('/').map(Number);
      // Banks: total operating income and net income; others: revenue and EBITDA
      const rev = (bank ? flow(d, '3CE', i) : flow(d, '3C', i)) / 1e9;
      const fav = (bank ? flow(d, '3ZA', i) : flow(d, '3DF', i) + flow(d, '4B', i)) / 1e9;
      qs.push({ label: `${String(y).slice(2)}/${p}`, rev, fav });
    }
    const r1 = x => Math.round(x * 10) / 10;
    fin.quarterly = {
      periods: qs.map(q => q.label),
      revenue: qs.map(q => r1(q.rev)),
      favok: qs.map(q => r1(q.fav)),
      margin: qs.map(q => (q.rev > 0 ? r1(q.fav / q.rev * 100) : 0)),
      seriesLabels: bank ? ['Faaliyet Gelirleri', 'Net Kâr', 'Net Kâr / Faaliyet Geliri (%)'] : null
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
    const revTtm = bank ? ttm(d, '3CE') : ttm(d, '3C');
    const favTtm = bank ? ttm(d, '3ZA') : ttm(d, '3DF') + ttm(d, '4B');
    const niTtm = bank ? ttm(d, '3ZA') : ttm(d, '3Z');
    fin.annualRevenue = formatKapMoney(revTtm);
    fin.annualFavok = formatKapMoney(favTtm);
    fin.netIncome = formatKapMoney(niTtm);
    set('stockAnnualRevenue', fin.annualRevenue);
    set('stockAnnualFavok', fin.annualFavok);

    // Summary used by the capital / bonus-share module
    const equity = bank ? val(d, '2O', 0) : val(d, '2N', 0);
    const parentEq = bank ? equity - val(d, '2OVA', 0) : val(d, '2O', 0);
    const finDebt = bank ? 0 : val(d, '2AA', 0) + val(d, '2BA', 0);
    const cash = bank ? 0 : val(d, '1AA', 0) + val(d, '1AB', 0);
    fin.balanceSheet = {
      summary: {
        totalAssets: formatKapMoney(bank ? val(d, '1Z', 0) : val(d, '1BL', 0)),
        totalEquity: formatKapMoney(equity),
        netDebt: formatKapMoney(Math.max(0, finDebt - cash)),
        netIncome: formatKapMoney(niTtm),
        roe: parentEq > 0 ? `%${pct1(niTtm / parentEq * 100)}` : 'N/A',
        netDebtRatio: !bank && favTtm > 0 ? `${((finDebt - cash) / favTtm).toFixed(2)}x` : 'N/A',
        netMargin: revTtm ? `%${pct1(niTtm / revTtm * 100)}` : 'N/A'
      },
      items: []
    };
    // Captions of the two annual figures differ for banks
    const lbl = (id, text) => { const n = document.getElementById(id); if (n && n.previousSibling) n.previousSibling.textContent = text; };
    lbl('stockAnnualRevenue', bank ? 'Son 12 Ay Faaliyet Geliri: ' : 'Son 12 Ay Satış: ');
    lbl('stockAnnualFavok', bank ? 'Son 12 Ay Net Kâr: ' : 'Son 12 Ay FAVÖK: ');
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
