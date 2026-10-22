/**
 * Marks the sections that still run on sample data, so nothing generated passes for real.
 *
 * Sections are found by their heading text; each gets a short badge next to the heading and,
 * where useful, a note strip at the top of its card. Remove an entry here once its section is
 * connected to real data.
 */
(function () {
  const SAMPLE = [
    // [heading text, badge, note shown at the top of the card (optional)]
    ['Makroekonomik Veri ve Bilanço Takvimi', 'ÖRNEK', 'Tarihler, beklentiler ve önceki değerler gerçek bir ekonomik takvimden alınmamıştır.'],
    ['Portföy Performansı vs BIST 100 Benchmark', 'ÖRNEK', 'Model portföy getirisi gerçek bir portföyün performansı değildir.'],
    ['Varlık ve Sektör Dağılımı', 'ÖRNEK'],
    ['Portföy Varlıkları, Ağırlıklar ve Marjinal Risk Katkısı', 'ÖRNEK', 'Ağırlıklar, maliyetler ve risk katkıları örnek model portföye aittir.'],
    ['Makro Stres Testi Simülatörü', 'ÖRNEK', 'Senaryo etkileri örnek katsayılarla hesaplanır.']
  ];

  // Whole views that are demo content
  const VIEWS = [
    ['view-reports', 'Rapor kartlarındaki yorumlar, rakamlar ve projeksiyonlar örnek içeriktir; gerçek bir araştırma raporu değildir. Sektörel F/K ve PD/DD grafiği gerçek veridir.'],
    ['view-portfolio', 'Model portföy bir gösterim örneğidir: varlıklar, ağırlıklar, getiri ve stres testi sonuçları gerçek bir portföyü yansıtmaz. Korelasyon matrisi gerçek fiyat geçmişinden hesaplanır.']
  ];

  const banner = text => {
    const d = document.createElement('div');
    d.className = 'sample-banner';
    d.innerHTML = `<i class="data-badge sample">ÖRNEK VERİ</i><span>${text}</span>`;
    return d;
  };

  function mark() {
    SAMPLE.forEach(([text, badge, note]) => {
      document.querySelectorAll('h2, h3, h4').forEach(h => {
        if (h.dataset.sampleFlag || !h.textContent.includes(text)) return;
        h.dataset.sampleFlag = '1';
        const b = document.createElement('i');
        b.className = 'data-badge sample';
        b.style.marginLeft = '8px';
        b.textContent = badge;
        h.appendChild(b);
        if (note) {
          const card = h.closest('.utl-card');
          if (card && !card.querySelector(':scope > .sample-banner')) card.insertBefore(banner(note), card.firstChild);
        }
      });
    });

    VIEWS.forEach(([id, text]) => {
      const view = document.getElementById(id);
      const inner = view && view.firstElementChild;
      if (inner && !inner.querySelector(':scope > .sample-banner')) inner.insertBefore(banner(text), inner.firstChild);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mark);
  else mark();
})();
