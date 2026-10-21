/**
 * Glossary: puts a small "?" next to every finance term in the app.
 * Clicking it opens a short plain-language explanation.
 */
(function () {
  // [display title, regex source matched against short labels, explanation]
  const TERMS = [
    ['F/K (Fiyat/Kazanç)', 'F\\s*/\\s*K', 'Hisse fiyatının, şirketin bir yılda hisse başına kazandığı paraya bölünmesiyle bulunur. "Şirketin yıllık kazancının kaç katına alıyorum?" sorusunu cevaplar. Düşükse kazancına göre ucuz, yüksekse pahalı sayılır.'],
    ['PD/DD (Piyasa Değeri / Defter Değeri)', 'PD\\s*/\\s*DD', 'Şirketin borsadaki toplam değerinin, şirketin kayıtlardaki öz değerine oranıdır. 1\'in altındaysa borsa şirketi kayıtlardaki değerinden ucuza fiyatlıyor demektir.'],
    ['FD/FAVÖK', 'FD\\s*/\\s*FAV[ÖO]K', 'Bir şirketi borçlarıyla birlikte tamamen satın almak için ödenecek paranın, şirketin yıllık asıl iş kazancına oranıdır. Düşük olması şirketin ucuz olduğuna işaret edebilir.'],
    ['Net Borç / FAVÖK', 'N\\.?\\s*Bor[çc]\\s*/\\s*FAV[ÖO]K|Net\\s+Bor[çc]\\s*/\\s*FAV[ÖO]K', 'Şirketin borcunu yıllık kazancıyla kaç yılda ödeyebileceğini gösterir. Küçük olması iyidir; çok büyükse şirket borç yükü altında demektir.'],
    ['FAVÖK', 'FAV[ÖO]K', 'Faiz, vergi ve değer kaybı giderleri düşülmeden önceki kâr. Şirketin asıl işinden ne kadar para kazandığını gösterir.'],
    ['Net Borç', 'Net\\s+Bor[çc]', 'Şirketin toplam borcundan kasasındaki ve bankadaki parayı çıkardıktan sonra kalan borç.'],
    ['ROE (Özsermaye Kârlılığı)', 'ROE', 'Şirket sahiplerinin koyduğu her 100 liraya karşılık şirketin bir yılda kaç lira kâr yaptığını gösterir. Yüksek olması iyidir.'],
    ['ROA (Varlık Kârlılığı)', 'ROA', 'Şirketin sahip olduğu her 100 liralık mal varlığıyla bir yılda kaç lira kâr yaptığını gösterir.'],
    ['Altman Z-Skoru', 'Altman', 'Şirketin yakın gelecekte iflas etme riskini ölçen bir puan. Yüksek puan güvenli, düşük puan riskli anlamına gelir.'],
    ['Piotroski F-Skoru', 'Piotroski', '0 ile 9 arasında bir puan. Şirketin kâr, borç ve verimlilik durumunun yıldan yıla iyileşip iyileşmediğine bakar. Yüksek olması iyidir.'],
    ['DuPont Analizi', 'DuPont', 'Bir şirketin kârlılığının nereden geldiğini üç parçaya ayırır: sattığı üründen ne kadar kazandığı, varlıklarını ne kadar çalıştırdığı ve ne kadar borç kullandığı.'],
    ['Net Kâr Marjı', 'Net\\s+(Kâr\\s+)?Marj', 'Şirketin sattığı her 100 liranın kaç lirasının sonunda kâr olarak kaldığı.'],
    ['Devir Hızı', 'Devir\\s+H[ıi]z[ıi]', 'Şirketin sahip olduğu varlıklarla ne kadar satış yaptığını gösterir. Yüksek olması varlıkların iyi çalıştığı anlamına gelir.'],
    ['Kaldıraç', 'Kald[ıi]ra[çc]', 'Şirketin kendi parasının yanında ne kadar borç kullandığı. Fazla kaldıraç kazancı da kaybı da büyütür.'],
    ['Brüt Kâr', 'Br[üu]t\\s+K[âa]r', 'Satış gelirinden, ürünü üretmenin doğrudan maliyeti çıkarıldıktan sonra kalan para.'],
    ['Net Kâr', 'Net\\s+K[âa]r', 'Tüm giderler, faizler ve vergiler çıkarıldıktan sonra şirketin cebinde kalan para.'],
    ['Özsermaye (Özkaynak)', '[ÖO]z\\s?(sermaye|kaynak)', 'Şirketin sahiplerine ait kısmı: şirketin sahip olduğu her şeyden borçlar çıkarıldıktan sonra kalan değer.'],
    ['Bilanço', '^Bilan[çc]o$', 'Şirketin belirli bir günde neye sahip olduğunu (varlıklar) ve kime ne kadar borcu olduğunu (borçlar) gösteren tablo.'],
    ['Gelir Tablosu', 'Gelir\\s+Tablosu', 'Şirketin belirli bir dönemde ne kadar sattığını, ne kadar harcadığını ve sonunda ne kadar kâr veya zarar ettiğini gösteren tablo.'],
    ['Nakit Akışı', 'Nakit\\s+Ak[ıi][şs][ıi]', 'Şirketin kasasına giren ve çıkan paranın hareketi. Kâr görünse bile kasaya para girmiyorsa sorun olabilir.'],
    ['Cari Oran', 'Cari\\s+Oran', 'Şirketin bir yıl içinde ödemesi gereken borçlara karşı, bir yıl içinde paraya çevirebileceği varlıklarının oranı. 1\'in üstü genelde rahat demektir.'],
    ['Likidite', 'Likidite', 'Bir şeyin ne kadar kolay ve hızlı paraya çevrilebildiği. Bir hissenin likiditesi yüksekse istediğiniz an kolayca alıp satabilirsiniz.'],
    ['Temettü', 'Temett[üu]|Kâr\\s+Payı', 'Şirketin kârından hissedarlara dağıttığı para.'],
    ['Piyasa Değeri', 'Piyasa\\s+De[ğg]eri', 'Şirketin borsadaki toplam fiyatı: hisse fiyatı çarpı toplam hisse sayısı.'],
    ['Hedef Fiyat', 'Hedef\\s+Fiyat|12\\s*Ay\\s+Hedef', 'Analistlerin bir hissenin belirli bir süre sonra ulaşabileceğini düşündüğü fiyat tahmini. Garanti değil, sadece bir tahmindir.'],
    ['Hacim', 'Hacim', 'Belirli bir sürede el değiştiren hisse sayısı veya tutarı. Hacim yüksekse hisse çok işlem görüyor demektir.'],
    ['52 Haftalık Zirve / Dip', '52\\s*Hafta', 'Hissenin son bir yıl içindeki en yüksek ve en düşük fiyatı.'],
    ['Verity Bilanço Skoru', 'Bilan[çc]o\\s+Skoru|Alpha\\s+Skor|Alfa\\s+Skor', 'Şirketin gerçek bilançosundan hesaplanan 0-10 arası puan: kâr etme gücü, borç yükü ve hissenin sektörüne göre ucuz ya da pahalı olması birlikte değerlendirilir. Yüksek olması mali durumun sağlam olduğunu gösterir.'],
    ['Model Değer', 'MODEL\\s+DE[ĞG]ER', 'Şirketin bir yıllık kazancı ve defter değeri, aynı sektördeki şirketlerin ortanca çarpanlarıyla çarpılarak bulunan tahmini fiyat. Bir analist hedefi ya da garanti değil, yalnızca bir hesaptır; sert sapmalar fiyatın yarısı ile iki katı arasında sınırlandırılır.'],
    ['RSI', 'RSI', 'Fiyatın son dönemde ne kadar hızlı yükselip düştüğünü 0-100 arasında gösteren gösterge. 70\'in üstü aşırı yükselmiş, 30\'un altı aşırı düşmüş olabileceğine işaret eder.'],
    ['MACD', 'MACD', 'İki farklı sürenin fiyat ortalamasını kıyaslayarak yükseliş ya da düşüş eğiliminin güçlenip zayıfladığını gösteren gösterge.'],
    ['Hareketli Ortalama', 'SMA|EMA|Hareketli\\s+Ortalama|\\bMA\\s?\\d+', 'Son belirli sayıda günün ortalama fiyatı. Fiyat ortalamanın üstündeyse yükseliş, altındaysa düşüş eğilimi olarak yorumlanır.'],
    ['Bollinger Bantları', 'Bollinger', 'Fiyatın ortalamasının etrafında çizilen alt ve üst bant. Fiyat bandın dışına çıktığında alışılmışın dışında hareket ediyor demektir.'],
    ['Destek / Direnç', 'Destek|Diren[çc]', 'Destek: fiyatın düşerken sık sık durduğu seviye. Direnç: fiyatın yükselirken sık sık takıldığı seviye.'],
    ['Volatilite', 'Volatilite|Oynakl[ıi]k', 'Fiyatın ne kadar hızlı ve ne kadar çok inip çıktığı. Yüksekse hisse daha riskli ama daha hareketli demektir.'],
    ['Beta', '\\bBeta\\b', 'Hissenin piyasaya göre ne kadar hareketli olduğu. 1\'in üstündeyse piyasadan daha çok, altındaysa daha az oynar.'],
    ['Endeks', '^Endeks', 'Birçok hissenin fiyatını tek bir sayıda toplayan ölçü. Borsanın genel olarak yükseldiğini ya da düştüğünü gösterir.'],
    ['Sektör Medyanı', 'Medyan|Sekt[öo]r\\s+Ort', 'Aynı sektördeki şirketlerin ortasındaki değer. Bir şirketin sektörüne göre iyi ya da kötü durumda olup olmadığını anlamak için kullanılır.'],
    ['Model Portföy', 'Model\\s+Portf[öo]y', 'Örnek olarak oluşturulmuş bir hisse sepeti. Kendi yatırımınızı nasıl dağıtabileceğinize dair bir fikir verir.'],
    ['Getiri', 'Getiri', 'Bir yatırımın belirli sürede kazandırdığı ya da kaybettirdiği oran.'],
    ['Enflasyon', 'Enflasyon', 'Fiyatların genel olarak artması. Enflasyon yüksekken aynı parayla daha az şey alınır.'],
    ['Korku ve Açgözlülük', 'Korku|A[çc]g[öo]zl[üu]l[üu]k', 'Yatırımcıların o anki ruh halini gösteren puan. Korku yüksekse insanlar satıyor, açgözlülük yüksekse insanlar coşkuyla alıyor demektir.'],
    ['KAP', '^KAP$', 'Kamuyu Aydınlatma Platformu. Borsadaki şirketlerin resmi duyurularını ve mali tablolarını yayımladığı resmi internet sitesi.'],
    ['Bedelsiz', 'Bedelsiz', 'Şirketin hissedarlara ek para almadan yeni hisse vermesi. Hisse sayınız artar ama fiyat da buna göre düşer.'],
    ['Bedelli', 'Bedelli', 'Şirketin sermaye artırmak için hissedarlarından para karşılığında yeni hisse alma hakkı sunması.']  ].map(([title, src, text]) => ({ title, re: new RegExp(src, 'i'), text }));

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'A', 'KBD', 'SVG', 'CANVAS', 'NOSCRIPT', 'H1', 'CODE']);
  const MAX_LABEL = 48;
  let pop = null;
  let popOwner = null;

  /** A label is a short element holding only text: "F/K", "Net Kâr Marjı", "Hacim: ₺4.82 Mlr" ... */
  function isLeaf(el) {
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return false;
    if (el.closest('.gl-pop, #chatWidget, [data-no-glossary], #searchDropdown, .stock-about-text, .plain-summary, a, button, nav, .site-menu, .top-ticker-bar, .data-note')) return false;
    let text = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) text += n.nodeValue;
      else if (n.nodeType === 1 && n.classList.contains('gl-btn')) return false;
      else if (n.nodeType === 1 && n.tagName !== 'I') return false;
    }
    text = text.trim();
    return text.length >= 2 && text.length <= MAX_LABEL ? text : false;
  }

  function decorate(root) {
    if (!root || root.nodeType !== 1) return;
    const els = [root, ...root.querySelectorAll('*')];
    for (const el of els) {
      const text = isLeaf(el);
      if (!text) continue;
      const term = TERMS.find(t => t.re.test(text));
      if (!term) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gl-btn';
      btn.textContent = '?';
      btn.setAttribute('aria-label', `${term.title} nedir?`);
      btn.dataset.glTitle = term.title;
      btn.dataset.glText = term.text;
      el.appendChild(btn);
    }
  }

  function closePop() {
    if (pop) pop.remove();
    pop = null;
    popOwner = null;
  }

  function openPop(btn) {
    if (popOwner === btn) { closePop(); return; }
    closePop();
    pop = document.createElement('div');
    pop.className = 'gl-pop';
    pop.setAttribute('role', 'dialog');
    const title = document.createElement('div');
    title.className = 'gl-pop-title';
    title.textContent = btn.dataset.glTitle;
    const body = document.createElement('div');
    body.className = 'gl-pop-text';
    body.textContent = btn.dataset.glText;
    pop.append(title, body);
    document.body.appendChild(pop);
    popOwner = btn;

    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    let top = r.bottom + 8;
    if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 8);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('.gl-btn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      openPop(btn);
    } else if (!e.target.closest('.gl-pop')) {
      closePop();
    }
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });
  window.addEventListener('scroll', closePop, true);
  window.addEventListener('resize', closePop);

  let queued = new Set();
  let timer = null;
  function schedule(target) {
    if (target && target.nodeType === 1 && !target.closest('.gl-pop')) queued.add(target);
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const batch = [...queued];
      queued = new Set();
      batch.forEach(el => { if (el.isConnected) decorate(el); });
    }, 120);
  }

  function start() {
    decorate(document.body);
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.target.nodeType === 1) schedule(m.target);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
