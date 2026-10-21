/**
 * Plain-language summary at the bottom of every stock page.
 * One paragraph, no finance jargon. It only talks about numbers that are real
 * (live price, real balance-sheet ratios); sample values are never described.
 */
(function () {
  const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  function firstSentence(text) {
    const m = String(text || '').match(/^.*?[.!?](\s|$)/);
    return (m ? m[0] : String(text || '')).trim();
  }

  function build(fin) {
    const parts = [];

    const about = typeof getStockAbout === 'function' ? getStockAbout(fin.code) : null;
    parts.push(about && about.text ? firstSentence(about.text) : `${fin.name} borsada işlem gören bir şirkettir.`);

    if (fin.liveTime) {
      const pct = String(fin.change || '').replace('+', '').replace('-', '');
      if (pct) parts.push(`Hissenin fiyatı son işlem gününde ${pct} ${fin.isPositive ? 'yükseldi' : 'düştü'}.`);
    }

    if (!fin.fundamentalsLive) {
      parts.push('Bu şirketin kazanç ve borç bilgileri henüz uygulamaya bağlanmadığı için, parasal durumu hakkında bir yorum yapamıyoruz.');
    } else {
      const roe = num(fin.roeNum);
      const fk = num(fin.fkNum);
      const debt = num(fin.netDebtNum);

      if (roe !== null && roe > 0) {
        parts.push(`Şirket son bir yılda kâr etti; sahiplerinin koyduğu her 100 liraya karşılık yaklaşık ${nf.format(roe)} lira kazandırdı.`);
      } else if (roe !== null && fk === null) {
        parts.push('Şirket son bir yılda kâr edemedi, yani zarar etti.');
      }

      if (fk !== null) {
        parts.push(`Hisseyi bugünkü fiyattan alırsanız, şirket aynı kârı sürdürürse paranız kabaca ${nf.format(fk)} yılda geri döner. Bu süre ne kadar kısaysa hisse kazancına göre o kadar ucuz sayılır.`);
      }

      if (debt !== null) {
        if (debt <= 0) {
          parts.push('Şirketin kasasındaki para borcundan fazla, yani borç yükü yok denecek kadar az.');
        } else if (debt < 2) {
          parts.push(`Şirketin borcunu ödemesi yaklaşık ${nf.format(debt)} yıllık kazancına denk geliyor; bu rahat bir seviye.`);
        } else if (debt < 4) {
          parts.push(`Şirketin borcunu ödemesi yaklaşık ${nf.format(debt)} yıllık kazancına denk geliyor; bu orta düzeyde bir yük.`);
        } else {
          parts.push(`Şirketin borcunu ödemesi yaklaşık ${nf.format(debt)} yıllık kazancına denk geliyor; bu ağır bir yük.`);
        }
      }
    }

    parts.push('Bu yazı bilgi vermek içindir, alıp satmanız için bir öneri değildir.');
    return parts.join(' ');
  }

  function render(fin) {
    const el = document.getElementById('plainSummaryText');
    if (!el || !fin || (typeof appState !== 'undefined' && appState.currentStock !== fin.code)) return;
    el.textContent = build(fin);
  }

  window.PlainSummary = { render };
})();
