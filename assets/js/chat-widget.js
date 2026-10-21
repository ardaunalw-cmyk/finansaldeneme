/* ==========================================================================
   Onc&Al Asistan - floating chat widget (bottom-right)

   LLM hook: set window.OA_CHAT_CONFIG.endpoint to a URL that accepts
     POST { messages: [{ role: 'user'|'assistant', content }], context: { view, stock } }
   and returns JSON { reply: "..." }. Keep API keys on the server side
   (e.g. a Vercel serverless function at /api/chat), never in this file.
   Until an endpoint is configured the widget answers with a placeholder.
   ========================================================================== */
(function () {
  const config = Object.assign({
    endpoint: null,
    title: 'Onc&Al Asistan',
    avatar: 'assets/images/chat-assistant-96.jpg',
    avatarLarge: 'assets/images/chat-assistant-256.jpg',
    greeting: 'Merhaba! Ben Onc&Al Asistan. BIST hisseleri, bilançolar ve rasyolar hakkında soru sorabilirsin.',
    suggestions: ['THYAO bilançosunu özetle', 'F/K oranı nedir?', 'BIST 100 bugün nasıl?']
  }, window.OA_CHAT_CONFIG || {});
  window.OA_CHAT_CONFIG = config;

  const STORAGE_KEY = 'oa-chat-history';
  let history = [];
  try { history = JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || []; } catch (e) { history = []; }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function saveHistory() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-40))); } catch (e) { /* storage unavailable */ }
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

    function addBubble(role, text) {
      const row = document.createElement('div');
      row.className = `oa-chat-row oa-chat-${role}`;
      row.innerHTML = role === 'assistant'
        ? `<img src="${config.avatar}" alt="" class="oa-chat-bubble-avatar" width="28" height="28"><div class="oa-chat-bubble">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`
        : `<div class="oa-chat-bubble">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.reply || '';
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
      try {
        reply = await askLlm();
      } catch (err) {
        reply = 'Şu anda yanıt veremiyorum, lütfen biraz sonra tekrar dene.';
        console.warn('[OA Chat]', err);
      }
      typing.remove();
      history.push({ role: 'assistant', content: reply });
      addBubble('assistant', reply);
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
