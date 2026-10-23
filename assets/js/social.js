/**
 * Social media bulletin: a formal, written summary of recent public posts about BIST (Telegram
 * channel previews, r/Borsa, Mastodon #bist100) fetched through /api/social. Individual posts are
 * never shown or quoted; the view reports only aggregate figures (post counts, the companies the
 * posts mention, agenda topics, per-source activity) computed by SocialTags.summarize. A source
 * that cannot be fetched is named as such, never filled in.
 */
const SocialFeed = (() => {
  const KIND = {
    telegram: { label: 'Telegram', icon: 'fa-brands fa-telegram', color: 'text-sky-400' },
    reddit: { label: 'Reddit', icon: 'fa-brands fa-reddit-alien', color: 'text-orange-400' },
    mastodon: { label: 'Mastodon', icon: 'fa-brands fa-mastodon', color: 'text-violet-400' }
  };
  const DAY = 24 * 60 * 60 * 1000;
  const state = { status: 'idle', items: [], sources: [], fetchedAt: 0 };
  let pending = null;
  let loadedAt = 0;
  let codeSet = null;

  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '#');
  const tz = { timeZone: 'Europe/Istanbul' };

  function codes() {
    if (!codeSet) codeSet = new Set(typeof KAP_RAW_COMPANIES !== 'undefined' ? KAP_RAW_COMPANIES.map(c => c.c) : []);
    return codeSet;
  }

  /** "ASELSAN ELEKTRONİK SANAYİ VE TİCARET A.Ş." → "Aselsan Elektronik Sanayi ve Ticaret" */
  function companyName(code) {
    const raw = typeof getRawCompany === 'function' ? getRawCompany(code) : null;
    if (!raw || !raw.n) return code;
    return raw.n.replace(/\s*(T\.\s?)?A\.\s?[ŞO]\.?\s*$/, '').toLocaleLowerCase('tr')
      .split(/\s+/).map(w => (w === 've' ? w : w.charAt(0).toLocaleUpperCase('tr') + w.slice(1))).join(' ');
  }

  const pct = (a, b) => Math.round((a / b) * 100);
  // Topic names inside a sentence: "Temettü ..." → "temettü ...", "BIST 100 ..." kept
  const inSentence = s => (/^\p{Lu}{2}/u.test(s) ? s : s.charAt(0).toLocaleLowerCase('tr') + s.slice(1));
  const label = c => `${esc(companyName(c.code))} (${esc(c.code)})`;

  /** "önceki 24 saate göre %40 artış göstermiştir" style clause; '' when there is nothing to compare. */
  function change(cur, prev, subject = '') {
    if (!prev) return '';
    if (cur === prev) return `${subject}önceki 24 saatle aynı düzeyde kalmıştır`;
    const d = pct(Math.abs(cur - prev), prev);
    return `${subject}önceki 24 saatteki ${prev} paylaşıma göre %${d} ${cur > prev ? 'artış' : 'azalış'} göstermiştir`;
  }

  function list(names) {
    if (names.length < 2) return names.join('');
    return `${names.slice(0, -1).join(', ')} ve ${names[names.length - 1]}`;
  }

  /** One request per 5 minutes at most; every caller shares it. */
  function load(force = false) {
    if (!force && pending && Date.now() - loadedAt < 5 * 60 * 1000) return pending;
    loadedAt = Date.now();
    pending = fetch('/api/social')
      .then(r => r.json().then(body => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) { const e = new Error('social unavailable'); e.sources = body && body.sources; throw e; }
        body.items.forEach(p => { p.tickers = SocialTags.extractTickers(p.text, codes()); });
        return body;
      });
    pending.catch(() => { pending = null; });
    return pending;
  }

  const section = (no, title, body) => `
    <section class="space-y-3">
      <h2 class="font-serif text-lg sm:text-xl text-white flex items-baseline gap-3"><span class="text-xs font-mono text-red-400">${no}</span>${title}</h2>
      ${body}
    </section>`;
  const para = html => `<p class="text-sm text-slate-300 leading-7 text-justify">${html}</p>`;
  const th = 'px-3 py-2 text-left text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold';
  const td = 'px-3 py-2.5 border-t border-[#162238]';

  function overview(s, ok, failed) {
    const at = new Date(state.fetchedAt);
    const opening = `${esc(at.toLocaleDateString('tr-TR', { ...tz, day: 'numeric', month: 'long', year: 'numeric' }))} tarihinde saat ${esc(at.toLocaleTimeString('tr-TR', { ...tz, hour: '2-digit', minute: '2-digit' }))} itibarıyla derlenen bu bülten, izlenen ${ok.length} herkese açık sosyal medya kaynağındaki paylaşımların sayısal bir özetidir.`;
    const parts = [opening];
    if (!s.total) {
      parts.push('Son 24 saatte izlenen kaynaklarda Borsa İstanbul ile ilgili paylaşım tespit edilmemiştir.');
    } else {
      const ch = change(s.total, s.prevTotal);
      parts.push(`Son 24 saatte toplam <strong class="text-white">${s.total}</strong> paylaşım tespit edilmiş${ch ? `; bu hacim ${ch}` : ''}.`);
      if (s.withCodes) {
        parts.push(`Paylaşımların ${s.withCodes} adedinde (%${pct(s.withCodes, s.total)}) Borsa İstanbul'da işlem gören en az bir şirkete atıf yapılmış, dönem içinde toplam ${s.companies.length} farklı şirket gündeme gelmiştir.`);
        const [first, ...rest] = s.companies;
        if (first.count === 1) {
          parts.push('Şirket atıfları dağınık bir görünüm sergilemiş olup hiçbir şirket birden fazla paylaşımda yer almamıştır.');
        } else if (rest.length && rest[0].count === first.count) {
          const tied = s.companies.filter(c => c.count === first.count);
          const shown = tied.slice(0, 3).map(c => `<strong class="text-white">${label(c)}</strong>`);
          parts.push(`Dönemin en çok atıf alan şirketleri, her biri ${first.count} paylaşımla, ${list(shown)}${tied.length > 3 ? ` başta olmak üzere ${tied.length} şirket` : ''} olmuştur.`);
        } else {
          const next = rest.filter(c => c.count > 1).slice(0, 2).map(c => `${label(c)} (${c.count})`);
          parts.push(`Dönemin en çok atıf alan şirketi ${first.count} paylaşımla <strong class="text-white">${label(first)}</strong> olmuştur${next.length ? `; bunu ${list(next)} izlemiştir` : ''}.`);
        }
      } else {
        parts.push('Bu paylaşımlarda belirli bir şirkete doğrudan atıf yapılmamıştır.');
      }
    }
    if (failed.length) parts.push(`${list(failed.map(f => esc(f.name)))} kaynağına bu derlemede erişilememiş olup değerlendirme yalnızca erişilebilen kaynaklara dayanmaktadır.`);
    return para(parts.join(' '));
  }

  function companiesTable(s) {
    if (!s.companies.length) return para('Son 24 saatte şirket atfı içeren paylaşım bulunmamaktadır.');
    const rows = s.companies.slice(0, 10).map((c, i) => {
      const diff = c.prev ? c.count - c.prev : null;
      const diffCell = diff === null ? '<span class="text-slate-500">yeni</span>'
        : diff === 0 ? '<span class="text-slate-400">0</span>'
        : `<span class="${diff > 0 ? 'text-emerald-400' : 'text-rose-400'}">${diff > 0 ? '+' : ''}${diff}</span>`;
      return `<tr class="hover:bg-[#0C1322] cursor-pointer" data-social-stock="${esc(c.code)}" title="Hisse sayfasını aç">
        <td class="${td} font-mono text-slate-500">${i + 1}</td>
        <td class="${td} font-mono font-bold text-white">${esc(c.code)}</td>
        <td class="${td} text-slate-300">${esc(companyName(c.code))}</td>
        <td class="${td} font-mono text-right text-white">${c.count}</td>
        <td class="${td} font-mono text-right text-slate-400">${c.prev}</td>
        <td class="${td} font-mono text-right">${diffCell}</td>
        <td class="${td} font-mono text-right text-slate-400">${c.channels.length}</td>
      </tr>`;
    }).join('');
    return `
      ${para('Aşağıdaki tablo, son 24 saatte en fazla paylaşımda atıf yapılan şirketleri, bir önceki 24 saatlik dönemle karşılaştırmalı olarak göstermektedir. Satıra tıklanarak ilgili şirketin hisse sayfasına geçilebilir.')}
      <div class="overflow-x-auto rounded-xl border border-[#1A2540]">
        <table class="w-full text-xs">
          <thead class="bg-[#070B14]"><tr>
            <th class="${th}">#</th><th class="${th}">Kod</th><th class="${th}">Şirket</th>
            <th class="${th} text-right">Son 24 saat</th><th class="${th} text-right">Önceki 24 saat</th>
            <th class="${th} text-right">Fark</th><th class="${th} text-right">Kaynak</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function topicsText(s) {
    if (!s.total) return para('Değerlendirilecek paylaşım bulunmadığından gündem başlığı çıkarılamamıştır.');
    if (!s.topics.length) return para('Son 24 saatteki paylaşımlarda temettü, sermaye artırımı, halka arz, faiz, enflasyon, döviz, bilanço veya endeks başlıklarından herhangi biri belirgin biçimde öne çıkmamıştır.');
    const items = s.topics.map(t => `${esc(inSentence(t.name))} (${t.count} paylaşım)`);
    return para(`Paylaşımların içeriği konu başlıklarına göre sınıflandırıldığında, gündemin ağırlıklı olarak ${list(items)} etrafında şekillendiği görülmektedir. Bir paylaşım birden fazla başlıkla ilişkilendirilebilir.`);
  }

  function sourcesTable(s) {
    const byName = new Map(s.channels.map(c => [c.channel, c]));
    const rows = state.sources.map(src => {
      const k = KIND[src.kind] || KIND.telegram;
      const c = byName.get(src.name);
      const status = src.ok ? '<span class="text-emerald-400">erişildi</span>' : '<span class="text-amber-400">erişilemedi</span>';
      return `<tr>
        <td class="${td}"><a href="${safeUrl(src.home)}" target="_blank" rel="noopener noreferrer" class="text-white hover:text-red-300 font-mono font-bold"><i class="${k.icon} ${k.color} mr-1.5"></i>${esc(src.name)}</a></td>
        <td class="${td} text-slate-400">${esc(k.label)}</td>
        <td class="${td} font-mono text-right text-white">${src.ok ? (c ? c.count : 0) : '—'}</td>
        <td class="${td} font-mono text-right text-slate-400">${src.ok ? (c ? c.withCodes : 0) : '—'}</td>
        <td class="${td} font-mono text-right">${status}</td>
      </tr>`;
    }).join('');
    return `
      <div class="overflow-x-auto rounded-xl border border-[#1A2540]">
        <table class="w-full text-xs">
          <thead class="bg-[#070B14]"><tr>
            <th class="${th}">Kaynak</th><th class="${th}">Platform</th><th class="${th} text-right">Paylaşım (24 saat)</th>
            <th class="${th} text-right">Şirket atıflı</th><th class="${th} text-right">Durum</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function assessment(s) {
    const surge = s.companies.filter(c => c.surge);
    if (!surge.length) {
      return para('İnceleme döneminde, tek bir şirketin kısa süre içinde birden fazla kaynakta olağan dışı biçimde öne çıkarıldığı bir yoğunlaşma tespit edilmemiştir.');
    }
    const names = surge.map(label);
    return `
      <div class="p-4 rounded-xl bg-amber-950/30 border border-amber-800/50 text-sm text-amber-100 leading-7 text-justify">
        ${list(names)} ${surge.length > 1 ? 'kodlarına' : 'koduna'} yapılan atıfların son 24 saatte birden fazla kaynakta ve önceki döneme göre en az iki kat artışla yoğunlaştığı görülmektedir. Bu tür ani ve eş zamanlı yoğunlaşmalar koordineli yönlendirme girişimlerine işaret edebileceğinden, ilgili şirketlere ilişkin değerlendirmelerin KAP bildirimleri ve finansal tablolar esas alınarak yapılması önemle tavsiye olunur.
      </div>`;
  }

  function methodology(ok) {
    return para(`Bu bülten; herkese açık Telegram kanal önizlemeleri, Reddit r/Borsa topluluğu ve Mastodon #bist100 etiketinden son 7 güne ait paylaşımların otomatik olarak taranmasıyla hazırlanmaktadır. Paylaşımlarda geçen Borsa İstanbul işlem kodları KAP şirket listesiyle eşleştirilerek sayılmakta; bireysel paylaşımlar yayımlanmamakta ve alıntılanmamaktadır. Kapalı veya özel gruplar kapsam dışıdır; X (Twitter) ücretli erişim gerektirdiğinden dahil edilmemiştir. Bu derlemede ${ok.length} kaynaktan veri alınabilmiştir.`) +
      `<p class="text-xs text-slate-500 leading-6 text-justify pt-2 border-t border-[#162238]"><strong class="text-slate-400">Yasal uyarı:</strong> Burada yer alan bilgiler üçüncü kişilerin herkese açık paylaşımlarından otomatik olarak türetilmiş istatistiklerdir; Verity tarafından doğrulanmamıştır ve yatırım tavsiyesi niteliği taşımaz. Sermaye piyasası araçlarına ilişkin yanıltıcı yönlendirmeler 6362 sayılı Sermaye Piyasası Kanunu kapsamında piyasa dolandırıcılığı sayılabilir. Yatırım kararlarınızı resmi kaynaklara dayanarak veriniz.</p>`;
  }

  function paint() {
    const box = document.getElementById('socialReport');
    const count = document.getElementById('socialTotalCount');
    if (!box) return;
    if (state.status === 'loading') {
      box.innerHTML = '<div class="py-16 text-center text-xs font-mono text-slate-500">Bülten hazırlanıyor...</div>';
      if (count) count.textContent = 'Yükleniyor...';
      return;
    }
    if (state.status === 'error') {
      box.innerHTML = '<div class="py-16 text-center text-sm text-amber-400 font-mono">Sosyal medya kaynaklarına şu an erişilemiyor; bülten hazırlanamadı. Birazdan tekrar deneyin.</div>';
      if (count) count.textContent = 'Alınamadı';
      return;
    }
    const s = SocialTags.summarize(state.items, state.fetchedAt);
    const ok = state.sources.filter(x => x.ok);
    const failed = state.sources.filter(x => !x.ok);
    if (count) count.textContent = `${s.total} paylaşım`;
    box.innerHTML = [
      section('01', 'Genel Görünüm', overview(s, ok, failed)),
      section('02', 'Öne Çıkan Şirketler', companiesTable(s)),
      section('03', 'Gündem Başlıkları', topicsText(s)),
      section('04', 'Kaynak Bazında Etkinlik', sourcesTable(s)),
      section('05', 'Değerlendirme', assessment(s)),
      section('06', 'Yöntem ve Yasal Uyarı', methodology(ok))
    ].join('<hr class="border-[#162238]">');
  }

  async function refresh(force = false) {
    state.status = 'loading';
    paint();
    try {
      const body = await load(force);
      Object.assign(state, { status: 'ready', items: body.items, sources: body.sources, fetchedAt: body.fetchedAt });
    } catch (e) {
      console.warn('[Social] unavailable:', e.message);
      Object.assign(state, { status: 'error', items: [], sources: e.sources || [] });
    }
    paint();
    const t = document.getElementById('socialFetchedAt');
    if (t) t.textContent = state.fetchedAt ? new Date(state.fetchedAt).toLocaleTimeString('tr-TR', { ...tz, hour: '2-digit', minute: '2-digit' }) : '—';
  }

  /** Stock page: a short written note on how often this code came up, no posts. */
  async function showForStock(code) {
    const box = document.getElementById('stockSocialContainer');
    if (!box) return;
    box.innerHTML = '<div class="py-6 text-center text-xs font-mono text-slate-500">Sosyal medya özeti hazırlanıyor...</div>';
    try {
      const body = await load();
      if (appState.currentStock !== code) return;
      const posts = body.items.filter(p => p.tickers.includes(code));
      const name = label({ code });
      if (!posts.length) {
        box.innerHTML = para(`Son 7 günde izlenen herkese açık sosyal medya kaynaklarında ${name} koduna atıf yapılan paylaşım tespit edilmemiştir.`);
        return;
      }
      const now = body.fetchedAt;
      const day = posts.filter(p => now - p.date < DAY).length;
      const prev = posts.filter(p => now - p.date >= DAY && now - p.date < 2 * DAY).length;
      const channels = [...new Set(posts.map(p => p.channel))];
      const topics = SocialTags.summarize(posts, now).topics.slice(0, 3).map(t => esc(inSentence(t.name)));
      const ch = change(day, prev, 'bu sayı ');
      const parts = [
        `Son 7 günde izlenen herkese açık sosyal medya kaynaklarında ${name} koduna <strong class="text-white">${posts.length}</strong> paylaşımda atıf yapılmıştır.`,
        day ? `Son 24 saatteki atıf sayısı ${day} olup ${ch || 'önceki 24 saatte atıf bulunmamaktadır'}.` : 'Son 24 saatte yeni bir atıf bulunmamaktadır.',
        `Atıfların yer aldığı ${channels.length > 1 ? 'kaynaklar' : 'kaynak'}: ${list(channels.map(esc))}.`,
        topics.length ? `Son 24 saatteki paylaşımlarda öne çıkan ${topics.length > 1 ? 'başlıklar' : 'başlık'} ${list(topics)} olmuştur.` : ''
      ];
      box.innerHTML = para(parts.filter(Boolean).join(' ')) +
        '<p class="text-[11px] text-slate-500 font-mono pt-2">Veriler üçüncü kişilerin herkese açık paylaşımlarından otomatik türetilmiştir; doğrulanmamıştır, yatırım tavsiyesi değildir.</p>';
    } catch {
      if (appState.currentStock === code) box.innerHTML = '<div class="py-6 text-center text-xs text-amber-400 font-mono">Sosyal medya kaynaklarına şu an erişilemiyor.</div>';
    }
  }

  function init() {
    const view = document.getElementById('view-social');
    if (view) {
      view.addEventListener('click', e => {
        const row = e.target.closest('[data-social-stock]');
        if (row) switchView('stock-detail', row.getAttribute('data-social-stock'));
      });
    }
    const again = document.getElementById('socialRefreshBtn');
    if (again) again.addEventListener('click', () => refresh(true));
  }

  /** Called when the view is opened: the first visit loads, later visits repaint. */
  function render() {
    if (state.status === 'idle' || state.status === 'error') refresh();
    else paint();
  }

  return { init, render, refresh, showForStock, state };
})();

window.SocialFeed = SocialFeed;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', SocialFeed.init);
else SocialFeed.init();
