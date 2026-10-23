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

  /* ---------- the portfolio's own history ---------- */

  const addDays = (s, n) => isoDay(dayMs(s) + n * DAY);

  /** Week keys (Mondays) from the week of `from` to the week of `to`, both included. */
  function weekRange(from, to) {
    const out = [];
    const end = weekKey(dayMs(to));
    for (let k = weekKey(dayMs(from)); k <= end; k = addDays(k, 7)) out.push(k);
    return out;
  }

  /**
   * Trades in date order with sales capped at the holding, each with the money it moved:
   * cash > 0 is money put in (a buy with its fee), cash < 0 money taken out (a sale net of fee).
   */
  function normalized(txs) {
    const held = {};
    return chronological(txs).map(t => {
      const h = held[t.code] || 0;
      const qty = t.type === 'buy' ? t.qty : Math.min(t.qty, h);
      held[t.code] = t.type === 'buy' ? h + qty : h - qty;
      const fee = t.fee > 0 ? t.fee : 0;
      return { ...t, qty, cash: t.type === 'buy' ? qty * t.price + fee : -(qty * t.price - fee) };
    }).filter(t => t.qty > 0);
  }

  /**
   * Weekly value of what the transactions built up, from the week of the first trade to `to`.
   * closes: { CODE: Map(week -> close) }. A week without a close carries the last one forward and
   * before a stock's first close its trade price stands in. A trade counts in the week it falls in.
   * -> { keys, value, invested (net money put in so far), flow (net money put in that week), buys }
   */
  function valueHistory(txs, closes, to) {
    const trades = normalized(txs);
    const out = { keys: [], value: [], invested: [], flow: [], buys: [] };
    if (!trades.length) return out;
    const qty = {}, last = {};
    let i = 0, invested = 0;
    for (const k of weekRange(trades[0].date, to)) {
      const end = addDays(k, 6);
      let flow = 0, buys = 0;
      while (i < trades.length && trades[i].date <= end) {
        const t = trades[i++];
        qty[t.code] = (qty[t.code] || 0) + (t.type === 'buy' ? t.qty : -t.qty);
        if (last[t.code] == null) last[t.code] = t.price;
        flow += t.cash;
        if (t.cash > 0) buys += t.cash;
      }
      invested += flow;
      let v = 0;
      Object.keys(qty).forEach(code => {
        const c = closes[code] && closes[code].get(k);
        if (c > 0) last[code] = c;
        if (qty[code] > 1e-9 && last[code] > 0) v += qty[code] * last[code];
      });
      out.keys.push(k); out.value.push(v); out.invested.push(invested); out.flow.push(flow); out.buys.push(buys);
    }
    return out;
  }

  /**
   * Time-weighted return index (100 at the start): each week's return leaves out the money put in
   * or taken out, so deposits do not count as performance. Buys are treated as made at the start
   * of their week and sales at its end: r = (V - V_prev - flow) / (V_prev + buys).
   */
  function twrIndex(h) {
    const out = { keys: [], values: [] };
    let level = 100, prev = 0;
    h.keys.forEach((k, i) => {
      const v = h.value[i];
      const base = prev + h.buys[i];
      if (base > 0) level *= 1 + (v - prev - h.flow[i]) / base;
      if (base > 0 || v > 0) { out.keys.push(k); out.values.push(level); }
      prev = v;
    });
    return out;
  }

  /**
   * Annualised money-weighted return (XIRR) of dated flows [{ date, amount }] seen from the
   * investor: money put in negative, money taken out and the final value positive. null when the
   * flows do not have both signs. Solved by bisection (NPV falls as the rate rises).
   */
  function xirr(flows) {
    const f = flows.filter(x => Number.isFinite(x.amount) && x.amount !== 0);
    if (!f.some(x => x.amount < 0) || !f.some(x => x.amount > 0)) return null;
    const t0 = Math.min(...f.map(x => dayMs(x.date)));
    const yrs = f.map(x => (dayMs(x.date) - t0) / (365 * DAY));
    const npv = r => f.reduce((s, x, i) => s + x.amount / (1 + r) ** yrs[i], 0);
    let lo = -0.9999, hi = 1;
    while (npv(hi) > 0 && hi < 1e6) hi *= 4;
    if (npv(lo) < 0 || npv(hi) > 0) return null;
    for (let n = 0; n < 200; n++) {
      const mid = (lo + hi) / 2;
      if (npv(mid) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2 * 100;
  }

  /** Investor-side flows of the trades plus dividends received and the value today. */
  function cashFlows(txs, dividends, value, today) {
    const f = normalized(txs).map(t => ({ date: t.date, amount: -t.cash }));
    dividends.forEach(d => f.push({ date: d.date, amount: d.cash }));
    if (value > 0) f.push({ date: today, amount: value });
    return f.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Latest value of a weekly Map at or before each key (a sorted walk, no lookups per key). */
  function carried(map, keys) {
    const ks = [...map.keys()].sort();
    let j = 0, last = null;
    return keys.map(k => {
      while (j < ks.length && ks[j] <= k) { last = map.get(ks[j]); j++; }
      return last;
    });
  }

  /**
   * The same money moved into a benchmark instead: each buy's cost buys it at that week's price and
   * each sale's proceeds sell it (never below zero units). price: Map(week -> price), keys: the weeks
   * of valueHistory. -> values in TL on those weeks (null before the benchmark has a price).
   */
  function replay(txs, price, keys) {
    const trades = normalized(txs);
    const p = carried(price, keys);
    let units = 0, i = 0;
    return keys.map((k, w) => {
      const end = addDays(k, 6);
      while (i < trades.length && trades[i].date <= end) {
        const t = trades[i++];
        if (p[w] > 0) units = Math.max(0, units + t.cash / p[w]);
      }
      return p[w] > 0 ? units * p[w] : null;
    });
  }

  /** Multiplies two weekly Maps on their common weeks (e.g. gold in USD x USD/TRY = gold in TL). */
  function times(a, b, factor = 1) {
    const m = new Map();
    a.forEach((v, k) => { const w = b.get(k); if (v > 0 && w > 0) m.set(k, v * w * factor); });
    return m;
  }

  /* ---------- risk ---------- */

  const logReturns = (map, keys) => keys.slice(1).map((k, i) => Math.log(map.get(k) / map.get(keys[i])));

  function pearson(a, b) {
    const n = a.length;
    if (n < 3) return null;
    const ma = sum(a) / n, mb = sum(b) / n;
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < n; i++) { cov += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
    return va && vb ? cov / Math.sqrt(va * vb) : null;
  }

  /**
   * Correlations of weekly log returns over the last `weeks` weeks every series has a close in.
   * maps: [Map(week -> close)] -> { values: matrix, weeks: number of returns used }
   */
  function correlations(maps, weeks = 104) {
    const common = [...maps[0].keys()].filter(k => maps.every(m => m.get(k) > 0)).sort().slice(-(weeks + 1));
    const rets = maps.map(m => logReturns(m, common));
    return { values: rets.map((a, i) => rets.map((b, j) => (i === j ? 1 : pearson(a, b)))), weeks: Math.max(0, common.length - 1) };
  }

  /**
   * Beta and correlation of an index against a benchmark, weekly, over the last `weeks` common
   * weeks; volatility (annualised) and deepest fall of the index over the same window.
   */
  function riskVs(index, bench, weeks = 52) {
    const a = new Map(index.keys.map((k, i) => [k, index.values[i]]));
    const common = index.keys.filter(k => bench.get(k) > 0).slice(-(weeks + 1));
    if (common.length < 12) return null;
    const ra = logReturns(a, common), rb = logReturns(bench, common);
    const mb = sum(rb) / rb.length, ma = sum(ra) / ra.length;
    let cov = 0, vb = 0;
    rb.forEach((x, i) => { cov += (ra[i] - ma) * (x - mb); vb += (x - mb) ** 2; });
    const sd = Math.sqrt(sum(ra.map(r => (r - ma) ** 2)) / Math.max(1, ra.length - 1));
    let peak = -Infinity, dd = 0;
    common.forEach(k => { const v = a.get(k); peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); });
    return { beta: vb ? cov / vb : null, corr: pearson(ra, rb), vol: sd * Math.sqrt(52) * 100, maxDD: dd * 100, weeks: ra.length };
  }

  /** Calendar-month returns of a weekly index, each week placed in the month of its Friday. */
  function monthlyReturns(index) {
    const last = new Map();
    index.keys.forEach((k, i) => last.set(addDays(k, 4).slice(0, 7), index.values[i]));
    const months = [...last.keys()].sort();
    const out = {};
    months.forEach((m, i) => {
      if (!i) return;
      const [y, mo] = m.split('-');
      (out[y] = out[y] || {})[mo] = (last.get(m) / last.get(months[i - 1]) - 1) * 100;
    });
    return out;
  }

  /* ---------- planning ---------- */

  /**
   * Trades that bring the targeted holdings to their target weights.
   * rows: [{ code, value }], targets: { CODE: % }, prices: { CODE: price }, cash: money to add,
   * mode: 'full' (buy and sell) or 'buy' (only buy, with the new money).
   * Holdings without a target keep their value; targets are scaled among themselves to the rest.
   * Share counts are whole and rounded toward zero, so the TL amounts are what can be traded.
   */
  function rebalance(rows, targets, prices, cash = 0, mode = 'full') {
    const value = {};
    rows.forEach(r => { value[r.code] = r.value > 0 ? r.value : 0; });
    const codes = [...new Set([...Object.keys(value), ...Object.keys(targets).filter(c => targets[c] > 0)])];
    const tsum = sum(codes.map(c => (targets[c] > 0 ? targets[c] : 0)));
    const free = sum(codes.filter(c => !(targets[c] > 0)).map(c => value[c] || 0));
    const total = sum(Object.values(value)) + Math.max(0, cash);
    const pool = total - free;
    let list = codes.map(c => {
      const t = targets[c] > 0 ? targets[c] : null;
      const v = value[c] || 0;
      const desired = t && tsum > 0 ? pool * t / tsum : v;
      return { code: c, value: v, price: prices[c] > 0 ? prices[c] : null, target: t, desired, gap: desired - v };
    });
    if (mode === 'buy') {
      const need = sum(list.map(r => Math.max(0, r.gap)));
      const scale = need > cash ? cash / need : 1;
      list = list.map(r => ({ ...r, want: Math.max(0, r.gap) * scale }));
    } else {
      list = list.map(r => ({ ...r, want: r.target ? r.gap : 0 }));
    }
    list = list.map(r => {
      const shares = r.price ? Math.trunc(r.want / r.price) : 0;
      return { ...r, shares, trade: shares * (r.price || 0), weightNow: total - cash > 0 ? r.value / (total - Math.max(0, cash)) * 100 : 0 };
    });
    const buy = sum(list.filter(r => r.trade > 0).map(r => r.trade));
    const sell = sum(list.filter(r => r.trade < 0).map(r => -r.trade));
    list.forEach(r => { r.weightAfter = total > 0 ? (r.value + r.trade) / total * 100 : 0; });
    return { rows: list.sort((a, b) => (b.target || 0) - (a.target || 0) || b.value - a.value), total, buy, sell, left: Math.max(0, cash) - buy + sell, tsum };
  }

  /**
   * Monthly-compounding plan. p: { now, monthly, rate: annual %, years, target (in today's money),
   * inflation: annual % }. -> nominal and today's-money value at the end, the target in money of
   * that day, the monthly saving that reaches it, months until it is reached and a yearly path.
   */
  function goalPlan(p) {
    const n = Math.max(1, Math.round(p.years * 12));
    const r = (1 + (p.rate || 0) / 100) ** (1 / 12) - 1;
    const infl = (1 + (p.inflation || 0) / 100) ** (1 / 12);
    const g = k => (1 + r) ** k;
    const fvAt = k => p.now * g(k) + p.monthly * (Math.abs(r) < 1e-12 ? k : (g(k) - 1) / r);
    const targetAt = k => p.target * infl ** k;
    const ann = Math.abs(r) < 1e-12 ? n : (g(n) - 1) / r;
    const need = Math.max(0, (targetAt(n) - p.now * g(n)) / ann);
    let reach = null;
    for (let k = 0; k <= 600; k++) if (fvAt(k) >= targetAt(k)) { reach = k; break; }
    const path = [];
    for (let y = 0; y <= Math.ceil(n / 12); y++) {
      const k = Math.min(n, y * 12);
      path.push({ year: y, value: fvAt(k), paid: p.now + p.monthly * k, target: targetAt(k), real: fvAt(k) / infl ** k });
      if (k === n) break;
    }
    return { months: n, fv: fvAt(n), real: fvAt(n) / infl ** n, targetNominal: targetAt(n), need, reach, path };
  }

  /**
   * Next 12 months' cash dividends if each holding pays what it paid a year earlier, in the same
   * month. -> { months: [{ key: 'YYYY-MM', total, items }], total }
   */
  function dividendForecast(rows, divs, today) {
    const from = isoDay(dayMs(today) - 365 * DAY);
    const start = today.slice(0, 7);
    const keys = [];
    for (let i = 0; i < 12; i++) {
      const [y, m] = start.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + i, 1));
      keys.push(isoDay(d).slice(0, 7));
    }
    const months = keys.map(key => ({ key, total: 0, items: [] }));
    rows.forEach(r => (divs[r.code] || []).forEach(([date, amount]) => {
      if (!(date > from && date <= today)) return;
      const next = `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
      const slot = months.find(x => x.key === next.slice(0, 7));
      if (!slot || next <= today) return;
      slot.items.push({ code: r.code, date: next, amount, cash: amount * r.qty });
      slot.total += amount * r.qty;
    }));
    return { months, total: sum(months.map(x => x.total)) };
  }

  /* ---------- CSV import ---------- */

  const TYPES = { alis: 'buy', alış: 'buy', al: 'buy', buy: 'buy', a: 'buy', satis: 'sell', satış: 'sell', sat: 'sell', sell: 'sell', s: 'sell' };

  /**
   * Transactions from CSV text: date;type;code;qty;price[;fee], header row optional, separated by
   * ";", tab or "," (with "," numbers must use a decimal point). Dates as YYYY-MM-DD or DD.MM.YYYY.
   * -> { txs, errors: [line numbers that could not be read] }
   */
  function parseCsv(text) {
    const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
    const txs = [], errors = [];
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const sep = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
      const c = line.split(sep).map(s => s.trim().replace(/^"|"$/g, ''));
      let date = c[0];
      const dm = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(date);
      if (dm) date = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
      const type = TYPES[TR_LOWER(c[1] || '')];
      const code = (c[2] || '').toUpperCase().replace(/İ/g, 'I');
      const n = s => (sep === ',' ? Number(s) : num(s));
      const qty = n(c[3]), price = n((c[4] || '').replace(/^₺/, '')), fee = c[5] ? n(c[5]) : 0;
      if (!isDay(date) || !type || !isCode(code) || !(qty > 0) || !(price > 0) || !(fee >= 0)) {
        if (i > 0 || /\d/.test(c[0] || '')) errors.push(i + 1);   // a header line is not an error
        return;
      }
      txs.push({ date, type, code, qty, price, fee });
    });
    return { txs, errors };
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
    stop: 'stop', zararkes: 'stop', 'zarar-kes': 'stop',
    hedef: 'target', karal: 'target', kâral: 'target', 'kâr-al': 'target', 'kar-al': 'target',
    ağırlık: 'weight', agirlik: 'weight', pay: 'weight',
    nakit: 'cash', cash: 'cash',
    günlük: 'journal', gunluk: 'journal', journal: 'journal',
    gizle: 'privacy', göster: 'privacy', goster: 'privacy',
    rapor: 'report', yazdır: 'report', yazdir: 'report',
    geri: 'undo', undo: 'undo',
    performans: 'tab:performance', risk: 'tab:performance', plan: 'tab:plan', gündem: 'tab:news', gundem: 'tab:news',
    sektör: 'tab:sectors', sektor: 'tab:sectors', geçmiş: 'tab:activity', gecmis: 'tab:activity',
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
    if (action === 'stop' || action === 'target') {
      const ex = action === 'stop' ? 'stop THYAO 250' : 'hedef THYAO 400';
      if (!isCode(code)) return { ok: false, error: `Hisse kodu eksik (ör. ${ex}).` };
      const raw = TR_LOWER(args[1] || '');
      if (raw === 'sil' || raw === '0') return { ok: true, action, code, price: null };
      const price = num(raw.replace(/^₺/, ''));
      if (!(price > 0)) return { ok: false, error: `Fiyat eksik (ör. ${ex}; kaldırmak için “sil”).` };
      return { ok: true, action, code, price };
    }
    if (action === 'weight') {
      if (!isCode(code)) return { ok: false, error: 'Hisse kodu eksik (ör. ağırlık THYAO 20).' };
      const w = num((args[1] || '').replace(/^%|%$/g, ''));
      if (!(w >= 0 && w <= 100)) return { ok: false, error: 'Ağırlık 0 ile 100 arasında olmalı (ör. ağırlık THYAO 20).' };
      return { ok: true, action, code, weight: w };
    }
    if (action === 'cash') {
      const raw = (args[0] || '').replace(/^₺/, '');
      const delta = /^[+-]/.test(raw);
      const amount = num(raw.replace(/^\+/, ''));
      if (!Number.isFinite(amount) || (!delta && amount < 0)) return { ok: false, error: 'Tutar yazın (ör. nakit 5000, nakit +1000, nakit -500).' };
      return { ok: true, action, amount, delta };
    }
    if (action === 'journal') {
      const body = args.join(' ').trim();
      if (!body) return { ok: false, error: 'Günlüğe yazılacak metni ekleyin (ör. günlük faiz kararı sonrası bekle).' };
      // A leading code must be typed in capitals ("günlük THYAO ..."), so "günlük piyasa sakin" stays text
      const c = isCode(args[0]) && args.length > 1 ? args[0] : null;
      return { ok: true, action, code: c, text: c ? args.slice(1).join(' ') : body };
    }
    if (action === 'privacy') return { ok: true, action, hide: word === 'gizle' ? true : word === 'göster' || word === 'goster' ? false : null };
    if (action.startsWith('tab:')) return { ok: true, action: 'tab', tab: action.slice(4) };
    if (action === 'portfolio') return { ok: true, action, name: args.join(' ').trim() || null };
    return { ok: true, action };
  }

  const Portfolio = {
    median, positions, heldOn, valuate, groupWeights, concentration, lookThrough, weightedAvg,
    dividendsReceived, trailingIncome, weekKey, weekly, blendIndex, deflate, seriesStats,
    sectorFundamentals, sectorBreadth, parseCommand, parseNumber: num,
    weekRange, normalized, valueHistory, twrIndex, xirr, cashFlows, carried, replay, times,
    correlations, riskVs, monthlyReturns, rebalance, goalPlan, dividendForecast, parseCsv
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Portfolio;
  else root.Portfolio = Portfolio;
})(typeof window !== 'undefined' ? window : globalThis);
