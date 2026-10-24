/**
 * Strategy backtester shared by the page (backtest-ui.js) and the tests (test/backtest.test.mjs).
 * No DOM, no fetch.
 *
 * Long-only, one position at a time, all capital in. A signal is read on a bar's close and
 * filled at the next bar's open, so no bar trades on information it did not have yet. Stop-loss
 * and take-profit are checked inside each bar with its low/high (a gap past the level fills at
 * the open; when both levels sit inside the same bar the stop is assumed to come first).
 * Commission is charged on both sides. No slippage, no taxes, no dividends.
 *
 * Bars: [{ time (seconds), open, high, low, close }], oldest first.
 */
(function (root) {
  const Ind = root.Ind || (typeof require === 'function' ? require('./indicators.js') : null);
  const Formula = root.Formula || (typeof require === 'function' ? require('./formula.js') : null);

  const rollingMax = (a, n) => a.map((_, i) => (i < n ? null : Math.max(...a.slice(i - n, i))));
  const rollingMin = (a, n) => a.map((_, i) => (i < n ? null : Math.min(...a.slice(i - n, i))));
  const ok = (...vals) => vals.every(v => v != null && Number.isFinite(v));
  /** First index where every series has a value and so does the bar before it. */
  const warmupOf = (...series) => {
    const n = series[0].length;
    for (let i = 1; i < n; i++) if (series.every(s => ok(s[i], s[i - 1]))) return i;
    return n;
  };

  /**
   * Each strategy turns bars into enter/exit flags per bar. `params` lists the inputs the page
   * shows, with defaults and limits; `build` gets the numbers already clamped to those limits.
   */
  const STRATEGIES = {
    sma_cross: {
      label: 'SMA kesişimi',
      desc: 'Hızlı ortalama yavaş ortalamayı yukarı kesince al, aşağı kesince sat.',
      params: [{ key: 'fast', label: 'Hızlı SMA', def: 20, min: 2, max: 200 }, { key: 'slow', label: 'Yavaş SMA', def: 50, min: 3, max: 400 }],
      build(b, p) {
        const c = b.map(x => x.close);
        return crossRule(Ind.sma(c, p.fast), Ind.sma(c, p.slow));
      }
    },
    ema_cross: {
      label: 'EMA kesişimi',
      desc: 'Hızlı üssel ortalama yavaşı yukarı kesince al, aşağı kesince sat.',
      params: [{ key: 'fast', label: 'Hızlı EMA', def: 9, min: 2, max: 200 }, { key: 'slow', label: 'Yavaş EMA', def: 21, min: 3, max: 400 }],
      build(b, p) {
        const c = b.map(x => x.close);
        return crossRule(Ind.ema(c, p.fast), Ind.ema(c, p.slow));
      }
    },
    rsi: {
      label: 'RSI dönüşü',
      desc: 'RSI aşırı satımdan (alt eşik) yukarı dönünce al, aşırı alıma (üst eşik) çıkınca sat.',
      params: [
        { key: 'period', label: 'RSI periyodu', def: 14, min: 2, max: 100 },
        { key: 'low', label: 'Alt eşik', def: 30, min: 1, max: 99 },
        { key: 'high', label: 'Üst eşik', def: 70, min: 1, max: 99 }
      ],
      build(b, p) {
        const r = Ind.rsi(b.map(x => x.close), p.period);
        return {
          warmup: warmupOf(r),
          enter: r.map((v, i) => i > 0 && ok(v, r[i - 1]) && r[i - 1] < p.low && v >= p.low),
          exit: r.map(v => ok(v) && v >= p.high)
        };
      }
    },
    macd: {
      label: 'MACD kesişimi',
      desc: 'MACD çizgisi sinyal çizgisini yukarı kesince al, aşağı kesince sat.',
      params: [
        { key: 'fast', label: 'Hızlı', def: 12, min: 2, max: 100 },
        { key: 'slow', label: 'Yavaş', def: 26, min: 3, max: 200 },
        { key: 'signal', label: 'Sinyal', def: 9, min: 2, max: 100 }
      ],
      build(b, p) {
        const m = Ind.macd(b.map(x => x.close), p.fast, p.slow, p.signal);
        return crossRule(m.line, m.signal);
      }
    },
    bollinger: {
      label: 'Bollinger dönüşü',
      desc: 'Kapanış alt bandın altına inince al, orta bandın üzerine çıkınca sat.',
      params: [{ key: 'period', label: 'Periyot', def: 20, min: 2, max: 200 }, { key: 'k', label: 'Bant genişliği (σ)', def: 2, min: 0.5, max: 5, step: 0.1 }],
      build(b, p) {
        const c = b.map(x => x.close);
        const bb = Ind.bollinger(c, p.period, p.k);
        return {
          warmup: warmupOf(bb.lower),
          enter: c.map((v, i) => ok(bb.lower[i]) && v < bb.lower[i]),
          exit: c.map((v, i) => ok(bb.mid[i]) && v > bb.mid[i])
        };
      }
    },
    donchian: {
      label: 'Donchian kırılımı',
      desc: 'Kapanış önceki N mumun zirvesini aşınca al, önceki M mumun dibinin altına inince sat (kaplumbağa kuralı).',
      params: [{ key: 'entry', label: 'Giriş (N mum)', def: 20, min: 2, max: 250 }, { key: 'exit', label: 'Çıkış (M mum)', def: 10, min: 2, max: 250 }],
      build(b, p) {
        const c = b.map(x => x.close);
        const hi = rollingMax(b.map(x => x.high), p.entry);
        const lo = rollingMin(b.map(x => x.low), p.exit);
        return {
          warmup: warmupOf(hi, lo),
          enter: c.map((v, i) => ok(hi[i]) && v > hi[i]),
          exit: c.map((v, i) => ok(lo[i]) && v < lo[i])
        };
      }
    },
    formula: {
      label: 'Kendi formülün',
      desc: 'Giriş ve çıkış koşulunu formülle yaz; koşul doğru olduğu mumun kapanışında sinyal oluşur. Ör. giriş crossover(ema(close, 9), ema(close, 21)), çıkış rsi(close) > 70.',
      params: [],
      formulas: true,
      /** f: { entry, exit } formula texts (formula.js); a mistake throws a FormulaError. */
      build(b, p, f = {}) {
        const rule = (text, what) => {
          const msg = Formula.check(text, 'condition');
          if (msg) throw new Formula.FormulaError(`${what} formülü: ${msg}`);
          return Formula.compile(text).run(b);
        };
        const enter = rule(f.entry, 'Giriş'), exit = rule(f.exit, 'Çıkış');
        const has = i => enter[i] != null && exit[i] != null;
        let warmup = b.length;
        for (let i = 1; i < b.length; i++) if (has(i) && has(i - 1)) { warmup = i; break; }
        return { warmup, enter: enter.map(v => v === true), exit: exit.map(v => v === true) };
      }
    }
  };

  /** Enter when `fast` crosses above `slow`, exit when it crosses below. */
  function crossRule(fast, slow) {
    const up = fast.map((v, i) => (ok(v, slow[i]) ? v > slow[i] : null));
    return {
      warmup: warmupOf(fast, slow),
      enter: up.map((u, i) => i > 0 && u === true && up[i - 1] === false),
      exit: up.map((u, i) => i > 0 && u === false && up[i - 1] === true)
    };
  }

  /** Strategy inputs clamped to their limits, defaults for anything missing or invalid. */
  function cleanParams(strategy, params = {}) {
    const out = {};
    STRATEGIES[strategy].params.forEach(d => {
      const v = Number(params[d.key]);
      out[d.key] = Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, d.step ? v : Math.round(v))) : d.def;
    });
    return out;
  }

  /**
   * Runs a strategy over the bars.
   * opts: { params, commission (fraction per side, 0.001 = %0,1), stopLoss and takeProfit
   * (fractions of the entry price, or null), capital, formula: { entry, exit } for 'formula' }.
   */
  function run(bars, strategy, opts = {}) {
    const def = STRATEGIES[strategy];
    if (!def) throw new Error(`unknown strategy ${strategy}`);
    const params = cleanParams(strategy, opts.params);
    const commission = Math.max(0, Number(opts.commission) || 0);
    const stopLoss = opts.stopLoss > 0 ? opts.stopLoss : null;
    const takeProfit = opts.takeProfit > 0 ? opts.takeProfit : null;
    const capital = opts.capital > 0 ? opts.capital : 100000;
    const n = bars.length;

    let sig;
    try { sig = def.build(bars, params, opts.formula); } catch (e) {
      if (Formula && e instanceof Formula.FormulaError) return { ok: false, reason: e.message, params };
      throw e;
    }
    const start = Math.min(sig.warmup, n - 1);
    if (n < 3 || start >= n - 1) return { ok: false, reason: 'Bu strateji için yeterli fiyat geçmişi yok.', params };

    let cash = capital, shares = 0, pos = null, pending = null, inMarket = 0;
    const trades = [];
    const equity = [];

    const exit = (price, i, reason) => {
      const proceeds = shares * price * (1 - commission);
      trades.push({
        entryTime: bars[pos.i].time, entryPrice: pos.price,
        exitTime: bars[i].time, exitPrice: price,
        ret: proceeds / pos.cost - 1, pnl: proceeds - pos.cost,
        bars: i - pos.i, reason
      });
      cash = proceeds;
      shares = 0;
      pos = null;
    };

    for (let i = start; i < n; i++) {
      const b = bars[i];
      // Orders from the previous close fill at this open
      if (pending === 'enter' && !pos) {
        pos = { i, price: b.open, cost: cash };
        shares = cash * (1 - commission) / b.open;
        cash = 0;
      } else if (pending === 'exit' && pos) {
        exit(b.open, i, 'signal');
      }
      pending = null;

      if (pos) {
        const stopPx = stopLoss ? pos.price * (1 - stopLoss) : null;
        const takePx = takeProfit ? pos.price * (1 + takeProfit) : null;
        if (stopPx != null && b.low <= stopPx) exit(Math.min(b.open, stopPx), i, 'stop');
        else if (takePx != null && b.high >= takePx) exit(Math.max(b.open, takePx), i, 'target');
      }
      if (pos) inMarket++;

      if (i < n - 1) {
        if (!pos && sig.enter[i]) pending = 'enter';
        else if (pos && sig.exit[i]) pending = 'exit';
      }
      equity.push({ time: b.time, value: cash + shares * b.close });
    }
    // A position still open at the end is valued at the last close, net of the exit commission
    let open = null;
    if (pos) {
      exit(bars[n - 1].close, n - 1, 'open');
      open = trades[trades.length - 1];
      equity[equity.length - 1].value = cash;
    }

    // Buy and hold over the same window, with the same commission
    const bhShares = capital * (1 - commission) / bars[start].open;
    const benchmark = bars.slice(start).map(b => ({ time: b.time, value: bhShares * b.close }));
    benchmark[benchmark.length - 1].value *= (1 - commission);

    return { ok: true, strategy, params, commission, stopLoss, takeProfit, capital, start, trades, open, equity, benchmark, stats: stats(equity, benchmark, trades, inMarket, capital) };
  }

  function maxDrawdown(series) {
    let peak = -Infinity, worst = 0;
    series.forEach(p => {
      peak = Math.max(peak, p.value);
      worst = Math.min(worst, p.value / peak - 1);
    });
    return worst;
  }

  function stats(equity, benchmark, trades, inMarket, capital) {
    const last = equity[equity.length - 1].value;
    const years = (equity[equity.length - 1].time - equity[0].time) / (365.25 * 86400);
    const totalReturn = last / capital - 1;
    const bhReturn = benchmark[benchmark.length - 1].value / capital - 1;
    // Annualised figures only mean something over a few months of history
    const annual = r => (years >= 0.25 ? Math.pow(1 + r, 1 / years) - 1 : null);

    const rets = equity.slice(1).map((p, i) => p.value / equity[i].value - 1);
    const mean = rets.reduce((s, r) => s + r, 0) / (rets.length || 1);
    const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1));
    const barsPerYear = years > 0 ? rets.length / years : 0;

    const wins = trades.filter(t => t.ret > 0);
    const gains = wins.reduce((s, t) => s + t.pnl, 0);
    const losses = trades.filter(t => t.ret <= 0).reduce((s, t) => s + t.pnl, 0);
    return {
      finalValue: last,
      totalReturn,
      bhReturn,
      annualReturn: annual(totalReturn),
      bhAnnualReturn: annual(bhReturn),
      maxDrawdown: maxDrawdown(equity),
      bhMaxDrawdown: maxDrawdown(benchmark),
      // Risk-free rate taken as zero
      sharpe: sd > 0 && barsPerYear > 0 ? (mean / sd) * Math.sqrt(barsPerYear) : null,
      trades: trades.length,
      winRate: trades.length ? wins.length / trades.length : null,
      avgTrade: trades.length ? trades.reduce((s, t) => s + t.ret, 0) / trades.length : null,
      bestTrade: trades.length ? Math.max(...trades.map(t => t.ret)) : null,
      worstTrade: trades.length ? Math.min(...trades.map(t => t.ret)) : null,
      profitFactor: losses < 0 ? gains / -losses : null,
      avgBars: trades.length ? trades.reduce((s, t) => s + t.bars, 0) / trades.length : null,
      exposure: equity.length ? inMarket / equity.length : 0,
      years
    };
  }

  const Backtest = { STRATEGIES, run, cleanParams, maxDrawdown };
  if (typeof module !== 'undefined' && module.exports) module.exports = Backtest;
  else root.Backtest = Backtest;
})(typeof window !== 'undefined' ? window : globalThis);
