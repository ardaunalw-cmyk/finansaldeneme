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
    ['Sektörel Sermaye Akışı', 'ÖRNEK', 'Sektör getirileri ve sermaye payları sabit örnek değerlerdir.'],
    ['İnteraktif İNA Duyarlılık Matrisi', 'ÖRNEK GİRDİLER', 'Matris, örnek nakit akışı ve hedef fiyat girdileriyle çalışır; adil değer tahmini değildir.'],
    ['Sermaye Artırımı ve Temettü İstihbaratı', 'KISMEN ÖRNEK', 'Bedelsiz potansiyeli bilançodaki özkaynaktan hesaplanır (bilançosu olmayan şirketlerde örnektir). Temettü verimi gerçek nakit temettü geçmişinden (Yahoo Finance) hesaplanır. Dağıtım oranı, halka açıklık ve esneklik derecesi örnektir.'],
    ['10 Kademe Emir Defteri', 'ÖRNEK', 'Gerçek emir defteri verisi lisanslı veri gerektirir; gösterilen kademeler örnektir.'],
    ['Aracı Kurum Dağılımı (AKD)', 'ÖRNEK', 'Gerçek AKD verisi lisanslı veri gerektirir; kurumlar ve oranlar örnektir.'],
    ['Yabancı Takas ve MKK Saklama Dağılımı', 'ÖRNEK', 'Gerçek takas verisi MKK’dan lisanslı alınır; gösterilen oranlar örnektir.'],
    ['Başabaş Rakip Kıyaslama', 'KARMA VERİ', 'Rakipler elle seçilmiştir. Fiyat ve rasyolar yalnızca gerçek verisi yüklenmiş şirketlerde gerçektir; skor ve radar eksenleri örnektir.'],
    ['Makroekonomik Veri ve Bilanço Takvimi', 'ÖRNEK', 'Tarihler, beklentiler ve önceki değerler gerçek bir ekonomik takvimden alınmamıştır.'],
    ['Sektörel F/K ve Yıllık Büyüme Matrisi', 'ÖRNEK', 'Sektör F/K ve büyüme değerleri örnektir.'],
    ['Portföy Performansı vs BIST 100 Benchmark', 'ÖRNEK', 'Model portföy getirisi gerçek bir portföyün performansı değildir.'],
    ['Varlık ve Sektör Dağılımı', 'ÖRNEK'],
    ['Portföy Varlıkları, Ağırlıklar ve Marjinal Risk Katkısı', 'ÖRNEK', 'Ağırlıklar, maliyetler ve risk katkıları örnek model portföye aittir.'],
    ['Korelasyon Matrisi', 'ÖRNEK', 'Korelasyonlar gerçek fiyat geçmişinden hesaplanmamıştır.'],
    ['Makro Stres Testi Simülatörü', 'ÖRNEK', 'Senaryo etkileri örnek katsayılarla hesaplanır.']
  ];

  // Whole views that are demo content
  const VIEWS = [
    ['view-reports', 'Sektörel raporlardaki yorumlar, rakamlar ve projeksiyonlar örnek içeriktir; gerçek bir araştırma raporu değildir.'],
    ['view-portfolio', 'Model portföy bir gösterim örneğidir: varlıklar, ağırlıklar, getiri, korelasyon ve stres testi sonuçları gerçek bir portföyü yansıtmaz.']
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
