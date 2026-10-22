# Verity

Borsa İstanbul şirketleri için bağımsız bilanço ve piyasa analizi sitesi. Fiyatlar, bilançolar,
KAP bildirimleri ve temettüler gerçek kaynaklardan gelir; hesaplanamayan bir değerin yerine
tahmin değil `—` yazılır. Yatırım tavsiyesi değildir.

Canlı site Vercel'de; `main` dalına her push otomatik yayınlanır.

## Neler var

| Bölüm | İçerik | Veri |
|---|---|---|
| Piyasa özeti | BIST 100 grafiği ve seviyeleri, USD/TL, tüm hisseler tablosu ve tarayıcı | Yahoo Finance (gecikmeli), `fundamentals.json` |
| Hisse sayfası | Fiyat, F/K, PD/DD, FD/FAVÖK, ROE, Verity skoru ve model değer | Fiyat + gerçek bilanço, sektör medyanları |
| | DuPont, Altman Z'', Piotroski F | KAP bilançoları (`assets/data/statements`) |
| | Bilanço, gelir tablosu, çeyreklik grafikler | KAP bilançoları (İş Yatırım derlemesi) |
| | Bedelsiz potansiyeli, temettü verimi, dağıtım oranı | Bilanço, nakit akışı, `dividends.json` |
| | Teknik göstergeler ve mum grafiği | Yahoo Finance fiyat geçmişi |
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
node scripts/check-data.mjs        # bir veri kaynağı çöktüyse dosyaların boşalmadığını kontrol eder
```

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
assets/js/technicals.js Fiyat geçmişi ve teknik göstergeler
assets/js/dividends.js  Temettü takvimi ve temettü verimi
assets/js/compare.js    Hisse karşılaştırma
assets/js/app.js        Görünümler, arama, tablo, grafikler, rakip kıyaslama
api/*.mjs               Vercel fonksiyonları (Yahoo Finance, İş Yatırım, KAP, haberler, sohbet)
scripts/*.mjs           Veri üretme betikleri
test/                   Birim testleri (gerçek bilanço dosyalarıyla)
```

Her push'ta CI (`.github/workflows/ci.yml`) sözdizimini, testleri ve build'i kontrol eder.

## Kaynaklar ve lisans

Fiyatlar Yahoo Finance'ten gecikmeli, bilançolar İş Yatırım'ın KAP raporlarından derlediği
veriden, bildirimler KAP'tan, haber başlıkları Google Haberler'den alınır. Bu kaynakların kullanım
şartları geçerlidir; ticari kullanımdan önce lisanslı bir veri sağlayıcı gerekir.
