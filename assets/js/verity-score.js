/**
 * Verity balance-sheet score and sector-multiple model value, both computed from real statements.
 *
 *  - Score (0-10): profitability, operating strength, leverage and valuation versus the sector.
 *  - Model value: earnings per share x sector median P/E and book value per share x sector
 *    median P/B (averaged). It is a model estimate, not an analyst target price.
 *
 * Inputs are the statement figures in assets/data/fundamentals.json and the sector medians in
 * assets/data/sector-multiples.json (refresh with `npm run data:multiples`).
 */
(function () {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lin = (v, zero, full) => clamp((v - zero) / (full - zero), 0, 1) * 10;
  const fmt = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt1 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  let multiples = null;
  let loading = null;
  function ready() {
    if (!loading) {
      loading = fetch('/assets/data/sector-multiples.json')
        .then(r => (r.ok ? r.json() : null))
        .then(j => { multiples = j; return j; })
        .catch(() => null);
    }
    return loading;
  }

  function sectorMultiples(sector) {
    if (!multiples) return null;
    const s = multiples.sectors[sector];
    return s && s.n >= 5 ? { ...s, scope: sector } : { ...multiples.all, scope: 'Tüm BIST' };
  }

  /** Valuation versus the sector median: half the median -> 10, the median -> 6, twice the median -> 0. */
  const relative = ratio => (ratio <= 0.5 ? 10 : ratio <= 1 ? 10 - (ratio - 0.5) * 8 : lin(2 - ratio, 0, 1) * 0.6);

  /**
   * @param {object} d  { price, shares, equity, totalAssets, netDebt, revenue, ebitda, netIncome, sector }
   * @returns {{score:number, status:string, parts:object, model:object|null}}
   */
  function compute(d) {
    const financial = /finansal|banka/i.test(d.sector || '');
    const mcap = d.price * d.shares;
    const m = sectorMultiples(d.sector);

    const roe = d.equity > 0 ? d.netIncome / d.equity * 100 : null;
    const netMargin = d.revenue > 0 ? d.netIncome / d.revenue * 100 : null;
    const ebitdaMargin = d.revenue > 0 ? d.ebitda / d.revenue * 100 : null;
    const equityRatio = d.totalAssets > 0 ? d.equity / d.totalAssets * 100 : null;

    const avg = list => {
      const v = list.filter(x => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };

    // Every sub-score is also recorded here for the "why this score" panel
    const detail = {};
    const add = (part, label, value, score, rule) => {
      if (score !== null) (detail[part] = detail[part] || []).push({ label, value, score: Math.round(score * 10) / 10, rule });
      return score;
    };
    const pct = v => `%${fmt1.format(v)}`;

    const profitability = avg([
      add('Kârlılık', 'Özsermaye kârlılığı (ROE)', roe === null ? 'Hesaplanamadı' : pct(roe),
        roe === null ? (d.netIncome < 0 ? 0 : null) : (roe <= 0 ? 0 : lin(roe, 0, 30)),
        '%0 ve altı 0 puan, %30 ve üstü 10 puan'),
      add('Kârlılık', 'Net kâr marjı', netMargin === null ? '—' : pct(netMargin),
        netMargin === null ? null : (netMargin <= 0 ? 0 : lin(netMargin, 0, 15)),
        '%0 ve altı 0 puan, %15 ve üstü 10 puan')
    ]);

    const operating = financial || ebitdaMargin === null ? null
      : add('Faaliyet gücü', 'FAVÖK marjı', pct(ebitdaMargin), ebitdaMargin <= 0 ? 0 : lin(ebitdaMargin, 0, 25),
        '%0 ve altı 0 puan, %25 ve üstü 10 puan');

    let leverageDebt = null;
    if (!financial) {
      if (d.ebitda > 0) {
        leverageDebt = d.netDebt <= 0 ? 10 : lin(5 - d.netDebt / d.ebitda, 0, 5);
        add('Borç durumu', 'Net borç / FAVÖK', d.netDebt <= 0 ? 'Net nakit' : `${fmt1.format(d.netDebt / d.ebitda)}x`, leverageDebt,
          'Net nakit 10 puan, 0x 10 puan, 5x ve üstü 0 puan');
      } else {
        leverageDebt = d.netDebt <= 0 ? 4 : 0;
        add('Borç durumu', 'Net borç / FAVÖK', 'FAVÖK negatif', leverageDebt, 'FAVÖK negatifken net nakit 4 puan, net borç 0 puan');
      }
    }
    // Banks and insurers are leveraged by nature: neither debt/EBITDA nor equity/assets says much about them
    const leverage = financial ? null : avg([
      leverageDebt,
      equityRatio === null ? null : add('Borç durumu', 'Özsermaye / toplam aktif', pct(equityRatio), equityRatio <= 0 ? 0 : lin(equityRatio, 0, 50),
        '%0 ve altı 0 puan, %50 ve üstü 10 puan')
    ]);

    const pe = d.netIncome > 0 && mcap > 0 ? mcap / d.netIncome : null;
    const pb = d.equity > 0 && mcap > 0 ? mcap / d.equity : null;
    const peRule = 'Sektör medyanının yarısı ve altı 10 puan, medyanda 6 puan, iki katında 0 puan';
    let valuation = null;
    if (m) {
      valuation = avg([
        pe !== null && m.pe
          ? add('Değerleme', 'F/K', `${fmt.format(pe)} (sektör medyanı ${fmt.format(m.pe)})`, relative(pe / m.pe), peRule)
          : (d.netIncome <= 0 ? add('Değerleme', 'F/K', 'Net zarar', 0, 'Şirket zarar ediyorsa 0 puan') : null),
        pb !== null && m.pb
          ? add('Değerleme', 'PD/DD', `${fmt.format(pb)} (sektör medyanı ${fmt.format(m.pb)})`, relative(pb / m.pb), peRule)
          : null
      ]);
    }

    const weights = [['Kârlılık', profitability, 0.30], ['Faaliyet gücü', operating, 0.20], ['Borç durumu', leverage, 0.25], ['Değerleme', valuation, 0.25]];
    const used = weights.filter(w => w[1] !== null);
    const total = used.reduce((s, w) => s + w[2], 0);
    const score = used.length ? Math.round(used.reduce((s, w) => s + w[1] * w[2], 0) / total * 10) / 10 : null;

    const status = score === null ? 'Hesaplanamadı'
      : score >= 8 ? 'Güçlü Finansal Yapı'
      : score >= 6.5 ? 'Sağlıklı Finansal Yapı'
      : score >= 5 ? 'Orta Düzey Finansal Yapı'
      : score >= 3.5 ? 'Zayıf Finansal Yapı'
      : 'Riskli Finansal Yapı';

    // Model value from sector median multiples
    let model = null;
    if (m && d.shares > 0 && d.price > 0) {
      const eps = d.netIncome / d.shares;
      const bvps = d.equity / d.shares;
      const parts = [];
      if (eps > 0 && m.pe) parts.push(eps * m.pe);
      if (bvps > 0 && m.pb) parts.push(bvps * m.pb);
      if (parts.length) {
        // Inflation-adjusted earnings swing a lot; beyond double or half the price the estimate is capped
        const raw = parts.reduce((a, b) => a + b, 0) / parts.length;
        const value = clamp(raw, d.price * 0.5, d.price * 2);
        model = { value, upside: (value / d.price - 1) * 100, capped: value !== raw, pe: m.pe, pb: m.pb, n: m.n, scope: m.scope, basis: parts.length };
      }
    }

    return {
      score, status, model,
      parts: weights.filter(w => w[1] !== null).map(w => [w[0], Math.round(w[1] * 10) / 10]),
      breakdown: {
        parts: used.map(w => ({ name: w[0], score: Math.round(w[1] * 10) / 10, weight: w[2], share: w[2] / total, items: detail[w[0]] || [] })),
        skipped: weights.filter(w => w[1] === null).map(w => w[0]),
        financial,
        scope: m ? m.scope : null
      }
    };
  }

  /** Writes the result onto a financials object (see applyFundamentals in live-data.js). */
  function apply(fin, f) {
    const r = compute({
      price: fin.priceNum, shares: f.shares, equity: f.equity, totalAssets: f.totalAssets, netDebt: f.netDebt,
      revenue: f.ttm.revenue, ebitda: f.ttm.ebitda, netIncome: f.ttm.netIncome, sector: fin.sector
    });
    fin.score = r.score;
    fin.scoreStatus = r.status;
    fin.scoreParts = r.parts;
    fin.scoreBreakdown = r.score === null ? null : r.breakdown;
    fin.modelValue = r.model;
  }

  const set = (id, text) => { const n = document.getElementById(id); if (n) n.textContent = text; };

  /** Header score and model value boxes of the stock page. */
  function paintHeader(fin) {
    if (typeof appState !== 'undefined' && appState.currentStock !== fin.code) return;
    const real = fin.score !== null && fin.score !== undefined;
    paintBreakdown(fin);
    set('stockDetailScore', real ? fmt1.format(fin.score) : '—');
    set('stockDetailScoreStatus', real ? fin.scoreStatus : 'Bilanço verisi yok');
    set('stockDetailScorePercentile', real && fin.scoreParts
      ? fin.scoreParts.map(([k, v]) => `${k} ${fmt1.format(v)}`).join(' · ')
      : 'Skor için gerçek bilanço gerekir');

    const mv = fin.modelValue;
    const pot = document.getElementById('stockDetailPotential');
    set('stockDetailTargetPrice', mv ? `₺${fmt.format(mv.value)}` : '—');
    if (pot) {
      pot.textContent = mv ? `${mv.upside >= 0 ? '▲ +' : '▼ '}%${fmt1.format(Math.abs(mv.upside))}${mv.capped ? ' (sınır)' : ''}` : '';
      pot.className = `text-xs font-bold font-mono ${mv && mv.upside < 0 ? 'text-rose-400' : 'text-emerald-400'}`;
    }
    set('stockDetailConsensus', mv
      ? `${mv.scope} medyanı: F/K ${fmt1.format(mv.pe)} · PD/DD ${fmt.format(mv.pb)}`
      : 'Model için gerçek bilanço gerekir');
    const label = document.getElementById('stockDetailTargetLabel');
    if (label) label.textContent = 'MODEL DEĞER (SEKTÖR ÇARPANI)';
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Full class names, so Tailwind's build can see them
  const TONES = {
    good: { text: 'text-emerald-400', bg: 'bg-emerald-400' },
    mid: { text: 'text-amber-400', bg: 'bg-amber-400' },
    bad: { text: 'text-rose-400', bg: 'bg-rose-400' }
  };
  const tone = v => (v >= 7 ? TONES.good : v >= 4 ? TONES.mid : TONES.bad);

  /** "Why this score" panel: each component, its ratios, and how many points each earned. */
  function breakdownHtml(fin) {
    const b = fin.scoreBreakdown;
    const cards = b.parts.map(p => {
      const c = tone(p.score);
      const items = p.items.map(i => `
        <div class="flex items-start justify-between gap-3 py-1.5 border-t border-[#1A2540]/70">
          <div class="min-w-0">
            <div class="text-[11px] text-slate-300">${esc(i.label)}: <span class="font-mono text-white">${esc(i.value)}</span></div>
            <div class="text-[10px] text-slate-500">${esc(i.rule)}</div>
          </div>
          <div class="font-mono text-xs font-bold ${tone(i.score).text} whitespace-nowrap">${fmt1.format(i.score)}/10</div>
        </div>`).join('');
      return `
        <div class="p-3.5 rounded-xl bg-[#070B14] border border-[#1A2540]">
          <div class="flex items-baseline justify-between gap-2">
            <div class="text-xs font-bold text-white">${esc(p.name)}</div>
            <div class="text-[10px] font-mono text-slate-500">ağırlık %${Math.round(p.share * 100)}</div>
          </div>
          <div class="flex items-center gap-2 mt-2 mb-1.5">
            <div class="flex-1 h-1.5 rounded-full bg-[#121A2E] overflow-hidden"><div class="h-full rounded-full ${c.bg}" style="width:${p.score * 10}%"></div></div>
            <div class="font-mono text-sm font-bold ${c.text}">${fmt1.format(p.score)}</div>
          </div>
          ${items}
        </div>`;
    }).join('');

    const notes = [];
    if (b.financial) notes.push('Banka ve sigorta gibi finansal şirketlerde borçluluk doğası gereği yüksektir; bu yüzden faaliyet gücü ve borç durumu skora katılmaz.');
    else if (b.skipped.length) notes.push(`Veri eksik olduğu için ${b.skipped.join(', ')} skora katılmadı.`);
    if (b.scope) notes.push(`Değerleme "${b.scope}" medyan çarpanlarıyla karşılaştırılır.`);
    notes.push('Toplam skor, bileşen puanlarının ağırlıklı ortalamasıdır. Gerçek bilançodan hesaplanır, yatırım tavsiyesi değildir.');

    return `
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">${cards}</div>
      <div class="mt-3 space-y-1 text-[10px] text-slate-500">${notes.map(n => `<div>${esc(n)}</div>`).join('')}</div>`;
  }

  function paintBreakdown(fin) {
    const wrap = document.getElementById('scoreWhy');
    const box = document.getElementById('scoreBreakdown');
    if (!wrap || !box) return;
    const has = !!fin.scoreBreakdown;
    wrap.classList.toggle('hidden', !has);
    if (!has) { box.classList.add('hidden'); return; }
    box.innerHTML = breakdownHtml(fin);
  }

  function toggleBreakdown() {
    const box = document.getElementById('scoreBreakdown');
    const icon = document.getElementById('scoreWhyIcon');
    if (!box) return;
    const open = box.classList.toggle('hidden') === false;
    if (icon) icon.style.transform = open ? 'rotate(180deg)' : '';
  }

  window.VerityScore = { ready, compute, apply, paintHeader, toggleBreakdown };
})();
