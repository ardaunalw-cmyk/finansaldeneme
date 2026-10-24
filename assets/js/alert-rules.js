/**
 * Alert conditions, shared by the page (app.js checks them while the site is open) and the
 * scheduled e-mail check (scripts/check-alerts.mjs). Pure: no DOM, no storage, no network.
 *
 * An alert is { id, ticker, type, targetValue, note, triggered, triggeredAt, email? }. Price and
 * RSI alerts compare against targetValue; the cross alerts look at the last two daily closes,
 * so they fire on the bar where the cross happened (targetValue is the SMA period for the
 * price/SMA crosses and unused for the rest).
 */
(function (root) {
  const Ind = root.Ind || (typeof require === 'function' ? require('./indicators.js') : null);

  /** label: the condition list; value: what targetValue holds ('price', 'rsi', 'period' or null). */
  const TYPES = {
    price_above: { label: 'Fiyat >= Hedef', value: 'price' },
    price_below: { label: 'Fiyat <= Hedef', value: 'price' },
    rsi_above: { label: 'RSI >= Hedef', value: 'rsi' },
    rsi_below: { label: 'RSI <= Hedef', value: 'rsi' },
    sma_cross_up: { label: 'Fiyat SMA üzerine çıkarsa', value: 'period' },
    sma_cross_down: { label: 'Fiyat SMA altına inerse', value: 'period' },
    golden_cross: { label: 'Golden cross (SMA 50, SMA 200 üstüne)', value: null },
    death_cross: { label: 'Death cross (SMA 50, SMA 200 altına)', value: null },
    macd_cross_up: { label: 'MACD sinyali yukarı keserse', value: null },
    macd_cross_down: { label: 'MACD sinyali aşağı keserse', value: null }
  };

  const fmt = (v, d = 2) => Number(v).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });

  /** True when targetValue is usable for this type (a price, an RSI level, an SMA period, or none needed). */
  function validTarget(type, value) {
    const t = TYPES[type];
    if (!t) return false;
    const v = Number(value);
    if (t.value === null) return true;
    if (t.value === 'rsi') return v > 0 && v < 100;
    if (t.value === 'period') return Number.isInteger(v) && v >= 2 && v <= 400;
    return v > 0;
  }

  /** Whether the condition needs daily closes (everything but plain price alerts). */
  const needsCloses = type => !!TYPES[type] && TYPES[type].value !== 'price';

  /** a crossed b between the last two values: up = from at-or-below to above. */
  function crossed(a, b, up) {
    const n = Math.min(a.length, b.length);
    if (n < 2) return false;
    const [a0, a1, b0, b1] = [a[n - 2], a[n - 1], b[n - 2], b[n - 1]];
    if ([a0, a1, b0, b1].some(x => x == null || !Number.isFinite(x))) return false;
    return up ? a0 <= b0 && a1 > b1 : a0 >= b0 && a1 < b1;
  }

  /**
   * { hit: true, text } when the alert's condition holds now, else null.
   * market: { price, rsi?, closes? } with closes the daily closes, oldest first, the last one
   * being today's; rsi defaults to RSI 14 of closes.
   */
  function evaluate(alert, market) {
    const t = alert && TYPES[alert.type];
    if (!t || alert.triggered) return null;
    const val = Number(alert.targetValue);
    const price = Number(market && market.price);
    const closes = (market && market.closes ? market.closes : []).filter(Number.isFinite);
    const hit = text => ({ hit: true, text });
    switch (alert.type) {
      case 'price_above': return price > 0 && price >= val ? hit(`Fiyat hedefe ulaştı: ₺${fmt(price)} (hedef ₺${fmt(val)})`) : null;
      case 'price_below': return price > 0 && price <= val ? hit(`Fiyat hedefe indi: ₺${fmt(price)} (hedef ₺${fmt(val)})`) : null;
      case 'rsi_above':
      case 'rsi_below': {
        let rsi = Number(market && market.rsi);
        if (!Number.isFinite(rsi) || !rsi) { const s = Ind.rsi(closes); rsi = s.length ? s[s.length - 1] : null; }
        if (rsi == null || !Number.isFinite(rsi)) return null;
        if (alert.type === 'rsi_above' && rsi >= val) return hit(`RSI aşırı alım seviyesine ulaştı: ${fmt(rsi, 1)} (hedef ${val})`);
        if (alert.type === 'rsi_below' && rsi <= val) return hit(`RSI aşırı satım seviyesine indi: ${fmt(rsi, 1)} (hedef ${val})`);
        return null;
      }
      case 'sma_cross_up':
      case 'sma_cross_down': {
        const up = alert.type === 'sma_cross_up';
        if (closes.length < val + 1 || !crossed(closes, Ind.sma(closes, val), up)) return null;
        return hit(`Fiyat SMA ${val} ${up ? 'üzerine çıktı' : 'altına indi'}: ₺${fmt(closes[closes.length - 1])}`);
      }
      case 'golden_cross':
      case 'death_cross': {
        const up = alert.type === 'golden_cross';
        if (closes.length < 201 || !crossed(Ind.sma(closes, 50), Ind.sma(closes, 200), up)) return null;
        return hit(up ? 'Golden cross: SMA 50, SMA 200\'ün üzerine çıktı' : 'Death cross: SMA 50, SMA 200\'ün altına indi');
      }
      case 'macd_cross_up':
      case 'macd_cross_down': {
        const up = alert.type === 'macd_cross_up';
        const m = Ind.macd(closes, 12, 26, 9);
        if (!crossed(m.line, m.signal, up)) return null;
        return hit(`MACD, sinyal çizgisini ${up ? 'yukarı (al sinyali)' : 'aşağı (sat sinyali)'} kesti`);
      }
      default: return null;
    }
  }

  /** Short badge for the alert list, e.g. "RSI <= 30" or "Fiyat SMA 50 üzerine". */
  function badge(alert) {
    const v = alert.targetValue;
    switch (alert.type) {
      case 'price_above': return 'Fiyat >= Hedef';
      case 'price_below': return 'Fiyat <= Hedef';
      case 'rsi_above': return 'RSI >= Hedef';
      case 'rsi_below': return 'RSI <= Hedef';
      case 'sma_cross_up': return `Fiyat ↑ SMA ${v}`;
      case 'sma_cross_down': return `Fiyat ↓ SMA ${v}`;
      case 'golden_cross': return 'Golden cross';
      case 'death_cross': return 'Death cross';
      case 'macd_cross_up': return 'MACD ↑ sinyal';
      case 'macd_cross_down': return 'MACD ↓ sinyal';
      default: return alert.type;
    }
  }

  const AlertRules = { TYPES, validTarget, needsCloses, crossed, evaluate, badge };
  if (typeof module !== 'undefined' && module.exports) module.exports = AlertRules;
  else root.AlertRules = AlertRules;
})(typeof window !== 'undefined' ? window : globalThis);
