/**
 * "Son KAP Bildirimleri" on the stock page: the company's real recent disclosures from KAP.
 * When KAP cannot be reached, the card says so and still links to the company's KAP page.
 */
const Disclosures = (() => {
  const CLASS = {
    ODA: { label: 'ÖZEL DURUM', cls: 'bg-red-950/40 text-red-400 border-red-800/50' },
    FR: { label: 'FİNANSAL RAPOR', cls: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50' },
    DG: { label: 'DİĞER', cls: 'bg-slate-800 text-slate-300 border-slate-700' },
    DKB: { label: 'DÜZENLEYİCİ', cls: 'bg-indigo-950/60 text-indigo-400 border-indigo-800/50' },
    GKB: { label: 'GENEL KURUL', cls: 'bg-indigo-950/60 text-indigo-400 border-indigo-800/50' }
  };
  const cache = new Map();   // key -> { at, body }

  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** "05.08.2026 08:01:20" -> Date (Istanbul wall-clock time shown as given). */
  function parseKapDate(s) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}):(\d{2}))?/.exec(s || '');
    return m ? { d: +m[1], mo: +m[2], y: +m[3], h: m[4] || '00', mi: m[5] || '00' } : null;
  }

  function when(s) {
    const p = parseKapDate(s);
    if (!p) return s || '';
    const today = new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' });
    const yday = new Date(Date.now() - 86400000).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' });
    const dd = `${String(p.d).padStart(2, '0')}.${String(p.mo).padStart(2, '0')}.${p.y}`;
    if (dd === today) return `Bugün ${p.h}:${p.mi}`;
    if (dd === yday) return `Dün ${p.h}:${p.mi}`;
    return `${dd} ${p.h}:${p.mi}`;
  }

  const companyUrl = fin => {
    const oid = fin.kap || fin.mkk || '';
    return oid ? `https://www.kap.org.tr/tr/sirket-bilgileri/genel/${oid}` : 'https://www.kap.org.tr/tr/bist-sirketler';
  };

  function paint(fin, state, body) {
    const box = document.getElementById('kapDisclosuresContainer');
    const foot = document.getElementById('kapDisclosuresFooter');
    if (!box) return;
    const link = `<a href="${esc(companyUrl(fin))}" target="_blank" rel="noopener" class="text-red-400 hover:text-red-300 font-semibold">KAP'ta aç <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i></a>`;

    if (state === 'loading') {
      box.innerHTML = '<div class="py-6 text-center text-xs font-mono text-slate-500">KAP bildirimleri yükleniyor...</div>';
      if (foot) foot.innerHTML = '<span class="text-[11px]">Kaynak: KAP (kap.org.tr)</span>' + link;
      return;
    }
    if (state === 'error') {
      box.innerHTML = `<div class="py-6 text-center text-xs text-amber-400 font-mono">KAP bildirimleri şu an alınamadı.<br><span class="text-slate-500">Bildirimlere doğrudan KAP'tan bakabilirsiniz.</span></div>`;
      if (foot) foot.innerHTML = '<span class="text-[11px]">Kaynak: KAP (kap.org.tr)</span>' + link;
      return;
    }
    if (!body.items.length) {
      box.innerHTML = '<div class="py-6 text-center text-xs text-slate-500 font-mono">Son 18 ayda bu şirkete ait bildirim bulunamadı.</div>';
    } else {
      box.innerHTML = body.items.map(d => {
        const c = CLASS[d.cls] || { label: d.type || d.cls || 'BİLDİRİM', cls: 'bg-slate-800 text-slate-300 border-slate-700' };
        return `
          <a href="https://www.kap.org.tr/tr/Bildirim/${encodeURIComponent(d.index)}" target="_blank" rel="noopener" class="block p-3 bg-[#090D18] hover:bg-[#121C30] rounded-xl border border-[#162238] transition-colors">
            <div class="flex items-center justify-between gap-2">
              <span class="px-2 py-0.5 rounded text-[9px] font-mono font-bold border ${c.cls}">${esc(c.label)}</span>
              <span class="text-[10px] text-slate-400 font-mono">${esc(when(d.date))}</span>
            </div>
            <div class="font-bold text-slate-200 text-xs mt-1.5 leading-snug">${esc(d.summary || d.subject)}</div>
            ${d.summary && d.subject ? `<p class="text-[11px] text-slate-400 mt-1 leading-relaxed">${esc(d.subject)}</p>` : ''}
          </a>`;
      }).join('');
    }
    const t = new Date(body.fetchedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
    if (foot) foot.innerHTML = `<span class="text-[11px]">Kaynak: KAP (kap.org.tr) • ${t}</span>${link}`;
  }

  async function show(fin, force = false) {
    const mkk = fin.mkk;
    const raw = typeof getRawCompany === 'function' ? getRawCompany(fin.code) : null;
    const codes = [...new Set([fin.code, ...String(raw && raw.c || '').split(',').map(s => s.trim().toUpperCase())])].filter(Boolean);

    if (!mkk) { paint(fin, 'error'); return; }
    const key = `${mkk}|${codes.join(',')}`;
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < 5 * 60 * 1000) { paint(fin, 'ok', hit.body); return; }

    paint(fin, 'loading');
    try {
      const r = await fetch(`/api/disclosures?oid=${encodeURIComponent(mkk)}&codes=${encodeURIComponent(codes.join(','))}`);
      if (!r.ok) throw new Error(`disclosures ${r.status}`);
      const body = await r.json();
      cache.set(key, { at: Date.now(), body });
      if (appState.currentStock === fin.code) paint(fin, 'ok', body);
    } catch (e) {
      console.warn('[Disclosures] unavailable:', e.message);
      if (appState.currentStock === fin.code) paint(fin, 'error');
    }
  }

  return { show };
})();

window.Disclosures = Disclosures;
