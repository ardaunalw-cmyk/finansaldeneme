/**
 * ==============================================================================
 * ONCAL - core controller: views, search, overview table, stock page, charts
 * ==============================================================================
 * Market and balance-sheet figures come only from real sources (live-data.js,
 * statements.js, technicals.js, dividends.js). Where a figure cannot be fetched or
 * computed, the page shows '—' instead of a generated value.
 * ==============================================================================
 */

// Application Global State
const appState = {
  currentStock: 'THYAO',
  currentCompanyData: null,
  activeView: 'overview',
  charts: {}
};

// Global shorthand for window access
window.charts = appState.charts;

/* ==============================================================================
   0. THE ECONOMIST INTRO SPLASH & TRADINGVIEW LOGO SYSTEM
   ============================================================================== */

let introSplashTimeout = null;
let introProgressInterval = null;
let introCanvasAnimationId = null;
let introFailsafeTimeout = null;
let introWavePhase = 0;
let _cachedIntroW = 780;
let _cachedIntroH = 280;
let _lastZoneKey = '';

/**
 * Initializes and continuously renders the dynamic fluctuating Price & RSI wave
 * across the RSI 70 (Overbought), RSI 50 (Median), and RSI 30 (Oversold) bands.
 * Highly optimized for 60-120fps with zero layout thrashing on mobile devices.
 */
function startIntroRsiAnimation() {
  const canvas = document.getElementById('introSplashCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (introCanvasAnimationId) {
    cancelAnimationFrame(introCanvasAnimationId);
    introCanvasAnimationId = null;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    _cachedIntroW = rect.width > 0 ? rect.width : 780;
    _cachedIntroH = rect.height > 0 ? rect.height : 280;
    canvas.width = Math.round(_cachedIntroW * dpr);
    canvas.height = Math.round(_cachedIntroH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resizeCanvas();

  // Cached DOM elements to avoid queries every frame
  const fibValText = document.getElementById('introFibValText');
  const rsiValText = document.getElementById('introRsiValText');
  const zoneLabel = document.getElementById('introFibZoneLabel');
  let frameCounter = 0;

  function drawFrame() {
    const splash = document.getElementById('introSplashScreen');
    if (!splash || splash.style.display === 'none') {
      if (introCanvasAnimationId) {
        cancelAnimationFrame(introCanvasAnimationId);
        introCanvasAnimationId = null;
      }
      return;
    }

    const width = _cachedIntroW;
    const height = _cachedIntroH;

    ctx.clearRect(0, 0, width, height);

    // Vertical bounds mapping with compact padding for responsive heights
    const padTop = 15;
    const padBottom = 15;
    const usableH = height - padTop - padBottom;
    const getY = (val) => padTop + usableH * (1 - val / 100);

    // Quantitative Fibonacci Retracement Levels (0.0% to 100.0%)
    const fibLevels = [
      { pct: 100.0, label: 'FIB 100.0% [ZİRVE DİRENCİ]', color: 'rgba(255, 255, 255, 0.45)', dash: [5, 5], width: 1.1 },
      { pct: 78.6,  label: 'FIB 78.6% [DERİN DÜZELTME]', color: 'rgba(251, 113, 133, 0.65)', dash: [4, 4], width: 1.1 },
      { pct: 61.8,  label: 'FIB 61.8% [ALTIN ORAN - GOLDEN RATIO]', color: 'rgba(251, 191, 36, 0.90)', dash: [6, 3], width: 1.6, isGolden: true },
      { pct: 50.0,  label: 'FIB 50.0% [MEDYAN DENGE / EQUILIBRIUM]', color: 'rgba(255, 255, 255, 0.70)', dash: [3, 3], width: 1.3 },
      { pct: 38.2,  label: 'FIB 38.2% [BİRİNCİL DESTEK / SUPPORT]', color: 'rgba(52, 211, 153, 0.85)', dash: [5, 4], width: 1.5 },
      { pct: 23.6,  label: 'FIB 23.6% [ARA DESTEK EŞİĞİ]', color: 'rgba(56, 189, 248, 0.55)', dash: [4, 4], width: 1.1 },
      { pct: 0.0,   label: 'FIB 0.0% [SWING LOW / DİP DESTEĞİ]', color: 'rgba(255, 255, 255, 0.45)', dash: [5, 5], width: 1.1 }
    ];

    const y618 = getY(61.8);
    const y500 = getY(50.0);
    const y382 = getY(38.2);
    const y236 = getY(23.6);

    // 1. Shaded Fibonacci Golden Pocket (50.0% - 61.8%)
    ctx.fillStyle = 'rgba(251, 191, 36, 0.08)';
    ctx.fillRect(0, y618, width, y500 - y618);

    // 2. Shaded Fibonacci Support Accumulation Pocket (23.6% - 38.2%)
    ctx.fillStyle = 'rgba(52, 211, 153, 0.06)';
    ctx.fillRect(0, y382, width, y236 - y382);

    // 3. Draw All Fibonacci Retracement Grid Lines & Typography
    fibLevels.forEach(fib => {
      const y = getY(fib.pct);

      ctx.beginPath();
      ctx.setLineDash(fib.dash);
      ctx.strokeStyle = fib.color;
      ctx.lineWidth = fib.width;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      // Left-aligned institutional Fibonacci label
      ctx.font = fib.isGolden ? 'bold 8.5px monospace' : '8px monospace';
      ctx.fillStyle = fib.color;
      ctx.fillText(fib.label, 8, y - 3);

      // Right-aligned percentage badge
      ctx.font = 'bold 8.5px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`%${fib.pct.toFixed(1)}`, width - 8, y - 3);
      ctx.textAlign = 'left';
    });

    // 4. Multi-Harmonic Japanese Candlestick Chart Engine with Overlaying White Trendline
    ctx.setLineDash([]);
    const points = [];
    const numCandles = Math.min(Math.max(Math.floor(width / 22), 24), 38);
    const stepX = width / numCandles;
    const candleWidth = Math.max(stepX * 0.62, 4);

    introWavePhase += 0.032;

    // First Pass: Compute Candle Geometries (Open, High, Low, Close)
    const candles = [];
    for (let i = 0; i < numCandles; i++) {
      const x = (i + 0.5) * stepX;
      const angle = (i / numCandles) * 3.6 * Math.PI;

      // Realistic macro wave cycle with golden ratio harmonics
      const wave = Math.sin(angle - introWavePhase) * 25
                 + Math.cos(angle * 1.618 + introWavePhase * 0.7) * 11
                 + Math.sin(angle * 2.618 - introWavePhase * 1.2) * 5;
      const trendValue = Math.min(Math.max(50 + wave, 10), 92);

      const nextAngle = ((i + 1) / numCandles) * 3.6 * Math.PI;
      const nextWave = Math.sin(nextAngle - introWavePhase) * 25
                     + Math.cos(nextAngle * 1.618 + introWavePhase * 0.7) * 11
                     + Math.sin(nextAngle * 2.618 - introWavePhase * 1.2) * 5;
      const nextTrend = Math.min(Math.max(50 + nextWave, 10), 92);
      const delta = nextTrend - trendValue;

      // Realistic Open and Close prices with micro-fluctuations
      const openVal = Math.min(Math.max(trendValue - delta * 0.4 + Math.sin(i * 4.3 + introWavePhase) * 1.6, 8), 94);
      const closeVal = Math.min(Math.max(trendValue + delta * 0.6 + Math.cos(i * 3.7 + introWavePhase) * 1.6, 8), 94);
      const isBullish = closeVal >= openVal;

      const bodyMax = Math.max(openVal, closeVal);
      const bodyMin = Math.min(openVal, closeVal);

      // Upper and Lower Shadow Wicks
      const wickUp = 1.2 + Math.abs(Math.sin(i * 2.8 + introWavePhase * 1.4)) * 4.2;
      const wickDown = 1.2 + Math.abs(Math.cos(i * 3.4 + introWavePhase * 1.2)) * 4.2;
      const highVal = Math.min(bodyMax + wickUp, 98);
      const lowVal = Math.max(bodyMin - wickDown, 4);

      const yOpen = getY(openVal);
      const yClose = getY(closeVal);
      const yHigh = getY(highVal);
      const yLow = getY(lowVal);

      candles.push({
        x,
        openVal,
        closeVal,
        highVal,
        lowVal,
        isBullish,
        yOpen,
        yClose,
        yHigh,
        yLow,
        bodyY: Math.min(yOpen, yClose),
        bodyH: Math.max(Math.abs(yClose - yOpen), 2.5)
      });

      points.push({ x, y: yClose, fib: closeVal, rsi: closeVal });
    }

    // 5. Draw Japanese Candlesticks (Wicks and Bodies)
    candles.forEach(c => {
      const candleColor = c.isBullish ? '#10B981' : '#F43F5E';
      const candleFill = c.isBullish ? 'rgba(16, 185, 129, 0.90)' : 'rgba(244, 63, 94, 0.90)';

      // Draw Candlestick Wick (Upper & Lower Shadows)
      ctx.beginPath();
      ctx.moveTo(c.x, c.yHigh);
      ctx.lineTo(c.x, c.yLow);
      ctx.strokeStyle = candleColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Draw Candlestick Body Rectangle
      ctx.fillStyle = candleFill;
      ctx.fillRect(c.x - candleWidth / 2, c.bodyY, candleWidth, c.bodyH);

      // Candlestick Body Stroke Outline
      ctx.strokeStyle = candleColor;
      ctx.lineWidth = 1.0;
      ctx.strokeRect(c.x - candleWidth / 2, c.bodyY, candleWidth, c.bodyH);
    });

    // 6. Luminous Gradient Fill Under the White Line
    const grad = ctx.createLinearGradient(0, padTop, 0, height);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.06)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.00)');

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 7. PURE WHITE GLOWING SPLINE LINE PASSING DIRECTLY OVER CANDLESTICKS (#FFFFFF)
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.lineWidth = 2.8;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();

    // 8. Latest Point & Live Radiant White Pulse Ring
    const last = points[points.length - 1];
    const pulseR = 4.5 + Math.sin(introWavePhase * 4) * 3;

    ctx.beginPath();
    ctx.arc(last.x, last.y, Math.max(pulseR, 3), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    // 9. Throttled UI Updates (Every 4 frames ~65ms to eliminate layout thrashing)
    frameCounter++;
    if (frameCounter % 4 === 0) {
      if (fibValText) {
        fibValText.textContent = `%${last.fib.toFixed(1)}`;
        if (last.fib >= 61.8 && last.fib <= 78.6) fibValText.className = 'text-amber-400 font-mono font-black';
        else if (last.fib < 38.2) fibValText.className = 'text-emerald-400 font-mono font-black';
        else fibValText.className = 'text-white font-mono font-black';
      }

      if (rsiValText) {
        rsiValText.textContent = last.rsi.toFixed(1);
        if (last.rsi >= 70) rsiValText.className = 'text-rose-400 font-mono font-bold';
        else if (last.rsi <= 30) rsiValText.className = 'text-emerald-400 font-mono font-bold';
        else rsiValText.className = 'text-white font-mono font-bold';
      }

      if (zoneLabel) {
        let curKey = '';
        if (last.fib >= 78.6) curKey = 'peak';
        else if (last.fib >= 50.0 && last.fib <= 61.8) curKey = 'golden';
        else if (last.fib >= 61.8) curKey = 'expansion';
        else if (last.fib >= 38.2) curKey = 'channel';
        else if (last.fib >= 23.6) curKey = 'support';
        else curKey = 'bottom';

        if (curKey !== _lastZoneKey) {
          _lastZoneKey = curKey;
          if (curKey === 'peak') {
            zoneLabel.innerHTML = '<span class="text-rose-400 font-bold flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-rose-400 animate-ping"></span> Zirve Direnç Testi (Fib %78.6 - %100.0)</span>';
          } else if (curKey === 'golden') {
            zoneLabel.innerHTML = '<span class="text-amber-400 font-bold flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span> Altın Cephe (Golden Pocket %50.0 - %61.8)</span>';
          } else if (curKey === 'expansion') {
            zoneLabel.innerHTML = '<span class="text-amber-300 font-bold flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-amber-300"></span> Altın Oran Genişleme Bölgesi (Fib %61.8+)</span>';
          } else if (curKey === 'channel') {
            zoneLabel.innerHTML = '<span class="text-white font-bold flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-white"></span> Denge & Konsolidasyon Kanalı (Fib %38.2 - %50.0)</span>';
          } else if (curKey === 'support') {
            zoneLabel.innerHTML = '<span class="text-emerald-400 font-bold flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Birincil Destek Arama Bölgesi (Fib %23.6 - %38.2)</span>';
          } else {
            zoneLabel.innerHTML = '<span class="text-emerald-300 font-bold flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span> Dip Desteği & Tepki Alım Potansiyeli (Fib < %23.6)</span>';
          }
        }
      }
    }

    introCanvasAnimationId = requestAnimationFrame(drawFrame);
  }

  introCanvasAnimationId = requestAnimationFrame(drawFrame);
}

function stopIntroRsiAnimation() {
  if (introCanvasAnimationId) {
    cancelAnimationFrame(introCanvasAnimationId);
    introCanvasAnimationId = null;
  }
}

/**
 * Subtle institutional boot chime synthesized via Web Audio API.
 * Autoplay policies are handled gracefully (non-blocking fallback).
 */
function playTerminalBootChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(659.25, now); // E5
    osc.frequency.exponentialRampToValueAtTime(880.00, now + 0.09); // A5
    osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.18); // C6
    gain.gain.setValueAtTime(0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.50);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.51);
  } catch (e) {
    // Silently proceed
  }
}

/**
 * Updates the 5 micro-stage indicators below the progress bar.
 */
function updateIntroStepDots(activeDotIndex) {
  const dots = document.querySelectorAll('#introStepDots .intro-dot');
  dots.forEach((dot, idx) => {
    if (idx < activeDotIndex) {
      dot.className = 'intro-dot w-2 h-2 rounded-full bg-emerald-400 transition-all duration-300 shadow-[0_0_8px_rgba(52,211,153,0.8)]';
    } else if (idx === activeDotIndex) {
      dot.className = 'intro-dot w-2 h-2 rounded-full bg-[#2F6BFF] scale-125 transition-all duration-300 shadow-[0_0_10px_rgba(47,107,255,1)]';
    } else {
      dot.className = 'intro-dot w-2 h-2 rounded-full bg-slate-800 transition-all duration-300';
    }
  });
}

// Cinematic Light Burst Intro Toggle
const ENABLE_INTRO_SPLASH = true;

function playIntroSplash() {
  const splash = document.getElementById('introSplashScreen');
  if (!ENABLE_INTRO_SPLASH || !splash) {
    dismissIntroSplash();
    return;
  }

  splash.classList.remove('splash-exit');
  splash.style.display = 'flex';
  splash.style.opacity = '1';
  splash.style.pointerEvents = 'auto';

  // Instant cinematic light burst auto-transition at 650ms (Zero Lag)
  clearTimeout(introSplashTimeout);
  introSplashTimeout = setTimeout(() => {
    dismissIntroSplash();
  }, 650);

  // Bulletproof Failsafe Timer
  clearTimeout(introFailsafeTimeout);
  introFailsafeTimeout = setTimeout(() => {
    dismissIntroSplash();
  }, 950);
}

function dismissIntroSplash() {
  clearTimeout(introSplashTimeout);
  clearTimeout(introFailsafeTimeout);
  const splash = document.getElementById('introSplashScreen');
  if (!splash) return;
  splash.classList.add('splash-exit');
  splash.style.opacity = '0';
  splash.style.pointerEvents = 'none';
  setTimeout(() => {
    splash.style.display = 'none';
    splash.classList.remove('splash-exit');
  }, 260);
}

function replayIntroAnimation() {
  const splash = document.getElementById('introSplashScreen');
  if (!splash) return;
  const core = splash.querySelector('.intro-light-core');
  const beam = splash.querySelector('.intro-light-beam');
  const reveal = splash.querySelector('.intro-logo-reveal');
  [core, beam, reveal].forEach(el => {
    if (el) {
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    }
  });
  playIntroSplash();
}

function replayIntroAnimation() {
  playIntroSplash();
}

window.startIntroRsiAnimation = startIntroRsiAnimation;
window.stopIntroRsiAnimation = stopIntroRsiAnimation;

/**
 * Curated Vector Logos for BIST Leaders (SVG format)
 */
const STOCK_LOGOS_DB = {
  THYAO: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#C8102E"/><circle cx="50" cy="50" r="38" fill="none" stroke="#FFF" stroke-width="3"/><path d="M26 56 C38 50 56 44 76 28 C64 38 48 45 34 49 C48 42 66 33 80 20 C66 32 48 40 34 44 C48 35 68 26 84 15 C66 30 42 42 24 47 C20 48 20 54 26 56 Z" fill="#FFF"/></svg>`,
  GARAN: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#004D25"/><circle cx="38" cy="38" r="14" fill="#69BE28"/><circle cx="62" cy="38" r="14" fill="#69BE28"/><circle cx="38" cy="62" r="14" fill="#69BE28"/><circle cx="62" cy="62" r="14" fill="#69BE28"/><circle cx="50" cy="50" r="8" fill="#004D25"/><path d="M50 50 L50 78" stroke="#004D25" stroke-width="4"/></svg>`,
  AKBNK: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#E20613"/><path d="M22 25 L45 25 L78 75 L55 75 Z" fill="#FFF"/><path d="M45 25 L68 25 L35 75 L12 75 Z" fill="#FFF"/></svg>`,
  ISCTR: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#002D72"/><circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="3"/><text x="50" y="66" font-family="'Inter', sans-serif" font-weight="900" font-size="50" fill="#FFF" text-anchor="middle">İŞ</text></svg>`,
  ASELS: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#0A1E3F"/><polygon points="50,15 85,32 85,68 50,85 15,68 15,32" fill="none" stroke="#00A3E0" stroke-width="5"/><circle cx="50" cy="50" r="14" fill="#00A3E0"/><circle cx="50" cy="50" r="26" fill="none" stroke="rgba(0,163,224,0.4)" stroke-width="2"/></svg>`,
  TUPRS: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#0F2042"/><path d="M50 16 C35 36 24 54 24 68 C24 82 36 88 50 88 C64 88 76 82 76 68 C76 54 65 36 50 16 Z" fill="#D31145"/><path d="M50 40 C42 54 38 64 38 72 C38 80 44 84 50 84 C56 84 62 80 62 72 C62 64 58 54 50 40 Z" fill="#FFF"/></svg>`,
  EREGL: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#1C2833"/><polygon points="20,76 80,76 68,38 32,38" fill="#E65100"/><rect x="36" y="20" width="28" height="14" rx="4" fill="#FFB74D"/><line x1="28" y1="58" x2="72" y2="58" stroke="#FFD54F" stroke-width="3"/></svg>`,
  KCHOL: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#A80000"/><path d="M26 44 C26 26 42 20 50 34 C58 20 74 26 74 44 C74 64 50 78 50 78 C50 78 26 64 26 44 Z" fill="#FFF"/><circle cx="50" cy="46" r="8" fill="#A80000"/></svg>`,
  SAHOL: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#003399"/><path d="M28 22 Q52 42 28 62 Q64 62 64 42 Q64 22 28 22 Z" fill="#FFF"/><path d="M44 42 Q68 62 44 82 Q80 82 80 62 Q80 42 44 42 Z" fill="#FFCC00"/></svg>`,
  SISE: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#0B2538"/><polygon points="50,14 86,38 72,84 28,84 14,38" fill="none" stroke="#00D2FF" stroke-width="5"/><polygon points="50,28 72,44 62,72 38,72 28,44" fill="#00D2FF" opacity="0.6"/></svg>`,
  BIMAS: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#004B93"/><rect x="18" y="26" width="64" height="48" rx="8" fill="#D32F2F"/><text x="50" y="60" font-family="'Inter', sans-serif" font-weight="900" font-size="34" fill="#FFF" text-anchor="middle">BİM</text></svg>`,
  FROTO: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#002C6C"/><ellipse cx="50" cy="50" rx="42" ry="26" fill="none" stroke="#FFF" stroke-width="4"/><text x="50" y="58" font-family="'Playfair Display', Georgia, serif" font-weight="900" font-style="italic" font-size="28" fill="#FFF" text-anchor="middle">Ford</text></svg>`,
  TOASO: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#8B0000"/><circle cx="50" cy="50" r="34" fill="none" stroke="#FFF" stroke-width="4"/><circle cx="50" cy="50" r="14" fill="#FFF"/><line x1="16" y1="50" x2="84" y2="50" stroke="#FFF" stroke-width="4"/><line x1="50" y1="16" x2="50" y2="84" stroke="#FFF" stroke-width="4"/></svg>`,
  TCELL: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#002D72"/><circle cx="45" cy="56" r="22" fill="#FFD100"/><circle cx="64" cy="38" r="10" fill="#FFD100"/><circle cx="34" cy="32" r="8" fill="#FFD100"/><circle cx="45" cy="56" r="10" fill="#002D72"/></svg>`,
  TTKOM: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#002B49"/><path d="M22 66 Q50 28 78 66" fill="none" stroke="#00B5E2" stroke-width="7" stroke-linecap="round"/><path d="M32 50 Q50 24 68 50" fill="none" stroke="#FFF" stroke-width="6" stroke-linecap="round"/><circle cx="50" cy="74" r="5" fill="#00B5E2"/></svg>`,
  PGSUS: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#F9A825"/><path d="M18 64 L46 34 L76 34 L54 64 Z" fill="#C62828"/><path d="M38 34 L58 16 L82 16 L62 34 Z" fill="#212121"/></svg>`,
  ASTOR: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#0E1B33"/><polygon points="56,14 26,52 48,52 42,86 76,44 54,44" fill="#FFB703"/><polygon points="52,22 34,50 48,50 44,76 68,44 54,44" fill="#FFF" opacity="0.6"/></svg>`,
  ENKAI: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#0A2240"/><polygon points="50,18 84,42 84,82 16,82 16,42" fill="none" stroke="#3A86FF" stroke-width="6"/><line x1="50" y1="18" x2="50" y2="82" stroke="#3A86FF" stroke-width="4"/><line x1="16" y1="82" x2="84" y2="82" stroke="#3A86FF" stroke-width="6"/></svg>`,
  OYAKC: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#212529"/><polygon points="50,18 82,78 18,78" fill="#D32F2F"/><text x="50" y="66" font-family="'Inter', sans-serif" font-weight="900" font-size="32" fill="#FFF" text-anchor="middle">O</text></svg>`,
  KRDMD: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#1C2321"/><polygon points="30,82 70,82 60,28 40,28" fill="#E64A19"/><circle cx="50" cy="20" r="7" fill="#FFB300"/><line x1="36" y1="56" x2="64" y2="56" stroke="#FFF" stroke-width="3"/></svg>`,
  PETKM: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#004D80"/><polygon points="50,16 82,34 82,70 50,88 18,70 18,34" fill="none" stroke="#FFF" stroke-width="5"/><circle cx="50" cy="52" r="12" fill="#64B5F6"/></svg>`,
  MGROS: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#FF6D00"/><text x="50" y="72" font-family="'Inter', sans-serif" font-weight="900" font-size="64" fill="#FFF" text-anchor="middle">M</text></svg>`,
  ULKER: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#C62828"/><path d="M50 78 C25 60 18 40 28 28 C38 16 50 30 50 30 C50 30 62 16 72 28 C82 40 75 60 50 78 Z" fill="#FFF"/></svg>`,
  YKBNK: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#002D72"/><path d="M30 76 Q50 18 70 76" fill="none" stroke="#FFD100" stroke-width="8" stroke-linecap="round"/><circle cx="50" cy="34" r="8" fill="#FFD100"/></svg>`,
  VAKBN: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#FDB813"/><text x="50" y="66" font-family="'Inter', sans-serif" font-weight="900" font-size="44" fill="#1A1A1A" text-anchor="middle">VB</text></svg>`,
  HALKB: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#00796B"/><circle cx="50" cy="50" r="32" fill="none" stroke="#FFF" stroke-width="6"/><circle cx="50" cy="50" r="14" fill="#FFF"/></svg>`,
  KONTR: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#0B132B"/><circle cx="50" cy="50" r="16" fill="#00E5FF"/><line x1="50" y1="14" x2="50" y2="34" stroke="#00E5FF" stroke-width="5"/><line x1="50" y1="66" x2="50" y2="86" stroke="#00E5FF" stroke-width="5"/><line x1="14" y1="50" x2="34" y2="50" stroke="#00E5FF" stroke-width="5"/><line x1="66" y1="50" x2="86" y2="50" stroke="#00E5FF" stroke-width="5"/></svg>`,
  SMRTG: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#1C3144"/><circle cx="50" cy="50" r="18" fill="#FFBA08"/><line x1="50" y1="16" x2="50" y2="24" stroke="#FFBA08" stroke-width="4"/><line x1="50" y1="76" x2="50" y2="84" stroke="#FFBA08" stroke-width="4"/><line x1="16" y1="50" x2="24" y2="50" stroke="#FFBA08" stroke-width="4"/><line x1="76" y1="50" x2="84" y2="50" stroke="#FFBA08" stroke-width="4"/></svg>`,
  EUPWR: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#091833"/><polygon points="56,12 28,50 48,50 42,88 74,44 52,44" fill="#00F5D4"/></svg>`,
  CWENE: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#003566"/><circle cx="50" cy="50" r="28" fill="none" stroke="#FFD60A" stroke-width="6"/><circle cx="50" cy="50" r="10" fill="#FFD60A"/></svg>`,
  ALARK: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#1B263B"/><path d="M26 50 A24 24 0 0 1 74 50" fill="none" stroke="#2EC4B6" stroke-width="7"/><path d="M34 50 A16 16 0 0 0 66 50" fill="none" stroke="#E71D36" stroke-width="6"/></svg>`,
  TAVHL: `<svg viewBox="0 0 100 100" class="w-full h-full"><rect width="100" height="100" rx="20" fill="#0D3B66"/><polygon points="50,14 58,44 88,50 58,56 50,86 42,56 12,50 42,44" fill="#38BDF8"/></svg>`
};

/**
 * Deterministic TradingView Harmonic Palettes for 1000+ BIST companies
 */
const TV_HARMONIC_GRADIENTS = [
  { bg: 'linear-gradient(135deg, #1E3A8A 0%, #0F172A 100%)', text: '#93C5FD', glow: '0 2px 10px rgba(30, 58, 138, 0.4)' },
  { bg: 'linear-gradient(135deg, #065F46 0%, #064E3B 100%)', text: '#6EE7B7', glow: '0 2px 10px rgba(6, 95, 70, 0.4)' },
  { bg: 'linear-gradient(135deg, #991B1B 0%, #450A0A 100%)', text: '#FCA5A5', glow: '0 2px 10px rgba(153, 27, 27, 0.4)' },
  { bg: 'linear-gradient(135deg, #581C87 0%, #3B0764 100%)', text: '#D8B4FE', glow: '0 2px 10px rgba(88, 28, 135, 0.4)' },
  { bg: 'linear-gradient(135deg, #075985 0%, #082F49 100%)', text: '#7DD3FC', glow: '0 2px 10px rgba(7, 89, 133, 0.4)' },
  { bg: 'linear-gradient(135deg, #9A3412 0%, #431407 100%)', text: '#FDBA74', glow: '0 2px 10px rgba(154, 52, 18, 0.4)' },
  { bg: 'linear-gradient(135deg, #374151 0%, #111827 100%)', text: '#E5E7EB', glow: '0 2px 10px rgba(55, 65, 81, 0.4)' },
  { bg: 'linear-gradient(135deg, #831843 0%, #500724 100%)', text: '#F472B6', glow: '0 2px 10px rgba(131, 24, 67, 0.4)' },
  { bg: 'linear-gradient(135deg, #164E63 0%, #083344 100%)', text: '#67E8F9', glow: '0 2px 10px rgba(22, 78, 99, 0.4)' },
  { bg: 'linear-gradient(135deg, #3F3F46 0%, #18181B 100%)', text: '#D4D4D8', glow: '0 2px 10px rgba(63, 63, 70, 0.4)' },
  { bg: 'linear-gradient(135deg, #312E81 0%, #1E1B4B 100%)', text: '#A5B4FC', glow: '0 2px 10px rgba(49, 46, 129, 0.4)' },
  { bg: 'linear-gradient(135deg, #713F12 0%, #422006 100%)', text: '#FDE047', glow: '0 2px 10px rgba(113, 63, 18, 0.4)' },
  { bg: 'linear-gradient(135deg, #115E59 0%, #042F2E 100%)', text: '#5EEAD4', glow: '0 2px 10px rgba(17, 94, 89, 0.4)' },
  { bg: 'linear-gradient(135deg, #701A75 0%, #4A044E 100%)', text: '#F0ABFC', glow: '0 2px 10px rgba(112, 26, 117, 0.4)' },
  { bg: 'linear-gradient(135deg, #1E293B 0%, #020617 100%)', text: '#94A3B8', glow: '0 2px 10px rgba(30, 41, 59, 0.4)' },
  { bg: 'linear-gradient(135deg, #1D4ED8 0%, #172554 100%)', text: '#BFDBFE', glow: '0 2px 10px rgba(29, 78, 216, 0.4)' }
];

/**
 * Returns corporate logo HTML avatar for any of the 1048 BIST stocks.
 * Uses custom SVG for key companies or TradingView deterministic harmonic badge.
 */
function getStockLogoHtml(ticker, size = 32, extraClass = '') {
  const code = (ticker || '').toUpperCase().trim();
  const radius = Math.max(6, Math.round(size * 0.22));

  // Real company logo (site icon) laid over the fallback badge; removed if it fails to load
  const domain = (typeof STOCK_LOGO_DOMAINS !== 'undefined') ? STOCK_LOGO_DOMAINS[code] : '';
  const realLogo = domain
    ? `<img class="tv-real-logo" src="https://www.google.com/s2/favicons?domain=${domain}&sz=128" alt="" loading="lazy" referrerpolicy="no-referrer" onload="if(this.naturalWidth<=16)this.remove();else this.classList.add('is-loaded')" onerror="this.remove()">`
    : '';

  if (STOCK_LOGOS_DB[code]) {
    return `
      <div class="tv-stock-logo ${extraClass}" style="width:${size}px; height:${size}px; min-width:${size}px; border-radius:${radius}px;">
        ${STOCK_LOGOS_DB[code]}${realLogo}
      </div>
    `;
  }

  // Deterministic Hash
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = (hash << 5) - hash + code.charCodeAt(i);
    hash |= 0;
  }
  const grad = TV_HARMONIC_GRADIENTS[Math.abs(hash) % TV_HARMONIC_GRADIENTS.length];
  
  // Dynamic font sizing based on ticker character count
  let fontSize = Math.round(size * 0.38);
  if (code.length === 5) fontSize = Math.round(size * 0.30);
  else if (code.length >= 6) fontSize = Math.round(size * 0.25);

  return `
    <div class="tv-stock-logo ${extraClass}" style="width:${size}px; height:${size}px; min-width:${size}px; border-radius:${radius}px; background:${grad.bg}; color:${grad.text}; box-shadow:${grad.glow};">
      <span style="font-size:${fontSize}px; line-height:1; font-weight:800; font-family:var(--font-tv); letter-spacing:-0.03em;">${code}</span>${realLogo}
    </div>
  `;
}

/* ==============================================================================
   0.5. Addresses: /hisse/KOD for a stock page, /#view for the other views
   (vercel.json rewrites every non-API path to index.html; <base href="/"> keeps assets working)
   ============================================================================== */
const STOCK_PATH = /^\/hisse\/([A-Za-z0-9]{2,8})\/?$/;
const BASE_TITLE = document.title;
let applyingUrl = false;   // true while the page follows the address (load, back/forward): nothing is pushed

function routeFromUrl() {
  const m = window.location.pathname.match(STOCK_PATH);
  if (m) return { view: 'stock-detail', code: m[1].toLocaleUpperCase('tr-TR') };
  return { view: decodeURIComponent(window.location.hash.replace('#', '')) || 'home', code: null };
}

function urlForView(view) {
  if (view === 'stock-detail' && appState.currentStock) return `/hisse/${encodeURIComponent(appState.currentStock)}`;
  return view === 'home' ? '/' : `/#${view}`;
}

/** Puts the current view in the address bar; 'push' for a click (a history entry), 'replace' otherwise. */
function syncUrl(mode = 'push') {
  if (applyingUrl) return;
  const url = urlForView(appState.activeView);
  if (window.location.pathname + window.location.hash !== url) {
    try { window.history[mode === 'replace' ? 'replaceState' : 'pushState']({ view: appState.activeView }, '', url); } catch (e) { /* sandboxed frame */ }
  }
  updateDocumentTitle();
}

function updateDocumentTitle(name) {
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = `${window.location.origin}${appState.activeView === 'stock-detail' ? urlForView('stock-detail') : '/'}`;
  if (appState.activeView !== 'stock-detail') { document.title = BASE_TITLE; return; }
  const code = appState.currentStock;
  const company = name || (appState.currentCompanyData && appState.currentCompanyData.code === code ? appState.currentCompanyData.name : '');
  document.title = `${code}${company ? ` · ${company}` : ''} | ONCAL`;
}

window.addEventListener('popstate', () => {
  const route = routeFromUrl();
  applyingUrl = true;
  try { switchView(route.view, route.code); } finally { applyingUrl = false; }
  updateDocumentTitle();
});

/** Shares (or copies) the address of the stock page that is open. */
async function shareCurrentStock() {
  const url = `${window.location.origin}/hisse/${encodeURIComponent(appState.currentStock)}`;
  const name = appState.currentCompanyData ? appState.currentCompanyData.name : appState.currentStock;
  try {
    if (navigator.share) { await navigator.share({ title: `${appState.currentStock} · ONCAL`, text: `${name} analizi`, url }); return; }
    await navigator.clipboard.writeText(url);
    showToast(`Bağlantı kopyalandı: ${url}`);
  } catch (e) {
    if (e && e.name === 'AbortError') return;   // the viewer closed the share sheet
    showToast(url);
  }
}
window.shareCurrentStock = shareCurrentStock;

/* ==============================================================================
   1. Master Application Initializer
   ============================================================================== */
async function initApp() {
  playIntroSplash();

  // Escape key to dismiss intro splash immediately
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      dismissIntroSplash();
    }
  });

  try {
    initKapCompanyIndex();
    initClock();
    initNavigation();
    
    // Fast First Render: Switch view immediately without blocking on heavy charts
    const route = routeFromUrl();
    applyingUrl = true;
    try { switchView(route.view, route.code); } finally { applyingUrl = false; }
    syncUrl('replace');   // canonical form, e.g. /hisse/thyao -> /hisse/THYAO

    initSearch();
    initStockTableFilters();
    initIncomeStatementFilter();
    initSectorFilters();
    initNewsCenter();

    // Initialize Terminal Command Palette (Cmd+K / /)
    if (typeof initTerminalCommandPalette === 'function') initTerminalCommandPalette();

    // Initialize Persistent Watchlist & Price Alerts Engine
    if (typeof initWatchlistAndAlerts === 'function') initWatchlistAndAlerts();

    // Only the overview chart is built up front; every other view builds its
    // charts and tables the first time it is opened (see switchView).
    setTimeout(() => {
      try {
        initBistChart();
      } catch(e) {
        console.warn('Deferred init error:', e);
      }
    }, 40);
  } catch (err) {
    console.warn('[ONCAL Init Warning]:', err);
  }
}

/* ==============================================================================
   2. KAP company registry and the per-stock data object
   ============================================================================== */

// High-Performance In-Memory Index Map for O(1) Instant Stock Queries & Global Financial Memoization Cache
const _kapCompanyMap = new Map();
const _stockFinMemoCache = new Map();

function initKapCompanyIndex() {
  if (typeof KAP_RAW_COMPANIES === 'undefined' || !Array.isArray(KAP_RAW_COMPANIES)) return;
  _kapCompanyMap.clear();
  for (let i = 0; i < KAP_RAW_COMPANIES.length; i++) {
    const c = KAP_RAW_COMPANIES[i];
    if (!c || !c.c) continue;
    if (c.c.includes(',')) {
      const parts = c.c.split(',');
      for (let j = 0; j < parts.length; j++) {
        const key = parts[j].trim().toUpperCase();
        if (key && !_kapCompanyMap.has(key)) {
          _kapCompanyMap.set(key, c);
        }
      }
    } else {
      const key = c.c.trim().toUpperCase();
      if (key && !_kapCompanyMap.has(key)) {
        _kapCompanyMap.set(key, c);
      }
    }
  }
}

/**
 * Searches and retrieves official KAP company metadata from KAP_RAW_COMPANIES in O(1) constant time.
 */
function getRawCompany(ticker) {
  if (!ticker) return null;
  const t = ticker.toUpperCase().trim();
  if (!_kapCompanyMap.size && typeof KAP_RAW_COMPANIES !== 'undefined' && Array.isArray(KAP_RAW_COMPANIES)) {
    initKapCompanyIndex();
  }
  return _kapCompanyMap.get(t) || null;
}

/**
 * Official Borsa Istanbul (BIST) Equity Market Tick Size Rules
 * @param {number} price Stock price in TRY
 * @returns {number} Tick size in TRY
 */
function getBistTickSize(price) {
  const p = Number(price) || 0;
  if (p < 20.00) return 0.01;
  if (p < 50.00) return 0.02;
  if (p < 100.00) return 0.05;
  return 0.10;
}
window.getBistTickSize = getBistTickSize;

/**
 * Formats financial monetary figures (Millions / Billions TL)
 */
// toLocaleString(locale, options) builds a new formatter on every call; reuse two instead
const _trFmt1 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const _trFmt0 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const _trFmt2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 });

function formatKapMoney(val) {
  if (Math.abs(val) >= 1000000000) {
    return `₺${_trFmt1.format(val / 1000000000)} Mlr`;
  } else if (Math.abs(val) >= 1000000) {
    return `₺${_trFmt0.format(val / 1000000)} Mn`;
  } else {
    return `₺${_trFmt0.format(val)}`;
  }
}

/**
 * The per-stock object every view reads from. It starts with the KAP registry facts only; every
 * market or balance-sheet figure stays empty ('—' / 'N/A') until real data fills it in:
 *   - price, change, ranges, volume: LiveData (Yahoo Finance quotes)
 *   - ratios, score, model value:    LiveData.applyFundamentals + VerityScore
 *   - quarterly series, statements:  Statements (KAP-based statements)
 */
function getOrGenerateStockFinancials(ticker = 'THYAO') {
  const t = (ticker || 'THYAO').toUpperCase().trim();
  if (_stockFinMemoCache.has(t)) {
    return _stockFinMemoCache.get(t);
  }

  const raw = getRawCompany(t) || {};
  const finObj = {
    code: t,
    name: raw.n || t,
    symbol: `${t}.IS`,
    sector: raw.sec || '',
    index: raw.idx || 'BIST TÜM',
    paidCapital: raw.cap || '—',
    paidCapitalRaw: raw.capRaw || null,
    capitalCeiling: raw.ceil || '—',
    city: raw.city || '—',
    auditor: raw.aud || '—',
    mkk: raw.mkk || '',
    kap: raw.kap || '',
    cc: raw.cc || '',
    price: '—',
    change: '',
    changeAmount: '',
    isPositive: true,
    volume: '—',
    fk: 'N/A',
    pddd: 'N/A',
    fdFavok: 'N/A',
    netDebt: 'N/A',
    roe: 'N/A',
    roa: 'N/A',
    score: null,
    scoreStatus: 'Bilanço verisi yok',
    scorePercentile: '',
    dayLow: '—',
    dayHigh: '—',
    yearLow: '—',
    yearHigh: '—',
    quarterly: { periods: [], revenue: [], favok: [], margin: [] },
    annualRevenue: '—',
    annualFavok: '—',
    netIncome: '—',
    projections: {},
    balanceSheet: null
  };

  _stockFinMemoCache.set(t, finObj);
  return finObj;
}

const MockFinancialApi = {
  /** BIST 100 trend from real price history; null when it cannot be fetched. */
  async fetchBistTrend(timeframe = '1G') {
    if (!window.TechData) return null;
    try { return await TechData.bist(timeframe); } catch (e) { console.warn('[BIST chart] real history unavailable:', e.message); return null; }
  },

  /** OHLCV and indicator series from real price history; null when it cannot be fetched. */
  async fetchTechnicalData(ticker = 'THYAO', timeframe = '1M') {
    if (!window.TechData) return null;
    try { return await TechData.stock(ticker, timeframe); } catch (e) { console.warn('[Technical] real history unavailable:', e.message); return null; }
  },

  /**
   * Fetches Full Financial Data for ANY BIST Ticker with real KAP values.
   */
  async fetchFinancials(ticker = 'THYAO') {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(getOrGenerateStockFinancials(ticker));
      }, 20);
    });
  },

  /**
   * Real sector median P/E and P/B (assets/data/sector-multiples.json), cheapest P/E first.
   * Sectors with fewer than SECTOR_CHART_MIN_N companies are left out: a median of a handful
   * of companies says little about the sector.
   */
  async fetchSectorMultipliers() {
    const res = await fetch('/assets/data/sector-multiples.json');
    if (!res.ok) throw new Error(`sector-multiples ${res.status}`);
    const json = await res.json();
    const note = document.getElementById('sectorMultiplesNote');
    if (note && json.generatedAt) {
      const on = new Date(json.generatedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
      // Keep the original caption so a second load does not append the date twice
      if (!note.dataset.base) note.dataset.base = note.textContent;
      note.textContent = `${note.dataset.base} · ${on} verisi`;
    }
    return Object.entries(json.sectors)
      .filter(([, s]) => s.n >= SECTOR_CHART_MIN_N && s.pe != null && s.pb != null)
      .map(([sector, s]) => ({ sector, fk: s.pe, pb: s.pb, n: s.n }))
      .sort((a, b) => a.fk - b.fk);
  }
};

const SECTOR_CHART_MIN_N = 8;


/* ==============================================================================
   3. Complete Chart.js (v4) Initializers for All 8 Canvases
   ============================================================================== */

/**
 * Initializes and wires all 8 master canvas elements.
 */
function initAllMasterCharts() {
  initBistChart();
  initStockIncomeChart();
  initSectorComparisonChart();
  initTechnicalCharts(appState.currentStock);
  initProjectionChart();
}

/** Point size, data-status badge and reference-level cards for the BIST 100 chart. */
function paintBistExtras(chart, data) {
  if (chart) {
    const ds = chart.data.datasets[0];
    const dense = data.data.length > 40;
    ds.pointRadius = dense ? 0 : 4;
    ds.pointHoverRadius = dense ? 4 : 6;
    ds.tension = dense ? 0.15 : 0.4;
    chart.update('none');
  }
  const badge = document.getElementById('bistChartBadge');
  if (badge) {
    badge.className = data.isReal ? 'data-badge live' : 'data-badge sample';
    badge.textContent = data.isReal ? 'GERÇEK VERİ · GECİKMELİ' : 'ÖRNEK VERİ';
  }
  if (data.isReal && data.levels) {
    const fmtLvl = v => `${Math.round(v).toLocaleString('tr-TR')} Puan`;
    const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = fmtLvl(v); };
    set('bistLvlSupport', data.levels.support);
    set('bistLvlResistance', data.levels.resistance);
    set('bistLvlMa20', data.levels.ma20);
    set('bistLvlMa200', data.levels.ma200);
  }
}

/**
 * 1. bistTrendChart: BIST 100 Real-Time Trend (Line/Area Chart)
 */
async function initBistChart() {
  const canvas = document.getElementById('bistTrendChart');
  if (!canvas) return;

  const data = await MockFinancialApi.fetchBistTrend('1G');
  if (!data) {
    const badge = document.getElementById('bistChartBadge');
    if (badge) { badge.className = 'data-badge sample'; badge.textContent = 'VERİ YOK'; }
    canvas.style.display = 'none';
    if (!canvas.parentElement.querySelector('.stmt-msg')) {
      canvas.parentElement.insertAdjacentHTML('beforeend', '<div class="stmt-msg">BIST 100 fiyat geçmişi şu an alınamadı.</div>');
    }
    return;
  }
  const ctx = canvas.getContext('2d');
  
  // brand cobalt Gradient (#2F6BFF)
  const gradient = ctx.createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, 'rgba(47, 107, 255, 0.35)');
  gradient.addColorStop(1, 'rgba(47, 107, 255, 0.00)');

  if (appState.charts.bist) {
    appState.charts.bist.destroy();
  }

  appState.charts.bist = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [
        {
          label: 'BIST 100 Endeksi',
          data: data.data,
          borderColor: '#2F6BFF',
          backgroundColor: gradient,
          fill: true,
          tension: 0.4,
          borderWidth: 2.5,
          pointBackgroundColor: '#2F6BFF',
          pointBorderColor: '#0E1626',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0E1626',
          borderColor: '#1E2B45',
          borderWidth: 1,
          titleColor: '#F8FAFC',
          bodyColor: '#93C5FD',
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: context => `Endeks: ${_trFmt2.format(context.parsed.y)} Puan`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Plus Jakarta Sans', size: 10 }, color: '#94A3B8' }
        },
        y: {
          grid: { color: '#1E2B45' },
          ticks: {
            font: { family: 'Plus Jakarta Sans', size: 10 },
            color: '#94A3B8',
            callback: value => value.toLocaleString('tr-TR')
          }
        }
      }
    }
  });

  paintBistExtras(appState.charts.bist, data);

  // Timeframe Switcher Hook
  document.querySelectorAll('.bist-timeframe-btn').forEach(btn => {
    btn.onclick = async () => {
      document.querySelectorAll('.bist-timeframe-btn').forEach(b => {
        b.classList.remove('bg-[#2F6BFF]', 'text-white', 'font-bold');
        b.classList.add('text-slate-400');
      });
      btn.classList.add('bg-[#2F6BFF]', 'text-white', 'font-bold');
      btn.classList.remove('text-slate-400');

      const tf = btn.textContent.trim();
      const updated = await MockFinancialApi.fetchBistTrend(tf);
      if (!updated) { showToast('BIST 100 fiyat geçmişi şu an alınamadı.'); return; }
      if (appState.charts.bist) {
        appState.charts.bist.data.labels = updated.labels;
        appState.charts.bist.data.datasets[0].data = updated.data;
        paintBistExtras(appState.charts.bist, updated);
        appState.charts.bist.update();
      }
    };
  });
}

/**
 * Technical tab: the interactive price chart (pro-chart.js) plus the price, change and
 * signal labels in its header, all from the same real price history.
 */
async function initTechnicalCharts(ticker = 'THYAO', retried = false) {
  if (!document.getElementById('proChart')) return;

  const techNote = document.getElementById('techDataNote');
  const [shown, tech] = await Promise.all([
    window.ProChart ? ProChart.load(ticker) : false,
    MockFinancialApi.fetchTechnicalData(ticker, '6M')
  ]);
  if (appState.currentStock !== ticker) return;

  if (!shown && !retried) {
    // One quiet retry: the history request sometimes fails while many quotes load at once
    setTimeout(() => { if (appState.currentStock === ticker) initTechnicalCharts(ticker, true); }, 4000);
    return;
  }
  if (!shown) {
    if (techNote) { techNote.className = 'data-badge sample'; techNote.textContent = 'VERİ ALINAMADI'; }
    return;
  }
  if (techNote) {
    techNote.className = 'data-badge live';
    techNote.textContent = 'GERÇEK GEÇMİŞ VERİ · YAHOO FINANCE · GECİKMELİ';
  }
  if (!tech) return;

  const priceLabel = document.getElementById('techCurrentPriceLabel');
  const changeLabel = document.getElementById('techCurrentChangeLabel');
  if (priceLabel) priceLabel.textContent = `₺${_trFmt2.format(tech.currentPrice)}`;
  if (changeLabel) changeLabel.textContent = tech.changePercent;

  const patName = document.getElementById('techPatternName');
  const patTarget = document.getElementById('techPatternTarget');
  const patReliability = document.getElementById('techPatternReliability');
  const patDesc = document.getElementById('techPatternDesc');
  if (patName) patName.textContent = tech.pattern.name;
  if (patTarget) patTarget.textContent = tech.pattern.target;
  if (patReliability) patReliability.textContent = tech.pattern.reliability;
  if (patDesc) patDesc.textContent = tech.pattern.desc;
}

/**
 * 4. stockIncomeChart: Quarterly Revenue, EBITDA Bar & Margin Line
 */
async function initStockIncomeChart() {
  const canvas = document.getElementById('stockIncomeChart');
  if (!canvas) return;

  const fin = await MockFinancialApi.fetchFinancials(appState.currentStock);
  if (window.Statements && !Statements.chartReady(fin)) { Statements.placeholder('stockIncomeChart'); return; }
  const q = fin.quarterly;

  if (appState.charts.stockIncome) {
    appState.charts.stockIncome.destroy();
  }

  appState.charts.stockIncome = new Chart(canvas.getContext('2d'), {
    data: {
      labels: q.periods,
      datasets: [
        {
          type: 'bar',
          label: (q.seriesLabels && q.seriesLabels[0]) || 'Satış Hasılatı',
          data: q.revenue,
          backgroundColor: '#2563EB', // royal blue
          borderRadius: 6,
          barPercentage: 0.5,
          categoryPercentage: 0.7,
          yAxisID: 'y'
        },
        {
          type: 'bar',
          label: (q.seriesLabels && q.seriesLabels[1]) || 'FAVÖK',
          data: q.favok,
          backgroundColor: '#38BDF8', // ice cyan
          borderRadius: 6,
          barPercentage: 0.5,
          categoryPercentage: 0.7,
          yAxisID: 'y'
        },
        {
          type: 'line',
          label: (q.seriesLabels && q.seriesLabels[2]) || 'FAVÖK Marjı (%)',
          data: q.margin,
          borderColor: '#10B981', // emerald-500
          backgroundColor: '#10B981',
          pointBackgroundColor: '#0E1626',
          pointBorderColor: '#10B981',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2.2,
          tension: 0.35,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0E1626',
          borderColor: '#1E2B45',
          borderWidth: 1,
          titleColor: '#F8FAFC',
          bodyColor: '#38BDF8',
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: function(context) {
              if (context.dataset.type === 'line') {
                return `${context.dataset.label}: %${context.parsed.y}`;
              }
              return `${context.dataset.label}: ₺${context.parsed.y} Mlr`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Plus Jakarta Sans', size: 10 }, color: '#94A3B8' }
        },
        y: {
          type: 'linear',
          position: 'left',
          grid: { color: '#1E2B45' },
          ticks: {
            font: { family: 'Plus Jakarta Sans', size: 10 },
            color: '#94A3B8',
            callback: v => `₺${v} Mlr`
          }
        },
        y1: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: {
            font: { family: 'Plus Jakarta Sans', size: 10 },
            color: '#10B981',
            callback: v => `%${v}`
          }
        }
      }
    }
  });

  // Wire Quarterly vs Annual Toggle Buttons
  const qBtn = document.getElementById('toggleQuarterly');
  const aBtn = document.getElementById('toggleAnnual');
  if (qBtn && aBtn) {
    qBtn.onclick = () => {
      qBtn.classList.add('bg-[#2F6BFF]', 'text-white', 'font-bold');
      qBtn.classList.remove('text-slate-400');
      aBtn.classList.remove('bg-[#2F6BFF]', 'text-white', 'font-bold');
      aBtn.classList.add('text-slate-400');

      if (appState.charts.stockIncome) {
        appState.charts.stockIncome.data.datasets[0].data = q.revenue;
        appState.charts.stockIncome.data.datasets[1].data = q.favok;
        appState.charts.stockIncome.data.datasets[2].data = q.margin;
        appState.charts.stockIncome.update();
      }
    };

    aBtn.onclick = () => {
      aBtn.classList.add('bg-[#2F6BFF]', 'text-white', 'font-bold');
      aBtn.classList.remove('text-slate-400');
      qBtn.classList.remove('bg-[#2F6BFF]', 'text-white', 'font-bold');
      qBtn.classList.add('text-slate-400');

      if (appState.charts.stockIncome) {
        const cumRev = q.revenue.map((v, i, arr) => 
          Math.round(arr.slice(0, i + 1).reduce((a, b) => a + b, 0) * 10) / 10
        );
        const cumFav = q.favok.map((v, i, arr) => 
          Math.round(arr.slice(0, i + 1).reduce((a, b) => a + b, 0) * 10) / 10
        );
        appState.charts.stockIncome.data.datasets[0].data = cumRev;
        appState.charts.stockIncome.data.datasets[1].data = cumFav;
        appState.charts.stockIncome.update();
      }
    };
  }
}

/**
 * 7. stockProjectionChart: Multi-Year DCF Growth & Projected Curve
 */
async function initProjectionChart() {
  const canvas = document.getElementById('stockProjectionChart');
  if (!canvas) return;

  const fin = await MockFinancialApi.fetchFinancials(appState.currentStock);
  if (window.Statements && !Statements.chartReady(fin)) { Statements.placeholder('stockProjectionChart'); return; }
  const proj = fin.projections;

  if (appState.charts.projection) {
    appState.charts.projection.destroy();
  }

  appState.charts.projection = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: proj.chart.labels,
      datasets: [
        {
          label: 'Gerçekleşen Çeyreklik Hasılat',
          data: proj.chart.historical,
          borderColor: '#2F6BFF', // brand cobalt
          backgroundColor: 'rgba(47, 107, 255, 0.15)',
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointBackgroundColor: '#2F6BFF',
          pointBorderColor: '#0E1626',
          pointRadius: 4
        },
        {
          label: 'Projeksiyon and Tahmin',
          data: proj.chart.projected,
          borderColor: '#38BDF8', // ice cyan
          borderDash: [5, 5],
          backgroundColor: 'rgba(56, 189, 248, 0.08)',
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointBackgroundColor: '#38BDF8',
          pointBorderColor: '#0E1626',
          pointRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0E1626',
          borderColor: '#1E2B45',
          borderWidth: 1,
          titleColor: '#F8FAFC',
          bodyColor: '#38BDF8',
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: function(context) {
              if (context.parsed.y === null) return '';
              return `${context.dataset.label}: ₺${context.parsed.y} Mlr`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Plus Jakarta Sans', size: 10 }, color: '#94A3B8' }
        },
        y: {
          grid: { color: '#1E2B45' },
          ticks: {
            font: { family: 'Plus Jakarta Sans', size: 10 },
            color: '#94A3B8',
            callback: v => `₺${v} Mlr`
          }
        }
      }
    }
  });
}

/**
 * 8. sectorComparisonChart: sector median P/E vs P/B, dual-axis bar chart
 */
async function initSectorComparisonChart() {
  const canvas = document.getElementById('sectorComparisonChart');
  if (!canvas) return;

  let sectors;
  try {
    sectors = await MockFinancialApi.fetchSectorMultipliers();
  } catch (e) {
    console.warn('[Sector chart] unavailable:', e.message);
    canvas.parentElement.innerHTML = '<div class="h-full flex items-center justify-center text-xs font-mono text-amber-400">Sektör çarpanları şu an yüklenemedi.</div>';
    return;
  }

  if (appState.charts.sector) {
    appState.charts.sector.destroy();
  }

  appState.charts.sector = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      // "Holding & Girişim Sermayesi" -> two lines, so long names don't collide on the axis
      labels: sectors.map(d => d.sector.split(' & ').map((p, i, a) => (i < a.length - 1 ? `${p} &` : p))),
      datasets: [
        {
          label: 'Medyan F/K',
          data: sectors.map(d => d.fk),
          backgroundColor: '#2F6BFF', // brand cobalt
          borderRadius: 6,
          barPercentage: 0.45,
          categoryPercentage: 0.8,
          yAxisID: 'y'
        },
        {
          label: 'Medyan PD/DD',
          data: sectors.map(d => d.pb),
          backgroundColor: '#38BDF8', // ice cyan
          borderRadius: 6,
          barPercentage: 0.45,
          categoryPercentage: 0.8,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0E1626',
          borderColor: '#1E2B45',
          borderWidth: 1,
          titleColor: '#F8FAFC',
          bodyColor: '#38BDF8',
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            title: items => sectors[items[0].dataIndex].sector,
            label: function(context) {
              const v = context.parsed.y.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              return context.datasetIndex === 0 ? `Medyan F/K: ${v}x` : `Medyan PD/DD: ${v}x`;
            },
            afterBody: items => `${sectors[items[0].dataIndex].n} şirket`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#94A3B8', font: { family: 'Plus Jakarta Sans', size: 10 } }
        },
        y: {
          type: 'linear',
          position: 'left',
          grid: { color: '#1E2B45' },
          ticks: { color: '#60A5FA', font: { size: 10 }, callback: v => `${v}x` }
        },
        y1: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#38BDF8', font: { size: 10 }, callback: v => `${v}x` }
        }
      }
    }
  });
}


/* ==============================================================================
   4. View Switcher & Lazy Canvas Resizer (Fixes 0x0 Invisible Canvas Bug)
   ============================================================================== */
function switchView(viewName, stockCode = null) {
  if (viewName && typeof viewName === 'string' && viewName.startsWith('view-')) {
    viewName = viewName.replace('view-', '');
  }

  if (viewName === 'hakkimizda' || viewName === 'hakkımızda') {
    viewName = 'about';
  }
  // The model portfolio view was removed; its correlation heatmap now lives in the reports view
  if (viewName === 'portfolio') viewName = 'reports';
  if (!document.getElementById(`view-${viewName}`)) viewName = 'home';

  if (stockCode) {
    appState.currentStock = stockCode.toUpperCase();
  }

  appState.activeView = viewName;
  syncUrl('push');
  document.body.classList.toggle('is-home', viewName === 'home');
  closeSiteMenu();

  // 1. Toggle visibility classes
  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  const targetPanel = document.getElementById(`view-${viewName}`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }

  // 2. Update navigation active state
  document.querySelectorAll('[data-view-target]').forEach(link => {
    if (link.getAttribute('data-view-target') === viewName) {
      link.classList.add('nav-tab-active');
      link.classList.remove('text-slate-400', 'text-slate-600');
    } else {
      link.classList.remove('nav-tab-active');
      link.classList.add('text-slate-400');
    }
  });

  // 2b. Update mobile bottom bar active state
  document.querySelectorAll('[data-bottom-nav]').forEach(btn => {
    if (btn.getAttribute('data-bottom-nav') === viewName) {
      btn.classList.add('text-[#2F6BFF]');
      btn.classList.remove('text-slate-400');
      const label = btn.querySelector('span');
      if (label) {
        label.classList.add('font-semibold');
        label.classList.remove('font-medium');
      }
    } else {
      btn.classList.remove('text-[#2F6BFF]');
      btn.classList.add('text-slate-400');
      const label = btn.querySelector('span');
      if (label) {
        label.classList.remove('font-semibold');
        label.classList.add('font-medium');
      }
    }
  });

  // 3. CRITICAL: Trigger Chart Resize & Redraw when parent panel becomes visible
  setTimeout(() => {
    if (viewName === 'overview') {
      if (appState.charts.bist) appState.charts.bist.resize();
      if (typeof renderOverviewNewsPreview === 'function') renderOverviewNewsPreview();
    } else if (viewName === 'news') {
      if (typeof renderNewsCenter === 'function') renderNewsCenter();
    } else if (viewName === 'social') {
      if (window.SocialFeed) SocialFeed.render();
    } else if (viewName === 'community') {
      if (window.Community) Community.render();
    } else if (viewName === 'calendar') {
      if (window.EconCalendar) EconCalendar.render();
    } else if (viewName === 'markets') {
      if (window.Markets) Markets.render();
    } else if (viewName === 'funds') {
      if (window.Funds) Funds.render();
    } else if (viewName === 'screener') {
      if (window.Screener) Screener.render();
    } else if (viewName === 'contest') {
      if (window.Contest) Contest.render();
    } else if (viewName === 'ipo') {
      if (window.Ipos) Ipos.render();
    } else if (viewName === 'stock-detail') {
      if (appState.loadedStock !== appState.currentStock) {
        // First visit (or a different stock): loadStockDetails renders the view and its charts
        loadStockDetails(appState.currentStock);
      } else if (typeof switchStockSubTab === 'function') {
        switchStockSubTab(appState.currentStockSubTab || 'summary');
      } else {
        if (appState.charts.stockIncome) appState.charts.stockIncome.resize();
        else initStockIncomeChart();

        if (appState.charts.projection) appState.charts.projection.resize();
        else initProjectionChart();

        if (appState.charts.peerRadar) appState.charts.peerRadar.resize();
      }
    } else if (viewName === 'compare') {
      if (window.Compare) Compare.render();
    } else if (viewName === 'dividends') {
      if (window.Dividends) Dividends.render();
    } else if (viewName === 'profile') {
      if (window.Profile) Profile.render();
    } else if (viewName === 'reports') {
      if (appState.charts.sector) appState.charts.sector.resize();
      else initSectorComparisonChart();
      renderCorrelationHeatmap();
    }
  }, 60);

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * One-Click Clipboard Copy for Official Support Email
 */
function copySupportEmail() {
  const email = 'onceandalways.help@gmail.com';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(email).then(() => {
      const btnText = document.getElementById('copyEmailBtnText');
      if (btnText) {
        btnText.textContent = 'Kopyalandı!';
        setTimeout(() => { btnText.textContent = 'Kopyala'; }, 2000);
      }
      if (typeof showToast === 'function') {
        showToast('E-posta panoya kopyalandı: onceandalways.help@gmail.com');
      }
    }).catch(() => {
      if (typeof showToast === 'function') {
        showToast('onceandalways.help@gmail.com');
      }
    });
  } else {
    if (typeof showToast === 'function') {
      showToast('onceandalways.help@gmail.com');
    }
  }
}
window.copySupportEmail = copySupportEmail;


let techScorecard = null;      // last scorecard shown, so the group filter can repaint without refetching
let techGroupFilter = 'all';

function paintTechIndicatorList() {
  const list = document.getElementById('techIndicatorList');
  const filter = document.getElementById('techGroupFilter');
  if (!list || !techScorecard) return;
  const sc = techScorecard;
  const groups = Object.entries(sc.groups);

  if (filter) {
    const chip = (key, label, count) => `<button type="button" onclick="setTechGroupFilter('${key}')" class="px-2 py-0.5 rounded-md border transition-colors ${techGroupFilter === key ? 'bg-[#2F6BFF] border-[#2F6BFF] text-white font-bold' : 'bg-[#070B14] border-[#1A2540] text-slate-400 hover:text-white'}">${label} <span class="opacity-70">${count}</span></button>`;
    filter.innerHTML = chip('all', 'Tümü', sc.rows.length)
      + groups.map(([key, label]) => chip(key, label, sc.rows.filter(r => r.group === key).length)).join('');
  }

  const shown = groups.filter(([key]) => techGroupFilter === 'all' || techGroupFilter === key);
  list.innerHTML = shown.map(([key, label]) => {
    const rows = sc.rows.filter(r => r.group === key);
    const sec = sc.report.sections.find(s => s.key === key);
    return `
      <div class="pt-1">
        <div class="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold px-1 pb-1">
          <span>${label}</span>
          ${key === 'volatility' ? '' : `<span class="${sec.score > 0.12 ? 'text-emerald-400' : sec.score < -0.12 ? 'text-rose-400' : 'text-amber-300'}">${sec.tone}</span>`}
        </div>
        ${rows.map(ind => `
          <div class="p-2.5 rounded-xl bg-[#070B14] border border-[#162238] hover:border-[#24345A] transition-colors" title="${ind.note.replace(/"/g, '&quot;')}">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="text-[12px] font-semibold text-slate-200 truncate">${ind.name}</div>
                <div class="text-[10px] font-mono text-slate-500">${ind.period}</div>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <span class="font-mono font-bold text-white text-[12px]">${ind.val}</span>
                <span class="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono whitespace-nowrap ${ind.sig.cls}">${ind.sig.label}</span>
              </div>
            </div>
            <div class="text-[11px] text-slate-400 mt-1 leading-snug">${ind.note}</div>
          </div>`).join('')}
      </div>`;
  }).join('');
}

function setTechGroupFilter(key) {
  techGroupFilter = key;
  paintTechIndicatorList();
}
window.setTechGroupFilter = setTechGroupFilter;

/** Written report: overview, one section per indicator group, levels, synthesis, watch list. */
function paintTechReport(sc) {
  const body = document.getElementById('techReportBody');
  const verdict = document.getElementById('techReportVerdict');
  if (!body) return;
  const rep = sc.report;
  const money = v => `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dist = d => `${d >= 0 ? '+' : '-'}%${Math.abs(d).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  const toneCls = s => (s > 0.12 ? 'text-emerald-400 border-emerald-800/50 bg-emerald-950/40' : s < -0.12 ? 'text-rose-400 border-rose-800/50 bg-rose-950/40' : 'text-amber-300 border-amber-800/50 bg-amber-950/30');
  const icons = { trend: 'fa-arrow-trend-up', momentum: 'fa-gauge-high', volume: 'fa-chart-column', volatility: 'fa-arrows-left-right-to-line' };
  const levelRows = (items, cls) => items.length
    ? items.map(x => `<li class="flex items-center justify-between gap-2 py-1 border-b border-[#162238]/60 last:border-0"><span class="text-slate-300">${x.name}</span><span class="font-mono"><strong class="${cls}">${money(x.value)}</strong> <span class="text-slate-500">${dist(x.dist)}</span></span></li>`).join('')
    : '<li class="text-slate-500 py-1">Yakında seviye yok.</li>';

  if (verdict) {
    verdict.className = `text-xs font-mono font-bold px-2.5 py-1 rounded-lg ${rep.verdict.cls}`;
    verdict.textContent = `GENEL GÖRÜNÜM: ${rep.verdict.label}`;
  }

  body.innerHTML = `
    <div class="p-4 rounded-xl bg-[#090D18] border border-[#162238]">
      <div class="text-[10px] font-mono uppercase tracking-wider text-indigo-300 font-bold mb-1.5">Genel Görünüm</div>
      <p class="text-slate-200 leading-relaxed">${rep.overview}</p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      ${rep.sections.map(s => `
        <div class="p-4 rounded-xl bg-[#070B14] border border-[#1A2540] space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span class="font-serif font-bold text-white text-sm flex items-center gap-2"><i class="fa-solid ${icons[s.key]} text-indigo-400 text-xs"></i>${s.title}</span>
            <span class="px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${s.key === 'volatility' ? 'text-sky-300 border-sky-800/50 bg-sky-950/40' : toneCls(s.score)}">${s.tone.toLocaleUpperCase('tr-TR')}</span>
          </div>
          ${s.text.map(t => `<p class="text-slate-300 leading-relaxed">${t}</p>`).join('')}
        </div>`).join('')}
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="p-4 rounded-xl bg-[#070B14] border border-[#1A2540]">
        <div class="text-[10px] font-mono uppercase tracking-wider text-rose-300 font-bold mb-1">Yakın Direnç Seviyeleri</div>
        <ul class="text-[11px]">${levelRows(rep.resistances, 'text-rose-300')}</ul>
      </div>
      <div class="p-4 rounded-xl bg-[#070B14] border border-[#1A2540]">
        <div class="text-[10px] font-mono uppercase tracking-wider text-emerald-300 font-bold mb-1">Yakın Destek Seviyeleri</div>
        <ul class="text-[11px]">${levelRows(rep.supports, 'text-emerald-300')}</ul>
      </div>
    </div>

    <div class="p-4 rounded-xl bg-[#090D18] border border-[#162238] space-y-2">
      <div class="text-[10px] font-mono uppercase tracking-wider text-indigo-300 font-bold">Sonuç ve Sentez</div>
      <p class="text-slate-200 leading-relaxed">${rep.synthesis}</p>
      ${rep.watch.length ? `
        <div class="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold pt-1">İzlenecekler</div>
        <ul class="list-disc pl-5 space-y-1 text-slate-300">${rep.watch.map(w => `<li>${w}</li>`).join('')}</ul>` : ''}
      <p class="text-slate-500 text-[11px] pt-1">Bu değerlendirme gerçek geçmiş fiyatlardan (Yahoo Finance, gecikmeli) kural tabanlı olarak üretilmiştir; tahmin ya da yatırım tavsiyesi değildir.</p>
    </div>`;
}

/**
 * Fills the indicator panel, the consensus badge and the written report from real daily bars
 * (see TechData.scorecard). Shows an explicit message when no data is available.
 */
async function renderTechScorecard(code) {
  const list = document.getElementById('techIndicatorList');
  const filter = document.getElementById('techGroupFilter');
  const count = document.getElementById('techIndicatorCount');
  const badge = document.getElementById('techConsensusBadge');
  const body = document.getElementById('techReportBody');
  const verdict = document.getElementById('techReportVerdict');
  if (!list) return;

  const neutralCls = 'text-[11px] font-mono font-bold text-slate-400 bg-slate-800 border border-slate-700 px-2.5 py-1 rounded-lg';
  techScorecard = null;
  list.innerHTML = '<div class="py-6 text-center text-slate-500 text-xs font-mono">Göstergeler gerçek fiyat geçmişinden hesaplanıyor...</div>';
  if (filter) filter.innerHTML = '';
  if (count) count.textContent = '(—)';
  if (badge) { badge.className = neutralCls; badge.textContent = 'HESAPLANIYOR'; }
  if (verdict) { verdict.className = neutralCls; verdict.textContent = 'HESAPLANIYOR'; }
  if (body) body.innerHTML = '<p class="text-slate-500 font-mono">Rapor gerçek fiyat geçmişinden hazırlanıyor...</p>';

  try {
    if (!window.TechData) throw new Error('technicals not loaded');
    const sc = await TechData.scorecard(code);
    if (appState.currentStock !== code) return;

    techScorecard = sc;
    if (count) count.textContent = `(${sc.rows.length})`;
    paintTechIndicatorList();
    if (badge) {
      badge.className = `text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg ${sc.verdict.cls}`;
      badge.textContent = `${sc.verdict.label} · ${sc.buy} AL · ${sc.neutral} NÖTR · ${sc.sell} SAT`;
    }
    paintTechReport(sc);
  } catch (e) {
    console.warn('[Technical] scorecard unavailable:', e.message);
    list.innerHTML = '<div class="py-6 text-center text-amber-400 text-xs font-mono">Fiyat geçmişi alınamadığı ya da yetersiz olduğu için göstergeler hesaplanamadı.</div>';
    const noData = 'text-[11px] font-mono font-bold text-amber-400 bg-amber-950/40 border border-amber-800/40 px-2.5 py-1 rounded-lg';
    if (badge) { badge.className = noData; badge.textContent = 'VERİ YOK'; }
    if (verdict) { verdict.className = noData; verdict.textContent = 'VERİ YOK'; }
    if (body) body.innerHTML = '<p class="text-slate-400">Gerçek fiyat verisi alınamadı ya da yetersiz; rapor üretilmedi.</p>';
  }
}
/* ==============================================================================
   5. Stock Detail Loading & Dashboard Hydration
   ============================================================================== */
async function loadStockDetails(ticker) {
  appState.currentStock = ticker.toUpperCase();
  appState.loadedStock = appState.currentStock;
  if (window.Profile) Profile.recordView(appState.currentStock);   // "İncelediklerim" on the profile page
  // Opened from a list or search while the stock page shows: the address follows the stock
  if (appState.activeView === 'stock-detail') syncUrl('replace');
  const fin = await MockFinancialApi.fetchFinancials(appState.currentStock);
  appState.currentCompanyData = fin;
  if (appState.activeView === 'stock-detail' && appState.currentStock === fin.code) updateDocumentTitle(fin.name);

  // 1. Stock Header Elements
  const headerIcon = document.getElementById('stockDetailIcon');
  const headerName = document.getElementById('stockDetailName');
  const headerSymbol = document.getElementById('stockDetailSymbol');
  const headerIndex = document.getElementById('stockDetailIndex');
  const headerPrice = document.getElementById('stockDetailPrice');
  const headerChange = document.getElementById('stockDetailChange');
  const headerVolume = document.getElementById('stockDetailVolume');
  const headerScore = document.getElementById('stockDetailScore');
  const headerTarget = document.getElementById('stockDetailTargetPrice');
  const headerPotential = document.getElementById('stockDetailPotential');

  if (headerName) headerName.textContent = fin.name;
  if (headerSymbol) headerSymbol.textContent = fin.symbol || `${fin.code}.IS`;
  if (headerIndex) {
    headerIndex.textContent = fin.index || 'BIST TÜM';
    headerIndex.className = fin.index === 'BIST 30' 
      ? 'px-2 py-0.5 rounded bg-red-950/40 text-red-400 font-mono text-xs font-bold border border-red-800/50' 
      : 'px-2 py-0.5 rounded bg-[#162238] text-slate-300 font-mono text-xs font-bold border border-[#1E2B45]';
  }
  if (headerPrice) headerPrice.textContent = fin.liveTime ? `₺${fin.price}` : '—';
  if (headerChange) {
    headerChange.textContent = fin.liveTime ? `${fin.change} (${fin.changeAmount})` : '';
    headerChange.className = fin.isPositive 
      ? 'text-emerald-400 font-bold text-xs sm:text-sm font-mono' 
      : 'text-rose-400 font-bold text-xs sm:text-sm font-mono';
  }
  if (headerVolume) headerVolume.textContent = `Hacim: ${fin.volume}`;
  if (window.VerityScore) VerityScore.paintHeader(fin);

  if (typeof fillStockDetailAbout === 'function') fillStockDetailAbout(fin.code);
  if (window.PlainSummary) PlainSummary.render(fin);
  if (window.LiveData) LiveData.syncStockHeader(fin);

  // Dynamic Stock Logo & Visual Avatar
  const logoContainer = document.getElementById('stockDetailLogoContainer') || (headerIcon ? headerIcon.parentElement : null);
  if (logoContainer) {
    logoContainer.innerHTML = getStockLogoHtml(fin.code, 52);
  } else if (headerIcon) {
    const sec = (fin.sector || '').toLowerCase();
    if (sec.includes('havacılık') || sec.includes('ulaştırma')) headerIcon.className = 'fa-solid fa-plane-up';
    else if (sec.includes('banka') || sec.includes('finans')) headerIcon.className = 'fa-solid fa-building-columns';
    else if (sec.includes('enerji') || sec.includes('petrol') || sec.includes('elektrik')) headerIcon.className = 'fa-solid fa-bolt-lightning';
    else if (sec.includes('savunma') || sec.includes('teknoloji') || sec.includes('bilişim')) headerIcon.className = 'fa-solid fa-microchip';
    else if (sec.includes('otomotiv')) headerIcon.className = 'fa-solid fa-car';
    else if (sec.includes('demir') || sec.includes('metal')) headerIcon.className = 'fa-solid fa-cubes-stacked';
    else if (sec.includes('gıda') || sec.includes('tarım')) headerIcon.className = 'fa-solid fa-wheat-awn';
    else if (sec.includes('gayrimenkul') || sec.includes('gyo')) headerIcon.className = 'fa-solid fa-city';
    else if (sec.includes('perakende') || sec.includes('mağaza')) headerIcon.className = 'fa-solid fa-cart-shopping';
    else if (sec.includes('cam')) headerIcon.className = 'fa-solid fa-cubes';
    else headerIcon.className = 'fa-solid fa-industry';
  }

  // 2. Day & Year Price Range
  const dayLow = document.getElementById('stockDayLow');
  const dayHigh = document.getElementById('stockDayHigh');
  const yearLow = document.getElementById('stockYearLow');
  const yearHigh = document.getElementById('stockYearHigh');
  if (dayLow) dayLow.textContent = fin.dayLow;
  if (dayHigh) dayHigh.textContent = fin.dayHigh;
  if (yearLow) yearLow.textContent = fin.yearLow;
  if (yearHigh) yearHigh.textContent = fin.yearHigh;

  // 3. 6 Key Multipliers Cards
  const elFk = document.getElementById('stockDetailFK');
  const elPddd = document.getElementById('stockDetailPDDD');
  const elFdFavok = document.getElementById('stockDetailFDFavok');
  const elNetDebt = document.getElementById('stockDetailNetDebt');
  const elRoe = document.getElementById('stockDetailROE');
  const elRoa = document.getElementById('stockDetailROA');
  if (elFk) elFk.textContent = fin.fk;
  if (elPddd) elPddd.textContent = fin.pddd;
  if (elFdFavok) elFdFavok.textContent = fin.fdFavok;
  if (elNetDebt) elNetDebt.textContent = fin.netDebt;
  if (elRoe) elRoe.textContent = fin.roe;
  if (elRoa) elRoa.textContent = fin.roa;

  // 4-5. Altman Z, Piotroski F and DuPont are computed from real statements (statements.js)

  // 6. Annual Revenue / FAVÖK / Net Income
  const annRev = document.getElementById('stockAnnualRevenue');
  const annFav = document.getElementById('stockAnnualFavok');
  const netInc = document.getElementById('stockNetIncome');
  const annLive = !!fin.quarterlyLive;
  if (annRev) annRev.textContent = annLive ? fin.annualRevenue : '—';
  if (annFav) annFav.textContent = annLive ? fin.annualFavok : '—';
  if (netInc) netInc.textContent = annLive ? fin.netIncome : '—';

  // 8. Official KAP Institutional Profile
  const kapTitle = document.getElementById('kapDetailTitle');
  const kapCap = document.getElementById('kapDetailPaidCapital');
  const kapCeil = document.getElementById('kapDetailCapitalCeiling');
  const kapCity = document.getElementById('kapDetailCity');
  const kapSec = document.getElementById('kapDetailSector');
  const kapAud = document.getElementById('kapDetailAuditor');
  const kapLink = document.getElementById('kapDetailExternalLink');
  if (kapTitle) kapTitle.textContent = fin.name;
  if (kapCap) kapCap.textContent = fin.paidCapital;
  if (kapCeil) kapCeil.textContent = fin.capitalCeiling;
  if (kapCity) kapCity.textContent = fin.city;
  if (kapSec) kapSec.textContent = fin.sector;
  if (kapAud) kapAud.textContent = fin.auditor;
  if (kapLink) {
    const oid = fin.kap || fin.mkk || '';
    kapLink.href = oid ? `https://www.kap.org.tr/tr/sirket-bilgileri/genel/${oid}` : `https://www.kap.org.tr/tr/bist-sirketler`;
  }

  // 9. Real KAP disclosures (assets/js/disclosures.js)
  if (window.Disclosures) Disclosures.show(fin);
  // 9b. Public social posts that mention this stock (assets/js/social.js)
  if (window.SocialFeed) SocialFeed.showForStock(fin.code);

  // 10-11. Technical indicator scorecard, consensus and commentary (computed from real bars)
  renderTechScorecard(fin.code);
  // 12.5. Render Top 5 Income Statement Items (Gelir Tablosu Özeti)
  renderTop5IncomeItems(fin);


  // 13. Official KAP Consolidated Balance Sheet & Financial Statements
  renderBalanceSheetTable(fin);

  // 14. Başabaş Rakip Kıyaslama (Head-to-Head Peer Comparison)
  if (typeof renderPeerComparison === 'function') {
    renderPeerComparison(fin);
  } else if (typeof renderPeerComparisonModule === 'function') {
    renderPeerComparisonModule(fin);
  }

  // 15. Sermaye Artırımı ve Temettü İstihbaratı (Dividend & Capital Structure)
  if (typeof renderCapitalAndDividendIntelligence === 'function') renderCapitalAndDividendIntelligence(fin);

  // 16. Update Watchlist Star State
  if (typeof updateStockDetailWatchlistStar === 'function') updateStockDetailWatchlistStar(fin.code);

  // Re-render Technical and Projections Charts
  await initTechnicalCharts(appState.currentStock);
  await initStockIncomeChart();
  await initProjectionChart();

  // 17. Synchronize Active Sub-Tab and Protected Canvas Sizing
  if (typeof switchStockSubTab === 'function') {
    switchStockSubTab(appState.currentStockSubTab || 'summary');
  }
}

/* ==============================================================================
   5.0. Stock Detail Terminal Sub-Tabs Navigation & Chart Resize Protection
   - 4 Logical Sub-Tabs: summary, financials, microstructure, technical
   - Full Report View: 'all'
   - Prevents Chart.js 0x0 hidden-canvas rendering bugs
   ============================================================================== */
appState.currentStockSubTab = 'summary';

/**
 * Switches the active sub-tab inside the Stock Detail View (#view-stock-detail).
 * Supported tab names: 'summary', 'financials', 'microstructure', 'technical', 'all'
 */
function switchStockSubTab(tabName) {
  if (!tabName) tabName = 'summary';
  appState.currentStockSubTab = tabName;

  const panes = document.querySelectorAll('.stock-subtab-pane');
  const buttons = document.querySelectorAll('.stock-subtab-btn');

  // 1. Update button active / inactive states
  buttons.forEach(btn => {
    const target = btn.getAttribute('data-stock-tab');
    if (target === 'all') {
      if (tabName === 'all') {
        btn.className = 'stock-subtab-btn flex-shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-xl text-xs font-mono font-semibold flex items-center gap-1.5 transition-all bg-[#2F6BFF] text-white shadow-lg shadow-red-600/30';
      } else {
        btn.className = 'stock-subtab-btn flex-shrink-0 whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-mono font-medium flex items-center gap-1.5 transition-all text-slate-400 hover:text-white hover:bg-[#121C30] border border-transparent hover:border-[#1E2B45]';
      }
    } else {
      if (target === tabName) {
        btn.className = 'stock-subtab-btn flex-shrink-0 whitespace-nowrap px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all bg-[#2F6BFF] text-white shadow-lg shadow-red-600/30 font-mono';
      } else {
        btn.className = 'stock-subtab-btn flex-shrink-0 whitespace-nowrap px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-all text-slate-400 hover:text-white hover:bg-[#121C30] font-mono';
      }
    }
  });

  // 2. Toggle panes visibility
  if (tabName === 'all') {
    panes.forEach(pane => pane.classList.remove('hidden'));
  } else {
    panes.forEach(pane => {
      const paneTab = pane.getAttribute('data-stock-subtab') || pane.id.replace('stockSubtab-', '');
      if (paneTab === tabName) {
        pane.classList.remove('hidden');
      } else {
        pane.classList.add('hidden');
      }
    });
  }

  // Ratio cards use the latest price, so they are redrawn whenever the tab is opened
  if ((tabName === 'health' || tabName === 'all') && window.FinHealth) FinHealth.render();

  // 3. Asynchronously trigger Chart.js resize & non-animated update to prevent 0x0 canvas distortion
  requestAnimationFrame(() => {
    setTimeout(() => {
      resizeStockDetailCharts(tabName);
    }, 40);
  });
}

/**
 * Resizes and updates Chart.js instances contained within the given sub-tab.
 */
function resizeStockDetailCharts(tabName) {
  const charts = [];
  if (tabName === 'financials' || tabName === 'all') {
    if (appState.charts.stockIncome) charts.push(appState.charts.stockIncome);
    if (appState.charts.projection) charts.push(appState.charts.projection);
  }
  if (tabName === 'technical' || tabName === 'all') {
    if (appState.charts.peerRadar) charts.push(appState.charts.peerRadar);
  }

  charts.forEach(chart => {
    try {
      if (chart && typeof chart.resize === 'function') {
        chart.resize();
        chart.update('none');
      }
    } catch (e) {
      console.warn('[SubTab Chart Resize Warning]', e);
    }
  });
}

window.switchStockSubTab = switchStockSubTab;
window.resizeStockDetailCharts = resizeStockDetailCharts;

/* ==============================================================================
   5.1. KAP Consolidated Balance Sheet & TMS 29 Inflation / Currency Manager
   ============================================================================== */
let currentBalancePeriod = '2024/09';
let currentBalanceCategory = 'all';
let currentBalanceCurrency = 'nominal'; // 'nominal', 'usd', 'tms29'

/**
 * Parses monetary string formatted like '₺142.500 Mn', '₺1.082,4 Mlr', '-₺418.600 Mn' into numeric TRY.
 */
function parseKapItemTRY(str) {
  if (!str || typeof str !== 'string') return 0;
  const isNegative = str.includes('-');
  const cleaned = str.replace(/[^\d.,]/g, '');
  if (!cleaned) return 0;

  let num = 0;
  if (str.includes('Mlr')) {
    if (cleaned.includes(',') && cleaned.includes('.')) {
      num = parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) * 1e9;
    } else if (cleaned.includes(',')) {
      num = parseFloat(cleaned.replace(',', '.')) * 1e9;
    } else {
      num = parseFloat(cleaned) * 1e9;
    }
  } else if (str.includes('Mn')) {
    if (cleaned.includes('.') && !cleaned.includes(',')) {
      num = parseFloat(cleaned.replace(/\./g, '')) * 1e6;
    } else if (cleaned.includes(',')) {
      num = parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) * 1e6;
    } else {
      num = parseFloat(cleaned) * 1e6;
    }
  } else {
    num = parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  }
  return isNegative ? -num : num;
}

/**
 * Converts and formats a numeric TRY value into Nominal TL, USD ($), or TMS 29 Reel TL.
 */
function formatFinancialCurrency(valTRY, period, currency) {
  if (currency === 'nominal') {
    return formatKapMoney(valTRY);
  }

  const isNeg = valTRY < 0;
  const absVal = Math.abs(valTRY);

  if (currency === 'usd') {
    const fxRate = period === '2023/12' ? 29.50 : (period === '2023/09' ? 27.20 : 35.42);
    const usdVal = absVal / fxRate;
    const sign = isNeg ? '-' : '';
    if (usdVal >= 1e9) {
      return `${sign}$${(usdVal / 1e9).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mlr`;
    } else if (usdVal >= 1e6) {
      return `${sign}$${Math.round(usdVal / 1e6).toLocaleString('tr-TR')} Mn`;
    } else {
      return `${sign}$${Math.round(usdVal).toLocaleString('tr-TR')}`;
    }
  }

  if (currency === 'tms29') {
    // IAS 29 CPI Multipliers to bring prior periods into 2024/09 purchasing power
    const cpiMultiplier = period === '2023/12' ? 1.472 : (period === '2023/09' ? 1.684 : 1.000);
    const realTRY = absVal * cpiMultiplier;
    const sign = isNeg ? '-' : '';
    if (realTRY >= 1e9) {
      return `${sign}₺${(realTRY / 1e9).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mlr`;
    } else if (realTRY >= 1e6) {
      return `${sign}₺${Math.round(realTRY / 1e6).toLocaleString('tr-TR')} Mn`;
    } else {
      return `${sign}₺${Math.round(realTRY).toLocaleString('tr-TR')}`;
    }
  }

  return formatKapMoney(valTRY);
}

/**
 * Calculates percentage growth (YoY) adjusted for Nominal, USD, or TMS 29 real purchasing power.
 */
function computeFinancialYoY(raw24TRY, raw23TRY, currency) {
  if (!raw23TRY || raw23TRY === 0) return '%0,0';

  let v24 = raw24TRY;
  let v23 = raw23TRY;

  if (currency === 'usd') {
    v24 = raw24TRY / 35.42;
    v23 = raw23TRY / 27.20;
  } else if (currency === 'tms29') {
    v24 = raw24TRY * 1.000;
    v23 = raw23TRY * 1.684;
  }

  const pct = ((v24 - v23) / Math.abs(v23)) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}%${Math.abs(pct).toFixed(1).replace('.', ',')}`;
}

/**
 * Toggles Balance Sheet Currency / Accounting Standard:
 * - 'nominal': Reported Historical TL (₺)
 * - 'usd': US Dollar ($) with TCMB quarterly exchange rates
 * - 'tms29': TMS 29 (IAS 29) High-Inflation Adjusted Purchasing Power TL
 */
function setBalanceCurrency(currency) {
  if (window.Statements) Statements.setCurrency(currency);
}

function setBalancePeriod(period) {
  if (window.Statements) Statements.setPeriod(period);
}

function filterBalanceTable(category) {
  currentBalanceCategory = category;

  document.querySelectorAll('.balance-cat-btn').forEach(b => {
    if (b.getAttribute('data-cat') === category) {
      b.className = 'balance-cat-btn px-2.5 py-1 rounded-lg font-bold bg-red-950/40 text-red-400 border border-red-800/40';
    } else {
      b.className = 'balance-cat-btn px-2.5 py-1 rounded-lg font-medium text-slate-400 hover:text-white';
    }
  });

  if (appState.currentCompanyData) {
    renderBalanceSheetTable(appState.currentCompanyData);
  }
}
/**
 * Income statement highlights and the full balance sheet table come from real KAP-based
 * statements (see assets/js/statements.js).
 */
function renderTop5IncomeItems(fin) {
  if (window.Statements && fin) Statements.show(fin);
}

function renderBalanceSheetTable(fin) {
  if (window.Statements && fin) Statements.show(fin);
}

/* ==============================================================================
   5.3. Başabaş Rakip Kıyaslama (Head-to-Head Peer Comparison)
   - Sektör İçi En Yakın 3 Rakip & Serbest BIST Arama Motoru
   - 6 Eksenli Chart.js Çok Faktörlü Radar Grafiği (Radar/Spider Chart)
   - Temel Çarpanlar ve Sektör Medyanı Prim/İskonto (% Premium/Discount) Tablosu
   ============================================================================== */

const PEER_SECTOR_MAP = {
  THYAO: ['PGSUS', 'TAVHL', 'CLEBI'],
  PGSUS: ['THYAO', 'TAVHL', 'CLEBI'],
  TAVHL: ['THYAO', 'PGSUS', 'CLEBI'],
  CLEBI: ['THYAO', 'PGSUS', 'TAVHL'],
  GARAN: ['AKBNK', 'ISCTR', 'YKBNK'],
  AKBNK: ['GARAN', 'YKBNK', 'ISCTR'],
  ISCTR: ['GARAN', 'AKBNK', 'YKBNK'],
  YKBNK: ['GARAN', 'AKBNK', 'ISCTR'],
  VAKBN: ['HALKB', 'GARAN', 'AKBNK'],
  HALKB: ['VAKBN', 'GARAN', 'ISCTR'],
  KCHOL: ['SAHOL', 'SISE', 'ENKAI'],
  SAHOL: ['KCHOL', 'SISE', 'ENKAI'],
  FROTO: ['TOASO', 'TTRAK', 'DOAS'],
  TOASO: ['FROTO', 'TTRAK', 'DOAS'],
  TTRAK: ['FROTO', 'TOASO', 'DOAS'],
  DOAS: ['FROTO', 'TOASO', 'TTRAK'],
  ASELS: ['KFEIN', 'SDTTR', 'ALTNY'],
  SDTTR: ['ASELS', 'KFEIN', 'ALTNY'],
  BIMAS: ['MGROS', 'SOKM', 'CRFSA'],
  MGROS: ['BIMAS', 'SOKM', 'CRFSA'],
  SOKM: ['BIMAS', 'MGROS', 'CRFSA'],
  TUPRS: ['PETKM', 'AYGAZ', 'AKSEN'],
  PETKM: ['TUPRS', 'AYGAZ', 'SASA'],
  SASA: ['HEKTS', 'PETKM', 'KORDS'],
  HEKTS: ['SASA', 'GUBRF', 'BAGFS'],
  EREGL: ['KRDMD', 'ISDMR', 'CEMTS'],
  KRDMD: ['EREGL', 'ISDMR', 'CEMTS'],
  SISE: ['KCHOL', 'SAHOL', 'CMENT'],
  ENKAI: ['KCHOL', 'SAHOL', 'TEKFN'],
  EKGYO: ['ISGYO', 'TRGYO', 'VKGYO'],
  ASTOR: ['EUPWR', 'CWENE', 'ALFAS'],
  EUPWR: ['ASTOR', 'CWENE', 'ALFAS'],
  KOZAL: ['KOZAA', 'IPEKE', 'PRKME'],
  KOZAA: ['KOZAL', 'IPEKE', 'PRKME']
};

window.currentPeerState = {
  activeTicker: 'THYAO',
  selectedPeer: 'PGSUS',
  peers: ['PGSUS', 'TAVHL', 'CLEBI']
};

/**
 * Resolves the top 3 sector competitors for any given stock ticker.
 */
function resolveSectorPeers(activeTicker, activeSector) {
  const t = (activeTicker || 'THYAO').toUpperCase().trim();
  if (PEER_SECTOR_MAP[t] && PEER_SECTOR_MAP[t].length >= 3) {
    return [...PEER_SECTOR_MAP[t]];
  }

  // Same KAP sector only (BIST 30 members first, then by paid-in capital); no unrelated fallbacks
  if (!activeSector) return [];
  return getFullBistStockList()
    .filter(c => c.code !== t && c.raw.sec === activeSector)
    .sort((a, b) => (b.isBist30 - a.isBist30) || ((b.raw.capRaw || 0) - (a.raw.capRaw || 0)))
    .slice(0, 3)
    .map(c => c.code);
}

/** Radar axes: the ONCAL score components (0-10, scaled to 100) and the 52-week range position. */
const RADAR_AXES = [
  ['valuation', 'Değerleme'],
  ['profitability', 'Kârlılık'],
  ['operating', 'Faaliyet gücü'],
  ['solvency', 'Borç durumu'],
  ['momentum', '52H konum']
];

/** Axis scores (0-100) from real data; an axis without data is null. */
function getRadarAxisScores(fin) {
  const part = name => {
    const p = fin && fin.scoreParts && fin.scoreParts.find(([k]) => k === name);
    return p ? Math.round(p[1] * 10) : null;
  };
  return {
    valuation: part('Değerleme'),
    profitability: part('Kârlılık'),
    operating: part('Faaliyet gücü'),
    solvency: part('Borç durumu'),
    momentum: fin && Number.isFinite(fin.yearPos) ? Math.round(fin.yearPos) : null
  };
}

/** Median of the finite values, or null. */
function medianOf(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Initializes or updates the radar chart (#peerRadarChart).
 */
function initPeerRadarChart(activeFin, peerFin, medianScores) {
  const canvas = document.getElementById('peerRadarChart');
  if (!canvas) return;

  if (appState.charts.peerRadar) {
    appState.charts.peerRadar.destroy();
    appState.charts.peerRadar = null;
  }

  const activeScores = getRadarAxisScores(activeFin);
  const peerScores = getRadarAxisScores(peerFin);
  const labels = RADAR_AXES.map(([, label]) => label);
  const activeData = RADAR_AXES.map(([k]) => activeScores[k]);
  const peerData = RADAR_AXES.map(([k]) => peerScores[k]);
  const medianData = RADAR_AXES.map(([k]) => medianScores[k]);

  // Compare only the axes both stocks have data for
  const shared = RADAR_AXES.map((_, i) => i).filter(i => activeData[i] != null && peerData[i] != null);
  const avg = data => shared.reduce((a, i) => a + data[i], 0) / shared.length;
  const advantageEl = document.getElementById('peerRadarScoreAdvantage');
  const commEl = document.getElementById('peerRadarCommentary');
  const actName = activeFin.code;
  const peerName = peerFin.code;

  if (!shared.length) {
    if (advantageEl) { advantageEl.textContent = 'Veri yok'; advantageEl.className = 'text-slate-400 font-bold'; }
    if (commEl) commEl.textContent = `${actName} ve ${peerName} için karşılaştırılabilir bilanço ve fiyat verisi yok.`;
  } else {
    const diff = Math.round(avg(activeData) - avg(peerData));
    if (advantageEl) {
      advantageEl.textContent = diff >= 0 ? `+${diff} Puan Avantaj` : `${diff} Puan Geride`;
      advantageEl.className = diff >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold';
    }
    const strongActive = shared.filter(i => activeData[i] >= peerData[i] + 5).map(i => labels[i]);
    const strongPeer = shared.filter(i => peerData[i] >= activeData[i] + 5).map(i => labels[i]);
    if (commEl) {
      let text = `<strong class="text-white">${actName}</strong>, `;
      text += strongActive.length
        ? `<span class="text-red-400 font-medium">${strongActive.join(', ')}</span> ekseninde ${peerName} hissesinden önde. `
        : `${peerName} ile hiçbir eksende 5 puandan fazla önde değil. `;
      if (strongPeer.length) text += `<strong class="text-purple-300">${peerName}</strong> ise <span class="text-purple-400 font-medium">${strongPeer.join(', ')}</span> ekseninde önde.`;
      const missing = RADAR_AXES.length - shared.length;
      if (missing) text += ` <span class="text-slate-500">${missing} eksende iki hissenin de verisi olmadığı için karşılaştırma yapılmadı.</span>`;
      commEl.innerHTML = text;
    }
  }

  const radarActiveLabel = document.getElementById('radarActiveTickerLabel');
  const radarPeerLabel = document.getElementById('radarPeerTickerLabel');
  if (radarActiveLabel) radarActiveLabel.textContent = actName;
  if (radarPeerLabel) radarPeerLabel.textContent = peerName;

  appState.charts.peerRadar = new Chart(canvas.getContext('2d'), {
    type: 'radar',
    data: {
      labels: labels,
      datasets: [
        {
          label: actName,
          data: activeData,
          fill: true,
          backgroundColor: 'rgba(47, 107, 255, 0.22)',
          borderColor: '#2F6BFF',
          borderWidth: 2,
          pointBackgroundColor: '#2F6BFF',
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: '#2F6BFF',
          pointRadius: 3.5
        },
        {
          label: peerName,
          data: peerData,
          fill: true,
          backgroundColor: 'rgba(168, 85, 247, 0.22)',
          borderColor: '#A855F7',
          borderWidth: 2,
          pointBackgroundColor: '#A855F7',
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: '#A855F7',
          pointRadius: 3.5
        },
        {
          label: 'Grup Medyanı',
          data: medianData,
          fill: false,
          borderColor: '#10B981',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointBackgroundColor: '#10B981',
          pointBorderColor: '#10B981',
          pointRadius: 2.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      spanGaps: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0E1626',
          borderColor: '#1E2B45',
          borderWidth: 1,
          titleFont: { family: 'ui-sans-serif, system-ui', size: 12, weight: 'bold' },
          bodyFont: { family: 'ui-monospace, monospace', size: 11 },
          callbacks: {
            label: function(ctx) {
              return ` ${ctx.dataset.label}: ${ctx.raw == null ? 'veri yok' : `${ctx.raw} / 100`}`;
            }
          }
        }
      },
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: {
            stepSize: 20,
            color: '#475569',
            backdropColor: 'transparent',
            font: { family: 'ui-monospace, monospace', size: 9 }
          },
          grid: { color: 'rgba(30, 43, 69, 0.7)' },
          angleLines: { color: 'rgba(30, 43, 69, 0.7)' },
          pointLabels: {
            color: '#94A3B8',
            font: { family: 'ui-monospace, monospace', size: 11, weight: '600' }
          }
        }
      }
    }
  });
}

/**
 * Creates an individual row for the Peer Comparison table.
 */
function createPeerTableRow(stockFin, isActive, isSelected, medFk, medPd) {
  // Premium / discount to the group median, only when the stock and the medians are all positive
  const fk = stockFin.fkNum, pd = stockFin.pdddNum;
  const relDiff = fk > 0 && pd > 0 && medFk > 0 && medPd > 0 ? ((fk / medFk - 1) * 50) + ((pd / medPd - 1) * 50) : null;
  const absDiff = relDiff == null ? '' : Math.abs(relDiff).toFixed(1);
  const diffBadge = relDiff == null
    ? '<span class="text-[10px] font-mono text-slate-500">—</span>'
    : relDiff < 0
      ? `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/90 border border-emerald-700/60 text-emerald-300">-%${absDiff} İskonto</span>`
      : `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950/90 border border-rose-700/60 text-rose-300">+%${absDiff} Prim</span>`;

  let rowBg = 'hover:bg-[#121C30]/60 transition-colors cursor-pointer';
  if (isActive) {
    rowBg = 'bg-red-950/30 border-l-2 border-red-600 hover:bg-red-950/40 transition-colors cursor-pointer';
  } else if (isSelected) {
    rowBg = 'bg-purple-950/30 border-l-2 border-purple-500 hover:bg-purple-950/40 transition-colors cursor-pointer';
  }

  const logoHtml = (typeof getStockLogoHtml === 'function') ? getStockLogoHtml(stockFin.code, 22) : '';

  return `
    <tr class="${rowBg}" onclick="selectPeerStock('${stockFin.code}')">
      <td class="py-2.5 px-3 flex items-center gap-2">
        ${logoHtml}
        <div>
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-red-200 bg-red-950/60 px-2 py-0.5 rounded-md border border-red-800/50 tracking-wide text-xs font-tv">${stockFin.code}</span>
            ${isActive ? '<span class="text-[9px] px-1.5 py-px rounded bg-red-950/40 text-red-300 border border-red-800/40 font-bold">AKTİF</span>' : ''}
            ${isSelected ? '<span class="text-[9px] px-1.5 py-px rounded bg-purple-950 text-purple-300 border border-purple-800/40 font-bold">RADARDA</span>' : ''}
          </div>
          <span class="inline-block text-[10px] text-slate-300 font-medium truncate max-w-[130px] mt-0.5" title="${stockFin.name}">${stockFin.name}</span>
        </div>
      </td>
      <td class="py-2.5 px-2 text-right font-bold text-slate-200">${stockFin.fk}</td>
      <td class="py-2.5 px-2 text-right font-bold text-slate-200">${stockFin.pddd}</td>
      <td class="py-2.5 px-2 text-right text-slate-300">${stockFin.fdFavok}</td>
      <td class="py-2.5 px-2 text-right text-emerald-400 font-bold">${stockFin.roe}</td>
      <td class="py-2.5 px-2 text-right text-slate-300">${stockFin.netDebt}</td>
      <td class="py-2.5 px-2 text-right text-amber-300 font-bold">${stockFin.score ?? '—'}</td>
      <td class="py-2.5 px-3 text-center">${diffBadge}</td>
    </tr>
  `;
}

/**
 * Main Controller for the Head-to-Head Peer Comparison Module. Peers get real quotes and
 * statement ratios first (LiveData.ensure); the module is drawn again once they arrive.
 */
function renderPeerComparisonModule(fin, synced = false) {
  if (!fin) return;
  const activeTicker = (fin.code || 'THYAO').toUpperCase();
  const peers = resolveSectorPeers(activeTicker, fin.sector);

  if (!window.currentPeerState || window.currentPeerState.activeTicker !== activeTicker) {
    window.currentPeerState = {
      activeTicker: activeTicker,
      selectedPeer: peers[0] || null,
      peers: peers
    };
  }

  const selectedPeer = window.currentPeerState.selectedPeer;
  const activeFin = fin;
  const peerFins = window.currentPeerState.peers.map(p => getOrGenerateStockFinancials(p));

  if (!selectedPeer) {
    const tbody = document.getElementById('peerComparisonTbody');
    if (tbody) tbody.innerHTML = createPeerTableRow(activeFin, true, false, null, null) +
      '<tr><td colspan="8" class="py-4 px-3 text-center text-xs text-slate-400">Aynı sektörde kıyaslanacak başka şirket bulunamadı. Yukarıdan bir hisse kodu yazarak kıyaslayabilirsin.</td></tr>';
    if (appState.charts.peerRadar) { appState.charts.peerRadar.destroy(); appState.charts.peerRadar = null; }
    const adv = document.getElementById('peerRadarScoreAdvantage');
    const comm = document.getElementById('peerRadarCommentary');
    if (adv) { adv.textContent = '—'; adv.className = 'text-slate-400 font-bold'; }
    if (comm) comm.textContent = 'Kıyaslama için bir rakip seç.';
    populatePeerStockDatalist();
    renderPeerQuickPills([], null);
    return;
  }
  const selectedFin = getOrGenerateStockFinancials(selectedPeer);

  if (!synced && window.LiveData) {
    const codes = [...new Set([activeTicker, ...window.currentPeerState.peers, selectedPeer])];
    LiveData.ensure(codes).then(() => {
      if (window.currentPeerState.activeTicker === activeTicker) renderPeerComparisonModule(fin, true);
    });
  }

  // Sector badge
  const secBadge = document.getElementById('peerSectorBadge');
  if (secBadge) secBadge.textContent = fin.sector || 'Genel BIST Sektörü';

  // Datalist and quick pills
  populatePeerStockDatalist();
  renderPeerQuickPills(window.currentPeerState.peers, selectedPeer);

  // Medians over the stock and its peers (real values only)
  const allList = [activeFin, ...peerFins];
  const medFk = medianOf(allList.map(f => f.fkNum).filter(v => v > 0));
  const medPd = medianOf(allList.map(f => f.pdddNum).filter(v => v > 0));
  const medFd = medianOf(allList.map(f => f.fdFavokNum).filter(v => v > 0));
  const medRoe = medianOf(allList.map(f => f.roeNum));
  const medDebt = medianOf(allList.map(f => f.netDebtNum));
  const medScore = medianOf(allList.map(f => f.score));
  const fmtMed = (v, f) => (v == null ? '—' : f(v));

  const allAxisScores = allList.map(f => getRadarAxisScores(f));
  const medRadar = Object.fromEntries(RADAR_AXES.map(([k]) => {
    const m = medianOf(allAxisScores.map(s => s[k]));
    return [k, m == null ? null : Math.round(m)];
  }));

  // Render Table Rows
  const tbody = document.getElementById('peerComparisonTbody');
  if (tbody) {
    let rowsHtml = createPeerTableRow(activeFin, true, false, medFk, medPd);
    peerFins.forEach(pFin => {
      rowsHtml += createPeerTableRow(pFin, false, pFin.code === selectedPeer, medFk, medPd);
    });
    rowsHtml += `
      <tr class="bg-[#121C30]/80 font-bold border-t-2 border-[#1E2B45] text-slate-300">
        <td class="py-2.5 px-3 flex items-center gap-2">
          <div class="w-6 h-6 rounded-md bg-emerald-950/80 border border-emerald-800/60 text-emerald-400 flex items-center justify-center text-[10px]">
            <i class="fa-solid fa-chart-simple"></i>
          </div>
          <div>
            <span class="text-white">GRUP MEDYANI</span>
            <span class="block text-[9px] text-emerald-400 font-light">Bu ${allList.length} hisse</span>
          </div>
        </td>
        <td class="py-2.5 px-2 text-right text-emerald-400">${fmtMed(medFk, v => `${v.toFixed(1)}x`)}</td>
        <td class="py-2.5 px-2 text-right text-emerald-400">${fmtMed(medPd, v => `${v.toFixed(2)}x`)}</td>
        <td class="py-2.5 px-2 text-right text-emerald-400">${fmtMed(medFd, v => `${v.toFixed(1)}x`)}</td>
        <td class="py-2.5 px-2 text-right text-emerald-400">${fmtMed(medRoe, v => `%${v.toFixed(1)}`)}</td>
        <td class="py-2.5 px-2 text-right text-emerald-400">${fmtMed(medDebt, v => `${v.toFixed(2)}x`)}</td>
        <td class="py-2.5 px-2 text-right text-emerald-400">${fmtMed(medScore, v => v.toFixed(1))}</td>
        <td class="py-2.5 px-3 text-center">
          <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-950/70 border border-red-800/40 text-red-300">
            BAZ DÜZEY
          </span>
        </td>
      </tr>
    `;
    tbody.innerHTML = rowsHtml;
  }

  initPeerRadarChart(activeFin, selectedFin, medRadar);
}

/**
 * Global entry point for Head-to-Head Peer Comparison.
 * Supports string ticker (e.g. 'THYAO') or financial object.
 */
function renderPeerComparison(symbol) {
  const fin = (symbol && typeof symbol === 'object')
    ? symbol
    : (appState.currentCompanyData || getOrGenerateStockFinancials(symbol || appState.currentStock || 'THYAO'));
  renderPeerComparisonModule(fin);
}
window.renderPeerComparison = renderPeerComparison;
window.renderPeerComparisonModule = renderPeerComparisonModule;

/**
 * Handles selecting a specific peer stock to compare in the Radar Chart.
 */
function selectPeerStock(ticker) {
  if (!ticker || !window.currentPeerState) return;
  const t = ticker.toUpperCase().trim();
  if (t === window.currentPeerState.activeTicker) return;

  const peers = window.currentPeerState.peers;
  if (!peers.includes(t)) {
    if (peers.length < 3) peers.push(t);
    else peers[2] = t; // replace third slot
  }
  window.currentPeerState.selectedPeer = t;

  const activeFin = appState.currentCompanyData || getOrGenerateStockFinancials(window.currentPeerState.activeTicker);
  renderPeerComparisonModule(activeFin);
}
window.selectPeerStock = selectPeerStock;

/**
 * Handles custom peer stock input form submission.
 */
function handleCustomPeerSubmit() {
  const input = document.getElementById('peerCustomInput') || document.getElementById('peerStockInput');
  if (!input) return;
  const val = input.value.toUpperCase().trim();
  if (!val) return;

  selectPeerStock(val);
  input.value = '';
}
window.handleCustomPeerSubmit = handleCustomPeerSubmit;

/**
 * Renders quick pill buttons for top 3 peers.
 */
function renderPeerQuickPills(peers, selectedPeer) {
  const pillsContainer = document.getElementById('peerQuickPills');
  if (!pillsContainer) return;

  pillsContainer.innerHTML = peers.map(p => {
    const isSelected = p === selectedPeer;
    const cls = isSelected 
      ? 'bg-purple-600 text-white font-bold border border-purple-400 shadow-sm' 
      : 'bg-[#121C30] hover:bg-[#1A2642] text-slate-300 border border-[#1E2B45]';
    return `
      <button 
        type="button" 
        onclick="selectPeerStock('${p}')"
        class="px-2.5 py-0.5 rounded-lg text-xs font-mono transition-colors ${cls}"
      >
        ${p}
      </button>
    `;
  }).join('');
}

/**
 * Populates datalist with BIST stocks for universal peer comparison search.
 */
function populatePeerStockDatalist() {
  const datalist = document.getElementById('peerStockDatalist');
  if (!datalist || datalist.children.length > 0) return;

  if (typeof cachedBistStockList !== 'undefined' && Array.isArray(cachedBistStockList)) {
    const fragment = document.createDocumentFragment();
    cachedBistStockList.slice(0, 200).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.code;
      opt.textContent = `${s.code} - ${s.name}`;
      fragment.appendChild(opt);
    });
    datalist.appendChild(fragment);
  }
}

/* ==============================================================================
   5.4. Sermaye Artırımı ve Temettü İstihbaratı (Dividend & Capital Structure)
   - Bedelsiz Sermaye Artırımı Potansiyeli ((Özkaynaklar - Ödenmiş Sermaye) / Ödenmiş Sermaye)
   - Geçmiş Temettü Verimi (Dividend Yield %)
   - Temettü Dağıtım Oranı (Payout Ratio %)
   ============================================================================== */

/**
 * Calculates and renders Capital Structure and Dividend Intelligence.
 */
function renderCapitalAndDividendIntelligence(symbolOrFin) {
  const fin = (symbolOrFin && typeof symbolOrFin === 'object')
    ? symbolOrFin
    : (appState.currentCompanyData || getOrGenerateStockFinancials(symbolOrFin || appState.currentStock || 'THYAO'));
  if (!fin) return;
  const code = fin.code || 'THYAO';
  const set = (id, text) => { const n = document.getElementById(id); if (n) n.textContent = text; };

  // 1. Bonus issue potential: (equity - paid-in capital) / paid-in capital, from the real balance sheet
  // (statements.js sets fin.equityRaw: undefined while loading, null when there is no balance sheet)
  const paidCapRaw = fin.paidCapitalRaw > 0 ? fin.paidCapitalRaw : null;
  const totalEquity = fin.equityRaw > 0 ? fin.equityRaw : null;
  const commEl = document.getElementById('capitalDividendCommentary');
  const flexBadge = document.getElementById('capitalFlexibilityBadge');
  set('capitalCeilingComparisonBadge', `Tavan: ${fin.capitalCeiling}`);

  if (!paidCapRaw || !totalEquity) {
    ['bonusPotentialPct', 'bonusTotalEquityDisplay', 'bonusFreeReservesDisplay', 'bonusPaidRatioDisplay', 'bonusReservesRatioDisplay'].forEach(id => set(id, '—'));
    set('bonusPaidCapitalDisplay', paidCapRaw ? formatKapMoney(paidCapRaw) : '—');
    set('bonusPotentialRatio', fin.equityRaw === undefined ? 'Bilanço yükleniyor' : 'Bilanço verisi yok');
    ['bonusPaidBar', 'bonusReservesBar'].forEach(id => { const b = document.getElementById(id); if (b) b.style.width = '0%'; });
    if (flexBadge) { flexBadge.textContent = '—'; flexBadge.className = 'text-slate-400 font-bold uppercase'; }
    if (commEl) {
      commEl.textContent = fin.equityRaw === undefined
        ? 'Gerçek bilanço verisi yükleniyor...'
        : 'Bu şirketin bilançosu veri kaynağında bulunmadığı için bedelsiz potansiyeli hesaplanamadı.';
    }
  } else {
    const freeReserves = Math.max(0, totalEquity - paidCapRaw);
    const bonusPotentialPct = Math.round(((totalEquity - paidCapRaw) / paidCapRaw) * 100);
    const bonusRatio = Math.round(bonusPotentialPct / 100);
    set('bonusPotentialPct', `${bonusPotentialPct >= 0 ? '+' : ''}%${bonusPotentialPct.toLocaleString('tr-TR')}`);
    set('bonusPotentialRatio', `${bonusRatio} Kat Potansiyel Bedelsiz İhraç`);
    set('bonusTotalEquityDisplay', formatKapMoney(totalEquity));
    set('bonusPaidCapitalDisplay', formatKapMoney(paidCapRaw));
    set('bonusFreeReservesDisplay', formatKapMoney(freeReserves));

    const paidCapShare = Math.min(100, Math.max(0.1, (paidCapRaw / totalEquity) * 100));
    const reservesShare = Math.max(0, 100 - paidCapShare);
    set('bonusPaidRatioDisplay', `%${paidCapShare.toFixed(2).replace('.', ',')}`);
    set('bonusReservesRatioDisplay', `%${reservesShare.toFixed(2).replace('.', ',')}`);
    const paidBar = document.getElementById('bonusPaidBar');
    const resBar = document.getElementById('bonusReservesBar');
    if (paidBar) paidBar.style.width = `${paidCapShare.toFixed(1)}%`;
    if (resBar) resBar.style.width = `${reservesShare.toFixed(1)}%`;

    // A plain bucket of the computed potential, not a rating
    if (flexBadge) {
      const [text, cls] = bonusPotentialPct > 1000 ? ['ÇOK YÜKSEK İÇ KAYNAK', 'text-emerald-400']
        : bonusPotentialPct > 300 ? ['YÜKSEK İÇ KAYNAK', 'text-red-400'] : ['SINIRLI İÇ KAYNAK', 'text-slate-300'];
      flexBadge.textContent = text;
      flexBadge.className = `${cls} font-bold uppercase`;
    }
    if (commEl) {
      commEl.innerHTML = `
        <strong class="text-white">${fin.name}</strong>: ${formatKapMoney(totalEquity)} özkaynak ve ${formatKapMoney(paidCapRaw)} ödenmiş sermayeye göre iç kaynaklar ${formatKapMoney(freeReserves)}. İç kaynakların ödenmiş sermayeye oranı (teorik bedelsiz kapasitesi) <strong class="text-emerald-400">%${bonusPotentialPct.toLocaleString('tr-TR')}</strong>. Bedelsiz sermaye artırımı yönetim kurulu kararı ve SPK onayı gerektirir; potansiyel, gerçekleşeceği anlamına gelmez.
      `;
    }
  }

  // 2. Dividend Yield: real cash dividends (assets/data/dividends.json via dividends.js)
  renderDividendYieldCard(code);

  // 3. Payout Ratio: real cash flow statement figures (statements.js sets fin.payout)
  renderPayoutCard(fin);
}

/** Payout ratio card: last-twelve-months dividends paid / net profit from the cash flow statement. */
function renderPayoutCard(fin) {
  const valueEl = document.getElementById('payoutRatioDisplay');
  const badge = document.getElementById('payoutSafetyBadge');
  const note = document.getElementById('payoutRatioNote');
  if (!valueEl) return;
  const p = fin && fin.payout;
  const setBadge = (text, cls) => { if (badge) { badge.textContent = text; badge.className = `font-bold ${cls}`; } };
  const setNote = text => { if (note) note.textContent = text; };

  if (!p || p.missing) {
    valueEl.textContent = '—';
    setBadge(p ? 'HESAPLANAMADI' : 'YÜKLENİYOR', 'text-slate-400');
    setNote(!p ? 'Gerçek bilanço verisi yükleniyor...'
      : p.missing === 'financial' ? 'Banka ve sigorta nakit akış tablolarında temettü ödemesi ayrı satır olarak yer almıyor.'
        : p.missing === 'no-line' ? 'Şirketin nakit akış tablosunda temettü ödemesi ayrı satır olarak raporlanmamış.'
          : 'Bu şirket için bilanço verisi bulunamadı.');
    return;
  }
  const money = v => formatKapMoney(v);
  if (p.ratio == null) {
    valueEl.textContent = '—';
    setBadge(p.paid > 0 ? 'ZARARA RAĞMEN DAĞITIM' : 'DAĞITIM YOK', p.paid > 0 ? 'text-rose-400' : 'text-slate-400');
    setNote(`Son 12 ay net kâr negatif (${money(p.profit)}); oran hesaplanamaz. Ödenen temettü: ${p.paid > 0 ? money(p.paid) : 'yok'}.`);
    return;
  }
  valueEl.textContent = `%${p.ratio.toFixed(1).replace('.', ',')}`;
  if (p.paid === 0) setBadge('DAĞITIM YOK', 'text-slate-400');
  else if (p.ratio > 100) setBadge('KÂRDAN FAZLA', 'text-rose-400');
  else if (p.ratio > 60) setBadge('YÜKSEK DAĞITIM', 'text-amber-400');
  else setBadge('GÜVENLİ MARJ', 'text-emerald-400');
  setNote(`Son 12 ayda ödenen nakit temettü ${p.paid > 0 ? money(p.paid) : '₺0'} / dönem net kârı ${money(p.profit)} (${p.period}, nakit akış tablosu).`);
}
window.renderPayoutCard = renderPayoutCard;

/** Fills the dividend yield card from real dividend history; keeps a dash while loading or missing. */
async function renderDividendYieldCard(code) {
  const yieldEl = document.getElementById('dividendYieldDisplay');
  const prevEl = document.getElementById('dividendPrevYield');
  const noteEl = document.getElementById('dividendYieldNote');
  if (!yieldEl) return;
  const historyEl = document.getElementById('dividendContinuityBadge');
  const setHistory = text => { if (historyEl) historyEl.textContent = text; };
  const pct = v => `%${v.toFixed(2).replace('.', ',')}`;
  yieldEl.textContent = '—';
  if (prevEl) prevEl.textContent = '—';
  if (noteEl) noteEl.textContent = 'Temettü verisi yükleniyor...';
  setHistory('Temettü geçmişi yükleniyor');

  const s = window.Dividends ? await Dividends.statsFor(code).catch(() => null) : null;
  if ((appState.currentStock || code) !== code) return;      // user moved on to another stock
  if (!s) {
    if (noteEl) noteEl.textContent = 'Temettü verisi şu an alınamadı.';
    setHistory('Temettü geçmişi alınamadı');
    return;
  }
  if (!s.paid) {
    yieldEl.textContent = '%0,00';
    if (prevEl) prevEl.textContent = '%0,00';
    if (noteEl) noteEl.textContent = 'Son iki yılda nakit temettü dağıtımı kaydı yok (Yahoo Finance).';
    setHistory('Son 2 yılda nakit temettü yok');
    return;
  }
  setHistory(`Son 2 yılda ${s.count24} nakit temettü`);
  yieldEl.textContent = pct(s.yield12);
  if (prevEl) prevEl.textContent = pct(s.yieldPrev);
  if (noteEl) {
    const amount = s.last.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const head = s.count12 ? `Son 12 aydaki ${s.count12} nakit temettünün toplamı / fiyat.` : 'Son 12 ayda nakit temettü dağıtılmadı.';
    noteEl.textContent = `${head} Son dağıtım: ${s.last.label}, hisse başı ₺${amount}. Fiyat ${new Date(s.asOf).toLocaleDateString('tr-TR')} tarihli.`;
  }
}
window.renderCapitalAndDividendIntelligence = renderCapitalAndDividendIntelligence;
window.renderPeerComparison = renderPeerComparison;
window.renderPeerComparisonModule = renderPeerComparisonModule;

/* ==============================================================================
   6.2. Correlation heatmap (sector & correlation view)
   ============================================================================== */

const correlationMatrix = {
  // Symbols for /api/history; values are computed from one year of real daily closes
  symbols: ['THYAO', 'AKBNK', 'FROTO', 'ASELS', 'BIMAS', 'TUPRS', 'BIST100', 'USDTRY'],
  labels: ['THYAO', 'AKBNK', 'FROTO', 'ASELS', 'BIMAS', 'TUPRS', 'BIST 100', 'USD/TRY']
};

/**
 * Renders the 8x8 Correlation Heatmap: correlations of daily log returns over the last year,
 *    from real Yahoo Finance closes (/api/history). Computed once per page load.
 */
let correlationLoad = null;

async function renderCorrelationHeatmap() {
  const tbody = document.getElementById('correlationHeatmapTbody');
  if (!tbody) return;

  const m = correlationMatrix;
  const badge = document.getElementById('correlationAvgBadge');
  const insight = document.getElementById('correlationInsight');
  const message = (text, cls) => {
    tbody.innerHTML = `<tr><td colspan="${m.labels.length + 1}" class="py-8 text-center text-[11px] font-mono ${cls}">${text}</td></tr>`;
  };

  message('Fiyat geçmişi yükleniyor...', 'text-slate-500');
  if (!correlationLoad) {
    correlationLoad = Promise.all(m.symbols.map(s =>
      fetch(`/api/history?symbol=${encodeURIComponent(s)}&range=1y&interval=1d`)
        .then(r => { if (!r.ok) throw new Error(`history ${s} ${r.status}`); return r.json(); })
    )).then(series => Calc.returnCorrelations(series));
    correlationLoad.catch(() => { correlationLoad = null; });
  }

  let corr;
  try {
    corr = await correlationLoad;
    if (corr.days < 20) throw new Error(`only ${corr.days} common days`);
  } catch (e) {
    console.warn('[Correlation] unavailable:', e.message);
    message('Fiyat geçmişi şu an alınamadı; korelasyonlar hesaplanamadı.', 'text-amber-400');
    if (badge) badge.textContent = 'Veri yok';
    if (insight) insight.textContent = 'Korelasyonlar gerçek günlük kapanışlardan hesaplanır.';
    return;
  }

  const fmt = v => (v == null ? '—' : v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' }));
  const values = corr.values;

  // Average pairwise correlation of the six stocks, and the lowest pair overall
  const stocks = m.labels.length - 2;
  const pairs = [];
  for (let i = 0; i < m.labels.length; i++) {
    for (let j = i + 1; j < m.labels.length; j++) if (values[i][j] != null) pairs.push([i, j, values[i][j]]);
  }
  const stockPairs = pairs.filter(([i, j]) => i < stocks && j < stocks);
  if (badge && stockPairs.length) {
    badge.textContent = `Hisse ort. korelasyon: ${fmt(stockPairs.reduce((s, p) => s + p[2], 0) / stockPairs.length)}`;
  }
  if (insight && pairs.length) {
    const [li, lj, lv] = pairs.reduce((a, b) => (b[2] < a[2] ? b : a));
    const range = `${corr.days} işlem günü, ${corr.from.split('-').reverse().join('.')} – ${corr.to.split('-').reverse().join('.')}`;
    insight.textContent = `En düşük ilişki: ${m.labels[li]} – ${m.labels[lj]} (${fmt(lv)}). Günlük getiriler, ${range}.`;
  }

  tbody.innerHTML = m.labels.map((rowLabel, i) => {
    const isBenchmark = (rowLabel === 'BIST 100' || rowLabel === 'USD/TRY');

    const cellsHtml = values[i].map((val, j) => {
      let cellClass = 'bg-[#0E1626] text-slate-400';
      if (val == null) {
        cellClass = 'bg-[#0B1220] text-slate-500';
      } else if (i === j) {
        // Diagonal 1.00
        cellClass = 'bg-[#2F6BFF] text-white font-extrabold shadow-sm';
      } else if (val >= 0.70) {
        cellClass = 'bg-red-900/90 text-red-200 font-bold';
      } else if (val >= 0.40) {
        cellClass = 'bg-sky-950/90 text-sky-300 font-medium';
      } else if (val >= 0.15) {
        cellClass = 'bg-[#101D33] text-slate-300';
      } else if (val >= 0.00) {
        cellClass = 'bg-[#0B1220] text-slate-400';
      } else {
        // Negative Correlation (Natural Hedge)
        cellClass = 'bg-rose-950/80 text-rose-300 font-bold border border-rose-800/40';
      }

      const valFormatted = i === j ? '1,00' : fmt(val);

      return `
        <td class="py-2 px-1 text-center font-mono text-[10px] sm:text-[11px] transition-all hover:ring-1 hover:ring-red-500 cursor-default ${cellClass}" title="${rowLabel} &bull; ${m.labels[j]}: ${valFormatted}">
          ${valFormatted}
        </td>
      `;
    }).join('');

    return `
      <tr class="hover:bg-[#121C30]/50 transition-colors">
        <td class="py-2 px-1.5 text-left font-bold pl-2.5 text-white ${isBenchmark ? 'text-sky-300' : ''}">
          ${rowLabel}
        </td>
        ${cellsHtml}
      </tr>
    `;
  }).join('');
}

window.renderCorrelationHeatmap = renderCorrelationHeatmap;



/* ==============================================================================
   8. Universal KAP Search & Navigation
   ============================================================================== */

/**
 * Normalizes Turkish characters and punctuation for instant search indexing.
 */
function normalizeSearchText(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/i̇/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim();
}

/**
 * Standardizes sector names into clean, uniform institutional categories.
 */
function normalizeSector(sec) {
  if (!sec) return 'Sanayi & İmalat';
  if (sec.includes('G') && sec.includes('da')) return 'Gıda, Tarım & İçecek';
  if (sec.includes('imento')) return 'Çimento & Yapı Malzemeleri';
  if (sec.includes('Gayrimenkul') || sec.includes('GYO')) return 'Gayrimenkul Yatırım Ortaklığı (GYO)';
  if (sec.includes('Demir') || sec.includes('elik')) return 'Demir-Çelik & Metal Sanayi';
  if (sec.includes('Ula') || sec.includes('Havac')) return 'Ulaştırma & Havacılık';
  if (sec.includes('Banka') || sec.includes('Finans')) return 'Bankacılık & Finans';
  if (sec.includes('Holding')) return 'Holding & Yatırım';
  if (sec.includes('Enerji') || sec.includes('Petrol')) return 'Enerji & Petrol Rafineri';
  if (sec.includes('Savunma') || sec.includes('Teknoloji') || sec.includes('Bili')) return 'Savunma & İleri Teknoloji';
  if (sec.includes('Otomotiv')) return 'Otomotiv & Yan Sanayi';
  if (sec.includes('Perakende')) return 'Perakende & Tüketim';
  if (sec.includes('Kimya') || sec.includes('bre')) return 'Kimya, İlaç & Gübre';
  if (sec.includes('Tekstil')) return 'Tekstil & Konfeksiyon';
  if (sec.includes('Telekom')) return 'Telekomünikasyon & Bilişim';
  if (sec.includes('Cam') || sec.includes('Seramik')) return 'Cam & Seramik Sanayi';
  return sec;
}

const BIST30_TICKERS = new Set([
  'THYAO','EREGL','BIMAS','TUPRS','ASELS','GARAN','AKBNK','KCHOL','SISE','SASA',
  'FROTO','EKGYO','PETKM','ASTOR','KONTR','MIATK','ALARK','MGROS','PGSUS','ISCTR',
  'YKBNK','VAKBN','HALKB','TCELL','TTKOM','ENKAI','ARCLK','TOASO','OYAKC','BRISA'
]);

let cachedBistStockList = null;
function getFullBistStockList() {
  if (cachedBistStockList) return cachedBistStockList;
  if (typeof KAP_RAW_COMPANIES === 'undefined' || !Array.isArray(KAP_RAW_COMPANIES)) {
    return [];
  }

  cachedBistStockList = KAP_RAW_COMPANIES.map(c => {
    const primaryCode = (c.c || '').split(',')[0].trim().toUpperCase();
    const cleanSector = normalizeSector(c.sec);
    const allCodes = (c.c || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
    const searchTarget = normalizeSearchText(`${allCodes.join(' ')} ${c.n || ''} ${cleanSector} ${c.s || ''}`);
    const isBist30 = c.idx === 'BIST 30' || allCodes.some(x => BIST30_TICKERS.has(x));

    return {
      raw: c,
      code: primaryCode,
      name: c.n || primaryCode,
      sector: cleanSector,
      isBist30: isBist30,
      searchTarget: searchTarget,
      capRaw: c.capRaw || 500000000,
      paidCap: c.cap || '₺500.00 Mn'
    };
  });

  return cachedBistStockList;
}

function initSearch() {
  const inputs = document.querySelectorAll('.global-search-input');
  let dropdown = document.getElementById('searchDropdown');

  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'searchDropdown';
    dropdown.className = 'hidden absolute left-0 right-0 top-full mt-2 bg-[#0E1626] border border-[#1E2B45] rounded-xl shadow-2xl p-2 z-50 max-h-96 overflow-y-auto font-sans backdrop-blur-md';
    document.body.appendChild(dropdown);
  }

  // Keyboard shortcut '/' to focus search
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      const firstInput = document.querySelector('.global-search-input');
      if (firstInput) {
        firstInput.focus();
        firstInput.select();
      }
    }
  });

  let globalSearchDebounceTimer = null;
  inputs.forEach(input => {
    input.addEventListener('input', e => {
      const q = e.target.value.trim();
      if (!q) {
        if (globalSearchDebounceTimer) clearTimeout(globalSearchDebounceTimer);
        dropdown.classList.add('hidden');
        return;
      }

      if (globalSearchDebounceTimer) clearTimeout(globalSearchDebounceTimer);
      globalSearchDebounceTimer = setTimeout(() => {
        const allStocks = getFullBistStockList();
        const nq = normalizeSearchText(q);

        if (input.parentElement && dropdown.parentElement !== input.parentElement) {
          input.parentElement.appendChild(dropdown);
        }

        // Ranked search algorithm across all 1048 BIST companies
        const matches = [];
        for (let i = 0; i < allStocks.length; i++) {
          const s = allStocks[i];
          const codeNorm = normalizeSearchText(s.code);
          let rank = -1;

          if (codeNorm === nq) rank = 0; // Exact ticker match
          else if (codeNorm.startsWith(nq)) rank = 1; // Ticker starts with
          else if (codeNorm.includes(nq)) rank = 2; // Ticker contains
          else if (s.searchTarget.includes(nq)) rank = 3; // Name / Sector / Alias match

          if (rank !== -1) {
            matches.push({ stock: s, rank });
          }
        }

        matches.sort((a, b) => {
          if (a.rank !== b.rank) return a.rank - b.rank;
          return (b.stock.capRaw || 0) - (a.stock.capRaw || 0);
        });

        const topMatches = matches.slice(0, 15);

        if (topMatches.length === 0) {
          dropdown.innerHTML = `
            <div class="p-4 text-xs text-slate-400 text-center">
              <i class="fa-solid fa-circle-exclamation text-slate-500 text-sm mb-1 block"></i>
              <strong>"${q}"</strong> ile eşleşen 1048 BIST hissesi arasında kayıt bulunamadı.
            </div>
          `;
        } else {
          dropdown.innerHTML = topMatches.map(m => {
            const s = m.stock;
            const fin = getOrGenerateStockFinancials(s.code);
            const isUp = fin.isPositive;
            const priceDisplay = !fin.liveTime ? '—' : fin.price.includes('₺') ? fin.price : `₺${fin.price}`;

            return `
              <div onclick="selectStock('${s.code}')" class="p-2.5 hover:bg-[#2F6BFF]/15 rounded-lg cursor-pointer flex items-center justify-between transition-colors border-b border-[#162238] last:border-0 group">
                <div class="flex items-center gap-3 min-w-0 pr-2">
                  ${getStockLogoHtml(s.code, 28, 'shadow flex-shrink-0')}
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-mono font-bold text-red-200 bg-red-950/60 px-2 py-0.5 rounded-md border border-red-800/50 tracking-wide text-xs font-tv">${s.code}</span>
                      ${s.isBist30 ? '<span class="text-[9px] px-1.5 py-px rounded bg-red-950/40 border border-red-800/50 text-red-300 font-mono font-bold">BIST 30</span>' : ''}
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-[#162238] text-slate-400 truncate max-w-[120px]">${s.sector}</span>
                    </div>
                    <div class="text-[11px] text-slate-300 font-medium inline-block truncate max-w-xs sm:max-w-md mt-0.5">${s.name}</div>
                  </div>
                </div>
                <div class="text-right flex-shrink-0">
                  <span class="font-mono font-bold text-xs text-white font-tradingview-nums">${priceDisplay}</span>
                  <span class="text-[10px] block font-semibold ${isUp ? 'text-[#089981]' : 'text-[#F23645]'} font-mono font-tradingview-nums">${fin.change}</span>
                </div>
              </div>
            `;
          }).join('');
        }

        dropdown.classList.remove('hidden');
      }, 75);
    });

    // Enter key selects first match, Escape closes dropdown
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const firstItem = dropdown.querySelector('[onclick]');
        if (firstItem) {
          firstItem.click();
        }
      } else if (e.key === 'Escape') {
        dropdown.classList.add('hidden');
      }
    });
  });

  // Close dropdown on external click
  document.addEventListener('click', e => {
    if (!e.target.closest('.global-search-input') && !e.target.closest('#searchDropdown')) {
      dropdown.classList.add('hidden');
    }
  });
}

function selectStock(code) {
  const dropdown = document.getElementById('searchDropdown');
  if (dropdown) dropdown.classList.add('hidden');
  document.querySelectorAll('.global-search-input').forEach(i => i.value = '');
  switchView('stock-detail', code);
  showToast(`${code} için analiz, rasyolar ve grafikler yüklendi.`);
}

function initNavigation() {
  document.querySelectorAll('[data-view-target]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const target = link.getAttribute('data-view-target');
      const stock = link.getAttribute('data-stock-target');
      switchView(target, stock);
    });
  });

  initSiteMenu();
}

/* ☰ slide-in menu: every section lives under its headings here */
function setSiteMenuOpen(open) {
  document.body.classList.toggle('menu-open', open);
  const toggle = document.getElementById('menuToggle');
  const menu = document.getElementById('siteMenu');
  if (toggle) toggle.setAttribute('aria-expanded', String(open));
  if (menu) menu.setAttribute('aria-hidden', String(!open));
}

function closeSiteMenu() {
  setSiteMenuOpen(false);
}

function initSiteMenu() {
  const toggle = document.getElementById('menuToggle');
  const menu = document.getElementById('siteMenu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', () => setSiteMenuOpen(!document.body.classList.contains('menu-open')));
  document.getElementById('menuClose')?.addEventListener('click', closeSiteMenu);
  document.getElementById('siteMenuBackdrop')?.addEventListener('click', closeSiteMenu);
  menu.addEventListener('click', e => {
    if (e.target.closest('[data-menu-close]')) closeSiteMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('menu-open')) closeSiteMenu();
  });
}

function openHomeSearch() {
  switchView('home');
  setTimeout(() => document.getElementById('homeSearchInput')?.focus(), 80);
}
window.openHomeSearch = openHomeSearch;


/* ==============================================================================
   9. Real-Time Clock, Ticker Animation & Utility Toast
   ============================================================================== */
function initClock() {
  const clockEls = document.querySelectorAll('.live-market-clock');
  function updateTime() {
    const t = new Date().toLocaleTimeString('tr-TR', { hour12: false, timeZone: 'Europe/Istanbul' });
    clockEls.forEach(el => el.textContent = `${t} TSİ`);
  }
  updateTime();
  setInterval(updateTime, 1000);
}

function showToast(message) {
  let toast = document.getElementById('utlToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'utlToast';
    toast.className = 'fixed bottom-28 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl text-xs font-sans flex items-center gap-3 transition-all duration-300 opacity-0 transform translate-y-3';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-400 text-sm"></i> <span>${message}</span>`;
  toast.classList.remove('opacity-0', 'translate-y-3');
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-3');
  }, 3000);
}

async function refreshLiveKapDisclosures() {
  const fin = appState.currentCompanyData;
  if (!fin || !window.Disclosures) return;
  const btn = document.getElementById('kapRefreshBtn');
  if (btn) btn.disabled = true;
  await Disclosures.show(fin, true);
  if (btn) btn.disabled = false;
}
/* ==============================================================================
   9. Overview Market Table Controller & Multi-Factor Quantitative Screener
   ============================================================================== */
const overviewTableState = {
  filter: 'all', // 'all', 'bist30', 'gainers', 'volume', 'alpha'
  searchQuery: '',
  pageSize: 50, // 25, 50, 100, 250, 'all'
  currentPage: 1,
  sortKey: 'score', // 'code', 'price', 'change', 'fk', 'pddd', 'fdfavok', 'roe', 'score'
  sortDirection: 'desc', // 'asc' or 'desc'
  screenerOpen: false,
  screener: {
    sector: 'all',
    fkMin: null,
    fkMax: null,
    pdddMin: null,
    pdddMax: null,
    fdFavokMax: null,
    roeMin: null,
    netDebtMax: null,
    scoreMin: 5.0,
    // Technical criteria, matched against assets/data/technicals.json (daily close)
    rsiMin: null,
    rsiMax: null,
    sma50: 'any',      // 'any' | 'above' | 'below'
    sma200: 'any',
    hi52Max: null,     // at most this many % under the 52-week high
    m1Min: null,       // 1-month return at least (%)
    volMin: null,      // last volume / 20-day average at least
    macd: 'any'        // 'any' | 'up' | 'down'
  }
};

/**
 * Daily technical snapshot for the screener, loaded the first time a technical criterion is
 * used. Rows are arrays in the order of `fields` (scripts/fetch-technicals.mjs).
 */
const TechSnapshot = (() => {
  let rows = null, fields = null, meta = null, loading = null;
  function load() {
    if (!loading) {
      loading = fetch('/assets/data/technicals.json')
        .then(r => { if (!r.ok) throw new Error(`technicals ${r.status}`); return r.json(); })
        .then(j => {
          rows = j.data; fields = j.fields; meta = { asOf: j.asOf, generatedAt: j.generatedAt, count: Object.keys(j.data).length };
          paintTechScreenerNote();
          renderOverviewStockTable();
        })
        .catch(e => { console.warn('[Screener] technical snapshot unavailable:', e.message); loading = null; paintTechScreenerNote(e); });
    }
    return loading;
  }
  /** { close, d1, ..., macd } for a code, or null when the snapshot has no row for it. */
  function get(code) {
    const r = rows && rows[code];
    if (!r) return null;
    const o = {};
    fields.forEach((f, i) => { o[f] = r[i]; });
    return o;
  }
  return { load, get, ready: () => !!rows, meta: () => meta };
})();
window.TechSnapshot = TechSnapshot;

const techCriteriaActive = sc => sc.rsiMin !== null || sc.rsiMax !== null || sc.sma50 !== 'any' || sc.sma200 !== 'any'
  || sc.hi52Max !== null || sc.m1Min !== null || sc.volMin !== null || sc.macd !== 'any';

/** Does a stock's snapshot row pass every technical criterion that is set? */
function passesTechCriteria(t, sc) {
  if (!t) return false;
  const has = v => v != null && Number.isFinite(v);
  if (sc.rsiMin !== null && !(has(t.rsi) && t.rsi >= sc.rsiMin)) return false;
  if (sc.rsiMax !== null && !(has(t.rsi) && t.rsi <= sc.rsiMax)) return false;
  if (sc.sma50 !== 'any' && !(has(t.s50) && (sc.sma50 === 'above' ? t.s50 > 0 : t.s50 < 0))) return false;
  if (sc.sma200 !== 'any' && !(has(t.s200) && (sc.sma200 === 'above' ? t.s200 > 0 : t.s200 < 0))) return false;
  if (sc.hi52Max !== null && !(has(t.hi52) && -t.hi52 <= sc.hi52Max)) return false;
  if (sc.m1Min !== null && !(has(t.m1) && t.m1 >= sc.m1Min)) return false;
  if (sc.volMin !== null && !(has(t.vol) && t.vol >= sc.volMin)) return false;
  if (sc.macd !== 'any' && t.macd !== (sc.macd === 'up' ? 1 : -1)) return false;
  return true;
}
window.passesTechCriteria = passesTechCriteria;

function paintTechScreenerNote(error) {
  const el = document.getElementById('screenerTechNote');
  if (!el) return;
  const m = TechSnapshot.meta();
  if (error) { el.textContent = 'Teknik veriler şu an yüklenemedi.'; return; }
  if (!m) { el.textContent = 'Teknik veriler ilk teknik koşulda yüklenir.'; return; }
  const day = m.asOf ? new Date(`${m.asOf}T12:00:00Z`).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  el.textContent = `${m.count} hisse · ${day} kapanışı (Yahoo Finance, gecikmeli). Verisi olmayan hisseler teknik koşulda elenir.`;
}

let overviewTableRenderRaf = null;

/**
 * Returns cached stock financials to prevent recalculating hashes across 1048 items
 */
function getCachedStockFinancials(ticker) {
  return getOrGenerateStockFinancials(ticker);
}

/**
 * Toggles the collapsible advanced screener drawer
 */
function toggleAdvancedScreener() {
  const panel = document.getElementById('advancedScreenerPanel');
  const btn = document.getElementById('toggleScreenerBtn');
  if (!panel) return;

  overviewTableState.screenerOpen = !overviewTableState.screenerOpen;
  if (overviewTableState.screenerOpen) {
    panel.classList.remove('hidden');
    if (btn) btn.classList.add('border-red-600', 'bg-red-950/40', 'text-red-300');
  } else {
    panel.classList.add('hidden');
    if (btn) btn.classList.remove('border-red-600', 'bg-red-950/40', 'text-red-300');
  }
}

/**
 * Handles screener input changes
 */
function onScreenerInputChange() {
  const sectorEl = document.getElementById('screenerSector');
  const fkMinEl = document.getElementById('screenerFkMin');
  const fkMaxEl = document.getElementById('screenerFkMax');
  const pdddMinEl = document.getElementById('screenerPdddMin');
  const pdddMaxEl = document.getElementById('screenerPdddMax');
  const fdFavokMaxEl = document.getElementById('screenerFdFavokMax');
  const roeMinEl = document.getElementById('screenerRoeMin');
  const netDebtMaxEl = document.getElementById('screenerNetDebtMax');

  overviewTableState.screener.sector = sectorEl ? sectorEl.value : 'all';
  overviewTableState.screener.fkMin = (fkMinEl && fkMinEl.value !== '') ? parseFloat(fkMinEl.value) : null;
  overviewTableState.screener.fkMax = (fkMaxEl && fkMaxEl.value !== '') ? parseFloat(fkMaxEl.value) : null;
  overviewTableState.screener.pdddMin = (pdddMinEl && pdddMinEl.value !== '') ? parseFloat(pdddMinEl.value) : null;
  overviewTableState.screener.pdddMax = (pdddMaxEl && pdddMaxEl.value !== '') ? parseFloat(pdddMaxEl.value) : null;
  overviewTableState.screener.fdFavokMax = (fdFavokMaxEl && fdFavokMaxEl.value !== '') ? parseFloat(fdFavokMaxEl.value) : null;
  overviewTableState.screener.roeMin = (roeMinEl && roeMinEl.value !== '') ? parseFloat(roeMinEl.value) : null;
  overviewTableState.screener.netDebtMax = (netDebtMaxEl && netDebtMaxEl.value !== '') ? parseFloat(netDebtMaxEl.value) : null;

  const num = id => { const el = document.getElementById(id); const v = el && el.value !== '' ? parseFloat(el.value) : NaN; return Number.isFinite(v) ? v : null; };
  const pick = id => { const el = document.getElementById(id); return el ? el.value : 'any'; };
  const sc = overviewTableState.screener;
  sc.rsiMin = num('screenerRsiMin');
  sc.rsiMax = num('screenerRsiMax');
  sc.sma50 = pick('screenerSma50');
  sc.sma200 = pick('screenerSma200');
  sc.hi52Max = num('screenerHi52Max');
  sc.m1Min = num('screenerM1Min');
  sc.volMin = num('screenerVolMin');
  sc.macd = pick('screenerMacd');
  if (techCriteriaActive(sc)) TechSnapshot.load();

  updateScreenerActiveBadge();
  overviewTableState.currentPage = 1;
  renderOverviewStockTable();
}

/**
 * Slider for Minimum ONCAL Alpha Score
 */
function onScreenerScoreSlider(val) {
  overviewTableState.screener.scoreMin = parseFloat(val) || 5.0;
  const disp = document.getElementById('screenerScoreMinDisplay');
  if (disp) disp.textContent = `${overviewTableState.screener.scoreMin.toFixed(1)}+`;

  updateScreenerActiveBadge();
  overviewTableState.currentPage = 1;
  renderOverviewStockTable();
}

/**
 * Updates the badge counter showing how many screener criteria are currently active
 */
function updateScreenerActiveBadge() {
  const badge = document.getElementById('screenerActiveBadge');
  if (!badge) return;

  const s = overviewTableState.screener;
  let activeCount = 0;
  if (s.sector && s.sector !== 'all') activeCount++;
  if (s.fkMin !== null) activeCount++;
  if (s.fkMax !== null) activeCount++;
  if (s.pdddMin !== null) activeCount++;
  if (s.pdddMax !== null) activeCount++;
  if (s.fdFavokMax !== null) activeCount++;
  if (s.roeMin !== null) activeCount++;
  if (s.netDebtMax !== null) activeCount++;
  if (s.scoreMin > 5.0) activeCount++;
  ['rsiMin', 'rsiMax', 'hi52Max', 'm1Min', 'volMin'].forEach(k => { if (s[k] !== null) activeCount++; });
  ['sma50', 'sma200', 'macd'].forEach(k => { if (s[k] !== 'any') activeCount++; });

  if (activeCount > 0) {
    badge.textContent = activeCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

/**
 * Applies 1-click Preset Screens
 */
function applyScreenerPreset(presetName) {
  resetScreenerFormInputs();

  if (presetName === 'dividend') {
    // Temettü Ödeyenler: F/K < 10, ROE > %20, Net Borç < 1.5x, Skor >= 7.5
    setScreenerInputValue('screenerFkMax', 10.0);
    setScreenerInputValue('screenerRoeMin', 20.0);
    setScreenerInputValue('screenerNetDebtMax', 1.5);
    setScreenerScoreSliderValue(7.5);
  } else if (presetName === 'cashRich') {
    // Net Nakitte Olanlar: Net Borç <= 0.0x, Skor >= 7.0
    setScreenerInputValue('screenerNetDebtMax', 0.0);
    setScreenerScoreSliderValue(7.0);
  } else if (presetName === 'valueIndustrial') {
    // Ucuz Sanayi Şirketleri: Sektör Sanayi, F/K < 8.5, PD/DD < 1.8, FD/FAVÖK < 6.5
    setScreenerSelectValue('screenerSector', 'Sanayi');
    setScreenerInputValue('screenerFkMax', 8.5);
    setScreenerInputValue('screenerPdddMax', 1.8);
    setScreenerInputValue('screenerFdFavokMax', 6.5);
    setScreenerScoreSliderValue(7.0);
  } else if (presetName === 'qualityGrowth') {
    // Yüksek Kârlı Büyüme: ROE >= %35, Skor >= 8.5
    setScreenerInputValue('screenerRoeMin', 35.0);
    setScreenerScoreSliderValue(8.5);
  } else if (presetName === 'oversoldValue') {
    // Aşırı satımda ucuz: RSI <= 30, F/K <= 8
    setScreenerInputValue('screenerRsiMax', 30);
    setScreenerInputValue('screenerFkMax', 8);
  } else if (presetName === 'uptrend') {
    // Yükseliş trendi: SMA 50 ve SMA 200 üzerinde, RSI 50-70, MACD pozitif
    setScreenerSelectValue('screenerSma50', 'above');
    setScreenerSelectValue('screenerSma200', 'above');
    setScreenerInputValue('screenerRsiMin', 50);
    setScreenerInputValue('screenerRsiMax', 70);
    setScreenerSelectValue('screenerMacd', 'up');
  } else if (presetName === 'nearHigh') {
    // 52 haftalık zirveye yakın, hacimli: zirveye en fazla %5, hacim ortalamanın 1,5 katı
    setScreenerInputValue('screenerHi52Max', 5);
    setScreenerInputValue('screenerVolMin', 1.5);
  }

  onScreenerInputChange();
  const PRESET_NAMES = { dividend: 'Temettü Ödeyenler', cashRich: 'Net Nakitte Olanlar', valueIndustrial: 'Ucuz Sanayi', qualityGrowth: 'Yüksek Kârlı Büyüme', oversoldValue: 'Aşırı Satımda Ucuz', uptrend: 'Yükseliş Trendi', nearHigh: 'Zirveye Yakın' };
  showToast(`Tarama şablonu uygulandı: ${PRESET_NAMES[presetName] || presetName}`);
}

function setScreenerInputValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function setScreenerSelectValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function setScreenerScoreSliderValue(val) {
  const el = document.getElementById('screenerScoreMin');
  if (el) el.value = val;
  const disp = document.getElementById('screenerScoreMinDisplay');
  if (disp) disp.textContent = `${parseFloat(val).toFixed(1)}+`;
}

/**
 * Resets all screener filters to default
 */
function resetScreenerFilters() {
  resetScreenerFormInputs();
  onScreenerInputChange();
  showToast('Tüm kantitatif filtreler sıfırlandı.');
}

function resetScreenerFormInputs() {
  ['screenerFkMin', 'screenerFkMax', 'screenerPdddMin', 'screenerPdddMax', 'screenerFdFavokMax', 'screenerRoeMin', 'screenerNetDebtMax',
    'screenerRsiMin', 'screenerRsiMax', 'screenerHi52Max', 'screenerM1Min', 'screenerVolMin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['screenerSma50', 'screenerSma200', 'screenerMacd'].forEach(id => setScreenerSelectValue(id, 'any'));
  const secEl = document.getElementById('screenerSector');
  if (secEl) secEl.value = 'all';
  setScreenerScoreSliderValue(5.0);
}

/**
 * Column sorting toggle
 */
function toggleOverviewSort(key) {
  if (overviewTableState.sortKey === key) {
    overviewTableState.sortDirection = (overviewTableState.sortDirection === 'asc') ? 'desc' : 'asc';
  } else {
    overviewTableState.sortKey = key;
    // Sensible defaults
    overviewTableState.sortDirection = (key === 'code' || key === 'fk' || key === 'pddd' || key === 'fdfavok') ? 'asc' : 'desc';
  }

  overviewTableState.currentPage = 1;
  updateSortHeaderIcons();
  renderOverviewStockTable();
}

function updateSortHeaderIcons() {
  const sortKeys = ['code', 'price', 'change', 'fk', 'pddd', 'fdfavok', 'roe', 'score'];
  sortKeys.forEach(k => {
    const icon = document.getElementById(`sortIcon-${k}`);
    if (!icon) return;

    if (overviewTableState.sortKey === k) {
      if (overviewTableState.sortDirection === 'asc') {
        icon.className = 'fa-solid fa-sort-up text-red-400 font-bold text-[10px]';
      } else {
        icon.className = 'fa-solid fa-sort-down text-red-400 font-bold text-[10px]';
      }
    } else {
      icon.className = 'fa-solid fa-sort text-slate-600 group-hover:text-slate-300 text-[10px]';
    }
  });
}

/**
 * Pagination Controls
 */
function changeOverviewPage(delta) {
  overviewTableState.currentPage = Math.max(1, overviewTableState.currentPage + delta);
  renderOverviewStockTable();
  const table = document.getElementById('masterOverviewStockTable');
  if (table) table.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function onOverviewPageSizeChange(val) {
  overviewTableState.pageSize = (val === 'all') ? 2000 : parseInt(val, 10) || 50;
  overviewTableState.currentPage = 1;
  renderOverviewStockTable();
}

/**
 * CSV Export functionality (UTF-8 with BOM for Excel Turkish compatibility)
 */
function exportOverviewTableToCsv() {
  const allStocks = getFullBistStockList();
  if (!allStocks || !allStocks.length) {
    showToast('Dışa aktarılacak veri bulunamadı.');
    return;
  }

  // Use the currently filtered list
  const filtered = getFilteredAndSortedStocks(allStocks);
  if (!filtered.length) {
    showToast('Filtre sonucu dışa aktarılacak hisse yok.');
    return;
  }

  const headers = [
    'Borsa Kodu',
    'Şirket Unvanı',
    'Sektör',
    'Endeks',
    'Son Fiyat (TL)',
    'Günlük Değişim (%)',
    'F/K Oranı',
    'PD/DD Oranı',
    'FD/FAVÖK',
    'ROE (%)',
    'Net Borç/FAVÖK',
    'ONCAL Alpha Skoru'
  ];

  const rows = filtered.map(s => {
    const fin = getCachedStockFinancials(s.code);
    return [
      s.code,
      `"${(s.name || '').replace(/"/g, '""')}"`,
      `"${(s.sector || '').replace(/"/g, '""')}"`,
      s.isBist30 ? 'BIST 30' : 'BIST TÜM',
      fin.priceNum > 0 ? fin.priceNum.toFixed(2).replace('.', ',') : '',
      (fin.change || '').replace('%', '').trim(),
      fin.fk.replace('.', ','),
      fin.pddd.replace('.', ','),
      fin.fdFavok.replace('.', ','),
      (fin.roe || '').replace('%', '').trim().replace('.', ','),
      (fin.netDebt || '').replace('x', '').trim().replace('.', ','),
      fin.score == null ? '' : fin.score.toFixed(1).replace('.', ',')
    ].join(';');
  });

  const csvContent = '\uFEFF' + headers.join(';') + '\r\n' + rows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `BIST_Kantitatif_Tarama_${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`${filtered.length} adet BIST hissesi CSV olarak indirildi.`);
}

/**
 * Filter & Sort pipeline (used by both rendering and CSV export)
 */
function getFilteredAndSortedStocks(allStocks) {
  let list = allStocks;

  // 1. Text Search Filter across ticker, name, sector
  if (overviewTableState.searchQuery) {
    const q = normalizeSearchText(overviewTableState.searchQuery);
    list = list.filter(s => s.searchTarget.includes(q));
  }

  // 2. Tab Filter
  if (overviewTableState.filter === 'bist30') {
    list = list.filter(s => s.isBist30);
  } else if (overviewTableState.filter === 'gainers') {
    list = list.filter(s => {
      const fin = getCachedStockFinancials(s.code);
      return fin.isPositive;
    });
  } else if (overviewTableState.filter === 'volume') {
    // Handled in sort or top cap
  } else if (overviewTableState.filter === 'alpha') {
    list = list.filter(s => {
      const fin = getCachedStockFinancials(s.code);
      return fin.score >= 8.5;
    });
  }

  // 3. Multi-Factor Quantitative Screener Filters
  const sc = overviewTableState.screener;
  if (sc) {
    if (sc.sector && sc.sector !== 'all') {
      list = list.filter(s => (s.sector || '').includes(sc.sector));
    }

    if (sc.fkMin !== null || sc.fkMax !== null || sc.pdddMin !== null || sc.pdddMax !== null ||
        sc.fdFavokMax !== null || sc.roeMin !== null || sc.netDebtMax !== null || sc.scoreMin > 5.0) {
      list = list.filter(s => {
        const fin = getCachedStockFinancials(s.code);
        const fkNum = fin.fkNum !== undefined ? fin.fkNum : (parseFloat(fin.fk) || 0);
        const pdddNum = fin.pdddNum !== undefined ? fin.pdddNum : (parseFloat(fin.pddd) || 0);
        const fdFavokNum = fin.fdFavokNum !== undefined ? fin.fdFavokNum : (parseFloat(fin.fdFavok) || 0);
        const roeNum = fin.roeNum !== undefined ? fin.roeNum : (parseFloat((fin.roe || '0').replace('%', '').replace(',', '.')) || 0);
        const netDebtNum = fin.netDebtNum !== undefined ? fin.netDebtNum : (parseFloat((fin.netDebt || '1').replace('x', '').replace(',', '.')) || 0);

        if (sc.fkMin !== null && fkNum < sc.fkMin) return false;
        if (sc.fkMax !== null && fkNum > sc.fkMax) return false;
        if (sc.pdddMin !== null && pdddNum < sc.pdddMin) return false;
        if (sc.pdddMax !== null && pdddNum > sc.pdddMax) return false;
        if (sc.fdFavokMax !== null && fdFavokNum > sc.fdFavokMax) return false;
        if (sc.roeMin !== null && roeNum < sc.roeMin) return false;
        if (sc.netDebtMax !== null && netDebtNum > sc.netDebtMax) return false;
        if (sc.scoreMin && fin.score < sc.scoreMin) return false;

        return true;
      });
    }

    // Technical criteria wait for the snapshot (TechSnapshot.load re-renders the table)
    if (techCriteriaActive(sc)) {
      list = TechSnapshot.ready() ? list.filter(s => passesTechCriteria(TechSnapshot.get(s.code), sc)) : [];
    }
  }

  // 4. Sorting
  const sortKey = overviewTableState.sortKey || 'score';
  const sortDir = overviewTableState.sortDirection === 'asc' ? 1 : -1;

  list.sort((a, b) => {
    if (overviewTableState.filter === 'volume' && sortKey === 'score') {
      return ((b.capRaw || 0) - (a.capRaw || 0));
    }

    const finA = getCachedStockFinancials(a.code);
    const finB = getCachedStockFinancials(b.code);

    if (sortKey === 'code') {
      return a.code.localeCompare(b.code) * sortDir;
    } else if (sortKey === 'price') {
      const pa = finA.priceNum !== undefined ? finA.priceNum : (parseFloat(finA.price) || 0);
      const pb = finB.priceNum !== undefined ? finB.priceNum : (parseFloat(finB.price) || 0);
      return (pa - pb) * sortDir;
    } else if (sortKey === 'change') {
      const ca = finA.changeNum !== undefined ? finA.changeNum : ((finA.isPositive ? 1 : -1) * (parseFloat((finA.change || '0').replace(/[^\d.,]/g, '').replace(',', '.')) || 0));
      const cb = finB.changeNum !== undefined ? finB.changeNum : ((finB.isPositive ? 1 : -1) * (parseFloat((finB.change || '0').replace(/[^\d.,]/g, '').replace(',', '.')) || 0));
      return (ca - cb) * sortDir;
    } else if (sortKey === 'fk') {
      const fka = finA.fkNum !== undefined ? finA.fkNum : (parseFloat(finA.fk) || 0);
      const fkb = finB.fkNum !== undefined ? finB.fkNum : (parseFloat(finB.fk) || 0);
      return (fka - fkb) * sortDir;
    } else if (sortKey === 'pddd') {
      const pda = finA.pdddNum !== undefined ? finA.pdddNum : (parseFloat(finA.pddd) || 0);
      const pdb = finB.pdddNum !== undefined ? finB.pdddNum : (parseFloat(finB.pddd) || 0);
      return (pda - pdb) * sortDir;
    } else if (sortKey === 'fdfavok') {
      const fda = finA.fdFavokNum !== undefined ? finA.fdFavokNum : (parseFloat(finA.fdFavok) || 0);
      const fdb = finB.fdFavokNum !== undefined ? finB.fdFavokNum : (parseFloat(finB.fdFavok) || 0);
      return (fda - fdb) * sortDir;
    } else if (sortKey === 'roe') {
      const roea = finA.roeNum !== undefined ? finA.roeNum : (parseFloat((finA.roe || '0').replace('%', '').replace(',', '.')) || 0);
      const roeb = finB.roeNum !== undefined ? finB.roeNum : (parseFloat((finB.roe || '0').replace('%', '').replace(',', '.')) || 0);
      return (roea - roeb) * sortDir;
    } else if (sortKey === 'score') {
      return ((finA.score ?? -1) - (finB.score ?? -1)) * sortDir;
    }
    return 0;
  });

  return list;
}

/**
 * High-performance Windowed Table Renderer with requestAnimationFrame
 */
function renderOverviewStockTable() {
  const tbody = document.getElementById('overviewStockTableBody');
  const summaryEl = document.getElementById('overviewTableSummary');
  const loadMoreBtn = document.getElementById('overviewLoadMoreBtn');
  const screenerMatchEl = document.getElementById('screenerMatchCount');
  const pageDisp = document.getElementById('overviewPageNumberDisplay');
  const prevBtn = document.getElementById('overviewPrevPageBtn');
  const nextBtn = document.getElementById('overviewNextPageBtn');
  if (!tbody) return;

  const t0 = performance.now();
  const allStocks = getFullBistStockList();
  if (!allStocks || !allStocks.length) return;

  const filtered = getFilteredAndSortedStocks(allStocks);
  const totalMatching = filtered.length;

  if (screenerMatchEl) {
    screenerMatchEl.textContent = `${totalMatching} Şirket Eşleşti`;
  }

  // Pagination bounds
  const pageSize = overviewTableState.pageSize || 50;
  const totalPages = Math.max(1, Math.ceil(totalMatching / pageSize));
  if (overviewTableState.currentPage > totalPages) {
    overviewTableState.currentPage = totalPages;
  }
  const curPage = overviewTableState.currentPage;

  const startIndex = (curPage - 1) * pageSize;
  const visibleItems = (pageSize >= 1000) ? filtered : filtered.slice(startIndex, startIndex + pageSize);
  const visibleCount = visibleItems.length;

  if (pageDisp) pageDisp.textContent = `Sayfa ${curPage} / ${totalPages}`;
  if (prevBtn) prevBtn.disabled = (curPage <= 1);
  if (nextBtn) nextBtn.disabled = (curPage >= totalPages);

  if (totalMatching === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center py-10 text-slate-400 text-xs">
          <i class="fa-solid fa-filter-circle-xmark text-slate-500 text-2xl mb-2 block"></i>
          Seçilen kantitatif kriterlerle eşleşen BIST hissesi bulunamadı.
          <button onclick="resetScreenerFilters()" class="mt-2 block mx-auto text-red-400 hover:underline font-bold">Filtreleri Sıfırla</button>
        </td>
      </tr>
    `;
    if (summaryEl) summaryEl.textContent = '0 BIST Şirketi bulundu';
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    return;
  }

  // Cancel any scheduled frame to avoid race conditions
  if (overviewTableRenderRaf) {
    cancelAnimationFrame(overviewTableRenderRaf);
  }

  overviewTableRenderRaf = requestAnimationFrame(() => {
    tbody.innerHTML = visibleItems.map(s => {
      const fin = getCachedStockFinancials(s.code);
      const isUp = fin.isPositive;
      const chgStr = fin.change ? fin.change.replace(/[+\-%]/g, '').trim() : '0,00';
      const priceDisplay = fin.price.replace('₺', '').trim();

      const scoreClass = fin.score >= 9.0 
        ? 'bg-red-950/80 text-red-300 border-red-500/40' 
        : fin.score >= 8.0 
        ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/40' 
        : 'bg-slate-800/80 text-slate-300 border-slate-700/50';

      return `
        <tr class="overview-table-row hover:bg-[#162238]/60 transition-colors group cursor-pointer" onclick="if(!event.target.closest('button')) switchView('stock-detail', '${s.code}')" data-code="${s.code}">
          <td>
            <div class="flex items-center gap-3">
              ${getStockLogoHtml(s.code, 32, 'shadow flex-shrink-0')}
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="font-bold text-red-200 bg-red-950/60 px-2 py-0.5 rounded-md border border-red-800/50 tracking-wide font-tv text-xs">${s.code}</span>
                  ${s.isBist30 ? '<span class="whitespace-nowrap text-[9px] px-1.5 py-px rounded bg-red-950/40 border border-red-800/50 text-red-300 font-mono font-bold">BIST 30</span>' : ''}
                  <button type="button" class="about-btn" onclick="openStockAbout('${s.code}')" title="${s.name} hakkında"><i class="fa-solid fa-circle-info"></i>Hakkında</button>
                </div>
                <div class="text-xs text-slate-300 font-medium truncate max-w-[200px] mt-0.5 inline-block" title="${s.name}">${s.name}</div>
              </div>
            </div>
          </td>
          <td class="text-right font-mono font-bold text-white font-tradingview-nums">${fin.liveTime ? `${priceDisplay} TL` : '<span class="text-slate-500" title="Fiyat yükleniyor veya alınamadı">—</span>'}</td>
          <td class="text-right">
            ${fin.liveTime && fin.change ? `<span class="inline-flex items-center gap-1 text-xs font-mono font-bold px-2 py-0.5 rounded font-tradingview-nums ${isUp ? 'tv-pill-up' : 'tv-pill-down'}">
              ${isUp ? '▲ +' : '▼ -'}${chgStr}%
            </span>` : '<span class="text-slate-500 font-mono text-xs">—</span>'}
          </td>
          <td class="text-right font-mono text-slate-300 font-tradingview-nums${fin.fundamentalsLive ? ' is-real' : ''}">${fin.fk}</td>
          <td class="text-right font-mono text-slate-300 font-tradingview-nums${fin.fundamentalsLive ? ' is-real' : ''}">${fin.pddd}</td>
          <td class="text-right font-mono text-slate-300 font-tradingview-nums${fin.fundamentalsLive ? ' is-real' : ''}">${fin.fdFavok}</td>
          <td class="text-right font-mono text-emerald-300 font-semibold font-tradingview-nums${fin.fundamentalsLive ? ' is-real' : ''}">${fin.roe}</td>
          <td class="text-center">
            <span class="px-2 py-0.5 rounded font-mono font-bold text-xs border font-tradingview-nums ${scoreClass}">
              ${fin.score ?? '—'}
            </span>
          </td>
          <td class="text-center">
            <button onclick="switchView('stock-detail', '${s.code}')" class="px-3 py-1 rounded-lg bg-[#2F6BFF]/20 hover:bg-[#2F6BFF] text-red-300 hover:text-white border border-red-500/30 font-semibold text-xs transition-all">
              Detay
            </button>
          </td>
        </tr>
      `;
    }).join('');

    if (window.LiveData) LiveData.syncTable(visibleItems.map(s => s.code));

    const t1 = performance.now();
    const renderTime = (t1 - t0).toFixed(1);

    if (summaryEl) {
      summaryEl.textContent = `${totalMatching} BIST Hissesi (${visibleCount} listeleniyor • Sayfa ${curPage}/${totalPages}) • ${renderTime} ms`;
    }

    if (loadMoreBtn) {
      if (curPage >= totalPages || pageSize >= 1000) {
        loadMoreBtn.style.display = 'none';
      } else {
        loadMoreBtn.style.display = 'inline-flex';
        loadMoreBtn.innerHTML = `<i class="fa-solid fa-arrow-down text-[10px]"></i> <span>Sonraki Sayfa (+${pageSize})</span>`;
      }
    }
  });
}

function initStockTableFilters() {
  // 1. Filter Tab Buttons
  const tabs = document.querySelectorAll('.overview-table-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.className = 'overview-table-tab px-3 py-2 rounded-xl bg-[#090D18] text-slate-400 hover:text-white hover:bg-[#121C30] border border-[#1E2B45] transition-all';
      });
      tab.className = 'overview-table-tab px-3 py-2 rounded-xl bg-[#2F6BFF] text-white shadow-md shadow-red-600/30 transition-all';

      overviewTableState.filter = tab.getAttribute('data-filter') || 'all';
      overviewTableState.currentPage = 1;
      renderOverviewStockTable();
    });
  });

  // 2. Overview Table Search Input (Debounced)
  const searchInput = document.getElementById('overviewTableSearch');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', e => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        overviewTableState.searchQuery = e.target.value.trim();
        overviewTableState.currentPage = 1;
        renderOverviewStockTable();
      }, 100);
    });
  }

  // 3. Load More Button
  const loadMoreBtn = document.getElementById('overviewLoadMoreBtn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      changeOverviewPage(1);
    });
  }

  // Initial sort icons and render
  updateSortHeaderIcons();
  renderOverviewStockTable();
}

// Global exports
window.toggleAdvancedScreener = toggleAdvancedScreener;
window.onScreenerInputChange = onScreenerInputChange;
window.onScreenerScoreSlider = onScreenerScoreSlider;
window.applyScreenerPreset = applyScreenerPreset;
window.resetScreenerFilters = resetScreenerFilters;
window.toggleOverviewSort = toggleOverviewSort;
window.changeOverviewPage = changeOverviewPage;
window.onOverviewPageSizeChange = onOverviewPageSizeChange;
window.exportOverviewTableToCsv = exportOverviewTableToCsv;

function initIncomeStatementFilter() {}
function initSectorFilters() {}


/* ==============================================================================
   10. Market news: real headlines, see assets/js/news.js
   ============================================================================== */
const newsCenterState = { currentCategory: 'all', currentImpact: 'all', searchQuery: '' };

function renderNewsCenter() { if (window.NewsFeed) NewsFeed.paintCenter(); }
function renderOverviewNewsPreview() { if (window.NewsFeed) NewsFeed.loadPreview(); }
function openNewsModal() {}
function initNewsCenter() {}   // news.js initialises itself
function resetNewsFilters() { if (window.NewsFeed) NewsFeed.reset(); }

/* ==============================================================================
   11. Global Window API Exports (Template Compatibility)
   ============================================================================== */
window.switchView = switchView;
window.selectStock = selectStock;
window.setBalanceCurrency = setBalanceCurrency;
window.setBalancePeriod = setBalancePeriod;
window.filterBalanceTable = filterBalanceTable;
window.renderPeerComparison = renderPeerComparison;
window.renderPeerComparisonModule = renderPeerComparisonModule;
window.selectPeerStock = selectPeerStock;
window.handleCustomPeerSubmit = handleCustomPeerSubmit;
window.renderCapitalAndDividendIntelligence = renderCapitalAndDividendIntelligence;
window.showToast = showToast;
window.loadStockDetails = loadStockDetails;
window.refreshLiveKapDisclosures = refreshLiveKapDisclosures;
window.renderOverviewStockTable = renderOverviewStockTable;
window.getFullBistStockList = getFullBistStockList;
window.getOrGenerateStockFinancials = getOrGenerateStockFinancials;
window.overviewTableState = overviewTableState;

// News Center Exports
window.newsCenterState = newsCenterState;
window.renderNewsCenter = renderNewsCenter;
window.renderOverviewNewsPreview = renderOverviewNewsPreview;
window.openNewsModal = openNewsModal;
window.initNewsCenter = initNewsCenter;

// Intro Splash & Stock Logo Exports
window.playIntroSplash = playIntroSplash;
window.dismissIntroSplash = dismissIntroSplash;
window.replayIntroAnimation = replayIntroAnimation;
window.getStockLogoHtml = getStockLogoHtml;
window.STOCK_LOGOS_DB = STOCK_LOGOS_DB;
window.TV_HARMONIC_GRADIENTS = TV_HARMONIC_GRADIENTS;
// Immediate execution for synchronously present DOM elements
try {
  if (typeof initNewsCenter === 'function') {
    initNewsCenter();
  }
} catch (e) {
  console.warn('News center init note:', e);
}

/* ==============================================================================
   11.1. Terminal Command Palette (Command Palette - Cmd+K / /)
   - Global Klavye Dinleyicisi (Ctrl+K, Cmd+K, '/')
   - Hızlı Terminal Komutları: /bilanço, /kıyas, /tarayıcı, /gündem, /raporlar, /alarm
   - 1048 Hisselik Anlık Arama ve Klavye Ok Tuşlarıyla (ArrowUp/Down/Enter) Gezinme
   ============================================================================== */

let commandPaletteSelectedIndex = 0;
let commandPaletteCurrentActions = [];

function initTerminalCommandPalette() {
  const modal = document.getElementById('commandPaletteModal');
  const input = document.getElementById('commandPaletteInput');
  if (!modal || !input) return;

  // Global Keyboard Shortcuts (Ctrl+K, Cmd+K veya '/')
  window.addEventListener('keydown', (e) => {
    // Cmd+K veya Ctrl+K
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      toggleTerminalCommandPalette();
      return;
    }

    // '/' tuşu (ancak form input/textarea veya içerik düzenleme alanında değilken)
    const activeEl = document.activeElement;
    const isInputActive = activeEl && (
      activeEl.tagName === 'INPUT' || 
      activeEl.tagName === 'TEXTAREA' || 
      activeEl.isContentEditable
    );

    if (e.key === '/' && !isInputActive && modal.classList.contains('hidden')) {
      e.preventDefault();
      openTerminalCommandPalette();
      return;
    }

    // Modal açıkken klavye yönetimi
    if (!modal.classList.contains('hidden')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeTerminalCommandPalette();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateCommandPaletteSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateCommandPaletteSelection(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeCommandPaletteSelection();
      }
    }
  });

  // Modal dışına tıklayınca kapatma
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeTerminalCommandPalette();
    }
  });

  // Input anlık dinleyicisi
  input.addEventListener('input', (e) => {
    commandPaletteSelectedIndex = 0;
    renderCommandPaletteResults(e.target.value);
  });
}

function openTerminalCommandPalette() {
  const modal = document.getElementById('commandPaletteModal');
  const input = document.getElementById('commandPaletteInput');
  if (!modal || !input) return;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  input.value = '';
  commandPaletteSelectedIndex = 0;
  renderCommandPaletteResults('');
  setTimeout(() => input.focus(), 60);
}
window.openTerminalCommandPalette = openTerminalCommandPalette;

function closeTerminalCommandPalette() {
  const modal = document.getElementById('commandPaletteModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}
window.closeTerminalCommandPalette = closeTerminalCommandPalette;

function toggleTerminalCommandPalette() {
  const modal = document.getElementById('commandPaletteModal');
  if (!modal) return;
  if (modal.classList.contains('hidden')) {
    openTerminalCommandPalette();
  } else {
    closeTerminalCommandPalette();
  }
}
window.toggleTerminalCommandPalette = toggleTerminalCommandPalette;

function setCommandPaletteText(text) {
  const input = document.getElementById('commandPaletteInput');
  if (!input) return;
  input.value = text;
  input.focus();
  commandPaletteSelectedIndex = 0;
  renderCommandPaletteResults(text);
}
window.setCommandPaletteText = setCommandPaletteText;

function navigateCommandPaletteSelection(direction) {
  if (!commandPaletteCurrentActions.length) return;
  commandPaletteSelectedIndex += direction;
  if (commandPaletteSelectedIndex < 0) commandPaletteSelectedIndex = commandPaletteCurrentActions.length - 1;
  if (commandPaletteSelectedIndex >= commandPaletteCurrentActions.length) commandPaletteSelectedIndex = 0;
  updateCommandPaletteItemHighlight();
}

function updateCommandPaletteItemHighlight() {
  const items = document.querySelectorAll('.cmd-palette-item');
  items.forEach((item, idx) => {
    if (idx === commandPaletteSelectedIndex) {
      item.classList.add('bg-red-600/25', 'border-red-500', 'text-white');
      item.classList.remove('bg-transparent', 'text-slate-300');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('bg-red-600/25', 'border-red-500', 'text-white');
      item.classList.add('bg-transparent', 'text-slate-300');
    }
  });
}

function executeCommandPaletteSelection() {
  if (commandPaletteCurrentActions.length > 0 && commandPaletteCurrentActions[commandPaletteSelectedIndex]) {
    const action = commandPaletteCurrentActions[commandPaletteSelectedIndex];
    closeTerminalCommandPalette();
    if (typeof action.run === 'function') {
      action.run();
    }
  }
}

function renderCommandPaletteResults(query) {
  const container = document.getElementById('commandPaletteResults');
  if (!container) return;

  const rawQ = (query || '').trim();
  const q = rawQ.toLowerCase();
  const actions = [];

  // 1. SLASH COMMANDS ENGINE (/ ile başlayan komutlar)
  if (q.startsWith('/')) {
    const parts = rawQ.slice(1).trim().split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    const arg1 = (parts[1] || '').toUpperCase();
    const arg2 = (parts[2] || '').toUpperCase();

    // A. /bilanço [TICKER]
    if ('bilanço'.startsWith(cmd) || cmd === 'bilanco' || cmd === 'bs') {
      const ticker = arg1 || 'THYAO';
      actions.push({
        title: `/bilanço ${ticker}`,
        desc: `${ticker} KAP Konsolide Resmi Bilanço Tablosunu Odaklar`,
        icon: 'fa-solid fa-file-invoice-dollar text-red-400',
        badge: 'BİLANÇO',
        run: () => {
          switchView('stock-detail');
          loadStockDetails(ticker);
          if (typeof switchStockSubTab === 'function') switchStockSubTab('financials');
          setTimeout(() => {
            const el = document.getElementById('stockBalanceSheetTbody');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 400);
        }
      });
    }

    // B. /kıyas [TICKER1] [TICKER2]
    if ('kıyas'.startsWith(cmd) || cmd === 'kiyas' || cmd === 'peer' || cmd === 'radar') {
      const t1 = arg1 || 'EREGL';
      const t2 = arg2 || (t1 === 'EREGL' ? 'KRDMD' : 'PGSUS');
      actions.push({
        title: `/kıyas ${t1} ${t2}`,
        desc: `${t1} ve ${t2} Başabaş 6 Eksenli Radar & Çarpan Kıyaslaması`,
        icon: 'fa-solid fa-code-compare text-purple-400',
        badge: 'KIYASLAMA',
        run: () => {
          switchView('stock-detail');
          loadStockDetails(t1);
          if (typeof switchStockSubTab === 'function') switchStockSubTab('technical');
          setTimeout(() => {
            if (typeof selectPeerStock === 'function') selectPeerStock(t2);
            const el = document.getElementById('peerComparisonSection');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 450);
        }
      });
    }

    // C. /tarayıcı
    if ('tarayıcı'.startsWith(cmd) || cmd === 'tarayici' || cmd === 'screener' || cmd === 'filtre') {
      actions.push({
        title: '/tarayıcı',
        desc: 'Genel Bakış: 1048 Hisselik Çok Faktörlü Kantitatif Tarayıcı Filtresini Aç',
        icon: 'fa-solid fa-filter text-emerald-400',
        badge: 'TARAYICI',
        run: () => {
          switchView('overview');
          setTimeout(() => {
            const el = document.getElementById('screenerFilterCard');
            if (el && el.classList.contains('hidden')) {
              if (typeof toggleScreenerPanel === 'function') toggleScreenerPanel();
            }
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 350);
        }
      });
    }

    // G. /gündem
    if ('gündem'.startsWith(cmd) || cmd === 'gundem' || cmd === 'haber' || cmd === 'news') {
      actions.push({
        title: '/gündem',
        desc: 'Piyasa Gündemi & Sıcak Gelişmeler Masasını Aç',
        icon: 'fa-regular fa-newspaper text-slate-300',
        badge: 'HABERLER',
        run: () => switchView('news')
      });
    }

    // H. /raporlar
    if ('raporlar'.startsWith(cmd) || cmd === 'rapor' || cmd === 'reports') {
      actions.push({
        title: '/raporlar',
        desc: 'Sektör çarpanları ve korelasyon sayfasını aç',
        icon: 'fa-solid fa-chart-pie text-indigo-400',
        badge: 'ARAŞTIRMA',
        run: () => switchView('reports')
      });
    }

    // I. /alarm [Hisse] [Fiyat]
    // "/al" is the buy command of the profile (K below), not the start of "/alarm"
    if (('alarm'.startsWith(cmd) && cmd !== 'al') || cmd === 'alert') {
      const ticker = arg1 || 'THYAO';
      const targetVal = parseFloat(arg2) || 320.0;
      actions.push({
        title: `/alarm ${ticker} ${targetVal}`,
        desc: `${ticker} için ₺${targetVal.toFixed(2)} seviyesine Fiyat Alarmı Kur`,
        icon: 'fa-solid fa-bell text-amber-400',
        badge: 'FİYAT ALARMI',
        run: () => {
          saveAlert({
            id: 'alt_' + Date.now(),
            ticker: ticker,
            type: 'price_above',
            targetValue: targetVal,
            note: 'Komut Paleti Hızlı Alarmı',
            createdAt: 'Bugün ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            triggered: false,
            triggeredAt: null
          });
          showTerminalToast(`Alarm Kuruldu: ${ticker}`, `Hedef ₺${targetVal.toFixed(2)} fiyat alarmı kaydedildi.`, ticker, 'success');
        }
      });
    }

    // K. Profile commands: /al, /sat, /izle, /not, /portföy (recorded on the profile page)
    const profileWord = {
      al: 'Alış kaydı', sat: 'Satış kaydı', izle: 'İzleme listesi', not: 'Yatırım notu', stop: 'Zarar-kes seviyesi',
      hedef: 'Hedef fiyat', 'ağırlık': 'Hedef ağırlık', agirlik: 'Hedef ağırlık', nakit: 'Portföy nakdi',
      'günlük': 'Yatırım günlüğü', gunluk: 'Yatırım günlüğü'
    }[cmd];
    if (window.Profile && profileWord && arg1) {
      const line = rawQ.slice(1).trim();
      actions.push({
        title: `/${line.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)}`,
        desc: `${profileWord} · Profilim sayfasına işlenir (aracı kuruma emir iletilmez)`,
        icon: 'fa-solid fa-briefcase text-emerald-400',
        badge: 'PROFİL',
        run: () => Profile.run(line)
      });
    }
    if (['portföy', 'portfoy', 'profil', 'profilim'].some(w => w.startsWith(cmd)) && cmd) {
      actions.push({
        title: '/profil',
        desc: 'Profilim: portföy, sektörlerin uzun dönem seyri, incelenen hisseler ve komut geçmişi',
        icon: 'fa-solid fa-user text-[#7FA6FF]',
        badge: 'PROFİL',
        run: () => switchView('profile')
      });
    }

    // J. /hakkımızda & /iletisim
    if ('hakkımızda'.startsWith(cmd) || cmd === 'hakkimizda' || cmd === 'about' || cmd === 'iletisim' || cmd === 'iletişim' || cmd === 'yardım' || cmd === 'yardim') {
      actions.push({
        title: '/hakkımızda',
        desc: 'ONCAL Platform Misyonu, Bilanço Analitik Metodolojisi and İletişim Masası',
        icon: 'fa-solid fa-circle-info text-blue-400',
        badge: 'HAKKIMIZDA',
        run: () => switchView('about')
      });
    }
  }

  // 2. STOCK SEARCH MATCHES (Tüm 1048 BIST hisseleri)
  const searchCandidates = (typeof cachedBistStockList !== 'undefined' && Array.isArray(cachedBistStockList) && cachedBistStockList.length > 0)
    ? cachedBistStockList
    : [
        { code: 'THYAO', name: 'Türk Hava Yolları A.O.', sector: 'Ulaştırma & Havacılık', price: '₺312,50', change: '+%3,82' },
        { code: 'GARAN', name: 'Türkiye Garanti Bankası A.Ş.', sector: 'Bankacılık & Finans', price: '₺118,40', change: '+%2,15' },
        { code: 'AKBNK', name: 'Akbank T.A.Ş.', sector: 'Bankacılık & Finans', price: '₺58,40', change: '+%1,92' },
        { code: 'FROTO', name: 'Ford Otomotiv Sanayi A.Ş.', sector: 'Otomotiv', price: '₺1.085,00', change: '+%2,45' },
        { code: 'ASELS', name: 'Aselsan Elektronik Sanayi A.Ş.', sector: 'Savunma & Teknoloji', price: '₺64,20', change: '+%1,76' },
        { code: 'BIMAS', name: 'BİM Birleşik Mağazalar A.Ş.', sector: 'Perakende', price: '₺492,00', change: '-%0,45' },
        { code: 'TUPRS', name: 'Tüpraş Türkiye Petrol Rafinerileri', sector: 'Enerji & Petrol', price: '₺164,80', change: '+%1,15' },
        { code: 'KCHOL', name: 'Koç Holding A.Ş.', sector: 'Holding & Yatırım', price: '₺218,50', change: '+%0,60' },
        { code: 'EREGL', name: 'Ereğli Demir ve Çelik Fabrikaları', sector: 'Demir Çelik', price: '₺48,20', change: '-%1,10' },
        { code: 'SISE', name: 'Türkiye Şişe ve Cam Fabrikaları', sector: 'Cam & Sanayi', price: '₺44,80', change: '+%0,80' }
      ];

  if (!q.startsWith('/')) {
    const searchWord = q.replace('#', '').toUpperCase();
    let matches = searchCandidates.filter(s => {
      const codeMatch = s.code && s.code.includes(searchWord);
      const nameMatch = s.name && s.name.toLowerCase().includes(q);
      const secMatch = s.sector && s.sector.toLowerCase().includes(q);
      return codeMatch || nameMatch || secMatch;
    });

    if (!rawQ) {
      // Input boşsa popüler BIST 30 hisselerini ve hazır komutları göster
      matches = searchCandidates.slice(0, 5);
      actions.push(
        {
          title: '/bilanço [Hisse]',
          desc: 'Resmi KAP konsolide bilanço tablosunu açar (Örn: /bilanço THYAO)',
          icon: 'fa-solid fa-file-invoice-dollar text-red-400',
          badge: 'KOMUT',
          run: () => setCommandPaletteText('/bilanço ')
        },
        {
          title: '/kıyas [H1] [H2]',
          desc: 'İki BIST hissesini 6 eksenli radar grafiğinde kıyaslar (Örn: /kıyas EREGL KRDMD)',
          icon: 'fa-solid fa-code-compare text-purple-400',
          badge: 'KOMUT',
          run: () => setCommandPaletteText('/kıyas ')
        },
        {
          title: '/al [Hisse] [Adet] [Fiyat]',
          desc: 'Portföyünüze alış kaydı ekler (Örn: /al THYAO 100); /sat ile satış',
          icon: 'fa-solid fa-briefcase text-emerald-400',
          badge: 'KOMUT',
          run: () => setCommandPaletteText('/al ')
        },
        {
          title: '/tarayıcı',
          desc: '1048 hisselik çok kriterli kantitatif filtreleme panelini açar',
          icon: 'fa-solid fa-filter text-emerald-400',
          badge: 'KOMUT',
          run: () => {
            switchView('overview');
            setTimeout(() => {
              if (typeof toggleScreenerPanel === 'function') toggleScreenerPanel();
            }, 300);
          }
        }
      );
    }

    if (q.includes('hakk') || q.includes('iletisim') || q.includes('iletişim') || q.includes('about') || q.includes('yardım') || q.includes('yardim')) {
      actions.push({
        title: 'Hakkımızda and İletişim',
        desc: 'ONCAL Platform Misyonu, Analitik Mimarisi and Resmi İletişim: onceandalways.help@gmail.com',
        icon: 'fa-solid fa-circle-info text-blue-400',
        badge: 'SAYFA',
        run: () => switchView('about')
      });
    }

    matches.slice(0, 8).forEach(stock => {
      const fin = getOrGenerateStockFinancials(stock.code);
      actions.push({
        title: `${stock.code} &bull; ${stock.name}`,
        desc: fin.liveTime ? `${stock.sector || fin.sector} &bull; Fiyat: ₺${fin.price} (${fin.change})` : (stock.sector || fin.sector),
        icon: null,
        ticker: stock.code,
        price: fin.liveTime ? `₺${fin.price}` : '—',
        change: fin.change,
        isPositive: fin.isPositive,
        badge: 'HİSSE',
        run: () => {
          switchView('stock-detail');
          loadStockDetails(stock.code);
        }
      });
    });
  }

  commandPaletteCurrentActions = actions;

  if (actions.length === 0) {
    container.innerHTML = `
      <div class="py-8 text-center text-slate-500 font-mono text-xs">
        <i class="fa-solid fa-magnifying-glass text-slate-600 text-lg mb-2 block"></i>
        <span>"${rawQ}" ile eşleşen terminal komutu veya hisse bulunamadı.</span>
        <div class="mt-2 text-[11px] text-slate-400">
          Örnek komutlar: <code class="text-red-400">/bilanço THYAO</code>, <code class="text-purple-400">/kıyas FROTO TOASO</code>, <code class="text-emerald-400">/tarayıcı</code>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = actions.map((act, idx) => {
    const isSelected = idx === commandPaletteSelectedIndex;
    const highlightClasses = isSelected ? 'bg-red-600/25 border-red-500 text-white' : 'bg-transparent text-slate-300';
    const logoHtml = act.ticker && typeof getStockLogoHtml === 'function' ? getStockLogoHtml(act.ticker, 28) : '';

    return `
      <div 
        class="cmd-palette-item p-2.5 rounded-xl border border-transparent transition-all cursor-pointer flex items-center justify-between gap-3 ${highlightClasses}"
        onclick="executeCommandPaletteItem(${idx})"
        onmouseenter="commandPaletteSelectedIndex = ${idx}; updateCommandPaletteItemHighlight();"
      >
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-8 h-8 rounded-lg bg-[#0E1626] border border-[#1E2B45] flex items-center justify-center flex-shrink-0 text-sm overflow-hidden">
            ${logoHtml || `<i class="${act.icon || 'fa-solid fa-terminal text-red-400'}"></i>`}
          </div>
          <div class="min-w-0">
            <div class="font-mono font-bold text-xs truncate leading-snug">${act.title}</div>
            <div class="text-[11px] text-slate-400 font-light truncate">${act.desc}</div>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0 font-mono text-[10px]">
          ${act.price ? `<span class="font-bold text-white text-xs">${act.price}</span>` : ''}
          ${act.badge ? `<span class="px-2 py-0.5 rounded bg-[#162238] border border-slate-700/60 text-slate-300 font-bold">${act.badge}</span>` : ''}
          <i class="fa-solid fa-arrow-turn-down-left text-slate-500 text-xs ml-1"></i>
        </div>
      </div>
    `;
  }).join('');
}

function executeCommandPaletteItem(idx) {
  commandPaletteSelectedIndex = idx;
  executeCommandPaletteSelection();
}
window.executeCommandPaletteItem = executeCommandPaletteItem;

/* ==============================================================================
   11.2. Persistent Watchlist & Price Alerts Engine
   - localStorage Tabanlı Kalıcı İzleme Listesi (Watchlist)
   - Fiyat / RSI Seviyesi İçin Canlı Alarmlar (Price & RSI Alerts)
   - Canlı Eşleşmede Web Audio API Sentetik Çan Sesi & Sağ Üst Toast Bildirimi
   ============================================================================== */

const WATCHLIST_STORAGE_KEY = 'oa_terminal_watchlist';
const ALERTS_STORAGE_KEY = 'oa_terminal_alerts';

function getWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return ['THYAO', 'GARAN', 'FROTO', 'ASELS'];
}

function setWatchlist(list) {
  try {
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(list));
  } catch (e) {}
  window.dispatchEvent(new CustomEvent('verity:data', { detail: 'watchlist' }));   // account sync
  updateWatchlistHeaderBadges();
  renderWatchlistItems();
  updateStockDetailWatchlistStar(appState.currentStock);
}

function toggleStockWatchlist(ticker) {
  if (!ticker) return;
  const t = ticker.toUpperCase().trim();
  const list = getWatchlist();
  const exists = list.includes(t);
  let updated;
  if (exists) {
    updated = list.filter(x => x !== t);
    showTerminalToast('İzleme Listesinden Çıkarıldı', `${t} başarıyla listenizden kaldırıldı.`, t, 'info');
  } else {
    updated = [t, ...list];
    showTerminalToast('İzleme Listesine Eklendi', `${t} hissesi terminal izleme masasına kaydedildi.`, t, 'success');
  }
  setWatchlist(updated);
}
window.toggleStockWatchlist = toggleStockWatchlist;

function toggleCurrentStockWatchlist() {
  toggleStockWatchlist(appState.currentStock);
}
window.toggleCurrentStockWatchlist = toggleCurrentStockWatchlist;

function updateStockDetailWatchlistStar(ticker) {
  const icon = document.getElementById('stockDetailWatchlistStarIcon');
  const text = document.getElementById('stockDetailWatchlistStarText');
  const btn = document.getElementById('stockDetailWatchlistStarBtn');
  if (!icon || !btn) return;

  const t = (ticker || appState.currentStock || 'THYAO').toUpperCase();
  const isWatched = getWatchlist().includes(t);

  if (isWatched) {
    icon.className = 'fa-solid fa-star text-amber-400 text-xs';
    if (text) text.textContent = 'İzleniyor';
    btn.className = 'px-2.5 py-0.5 rounded-lg bg-amber-950/50 hover:bg-amber-950/70 border border-amber-800/60 text-amber-300 transition-colors flex items-center gap-1.5 text-xs cursor-pointer shadow-sm';
  } else {
    icon.className = 'fa-regular fa-star text-slate-400 text-xs';
    if (text) text.textContent = 'İzle';
    btn.className = 'px-2.5 py-0.5 rounded-lg bg-[#0E1626] hover:bg-[#162238] border border-[#1E2B45] text-slate-400 hover:text-amber-400 transition-colors flex items-center gap-1.5 text-xs cursor-pointer';
  }
}
window.updateStockDetailWatchlistStar = updateStockDetailWatchlistStar;

function toggleWatchlistDrawer(forceOpen) {
  const drawer = document.getElementById('watchlistDrawer');
  const backdrop = document.getElementById('watchlistDrawerBackdrop');
  if (!drawer || !backdrop) return;

  const isOpen = !drawer.classList.contains('translate-x-full');
  const shouldOpen = forceOpen !== undefined ? forceOpen : !isOpen;

  if (shouldOpen) {
    drawer.classList.remove('translate-x-full');
    backdrop.classList.remove('hidden');
    renderWatchlistItems();
    renderAlertsItems();
    updateWatchlistHeaderBadges();
  } else {
    drawer.classList.add('translate-x-full');
    backdrop.classList.add('hidden');
  }
}
window.toggleWatchlistDrawer = toggleWatchlistDrawer;

function switchWatchlistDrawerTab(tab) {
  const wPane = document.getElementById('watchlistTabPane');
  const aPane = document.getElementById('alertsTabPane');
  const wBtn = document.getElementById('watchlistTabBtn');
  const aBtn = document.getElementById('alertsTabBtn');
  if (!wPane || !aPane || !wBtn || !aBtn) return;

  if (tab === 'watchlist') {
    wPane.classList.remove('hidden');
    aPane.classList.add('hidden');
    wBtn.className = 'flex-1 py-1.5 px-3 rounded-lg text-xs font-mono font-bold transition-all bg-[#2F6BFF] text-white flex items-center justify-center gap-1.5 shadow-md';
    aBtn.className = 'flex-1 py-1.5 px-3 rounded-lg text-xs font-mono font-bold transition-all text-slate-400 hover:text-white bg-[#090D18] border border-[#1E2B45] flex items-center justify-center gap-1.5';
    renderWatchlistItems();
  } else {
    wPane.classList.add('hidden');
    aPane.classList.remove('hidden');
    aBtn.className = 'flex-1 py-1.5 px-3 rounded-lg text-xs font-mono font-bold transition-all bg-amber-600 text-white flex items-center justify-center gap-1.5 shadow-md';
    wBtn.className = 'flex-1 py-1.5 px-3 rounded-lg text-xs font-mono font-bold transition-all text-slate-400 hover:text-white bg-[#090D18] border border-[#1E2B45] flex items-center justify-center gap-1.5';
    renderAlertsItems();
  }
}
window.switchWatchlistDrawerTab = switchWatchlistDrawerTab;

function updateWatchlistHeaderBadges() {
  const wCount = getWatchlist().length;
  const aCount = getAlerts().filter(a => !a.triggered).length;

  const headerBadge = document.getElementById('watchlistHeaderCountBadge');
  const drawerWCount = document.getElementById('drawerWatchlistCount');
  const drawerACount = document.getElementById('drawerAlertsCount');

  if (headerBadge) headerBadge.textContent = wCount;
  if (drawerWCount) drawerWCount.textContent = wCount;
  if (drawerACount) drawerACount.textContent = aCount;
}

function handleAddWatchlistFromInput() {
  const input = document.getElementById('watchlistAddInput');
  if (!input) return;
  const val = input.value.toUpperCase().trim();
  if (!val) return;
  toggleStockWatchlist(val);
  input.value = '';
}
window.handleAddWatchlistFromInput = handleAddWatchlistFromInput;

function renderWatchlistItems() {
  const container = document.getElementById('watchlistItemsContainer');
  if (!container) return;

  const list = getWatchlist();
  if (list.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-500 font-mono text-xs">
        <i class="fa-regular fa-star text-2xl text-slate-600 mb-2 block"></i>
        <span>İzleme listenizde henüz hisse bulunmuyor.</span>
        <div class="mt-2 text-[11px] text-slate-400">Yukarıdaki kutudan veya hisse detayındaki yıldıza tıklayarak ekleyebilirsiniz.</div>
      </div>
    `;
    return;
  }

  if (window.LiveData) LiveData.syncWatchlist(list);

  container.innerHTML = list.map(ticker => {
    const fin = getOrGenerateStockFinancials(ticker);
    const logoHtml = typeof getStockLogoHtml === 'function' ? getStockLogoHtml(ticker, 32) : '';

    return `
      <div class="p-3 bg-[#0E1626] hover:bg-[#121C30] border border-[#1E2B45] rounded-xl transition-all flex items-center justify-between gap-3 group">
        <div class="flex items-center gap-2.5 min-w-0 cursor-pointer" onclick="switchView('stock-detail'); loadStockDetails('${ticker}'); toggleWatchlistDrawer(false);">
          <div class="w-8 h-8 rounded-lg bg-[#090D18] border border-[#162238] flex items-center justify-center flex-shrink-0 overflow-hidden">
            ${logoHtml || `<span class="font-bold font-mono text-xs text-red-400">${ticker.slice(0, 2)}</span>`}
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="font-mono font-bold text-red-200 bg-red-950/60 px-2 py-0.5 rounded-md border border-red-800/50 tracking-wide text-xs">${ticker}</span>
              <span class="text-[9px] font-mono text-slate-400">${fin.sector ? fin.sector.split('&')[0] : 'BIST'}</span>
            </div>
            <div class="text-[10px] text-slate-300 font-medium inline-block truncate max-w-[140px] mt-0.5" title="${fin.name}">${fin.name}</div>
          </div>
        </div>

        <div class="flex items-center gap-3 flex-shrink-0 font-mono">
          <div class="text-right">
            <div class="text-xs font-bold text-white">₺${fin.price}</div>
            <div class="text-[10px] font-bold ${fin.isPositive ? 'text-emerald-400' : 'text-rose-400'}">${fin.change}</div>
          </div>
          <div class="flex items-center gap-1">
            <button onclick="openSetAlertModal('${ticker}')" class="w-7 h-7 rounded-lg bg-[#090D18] hover:bg-[#162238] border border-[#1E2B45] text-slate-400 hover:text-amber-400 flex items-center justify-center transition-colors text-xs" title="Alarm Kur">
              <i class="fa-solid fa-bell"></i>
            </button>
            <button onclick="toggleStockWatchlist('${ticker}')" class="w-7 h-7 rounded-lg bg-[#090D18] hover:bg-rose-950/60 border border-[#1E2B45] hover:border-rose-800 text-slate-400 hover:text-rose-400 flex items-center justify-center transition-colors text-xs" title="Listeden Çıkar">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function getAlerts() {
  try {
    const raw = localStorage.getItem(ALERTS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

/** Tells other modules (the price chart draws alert lines) that the alert list changed. */
const announceAlerts = () => window.dispatchEvent(new Event('verity:alerts'));

function saveAlert(alertObj) {
  const alerts = getAlerts();
  alerts.unshift(alertObj);
  try {
    localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(alerts));
  } catch (e) {}
  renderAlertsItems();
  updateWatchlistHeaderBadges();
  announceAlerts();
  requestAlertNotifications();
  if (window.LiveData) LiveData.checkAlerts();
}

function deleteAlert(id) {
  let alerts = getAlerts();
  alerts = alerts.filter(a => a.id !== id);
  try {
    localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(alerts));
  } catch (e) {}
  renderAlertsItems();
  updateWatchlistHeaderBadges();
  announceAlerts();
}
window.deleteAlert = deleteAlert;

/* ----- System notifications for triggered alerts (shown when the page is not in front) ----- */

const alertNotificationsSupported = () => 'Notification' in window;

/** Asks for notification permission; browsers only allow this from a click, so call it from one. */
function requestAlertNotifications() {
  if (!alertNotificationsSupported() || Notification.permission !== 'default') return;
  try {
    Promise.resolve(Notification.requestPermission()).then(paintAlertNotifyStatus);
  } catch (e) { /* very old browsers: the toast and sound still work */ }
}
window.requestAlertNotifications = requestAlertNotifications;

function paintAlertNotifyStatus() {
  const el = document.getElementById('alertNotifyStatus');
  if (!el) return;
  const p = alertNotificationsSupported() ? Notification.permission : 'unsupported';
  const view = {
    default: ['Bildirimlere izin ver', 'text-amber-300 hover:text-white underline decoration-dotted cursor-pointer'],
    granted: ['Sistem bildirimleri açık', 'text-emerald-400 cursor-default'],
    denied: ['Bildirimler tarayıcıda engelli', 'text-slate-500 cursor-default'],
    unsupported: ['Tarayıcı bildirim desteklemiyor', 'text-slate-500 cursor-default']
  }[p];
  el.textContent = view[0];
  el.className = `text-[10px] font-mono ${view[1]}`;
  el.title = p === 'denied' ? 'Site ayarlarından bildirim iznini açabilirsiniz.' : 'Alarm tetiklendiğinde sekme arka plandaysa sistem bildirimi gösterilir.';
}

function openStockFromAlert(ticker) {
  if (!ticker) return;
  switchView('stock-detail');
  loadStockDetails(ticker);
}

async function notifyAlert(title, body, ticker) {
  if (!alertNotificationsSupported() || Notification.permission !== 'granted') return;
  const options = { body, tag: `verity-alert-${ticker}`, icon: '/assets/icons/icon-192.svg', data: { ticker } };
  try {
    // Through the service worker where there is one: Android Chrome refuses `new Notification`
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) { await reg.showNotification(title, options); return; }
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); openStockFromAlert(ticker); n.close(); };
  } catch (e) { /* the toast and sound still show */ }
}

// A click on a notification shown by the service worker (sw.js) comes back here
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'open-stock') openStockFromAlert(e.data.ticker);
  });
}

function handleSaveNewAlert() {
  const tickerEl = document.getElementById('alertInputTicker');
  const typeEl = document.getElementById('alertInputType');
  const valEl = document.getElementById('alertInputValue');
  const noteEl = document.getElementById('alertInputNote');

  if (!tickerEl || !typeEl || !valEl) return;
  const ticker = tickerEl.value.toUpperCase().trim();
  const type = typeEl.value;
  const targetVal = parseFloat(valEl.value);
  const note = noteEl ? noteEl.value.trim() : '';

  if (!ticker || !AlertRules.validTarget(type, targetVal)) {
    alert(alertTargetHint(type));
    return;
  }

  saveAlert({
    id: 'alt_' + Date.now(),
    ticker: ticker,
    type: type,
    targetValue: AlertRules.TYPES[type].value ? targetVal : 0,
    note: note || 'Canlı Piyasa Takibi',
    createdAt: new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }) + ' ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    triggered: false,
    triggeredAt: null,
    email: !!document.getElementById('alertInputEmail')?.checked
  });

  tickerEl.value = '';
  valEl.value = '';
  if (noteEl) noteEl.value = '';

  showTerminalToast(`Alarm Kuruldu: ${ticker}`, `${AlertRules.badge({ type, targetValue: targetVal })} alarmı aktif.`, ticker, 'success');
}

/** Why a target was refused, per condition (alerts form and quick modal). */
function alertTargetHint(type) {
  const kind = AlertRules.TYPES[type] && AlertRules.TYPES[type].value;
  if (kind === 'rsi') return 'Lütfen 1 ile 99 arasında bir RSI seviyesi giriniz.';
  if (kind === 'period') return 'Lütfen 2 ile 400 arasında bir SMA periyodu giriniz (ör. 50).';
  return 'Lütfen geçerli bir hisse kodu ve hedef değer giriniz.';
}

/** The target field follows the condition: price, RSI level, SMA period, or not needed. */
function syncAlertValueField(selectId, inputId) {
  const sel = document.getElementById(selectId), input = document.getElementById(inputId);
  if (!sel || !input) return;
  const kind = AlertRules.TYPES[sel.value] && AlertRules.TYPES[sel.value].value;
  input.disabled = !kind;
  input.placeholder = { price: '320.0', rsi: '30', period: '50' }[kind] || 'Gerekmez';
  input.step = kind === 'period' ? '1' : '0.1';
  if (!kind) input.value = '';
  else if (kind === 'period' && !(Number(input.value) >= 2 && Number(input.value) <= 400 && Number.isInteger(Number(input.value)))) input.value = '50';
}
window.syncAlertValueField = syncAlertValueField;
window.handleSaveNewAlert = handleSaveNewAlert;

/** preset: { value, type } from a click on the price chart's alarm tool. */
function openSetAlertModal(ticker, preset) {
  const modal = document.getElementById('setAlertQuickModal');
  const sub = document.getElementById('quickAlertStockSubtitle');
  const valInput = document.getElementById('quickAlertValue');
  const condEl = document.getElementById('quickAlertCondition');
  if (!modal) return;

  const t = (ticker || appState.currentStock || 'THYAO').toUpperCase();
  modal.setAttribute('data-target-ticker', t);
  if (sub) sub.textContent = `${t} için canlı fiyat ve RSI alarmı`;

  const fin = getOrGenerateStockFinancials(t);
  if (preset && preset.value > 0) {
    if (condEl && preset.type) condEl.value = preset.type;
    if (valInput) valInput.value = Number(preset.value).toFixed(2);
  } else if (valInput) {
    if (condEl) condEl.value = 'price_above';
    valInput.value = fin.priceNum > 0 ? (fin.priceNum * 1.04).toFixed(2) : ''; // %4 yukarı hedef hazırla
  }
  syncAlertValueField('quickAlertCondition', 'quickAlertValue');

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}
window.openSetAlertModal = openSetAlertModal;

function closeQuickAlertModal() {
  const modal = document.getElementById('setAlertQuickModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}
window.closeQuickAlertModal = closeQuickAlertModal;

function submitQuickAlert() {
  const modal = document.getElementById('setAlertQuickModal');
  const condEl = document.getElementById('quickAlertCondition');
  const valEl = document.getElementById('quickAlertValue');
  const noteEl = document.getElementById('quickAlertNote');
  if (!modal || !condEl || !valEl) return;

  const ticker = modal.getAttribute('data-target-ticker') || appState.currentStock || 'THYAO';
  const cond = condEl.value;
  const val = parseFloat(valEl.value);
  const note = noteEl ? noteEl.value.trim() : '';

  if (!AlertRules.validTarget(cond, val)) {
    alert(alertTargetHint(cond));
    return;
  }

  saveAlert({
    id: 'alt_' + Date.now(),
    ticker: ticker,
    type: cond,
    targetValue: AlertRules.TYPES[cond].value ? val : 0,
    note: note || 'Hızlı Terminal Alarmı',
    createdAt: new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }) + ' ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    triggered: false,
    triggeredAt: null,
    email: !!document.getElementById('quickAlertEmail')?.checked
  });

  closeQuickAlertModal();
  showTerminalToast(`Alarm Kuruldu: ${ticker}`, `${ticker} için ${AlertRules.badge({ type: cond, targetValue: val })} alarmı ayarlandı.`, ticker, 'success');
}
window.submitQuickAlert = submitQuickAlert;

function renderAlertsItems() {
  paintAlertNotifyStatus();
  const container = document.getElementById('alertsItemsContainer');
  if (!container) return;

  const alerts = getAlerts();
  if (alerts.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-500 font-mono text-xs">
        <i class="fa-solid fa-bell text-2xl text-slate-600 mb-2 block"></i>
        <span>Kayıtlı aktif alarmınız bulunmuyor.</span>
        <div class="mt-2 text-[11px] text-slate-400">Yukarıdaki formdan dilediğiniz hisseye fiyat veya RSI alarmı kurabilirsiniz.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = alerts.map(alt => {
    const fin = getOrGenerateStockFinancials(alt.ticker);
    const curP = fin.priceNum || 0;
    const target = parseFloat(alt.targetValue);
    const kind = AlertRules.TYPES[alt.type] ? AlertRules.TYPES[alt.type].value : 'price';
    const isPrice = kind === 'price';

    let distText = '';
    if (isPrice && curP > 0) {
      const diffPct = ((target - curP) / curP) * 100;
      const sign = diffPct >= 0 ? '+' : '';
      distText = `Mevcut: ₺${curP.toFixed(2)} (${sign}%${Math.abs(diffPct).toFixed(1)})`;
    } else if (kind === 'rsi') {
      distText = `Hedef RSI Seviyesi: ${target}`;
    } else {
      distText = 'Günlük kapanışlarla kontrol edilir';
    }

    const typeBadge = AlertRules.badge(alt);
    const shown = isPrice ? '₺' + target.toFixed(2) : kind === 'rsi' ? target : kind === 'period' ? `SMA ${target}` : '';

    return `
      <div class="p-3 bg-[#0E1626] border ${alt.triggered ? 'border-amber-500/40 bg-amber-950/10' : 'border-[#1E2B45]'} rounded-xl transition-all space-y-2">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="font-mono font-bold text-xs text-white">${alt.ticker}</span>
            ${alt.email ? '<i class="fa-solid fa-envelope text-[10px] text-sky-400" title="Site kapalıyken e-posta ile de bildirilir (hesap gerekli)"></i>' : ''}
            <span class="text-[9px] font-mono px-1.5 py-px rounded ${alt.triggered ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'bg-red-950/40 text-red-300 border border-red-800/40'} font-bold">
              ${alt.triggered ? 'TETİKLENDİ (' + (alt.triggeredAt || 'Bugün') + ')' : typeBadge}
            </span>
          </div>
          <button onclick="deleteAlert('${alt.id}')" class="text-slate-500 hover:text-rose-400 transition-colors text-xs" title="Alarmı Sil">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>

        <div class="flex items-baseline justify-between font-mono text-xs">
          <span class="text-slate-400 text-[11px]">${distText}</span>
          <span class="font-bold ${alt.triggered ? 'text-amber-400' : 'text-white'} text-sm">
            ${shown}
          </span>
        </div>

        ${alt.note ? `<div class="text-[10px] text-slate-400 italic font-sans border-t border-[#162238] pt-1.5 truncate">${alt.note}</div>` : ''}
      </div>
    `;
  }).join('');
}

/**
 * Checks all active alerts of a stock against its current price, RSI and daily closes
 * (conditions in alert-rules.js; closes are needed by the cross alerts).
 */
function checkActivePriceAlerts(ticker, currentPrice, currentRsi, closes) {
  if (!ticker || (!currentPrice && !currentRsi && !closes)) return;
  const t = ticker.toUpperCase();
  const alerts = getAlerts();
  let updated = false;

  alerts.forEach(alt => {
    if (alt.triggered || alt.ticker !== t) return;

    const result = AlertRules.evaluate(alt, { price: currentPrice, rsi: currentRsi, closes });
    const hit = !!result;
    const hitText = result ? result.text : '';

    if (hit) {
      alt.triggered = true;
      alt.triggeredAt = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      updated = true;

      // Web Audio API terminal double-chime
      playTerminalAlertSound();

      // Show Toast Notification
      showTerminalToast(`FİYAT ALARMI: ${t}`, `${hitText} &bull; ${alt.note || 'Canlı BIST Seansı'}`, t, 'alert');
      // and a system notification when nobody is looking at the page
      if (document.hidden || !document.hasFocus()) notifyAlert(`ONCAL alarmı: ${t}`, `${hitText}${alt.note ? ` · ${alt.note}` : ''}`, t);
    }
  });

  if (updated) {
    try {
      localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(alerts));
    } catch (e) {}
    renderAlertsItems();
    updateWatchlistHeaderBadges();
    announceAlerts();
  }
}
window.checkActivePriceAlerts = checkActivePriceAlerts;

/**
 * Synthesizes a high-end Bloomberg / TradingView terminal alert chime using Web Audio API.
 */
function playTerminalAlertSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // First Tone: 880 Hz (A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Second Tone: 1320 Hz (E6 Harmonic)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, now + 0.12);
    gain2.gain.setValueAtTime(0.15, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.45);
  } catch (e) {
    // AudioContext blocked or unsupported
  }
}

/**
 * Renders a persistent, animated Toast Notification at the top right of the terminal.
 */
function showTerminalToast(title, message, ticker, type = 'info') {
  const container = document.getElementById('terminalToastContainer');
  if (!container) return;

  const id = 'toast_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const toast = document.createElement('div');

  let borderColor = 'border-red-500/60';
  let iconClass = 'fa-solid fa-circle-info text-red-400';
  let glowColor = 'shadow-red-950/60';

  if (type === 'alert') {
    borderColor = 'border-amber-500/80 ring-1 ring-amber-500/40';
    iconClass = 'fa-solid fa-bell text-amber-400 animate-bounce';
    glowColor = 'shadow-amber-950/90';
  } else if (type === 'success') {
    borderColor = 'border-emerald-500/60';
    iconClass = 'fa-solid fa-circle-check text-emerald-400';
    glowColor = 'shadow-emerald-950/60';
  }

  const logoHtml = (ticker && typeof getStockLogoHtml === 'function') ? getStockLogoHtml(ticker, 28) : '';

  toast.id = id;
  toast.className = `pointer-events-auto bg-[#0E1626] border ${borderColor} rounded-2xl p-4 shadow-2xl ${glowColor} flex items-start gap-3 transform transition-all duration-300 opacity-0 translate-y-2`;

  toast.innerHTML = `
    <div class="flex-shrink-0 pt-0.5">
      ${logoHtml || `<i class="${iconClass} text-lg"></i>`}
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center justify-between gap-2">
        <h4 class="text-xs font-mono font-bold text-white tracking-tight leading-snug">${title}</h4>
        <span class="text-[9px] font-mono text-slate-500">ŞİMDİ</span>
      </div>
      <p class="text-[11px] text-slate-300 mt-1 leading-snug font-light">${message}</p>
      ${ticker ? `
        <div class="mt-2.5 flex items-center gap-2">
          <button onclick="switchView('stock-detail'); loadStockDetails('${ticker}'); dismissTerminalToast('${id}');" class="px-2.5 py-1 rounded-lg bg-[#2F6BFF] hover:bg-red-700 text-white font-mono text-[10px] font-bold transition-colors">
            Hisseye Git &rarr;
          </button>
        </div>
      ` : ''}
    </div>
    <button onclick="dismissTerminalToast('${id}')" class="text-slate-400 hover:text-white p-1 text-xs flex-shrink-0">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('opacity-0', 'translate-y-2');
  }, 20);

  setTimeout(() => {
    dismissTerminalToast(id);
  }, 6500);
}
window.showTerminalToast = showTerminalToast;

function dismissTerminalToast(id) {
  const toast = document.getElementById(id);
  if (!toast) return;
  toast.classList.add('opacity-0', '-translate-y-2');
  setTimeout(() => {
    if (toast.parentElement) toast.parentElement.removeChild(toast);
  }, 300);
}
window.dismissTerminalToast = dismissTerminalToast;

function initWatchlistAndAlerts() {
  updateWatchlistHeaderBadges();
  renderWatchlistItems();
  renderAlertsItems();
}

// Window Global Exports for Terminal Modules
window.switchStockSubTab = switchStockSubTab;
window.resizeStockDetailCharts = resizeStockDetailCharts;
window.initTerminalCommandPalette = initTerminalCommandPalette;
window.initWatchlistAndAlerts = initWatchlistAndAlerts;
window.copySupportEmail = copySupportEmail;

/* ==============================================================================
   12. DOM Content Loaded Bootstrap (Executes after all classes & datasets are ready)
   ============================================================================== */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initApp();
  });
} else {
  initApp();
}


