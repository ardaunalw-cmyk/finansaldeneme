/**
 * Şirket "Hakkında" özetleri ve gerçek logo alan adları.
 *  - STOCK_ABOUT: öne çıkan şirketler için elle yazılmış kısa özet.
 *  - Diğer şirketler için sektör ve KAP verisinden (unvan, sermaye, denetçi) özet üretilir.
 *  - STOCK_LOGO_DOMAINS: logo, şirketin web sitesinin simgesinden yüklenir; yüklenemezse rozet kalır.
 */

const STOCK_LOGO_DOMAINS = {
  THYAO: 'turkishairlines.com', EREGL: 'erdemir.com.tr', BIMAS: 'bim.com.tr', TUPRS: 'tupras.com.tr',
  ASELS: 'aselsan.com', GARAN: 'garantibbva.com.tr', AKBNK: 'akbank.com', KCHOL: 'koc.com.tr',
  SISE: 'sisecam.com', SASA: 'sasa.com.tr', FROTO: 'fordotosan.com.tr', EKGYO: 'emlakkonut.com.tr',
  PETKM: 'petkim.com.tr', ASTOR: 'astor.com.tr', KONTR: 'kontrolmatik.com', MIATK: 'miateknoloji.com',
  ALARK: 'alarko.com.tr', MGROS: 'migroskurumsal.com', PGSUS: 'flypgs.com', ISCTR: 'isbank.com.tr',
  YKBNK: 'yapikredi.com.tr', VAKBN: 'vakifbank.com.tr', HALKB: 'halkbank.com.tr', TCELL: 'turkcell.com.tr',
  TTKOM: 'turktelekom.com.tr', ENKAI: 'enka.com', ARCLK: 'arcelik.com.tr', TOASO: 'tofas.com.tr',
  OYAKC: 'oyakcimento.com', BRISA: 'brisa.com.tr', SAHOL: 'sabanci.com', KRDMD: 'kardemir.com',
  ULKER: 'ulker.com.tr', TAVHL: 'tavhavalimanlari.com.tr', SMRTG: 'smartsolar.com.tr', EUPWR: 'europower.com.tr',
  CWENE: 'cwenerji.com.tr', DOHOL: 'doganholding.com.tr', AEFES: 'anadoluefes.com', CCOLA: 'cci.com.tr',
  VESTL: 'vestel.com', TKFEN: 'tekfen.com.tr', KOZAL: 'kozaaltin.com.tr', ENJSA: 'enerjisa.com',
  AKSEN: 'aksaenerji.com.tr', ODAS: 'odasenerji.com', GUBRF: 'gubretas.com.tr', HEKTS: 'hektas.com.tr',
  SOKM: 'www.sokmarket.com.tr', TTRAK: 'turktraktor.com.tr', DOAS: 'dogusotomotiv.com.tr', OTKAR: 'otokar.com.tr',
  LOGO: 'www.logo.com.tr', MAVI: 'mavi.com', TRKCM: 'sisecam.com', AKSA: 'aksa.com', CIMSA: 'cimsa.com.tr',
  // Bankalar ve finans
  TSKB: 'tskb.com.tr', SKBNK: 'sekerbank.com.tr', ALBRK: 'albaraka.com.tr', ICBCT: 'icbc.com.tr',
  QNBTR: 'qnb.com.tr', ODEA: 'odeabank.com.tr', TEBNK: 'teb.com.tr', ANHYT: 'anadolusigorta.com.tr',
  TURSG: 'turkiyesigorta.com.tr', AKGRT: 'aksigorta.com.tr', ANSGR: 'anadolusigorta.com.tr', QUICK: 'quicksigorta.com',
  HALKF: 'halkleasing.com.tr', 
  // Holdingler
  
  FBHOL: 'www.fibaholding.com.tr', DGHOL: 'dogusgrubu.com.tr', AKFEN: 'akfen.com.tr', RNHOL: 'ronesans.com',
  NRHOL: 'nurolholding.com.tr', POLHO: 'polisanholding.com', 
  GSDHO: 'gsdholding.com.tr', 
  // Enerji
  ZOREN: 'zorlu.com.tr', AKENR: 'akenerji.com.tr', AYDEM: 'aydem.com.tr', EEDAS: 'enerjisa.com',
  CLKEN: 'calik.com', GWIND: 'galatawind.com.tr', ODAS: 'odasenerji.com', HUNER: 'hunenerji.com',
  AYTMZ: 'aytemiz.com.tr', PTOFS: 'petrolofisi.com.tr', SHTRP: 'shell.com.tr', 
  // PETKM, TUPRS yukarıda
  // Sanayi, demir-çelik, çimento
  KRDMA: 'kardemir.com', KRDMB: 'kardemir.com',
  ANACM: 'sisecam.com', CMSAN: 'camsan.com.tr', CEMAS: 'cemas.com.tr', BUCIM: 'bursacimento.com.tr',
  SODA: 'sisecam.com', BSHEV: 'bsh-group.com', 
  KARSN: 'karsan.com.tr', KATMR: 'katmerciler.com.tr', OTOSR: 'otosor.com.tr', SZUKI: 'suzuki.com.tr',
  TKNKA: 'teknikaplast.com', 
  // Gıda, perakende, tekstil
  KOTON: 'koton.com', BOYP: 'beymen.com', EBEBK: 'ebebek.com', DARDL: 'www.dardanel.com.tr',
  BESLR: 'beslergida.com', KERVN: 'kervansaray.com.tr', 
  KSEKR: 'konyaseker.com.tr', PASTA: 'pastavilla.com.tr',
  OBAMS: 'obamakarna.com', DIMES: 'dimes.com.tr', BYDNR: 'baydoner.com', ECILC: 'eczacibasi.com.tr',
  SELEC: 'selcukecza.com.tr', NOBEL: 'nobel.com.tr', 
  // Medya, spor, sağlık
  GSRAY: 'galatasaray.org', HURGZ: 'hurriyet.com.tr', SABAH: 'sabah.com.tr', ACIBD: 'acibadem.com.tr',
  DNYGZ: 'dunyagoz.com',
  // Gayrimenkul
  ZRGYO: 'ziraatgyo.com.tr', ISGYO: 'isgyo.com.tr', HLGYO: 'halkgyo.com.tr',
  VKGYO: 'vakifgyo.com.tr', TRGYO: 'torunlargyo.com.tr', PSGYO: 'pasifikgyo.com.tr', AKFGY: 'akfengyo.com.tr',
  SNGYO: 'sinpas.com.tr', TSGYO: 'tskbgyo.com.tr',
  // İnşaat, teknoloji, diğer
  TURKR: 'turkerler.com.tr', ENPRA: 'enpara.com',
  HTTBT: 'hititcs.com', ODINE: 'odine.com.tr',
  SDTTR: 'sdt.com.tr', ALTNY: 'altinay.com', 
};


/**
 * Some companies are listed under a KAP internal code first (for example ISATR for Is Bankasi),
 * while prices and statements are published under the trading ticker (ISCTR). Maps the former to the latter.
 */
const TICKER_ALIASES = {
  ISATR: 'ISCTR', YKB: 'YKBNK', TVB: 'VAKBN', SEK: 'SKBNK', TSK: 'TSKB', ICB: 'ICBCT', KLN: 'KLNMA', FIN: 'QNBTR',
  GLB: 'GLBMD', OMD: 'OSMEN', OYA: 'OYYAT', SKY: 'SKYMD'
};
function tradingCode(code) {
  const c = String(code || '').toUpperCase();
  return TICKER_ALIASES[c] || c;
}
window.tradingCode = tradingCode;
const STOCK_ABOUT = {
  THYAO: 'Türkiye\'nin bayrak taşıyıcı havayolu şirketidir. İstanbul Havalimanı\'ndaki ana üssünden dünyanın en geniş uçuş ağlarından birini işletir; yolcu taşımacılığının yanında kargo (Turkish Cargo), uçak bakım (Turkish Technic) ve yer hizmetleri gibi iştirakleri vardır.',
  EREGL: 'Türkiye\'nin en büyük yassı çelik üreticisidir. Sıcak ve soğuk haddelenmiş sac, kaplamalı ürünler ve teneke üretir; İskenderun Demir Çelik de grubun bağlı ortaklığıdır. Otomotiv, beyaz eşya ve inşaat sektörlerine hammadde sağlar.',
  BIMAS: 'Türkiye\'nin en yaygın indirimli market zincirlerinden biridir. Sınırlı ürün çeşidi ve düşük fiyat modeliyle binlerce mağazada gıda ve günlük tüketim ürünü satar; Fas ve Mısır\'da da faaliyet gösterir.',
  TUPRS: 'Türkiye\'nin en büyük petrol rafinerisi işletmecisidir. Kocaeli, İzmir, Kırıkkale ve Batman rafinerilerinde benzin, motorin, jet yakıtı ve petrokimya girdileri üretir. Koç Holding grubundadır.',
  ASELS: 'Türkiye\'nin en büyük savunma elektroniği şirketidir. Radar, elektronik harp, haberleşme, elektro-optik ve komuta kontrol sistemleri geliştirir; ürünlerini Türk Silahlı Kuvvetleri ile ihracat müşterilerine sunar.',
  GARAN: 'Türkiye\'nin önde gelen özel bankalarındandır; BBVA grubunun çoğunluk ortağı olduğu Garanti BBVA, bireysel, ticari ve kurumsal bankacılığın yanı sıra emeklilik, leasing ve faktoring hizmetleri sunar.',
  AKBNK: 'Sabancı Holding iştiraki olan özel bankadır. Bireysel, KOBİ, ticari ve kurumsal bankacılık hizmetleri verir; dijital bankacılık ve geniş şube ağıyla öne çıkar.',
  KCHOL: 'Türkiye\'nin en büyük sanayi ve hizmet holdingidir. Enerji (Tüpraş), otomotiv (Ford Otosan, Tofaş), dayanıklı tüketim (Arçelik) ve finans (Yapı Kredi) alanlarındaki iştiraklerini yönetir.',
  SISE: 'Cam alanında dünyanın önde gelen üreticilerinden biridir. Düz cam, cam ev eşyası, cam ambalaj ve soda gibi kimyasallar üretir; birçok ülkede tesisi vardır. İş Bankası iştirakidir.',
  SASA: 'Polyester elyaf ve iplik hammaddeleri (PTA, MEG) üreten kimya şirketidir. Adana\'daki entegre tesislerinde tekstil, ambalaj ve plastik sanayine girdi sağlar.',
  FROTO: 'Koç Holding ve Ford ortaklığındaki otomotiv üreticisidir. Ford\'un Avrupa\'daki ticari araç ailesini (Transit, Custom) üretir; Kocaeli ve Eskişehir tesisleriyle Türkiye\'nin en büyük otomotiv ihracatçılarındandır.',
  EKGYO: 'Konut ve karma kullanımlı projeler geliştiren gayrimenkul yatırım ortaklığıdır. TOKİ ile iş birliği içinde arsa payı karşılığı projeler yürütür; bu projeleri satarak gelir elde eder.',
  PETKM: 'Türkiye\'nin tek entegre petrokimya üreticisidir. Aliağa\'daki tesislerinde plastik, elyaf ve kimya sanayinin kullandığı polietilen, PVC, PTA gibi temel petrokimyasalları üretir. SOCAR Türkiye grubundadır.',
  ASTOR: 'Enerji iletim ve dağıtımında kullanılan transformatör, şalt ve enerji depolama ekipmanları üretir. Ürünlerinin büyük bölümünü yurt dışına ihraç eden bir enerji teknolojileri şirketidir.',
  KONTR: 'Enerji depolama, enerji iletimi ve otomasyon alanlarında teknoloji çözümleri geliştiren şirkettir. Yenilenebilir enerji ve akıllı şebeke projeleri için sistem ve batarya çözümleri sunar.',
  MIATK: 'Yazılım ve bilişim teknolojileri şirketidir. Kamu ve özel sektör için güvenlik, kimlik doğrulama ve veri tabanlı çözümler geliştirir.',
  ALARK: 'Enerji, taahhüt (inşaat), sanayi ve turizm alanlarında faaliyet gösteren holdingdir. Elektrik üretimi, altyapı projeleri ve otoyol/havalimanı gibi imtiyaz yatırımlarında yer alır.',
  MGROS: 'Türkiye\'nin köklü süpermarket zinciridir. Migros, Macro Center ve 5M gibi mağaza formatları ile Migros Sanal Market üzerinden gıda ve günlük tüketim ürünleri satar.',
  PGSUS: 'Düşük maliyetli havayolu şirketidir. Sabiha Gökçen Havalimanı merkezli olarak yurt içi ve yurt dışı hatlarda uygun fiyatlı tarifeli uçuşlar düzenler.',
  ISCTR: 'Türkiye\'nin en büyük özel mevduat bankalarından biridir. Bireysel, ticari ve kurumsal bankacılığın yanı sıra iştirakleri aracılığıyla sigorta, yatırım ve sanayi alanlarında da faaliyet gösterir.',
  YKBNK: 'Koç Holding ve UniCredit ortaklığındaki özel bankadır. Bireysel, KOBİ ve kurumsal bankacılık ile kredi kartı (World) ve sigorta, leasing gibi finansal hizmetler sunar.',
  VAKBN: 'Kamu ortaklı büyük bir mevduat bankasıdır. Bireysel, ticari ve kurumsal bankacılık hizmetleri verir; geniş şube ağı ve yurt dışı iştirakleri vardır.',
  HALKB: 'Kamu sermayeli bankadır. Esnaf, sanatkâr ve KOBİ finansmanında geleneksel olarak güçlüdür; bireysel ve kurumsal bankacılık hizmetleri de sunar.',
  TCELL: 'Türkiye\'nin lider mobil haberleşme operatörüdür. Mobil ve sabit internet, TV ve dijital hizmetlerin yanı sıra veri merkezi, bulut ve fintek çözümleri sunar; çeşitli ülkelerde iştirakleri vardır.',
  TTKOM: 'Türkiye\'nin köklü bütünleşik telekomünikasyon şirketidir. Sabit telefon, fiber internet, mobil hizmetler (Türk Telekom Mobil) ve kurumsal bilişim çözümleri sağlar.',
  ENKAI: 'Türkiye\'nin en büyük müteahhitlik şirketlerindendir. Dünya genelinde altyapı, enerji santrali ve büyük bina projeleri üstlenir; ayrıca elektrik üretimi ve gayrimenkul alanlarında faaliyet gösterir.',
  ARCLK: 'Koç Holding iştiraki olan beyaz eşya ve ev elektroniği üreticisidir. Arçelik, Beko, Grundig gibi markalarla buzdolabı, çamaşır makinesi ve küçük ev aletleri satar; dünyanın birçok ülkesinde üretim yapar.',
  TOASO: 'Koç Holding ve Stellantis ortaklığındaki otomotiv üreticisidir. Bursa tesislerinde Fiat markalı hafif ticari araçlar ve binek modeller üretir; üretiminin önemli bölümünü ihraç eder.',
  OYAKC: 'Çimento ve hazır beton üreticisidir. Türkiye\'de birçok bölgedeki fabrikalarıyla inşaat sektörünü besler. OYAK grubuna bağlıdır.',
  BRISA: 'Bridgestone ve Sabancı ortaklığındaki lastik üreticisidir. Binek, hafif ticari ve ağır vasıta lastikleri üretir; Bridgestone, Lassa gibi markaları satar.',
  SAHOL: 'Sabancı Holding; bankacılık ve sigorta, enerji, çimento, perakende ve sanayi alanlarında faaliyet gösteren büyük bir holdingdir. Akbank, Enerjisa gibi şirketleri bünyesinde barındırır.',
  KRDMD: 'Karabük\'te kurulu, entegre çelik üreten sanayi şirketidir. Kütük, profil, ray ve inşaat çelikleri gibi uzun çelik ürünler üretir. İnşaat ve demiryolu sektörlerine hizmet verir.',
  ULKER: 'Bisküvi, çikolata, gofret ve bisküvi türevi atıştırmalıklar üreten gıda şirketidir. Ülker markası Türkiye\'de ve birçok ülkede satılır.',
  TAVHL: 'Havalimanı işletmeciliği yapan şirkettir. Türkiye ve yurt dışında birçok havalimanını işletir; terminal yönetimi, duty free, yer hizmetleri ve güvenlik hizmetleri sunar.',
  SMRTG: 'Güneş enerjisi sistemleri için panel ve ilgili ekipmanları üreten şirkettir. Yenilenebilir enerji projelerinin kurulum ve mühendislik hizmetlerini de yürütür.',
  EUPWR: 'Enerji ve otomasyon sektöründe ekipman üreten şirkettir. Elektrik dağıtım panoları ve ilgili sistem çözümleri geliştirir.',
  CWENE: 'Güneş enerjisi santralleri için proje geliştirme, kurulum ve elektrik üretimi yapan yenilenebilir enerji şirketidir.',
  DOHOL: 'Doğan Holding; enerji, sigorta, sanayi, perakende ve medya alanlarında yatırımları olan holdingdir. İştirakleriyle farklı sektörlerde faaliyet gösterir.',
  AEFES: 'Bira ve alkolsüz içecek üretimi ve dağıtımı yapan şirkettir. Efes markası ile Türkiye ve çevre ülkelerde faaliyet gösterir; Coca-Cola İçecek\'te de ortaklığı vardır.',
  CCOLA: 'Coca-Cola ürünlerinin şişeleme ve dağıtımını yapan içecek şirketidir. Türkiye\'nin yanı sıra Orta Asya ve Orta Doğu ülkelerinde de faaliyet gösterir.',
  VESTL: 'Televizyon, beyaz eşya ve diğer tüketici elektroniği üreten şirkettir. Manisa\'daki entegre tesislerinde üretim yapar ve ürünlerini Avrupa dahil birçok ülkeye ihraç eder.',
  TKFEN: 'Taahhüt, tarım ve gübre alanlarında faaliyet gösteren holdingdir. Enerji ve altyapı projeleri yürütür; ayrıca gübre ve tarım ürünleri ticareti yapar.',
  KOZAL: 'Madencilik şirketidir. Türkiye\'de altın madenciliği yapar; altın ve gümüş üretimi gelirinin ana kaynağıdır.',
  ENJSA: 'Elektrik dağıtımı ve perakende satışı yapan şirkettir. Türkiye\'nin çeşitli bölgelerinde dağıtım şebekesini işletir; müşterilerine elektrik satar.',
  AKSEN: 'Elektrik üretimi yapan enerji şirketidir. Türkiye\'de ve yurt dışında doğal gaz ve diğer kaynaklarla çalışan santralleri vardır.',
  ODAS: 'Elektrik üretim ve ticareti yapan enerji şirketidir. Yerli kömür, doğal gaz ve yenilenebilir kaynaklarla çalışan santralleri işletir.',
  GUBRF: 'Tarım için gübre üreten şirkettir. Azotlu ve kompoze gübrelerin yanı sıra tarımsal kimyasallar sunar; çiftçilerin gübre ihtiyacını karşılar.',
  HEKTS: 'Tarım ilaçları ve bitki besleme ürünleri üreten şirkettir. Zirai ilaç, tohum ve ilgili ürünleri çiftçilere sunar.',
  SOKM: 'Şok Marketler; Türkiye genelinde yaygın mağazalarla gıda ve günlük tüketim ürünleri satan perakende zinciridir.',
  TTRAK: 'Türkiye\'nin önde gelen traktör üreticisidir. Tarımsal mekanizasyon için traktör üretir ve satar; ürünlerini yurt içinde ve ihracat pazarlarında satar.',
  DOAS: 'Otomotiv ticareti ve satış sonrası hizmetler yapan şirkettir. Birçok markanın Türkiye distribütörlüğünü ve yetkili satış-servis ağını yönetir.',
  OTKAR: 'Otobüs, askeri ve taktik araçlar ile ticari araç üreten şirkettir. Otokar markalı araçlar Türkiye\'de ve yurt dışında kullanılmaktadır.',
  LOGO: 'İşletmeler için yazılım üreten teknoloji şirketidir. Muhasebe, ERP, bordro gibi kurumsal yazılımlar ile dijital dönüşüm hizmetleri sunar.',
  MAVI: 'Hazır giyim ve özellikle kot (denim) alanında faaliyet gösteren şirkettir. Mavi markasıyla Türkiye\'de ve birçok ülkede mağaza ve çevrim içi satış yapar.',
  TRKCM: 'Cam üretimi yapan şirkettir. Düz cam ve ilgili ürünleri üreterek inşaat ve otomotiv sektörlerine sağlar. Şişecam grubunun bir parçasıdır.',
  AKSA: 'Akrilik elyaf üreten kimya şirketidir. Tekstil sanayinde kullanılan akrilik elyaf ve ilgili ürünleri dünya pazarlarına satar.',
  CIMSA: 'Çimento ve beyaz çimento üreticisidir. Türkiye ve yurt dışı pazarlarına çeşitli çimento ve yapı malzemeleri satar.'
};

/* Whole-word-prefix match so short stems ("et", "un") cannot fire inside other words ("ticaret"). */
const aboutWords = list => new RegExp(`(^|[\\s,&(/-])(${list})`, 'u');

const SECTOR_ABOUT_RULES = [
  { match: aboutWords('varlık kiralama'), text: 'kira sertifikası (sukuk) ihracı için kurulmuş bir varlık kiralama şirketidir' },
  { match: aboutWords('faktoring'), text: 'işletmelerin alacaklarını satın alarak finansman sağlayan bir faktoring şirketidir' },
  { match: aboutWords('finansal kiralama|leasing'), text: 'finansal kiralama (leasing) hizmeti veren bir finans şirketidir' },
  { match: aboutWords('sigorta|emeklilik'), text: 'sigorta ve emeklilik ürünleri sunan bir finans şirketidir' },
  { match: aboutWords('menkul değerler|yatırım menkul'), text: 'sermaye piyasası aracılık hizmetleri veren bir aracı kurumdur' },
  { match: aboutWords('bankası|bank'), text: 'mevduat, kredi ve ödeme hizmetleri sunan bir bankadır' },
  { match: aboutWords('gayrimenkul yatırım ortaklığı|gyo'), text: 'arsa, bina ve konut/ticari proje portföyünü yöneten bir gayrimenkul yatırım ortaklığıdır' },
  { match: aboutWords('portföy yönetimi|yatırım ortaklığı'), text: 'fon ve portföy yönetimi alanında faaliyet gösteren bir şirkettir' },
  { match: aboutWords('holding'), text: 'farklı sektörlerdeki iştirak ve bağlı ortaklıkları yöneten bir holding şirketidir' },
  { match: aboutWords('elektromekanik|makina|makine'), text: 'makine ile elektrik/elektromekanik ekipman üretimi ve satışı yapar' },
  { match: aboutWords('enerji|elektrik|petrol|doğalgaz|doğal gaz'), text: 'enerji üretimi, ticareti veya altyapısı alanında faaliyet gösterir' },
  { match: aboutWords('gıda|yem|süt|et|un|şeker|bisküvi|çay|tavuk|meşrubat|içecek|yağ|bakliyat|tarım|hayvancılık'), text: 'gıda, tarım ve içecek ürünleri üretimi ve satışıyla uğraşır' },
  { match: aboutWords('tekstil|konfeksiyon|iplik|dokuma|giyim|kadife|halı'), text: 'tekstil, iplik veya hazır giyim üretimi yapar' },
  { match: aboutWords('çimento|beton|yapı|inşaat|taahhüt'), text: 'yapı malzemesi üretimi veya inşaat/taahhüt işleriyle uğraşır' },
  { match: aboutWords('otomotiv|oto|lastik|yedek parça|araç'), text: 'otomotiv veya otomotiv yan sanayi ürünleri üretir ve satar' },
  { match: aboutWords('ilaç|sağlık|hastane|tıbbi|medikal'), text: 'ilaç, sağlık hizmetleri veya tıbbi ürün alanında faaliyet gösterir' },
  { match: aboutWords('turizm|otel'), text: 'turizm ve otelcilik hizmetleri sunar' },
  { match: aboutWords('madenc|maden'), text: 'madencilik ve doğal kaynak işletmeciliği yapar' },
  { match: aboutWords('telekom|bilişim|yazılım|teknoloji|elektronik|savunma'), text: 'teknoloji, yazılım veya elektronik/savunma sistemleri alanında faaliyet gösterir' },
  { match: aboutWords('ulaştırma|havacılık|lojistik|denizcilik|taşımacılık'), text: 'ulaştırma, lojistik veya taşımacılık hizmetleri verir' },
  { match: aboutWords('cam|seramik|porselen'), text: 'cam, seramik veya benzeri ürünler üretir' },
  { match: aboutWords('demir|çelik|metal|alüminyum|döküm'), text: 'demir-çelik veya metal ürünleri üretir ve işler' },
  { match: aboutWords('kağıt|selüloz|karton|ambalaj'), text: 'kağıt, selüloz ve ambalaj ürünleri üretir' },
  { match: aboutWords('kimya|plastik|boya|gübre'), text: 'kimya, plastik veya benzeri malzeme üretir' },
  { match: aboutWords('perakende|mağaza|market'), text: 'perakende ve mağazacılık faaliyetleri yürütür' }
];
const SECTOR_ABOUT_DEFAULT = {
  'finans': 'finans ve sermaye piyasası alanında hizmet sunar',
  'enerji': 'enerji üretimi, ticareti veya altyapısı alanında faaliyet gösterir',
  'gıda': 'gıda ve tarım ürünleri üretimi ile satışıyla ilgilenir',
  'gayrimenkul': 'gayrimenkul projeleri ve portföyünü yönetir',
  'holding': 'farklı sektörlerdeki iştiraklerini yöneten bir holding şirketidir',
  'savunma': 'savunma ve ileri teknoloji alanında ürün ve hizmet geliştirir',
  'tekstil': 'tekstil ve hazır giyim üretimi yapar',
  'çimento': 'çimento ve yapı malzemeleri üretir',
  'turizm': 'turizm ve otelcilik hizmetleri sunar',
  'otomotiv': 'otomotiv ve yan sanayi ürünleri üretir',
  'sağlık': 'sağlık ve ilaç sektöründe faaliyet gösterir',
  'kimya': 'kimya ve gübre ürünleri üretir',
  'perakende': 'perakende ve tüketici ürünleri satışı yapar',
  'madencilik': 'madencilik ve doğal kaynak işletmeciliği yapar',
  'cam': 'cam ve seramik ürünleri üretir',
  'telekom': 'telekomünikasyon ve bilişim hizmetleri sunar',
  'ulaştırma': 'ulaştırma ve havacılık hizmetleri verir',
  'demir': 'demir-çelik ve metal ürünleri üretir',
  'sanayi': 'çeşitli sanayi ürünlerinin üretimi ve ticaretiyle uğraşır'
};

let stockAboutIndex = null;
function getAboutRawCompany(code) {
  if (!stockAboutIndex) {
    stockAboutIndex = new Map();
    const list = (typeof KAP_RAW_COMPANIES !== 'undefined' && Array.isArray(KAP_RAW_COMPANIES)) ? KAP_RAW_COMPANIES : [];
    list.forEach(c => {
      const primary = (c.c || '').split(',')[0].trim().toUpperCase();
      if (primary && !stockAboutIndex.has(primary)) stockAboutIndex.set(primary, c);
    });
  }
  return stockAboutIndex.get(code) || null;
}

function trTitleCase(str) {
  return (str || '').toLocaleLowerCase('tr-TR').replace(/(^|[\s(\-/.])(\p{L})/gu, (m, p, ch) => p + ch.toLocaleUpperCase('tr-TR'))
    .replace(/\bA\.ş\./g, 'A.Ş.').replace(/\bGyo\b/g, 'GYO');
}

function getStockAbout(ticker) {
  const code = (ticker || '').toUpperCase().trim();
  const raw = getAboutRawCompany(code);
  const fullName = raw ? raw.n : code;
  const sector = raw && raw.sec ? raw.sec : '';
  const result = {
    code,
    name: trTitleCase(fullName),
    sector,
    capital: raw ? raw.cap : '',
    auditor: raw && raw.aud ? trTitleCase(raw.aud) : '',
    generated: false,
    text: ''
  };

  if (STOCK_ABOUT[code]) {
    result.text = STOCK_ABOUT[code];
    return result;
  }

  const hay = `${fullName} ${sector}`.toLocaleLowerCase('tr-TR') + ' ';
  let phrase = '';
  for (const rule of SECTOR_ABOUT_RULES) {
    if (rule.match.test(hay)) { phrase = rule.text; break; }
  }
  if (!phrase) {
    const sec = sector.toLocaleLowerCase('tr-TR');
    for (const key of Object.keys(SECTOR_ABOUT_DEFAULT)) {
      if (sec.includes(key)) { phrase = SECTOR_ABOUT_DEFAULT[key]; break; }
    }
  }
  if (!phrase) phrase = 'Borsa İstanbul\'da işlem gören bir şirkettir';

  const parts = [`${result.name}, ${phrase}.`];
  if (sector) parts.push(`KAP\'ta "${sector}" sektörü altında yer alır.`);
  if (result.capital) parts.push(`Ödenmiş sermayesi ${result.capital} düzeyindedir.`);
  result.text = parts.join(' ');
  result.generated = true;
  return result;
}

function escapeAboutHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function renderStockAboutMeta(about) {
  const chips = [];
  if (about.sector) chips.push(`<span>${escapeAboutHtml(about.sector)}</span>`);
  if (about.capital) chips.push(`<span>Ödenmiş sermaye: ${escapeAboutHtml(about.capital)}</span>`);
  if (about.auditor) chips.push(`<span>Denetçi: ${escapeAboutHtml(about.auditor)}</span>`);
  return chips.join('');
}

function fillStockDetailAbout(ticker) {
  const textEl = document.getElementById('stockDetailAboutText');
  const metaEl = document.getElementById('stockDetailAboutMeta');
  if (!textEl) return;
  const about = getStockAbout(ticker);
  textEl.textContent = about.text;
  if (metaEl) metaEl.innerHTML = renderStockAboutMeta(about);
}

function closeStockAbout() {
  const el = document.getElementById('stockAboutModal');
  if (el) el.remove();
  document.removeEventListener('keydown', closeStockAboutOnEsc);
}
function closeStockAboutOnEsc(e) {
  if (e.key === 'Escape') closeStockAbout();
}

function openStockAbout(ticker) {
  closeStockAbout();
  const about = getStockAbout(ticker);
  const logo = typeof getStockLogoHtml === 'function' ? getStockLogoHtml(about.code, 44) : '';
  const overlay = document.createElement('div');
  overlay.id = 'stockAboutModal';
  overlay.className = 'stock-about-modal-backdrop';
  overlay.innerHTML = `
    <div class="stock-about-modal" role="dialog" aria-modal="true" aria-label="${escapeAboutHtml(about.name)} hakkında">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div class="flex items-center gap-3 min-w-0">
          ${logo}
          <div class="min-w-0">
            <div class="font-serif font-bold text-white text-base leading-tight">${escapeAboutHtml(about.name)}</div>
            <div class="font-mono text-[11px] text-slate-400 mt-0.5">${escapeAboutHtml(about.code)}</div>
          </div>
        </div>
        <button type="button" class="menu-toggle-btn flex-shrink-0" data-about-close aria-label="Kapat"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="stock-about-title"><i class="fa-solid fa-circle-info"></i> Hakkında</div>
      <p class="stock-about-text">${escapeAboutHtml(about.text)}</p>
      <div class="stock-about-meta">${renderStockAboutMeta(about)}</div>
      ${about.generated ? '<div class="stock-about-note">Bu özet, sektör ve KAP kayıtlarındaki verilerden otomatik oluşturulmuştur.</div>' : ''}
      <div class="mt-5">
        <button type="button" data-about-detail class="navy-btn px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2">
          <i class="fa-solid fa-chart-line text-red-400"></i><span>Hisse analizini aç</span>
        </button>
      </div>
    </div>`;
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-about-close]')) closeStockAbout();
    else if (e.target.closest('[data-about-detail]')) {
      closeStockAbout();
      if (typeof switchView === 'function') switchView('stock-detail', about.code);
    }
  });
  document.body.appendChild(overlay);
  document.addEventListener('keydown', closeStockAboutOnEsc);
}

window.getStockAbout = getStockAbout;
window.openStockAbout = openStockAbout;
window.fillStockDetailAbout = fillStockDetailAbout;
window.STOCK_LOGO_DOMAINS = STOCK_LOGO_DOMAINS;
