/* ==========================================================================
   Verity Asistan - floating chat widget (bottom-right)

   Talks to the /api/chat serverless function (api/chat.mjs), which calls
   Claude with the API key from a server-side environment variable:
     POST { messages: [{ role: 'user'|'assistant', content }], context: { view, stock } }
     -> JSON { reply: "..." }
   Never put an API key in this file: everything here is public.
   ========================================================================== */
(function () {
  const config = Object.assign({
    endpoint: '/api/chat',
    title: 'Verity Asistan',
    avatar: 'assets/images/chat-assistant-96.jpg',
    avatarLarge: 'assets/images/chat-assistant-256.jpg',
    greeting: 'Merhaba! Ben Verity Asistan. Bir hisse kodu veya şirket adı yazarsan (örn. THYAO, Aselsan) kısa bir özet çıkarırım; rasyoları ve BIST 100’ü de açıklayabilirim.',
    suggestions: ['THYAO hakkında bilgi ver', 'ASELS ne iş yapar?', 'F/K oranı nedir?', 'BIST 100 bugün nasıl?']
  }, window.OA_CHAT_CONFIG || {});
  window.OA_CHAT_CONFIG = config;

  const STORAGE_KEY = 'oa-chat-history';
  let history = [];
  try { history = JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || []; } catch (e) { history = []; }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function saveHistory() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-40))); } catch (e) { /* storage unavailable */ }
  }


  /* ------------------------------------------------------------------------
     Local answers: a stock summary built from the site's own real data (company profile,
     delayed quote, ratios from the latest statements, technical read), plus a few glossary
     terms and the BIST 100. No language model is needed for these.
     ------------------------------------------------------------------------ */
  const STOP = new Set(['hisse', 'hissesi', 'hisseyi', 'hakkinda', 'bilgi', 'bilanco', 'bilancosu', 'ozetle', 'ozet', 'nedir', 'nasil', 'bugun', 'sirket', 'sirketi', 'borsa', 'analiz', 'yorum', 'verir', 'misin', 'musun', 'iyi', 'mi', 'ne', 'is', 'yapar', 'durumu', 'fiyat', 'fiyati', 'kac', 'bana', 'soyle', 'anlat', 'bir', 'icin', 'ile', 've', 'ama', 'gibi', 'olan', 'her', 'tum', 'hangi', 'nelerdir', 'nedir', 'sektor', 'sektoru']);
  const COMMON = new Set(['hava', 'turk', 'turkiye', 'turkish', 'anadolu', 'enerji', 'sanayi', 'ticaret', 'holding', 'yatirim', 'gida', 'insaat', 'tekstil', 'demir', 'celik', 'cimento', 'sigorta', 'banka', 'bankasi', 'finans', 'teknoloji', 'ulusal', 'genel', 'yeni', 'dunya', 'altin', 'gumus', 'petrol', 'otomotiv', 'ilac', 'saglik', 'turizm', 'tarim', 'orman', 'kagit', 'cam', 'maden', 'ortaklik', 'ortakligi', 'gayrimenkul', 'faktoring', 'varlik', 'yonetim']);
  const norm = (t) => (typeof normalizeSearchText === 'function' ? normalizeSearchText(t) : String(t).toLowerCase());
  let codeIndex = null;

  function stockIndex() {
    if (codeIndex) return codeIndex;
    codeIndex = new Map();
    const list = typeof getFullBistStockList === 'function' ? getFullBistStockList() : [];
    list.forEach((st) => {
      const codes = String((st.raw && st.raw.c) || st.code).split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
      codes.forEach((c) => { if (!codeIndex.has(c)) codeIndex.set(c, st); });
    });
    return codeIndex;
  }

  function findStock(text) {
    const list = typeof getFullBistStockList === 'function' ? getFullBistStockList() : [];
    if (!list.length) return null;
    const idx = stockIndex();
    const tokens = text.split(/[^A-Za-zÇĞİÖŞÜçğıöşü0-9]+/).filter(Boolean);

    // 1) ticker: upper-case in the text, or any case when it is 4+ letters
    for (const tok of tokens) {
      const up = tok.toLocaleUpperCase('tr-TR').replace(/İ/g, 'I');
      const plain = up.replace(/[^A-Z0-9]/g, '');
      if (!plain || plain.length < 3 || plain.length > 6) continue;
      const isUpper = tok === tok.toLocaleUpperCase('tr-TR');
      if (!(isUpper || plain.length >= 4)) continue;
      if (STOP.has(norm(tok))) continue;
      if (idx.has(plain)) return idx.get(plain);
    }

    // 2) company name: a distinctive word of the name that the user typed
    const words = norm(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));
    let best = null;
    let bestScore = 0;
    for (const st of list) {
      const nameWords = norm(st.name || '').split(/[^a-z0-9]+/).filter(Boolean);
      // a typed word must start a word of the company name (so "aselsan" matches ASELSAN ELEKTRONIK)
      const hits = words.filter((w) => nameWords.some((nw) => nw.startsWith(w) || (w.length >= 6 && w.startsWith(nw) && nw.length >= 5)));
      if (!hits.length) continue;
      // a single everyday word ("hava", "enerji", "turkiye") is not enough to name a company
      if (hits.length === 1 && COMMON.has(hits[0])) continue;
      const firstWord = hits.some((w) => nameWords[0] && nameWords[0].startsWith(w));
      // more matched words win, then large well-known companies, then names that start with the word
      const score = hits.length * 1e15 + (st.isBist30 ? 1e14 : 0) + (firstWord ? 1e13 : 0) + (st.capRaw || 0) / 1e3;
      if (score > bestScore) { best = st; bestScore = score; }
    }
    return best;
  }

  const money = (v) => {
    const a = Math.abs(v);
    const s = v < 0 ? '-' : '';
    if (a >= 1e9) return s + '₺' + (a / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' Mlr';
    if (a >= 1e6) return s + '₺' + Math.round(a / 1e6).toLocaleString('tr-TR') + ' Mn';
    return s + '₺' + Math.round(a).toLocaleString('tr-TR');
  };
  const num = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }) : 'N/A');
  const pctTxt = (v) => (v >= 0 ? '+' : '-') + '%' + num(Math.abs(v));

  async function getQuote(key) {
    const tick = typeof tradingCode === 'function' ? tradingCode(key) : key;
    const res = await fetch('/api/quote?symbols=' + encodeURIComponent(tick));
    if (!res.ok) throw new Error('quote ' + res.status);
    return ((await res.json()).quotes || {})[tick] || null;
  }

  async function stockSummary(st) {
    const code = st.code;
    const about = typeof getStockAbout === 'function' ? getStockAbout(code) : null;
    const [qRes, scRes] = await Promise.allSettled([
      getQuote(code),
      window.TechData ? TechData.scorecard(code) : Promise.reject(new Error('no technicals'))
    ]);
    const q = qRes.status === 'fulfilled' ? qRes.value : null;
    const sc = scRes.status === 'fulfilled' ? scRes.value : null;
    let ratios = null;
    if (q && window.LiveData) {
      try { ratios = await LiveData.ratiosFor(code, q.price); } catch (e) { /* ratios optional */ }
    }

    const parts = [];
    const name = (about && about.name) || st.name;
    // 1) what the company does: the first two sentences of its profile
    if (about && about.text) {
      const sentences = about.text.match(/[^.!?]+[.!?]+/g) || [about.text];
      parts.push(name + ' (' + code + '): ' + sentences.slice(0, 2).join(' ').trim());
    } else {
      parts.push(name + ' (' + code + ')');
    }
    // 2) price
    if (q) {
      const chg = q.prevClose ? (q.price - q.prevClose) / q.prevClose * 100 : null;
      parts.push('Son fiyat ₺' + num(q.price) + (chg != null ? ' (günlük ' + pctTxt(chg) + ', gecikmeli veri)' : '') + '.');
    }
    // 3) fundamentals
    if (ratios) {
      const bits = ['F/K ' + num(ratios.fk), 'PD/DD ' + num(ratios.pddd), 'ROE %' + num(ratios.roe, 1)];
      parts.push('Son 12 aylık bilançoya (' + ratios.period + ') göre ' + bits.join(', ') + '; net kâr ' + money(ratios.netIncome) + ', ciro/faaliyet geliri ' + money(ratios.revenue) + '.');
    } else if (q) {
      parts.push('Bu şirketin bilançosu veri kaynağımızda bulunmadığı için rasyo hesaplayamıyorum.');
    }
    // 4) technical read
    if (sc) {
      const sma200 = sc.rows.find((r) => /SMA 200/.test(r.name));
      const side = sma200 && sma200.sig.label === 'AL' ? 'üzerinde' : sma200 && sma200.sig.label === 'SAT' ? 'altında' : null;
      parts.push('Teknik göstergeler: ' + sc.buy + ' alım, ' + sc.sell + ' satım, ' + sc.neutral + ' nötr sinyal (genel okuma: ' + sc.verdict.label + '); RSI ' + num(sc.rsi, 1) + (side ? ', fiyat 200 günlük ortalamanın ' + side : '') + '.');
    }
    parts.push('Bu bilgi genel özet niteliğindedir, yatırım tavsiyesi değildir.');
    return { text: parts.join('\n\n'), actions: [{ label: code + ' sayfasını aç', code }] };
  }

  const GLOSSARY = [
    [/f\s*\/\s*k|fiyat\s*kazanc/, 'F/K (Fiyat/Kazanç): Bir hissenin piyasa değerinin şirketin yıllık net kârına oranıdır. Düşük F/K hissenin kâra göre ucuz, yüksek F/K pahalı olabileceğini düşündürür; ancak sektöre ve büyümeye göre değerlendirilmelidir.'],
    [/pd\s*\/\s*dd|piyasa\s*degeri\s*\/?\s*defter/, 'PD/DD (Piyasa Değeri/Defter Değeri): Şirketin piyasa değerinin özkaynaklarına oranıdır. 1’in altı, hissenin defter değerinin altında işlem gördüğünü gösterir.'],
    [/fd\s*\/\s*favok|favok|ebitda/, 'FAVÖK, faiz, amortisman ve vergi öncesi kârdır (EBITDA). FD/FAVÖK ise şirketin firma değerinin (piyasa değeri + net borç) FAVÖK’e oranıdır; borcu da hesaba kattığı için farklı sermaye yapılarını karşılaştırmada kullanılır.'],
    [/\broe\b|ozkaynak\s*karlilig/, 'ROE (Özkaynak Kârlılığı): Net kârın özkaynaklara oranıdır; şirketin ortakların sermayesinden ne kadar kâr ürettiğini gösterir.'],
    [/\broa\b|aktif\s*karlilig/, 'ROA (Aktif Kârlılığı): Net kârın toplam varlıklara oranıdır; şirketin varlıklarını ne kadar verimli kullandığını gösterir.'],
    [/\brsi\b/, 'RSI (Göreceli Güç Endeksi) 0–100 arasında bir momentum göstergesidir. Genelde 70 üstü aşırı alım, 30 altı aşırı satım bölgesi olarak yorumlanır.'],
    [/macd/, 'MACD, iki hareketli ortalama (12 ve 26 gün) arasındaki farka dayanan bir trend/momentum göstergesidir. MACD çizgisi sinyal çizgisini yukarı keserse momentum artışı, aşağı keserse zayıflama olarak okunur.'],
    [/bollinger/, 'Bollinger Bantları, 20 günlük ortalamanın iki standart sapma üstünde ve altında çizilen bantlardır. Fiyatın bantların dışına taşması aşırı hareketi, bantların daralması düşük oynaklığı gösterir.'],
    [/sma|hareketli\s*ortalama/, 'SMA (Basit Hareketli Ortalama), belirli sayıda günün kapanış ortalamasıdır. Fiyatın 20/50/200 günlük ortalamaların üstünde olması genelde güçlü trend olarak yorumlanır.'],
    [/temettu|kar\s*payi/, 'Temettü (kâr payı), şirketin kârının ortaklara dağıttığı kısmıdır. Temettü verimi, hisse başına temettünün hisse fiyatına oranıdır.'],
    [/bedelsiz/, 'Bedelsiz sermaye artırımı, şirketin iç kaynaklarından (yedekler, birikmiş kâr) sermayesini artırıp mevcut ortaklara ek pay vermesidir; ortakların toplam değeri değişmez, pay sayısı artar.'],
    [/altman/, 'Altman Z-skoru, bir şirketin iflas riskini bilanço oranlarıyla ölçmeye çalışan bir modeldir. Not: sitedeki Altman ve Piotroski skorları şu an örnek veridir.'],
    [/piotroski/, 'Piotroski F-skoru, şirketin finansal gücünü 9 muhasebe kriteriyle puanlayan bir yöntemdir. Not: sitedeki bu skor şu an örnek veridir.']
  ];

  async function indexAnswer() {
    const q = await getQuote('BIST100');
    if (!q) throw new Error('no index quote');
    const chg = q.prevClose ? (q.price - q.prevClose) / q.prevClose * 100 : null;
    let txt = 'BIST 100 endeksi ' + num(q.price) + ' puanda' + (chg != null ? ' (günlük ' + pctTxt(chg) + ')' : '') + '.';
    if (q.dayLow != null && q.dayHigh != null) txt += ' Gün içi aralık ' + num(q.dayLow) + ' – ' + num(q.dayHigh) + '.';
    return { text: txt + '\n\nVeri Yahoo Finance’ten gecikmelidir; yatırım tavsiyesi değildir.', actions: [] };
  }

  async function localAnswer(text) {
    const n = norm(text);
    const st = findStock(text);
    if (st) return stockSummary(st);
    if (/\bbist\s*100\b|bist100|endeks|borsa\s+(bugun|nasil)/.test(n)) return indexAnswer();
    for (const [re, answer] of GLOSSARY) if (re.test(n)) return { text: answer, actions: [] };
    if (/^(merhaba|selam|hey|iyi gunler|gunaydin)/.test(n)) {
      return { text: 'Merhaba! Bir hisse kodu veya şirket adı yazarsan (örn. THYAO, Aselsan) kısa bir özet çıkarırım.', actions: [] };
    }
    return null;
  }

  function build() {
    const root = document.createElement('div');
    root.id = 'oaChatWidget';
    root.innerHTML = `
      <section class="oa-chat-panel" role="dialog" aria-label="${escapeHtml(config.title)}" aria-hidden="true">
        <header class="oa-chat-header">
          <img src="${config.avatar}" alt="" class="oa-chat-header-avatar" width="40" height="40">
          <div class="oa-chat-header-text">
            <strong>${escapeHtml(config.title)}</strong>
            <span class="oa-chat-status"><span class="oa-chat-status-dot"></span><span class="oa-chat-status-label"></span></span>
          </div>
          <button type="button" class="oa-chat-icon-btn" data-chat-clear title="Sohbeti temizle" aria-label="Sohbeti temizle"><i class="fa-solid fa-rotate-left"></i></button>
          <button type="button" class="oa-chat-icon-btn" data-chat-close title="Kapat" aria-label="Kapat"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <div class="oa-chat-messages" aria-live="polite"></div>
        <div class="oa-chat-suggestions"></div>
        <form class="oa-chat-form">
          <textarea class="oa-chat-input" rows="1" placeholder="Bir soru yaz..." aria-label="Mesaj"></textarea>
          <button type="submit" class="oa-chat-send" aria-label="Gönder"><i class="fa-solid fa-paper-plane"></i></button>
        </form>
        <p class="oa-chat-disclaimer">Yatırım tavsiyesi değildir.</p>
      </section>
      <button type="button" class="oa-chat-launcher" aria-label="${escapeHtml(config.title)} sohbetini aç" aria-expanded="false">
        <img src="${config.avatarLarge}" alt="" width="64" height="64">
        <span class="oa-chat-launcher-ping"></span>
      </button>
    `;
    document.body.appendChild(root);
    return root;
  }

  function init() {
    const root = build();
    const panel = root.querySelector('.oa-chat-panel');
    const launcher = root.querySelector('.oa-chat-launcher');
    const list = root.querySelector('.oa-chat-messages');
    const suggestions = root.querySelector('.oa-chat-suggestions');
    const form = root.querySelector('.oa-chat-form');
    const input = root.querySelector('.oa-chat-input');
    const statusLabel = root.querySelector('.oa-chat-status-label');
    let busy = false;

    statusLabel.textContent = config.endpoint ? 'Çevrimiçi' : 'LLM bağlantısı bekleniyor';
    root.classList.toggle('oa-chat-offline', !config.endpoint);

    function addBubble(role, text, actions) {
      const row = document.createElement('div');
      row.className = `oa-chat-row oa-chat-${role}`;
      row.innerHTML = role === 'assistant'
        ? `<img src="${config.avatar}" alt="" class="oa-chat-bubble-avatar" width="28" height="28"><div class="oa-chat-bubble">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`
        : `<div class="oa-chat-bubble">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
      if (actions && actions.length) {
        const bar = document.createElement('div');
        bar.className = 'oa-chat-actions';
        actions.forEach((a) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'oa-chat-action';
          b.textContent = a.label;
          b.addEventListener('click', () => { if (typeof switchView === 'function') switchView('stock-detail', a.code); setOpen(false); });
          bar.appendChild(b);
        });
        const bubble = row.querySelector('.oa-chat-bubble');
        if (bubble) bubble.appendChild(bar);
      }
      list.appendChild(row);
      list.scrollTop = list.scrollHeight;
      return row;
    }

    function renderAll() {
      list.innerHTML = '';
      addBubble('assistant', config.greeting);
      history.forEach((m) => addBubble(m.role, m.content));
      suggestions.innerHTML = history.length ? '' : config.suggestions
        .map((s) => `<button type="button" class="oa-chat-chip">${escapeHtml(s)}</button>`).join('');
    }

    function setOpen(open) {
      root.classList.toggle('oa-chat-open', open);
      panel.setAttribute('aria-hidden', String(!open));
      launcher.setAttribute('aria-expanded', String(open));
      if (open) setTimeout(() => input.focus(), 150);
    }

    async function askLlm() {
      if (!config.endpoint) {
        return 'Asistan henüz bir dil modeline bağlanmadı. Bağlantı kurulduğunda sorularını burada yanıtlayacağım.';
      }
      // appState is a top-level const in app.js: a global binding, not a window property
      const state = typeof appState !== 'undefined' ? appState : {};
      const res = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          context: { view: state.activeView || null, stock: state.currentStock || null }
        })
      });
      const data = await res.json().catch(() => ({}));
      // The server sends a user-facing `reply` even for errors (busy, not configured)
      if (data.reply) return data.reply;
      throw new Error(`HTTP ${res.status}`);
    }

    async function send(text) {
      text = text.trim();
      if (!text || busy) return;
      busy = true;
      suggestions.innerHTML = '';
      history.push({ role: 'user', content: text });
      addBubble('user', text);
      input.value = '';
      input.style.height = '';

      const typing = addBubble('assistant', '');
      typing.classList.add('oa-chat-typing');
      typing.querySelector('.oa-chat-bubble').innerHTML = '<span></span><span></span><span></span>';

      let reply;
      let actions = [];
      try {
        const local = await localAnswer(text);
        if (local) {
          reply = local.text;
          actions = local.actions || [];
        } else {
          reply = await askLlm();
          // The language model is optional; when it is not configured, say what the assistant can do
          if (/yapılandırılmadı|kullanılamıyor/i.test(reply)) {
            reply = 'Bu soruya şu an yanıt veremiyorum. Bir hisse kodu veya şirket adı (örn. THYAO, Aselsan) yazarsan özetini çıkarabilirim; F/K, PD/DD, ROE, RSI gibi terimleri ve BIST 100’ü de açıklayabilirim.';
          }
        }
      } catch (err) {
        reply = 'Şu anda yanıt veremiyorum. Bir hisse kodu veya şirket adı yazarak tekrar deneyebilirsin.';
        console.warn('[Verity Chat]', err);
      }
      typing.remove();
      history.push({ role: 'assistant', content: reply });
      addBubble('assistant', reply, actions);
      saveHistory();
      busy = false;
    }

    launcher.addEventListener('click', () => setOpen(!root.classList.contains('oa-chat-open')));
    root.querySelector('[data-chat-close]').addEventListener('click', () => setOpen(false));
    root.querySelector('[data-chat-clear]').addEventListener('click', () => {
      history = [];
      saveHistory();
      renderAll();
    });
    suggestions.addEventListener('click', (e) => {
      const chip = e.target.closest('.oa-chat-chip');
      if (chip) send(chip.textContent);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      send(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send(input.value);
      }
    });
    input.addEventListener('input', () => {
      input.style.height = '';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root.classList.contains('oa-chat-open')) setOpen(false);
    });

    renderAll();
    window.OAChat = { open: () => setOpen(true), close: () => setOpen(false), send };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
