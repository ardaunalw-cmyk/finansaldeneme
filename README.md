# Verity

Borsa İstanbul şirketleri için bağımsız bilanço ve piyasa analizi sitesi. Fiyatlar, bilançolar,
KAP bildirimleri ve temettüler gerçek kaynaklardan gelir; hesaplanamayan bir değerin yerine
tahmin değil `—` yazılır. Yatırım tavsiyesi değildir.

Canlı site Vercel'de; `main` dalına her push otomatik yayınlanır.

## Neler var

| Bölüm | İçerik | Veri |
|---|---|---|
| Piyasa özeti | BIST 100 grafiği ve seviyeleri, USD/TL, tüm hisseler tablosu ve tarayıcı (değerleme, kârlılık ve teknik koşullar: RSI, SMA 50/200, 52 hafta zirvesi, 1 ay getiri, hacim, MACD) | Yahoo Finance (gecikmeli), `fundamentals.json`, `technicals.json` |
| Hisse sayfası | Fiyat, F/K, PD/DD, FD/FAVÖK, ROE, Verity skoru ve model değer | Fiyat + gerçek bilanço, sektör medyanları |
| | DuPont, Altman Z'', Piotroski F | KAP bilançoları (`assets/data/statements`) |
| | Bilanço, gelir tablosu, çeyreklik grafikler | KAP bilançoları (İş Yatırım derlemesi) |
| | Bedelsiz potansiyeli, temettü verimi, dağıtım oranı | Bilanço, nakit akışı, `dividends.json` |
| | Etkileşimli fiyat grafiği (TradingView Lightweight Charts): 5dk/15dk/30dk/1s/4s/günlük/haftalık zaman dilimleri (İstanbul saatiyle, dakikada bir yenilenir); mum, Heikin-Ashi, çizgi, alan; SMA/EMA/Bollinger/hacim, RSI/MACD/Stokastik panelleri; yatay seviye, trend ve Fibonacci çizimleri (tarayıcıda saklanır) | Yahoo Finance fiyat geçmişi (gecikmeli; dakikalık 60 gün, saatlik 2 yıl, günlük 5 yıl, haftalık 10 yıl) |
| | Strateji testi (geri test): SMA/EMA/MACD kesişimi, RSI ve Bollinger dönüşü, Donchian kırılımı; komisyon, zarar-kes, kâr-al; al ve tut karşılaştırması, sermaye eğrisi, işlem listesi ve grafikte AL/SAT işaretleri | Grafikteki hisse ve zaman diliminin fiyat geçmişi |
| | 27 teknik indikatörlük karne ve yazılı teknik rapor değerlendirmesi | Yahoo Finance fiyat geçmişi |
| İzleme listesi ve alarmlar | Fiyat ve RSI alarmları; grafikten tıklayarak alarm kurma, aktif alarmlar grafikte çizgi olarak; sekme arka plandayken de dakikada bir kontrol ve sistem bildirimi. Tarayıcıda saklanır, site kapalıyken çalışmaz | Yahoo Finance fiyatları (gecikmeli) |
| | Rakip kıyaslama ve radar | Aynı KAP sektöründeki şirketlerin gerçek verisi |
| | KAP bildirimleri | kap.org.tr |
| Hisse karşılaştırma | En fazla 3 hisse yan yana | Fiyat + bilanço |
| Temettü takvimi | Son 12 ayın dağıtımları, verim sıralaması | `dividends.json` |
| Sektör ve korelasyon | Sektör medyan F/K ve PD/DD, 8 varlığın 1 yıllık getiri korelasyonu | `sector-multiples.json`, Yahoo Finance fiyat geçmişi |
| Piyasa gündemi | Haber başlıkları | Google Haberler |

Gerçek kaynağa bağlanamayan bölümler (model portföy, stres testi, makro takvim, araştırma
raporları) siteden kaldırıldı. Emir defteri, AKD ve yabancı takas lisanslı veri gerektirdiği için
sitede yoktur.

## Çalıştırma

```bash
npm install
npm run dev        # http://localhost:8080 (Tailwind'i izler, /api uçlarını da çalıştırır)
npm test           # hesaplama testleri (node --test)
npm run build      # dist/ (Vercel'in yaptığı build)
```

Sohbet asistanının Claude ile cevap vermesi için ortamda `ANTHROPIC_API_KEY` tanımlı olmalı;
yoksa asistan yalnızca yerel cevaplar verir.

## Veri

`assets/data` altındaki dosyalar betiklerle üretilir ve repoya commit edilir:

```bash
npm run data                       # fundamentals.json: şirket başına son 12 ay bilanço özeti
npm run data:statements -- --force # statements/<KOD>.json: tam bilançolar (son 6 dönem)
npm run data:multiples             # sector-multiples.json: sektör medyan F/K ve PD/DD
npm run data:dividends             # dividends.json: son 2 yılın nakit temettüleri
npm run data:technicals            # technicals.json: tarayıcı için günlük teknik özet
node scripts/check-data.mjs        # bir veri kaynağı çöktüyse dosyaların boşalmadığını kontrol eder
```

Teknik özet her iş günü kapanıştan sonra ayrıca yenilenir (`.github/workflows/technicals-refresh.yml`).
GitHub Actions bunları her pazar otomatik çalıştırır (`.github/workflows/data-refresh.yml`);
kontrol geçerse değişiklikleri commit eder, Vercel de yayınlar. Elle başlatmak için Actions
sekmesinden "Data refresh" iş akışını çalıştırın.

## Kod yapısı

```
index.html              Tek sayfa uygulama (görünümler: #overview, #stock-detail, #compare, #dividends, ...)
assets/js/calc.js       Saf hesaplamalar: DuPont, Altman, Piotroski, dağıtım oranı, oranlar, temettü verimi
assets/js/verity-score.js  Verity skoru ve sektör çarpanına göre model değer
assets/js/statements.js Bilanço sekmesi ve finansal sağlık kartları
assets/js/live-data.js  Fiyatlar ve fiyata bağlı oranlar
assets/js/indicators.js Saf teknik indikatör hesapları (RSI, MACD, ADX, Ichimoku, Supertrend, MFI, ...)
assets/js/technicals.js Fiyat geçmişi, indikatör karnesi ve teknik rapor metni
assets/js/pro-chart.js  Etkileşimli fiyat grafiği, indikatör panelleri ve çizim araçları
assets/js/backtest.js   Saf geri test motoru (stratejiler, emir doldurma, istatistikler)
assets/js/backtest-ui.js Strateji Testi kartı: form, özet, sermaye eğrisi, işlem listesi
assets/lib/lightweight-charts-*/  TradingView Lightweight Charts (Apache-2.0, sürüm klasör adında)
assets/js/dividends.js  Temettü takvimi ve temettü verimi
assets/js/compare.js    Hisse karşılaştırma
assets/js/app.js        Görünümler, arama, tablo, grafikler, rakip kıyaslama
api/*.mjs               Vercel fonksiyonları (Yahoo Finance, İş Yatırım, KAP, haberler, sosyal medya, sohbet)
scripts/*.mjs           Veri üretme betikleri
test/                   Birim testleri (gerçek bilanço dosyalarıyla)
```

Her push'ta CI (`.github/workflows/ci.yml`) sözdizimini, testleri ve build'i kontrol eder.

## Kaynaklar ve lisans

Fiyatlar Yahoo Finance'ten gecikmeli, bilançolar İş Yatırım'ın KAP raporlarından derlediği
veriden, bildirimler KAP'tan, haber başlıkları Google Haberler'den alınır. Bu kaynakların kullanım
şartları geçerlidir; ticari kullanımdan önce lisanslı bir veri sağlayıcı gerekir.
