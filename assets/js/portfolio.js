/**
 * Pure portfolio calculations shared by the profile page (assets/js/profile.js) and the tests
 * (test/portfolio.test.mjs). No DOM, no fetch, no storage.
 *
 * A transaction: { id, type: 'buy' | 'sell', code, qty, price, fee, date: 'YYYY-MM-DD' }.
 * Positions use the average-cost method: a sale takes shares out at the average cost and books
 * the difference as realized profit; it does not change the average cost of what is left.
 */
(function (root) {
  const DAY = 864e5;
  const WEEK = 7 * DAY;
  const TR = 3 * 3600 * 1000;   // Istanbul is UTC+3 all year
  const isoDay = t => new Date(t).toISOString().slice(0, 10);
  const dayMs = s => Date.parse(`${s}T00:00:00Z`);
  const sum = list => list.reduce((s, x) => s + x, 0);

  function median(list) {
    const v = list.filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  /** Oldest first; same-day trades keep the order they were entered in (seq). */
  const chronological = txs => [...txs].sort((a, b) => a.date.localeCompare(b.date) || (a.seq || 0) - (b.seq || 0));

  /**
   * One row per code that was ever traded: { code, qty, cost, avgCost, realized, fees, first, trades }.
   * cost is what the shares still held cost (fees included). A sale larger than the holding is
   * capped at the holding (the form rejects it; this keeps old data from going negative).
   */
  function positions(txs) {
    const by = new Map();
    for (const t of chronological(txs)) {
      const p = by.get(t.code) || { code: t.code, qty: 0, cost: 0, realized: 0, fees: 0, first: t.date, trades: 0 };
      const fee = t.fee > 0 ? t.fee : 0;
      if (t.type === 'buy') {
        if (p.qty === 0) p.first = t.date;   // a holding that was sold out and bought again starts over
        p.qty += t.qty;
        p.cost += t.qty * t.price + fee;
      } else {
        const q = Math.min(t.qty, p.qty);
        const avg = p.qty > 0 ? p.cost / p.qty : 0;
        p.realized += q * t.price - fee - q * avg;
        p.cost -= q * avg;
        p.qty -= q;
        if (p.qty < 1e-9) { p.qty = 0; p.cost = 0; }
      }
      p.fees += fee;
      p.trades += 1;
      by.set(t.code, p);
    }
    return [...by.values()].map(p => ({ ...p, avgCost: p.qty > 0 ? p.cost / p.qty : null }));
  }

  /** Shares of code held at the end of the given day. */
  function heldOn(txs, code, day) {
    let qty = 0;
    for (const t of chronological(txs)) {
      if (t.code !== code || t.date > day) continue;
      qty = t.type === 'buy' ? qty + t.qty : Math.max(0, qty - t.qty);
    }
    return qty;
  }

  /**
   * Open positions at the given prices ({ CODE: price }): value, unrealized profit and weight.
   * Positions without a price are listed with null value and left out of the totals.
   */
  function valuate(pos, prices) {
    const rows = pos.filter(p => p.qty > 0).map(p => {
      const price = prices[p.code] > 0 ? prices[p.code] : null;
      const value = price == null ? null : p.qty * price;
      return {
        ...p, price, value,
        pnl: value == null ? null : value - p.cost,
        pnlPct: value == null || !(p.cost > 0) ? null : (value / p.cost - 1) * 100
      };
    });
    const priced = rows.filter(r => r.value != null);
    const total = sum(priced.map(r => r.value));
    const cost = sum(priced.map(r => r.cost));
    rows.forEach(r => { r.weight = r.value != null && total > 0 ? r.value / total * 100 : null; });
    rows.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    return {
      rows, total, cost,
      pnl: total - cost,
      pnlPct: cost > 0 ? (total / cost - 1) * 100 : null,
      realized: sum(pos.map(p => p.realized)),
      unpriced: rows.filter(r => r.value == null).map(r => r.code)
    };
  }

  /** Weight (%) per group, largest first: [{ key, value, weight, codes }]. */
  function groupWeights(rows, keyOf) {
    const by = new Map();
    rows.filter(r => r.value > 0).forEach(r => {
      const k = keyOf(r) || 'Diğer';
      const g = by.get(k) || { key: k, value: 0, codes: [] };
      g.value += r.value;
      g.codes.push(r.code);
      by.set(k, g);
    });
    const total = sum([...by.values()].map(g => g.value));
    return [...by.values()].map(g => ({ ...g, weight: total > 0 ? g.value / total * 100 : 0 })).sort((a, b) => b.value - a.value);
  }

  /**
   * Concentration of a set of weights (%): Herfindahl index (0-1), the effective number of equal
   * holdings it corresponds to (1 / HHI) and the largest weight.
   */
  function concentration(weights) {
    const w = weights.filter(x => x > 0).map(x => x / 100);
    const hhi = sum(w.map(x => x * x));
    return { hhi, effective: hhi > 0 ? 1 / hhi : 0, largest: w.length ? Math.max(...w) * 100 : 0 };
  }

  /**
   * Look-through multiple of a portfolio: total value over the earnings (or book value) its
   * holdings stand for. items: [{ value, multiple }]; a multiple <= 0 or missing is left out and
   * reported through coverage (% of value that had a multiple).
   */
  function lookThrough(items) {
    const all = sum(items.filter(i => i.value > 0).map(i => i.value));
    const ok = items.filter(i => i.value > 0 && i.multiple > 0);
    const value = sum(ok.map(i => i.value));
    const base = sum(ok.map(i => i.value / i.multiple));
    return { multiple: base > 0 ? value / base : null, coverage: all > 0 ? value / all * 100 : 0 };
  }

  /** Value-weighted average of a field: items [{ value, x }], missing x left out. */
  function weightedAvg(items) {
    const ok = items.filter(i => i.value > 0 && Number.isFinite(i.x));
    const w = sum(ok.map(i => i.value));
    return w > 0 ? sum(ok.map(i => i.value * i.x)) / w : null;
  }

  /**
   * Cash dividends the transactions were entitled to: shares held at the end of the day before
   * each ex-date times the amount per share. divs: { CODE: [[YYYY-MM-DD, amount], ...] }.
   */
  function dividendsReceived(txs, divs, today) {
    const items = [];
    const codes = [...new Set(txs.map(t => t.code))];
    codes.forEach(code => {
      (divs[code] || []).forEach(([date, amount]) => {
        if (date > today) return;
        const qty = heldOn(txs, code, isoDay(dayMs(date) - DAY));
        if (qty > 0) items.push({ code, date, amount, qty, cash: qty * amount });
      });
    });
    items.sort((a, b) => b.date.localeCompare(a.date));
    return { total: sum(items.map(i => i.cash)), items };
  }

  /** Cash the current holdings would have received over the last 12 months: { total, byCode }. */
  function trailingIncome(rows, divs, today) {
    const from = isoDay(dayMs(today) - 365 * DAY);
    const byCode = {};
    rows.forEach(r => {
      const perShare = sum((divs[r.code] || []).filter(([d]) => d > from && d <= today).map(([, a]) => a));
      if (perShare > 0) byCode[r.code] = perShare * r.qty;
    });
    return { total: sum(Object.values(byCode)), byCode };
  }

  /* ---------- long-term series ---------- */

  /** Monday (Istanbul calendar) of the week a timestamp falls in, as YYYY-MM-DD. */
  function weekKey(ms) {
    const d = new Date(ms + TR);
    const back = (d.getUTCDay() + 6) % 7;
    return isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - back * DAY);
  }

  /** /api/history arrays ({ t, c }) -> Map(week -> last close of that week). */
  function weekly(series) {
    const m = new Map();
    if (!series || !Array.isArray(series.t)) return m;
    series.t.forEach((t, i) => { if (series.c[i] > 0) m.set(weekKey(t), series.c[i]); });
    return m;
  }

  /**
   * Weekly index of several series, rebased to 100 at its first week. Each week moves by the
   * weighted average return of the members that have a close in that week and the week before,
   * so members that listed later join when their history starts (weights renormalised).
   * maps: [Map(week -> close)], weights: same length or omitted (equal weight).
   */
  function blendIndex(maps, weights) {
    const w = weights || maps.map(() => 1);
    const keys = [...new Set(maps.flatMap(m => [...m.keys()]))].sort();
    const out = { keys: [], values: [] };
    let level = 100, prev = null;
    for (const k of keys) {
      if (prev == null) {
        if (maps.some(m => m.has(k))) { out.keys.push(k); out.values.push(level); prev = k; }
        continue;
      }
      let ws = 0, rs = 0;
      maps.forEach((m, i) => {
        const a = m.get(prev), b = m.get(k);
        if (a > 0 && b > 0 && w[i] > 0) { ws += w[i]; rs += w[i] * (b / a - 1); }
      });
      if (ws > 0) level *= 1 + rs / ws;
      out.keys.push(k);
      out.values.push(level);
      prev = k;
    }
    return out;
  }

  /** Divides one weekly series by another (e.g. a TL index by USD/TRY), rebased to 100. */
  function deflate(index, fx) {
    const out = { keys: [], values: [] };
    let base = null;
    index.keys.forEach((k, i) => {
      const r = fx.get(k);
      if (!(r > 0)) return;
      const v = index.values[i] / r;
      if (base == null) base = v;
      out.keys.push(k);
      out.values.push(v / base * 100);
    });
    return out;
  }

  /**
   * Returns over 1, 3, 5 and 10 years, annual growth over the whole window, annualised volatility of
   * weekly returns and the deepest fall from a peak. A period longer than the history is null.
   */
  function seriesStats(index) {
    const { keys, values } = index;
    const n = values.length;
    if (n < 2) return null;
    const last = values[n - 1], lastT = dayMs(keys[n - 1]);
    const back = years => {
      const target = lastT - years * 365.25 * DAY;
      if (dayMs(keys[0]) > target + 2 * WEEK) return null;
      let i = 0;
      while (i < n - 1 && dayMs(keys[i + 1]) <= target) i++;
      return (last / values[i] - 1) * 100;
    };
    const span = (lastT - dayMs(keys[0])) / (365.25 * DAY);
    const rets = [];
    for (let i = 1; i < n; i++) rets.push(Math.log(values[i] / values[i - 1]));
    const mean = sum(rets) / rets.length;
    const sd = Math.sqrt(sum(rets.map(r => (r - mean) ** 2)) / Math.max(1, rets.length - 1));
    let peak = values[0], dd = 0;
    values.forEach(v => { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); });
    return {
      from: keys[0], to: keys[n - 1], years: span,
      r1: back(1), r3: back(3), r5: back(5), r10: back(10),
      cagr: span >= 0.9 ? ((last / values[0]) ** (1 / span) - 1) * 100 : null,
      vol: sd * Math.sqrt(52) * 100,
      maxDD: dd * 100
    };
  }

  /* ---------- sector snapshot ---------- */

  /**
   * Medians over a sector's companies. rows: [{ equity, netIncome, revenue, ebitda, netDebt }]
   * (TTM statement figures). Ratios that cannot be computed for a company are left out.
   */
  function sectorFundamentals(rows) {
    return {
      n: rows.length,
      roe: median(rows.map(r => (r.equity > 0 ? r.netIncome / r.equity * 100 : NaN))),
      netMargin: median(rows.map(r => (r.revenue > 0 ? r.netIncome / r.revenue * 100 : NaN))),
      ebitdaMargin: median(rows.map(r => (r.revenue > 0 ? r.ebitda / r.revenue * 100 : NaN))),
      netDebtEbitda: median(rows.map(r => (r.ebitda > 0 ? r.netDebt / r.ebitda : NaN))),
      profitable: rows.length ? rows.filter(r => r.netIncome > 0).length / rows.length * 100 : null
    };
  }

  /**
   * Market breadth of a sector from the daily technical snapshot. rows: [{ m3, s200, hi52 }]
   * where s200 is the distance to the 200-day average (%) and hi52 the distance to the 52-week high.
   */
  function sectorBreadth(rows) {
    const with200 = rows.filter(r => Number.isFinite(r.s200));
    return {
      n: rows.length,
      above200: with200.length ? with200.filter(r => r.s200 > 0).length / with200.length * 100 : null,
      m3: median(rows.map(r => r.m3)),
      hi52: median(rows.map(r => r.hi52))
    };
  }

  /* ---------- commands ---------- */

  const TR_LOWER = s => s.toLocaleLowerCase('tr-TR');
  const num = s => {
    if (s == null || s === '') return null;
    // 1.234,56 and 1234.56 both read as 1234.56
    const t = /,\d{1,}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    const v = Number(t);
    return Number.isFinite(v) ? v : NaN;
  };
  const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dayMs(s));
  const isCode = s => /^[A-Z0-9]{3,6}$/.test(s);

  /** Command words and the action they stand for (Turkish, with ASCII spellings). */
  const VERBS = {
    al: 'buy', alış: 'buy', alis: 'buy', buy: 'buy',
    sat: 'sell', satış: 'sell', satis: 'sell', sell: 'sell',
    izle: 'watch', watch: 'watch',
    alarm: 'alarm',
    aç: 'open', ac: 'open', git: 'open', hisse: 'open', open: 'open',
    bilanço: 'balance', bilanco: 'balance',
    kıyas: 'compare', kiyas: 'compare', karşılaştır: 'compare', karsilastir: 'compare',
    not: 'note',
    temettü: 'dividends', temettu: 'dividends',
    portföy: 'portfolio', portfoy: 'portfolio', özet: 'portfolio', ozet: 'portfolio',
    yardım: 'help', yardim: 'help', help: 'help', '?': 'help'
  };

  /**
   * Parses one command line into { ok, action, ... } or { ok: false, error }.
   *   al THYAO 100 [312,50] [2026-10-01]   sat THYAO 50 [330]   izle ASELS   alarm TUPRS 180
   *   aç FROTO   bilanço BIMAS   kıyas EREGL KRDMD   not THYAO <metin>   temettü   portföy   yardım
   * A bare code (THYAO) opens the stock. Prices left out are filled in by the caller.
   */
  function parseCommand(line) {
    const text = String(line || '').trim().replace(/^\//, '');
    if (!text) return { ok: false, error: 'Komut boş.' };
    const parts = text.split(/\s+/);
    const word = TR_LOWER(parts[0]);
    // Codes are ASCII: "bimas" is BIMAS, not the Turkish-locale BİMAS
    const up = s => (s || '').toUpperCase().replace(/İ/g, 'I');
    const action = VERBS[word] || (isCode(up(parts[0])) && parts.length === 1 ? 'open' : null);
    if (!action) return { ok: false, error: `“${parts[0]}” tanınmayan bir komut. “yardım” yazarak komutları görebilirsiniz.` };
    const args = VERBS[word] ? parts.slice(1) : parts;
    const code = up(args[0]);

    if (action === 'buy' || action === 'sell') {
      if (!isCode(code)) return { ok: false, error: 'Hisse kodu eksik veya hatalı (ör. al THYAO 100).' };
      const qty = num(args[1]);
      if (!(qty > 0)) return { ok: false, error: 'Adet pozitif bir sayı olmalı (ör. al THYAO 100).' };
      let price = null, date = null;
      for (const a of args.slice(2)) {
        if (isDay(a)) date = a;
        else if (price == null) {
          price = num(a.replace(/^₺/, ''));
          if (!(price > 0)) return { ok: false, error: `Fiyat anlaşılmadı: “${a}”.` };
        }
      }
      return { ok: true, action, code, qty, price, date };
    }
    if (action === 'alarm') {
      if (!isCode(code)) return { ok: false, error: 'Hisse kodu eksik (ör. alarm THYAO 320).' };
      const target = num((args[1] || '').replace(/^₺/, ''));
      if (!(target > 0)) return { ok: false, error: 'Hedef fiyat eksik (ör. alarm THYAO 320).' };
      return { ok: true, action, code, target };
    }
    if (action === 'compare') {
      const codes = args.map(up).filter(isCode).slice(0, 3);
      if (!codes.length) return { ok: false, error: 'En az bir hisse kodu yazın (ör. kıyas EREGL KRDMD).' };
      return { ok: true, action, codes };
    }
    if (action === 'note') {
      if (!isCode(code)) return { ok: false, error: 'Hisse kodu eksik (ör. not THYAO uzun vade, filo büyümesi).' };
      return { ok: true, action, code, text: args.slice(1).join(' ') };
    }
    if (action === 'watch' || action === 'open' || action === 'balance') {
      if (!isCode(code)) return { ok: false, error: 'Hisse kodu eksik veya hatalı.' };
      return { ok: true, action, code };
    }
    return { ok: true, action };
  }

  const Portfolio = {
    median, positions, heldOn, valuate, groupWeights, concentration, lookThrough, weightedAvg,
    dividendsReceived, trailingIncome, weekKey, weekly, blendIndex, deflate, seriesStats,
    sectorFundamentals, sectorBreadth, parseCommand, parseNumber: num
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Portfolio;
  else root.Portfolio = Portfolio;
})(typeof window !== 'undefined' ? window : globalThis);
