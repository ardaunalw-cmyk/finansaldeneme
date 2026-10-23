/**
 * "Finansal Sağlık" tab of the stock page: the ratio analysis of the "Finansal Oran Analizi"
 * course deck, in five groups (liquidity, activity, leverage, profitability, market). Ratios are
 * computed from the real statements Statements already loaded (Calc.healthRatios) and, for the
 * market group, the delayed price; every ratio shows its fraction with the actual figures, the
 * deck's reference value, and the latest fiscal year end for comparison. Ratio names and fraction
 * terms carry a definition box (.fh-tip). Banks and insurers have a different balance sheet, so
 * the tab says so instead of computing industrial ratios for them.
 */
const FinHealth = (() => {
  const nf2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf1 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let group = 'liquidity';
  let sectorMultiples = null;

  /* ---------- glossary: the terms used in the fractions ---------- */
  const TERMS = {
    current: ['Dönen Varlıklar', 'Bir yıl içinde nakde dönmesi beklenen varlıklar: nakit, ticari alacaklar, stoklar ve diğer kısa vadeli varlıklar.'],
    shortDebt: ['Kısa Vadeli Borçlar (KVYK)', 'Bir yıl içinde ödenmesi gereken yükümlülükler: kısa vadeli banka kredileri, ticari borçlar ve diğer kısa vadeli borçlar.'],
    longDebt: ['Uzun Vadeli Borçlar (UVYK)', 'Vadesi bir yıldan uzun olan yükümlülükler: uzun vadeli krediler, tahviller ve karşılıklar.'],
    debt: ['Toplam Borç (KVYK + UVYK)', 'Şirketin tüm yabancı kaynakları: kısa ve uzun vadeli yükümlülüklerin toplamı.'],
    stock: ['Stoklar', 'Satılmak üzere elde tutulan ilk madde, yarı mamul ve mamuller. Nakde dönmesi satışa bağlı olduğu için en yavaş dönen varlıktır.'],
    avgStock: ['Ortalama Stoklar', 'Dönem sonu stoğu ile bir yıl önceki stoğun ortalaması. Dönem içindeki stok seviyesini tek bir tarihe göre daha iyi temsil eder.'],
    cash: ['Nakit ve Nakit Benzerleri', 'Kasa, banka mevduatı ve vadesi üç aydan kısa, hemen nakde çevrilebilen yatırımlar.'],
    receivables: ['Ticari Alacaklar', 'Vadeli (kredili) satışlardan doğan, müşterilerden tahsil edilecek kısa vadeli tutarlar.'],
    assets: ['Toplam Aktif (Varlıklar)', 'Şirketin sahip olduğu tüm varlıkların toplamı; bilançonun aktif tarafı.'],
    fixed: ['Duran Varlıklar', 'Bir yıldan uzun süre kullanılacak varlıklar: fabrika, makine, tesis, maddi olmayan varlıklar ve uzun vadeli yatırımlar.'],
    equity: ['Özkaynaklar', 'Ortakların şirkete koyduğu sermaye ile şirkette bırakılan kârların toplamı; varlıklardan borçlar düşüldükten sonra kalan tutar.'],
    parentEquity: ['Özkaynaklar (Ana Ortaklık)', 'Azınlık payları hariç, ana ortaklık hissedarlarına ait özkaynak.'],
    permanent: ['Devamlı Sermaye', 'Özkaynaklar ile uzun vadeli borçların toplamı; şirketin uzun süre kullanabileceği kaynaklar.'],
    sales: ['Net Satışlar', 'İndirim ve iadeler düşüldükten sonra şirketin satışlarından elde ettiği hasılat (ciro).'],
    cogs: ['Satışların Maliyeti (STMM)', 'Satılan ürün ve hizmetlerin üretim ya da alış maliyeti.'],
    gross: ['Brüt Kâr', 'Net satışlardan satışların maliyeti düşüldükten sonra kalan kâr.'],
    ebit: ['Faaliyet Kârı (EBIT)', 'Brüt kârdan pazarlama, genel yönetim ve Ar-Ge giderleri gibi faaliyet giderleri düşüldükten sonra ana işten elde edilen kâr; faiz ve vergi öncesi kâr.'],
    netIncome: ['Net Dönem Kârı', 'Tüm giderler, finansman maliyetleri ve vergiler düşüldükten sonra ana ortaklığa kalan nihai kâr.'],
    interest: ['Finansman Giderleri', 'Borçlanmadan doğan faiz giderleri ile kur farkı gibi diğer finansal giderler.'],
    shares: ['Toplam Hisse Senedi Sayısı', 'Ödenmiş sermayenin pay sayısı. Borsa İstanbul\'da bir payın nominal değeri 1 TL olduğu için ödenmiş sermayeye eşittir.'],
    days: ['365 Gün', 'Bir yıldaki gün sayısı; devir hızını gün cinsinden süreye çevirmek için kullanılır.'],
    receivableTurnover: ['Alacak Devir Hızı', 'Ticari alacakların yılda kaç kez tahsil edildiği.'],
    inventoryTurnover: ['Stok Devir Hızı', 'Stokların yılda kaç kez satılıp yenilendiği.'],
    price: ['Hisse Piyasa Fiyatı', 'Hissenin borsadaki son (gecikmeli) işlem fiyatı.'],
    eps: ['Hisse Başına Kâr (HBK)', 'Net dönem kârının pay sayısına bölünmesiyle bulunan, her bir hisseye düşen kâr.'],
    mcap: ['Toplam Piyasa Değeri', 'Hisse fiyatı ile toplam pay sayısının çarpımı; şirketin borsadaki toplam değeri.']
  };

  const tip = (text, label = 'Tanım') => `<span class="fh-tip" tabindex="0" role="button" aria-label="${esc(label)}"><i class="fa-solid fa-circle-info"></i><span class="fh-tip-box" role="tooltip">${esc(text)}</span></span>`;
  const term = key => `<span class="inline-flex items-center gap-1">${esc(TERMS[key][0])}${tip(TERMS[key][1], `${TERMS[key][0]} tanımı`)}</span>`;

  /* ---------- the five groups and their ratios (from the deck) ---------- */
  const x = v => `${nf2.format(v)}`;
  const pct = v => `%${nf1.format(v * 100)}`;
  const day = v => `${nf0.format(v)} gün`;
  const times = v => `${nf2.format(v)} kez`;
  const band = (v, good, mid) => (v >= good ? 'good' : v >= mid ? 'mid' : 'bad');
  const bandLow = (v, good, mid) => (v <= good ? 'good' : v <= mid ? 'mid' : 'bad');
  const sign = v => (v < 0 ? 'bad' : null);

  const GROUPS = [
    {
      id: 'liquidity', name: 'Likidite', icon: 'fa-droplet', title: 'Likidite Oranları',
      question: 'Şirket kısa vadeli borçlarını vadesi geldiğinde sorunsuz ödeyebilir mi? Nakit sıkışıklığı riski var mı?',
      ratios: [
        { id: 'current', name: 'Cari Oran', num: 'current', den: 'shortDebt', fmt: x, up: true,
          def: 'Şirketin bir yıl içinde nakde dönecek varlıklarının, bir yıl içinde ödenecek borçlarını karşılama derecesidir.',
          ref: '~1,5 – 2,0', status: v => (v > 3 ? 'mid' : band(v, 1.5, 1)),
          note: v => (v > 3 ? 'Çok yüksek cari oran atıl nakit veya stok birikimine işaret edebilir.' : '') },
        { id: 'quick', name: 'Asit-Test (Likidite) Oranı', num: ['current', '−', 'stock'], den: 'shortDebt', fmt: x, up: true,
          def: 'Satışı zaman alabilecek stokları dışarıda tutarak, şirketin acil ödeme gücünü ölçen daha hassas likidite göstergesidir.',
          ref: '~1,0', status: v => band(v, 1, 0.7) },
        { id: 'cash', name: 'Nakit Oranı', num: 'cash', den: 'shortDebt', fmt: x, up: true,
          def: 'Alacaklar tahsil edilmese ve stoklar satılmasa dahi, eldeki hazır değerlerle kısa vadeli borçların ödenebilme kapasitesidir.',
          ref: '~0,20 – 0,30', status: v => band(v, 0.2, 0.1) }
      ]
    },
    {
      id: 'activity', name: 'Faaliyet', icon: 'fa-arrows-spin', title: 'Faaliyet (Devir Hızı) Oranları',
      question: 'Şirket varlıklarını, stoklarını ve alacaklarını ne kadar hızlı nakde ve satışa dönüştürebiliyor?',
      ratios: [
        { id: 'receivableTurnover', name: 'Alacak Devir Hızı', num: 'sales', den: 'receivables', fmt: times, up: true,
          def: 'Vadeli satışlardan doğan alacakların yılda kaç kez tahsil edilerek nakde dönüştüğünü gösterir.', ref: 'Yüksek olması olumlu' },
        { id: 'collectionDays', name: 'Ortalama Tahsilat Süresi', num: 'days', den: 'receivableTurnover', fmt: day, up: false,
          def: 'Bir satış yapıldıktan sonra parasının ortalama kaç günde tahsil edildiğidir.', ref: 'Sektör vadesine uygun, düşük olması olumlu' },
        { id: 'inventoryTurnover', name: 'Stok Devir Hızı', num: 'cogs', den: 'avgStock', fmt: times, up: true,
          def: 'Stokların yılda kaç kez satılıp yenilendiğini, depodaki sirkülasyon hızını ölçer.', ref: 'Yüksek sirkülasyon' },
        { id: 'inventoryDays', name: 'Stok Tüketim Süresi', num: 'days', den: 'inventoryTurnover', fmt: day, up: false,
          def: 'Ürünün depoya girişinden satılmasına kadar ortalama kaç gün rafta beklediğidir.', ref: 'Düşük gün sayısı' },
        { id: 'assetTurnover', name: 'Aktif (Toplam Varlık) Devir Hızı', num: 'sales', den: 'assets', fmt: times, up: true,
          def: 'Şirketin sahip olduğu her 1 TL\'lik toplam varlıkla ne kadarlık satış (ciro) üretebildiğini ölçer.', ref: 'Yüksek olması olumlu' },
        { id: 'fixedTurnover', name: 'Duran Varlık Devir Hızı', num: 'sales', den: 'fixed', fmt: times, up: true,
          def: 'Fabrika, makine ve tesis gibi duran varlıkların ciro üretme etkinliğini ölçer.', ref: 'Yüksek olması olumlu' }
      ]
    },
    {
      id: 'leverage', name: 'Kaldıraç', icon: 'fa-scale-unbalanced', title: 'Kaldıraç (Mali Yapı) Oranları',
      question: 'Şirket kapasitesinin üzerinde mi borçlu? Finansal risk ve faiz yükü şirketi tehdit ediyor mu?',
      ratios: [
        { id: 'debtRatio', name: 'Kaldıraç (Toplam Borç) Oranı', num: 'debt', den: 'assets', fmt: pct, up: false,
          def: 'Varlıkların ne kadarlık kısmının yabancı kaynaklarla (borçla) finanse edildiğini gösterir.',
          ref: '< %50 – %60 (risk sınırı)', status: v => bandLow(v, 0.5, 0.6) },
        { id: 'debtToEquity', name: 'Borç / Özkaynak Oranı', num: 'debt', den: 'equity', fmt: x, up: false,
          def: 'Şirketin özkaynaklarına kıyasla ne kadar borçlandığını ve alacaklıların emniyet marjını ölçer.',
          ref: '< 1,0 (birebir denge)', status: v => bandLow(v, 1, 2) },
        { id: 'shortDebtShare', name: 'Kısa Vadeli Borç Oranı', num: 'shortDebt', den: 'debt', fmt: pct, up: false,
          def: 'Toplam borç yükü içinde acil ödenmesi gereken kısa vadeli borçların payıdır.', ref: 'Düşük olması güvencedir' },
        { id: 'interestCover', name: 'Faiz Karşılama Oranı', num: 'ebit', den: 'interest', fmt: x, up: true,
          def: 'Şirketin operasyonel kârının, borçlarının faiz yükünü kaç kat karşıladığını ölçer. Finansal kriz riskinin en kritik göstergesidir.',
          ref: '> 3,0 (güvenli alan)', status: v => band(v, 3, 1.5) },
        { id: 'fixedToPermanent', name: 'Duran Varlık / Devamlı Sermaye', num: 'fixed', den: 'permanent', fmt: x, up: false,
          def: 'Uzun vadeli yatırımların (duran varlıkların) uzun vadeli kaynaklarla finanse edilip edilmediğini kontrol eder.',
          ref: '< 1,0 (finansmanın altın kuralı)', status: v => (v < 1 ? 'good' : 'bad') }
      ]
    },
    {
      id: 'profitability', name: 'Kârlılık', icon: 'fa-sack-dollar', title: 'Kârlılık Oranları',
      question: 'Şirket ana faaliyetlerinden yeterli kâr elde ediyor mu, yoksa kâr geçici kalemlerden mi kaynaklanıyor?',
      ratios: [
        { id: 'grossMargin', name: 'Brüt Kâr Marjı', num: 'gross', den: 'sales', fmt: pct, up: true,
          def: 'Satılan malın maliyet gücünü ve fiyatlandırma başarısını gösteren temel marjdır.', ref: 'Sektör yapısına bağlı', status: sign },
        { id: 'operatingMargin', name: 'Faaliyet Kâr Marjı', num: 'ebit', den: 'sales', fmt: pct, up: true,
          def: 'Faaliyet giderleri düşüldükten sonra ana işten kalan marjdır; operasyonel kârlılığı ölçer.', ref: 'En kritik yönetim marjı', status: sign },
        { id: 'netMargin', name: 'Net Kâr Marjı', num: 'netIncome', den: 'sales', fmt: pct, up: true,
          def: 'Tüm giderler, finansman maliyetleri ve vergiler ödendikten sonra kalan nihai kâr marjıdır.', ref: 'Sürdürülebilir pozitif marj', status: v => (v < 0 ? 'bad' : null) },
        { id: 'roa', name: 'Aktif Kârlılık Oranı (ROA)', num: 'netIncome', den: 'assets', fmt: pct, up: true,
          def: 'Şirket yönetimine emanet edilen tüm varlıkların ne kadar kârlı yönetildiğini gösterir.', ref: '> Enflasyon / sermaye maliyeti', status: sign },
        { id: 'roe', name: 'Özkaynak Kârlılık Oranı (ROE)', num: 'netIncome', den: 'parentEquity', fmt: pct, up: true,
          def: 'Hissedarların koyduğu sermaye karşılığında elde edilen getiriyi ölçer; en temel performans metriğidir.', ref: '> Alternatif yatırım getirisi', status: sign }
      ]
    },
    {
      id: 'market', name: 'Piyasa', icon: 'fa-chart-pie', title: 'Piyasa Oranları',
      question: 'Şirket hissedarlar ve yatırımcılar için cazip bir yatırım fırsatı mı? Piyasa bu performansı nasıl fiyatlıyor?',
      ratios: [
        { id: 'pe', name: 'Fiyat / Kazanç Oranı (F/K)', num: 'price', den: 'eps', fmt: x, up: false, market: true,
          def: 'Piyasanın şirketin 1 TL\'lik net kârına karşılık kaç TL ödemeye razı olduğunu gösterir.', ref: 'Sektör çarpanı karşılaştırması' },
        { id: 'pb', name: 'Piyasa Değeri / Defter Değeri (PD/DD)', num: 'mcap', den: 'parentEquity', fmt: x, up: false, market: true,
          def: 'Şirketin borsadaki piyasa değerinin, muhasebe (özkaynak) değerinin kaç katı olduğunu gösterir.',
          ref: '> 1,0 (değer yaratan firma)', status: v => (v >= 1 ? 'good' : 'mid') },
        { id: 'eps', name: 'Hisse Başına Kâr (HBK)', num: 'netIncome', den: 'shares', fmt: v => `₺${nf2.format(v)}`, up: true,
          def: 'Şirketin çıkardığı her bir adet hisse senedine düşen net kâr payını gösterir.', ref: 'Yıllık büyüme trendi', status: sign }
      ]
    }
  ];

  const STATUS = {
    good: ['Referans aralığında', 'text-emerald-300 bg-emerald-950/40 border-emerald-800/50'],
    mid: ['Dikkat', 'text-amber-300 bg-amber-950/40 border-amber-800/50'],
    bad: ['Zayıf', 'text-rose-300 bg-rose-950/40 border-rose-800/50']
  };

  /* ---------- values ---------- */

  /** Market ratios need the price; everything else comes from Calc.healthRatios. */
  function valueOf(r, cur, price) {
    if (r.id === 'pe') return price && cur.eps > 0 ? price / cur.eps : null;
    if (r.id === 'pb') return price && cur.inputs.parentEquity > 0 ? price * cur.inputs.shares / cur.inputs.parentEquity : null;
    return cur[r.id];
  }

  function inputOf(key, cur, price) {
    if (key === 'days') return 365;
    if (key === 'price') return price;
    if (key === 'eps') return cur.eps;
    if (key === 'mcap') return price ? price * cur.inputs.shares : null;
    if (key === 'receivableTurnover' || key === 'inventoryTurnover') return cur[key];
    if (key === 'avgStock') return cur.inputs.avgStock ?? cur.inputs.stock;
    return cur.inputs[key];
  }

  function money(v) {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e9) return `${s}₺${nf2.format(a / 1e9)} Mlr`;
    if (a >= 1e6) return `${s}₺${nf1.format(a / 1e6)} Mn`;
    return `${s}₺${nf0.format(a)}`;
  }

  function inputText(key, cur, price) {
    const v = inputOf(key, cur, price);
    if (v == null || !Number.isFinite(v)) return '—';
    if (key === 'days') return '365';
    if (key === 'price' || key === 'eps') return `₺${nf2.format(v)}`;
    if (key === 'shares') return `${nf0.format(v / 1e6)} Mn adet`;
    if (key === 'receivableTurnover' || key === 'inventoryTurnover') return times(v);
    return money(v);
  }

  const fmtValue = (r, v) => (v === Infinity ? 'Faiz gideri yok' : v == null || !Number.isFinite(v) ? '—' : r.fmt(v));

  /* ---------- rendering ---------- */

  function fraction(r, cur, price) {
    const side = keys => {
      const list = Array.isArray(keys) ? keys : [keys];
      const label = list.map(k => (k === '−' ? '<span class="text-slate-500">−</span>' : term(k))).join(' ');
      const value = list.length === 1 ? inputText(list[0], cur, price)
        : list.filter(k => k !== '−').map(k => inputText(k, cur, price)).join(' − ');
      return `<div class="flex items-center justify-between gap-3"><span class="text-slate-300">${label}</span><span class="font-mono text-white whitespace-nowrap">${value}</span></div>`;
    };
    return `<div class="rounded-xl bg-[#070B14] border border-[#1A2540] px-3 py-2.5 text-[11px] space-y-1.5">
      ${side(r.num)}
      <div class="border-t border-slate-600"></div>
      ${side(r.den)}
    </div>`;
  }

  function trend(r, now, prev) {
    if (!Number.isFinite(now) || !Number.isFinite(prev) || now === prev) return '';
    const better = (now > prev) === r.up;
    return `<i class="fa-solid ${now > prev ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'} ${better ? 'text-emerald-400' : 'text-rose-400'}" title="${better ? 'Yıl sonuna göre iyileşme' : 'Yıl sonuna göre bozulma'}"></i>`;
  }

  function card(r, cur, fy, price, sector) {
    const v = valueOf(r, cur, price);
    const prev = fy && !r.market ? valueOf(r, fy, null) : null;
    const st = r.status && v != null && Number.isFinite(v) ? r.status(v) : r.id === 'interestCover' && v === Infinity ? 'good' : null;
    const badge = st ? `<span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${STATUS[st][1]}">${STATUS[st][0]}</span>` : '';
    const note = r.note && Number.isFinite(v) ? r.note(v) : '';
    let compare = '';
    if (r.market) {
      const m = sector && sectorMultiples?.sectors?.[sector];
      const med = r.id === 'pe' ? m?.pe : r.id === 'pb' ? m?.pb : null;
      if (med && Number.isFinite(v)) compare = `<span>Sektör medyanı (${esc(sector)}): <span class="font-mono text-white">${nf2.format(med)}</span></span><span class="font-mono ${v < med ? 'text-emerald-300' : 'text-amber-300'}">${v < med ? 'medyanın altında' : 'medyanın üstünde'}</span>`;
      else if (r.id === 'eps' && fy) compare = `<span>${esc(fy.period.split('/')[0])} yıl sonu: <span class="font-mono text-white">${fmtValue(r, fy.eps)}</span></span>${trend(r, v, fy.eps)}`;
    } else if (fy) {
      compare = `<span>${esc(fy.period.split('/')[0])} yıl sonu: <span class="font-mono text-white">${fmtValue(r, prev)}</span></span>${trend(r, v, prev)}`;
    }
    const why = v == null ? (r.market && !price ? 'Fiyat alınamadığı için hesaplanamadı.' : r.id === 'pe' && cur.eps <= 0 ? 'Şirket zarar ettiği için F/K anlamlı değildir.' : 'Paydası sıfır veya negatif olduğu için hesaplanamadı.') : '';
    return `
      <article class="utl-card p-5 flex flex-col gap-3">
        <div class="flex items-start justify-between gap-2">
          <h4 class="text-sm font-bold text-white flex items-center gap-1.5">${esc(r.name)}${tip(r.def, `${r.name} tanımı`)}</h4>
          ${badge}
        </div>
        <div class="text-2xl font-bold font-mono ${st === 'bad' ? 'text-rose-400' : st === 'mid' ? 'text-amber-300' : 'text-white'}">${fmtValue(r, v)}</div>
        ${why ? `<p class="text-[11px] text-slate-500">${why}</p>` : ''}
        ${fraction(r, cur, price)}
        <div class="text-[11px] text-slate-400"><span class="text-slate-500">İdeal / Referans:</span> ${esc(r.ref)}</div>
        ${note ? `<p class="text-[11px] text-amber-300/90">${esc(note)}</p>` : ''}
        ${compare ? `<div class="mt-auto pt-2.5 border-t border-[#162238] flex items-center justify-between gap-2 text-[11px] text-slate-400">${compare}</div>` : ''}
      </article>`;
  }

  function summary(g, cur, price) {
    const rated = g.ratios.map(r => {
      const v = valueOf(r, cur, price);
      return r.status && v != null && Number.isFinite(v) ? r.status(v) : r.id === 'interestCover' && v === Infinity ? 'good' : null;
    }).filter(Boolean);
    if (!rated.length) return '';
    const good = rated.filter(s => s === 'good').length;
    return `<span class="text-[11px] font-mono text-slate-400">Referansı olan ${rated.length} oranın <span class="text-emerald-300 font-bold">${good}</span> tanesi referans aralığında</span>`;
  }

  function message(text, tone = 'text-slate-500') {
    const box = document.getElementById('finHealthBody');
    if (box) box.innerHTML = `<div class="utl-card py-12 px-6 text-center text-sm font-mono ${tone}">${esc(text)}</div>`;
    const head = document.getElementById('finHealthPeriod');
    if (head) head.textContent = '';
  }

  function paintTabs() {
    const box = document.getElementById('finHealthTabs');
    if (!box) return;
    box.innerHTML = GROUPS.map((g, i) => {
      const on = g.id === group;
      return `<button type="button" data-fh-group="${g.id}" class="flex-shrink-0 px-3.5 py-2 rounded-xl text-xs font-mono flex items-center gap-2 transition-all ${on ? 'bg-[#2F6BFF] text-white font-semibold shadow-md' : 'bg-[#070B14] text-slate-400 hover:text-white border border-[#1A2540]'}">
        <span class="${on ? 'text-white/70' : 'text-slate-600'}">${i + 1}.</span><i class="fa-solid ${g.icon} text-[11px]"></i><span>${g.name}</span></button>`;
    }).join('');
  }

  function render() {
    const box = document.getElementById('finHealthBody');
    if (!box || !window.Statements) return;
    paintTabs();
    const fin = typeof appState !== 'undefined' ? appState.currentCompanyData : null;
    const st = Statements.state;
    if (!fin || st.code !== fin.code || st.status === 'loading' || st.status === 'idle') return message('Finansal tablolar yükleniyor...');
    if (st.status !== 'ready' || !st.data) return message('Bu şirket için bilanço verisi bulunamadığından oran analizi yapılamıyor.', 'text-amber-400');
    const d = st.data;
    if (d.kind !== 'industrial') {
      return message('Bu oranlar sanayi ve ticaret şirketleri için tanımlıdır. Bankalar ve sigorta şirketleri farklı bir bilanço yapısı kullandığından (dönen/duran varlık, stok ve satış kalemleri yoktur) bu analiz uygulanmaz.', 'text-amber-400');
    }

    const cur = Calc.healthRatios(d, 0);
    const fyIdx = d.periods.findIndex((p, i) => i > 0 && p.endsWith('/12'));
    const fy = fyIdx > 0 ? Calc.healthRatios(d, fyIdx) : null;
    const price = fin.liveTime && Number.isFinite(fin.priceNum) ? fin.priceNum : null;
    const sector = typeof getRawCompany === 'function' ? getRawCompany(fin.code)?.sec : null;

    const head = document.getElementById('finHealthPeriod');
    if (head) head.textContent = `${cur.period} bilançosu${cur.ttm ? ' · gelir tablosu kalemleri son 12 ay' : ''} · ${d.basis || ''}`;

    const g = GROUPS.find(x => x.id === group) || GROUPS[0];
    const no = GROUPS.indexOf(g) + 1;
    box.innerHTML = `
      <div class="utl-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="space-y-1">
          <h3 class="font-serif font-bold text-white text-lg">${no}. Grup: ${esc(g.title)}</h3>
          <p class="text-xs text-slate-400 leading-relaxed">${esc(g.question)}</p>
        </div>
        ${summary(g, cur, price)}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        ${g.ratios.map(r => card(r, cur, fy, price, sector)).join('')}
      </div>`;
  }

  function init() {
    const tabs = document.getElementById('finHealthTabs');
    if (tabs) {
      tabs.addEventListener('click', e => {
        const b = e.target.closest('[data-fh-group]');
        if (!b) return;
        group = b.getAttribute('data-fh-group');
        render();
      });
    }
    // A definition box next to a term near the screen edge is shifted back inside the viewport
    const place = e => {
      const t = e.target.closest?.('.fh-tip');
      const b = t && t.querySelector('.fh-tip-box');
      if (!b) return;
      b.style.transform = 'translateX(-50%)';
      requestAnimationFrame(() => {
        const r = b.getBoundingClientRect();
        const shift = r.left < 8 ? 8 - r.left : r.right > innerWidth - 8 ? innerWidth - 8 - r.right : 0;
        if (shift) b.style.transform = `translateX(calc(-50% + ${shift}px))`;
      });
    };
    document.addEventListener('mouseover', place);
    document.addEventListener('focusin', place);
    fetch('/assets/data/sector-multiples.json').then(r => (r.ok ? r.json() : null)).then(j => { sectorMultiples = j; }).catch(() => {});
  }

  return { init, render, GROUPS, TERMS };
})();

window.FinHealth = FinHealth;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', FinHealth.init);
else FinHealth.init();
