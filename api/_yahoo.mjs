// Shared helpers for the Yahoo Finance endpoints (files starting with "_" are not routed by Vercel).

export const SPECIAL = {
  BIST100: 'XU100.IS',
  USDTRY: 'USDTRY=X',
  EURTRY: 'EURTRY=X',
  ALTIN: 'GC=F',
  BRENT: 'BZ=F'
};

export function toYahoo(key) {
  if (SPECIAL[key]) return SPECIAL[key];
  return /^[A-Z0-9]{2,6}$/.test(key) ? `${key}.IS` : null;
}

export async function yahooChart(yahooSymbol, params, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const qs = new URLSearchParams(params).toString();
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?${qs}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal }
    );
    if (!r.ok) return null;
    return (await r.json())?.chart?.result?.[0] ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
