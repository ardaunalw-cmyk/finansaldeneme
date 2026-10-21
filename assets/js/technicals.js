/**
 * Real price history and technical indicators.
 *
 * Bars come from /api/history (Yahoo Finance, delayed). Every indicator below is computed
 * from those bars, so each company gets its own chart; nothing here is generated.
 */
const TechData = (() => {
  const TR_DAY = { day: '2-digit', month: '2-digit', timeZone: 'Europe/Istanbul' };
  const TR_TIME = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Istanbul' };
  const DAYS = { '1M': 21, '3M': 63, '6M': 126, '1Y': 252 };   // trading days per timeframe button
  const BIST_FRAMES = {
    '1G': { range: '1d', interval: '5m', time: true },
    '1H': { range: '5d', interval: '30m', time: true, date: true },
    '1A': { range: '1mo', interval: '1d' },
    '3A': { range: '3mo', interval: '1d' },
    '1Y': { range: '1y', interval: '1d', year: true },
    'YBB': { range: 'ytd', interval: '1d', year: true }
  };
  const pctFmt = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const round2 = v => (v == null || Number.isNaN(v) ? null : Math.round(v * 100) / 100);

  const inflight = new Map();   // request key -> Promise, so tabs/buttons do not refetch

  function history(symbol, range, interval) {
    const key = `${symbol}|${range}|${interval}`;
    if (!inflight.has(key)) {
      const p = fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`)
        .then(r => { if (!r.ok) throw new Error(`history ${r.status}`); return r.json(); })
        .then(j => { if (!j.c || j.c.length < 2) throw new Error('empty history'); return j; });
      p.catch(() => inflight.delete(key));
      inflight.set(key, p);
      setTimeout(() => inflight.delete(key), 5 * 60 * 1000);
    }
    return inflight.get(key);
  }

  /* ---------- indicator math (series keep the bars' length; warm-up values are null) ---------- */
  function sma(values, n) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= n) sum -= values[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  function bollinger(values, n = 20, k = 2) {
    const mid = sma(values, n);
    const upper = [], lower = [];
    for (let i = 0; i < values.length; i++) {
      if (mid[i] == null) { upper.push(null); lower.push(null); continue; }
      let variance = 0;
      for (let j = i - n + 1; j <= i; j++) variance += (values[j] - mid[i]) ** 2;
      const sd = Math.sqrt(variance / n);
      upper.push(mid[i] + k * sd);
      lower.push(mid[i] - k * sd);
    }
    return { upper, lower };
  }

  function ema(values, n) {
    const out = new Array(values.length).fill(null);
    const a = 2 / (n + 1);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      if (i === n - 1) {
        prev = values.slice(0, n).reduce((s, v) => s + v, 0) / n;
        out[i] = prev;
      } else if (i >= n) {
        prev = values[i] * a + prev * (1 - a);
        out[i] = prev;
      }
    }
    return out;
  }

  // Wilder's RSI
  function rsi(closes, n = 14) {
    const out = new Array(closes.length).fill(null);
    if (closes.length <= n) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= n; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    gain /= n; loss /= n;
    out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      gain = (gain * (n - 1) + Math.max(d, 0)) / n;
      loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  function macd(closes) {
    const fast = ema(closes, 12), slow = ema(closes, 26);
    const line = closes.map((_, i) => (fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null));
    const start = line.findIndex(v => v != null);
    const sig = new Array(closes.length).fill(null);
    if (start >= 0) {
      const e = ema(line.slice(start), 9);
      e.forEach((v, i) => { sig[start + i] = v; });
    }
    const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
    return { line, signal: sig, histogram: hist };
  }

  function stochastic(highs, lows, closes, n = 14, d = 3) {
    const k = closes.map((c, i) => {
      if (i < n - 1) return null;
      const hh = Math.max(...highs.slice(i - n + 1, i + 1));
      const ll = Math.min(...lows.slice(i - n + 1, i + 1));
      return hh === ll ? 50 : (c - ll) / (hh - ll) * 100;
    });
    const dLine = new Array(k.length).fill(null);
    for (let i = 0; i < k.length; i++) {
      const win = k.slice(i - d + 1, i + 1);
      if (i >= d - 1 && win.every(v => v != null)) dLine[i] = win.reduce((s, v) => s + v, 0) / d;
    }
    return { k, d: dLine };
  }

  /** Rule-based reading of the latest bars. Not a forecast. */
  function describeSignal(s) {
    const last = s.c.length - 1;
    const px = s.c[last];
    const crossWithin = (fast, slow, bars) => {
      for (let i = last; i > last - bars && i > 0; i--) {
        if (fast[i] == null || slow[i] == null || fast[i - 1] == null || slow[i - 1] == null) continue;
        if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) return 'up';
        if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) return 'down';
      }
      return null;
    };
    const cross = crossWithin(s.sma50, s.sma200, 10);
    const hi20 = Math.max(...s.h.slice(Math.max(0, last - 20), last));
    const lo20 = Math.min(...s.l.slice(Math.max(0, last - 20), last));
    const r = s.rsi[last];
    const f = round2;

    let name, desc;
    if (cross === 'up') {
      name = 'Altın Kesişim (SMA 50 > SMA 200)';
      desc = '50 günlük ortalama son 10 işlem günü içinde 200 günlük ortalamayı yukarı kesti.';
    } else if (cross === 'down') {
      name = 'Ölüm Kesişimi (SMA 50 < SMA 200)';
      desc = '50 günlük ortalama son 10 işlem günü içinde 200 günlük ortalamayı aşağı kesti.';
    } else if (px > hi20) {
      name = '20 Günlük Zirve Kırılımı';
      desc = `Kapanış, önceki 20 günün en yükseği olan ₺${f(hi20)} seviyesinin üzerinde.`;
    } else if (px < lo20) {
      name = '20 Günlük Dip Kırılımı';
      desc = `Kapanış, önceki 20 günün en düşüğü olan ₺${f(lo20)} seviyesinin altında.`;
    } else if (r != null && r >= 70) {
      name = 'Aşırı Alım Bölgesi (RSI ≥ 70)';
      desc = `RSI ${f(r)}; fiyat kısa vadede güçlü yükselmiş durumda.`;
    } else if (r != null && r <= 30) {
      name = 'Aşırı Satım Bölgesi (RSI ≤ 30)';
      desc = `RSI ${f(r)}; fiyat kısa vadede güçlü düşmüş durumda.`;
    } else if (s.sma20[last] != null && s.sma50[last] != null && s.sma200[last] != null
      && px > s.sma20[last] && s.sma20[last] > s.sma50[last] && s.sma50[last] > s.sma200[last]) {
      name = 'Yükseliş Trendi (Fiyat > SMA 20 > 50 > 200)';
      desc = 'Fiyat ve kısa, orta, uzun vadeli ortalamalar yükseliş sıralamasında.';
    } else if (s.sma20[last] != null && s.sma50[last] != null && s.sma200[last] != null
      && px < s.sma20[last] && s.sma20[last] < s.sma50[last] && s.sma50[last] < s.sma200[last]) {
      name = 'Düşüş Trendi (Fiyat < SMA 20 < 50 < 200)';
      desc = 'Fiyat ve kısa, orta, uzun vadeli ortalamalar düşüş sıralamasında.';
    } else {
      name = 'Yatay / Kararsız Seyir';
      desc = 'Belirgin bir kesişim, kırılım veya uç RSI değeri yok.';
    }
    return {
      name,
      type: 'Gösterge sinyali',
      target: `₺${f(Math.max(...s.h.slice(-60)))}`,        // 60-day high, shown as the nearest reference level
      support: `₺${f(Math.min(...s.l.slice(-60)))}`,
      reliability: 'Kural tabanlı gösterge okuması; tahmin veya yatırım tavsiyesi değildir',
      desc
    };
  }

  /* ---------- public: stock technicals ---------- */
  async function stock(ticker, timeframe = '1M') {
    // Two years of daily bars so the 200-day average already has history in a 1-month view
    const bars = await history(ticker, '2y', '1d');
    const n = DAYS[timeframe] || 21;
    const full = {
      h: bars.h, l: bars.l, c: bars.c,
      sma20: sma(bars.c, 20), sma50: sma(bars.c, 50), sma200: sma(bars.c, 200),
      rsi: rsi(bars.c)
    };
    const bb = bollinger(bars.c);
    const mc = macd(bars.c);
    const st = stochastic(bars.h, bars.l, bars.c);

    const cut = Math.max(0, bars.c.length - n);
    const cutSeries = (arr, digits = true) => arr.slice(cut).map(v => (digits ? round2(v) : v));

    const prices = cutSeries(bars.c), highs = cutSeries(bars.h), lows = cutSeries(bars.l);
    const maxP = Math.max(...highs), minP = Math.min(...lows), diff = maxP - minP;
    const lastIdx = bars.c.length - 1;
    const chg = bars.c[lastIdx - 1] ? (bars.c[lastIdx] / bars.c[lastIdx - 1] - 1) * 100 : 0;

    return {
      isReal: true,
      source: 'Yahoo Finance',
      ticker,
      currentPrice: bars.c[lastIdx],
      changePercent: `${chg >= 0 ? '+' : '-'}%${pctFmt.format(Math.abs(chg))}`,
      dates: bars.t.slice(cut).map(ms => new Date(ms).toLocaleDateString('tr-TR', TR_DAY)),
      prices,
      opens: cutSeries(bars.o),
      highs,
      lows,
      volumes: bars.v.slice(cut),
      fib: {
        f0: round2(maxP),
        f236: round2(maxP - diff * 0.236),
        f382: round2(maxP - diff * 0.382),
        f500: round2(maxP - diff * 0.5),
        f618: round2(maxP - diff * 0.618),
        f100: round2(minP)
      },
      sma20: cutSeries(full.sma20),
      sma50: cutSeries(full.sma50),
      sma200: cutSeries(full.sma200),
      bbUpper: cutSeries(bb.upper),
      bbLower: cutSeries(bb.lower),
      rsi: cutSeries(full.rsi, true).map(v => (v == null ? null : Math.round(v * 10) / 10)),
      macd: { line: cutSeries(mc.line), signal: cutSeries(mc.signal), histogram: cutSeries(mc.histogram) },
      stoch: {
        k: st.k.slice(cut).map(v => (v == null ? null : Math.round(v))),
        d: st.d.slice(cut).map(v => (v == null ? null : Math.round(v)))
      },
      pattern: describeSignal({ ...full, sma20: full.sma20, sma50: full.sma50, sma200: full.sma200 })
    };
  }

  /* ---------- public: indicator scorecard (computed from the same real bars) ---------- */
  function atr(h, l, c, n = 14) {
    const tr = c.map((_, i) => (i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
    if (tr.length < n) return null;
    let v = tr.slice(1, n + 1).reduce((s, x) => s + x, 0) / n;
    for (let i = n + 1; i < tr.length; i++) v = (v * (n - 1) + tr[i]) / n;
    return v;
  }

  function cci(h, l, c, n = 20) {
    const tp = c.map((_, i) => (h[i] + l[i] + c[i]) / 3);
    const win = tp.slice(-n);
    const mean = win.reduce((s, x) => s + x, 0) / n;
    const dev = win.reduce((s, x) => s + Math.abs(x - mean), 0) / n;
    return dev === 0 ? 0 : (tp[tp.length - 1] - mean) / (0.015 * dev);
  }

  function williamsR(h, l, c, n = 14) {
    const hh = Math.max(...h.slice(-n)), ll = Math.min(...l.slice(-n));
    return hh === ll ? -50 : (hh - c[c.length - 1]) / (hh - ll) * -100;
  }

  const SIG = {
    BUY2: { label: 'GÜÇLÜ AL', cls: 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60', score: 2 },
    BUY: { label: 'AL', cls: 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50', score: 1 },
    NEUTRAL: { label: 'NÖTR', cls: 'bg-slate-800 text-slate-300 border border-slate-700', score: 0 },
    SELL: { label: 'SAT', cls: 'bg-rose-950/60 text-rose-400 border border-rose-800/50', score: -1 },
    SELL2: { label: 'GÜÇLÜ SAT', cls: 'bg-rose-950/80 text-rose-300 border border-rose-700/60', score: -2 }
  };

  async function scorecard(ticker) {
    const bars = await history(ticker, '2y', '1d');
    const { h, l, c } = bars;
    const last = c.length - 1;
    const px = c[last];
    const money = v => `₺${pctFmt.format(v)}`;
    const num = v => pctFmt.format(v);
    const rows = [];

    // RSI
    const r = rsi(c)[last];
    const r5 = rsi(c)[last - 5];
    rows.push({
      name: 'RSI (Göreceli Güç Endeksi)', period: '14 Gün', val: num(r),
      sig: r <= 30 ? SIG.BUY : r >= 70 ? SIG.SELL : SIG.NEUTRAL,
      note: r <= 30 ? 'Aşırı satım bölgesinde.' : r >= 70 ? 'Aşırı alım bölgesinde.'
        : `Nötr bölgede; 5 gün önceye göre ${r >= r5 ? 'yükseliyor' : 'düşüyor'}.`
    });

    // MACD
    const m = macd(c);
    const mLine = m.line[last], mSig = m.signal[last];
    let crossBars = null;
    for (let i = last; i > last - 4 && i > 0; i--) {
      if (m.line[i] == null || m.signal[i] == null || m.line[i - 1] == null || m.signal[i - 1] == null) break;
      if ((m.line[i - 1] - m.signal[i - 1]) * (m.line[i] - m.signal[i]) < 0) { crossBars = last - i; break; }
    }
    const macdUp = mLine > mSig;
    rows.push({
      name: 'MACD (12, 26, 9)', period: 'Standart', val: num(mLine),
      sig: macdUp ? (crossBars != null ? SIG.BUY2 : SIG.BUY) : (crossBars != null ? SIG.SELL2 : SIG.SELL),
      note: crossBars != null
        ? `Son ${crossBars + 1} işlem gününde MACD çizgisi sinyal çizgisini ${macdUp ? 'yukarı' : 'aşağı'} kesti.`
        : `MACD çizgisi sinyal çizgisinin ${macdUp ? 'üzerinde' : 'altında'}.`
    });

    // Bollinger %B
    const bb = bollinger(c);
    const bU = bb.upper[last], bL = bb.lower[last];
    const pctB = (px - bL) / (bU - bL);
    rows.push({
      name: 'Bollinger Bantları', period: '20, 2', val: `%B ${num(pctB * 100)}`,
      sig: px < bL ? SIG.BUY : px > bU ? SIG.SELL : SIG.NEUTRAL,
      note: px < bL ? 'Fiyat alt bandın altında.' : px > bU ? 'Fiyat üst bandın üzerinde.'
        : `Fiyat bantların ${pctB >= 0.5 ? 'üst' : 'alt'} yarısında.`
    });

    // Moving averages
    [[20, 'SMA 20 (Kısa Vade)'], [50, 'SMA 50 (Orta Vade)'], [200, 'SMA 200 (Ana Trend)']].forEach(([n, name]) => {
      const v = sma(c, n)[last];
      if (v == null) { rows.push({ name, period: `${n} Gün`, val: 'N/A', sig: SIG.NEUTRAL, note: 'Yeterli geçmiş veri yok.' }); return; }
      const gap = (px / v - 1) * 100;
      rows.push({
        name, period: `${n} Gün`, val: money(v),
        sig: px > v ? SIG.BUY : SIG.SELL,
        note: `Fiyat ortalamanın %${num(Math.abs(gap))} ${px > v ? 'üzerinde' : 'altında'}.`
      });
    });

    // Stochastic
    const st = stochastic(h, l, c);
    const k = st.k[last], d = st.d[last];
    rows.push({
      name: 'Stokastik Osilatör', period: '14, 3', val: `%K ${num(k)}`,
      sig: k <= 20 ? SIG.BUY : k >= 80 ? SIG.SELL : SIG.NEUTRAL,
      note: `%K, %D (${num(d)}) çizgisinin ${k >= d ? 'üzerinde' : 'altında'}${k <= 20 ? '; aşırı satım bölgesi' : k >= 80 ? '; aşırı alım bölgesi' : ''}.`
    });

    // ATR (volatility only, not part of the consensus)
    const a = atr(h, l, c);
    const aPct = a / px * 100;
    rows.push({
      name: 'ATR (Ortalama Gerçek Aralık)', period: '14 Gün', val: money(a),
      sig: { label: aPct < 2 ? 'DÜŞÜK OYNAKLIK' : aPct < 4 ? 'ORTA OYNAKLIK' : 'YÜKSEK OYNAKLIK', cls: 'bg-sky-950/60 text-sky-300 border border-sky-800/50', score: 0 },
      note: `Günlük ortalama hareket fiyatın yaklaşık %${num(aPct)} kadarı.`,
      directional: false
    });

    // CCI
    const cc = cci(h, l, c);
    rows.push({
      name: 'Emtia Kanal Endeksi (CCI)', period: '20 Gün', val: num(cc),
      sig: cc <= -100 ? SIG.BUY : cc >= 100 ? SIG.SELL : SIG.NEUTRAL,
      note: cc <= -100 ? 'Aşırı satım bölgesinde.' : cc >= 100 ? 'Aşırı alım bölgesinde.' : '±100 bandı içinde.'
    });

    // Williams %R
    const w = williamsR(h, l, c);
    rows.push({
      name: 'Williams %R', period: '14 Gün', val: num(w),
      sig: w <= -80 ? SIG.BUY : w >= -20 ? SIG.SELL : SIG.NEUTRAL,
      note: w <= -80 ? 'Aşırı satım bölgesinde.' : w >= -20 ? 'Aşırı alım bölgesinde.' : 'Orta bölgede.'
    });

    // Consensus over the directional indicators
    const dir = rows.filter(x => x.directional !== false);
    const buy = dir.filter(x => x.sig.score > 0).length;
    const sell = dir.filter(x => x.sig.score < 0).length;
    const neutral = dir.length - buy - sell;
    const ratio = dir.reduce((s, x) => s + x.sig.score, 0) / (dir.length * 2);
    const verdict = ratio >= 0.4 ? SIG.BUY2 : ratio >= 0.12 ? SIG.BUY : ratio > -0.12 ? SIG.NEUTRAL : ratio > -0.4 ? SIG.SELL : SIG.SELL2;

    // Plain-language reading built from the same numbers
    const sma20 = sma(c, 20)[last], sma50 = sma(c, 50)[last], sma200 = sma(c, 200)[last];
    const hi52 = Math.max(...h.slice(-252)), lo52 = Math.min(...l.slice(-252));
    const rangePos = (px - lo52) / (hi52 - lo52) * 100;
    const above = [[sma20, 'SMA 20'], [sma50, 'SMA 50'], [sma200, 'SMA 200']].filter(([v]) => v != null && px > v).map(([, n]) => n);
    const below = [[sma20, 'SMA 20'], [sma50, 'SMA 50'], [sma200, 'SMA 200']].filter(([v]) => v != null && px <= v).map(([, n]) => n);
    const commentary = [
      `Son kapanış ${money(px)}; ${above.length ? `${above.join(', ')} üzerinde` : ''}${above.length && below.length ? ', ' : ''}${below.length ? `${below.join(', ')} altında` : ''}.`,
      `52 haftalık aralıkta (${money(lo52)} – ${money(hi52)}) %${num(rangePos)} seviyesinde; RSI ${num(r)}, MACD ${macdUp ? 'pozitif' : 'negatif'} momentumda.`,
      `${dir.length} yönlü göstergeden ${buy} tanesi alım, ${sell} tanesi satım, ${neutral} tanesi nötr sinyal veriyor.`
    ];

    return {
      rows, verdict, buy, sell, neutral, commentary, rsi: r,
      asOf: bars.t[bars.t.length - 1]
    };
  }

  /** Latest RSI(14) from daily bars, used by RSI price alerts. */
  async function rsiLast(ticker) {
    const bars = await history(ticker, '1y', '1d');
    const v = rsi(bars.c)[bars.c.length - 1];
    return v == null ? null : v;
  }
  /* ---------- public: BIST 100 index line ---------- */
  async function bist(tf = '1G') {
    const frame = BIST_FRAMES[tf] || BIST_FRAMES['1G'];
    const bars = await history('BIST100', frame.range, frame.interval);
    const labels = bars.t.map(ms => {
      const d = new Date(ms);
      if (!frame.time) return d.toLocaleDateString('tr-TR', frame.year ? { ...TR_DAY, year: '2-digit' } : TR_DAY);
      const time = d.toLocaleTimeString('tr-TR', TR_TIME);
      return frame.date ? `${d.toLocaleDateString('tr-TR', TR_DAY)} ${time}` : time;
    });
    const base = frame.range === '1d' ? bars.o[0] : bars.c[0];
    const last = bars.c[bars.c.length - 1];
    const pct = (last / base - 1) * 100;

    // Reference levels for the cards under the chart come from a year of daily bars
    let levels = null;
    try {
      const daily = await history('BIST100', '1y', '1d');
      const c = daily.c;
      const m20 = sma(c, 20), m200 = sma(c, 200);
      levels = {
        support: Math.min(...daily.l.slice(-20)),
        resistance: Math.max(...daily.h.slice(-20)),
        ma20: m20[m20.length - 1],
        ma200: m200[m200.length - 1]
      };
    } catch { /* cards keep their previous values */ }

    return {
      isReal: true,
      labels,
      data: bars.c.map(round2),
      change: `${pct >= 0 ? '+' : '-'}%${pctFmt.format(Math.abs(pct))}`,
      levels
    };
  }

  return { stock, bist, history, scorecard, rsiLast };
})();

window.TechData = TechData;
