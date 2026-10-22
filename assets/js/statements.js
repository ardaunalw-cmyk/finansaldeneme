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
  const isIns = d => d.kind === 'insurance';
  // Premiums, claims and technical lines of insurers (non-life + life)
  const premium = (d, i) => val(d, '3AA', i) + val(d, '3DAA', i);
  const claims = (d, i) => val(d, '3BA', i) + val(d, '3EA', i);
  const techProvisions = (d, i) => d.rows.filter(r => /Sigortacılık Teknik Karşılıkları/.test(r.n) && r.c.startsWith('2') && r.l <= 1).reduce((a, r) => a + r.v[i], 0);

  function category(code, kind) {
    if (code.startsWith('1')) return 'varlik';
    if (kind === 'insurance') {
      if (/^2ME/.test(code) || code === '2O' || code === '2Z') return 'ozkaynak';
      if (code.startsWith('2')) return 'yukumluluk';
    } else if (kind === 'bank') {
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
    if (reason === 'financial-company') return 'Bu finansal şirketin (faktoring, finansal kiralama, varlık yönetimi vb.) bilançosu veri kaynağında bulunmuyor.';
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
    // Back to the default captions (a previous bank/insurer may have changed them)
    INCOME_IDS.forEach(restore);
    BALANCE_IDS.forEach(restore);
    set('bsCardMonetaryTitle', 'CARİ ORAN (LİKİDİTE)');
    set('bsCardMonetaryLabel', 'Nakit / Kısa Vadeli Yük.');
    set('bsPeriodBadge', 'VERİ YOK');
    set('income5PeriodBadge', 'VERİ YOK');
    placeholder('stockIncomeChart');
    placeholder('stockProjectionChart');
    renderHealth();
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
    const ins = isIns(d);
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
    } else if (ins) {
      const prem = premium(d, idx);
      base = prem;
      revCode = null;
      cards = [
        { id: 'inc5Revenue', title: '1. KAZANILMIŞ PRİMLER', value: prem, sub: 'Yıllık Değişim' },
        { id: 'inc5Cost', title: '2. GERÇEKLEŞEN HASARLAR', value: claims(d, idx), sub: 'Hasar / Prim Oranı', ratio: pctOf(Math.abs(claims(d, idx)), prem) },
        { id: 'inc5Gross', title: '3. TEKNİK BÖLÜM DENGESİ', value: v('3K'), sub: 'Teknik Denge / Prim', ratio: pctOf(v('3K'), prem) },
        { id: 'inc5Favok', title: '4. YATIRIM GELİRLERİ', value: v('3L'), sub: 'Yatırım Geliri / Prim', ratio: pctOf(v('3L'), prem) },
        { id: 'inc5NetProfit', title: '5. NET DÖNEM KÂRI', value: v('3Z'), sub: 'Net Kâr / Prim', ratio: pctOf(v('3Z'), prem) }
      ];
      note = `${fin.name}: ${d.periods[idx]} döneminde kazanılmış primler ${money(prem, ex)}, gerçekleşen hasarlar ${money(Math.abs(claims(d, idx)), ex)}, teknik bölüm dengesi ${money(v('3K'), ex)}, yatırım gelirleri ${money(v('3L'), ex)} ve net kâr ${money(v('3Z'), ex)}. Hayat ve hayat dışı branşlar toplanmıştır.`;
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
    if (!bank && !ins) INCOME_IDS.forEach(restore);

    cards.forEach(c => {
      set(c.id, money(c.value, ex));
      if (bank || ins) relabel(c.id, c.title, c.sub);
    });
    // ratio line of each card
    const ratioIds = { inc5Cost: 'inc5CostRatio', inc5Gross: 'inc5GrossMargin', inc5Favok: 'inc5FavokMargin', inc5NetProfit: 'inc5NetMargin' };
    cards.forEach(c => { if (ratioIds[c.id] && c.ratio) set(ratioIds[c.id], c.ratio); });

    const cur = ins ? premium(d, idx) : val(d, '3C', idx);
    const prevYear = ins ? premium(d, LY) : val(d, '3C', LY);
    const y = idx === 0 ? yoy(cur, prevYear) : null;
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
    const ins = isIns(d);
    const assets = bank || ins ? val(d, '1Z', 0) : val(d, '1BL', 0);
    set('bsCardTotalAssets', money(assets, ex));
    const ay = yoy(assets, bank || ins ? val(d, '1Z', LY) : val(d, '1BL', LY));
    set('bsCardAssetsYoY', ay || '—');
    cls('bsCardAssetsYoY', `font-mono font-bold ${ay && ay.startsWith('-') ? 'text-rose-400' : 'text-emerald-400'}`);

    if (ins) {
      const equity = val(d, '2O', 0);
      const niTtm = ttm(d, '3Z');
      const premNow = premium(d, 0);
      const prov = techProvisions(d, 0);
      set('bsCardTotalEquity', money(equity, ex));
      set('bsCardEquityRoe', equity > 0 ? `%${pct1(niTtm / equity * 100)}` : '—');
      relabel('bsCardNetDebt', 'SİGORTACILIK TEKNİK KARŞILIKLARI', 'Teknik Karşılık / Aktif');
      set('bsCardNetDebt', money(prov, ex));
      set('bsCardNetDebtRatio', assets ? `%${pct1(prov / assets * 100)}` : '—');
      relabel('bsCardNetIncome', 'DÖNEM NET KÂRI', 'Net Kâr / Prim');
      set('bsCardNetIncome', money(val(d, '3Z', 0), ex));
      set('bsCardNetMargin', premNow ? `%${pct1(val(d, '3Z', 0) / premNow * 100)}` : '—');
      set('bsCardMonetaryTitle', 'ÖZKAYNAK / AKTİF');
      set('bsCardMonetaryBadge', 'HESAPLANDI');
      set('bsCardMonetaryGain', assets ? `%${pct1(equity / assets * 100)}` : '—');
      cls('bsCardMonetaryGain', 'text-2xl font-mono font-bold text-amber-300 tracking-tight');
      set('bsCardMonetaryLabel', 'Yükümlülük / Özkaynak');
      set('bsCardMonetaryRatio', equity > 0 ? `${((assets - equity) / equity).toFixed(1).replace('.', ',')}x` : '—');
      cls('bsCardMonetaryRatio', 'font-mono font-bold text-amber-400');
      set('bsCardMonetaryNote', 'Özkaynak / toplam aktif');
    } else if (bank) {
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
      const incBase = bank ? val(d, '3CE', 0) : ins ? premium(d, 0) : val(d, '3C', 0);
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
    const ins = isIns(d);
    // Five quarters of flows (oldest first); a quarter needs its in-year predecessor unless it is Q1
    const qs = [];
    for (let i = 4; i >= 0; i--) {
      const [y, p] = d.periods[i].split('/').map(Number);
      // Banks: total operating income and net income; others: revenue and EBITDA
      const f = code => flow(d, code, i);
      const rev = (bank ? f('3CE') : ins ? f('3AA') + f('3DAA') : f('3C')) / 1e9;
      const fav = (bank ? f('3ZA') : ins ? f('3Z') : f('3DF') + f('4B')) / 1e9;
      qs.push({ label: `${String(y).slice(2)}/${p}`, rev, fav });
    }
    const r1 = x => Math.round(x * 10) / 10;
    fin.quarterly = {
      periods: qs.map(q => q.label),
      revenue: qs.map(q => r1(q.rev)),
      favok: qs.map(q => r1(q.fav)),
      margin: qs.map(q => (q.rev > 0 ? r1(q.fav / q.rev * 100) : 0)),
      seriesLabels: bank ? ['Faaliyet Gelirleri', 'Net Kâr', 'Net Kâr / Faaliyet Geliri (%)']
        : ins ? ['Kazanılmış Primler', 'Net Kâr', 'Net Kâr / Prim (%)'] : null
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
    const revTtm = bank ? ttm(d, '3CE') : ins ? ttm(d, '3AA') + ttm(d, '3DAA') : ttm(d, '3C');
    const favTtm = bank ? ttm(d, '3ZA') : ins ? ttm(d, '3Z') : ttm(d, '3DF') + ttm(d, '4B');
    const niTtm = bank ? ttm(d, '3ZA') : ttm(d, '3Z');
    fin.annualRevenue = formatKapMoney(revTtm);
    fin.annualFavok = formatKapMoney(favTtm);
    fin.netIncome = formatKapMoney(niTtm);
    set('stockAnnualRevenue', fin.annualRevenue);
    set('stockAnnualFavok', fin.annualFavok);

    // Summary used by the capital / bonus-share module
    const equity = bank || ins ? val(d, '2O', 0) : val(d, '2N', 0);
    fin.equityRaw = equity;
    const parentEq = bank ? equity - val(d, '2OVA', 0) : ins ? equity : val(d, '2O', 0);
    const finDebt = bank || ins ? 0 : val(d, '2AA', 0) + val(d, '2BA', 0);
    const cash = bank || ins ? 0 : val(d, '1AA', 0) + val(d, '1AB', 0);
    fin.balanceSheet = {
      summary: {
        totalAssets: formatKapMoney(bank || ins ? val(d, '1Z', 0) : val(d, '1BL', 0)),
        totalEquity: formatKapMoney(equity),
        netDebt: formatKapMoney(Math.max(0, finDebt - cash)),
        netIncome: formatKapMoney(niTtm),
        roe: parentEq > 0 ? `%${pct1(niTtm / parentEq * 100)}` : 'N/A',
        netDebtRatio: !bank && !ins && favTtm > 0 ? `${((finDebt - cash) / favTtm).toFixed(2)}x` : 'N/A',
        netMargin: revTtm ? `%${pct1(niTtm / revTtm * 100)}` : 'N/A'
      },
      items: []
    };
    // Payout: cash dividends paid (cash flow statement, incl. to minorities) / net profit for the
    // period incl. minorities, both last twelve months. Many companies report dividends inside
    // "other financing" without a separate line; those get null rather than a guessed 0.
    if (rowMap(d).has('4CBB')) {
      const paid = Math.abs(ttm(d, '4CBB'));
      const profit = rowMap(d).has('3L') ? ttm(d, '3L') : ttm(d, '3Z');
      fin.payout = { paid, profit, ratio: profit > 0 ? paid / profit * 100 : null, period: d.periods[0] };
    } else {
      fin.payout = { missing: bank || ins ? 'financial' : 'no-line' };
    }

    // Captions of the two annual figures differ for banks
    const lbl = (id, text) => { const n = document.getElementById(id); if (n && n.previousSibling) n.previousSibling.textContent = text; };
    lbl('stockAnnualRevenue', bank ? 'Son 12 Ay Faaliyet Geliri: ' : ins ? 'Son 12 Ay Prim: ' : 'Son 12 Ay Satış: ');
    lbl('stockAnnualFavok', bank || ins ? 'Son 12 Ay Net Kâr: ' : 'Son 12 Ay FAVÖK: ');
    fin.quarterlyLive = true;

    // Chart captions
    set('projGrowthBadge', `Son çeyrek YoY ${growth >= 1 ? '+' : '-'}%${pct1(Math.abs(growth - 1) * 100)}`);
  }

  /* ---------- financial health: DuPont, Altman Z'', Piotroski F ---------- */
  const nf2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const TONE = {
    good: 'bg-emerald-950 border-emerald-800/50 text-emerald-400',
    mid: 'bg-amber-950/40 border-amber-800/50 text-amber-300',
    bad: 'bg-red-950/40 border-red-800/50 text-red-300',
    none: 'bg-[#070B14] border-[#1A2540] text-slate-400'
  };
  const pill = (id, text, tone) => { set(id, text); cls(id, `text-xs px-2.5 py-0.5 rounded-full border font-bold font-mono ${TONE[tone]}`); };
  const tag = (id, text, tone) => { set(id, text); cls(id, `text-xs font-mono font-bold border px-2.5 py-1 rounded-lg ${TONE[tone]}`); };
  const pct = x => `%${pct1(x * 100)}`;

  /** ROE = net margin x asset turnover x leverage; last-twelve-months profit over the latest balance sheet. */
  function dupont(d) {
    const bank = isBank(d), ins = isIns(d);
    const ni = bank ? ttm(d, '3ZA') : ttm(d, '3Z');
    const rev = bank ? ttm(d, '3CE') : ins ? ttm(d, '3AA') + ttm(d, '3DAA') : ttm(d, '3C');
    const assets = bank || ins ? val(d, '1Z', 0) : val(d, '1BL', 0);
    const eq = bank ? val(d, '2O', 0) - val(d, '2OVA', 0) : val(d, '2O', 0);
    if (!(rev > 0 && assets > 0 && eq > 0)) return null;
    return { margin: ni / rev, turnover: rev / assets, leverage: assets / eq, roe: ni / eq, revLabel: bank ? 'faaliyet geliri' : ins ? 'prim' : 'hasılat' };
  }

  /** Altman Z'' (non-manufacturing / emerging markets): book values only, no market price. */
  function altman(d) {
    const ta = val(d, '1BL', 0);
    const liab = val(d, '2A', 0) + val(d, '2B', 0);
    if (!(ta > 0 && liab > 0)) return null;
    const x1 = (val(d, '1A', 0) - val(d, '2A', 0)) / ta;
    const x2 = (val(d, '2OCD', 0) + val(d, '2OCE', 0) + val(d, '2OCF', 0)) / ta;
    const x3 = ttm(d, '3DF') / ta;
    const x4 = val(d, '2N', 0) / liab;
    return { z: 6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4, x1, x2, x3, x4 };
  }

  /**
   * Piotroski F: nine pass/fail tests. Changes compare the latest period with the same period a
   * year earlier (equal year-to-date lengths, both in current purchasing power under TMS 29).
   */
  function piotroski(d) {
    const v = (c, i) => val(d, c, i);
    const has = c => rowMap(d).has(c);
    const ta0 = v('1BL', 0), ta1 = v('1BL', LY);
    const ratio = (a, b) => (b ? a / b : null);
    const up = (a, b) => (a == null || b == null ? null : a > b);
    const niTtm = ttm(d, '3Z'), cfoTtm = ttm(d, '4C');
    const ltd0 = ratio(v('2BA', 0), ta0), ltd1 = ratio(v('2BA', LY), ta1);
    const rev = has('3C') && v('3C', 0) && v('3C', LY);
    const tests = [
      ['Kârlılık', 'Son 12 ay net kâr pozitif', niTtm > 0],
      ['Kârlılık', 'Son 12 ay işletme nakit akışı pozitif', has('4C') ? cfoTtm > 0 : null],
      ['Kârlılık', 'Aktif kârlılığı (ROA) yükseldi', up(ratio(v('3Z', 0), ta0), ratio(v('3Z', LY), ta1))],
      ['Kârlılık', 'Nakit akışı net kârdan büyük', has('4C') ? cfoTtm > niTtm : null],
      ['Borçluluk', 'Uzun vadeli borç / aktif azaldı', !has('2BA') || (ltd0 === 0 && ltd1 === 0) ? true : ltd0 < ltd1],
      ['Borçluluk', 'Cari oran yükseldi', up(ratio(v('1A', 0), v('2A', 0)), ratio(v('1A', LY), v('2A', LY)))],
      ['Borçluluk', 'Ödenmiş sermaye artmadı', v('2OA', 0) <= v('2OA', LY)],
      ['Verimlilik', 'Brüt kâr marjı yükseldi', rev && has('3D') ? up(v('3D', 0) / v('3C', 0), v('3D', LY) / v('3C', LY)) : null],
      ['Verimlilik', 'Aktif devir hızı yükseldi', rev ? up(v('3C', 0) / ta0, v('3C', LY) / ta1) : null]
    ];
    return { tests, score: tests.filter(t => t[2] === true).length, known: tests.filter(t => t[2] != null).length };
  }

  function renderHealth() {
    const d = state.data;
    const ready = state.status === 'ready' && d && d.available;
    const msg = ready ? '' : state.status === 'loading' || state.status === 'idle' ? 'Gerçek bilanço verisi yükleniyor...' : messageFor(state.reason);

    // DuPont
    const dp = ready ? dupont(d) : null;
    set('dupontNetMargin', dp ? pct(dp.margin) : '—');
    set('dupontAssetTurnover', dp ? `${nf2.format(dp.turnover)}x` : '—');
    set('dupontLeverage', dp ? `${nf2.format(dp.leverage)}x` : '—');
    const eqEl = document.getElementById('dupontEquation');
    if (eqEl) {
      eqEl.innerHTML = dp
        ? `${pct(dp.margin)} (Net Marj) × ${nf2.format(dp.turnover)}x (Devir Hızı) × ${nf2.format(dp.leverage)}x (Kaldıraç) = <strong class="${dp.roe >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${pct(dp.roe)} ROE</strong>
           <div class="text-[10px] text-slate-500 mt-1.5 font-sans">Son 12 ay ana ortaklık net kârı ve ${dp.revLabel}; ${d.periods[0]} bilançosundaki toplam aktif ve ana ortaklık özkaynağı.</div>`
        : (ready ? 'Özkaynak veya gelir sıfır/negatif olduğu için ayrıştırma yapılamıyor.' : msg);
    }
    if (!dp) tag('dupontQualityBadge', ready ? 'HESAPLANAMADI' : 'VERİ YOK', 'none');
    else if (dp.roe < 0) tag('dupontQualityBadge', 'KÂRLILIK: ZARAR', 'bad');
    else if (dp.roe >= 0.25) tag('dupontQualityBadge', 'KÂRLILIK: YÜKSEK', 'good');
    else if (dp.roe >= 0.10) tag('dupontQualityBadge', 'KÂRLILIK: ORTA', 'mid');
    else tag('dupontQualityBadge', 'KÂRLILIK: DÜŞÜK', 'mid');

    // Altman and Piotroski are built for operating companies, not banks or insurers
    const financial = ready && (isBank(d) || isIns(d));
    const naText = 'Bu model sanayi, ticaret ve hizmet şirketleri için tasarlanmıştır; banka ve sigorta bilançolarında anlamlı sonuç vermez.';
    const list = document.getElementById('stockPiotroskiList');

    const az = ready && !financial ? altman(d) : null;
    if (az) {
      set('stockAltmanZScore', nf2.format(az.z));
      const zone = az.z > 2.6 ? ['GÜVENLİ BÖLGE', 'good', 'Model, yakın vadede finansal sıkıntı riskini düşük görüyor.']
        : az.z >= 1.1 ? ['GRİ BÖLGE', 'mid', 'Model belirsiz bölgede; sonuç tek başına bir risk işareti değildir.']
          : ['RİSKLİ BÖLGE', 'bad', 'Model, finansal sıkıntı riskinin yüksek olduğuna işaret ediyor.'];
      pill('stockAltmanZStatus', zone[0], zone[1]);
      set('stockAltmanZDesc', `${zone[2]} ${d.periods[0]} bilançosuna göre işletme sermayesi / aktif ${pct(az.x1)}, birikmiş kârlar / aktif ${pct(az.x2)}, son 12 ay faaliyet kârı / aktif ${pct(az.x3)}, özkaynak / yükümlülük ${nf2.format(az.x4)}x.`);
    } else {
      set('stockAltmanZScore', '—');
      pill('stockAltmanZStatus', financial ? 'UYGULANMAZ' : ready ? 'HESAPLANAMADI' : 'VERİ YOK', 'none');
      set('stockAltmanZDesc', financial ? naText : ready ? 'Bilançoda toplam aktif veya yükümlülük bulunamadı.' : msg);
    }

    const pf = ready && !financial ? piotroski(d) : null;
    const scoreEl = document.getElementById('stockPiotroskiScore');
    if (pf) {
      if (scoreEl) scoreEl.innerHTML = `${pf.score} <span class="text-xs text-slate-500 font-normal">/ 9</span>`;
      set('stockPiotroskiPassed', `Sağlanan kriter: ${pf.score} / 9${pf.known < 9 ? ` (${9 - pf.known} kriterde veri yok)` : ''}`);
      const st = pf.score >= 7 ? ['GÜÇLÜ', 'good', 'Kârlılık, borçluluk ve verimlilik göstergelerinin çoğu iyileşiyor.']
        : pf.score >= 4 ? ['ORTA', 'mid', 'Göstergelerin bir kısmı iyileşirken bir kısmı geriliyor.']
          : ['ZAYIF', 'bad', 'Göstergelerin çoğu geçen yılın aynı dönemine göre zayıflamış.'];
      pill('stockPiotroskiStatus', st[0], st[1]);
      set('stockPiotroskiDesc', `${st[2]} ${d.periods[0]} dönemi ${d.periods[LY]} ile karşılaştırıldı (TMS 29 enflasyon düzeltmeli). Ödenmiş sermaye artışı bedelsiz ise sulandırma değildir.`);
      if (list) {
        list.innerHTML = pf.tests.map(([, label, ok]) => `
          <li class="flex items-center gap-2 ${ok == null ? 'text-slate-500' : ok ? 'text-slate-200' : 'text-slate-400'}">
            <i class="fa-solid ${ok == null ? 'fa-minus' : ok ? 'fa-check text-emerald-400' : 'fa-xmark text-rose-400'} w-3 text-center"></i><span>${label}</span>
          </li>`).join('');
        list.style.display = '';
      }
    } else {
      if (scoreEl) scoreEl.innerHTML = '— <span class="text-xs text-slate-500 font-normal">/ 9</span>';
      set('stockPiotroskiPassed', '');
      pill('stockPiotroskiStatus', financial ? 'UYGULANMAZ' : 'VERİ YOK', 'none');
      set('stockPiotroskiDesc', financial ? naText : msg);
      if (list) { list.innerHTML = ''; list.style.display = 'none'; }
    }
    // Feeds the peer radar's solvency axis
    const fin = appState.currentCompanyData;
    if (fin && fin.code === state.code) fin.pio = pf ? pf.score : null;
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
    fin.payout = undefined;
    fin.equityRaw = undefined;
    setCurrencyButtons();
    renderUnavailable();

    const d = await getData(code, 'TRY');
    if (state.code !== code) return;           // user moved on to another stock
    state.data = d;
    if (!d.available) {
      state.status = 'unavailable';
      state.reason = d.reason;
      renderUnavailable();
      fin.payout = { missing: 'no-data' };
      fin.equityRaw = null;
      if (typeof renderCapitalAndDividendIntelligence === 'function') renderCapitalAndDividendIntelligence(fin);
      return;
    }

    state.status = 'ready';
    currentBalancePeriod = d.periods[0];
    applyDerived(fin, d);
    showCanvas('stockIncomeChart');
    showCanvas('stockProjectionChart');
    renderIncome(fin);
    renderBalance(fin);
    renderHealth();
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
    const capitalCard = () => { if (typeof renderCapitalAndDividendIntelligence === 'function') renderCapitalAndDividendIntelligence(fin); };
    if (state.code === fin.code && state.status === 'ready') {
      // A freshly built company object has none of the derived figures yet
      if (fin.payout === undefined) { applyDerived(fin, state.data); capitalCard(); }
      renderIncome(fin); renderBalance(fin); renderHealth();
      return;
    }
    if (state.code === fin.code && state.status === 'unavailable') {
      renderUnavailable();
      fin.payout = { missing: 'no-data' };
      fin.equityRaw = null;
      capitalCard();
      return;
    }
    ensure(fin);
  }

  return { show, ensure, renderIncome, renderBalance, setCurrency, setPeriod, placeholder, chartReady, state };
})();

window.Statements = Statements;
