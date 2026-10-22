/**
 * Pure technical-indicator math shared by the page (technicals.js) and the tests
 * (test/indicators.test.mjs). No DOM, no fetch.
 *
 * Inputs are plain arrays of daily bars, oldest first: h (high), l (low), c (close), v (volume).
 * Series functions return an array of the same length with null during the warm-up; "last"
 * functions return the value for the newest bar (null when there is not enough history).
 */
(function (root) {
  const sum = a => a.reduce((s, x) => s + x, 0);
  const lastOf = a => a[a.length - 1];
  const hh = (a, from, to) => Math.max(...a.slice(from, to));
  const ll = (a, from, to) => Math.min(...a.slice(from, to));

  /* ---------- moving averages ---------- */

  function sma(values, n) {
    const out = new Array(values.length).fill(null);
    let s = 0;
    for (let i = 0; i < values.length; i++) {
      s += values[i];
      if (i >= n) s -= values[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  }

  /** EMA seeded with the SMA of the first n values. */
  function ema(values, n) {
    const out = new Array(values.length).fill(null);
    const a = 2 / (n + 1);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      if (i === n - 1) {
        prev = sum(values.slice(0, n)) / n;
        out[i] = prev;
      } else if (i >= n) {
        prev = values[i] * a + prev * (1 - a);
        out[i] = prev;
      }
    }
    return out;
  }

  /* ---------- classic oscillators ---------- */

  /** Wilder's RSI. */
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

  function macd(closes, fast = 12, slow = 26, signal = 9) {
    const f = ema(closes, fast), s = ema(closes, slow);
    const line = closes.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
    const start = line.findIndex(v => v != null);
    const sig = new Array(closes.length).fill(null);
    if (start >= 0) ema(line.slice(start), signal).forEach((v, i) => { sig[start + i] = v; });
    const histogram = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
    return { line, signal: sig, histogram };
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
    return { mid, upper, lower };
  }

  function stochastic(h, l, c, n = 14, d = 3) {
    const k = c.map((x, i) => {
      if (i < n - 1) return null;
      const hi = hh(h, i - n + 1, i + 1), lo = ll(l, i - n + 1, i + 1);
      return hi === lo ? 50 : (x - lo) / (hi - lo) * 100;
    });
    const dLine = new Array(k.length).fill(null);
    for (let i = d - 1; i < k.length; i++) {
      const win = k.slice(i - d + 1, i + 1);
      if (win.every(v => v != null)) dLine[i] = sum(win) / d;
    }
    return { k, d: dLine };
  }

  /** Stochastic RSI: where RSI sits inside its own n-bar range, smoothed (%K) and signal (%D). */
  function stochRsi(c, n = 14, smoothK = 3, smoothD = 3) {
    const r = rsi(c, n);
    const raw = r.map((v, i) => {
      if (v == null || i < 2 * n - 1) return null;
      const win = r.slice(i - n + 1, i + 1);
      if (win.some(x => x == null)) return null;
      const hi = Math.max(...win), lo = Math.min(...win);
      return hi === lo ? 50 : (v - lo) / (hi - lo) * 100;
    });
    const smooth = (a, m) => a.map((_, i) => {
      if (i < m - 1) return null;
      const win = a.slice(i - m + 1, i + 1);
      return win.every(x => x != null) ? sum(win) / m : null;
    });
    const k = smooth(raw, smoothK);
    return { k, d: smooth(k, smoothD) };
  }

  function cci(h, l, c, n = 20) {
    if (c.length < n) return null;
    const tp = c.map((_, i) => (h[i] + l[i] + c[i]) / 3);
    const win = tp.slice(-n);
    const mean = sum(win) / n;
    const dev = sum(win.map(x => Math.abs(x - mean))) / n;
    return dev === 0 ? 0 : (lastOf(tp) - mean) / (0.015 * dev);
  }

  function williamsR(h, l, c, n = 14) {
    if (c.length < n) return null;
    const hi = hh(h, -n), lo = ll(l, -n);
    return hi === lo ? -50 : (hi - lastOf(c)) / (hi - lo) * -100;
  }

  /** Rate of change over n bars, in percent. */
  function roc(c, n = 12) {
    if (c.length <= n || !c[c.length - 1 - n]) return null;
    return (lastOf(c) / c[c.length - 1 - n] - 1) * 100;
  }

  /** Ultimate Oscillator (7, 14, 28). */
  function ultimateOscillator(h, l, c, a = 7, b = 14, d = 28) {
    if (c.length <= d) return null;
    const bp = [], tr = [];
    for (let i = 1; i < c.length; i++) {
      const lo = Math.min(l[i], c[i - 1]), hi = Math.max(h[i], c[i - 1]);
      bp.push(c[i] - lo);
      tr.push(hi - lo);
    }
    const avg = n => { const t = sum(tr.slice(-n)); return t ? sum(bp.slice(-n)) / t : 0.5; };
    return 100 * (4 * avg(a) + 2 * avg(b) + avg(d)) / 7;
  }

  /* ---------- trend ---------- */

  function trueRange(h, l, c) {
    return c.map((_, i) => (i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
  }

  /** Wilder's ATR as a series (first value at index n). */
  function atrSeries(h, l, c, n = 14) {
    const tr = trueRange(h, l, c);
    const out = new Array(c.length).fill(null);
    if (c.length <= n) return out;
    let v = sum(tr.slice(1, n + 1)) / n;
    out[n] = v;
    for (let i = n + 1; i < c.length; i++) { v = (v * (n - 1) + tr[i]) / n; out[i] = v; }
    return out;
  }

  /** Wilder's ADX with +DI / -DI for the newest bar. */
  function adx(h, l, c, n = 14) {
    if (c.length < 2 * n + 1) return null;
    const tr = trueRange(h, l, c);
    let sTR = 0, sP = 0, sM = 0, adxV = null;
    const dx = [];
    let plusDI = 0, minusDI = 0;
    for (let i = 1; i < c.length; i++) {
      const up = h[i] - h[i - 1], down = l[i - 1] - l[i];
      const pDM = up > down && up > 0 ? up : 0;
      const mDM = down > up && down > 0 ? down : 0;
      if (i <= n) {
        sTR += tr[i]; sP += pDM; sM += mDM;
        if (i < n) continue;
      } else {
        sTR = sTR - sTR / n + tr[i]; sP = sP - sP / n + pDM; sM = sM - sM / n + mDM;
      }
      plusDI = sTR ? 100 * sP / sTR : 0;
      minusDI = sTR ? 100 * sM / sTR : 0;
      const x = plusDI + minusDI ? 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI) : 0;
      dx.push(x);
      if (dx.length === n) adxV = sum(dx) / n;
      else if (dx.length > n) adxV = (adxV * (n - 1) + x) / n;
    }
    return adxV == null ? null : { adx: adxV, plusDI, minusDI };
  }

  /** Parabolic SAR for the newest bar; `since` is how many bars ago the trend last flipped. */
  function parabolicSar(h, l, step = 0.02, max = 0.2) {
    if (h.length < 3) return null;
    let up = h[1] + l[1] >= h[0] + l[0];
    let sar = up ? Math.min(l[0], l[1]) : Math.max(h[0], h[1]);
    let ep = up ? Math.max(h[0], h[1]) : Math.min(l[0], l[1]);
    let af = step, flip = 1;
    for (let i = 2; i < h.length; i++) {
      sar += af * (ep - sar);
      if (up) {
        sar = Math.min(sar, l[i - 1], l[i - 2]);
        if (l[i] < sar) { up = false; sar = ep; ep = l[i]; af = step; flip = i; }
        else if (h[i] > ep) { ep = h[i]; af = Math.min(af + step, max); }
      } else {
        sar = Math.max(sar, h[i - 1], h[i - 2]);
        if (h[i] > sar) { up = true; sar = ep; ep = h[i]; af = step; flip = i; }
        else if (l[i] < ep) { ep = l[i]; af = Math.min(af + step, max); }
      }
    }
    return { sar, up, since: h.length - 1 - flip };
  }

  /** Supertrend (ATR n, multiplier m) for the newest bar; `since` = bars since the last flip. */
  function supertrend(h, l, c, n = 10, m = 3) {
    const atr = atrSeries(h, l, c, n);
    let fU = null, fL = null, up = true, flip = n;
    for (let i = n; i < c.length; i++) {
      const mid = (h[i] + l[i]) / 2;
      const bU = mid + m * atr[i], bL = mid - m * atr[i];
      if (fU == null) { fU = bU; fL = bL; up = c[i] >= mid; continue; }
      fU = bU < fU || c[i - 1] > fU ? bU : fU;
      fL = bL > fL || c[i - 1] < fL ? bL : fL;
      if (up && c[i] < fL) { up = false; flip = i; }
      else if (!up && c[i] > fU) { up = true; flip = i; }
    }
    if (fU == null) return null;
    return { value: up ? fL : fU, up, since: c.length - 1 - flip };
  }

  /**
   * Ichimoku (9, 26, 52) for the newest bar. The cloud under today's price was projected 26 bars
   * ago, so spanA/spanB use the bars that ended 26 sessions back.
   */
  function ichimoku(h, l, c, t = 9, k = 26, s = 52) {
    if (c.length < s + k) return null;
    const mid = (n, end) => (hh(h, end - n, end) + ll(l, end - n, end)) / 2;
    const end = c.length, past = c.length - k;
    const tenkan = mid(t, end), kijun = mid(k, end);
    const spanA = (mid(t, past) + mid(k, past)) / 2;
    const spanB = mid(s, past);
    return { tenkan, kijun, spanA, spanB, cloudTop: Math.max(spanA, spanB), cloudBottom: Math.min(spanA, spanB) };
  }

  /** Aroon up/down (n): how recently the n-bar high and low were set, 100 = this bar. */
  function aroon(h, l, n = 25) {
    if (h.length < n + 1) return null;
    const wh = h.slice(-(n + 1)), wl = l.slice(-(n + 1));
    const iHi = wh.lastIndexOf(Math.max(...wh)), iLo = wl.lastIndexOf(Math.min(...wl));
    return { up: iHi / n * 100, down: iLo / n * 100 };
  }

  /** Donchian channel over the n bars before the newest one, so a breakout can be seen. */
  function donchian(h, l, n = 20) {
    if (h.length < n + 1) return null;
    return { upper: hh(h, -(n + 1), -1), lower: ll(l, -(n + 1), -1) };
  }

  function keltner(h, l, c, n = 20, atrN = 10, m = 2) {
    const mid = lastOf(ema(c, n)), a = lastOf(atrSeries(h, l, c, atrN));
    if (mid == null || a == null) return null;
    return { mid, upper: mid + m * a, lower: mid - m * a };
  }

  /* ---------- volume ---------- */

  function obv(c, v) {
    const out = [0];
    for (let i = 1; i < c.length; i++) out.push(out[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0));
    return out;
  }

  /** Money Flow Index (volume-weighted RSI). */
  function mfi(h, l, c, v, n = 14) {
    if (c.length <= n) return null;
    const tp = c.map((_, i) => (h[i] + l[i] + c[i]) / 3);
    let pos = 0, neg = 0;
    for (let i = c.length - n; i < c.length; i++) {
      const flow = tp[i] * v[i];
      if (tp[i] > tp[i - 1]) pos += flow; else if (tp[i] < tp[i - 1]) neg += flow;
    }
    if (neg === 0) return pos === 0 ? 50 : 100;
    return 100 - 100 / (1 + pos / neg);
  }

  /** Chaikin Money Flow: where closes fall inside each bar's range, volume-weighted, -1..+1. */
  function cmf(h, l, c, v, n = 20) {
    if (c.length < n) return null;
    let mfv = 0, vol = 0;
    for (let i = c.length - n; i < c.length; i++) {
      const range = h[i] - l[i];
      mfv += range ? ((c[i] - l[i]) - (h[i] - c[i])) / range * v[i] : 0;
      vol += v[i];
    }
    return vol ? mfv / vol : null;
  }

  /** Volume-weighted average price over the last n daily bars. */
  function vwap(h, l, c, v, n = 20) {
    if (c.length < n) return null;
    let pv = 0, vol = 0;
    for (let i = c.length - n; i < c.length; i++) { pv += (h[i] + l[i] + c[i]) / 3 * v[i]; vol += v[i]; }
    return vol ? pv / vol : null;
  }

  /** Newest bar's volume against the average of the n bars before it. */
  function volumeRatio(v, n = 20) {
    if (v.length < n + 1) return null;
    const avg = sum(v.slice(-(n + 1), -1)) / n;
    return avg ? lastOf(v) / avg : null;
  }

  /* ---------- levels ---------- */

  /** Classic floor pivots from the newest completed bar. */
  function pivots(h, l, c) {
    const H = lastOf(h), L = lastOf(l), C = lastOf(c);
    const p = (H + L + C) / 3;
    return { p, r1: 2 * p - L, s1: 2 * p - H, r2: p + (H - L), s2: p - (H - L) };
  }

  /** Bars since `fast` last crossed `slow` (within `bars`), and the direction; null if none. */
  function lastCross(fast, slow, bars = 5) {
    const last = fast.length - 1;
    for (let i = last; i > last - bars && i > 0; i--) {
      if ([fast[i], slow[i], fast[i - 1], slow[i - 1]].some(x => x == null)) return null;
      if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) return { dir: 'up', ago: last - i };
      if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) return { dir: 'down', ago: last - i };
    }
    return null;
  }

  const Ind = {
    sma, ema, rsi, macd, bollinger, stochastic, stochRsi, cci, williamsR, roc, ultimateOscillator,
    trueRange, atrSeries, adx, parabolicSar, supertrend, ichimoku, aroon, donchian, keltner,
    obv, mfi, cmf, vwap, volumeRatio, pivots, lastCross
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ind;
  else root.Ind = Ind;
})(typeof window !== 'undefined' ? window : globalThis);
