/**
 * ONCE & ALWAYS - INTRO SPLASH ENGINE JAVASCRIPT BACKUP ARCHIVE
 * Saved: 2026-10-20
 * Contains complete candlestick rendering, Fibonacci grid calculation,
 * progress bar stepper, Web Audio boot chime, and animation loop logic.
 */

let introSplashTimeout = null;
let introProgressInterval = null;
let introCanvasAnimationId = null;
let introFailsafeTimeout = null;
let introWavePhase = 0;
let _cachedIntroW = 780;
let _cachedIntroH = 280;
let _lastZoneKey = '';

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

    const padTop = 15;
    const padBottom = 15;
    const usableH = height - padTop - padBottom;
    const getY = (val) => padTop + usableH * (1 - val / 100);

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

    ctx.fillStyle = 'rgba(251, 191, 36, 0.08)';
    ctx.fillRect(0, y618, width, y500 - y618);

    ctx.fillStyle = 'rgba(52, 211, 153, 0.06)';
    ctx.fillRect(0, y382, width, y236 - y382);

    fibLevels.forEach(fib => {
      const y = getY(fib.pct);
      ctx.beginPath();
      ctx.setLineDash(fib.dash);
      ctx.strokeStyle = fib.color;
      ctx.lineWidth = fib.width;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.font = fib.isGolden ? 'bold 8.5px monospace' : '8px monospace';
      ctx.fillStyle = fib.color;
      ctx.fillText(fib.label, 8, y - 3);

      ctx.font = 'bold 8.5px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`%${fib.pct.toFixed(1)}`, width - 8, y - 3);
      ctx.textAlign = 'left';
    });

    ctx.setLineDash([]);
    const points = [];
    const numCandles = Math.min(Math.max(Math.floor(width / 22), 24), 38);
    const stepX = width / numCandles;
    const candleWidth = Math.max(stepX * 0.62, 4);

    introWavePhase += 0.032;

    const candles = [];
    for (let i = 0; i < numCandles; i++) {
      const x = (i + 0.5) * stepX;
      const angle = (i / numCandles) * 3.6 * Math.PI;

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

      const openVal = Math.min(Math.max(trendValue - delta * 0.4 + Math.sin(i * 4.3 + introWavePhase) * 1.6, 8), 94);
      const closeVal = Math.min(Math.max(trendValue + delta * 0.6 + Math.cos(i * 3.7 + introWavePhase) * 1.6, 8), 94);
      const isBullish = closeVal >= openVal;

      const bodyMax = Math.max(openVal, closeVal);
      const bodyMin = Math.min(openVal, closeVal);

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

    candles.forEach(c => {
      const candleColor = c.isBullish ? '#10B981' : '#F43F5E';
      const candleFill = c.isBullish ? 'rgba(16, 185, 129, 0.90)' : 'rgba(244, 63, 94, 0.90)';

      ctx.beginPath();
      ctx.moveTo(c.x, c.yHigh);
      ctx.lineTo(c.x, c.yLow);
      ctx.strokeStyle = candleColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.fillStyle = candleFill;
      ctx.fillRect(c.x - candleWidth / 2, c.bodyY, candleWidth, c.bodyH);

      ctx.strokeStyle = candleColor;
      ctx.lineWidth = 1.0;
      ctx.strokeRect(c.x - candleWidth / 2, c.bodyY, candleWidth, c.bodyH);
    });

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
    osc.frequency.setValueAtTime(659.25, now);
    osc.frequency.exponentialRampToValueAtTime(880.00, now + 0.09);
    osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.18);
    gain.gain.setValueAtTime(0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.50);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.51);
  } catch (e) {}
}

function updateIntroStepDots(activeDotIndex) {
  const dots = document.querySelectorAll('#introStepDots .intro-dot');
  dots.forEach((dot, idx) => {
    if (idx < activeDotIndex) {
      dot.className = 'intro-dot w-2 h-2 rounded-full bg-emerald-400 transition-all duration-300 shadow-[0_0_8px_rgba(52,211,153,0.8)]';
    } else if (idx === activeDotIndex) {
      dot.className = 'intro-dot w-2 h-2 rounded-full bg-[#E3120B] scale-125 transition-all duration-300 shadow-[0_0_10px_rgba(227,18,11,1)]';
    } else {
      dot.className = 'intro-dot w-2 h-2 rounded-full bg-slate-800 transition-all duration-300';
    }
  });
}

function playIntroSplash() {
  const splash = document.getElementById('introSplashScreen');
  const bar = document.getElementById('introProgressBar');
  const status = document.getElementById('introProgressStatus');
  const percent = document.getElementById('introProgressPercent');
  if (!splash) return;

  splash.classList.remove('splash-exit');
  splash.style.display = 'flex';
  splash.style.opacity = '1';
  splash.style.pointerEvents = 'auto';

  if (bar) bar.style.width = '12%';
  if (percent) percent.textContent = '12%';
  if (status) status.textContent = 'BIST 1048 Şirket Veri Tabanı & Kotasyonlar Yükleniyor...';
  updateIntroStepDots(0);
  startIntroRsiAnimation();

  clearTimeout(introFailsafeTimeout);
  introFailsafeTimeout = setTimeout(() => {
    dismissIntroSplash();
  }, 2100);

  const steps = [
    { p: 25, s: 'BIST 1048 Şirket Veri Tabanı & Kotasyonlar Yükleniyor...', dot: 0 },
    { p: 48, s: '10 Kademe Canlı L2 Emir Defteri & AKD Dağılımı Bağlanıyor...', dot: 1 },
    { p: 70, s: 'TMS 29 Enflasyon Muhasebesi & 5x5 İNA Duyarlılık Matrisi Hazırlanıyor...', dot: 2 },
    { p: 88, s: 'Kantitatif Risk Masası: Parametrik VaR (%99) & Korelasyon Matrisi...', dot: 3 },
    { p: 97, s: 'TradingView İndikatörleri & Canlı Mikro-Tick Motoru Başlatılıyor...', dot: 4 },
    { p: 100, s: '“It does not matter the color of the cat, what matter is to catch the rat”', dot: 5 }
  ];

  let currentStep = 0;
  clearInterval(introProgressInterval);
  clearTimeout(introSplashTimeout);

  introProgressInterval = setInterval(() => {
    if (currentStep < steps.length) {
      const step = steps[currentStep];
      if (bar) bar.style.width = `${step.p}%`;
      if (percent) percent.textContent = `${step.p}%`;
      if (status) status.textContent = step.s;
      updateIntroStepDots(step.dot);
      if (step.p === 100) {
        try { playTerminalBootChime(); } catch(e) {}
      }
      currentStep++;
    } else {
      clearInterval(introProgressInterval);
      introSplashTimeout = setTimeout(() => {
        dismissIntroSplash();
      }, 350);
    }
  }, 160);
}

function dismissIntroSplash() {
  clearInterval(introProgressInterval);
  clearTimeout(introSplashTimeout);
  clearTimeout(introFailsafeTimeout);
  stopIntroRsiAnimation();
  const splash = document.getElementById('introSplashScreen');
  if (!splash) return;
  splash.classList.add('splash-exit');
  splash.style.opacity = '0';
  splash.style.pointerEvents = 'none';
  setTimeout(() => {
    splash.style.display = 'none';
    splash.classList.remove('splash-exit');
  }, 450);
}

