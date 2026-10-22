/**
 * Real price history and technical indicators.
 *
 * Bars come from /api/history (Yahoo Finance, delayed). Every indicator below is computed
 * from those bars with the pure functions in indicators.js, so each company gets its own
 * chart, scorecard and written report; nothing here is generated.
 */
const TechData = (() => {
  const { sma, bollinger, rsi, macd, stochastic } = Ind;
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
    symbol = typeof tradingCode === 'function' ? tradingCode(symbol) : symbol;
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

  /** Rule-based reading of the latest bars. Not a forecast. */
  function describeSignal(s) {
    const last = s.c.length - 1;
    const px = s.c[last];
    const cross = Ind.lastCross(s.sma50, s.sma200, 10);
    const hi20 = Math.max(...s.h.slice(Math.max(0, last - 20), last));
    const lo20 = Math.min(...s.l.slice(Math.max(0, last - 20), last));
    const r = s.rsi[last];
    const f = round2;

    let name, desc;
    if (cross && cross.dir === 'up') {
      name = 'Altın Kesişim (SMA 50 > SMA 200)';
      desc = '50 günlük ortalama son 10 işlem günü içinde 200 günlük ortalamayı yukarı kesti.';
    } else if (cross && cross.dir === 'down') {
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
      pattern: describeSignal(full)
    };
  }

  /* ---------- public: indicator scorecard and written report (same real bars) ---------- */
  const SIG = {
    BUY2: { label: 'GÜÇLÜ AL', cls: 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60', score: 2 },
    BUY: { label: 'AL', cls: 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50', score: 1 },
    NEUTRAL: { label: 'NÖTR', cls: 'bg-slate-800 text-slate-300 border border-slate-700', score: 0 },
    SELL: { label: 'SAT', cls: 'bg-rose-950/60 text-rose-400 border border-rose-800/50', score: -1 },
    SELL2: { label: 'GÜÇLÜ SAT', cls: 'bg-rose-950/80 text-rose-300 border border-rose-700/60', score: -2 }
  };
  /** Non-directional readings (volatility, levels, volume size) are shown but not counted. */
  const info = label => ({ label, cls: 'bg-sky-950/60 text-sky-300 border border-sky-800/50', score: 0 });

  const GROUPS = {
    trend: 'Trend',
    momentum: 'Momentum',
    volume: 'Hacim ve Para Akışı',
    volatility: 'Volatilite ve Seviyeler'
  };

  /** -1..+1 average of a group's directional signals. */
  const groupScore = (rows, g) => {
    const d = rows.filter(r => r.group === g && r.directional !== false);
    return d.length ? d.reduce((s, r) => s + r.sig.score, 0) / (d.length * 2) : 0;
  };
  const verdictOf = ratio => (ratio >= 0.4 ? SIG.BUY2 : ratio >= 0.12 ? SIG.BUY : ratio > -0.12 ? SIG.NEUTRAL : ratio > -0.4 ? SIG.SELL : SIG.SELL2);
  const toneOf = s => (s >= 0.4 ? 'güçlü olumlu' : s >= 0.12 ? 'olumlu' : s > -0.12 ? 'nötr / kararsız' : s > -0.4 ? 'olumsuz' : 'güçlü olumsuz');

  async function scorecard(ticker) {
    const bars = await history(ticker, '2y', '1d');
    // The slowest always-on indicator (MACD signal) needs 34 bars; fresh listings have fewer
    if (bars.c.length < 40) throw new Error(`only ${bars.c.length} bars`);
    const { h, l, c } = bars;
    const v = bars.v || c.map(() => 0);
    const last = c.length - 1;
    const px = c[last];
    const money = x => `₺${pctFmt.format(x)}`;
    const num = x => pctFmt.format(x);
    const pct = x => `%${pctFmt.format(Math.abs(x))}`;
    const big = x => {
      const a = Math.abs(x), s = x < 0 ? '-' : '';
      return a >= 1e9 ? `${s}${num(a / 1e9)} Mr` : a >= 1e6 ? `${s}${num(a / 1e6)} Mn` : a >= 1e3 ? `${s}${num(a / 1e3)} B` : `${s}${num(a)}`;
    };
    const rows = [];
    const add = (group, row) => rows.push({ group, ...row });
    const na = (group, name, period) => add(group, { name, period, val: '—', sig: info('VERİ YOK'), note: 'Yeterli fiyat geçmişi yok.', directional: false });

    /* ----- trend ----- */
    const ma = {};
    [[20, 'SMA 20 (Kısa Vade)'], [50, 'SMA 50 (Orta Vade)'], [200, 'SMA 200 (Ana Trend)']].forEach(([n, name]) => {
      const m = sma(c, n)[last];
      ma[n] = m;
      if (m == null) { na('trend', name, `${n} Gün`); return; }
      const gap = (px / m - 1) * 100;
      add('trend', {
        name, period: `${n} Gün`, val: money(m),
        sig: px > m ? SIG.BUY : SIG.SELL,
        note: `Fiyat ortalamanın ${pct(gap)} ${px > m ? 'üzerinde' : 'altında'}.`
      });
    });

    const e9 = Ind.ema(c, 9), e21 = Ind.ema(c, 21);
    const emaCross = Ind.lastCross(e9, e21, 5);
    const emaUp = e9[last] > e21[last];
    add('trend', {
      name: 'EMA 9 / EMA 21 Kesişimi', period: '9, 21', val: `${money(e9[last])} / ${money(e21[last])}`,
      sig: emaUp ? (emaCross && emaCross.dir === 'up' ? SIG.BUY2 : SIG.BUY) : (emaCross && emaCross.dir === 'down' ? SIG.SELL2 : SIG.SELL),
      note: emaCross
        ? `Hızlı ortalama ${emaCross.ago === 0 ? 'bugün' : `${emaCross.ago} gün önce`} yavaş ortalamayı ${emaCross.dir === 'up' ? 'yukarı' : 'aşağı'} kesti.`
        : `Hızlı ortalama yavaş ortalamanın ${emaUp ? 'üzerinde' : 'altında'}; kısa vadeli eğilim ${emaUp ? 'yukarı' : 'aşağı'}.`
    });

    const m = macd(c);
    const mLine = m.line[last], mSig = m.signal[last];
    const macdCross = Ind.lastCross(m.line, m.signal, 4);
    const macdUp = mLine > mSig;
    const histUp = m.histogram[last] > m.histogram[last - 1];
    add('trend', {
      name: 'MACD (12, 26, 9)', period: 'Standart', val: num(mLine),
      sig: macdUp ? (macdCross ? SIG.BUY2 : SIG.BUY) : (macdCross ? SIG.SELL2 : SIG.SELL),
      note: macdCross
        ? `Son ${macdCross.ago + 1} işlem gününde MACD çizgisi sinyal çizgisini ${macdUp ? 'yukarı' : 'aşağı'} kesti.`
        : `MACD sinyal çizgisinin ${macdUp ? 'üzerinde' : 'altında'}; histogram ${histUp ? 'genişliyor' : 'daralıyor'}.`
    });

    const dmi = Ind.adx(h, l, c);
    if (dmi) {
      const bull = dmi.plusDI > dmi.minusDI;
      const strength = dmi.adx < 20 ? 'zayıf (yatay piyasa)' : dmi.adx < 25 ? 'oluşmakta' : dmi.adx < 40 ? 'güçlü' : 'çok güçlü';
      add('trend', {
        name: 'ADX / DMI (Trend Gücü)', period: '14 Gün', val: num(dmi.adx),
        sig: dmi.adx < 20 ? SIG.NEUTRAL : dmi.adx >= 25 ? (bull ? SIG.BUY2 : SIG.SELL2) : (bull ? SIG.BUY : SIG.SELL),
        note: `Trend gücü ${strength}; +DI ${num(dmi.plusDI)}, -DI ${num(dmi.minusDI)} (${bull ? 'alıcılar' : 'satıcılar'} baskın).`
      });
    } else na('trend', 'ADX / DMI (Trend Gücü)', '14 Gün');

    const sar = Ind.parabolicSar(h, l);
    add('trend', {
      name: 'Parabolic SAR', period: '0,02 / 0,2', val: money(sar.sar),
      sig: sar.up ? SIG.BUY : SIG.SELL,
      note: `SAR fiyatın ${sar.up ? 'altında' : 'üzerinde'}; ${sar.up ? 'yükseliş' : 'düşüş'} modu ${sar.since === 0 ? 'bugün' : `${sar.since} işlem günü önce`} başladı.`
    });

    const st = Ind.supertrend(h, l, c);
    if (st) {
      add('trend', {
        name: 'Supertrend', period: '10, 3', val: money(st.value),
        sig: st.up ? (st.since <= 3 ? SIG.BUY2 : SIG.BUY) : (st.since <= 3 ? SIG.SELL2 : SIG.SELL),
        note: `Çizgi fiyatın ${st.up ? 'altında (dinamik destek)' : 'üzerinde (dinamik direnç)'}; son yön değişimi ${st.since === 0 ? 'bugün' : `${st.since} gün önce`}.`
      });
    } else na('trend', 'Supertrend', '10, 3');

    const ich = Ind.ichimoku(h, l, c);
    if (ich) {
      const above = px > ich.cloudTop, below = px < ich.cloudBottom;
      const tkUp = ich.tenkan > ich.kijun;
      add('trend', {
        name: 'Ichimoku Bulutu', period: '9, 26, 52', val: `${money(ich.cloudBottom)} – ${money(ich.cloudTop)}`,
        sig: above ? (tkUp ? SIG.BUY2 : SIG.BUY) : below ? (tkUp ? SIG.SELL : SIG.SELL2) : SIG.NEUTRAL,
        note: `Fiyat bulutun ${above ? 'üzerinde' : below ? 'altında' : 'içinde'}; Tenkan (${money(ich.tenkan)}) Kijun'un (${money(ich.kijun)}) ${tkUp ? 'üzerinde' : 'altında'}.`
      });
    } else na('trend', 'Ichimoku Bulutu', '9, 26, 52');

    const ar = Ind.aroon(h, l);
    if (ar) {
      add('trend', {
        name: 'Aroon', period: '25 Gün', val: `↑${num(ar.up)} / ↓${num(ar.down)}`,
        sig: ar.up >= 70 && ar.down <= 30 ? SIG.BUY : ar.down >= 70 && ar.up <= 30 ? SIG.SELL : SIG.NEUTRAL,
        note: ar.up >= 70 && ar.down <= 30 ? 'Yeni zirveler yakın zamanda yapılıyor; yükseliş trendi canlı.'
          : ar.down >= 70 && ar.up <= 30 ? 'Yeni dipler yakın zamanda yapılıyor; düşüş trendi canlı.'
            : 'Ne zirve ne dip tarafında belirgin bir tazelik var; trend zayıf.'
      });
    } else na('trend', 'Aroon', '25 Gün');

    /* ----- momentum ----- */
    const rsiS = rsi(c);
    const r = rsiS[last], r5 = rsiS[last - 5];
    add('momentum', {
      name: 'RSI (Göreceli Güç Endeksi)', period: '14 Gün', val: num(r),
      sig: r <= 30 ? SIG.BUY : r >= 70 ? SIG.SELL : SIG.NEUTRAL,
      note: r <= 30 ? 'Aşırı satım bölgesinde.' : r >= 70 ? 'Aşırı alım bölgesinde.'
        : `Nötr bölgede; 5 gün önceye göre ${r >= r5 ? 'yükseliyor' : 'düşüyor'}.`
    });

    const sto = stochastic(h, l, c);
    const k = sto.k[last], d = sto.d[last];
    add('momentum', {
      name: 'Stokastik Osilatör', period: '14, 3', val: `%K ${num(k)}`,
      sig: k <= 20 ? SIG.BUY : k >= 80 ? SIG.SELL : SIG.NEUTRAL,
      note: `%K, %D (${num(d)}) çizgisinin ${k >= d ? 'üzerinde' : 'altında'}${k <= 20 ? '; aşırı satım bölgesi' : k >= 80 ? '; aşırı alım bölgesi' : ''}.`
    });

    const srsi = Ind.stochRsi(c);
    const sk = srsi.k[last], sd = srsi.d[last];
    if (sk != null && sd != null) {
      add('momentum', {
        name: 'Stokastik RSI', period: '14, 3, 3', val: `%K ${num(sk)}`,
        sig: sk <= 20 ? SIG.BUY : sk >= 80 ? SIG.SELL : SIG.NEUTRAL,
        note: `RSI kendi 14 günlük aralığının %${num(sk)} seviyesinde; %K ${sk >= sd ? 'yukarı' : 'aşağı'} dönüyor (%D ${num(sd)}).`
      });
    } else na('momentum', 'Stokastik RSI', '14, 3, 3');

    const cc = Ind.cci(h, l, c);
    add('momentum', {
      name: 'Emtia Kanal Endeksi (CCI)', period: '20 Gün', val: num(cc),
      sig: cc <= -100 ? SIG.BUY : cc >= 100 ? SIG.SELL : SIG.NEUTRAL,
      note: cc <= -100 ? 'Aşırı satım bölgesinde.' : cc >= 100 ? 'Aşırı alım bölgesinde.' : '±100 bandı içinde.'
    });

    const w = Ind.williamsR(h, l, c);
    add('momentum', {
      name: 'Williams %R', period: '14 Gün', val: num(w),
      sig: w <= -80 ? SIG.BUY : w >= -20 ? SIG.SELL : SIG.NEUTRAL,
      note: w <= -80 ? 'Aşırı satım bölgesinde.' : w >= -20 ? 'Aşırı alım bölgesinde.' : 'Orta bölgede.'
    });

    const rc = Ind.roc(c, 12);
    add('momentum', {
      name: 'ROC (Değişim Hızı)', period: '12 Gün', val: `${rc >= 0 ? '+' : '-'}${pct(rc)}`,
      sig: rc > 0 ? SIG.BUY : rc < 0 ? SIG.SELL : SIG.NEUTRAL,
      note: `Fiyat son 12 işlem gününde ${pct(rc)} ${rc >= 0 ? 'yükseldi' : 'düştü'}.`
    });

    const uo = Ind.ultimateOscillator(h, l, c);
    add('momentum', {
      name: 'Ultimate Oscillator', period: '7, 14, 28', val: num(uo),
      sig: uo <= 30 ? SIG.BUY : uo >= 70 ? SIG.SELL : SIG.NEUTRAL,
      note: uo <= 30 ? 'Üç vadede birden aşırı satım.' : uo >= 70 ? 'Üç vadede birden aşırı alım.'
        : `Nötr; alım baskısı ${uo >= 50 ? 'satışa göre hafif ağır basıyor' : 'satışa göre hafif zayıf'}.`
    });

    /* ----- volume / money flow ----- */
    const hasVolume = v.slice(-20).some(x => x > 0);
    const ob = Ind.obv(c, v);
    const ob20 = sma(ob, 20)[last];
    const obSlope = ob[last] - ob[Math.max(0, last - 20)];
    const px20 = (px / c[Math.max(0, last - 20)] - 1) * 100;
    const obvDiverge = (px20 > 0 && obSlope < 0) || (px20 < 0 && obSlope > 0);
    if (hasVolume) {
      add('volume', {
        name: 'OBV (Denge Hacmi)', period: '20 Gün Eğim', val: big(ob[last]),
        sig: ob[last] > ob20 && obSlope > 0 ? SIG.BUY : ob[last] < ob20 && obSlope < 0 ? SIG.SELL : SIG.NEUTRAL,
        note: `OBV son 20 günde ${obSlope >= 0 ? 'artıyor (alıcı hacmi baskın)' : 'azalıyor (satıcı hacmi baskın)'}${obvDiverge ? '; fiyatla uyumsuz' : '; fiyatla uyumlu'}.`
      });

      const mf = Ind.mfi(h, l, c, v);
      add('volume', {
        name: 'MFI (Para Akışı Endeksi)', period: '14 Gün', val: num(mf),
        sig: mf <= 20 ? SIG.BUY : mf >= 80 ? SIG.SELL : SIG.NEUTRAL,
        note: mf <= 20 ? 'Hacim ağırlıklı aşırı satım.' : mf >= 80 ? 'Hacim ağırlıklı aşırı alım.' : `Nötr; para ${mf >= 50 ? 'girişi' : 'çıkışı'} hafif ağır basıyor.`
      });

      const cm = Ind.cmf(h, l, c, v);
      add('volume', {
        name: 'Chaikin Para Akışı (CMF)', period: '20 Gün', val: num(cm),
        sig: cm > 0.05 ? SIG.BUY : cm < -0.05 ? SIG.SELL : SIG.NEUTRAL,
        note: cm > 0.05 ? 'Kapanışlar gün aralıklarının üst tarafında; birikim (alım) var.'
          : cm < -0.05 ? 'Kapanışlar gün aralıklarının alt tarafında; dağıtım (satış) var.' : 'Birikim ve dağıtım dengede.'
      });

      const vw = Ind.vwap(h, l, c, v);
      add('volume', {
        name: 'VWAP (Hacim Ağırlıklı Ort. Fiyat)', period: '20 Gün', val: money(vw),
        sig: px > vw ? SIG.BUY : SIG.SELL,
        note: `Fiyat son 20 günde işlem görmüş ortalama maliyetin ${pct((px / vw - 1) * 100)} ${px > vw ? 'üzerinde' : 'altında'}.`
      });

      const vr = Ind.volumeRatio(v);
      const dayChg = (px / c[last - 1] - 1) * 100;
      add('volume', {
        name: 'Hacim / 20 Günlük Ortalama', period: '20 Gün', val: vr == null ? '—' : `${num(vr)}x`,
        sig: info(vr == null ? 'VERİ YOK' : vr >= 1.5 ? 'YÜKSEK HACİM' : vr < 0.7 ? 'DÜŞÜK HACİM' : 'NORMAL HACİM'),
        note: vr == null ? 'Hacim verisi yok.' : `Günlük ${dayChg >= 0 ? 'yükselişe' : 'düşüşe'} ${vr >= 1.5 ? 'güçlü' : vr < 0.7 ? 'zayıf' : 'olağan'} katılım eşlik ediyor.`,
        directional: false
      });
    } else {
      ['OBV (Denge Hacmi)', 'MFI (Para Akışı Endeksi)', 'Chaikin Para Akışı (CMF)', 'VWAP (Hacim Ağırlıklı Ort. Fiyat)', 'Hacim / 20 Günlük Ortalama']
        .forEach(name => add('volume', { name, period: '—', val: '—', sig: info('VERİ YOK'), note: 'Bu hisse için hacim verisi gelmiyor.', directional: false }));
    }

    /* ----- volatility / levels ----- */
    const bb = bollinger(c);
    const bU = bb.upper[last], bL = bb.lower[last], bM = bb.mid[last];
    const pctB = (px - bL) / (bU - bL);
    const bWidth = (bU - bL) / bM * 100;
    const widths = bb.upper.map((u, i) => (u == null ? null : (u - bb.lower[i]) / bb.mid[i] * 100)).slice(-120).filter(x => x != null);
    const narrowest = bWidth <= Math.min(...widths) * 1.1;
    add('volatility', {
      name: 'Bollinger Bantları', period: '20, 2', val: `%B ${num(pctB * 100)}`,
      sig: px < bL ? SIG.BUY : px > bU ? SIG.SELL : SIG.NEUTRAL,
      note: `${px < bL ? 'Fiyat alt bandın altında.' : px > bU ? 'Fiyat üst bandın üzerinde.' : `Fiyat bantların ${pctB >= 0.5 ? 'üst' : 'alt'} yarısında.`} Bant genişliği %${num(bWidth)}${narrowest ? ' (6 ayın en dar seviyesine yakın)' : ''}.`
    });

    const atr = Ind.atrSeries(h, l, c)[last];
    const aPct = atr / px * 100;
    add('volatility', {
      name: 'ATR (Ortalama Gerçek Aralık)', period: '14 Gün', val: money(atr),
      sig: info(aPct < 2 ? 'DÜŞÜK OYNAKLIK' : aPct < 4 ? 'ORTA OYNAKLIK' : 'YÜKSEK OYNAKLIK'),
      note: `Günlük ortalama hareket fiyatın yaklaşık %${num(aPct)} kadarı.`,
      directional: false
    });

    const kc = Ind.keltner(h, l, c);
    const squeeze = kc && bU < kc.upper && bL > kc.lower;
    if (kc) {
      add('volatility', {
        name: 'Keltner Kanalı', period: '20, 10, 2', val: `${money(kc.lower)} – ${money(kc.upper)}`,
        sig: info(px > kc.upper ? 'KANAL ÜSTÜ' : px < kc.lower ? 'KANAL ALTI' : squeeze ? 'SIKIŞMA' : 'KANAL İÇİ'),
        note: px > kc.upper ? 'Fiyat kanalın üzerinde: güçlü ivme, ama ortalamadan uzaklaşmış.'
          : px < kc.lower ? 'Fiyat kanalın altında: güçlü satış ivmesi, ortalamadan uzaklaşmış.'
            : squeeze ? 'Bollinger bantları Keltner kanalının içinde: oynaklık sıkıştı, sert bir hareket öncesi görülebilir.'
              : 'Fiyat kanal içinde, ortalamaya yakın.',
        directional: false
      });
    } else na('volatility', 'Keltner Kanalı', '20, 10, 2');

    const dc = Ind.donchian(h, l);
    add('volatility', {
      name: 'Donchian Kanalı', period: '20 Gün', val: `${money(dc.lower)} – ${money(dc.upper)}`,
      sig: px > dc.upper ? SIG.BUY2 : px < dc.lower ? SIG.SELL2 : SIG.NEUTRAL,
      note: px > dc.upper ? 'Kapanış önceki 20 günün zirvesini aştı (kırılım).'
        : px < dc.lower ? 'Kapanış önceki 20 günün dibinin altına indi (kırılım).'
          : `Fiyat 20 günlük kanalın %${num((px - dc.lower) / (dc.upper - dc.lower) * 100)} seviyesinde.`
    });

    const pv = Ind.pivots(h, l, c);
    add('volatility', {
      name: 'Pivot Noktaları (Klasik)', period: 'Son Gün', val: money(pv.p),
      sig: info(px >= pv.p ? 'PİVOT ÜSTÜ' : 'PİVOT ALTI'),
      note: `Destek S1 ${money(pv.s1)} / S2 ${money(pv.s2)}; direnç R1 ${money(pv.r1)} / R2 ${money(pv.r2)}.`,
      directional: false
    });

    /* ----- consensus ----- */
    const dir = rows.filter(x => x.directional !== false);
    const buy = dir.filter(x => x.sig.score > 0).length;
    const sell = dir.filter(x => x.sig.score < 0).length;
    const neutral = dir.length - buy - sell;
    const ratio = dir.reduce((s, x) => s + x.sig.score, 0) / (dir.length * 2);
    const verdict = verdictOf(ratio);
    const scores = Object.fromEntries(Object.keys(GROUPS).map(g => [g, groupScore(rows, g)]));

    const hi52 = Math.max(...h.slice(-252)), lo52 = Math.min(...l.slice(-252));
    const rangePos = (px - lo52) / (hi52 - lo52) * 100;
    const above = [[ma[20], 'SMA 20'], [ma[50], 'SMA 50'], [ma[200], 'SMA 200']].filter(([x]) => x != null && px > x).map(([, n]) => n);
    const below = [[ma[20], 'SMA 20'], [ma[50], 'SMA 50'], [ma[200], 'SMA 200']].filter(([x]) => x != null && px <= x).map(([, n]) => n);
    const commentary = [
      `Son kapanış ${money(px)}; ${above.length ? `${above.join(', ')} üzerinde` : ''}${above.length && below.length ? ', ' : ''}${below.length ? `${below.join(', ')} altında` : ''}.`,
      `52 haftalık aralıkta (${money(lo52)} – ${money(hi52)}) %${num(rangePos)} seviyesinde; RSI ${num(r)}, MACD ${macdUp ? 'pozitif' : 'negatif'} momentumda.`,
      `${dir.length} yönlü göstergeden ${buy} tanesi alım, ${sell} tanesi satım, ${neutral} tanesi nötr sinyal veriyor.`
    ];

    /* ----- written report ----- */
    const stack = ma[20] != null && ma[50] != null && ma[200] != null
      ? (px > ma[20] && ma[20] > ma[50] && ma[50] > ma[200] ? 'bull'
        : px < ma[20] && ma[20] < ma[50] && ma[50] < ma[200] ? 'bear' : 'mixed')
      : null;
    const gc = ma[50] != null && ma[200] != null ? (ma[50] > ma[200] ? 'golden' : 'death') : null;
    // Trend followers (SAR, Supertrend, Ichimoku): how many point up / down
    const followersUp = [sar.up, st ? st.up : null, ich ? px > ich.cloudTop : null].filter(x => x === true).length;
    const followersDown = [sar.up === false, st ? !st.up : null, ich ? px < ich.cloudBottom : null].filter(x => x === true).length;

    const trendText = [
      stack === 'bull'
        ? `Fiyat (${money(px)}) kısa, orta ve uzun vadeli ortalamaların üzerinde ve ortalamalar da yükseliş sıralamasında (SMA 20 > SMA 50 > SMA 200). Bu, klasik bir yükseliş trendi yapısıdır.`
        : stack === 'bear'
          ? `Fiyat (${money(px)}) kısa, orta ve uzun vadeli ortalamaların altında ve ortalamalar düşüş sıralamasında (SMA 20 < SMA 50 < SMA 200). Bu, klasik bir düşüş trendi yapısıdır.`
          : `Fiyat (${money(px)}) ${above.length ? `${above.join(', ')} üzerinde` : ''}${above.length && below.length ? ' fakat ' : ''}${below.length ? `${below.join(', ')} altında` : ''}; ortalamalar net bir sıralama oluşturmuyor, trend karışık.`,
      gc ? `SMA 50, SMA 200'ün ${gc === 'golden' ? 'üzerinde (altın kesişim bölgesi): orta vadeli eğilim uzun vadeli eğilimden güçlü' : 'altında (ölüm kesişimi bölgesi): orta vadeli eğilim uzun vadeli eğilimin gerisinde'}.` : '',
      dmi ? `ADX ${num(dmi.adx)} ile trendin gücü ${dmi.adx < 20 ? 'zayıf; piyasa yön arıyor ve trend takip eden göstergelerin sık yanlış sinyal üretmesi beklenir' : dmi.adx < 25 ? 'yeni oluşuyor' : dmi.adx < 40 ? 'belirgin' : 'çok yüksek; trend olgunlaşmış olabilir'}. Yön tarafında ${dmi.plusDI > dmi.minusDI ? `+DI (${num(dmi.plusDI)}) -DI'nin (${num(dmi.minusDI)}) üzerinde, alıcılar baskın` : `-DI (${num(dmi.minusDI)}) +DI'nin (${num(dmi.plusDI)}) üzerinde, satıcılar baskın`}.` : '',
      `Trend takip göstergelerinden ${followersUp} tanesi yükseliş, ${followersDown} tanesi düşüş tarafında: Parabolic SAR ${sar.up ? 'yükseliş' : 'düşüş'} modunda (${sar.since} gündür)${st ? `, Supertrend ${st.up ? `${money(st.value)} seviyesinde destek veriyor` : `${money(st.value)} seviyesinde direnç oluşturuyor`}` : ''}${ich ? `, fiyat Ichimoku bulutunun ${px > ich.cloudTop ? 'üzerinde' : px < ich.cloudBottom ? 'altında' : 'içinde (kararsız bölge)'}` : ''}.`,
      `Kısa vadede EMA 9 ${emaUp ? 'EMA 21\'in üzerinde' : 'EMA 21\'in altında'}${emaCross ? ` (kesişim ${emaCross.ago === 0 ? 'bugün' : `${emaCross.ago} gün önce`})` : ''}; MACD sinyal çizgisinin ${macdUp ? 'üzerinde' : 'altında'} ve histogram ${histUp ? 'genişliyor, ivme artıyor' : 'daralıyor, ivme azalıyor'}.${ar ? ` Aroon (↑${num(ar.up)} / ↓${num(ar.down)}) ${ar.up > ar.down ? 'zirvelerin diplerden daha taze olduğunu' : 'diplerin zirvelerden daha taze olduğunu'} gösteriyor.` : ''}`
    ].filter(Boolean);

    const obVals = [
      ['RSI', r >= 70, r <= 30], ['Stokastik', k >= 80, k <= 20], ['Stokastik RSI', sk != null && sk >= 80, sk != null && sk <= 20],
      ['CCI', cc >= 100, cc <= -100], ['Williams %R', w >= -20, w <= -80], ['Ultimate Osc.', uo >= 70, uo <= 30]
    ];
    const overbought = obVals.filter(x => x[1]).map(x => x[0]);
    const oversold = obVals.filter(x => x[2]).map(x => x[0]);
    const momentumText = [
      `RSI ${num(r)} ile ${r >= 70 ? 'aşırı alım' : r <= 30 ? 'aşırı satım' : r >= 50 ? 'nötrün yükseliş tarafında' : 'nötrün düşüş tarafında'}; son 5 günde ${num(r5)} seviyesinden ${r >= r5 ? 'yükseldi' : 'geriledi'}. Stokastik %K ${num(k)}${sk != null ? `, Stokastik RSI ${num(sk)}` : ''}.`,
      overbought.length
        ? `${overbought.length} osilatör aşırı alım bölgesinde (${overbought.join(', ')}). ${scores.trend > 0.12 ? 'Güçlü yükseliş trendlerinde osilatörler uzun süre aşırı alımda kalabilir; bu tek başına dönüş sinyali değildir, ancak kısa vadeli dinlenme veya düzeltme riskini artırır.' : 'Trend desteği zayıfken aşırı alım, yükselişin yorulduğuna işaret edebilir.'}`
        : oversold.length
          ? `${oversold.length} osilatör aşırı satım bölgesinde (${oversold.join(', ')}). ${scores.trend < -0.12 ? 'Düşüş trendlerinde aşırı satım uzun sürebilir; tepki yükselişleri için fiyatın kısa vadeli ortalamaların üzerine çıkması gibi bir teyit beklenir.' : 'Trend nötr ya da olumluyken aşırı satım, tepki alımları için zemin oluşturabilir.'}`
          : 'Osilatörlerin hiçbiri uç bölgede değil; momentum tarafında aşırılık yok.',
      `Değişim hızı (ROC 12) ${rc >= 0 ? '+' : '-'}${pct(rc)} ve Ultimate Oscillator ${num(uo)}; ${rc >= 0 && uo >= 50 ? 'kısa ve orta vadeli momentum aynı yönde, olumlu' : rc < 0 && uo < 50 ? 'kısa ve orta vadeli momentum aynı yönde, olumsuz' : 'kısa ve orta vadeli momentum farklı yönlere işaret ediyor'}.`
    ];

    const volumeText = [];
    if (hasVolume) {
      const mf = Ind.mfi(h, l, c, v), cm = Ind.cmf(h, l, c, v), vw = Ind.vwap(h, l, c, v), vr = Ind.volumeRatio(v);
      volumeText.push(
        `Son 20 işlem gününde fiyat ${pct(px20)} ${px20 >= 0 ? 'yükselirken' : 'gerilerken'} OBV ${obSlope >= 0 ? 'arttı' : 'azaldı'}. ${obvDiverge ? 'Fiyat ve hacim birbirini teyit etmiyor (uyumsuzluk); bu, mevcut hareketin zayıfladığına dair erken bir uyarı olabilir.' : 'Fiyat hareketi hacimle teyit ediliyor.'}`,
        `Para akışı tarafında MFI ${num(mf)} ve Chaikin Para Akışı ${num(cm)}: ${cm > 0.05 && mf >= 50 ? 'hisseye net para girişi ve birikim görülüyor' : cm < -0.05 && mf < 50 ? 'hisseden net para çıkışı ve dağıtım görülüyor' : 'giriş ve çıkış belirgin bir üstünlük kurmuyor'}.`,
        `Fiyat, son 20 günün hacim ağırlıklı ortalama fiyatının (VWAP ${money(vw)}) ${px > vw ? 'üzerinde; bu dönemde alanların çoğu kârda' : 'altında; bu dönemde alanların çoğu zararda, yükselişlerde satış baskısı görülebilir'}.${vr != null ? ` Son günün hacmi ortalamanın ${num(vr)} katı${vr >= 1.5 ? '; harekete güçlü katılım var' : vr < 0.7 ? '; katılım zayıf, hareketin güvenilirliği düşük' : ''}.` : ''}`
      );
    } else {
      volumeText.push('Bu hisse için hacim verisi gelmediğinden hacim ve para akışı göstergeleri hesaplanamadı.');
    }

    // Support / resistance candidates from several independent methods
    const cand = [
      ['Pivot S1', pv.s1], ['Pivot S2', pv.s2], ['Pivot R1', pv.r1], ['Pivot R2', pv.r2],
      ['Bollinger alt bandı', bL], ['Bollinger üst bandı', bU],
      ['20 günlük dip', dc.lower], ['20 günlük zirve', dc.upper],
      ['SMA 50', ma[50]], ['SMA 200', ma[200]],
      ['52 haftalık dip', lo52], ['52 haftalık zirve', hi52]
    ];
    if (st) cand.push(['Supertrend', st.value]);
    if (ich) cand.push(['Ichimoku bulut üstü', ich.cloudTop], ['Ichimoku bulut altı', ich.cloudBottom]);
    const supports = cand.filter(([, x]) => x != null && x < px).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const resistances = cand.filter(([, x]) => x != null && x > px).sort((a, b) => a[1] - b[1]).slice(0, 3);

    const volText = [
      `Günlük ortalama gerçek aralık (ATR) ${money(atr)}, yani fiyatın yaklaşık %${num(aPct)} kadarı; bu ${aPct < 2 ? 'düşük' : aPct < 4 ? 'orta' : 'yüksek'} bir oynaklık düzeyidir. ${aPct >= 4 ? 'Pozisyon büyüklüğü ve zarar-kes mesafesi bu oynaklığa göre ayarlanmalıdır.' : ''}`.trim(),
      `Bollinger bant genişliği %${num(bWidth)}${narrowest ? '; son 6 ayın en dar seviyelerine yakın' : ''}${squeeze ? ' ve bantlar Keltner kanalının içinde (sıkışma). Sıkışmalar genellikle sert bir hareketle çözülür; yönü kırılımın tarafı belirler' : ''}. Fiyat %B ${num(pctB * 100)} ile bantların ${pctB > 1 ? 'üzerinde' : pctB < 0 ? 'altında' : pctB >= 0.5 ? 'üst yarısında' : 'alt yarısında'}.`,
      `52 haftalık aralıkta (${money(lo52)} – ${money(hi52)}) fiyat %${num(rangePos)} konumunda${rangePos >= 90 ? '; zirveye çok yakın' : rangePos <= 10 ? '; dibe çok yakın' : ''}.`
    ];

    // Oscillators count oversold as "buy", so in a falling market momentum would read "positive";
    // when several sit at an extreme, say so instead of a plain tone.
    const momentumTone = oversold.length >= 2 ? 'aşırı satım (tepki potansiyeli)'
      : overbought.length >= 2 ? 'aşırı alım (düzeltme riski)' : toneOf(scores.momentum);
    const scoreLine = `Trend ${toneOf(scores.trend)}, momentum ${momentumTone}, hacim ve para akışı ${hasVolume ? toneOf(scores.volume) : 'hesaplanamadı'}.`;
    let synthesis;
    if (scores.trend > 0.12 && scores.momentum >= -0.12 && (!hasVolume || scores.volume > 0)) {
      synthesis = 'Trend, momentum ve hacim aynı yönde; yükseliş teknik olarak teyitli görünüyor. Bu tabloda düzeltmeler genellikle kısa vadeli ortalamalara (SMA 20, Supertrend) doğru gelir ve bu seviyeler destek olarak izlenir.';
    } else if (scores.trend > 0.12 && hasVolume && scores.volume < -0.12) {
      synthesis = 'Fiyat trendi olumlu ancak para akışı zayıf; yükseliş hacimle teyit edilmiyor. Bu tür ayrışmalar trend yorgunluğunun ilk işaretlerinden biri olabilir.';
    } else if (scores.trend > 0.12 && scores.momentum < -0.12) {
      synthesis = 'Ana trend yukarı ama kısa vadeli momentum zayıflıyor; trend içinde bir dinlenme/düzeltme evresi olabilir.';
    } else if (scores.trend < -0.12 && scores.momentum > 0.12) {
      synthesis = 'Ana trend aşağı, kısa vadeli momentum ise toparlanma işareti veriyor. Düşüş trendlerinde bu tür tepkiler sık görülür; kalıcılığı için fiyatın SMA 50 ve Ichimoku bulutu üzerine çıkması gibi teyitler beklenir.';
    } else if (scores.trend < -0.12) {
      synthesis = 'Trend ve momentum ağırlıkla olumsuz; teknik görünüm düşüş yönünde. Dönüş için önce kısa vadeli ortalamaların geri alınması ve satış hacminin azalması gerekir.';
    } else {
      synthesis = 'Göstergeler belirgin bir yön üzerinde uzlaşmıyor; hisse yatay / kararsız bir evrede. Bu evrelerde kanal sınırlarının (Donchian, Bollinger) hangi yönde kırılacağı belirleyici olur.';
    }

    const watch = [];
    if (resistances[0]) watch.push(`${resistances[0][0]} (${money(resistances[0][1])}) üzerinde kapanış yukarı yönlü görünümü güçlendirir.`);
    if (supports[0]) watch.push(`${supports[0][0]} (${money(supports[0][1])}) altında kapanış kısa vadeli yapıyı bozar.`);
    if (ma[200] != null) watch.push(`SMA 200 (${money(ma[200])}) ana trendin sınırıdır; fiyat şu an ${px > ma[200] ? 'üzerinde' : 'altında'}.`);
    if (overbought.length >= 3) watch.push('Osilatörlerdeki aşırı alımın, fiyat düşmeden (zamanla) mı yoksa fiyat düşerek mi eriyeceği.');
    if (oversold.length >= 3) watch.push('Aşırı satımdan çıkışın hacimle gelip gelmediği.');
    if (obvDiverge && hasVolume) watch.push('Fiyat ile OBV arasındaki uyumsuzluğun giderilip giderilmediği.');
    if (squeeze) watch.push('Bollinger–Keltner sıkışmasının hangi yönde çözüleceği.');

    const report = {
      verdict, ratio, scores,
      overview: `${dir.length} yönlü göstergenin ${buy} tanesi alım, ${sell} tanesi satım, ${neutral} tanesi nötr sinyal veriyor; ağırlıklı konsensüs ${verdict.label}. ${scoreLine}`,
      sections: [
        { key: 'trend', title: 'Trend Analizi', score: scores.trend, tone: toneOf(scores.trend), text: trendText },
        { key: 'momentum', title: 'Momentum ve Osilatörler', score: oversold.length >= 2 || overbought.length >= 2 ? 0 : scores.momentum, tone: momentumTone, text: momentumText },
        { key: 'volume', title: 'Hacim ve Para Akışı', score: scores.volume, tone: hasVolume ? toneOf(scores.volume) : 'veri yok', text: volumeText },
        { key: 'volatility', title: 'Volatilite, Destek ve Direnç', score: scores.volatility, tone: aPct < 2 ? 'düşük oynaklık' : aPct < 4 ? 'orta oynaklık' : 'yüksek oynaklık', text: volText }
      ],
      supports: supports.map(([name, x]) => ({ name, value: x, dist: (x / px - 1) * 100 })),
      resistances: resistances.map(([name, x]) => ({ name, value: x, dist: (x / px - 1) * 100 })),
      synthesis,
      watch
    };

    return {
      rows, groups: GROUPS, verdict, buy, sell, neutral, commentary, report, rsi: r,
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
