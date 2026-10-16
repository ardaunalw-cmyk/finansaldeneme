# UTL FİNANS - Sovereign Intelligence & Quantitative Terminal

Bu proje, paylaşılan 4 ekran görüntüsünü (Borsa İstanbul / Wall Street & Swiss Private Banking standardı) **birebir tasarım, tipografi, veri seti ve interaktiviteyle** hayata geçiren yeni nesil kurumsal finansal analiz web uygulamasıdır.

---

## 🏛️ İçerilen Ekranlar ve Sayfalar (4 Görsel Birebir Uygulandı)

### 1. **Genel Bakış & Piyasalar (Overview)**
* **Canlı Piyasa Bantı (Top Ticker):** BIST 100, USD/TRY, EUR/TRY, ONS Altın, Gram Altın, Brent Petrol canlı akışı ve anlık değişim göstergeleri.
* **Üst Menü & Marka:** UTL FİNANS (Sovereign Intelligence) logosu, küresel arama çubuğu (`/` veya `Ctrl+K`), Canlı durum rozeti ve UTL PRO butonu.
* **Hero Bölümü:** *"Yapay Zeka Destekli Kurumsal Finansal Analiz & Piyasa Zekası"* başlığı, anlık TSİ piyasa saati, Algoritmik Makro İstihbarat v4.8 rozeti.
* **4 Temel Metrik Kartı:**
  1. *BIST 100 Endeksi:* 9.420,15 TL (+%1,42), Hacim (114.8 Mlr ₺), Aralık ve mini bar sparkline.
  2. *Piyasa Değeri Liderleri:* THYAO (+3.80%), ASELS (+1.76%), GARAN (+2.15%), KCHOL (+0.60%).
  3. *UTL Alpha Skor Ortalaması:* 8.4 / 10, Algoritmik ilerleme çubuğu.
  4. *Korku & Açgözlülük Göstergesi:* 68 / 100 (İyimser Bölge dinamik ibresi).
* **BIST 100 Derinlik & Trend Grafiği:** 1G, 1H, 1A, 3A, 1Y, YBB filtreleri, Kritik Destek (9.250 TL), Kritik Direnç (9.680 TL), 20G/200G HO ve etkileşimli alan grafiği.
* **Sektörel Isı Haritası:** XULAS (+3.45%), XBANK (+1.82%), XMANA (+1.20%), XKMYA (-0.42%) ve AI Sinyal Notu.
* **Piyasa Hacmi & Seçilmiş Şirket Analitiği:** BIST 30 odaklı tablo; THYAO, EREGL, BIMAS, TUPRS listesi, çarpanlar, UTL skorları ve doğrudan şirket detayına geçiş sağlayan "Detay" aksiyonları.
* **Günün Öne Çıkan Raporu:** Havacılık Sektörü 4. Çeyrek Büyüme Raporu, hedef değerleme (420.00 TL), PDF indirme ve model portföye ekleme aksiyonları.

---

### 2. **Hisse & Bilanço Analizi (Stock & Financials - Tüm BIST & KAP Şirketleri)**
* **1.048 Şirketlik Resmi KAP Veri Tabanı:** Kullanıcılar sadece şirket adını (Örn: *"Türk Hava Yolları"*, *"Şişecam"*, *"Tüpraş"*, *"Aselsan"*, *"Ereğli"*, *"Astor"*, *"Migros"*) veya hisse kodunu yazarak tüm BIST şirketlerinin anlık verilerine ulaşabilir.
* **Türkçe Karakter & Argo Normalizasyonu:** `ı-i`, `ş-s`, `ğ-g`, `ü-u`, `ö-o`, `ç-c` harf duyarsızlığı ve popüler takma ad desteği (Örn: `sisecam` ➔ SISE, `thy` ➔ THYAO, `erdemir` ➔ EREGL).
* **KAP Resmi Şirket Profili:** Resmi Ticaret Ünvanı, Ödenmiş Sermaye, Kayıtlı Sermaye Tavanı, Şirket Merkezi, Sektör, Bağımsız Denetim Şirketi ve doğrudan resmi KAP profiline giden bağlantı.
* **KAP Canlı Bildirim Akışı:** Finansal Raporlar (FR), Özel Durum Açıklamaları (ÖDA) ve Temettü/Kâr Payı (TEM) bildirimleri, tek tıkla canlı güncelleme butonu (`server.ps1` proxy köprüsü ile).
* **Sol Terminal Kenar Çubuğu (Sidebar):** UTL Finans Terminal başlığı, Portföy Değeri (₺1.428.950, +%11.2), hızlı sekme geçişleri ve kullanıcı profili (Can Güner - UTL PRO).
* **Şirket Başlığı & Canlı Değerleme:** Hisse fiyatı, yüzdelik ve tutarsal değişim, UTL Bilanço Skoru, 12A Konsensüs Hedef Fiyat ve getiri potansiyeli.
* **6'lı Değerleme Çarpanları:** F/K, PD/DD, FD/FAVÖK, Net Borç/FAVÖK, ROE, ROA.
* **Gelişmiş Teknik Analiz, İndikatörler & Otomatik Formasyon Modeli:**
  * **İnteraktif Fiyat & Trend Grafiği (Chart.js):** 60 günlük tarihsel fiyat hareketi, zaman aralıkları (`1A`, `3A`, `6A`, `1Y`) ve anlık fiyat seviyesi.
  * **İndikatör Katmanları (Açılıp Kapanabilir Toggles):**
    * **Hareketli Ortalamalar (SMA 20, SMA 50, SMA 200):** Kısa, orta ve uzun vadeli trend çizgileri (Golden Cross / Death Cross analitiği).
    * **Bollinger Bantları (20, 2):** Üst Bant (+2σ), Orta Bant (SMA 20), Alt Bant (-2σ) ve volatilite sıkışması.
    * **Fibonacci Düzeltme Seviyeleri:** %23.6, %38.2, %50.0, %61.8 (Altın Oran), %78.6 yatay destek/direnç hatları.
    * **Formasyon Kırılım & Hedef Hattı:** Grafikte görsel olarak çizilen kırılım seviyesi ve formasyon hedef projeksiyonu.
  * **Alt Osilatör Paneli (Tek Tıkla Geçişli):**
    * **RSI (14):** 70 (Aşırı Alım) ve 30 (Aşırı Satım) eşikleriyle anlık momentum yönü.
    * **MACD (12, 26, 9):** MACD çizgisi, sinyal çizgisi ve pozitif/negatif histogram barları.
    * **Stokastik Osilatör (%K, %D):** Kısa vadeli dip ve tepe dönüş sinyalleri.
  * **Otomatik Formasyon Tespiti (10 Popüler Geometrik Formasyon):** Fincan Kulp, Ters Omuz Baş Omuz (TOBO), Omuz Baş Omuz (OBO), Yükselen Üçgen, Boğa Bayrağı, Çift Dip, Çift Tepe, Alçalan Takoz, Yutan Boğa, Çekiç Mum tespiti.
    * Formasyon Kırılım Seviyesi, Formasyon Hedef Fiyatı, Stop-Loss (Zarar Kes), Risk/Kazanç (R/R) Oranı ve Güven Skoru.
  * **10'lu Teknik Gösterge Skor Kartı Tablosu:** RSI, MACD, Bollinger, SMA 20, SMA 50, SMA 200, Stochastic, ATR, CCI, Hacim göstergelerinin anlık Al/Sat/Nötr durumu.
  * **Klasik Pivot Seviyeleri:** S3, S2, S1, Pivot (PP), R1, R2, R3.
  * **Yapay Zeka Destekli Otomatik Teknik Analist Yorumu (Bülten Raporu):** Trend analizi, osilatör görünümü, tespit edilen formasyon kuralları ve stratejik eylem planını içeren 4 paragraflık akıcı Türkçe bülten metni.
* **Finansal Gelir Tablosu Dinamikleri:** Çeyreklik ve Yıllık Kümülatif geçişli, Satış Hasılatı, FAVÖK ve FAVÖK Marjı çift eksenli etkileşimli çubuk-çizgi grafiği.
* **Kurumsal Sağlık & İflas Riski:** Altman Z-Score ve Piotroski F-Score segment göstergeleri.
* **3 Kademeli DuPont Analizi:** Net Kâr Marjı × Aktif Devir Hızı × Kaldıraç Çarpanı = ROE bağıntısı.
* **Çeyreklik Bilanço Kırılım Tablosu:** 5 çeyreklik Dönen Varlıklar, Duran Varlıklar, Kısa Vadeli Yükümlülükler, Özkaynaklar, Net Satışlar ve Dönem Kârı kalemleri, YoY değişimleri.
* **Yapay Zeka Destekli Finansal Projeksiyon & Gelecek Tahmin Modeli:**
  * **3 Yıllık Büyüme Tahminleri (2025T, 2026T, 2027T):** Gelir, FAVÖK ve Net Kâr tahminleri.
  * **3 Senaryolu Değerleme Matrisi:** Boğa (Bull), Baz (Base) ve Ayı (Bear) senaryoları.
  * **DCF (İndirgenmiş Nakit Akımları) Adil Değeri:** Model getiri potansiyeli.
  * **Etkileşimli Projeksiyon Simülatörü:** Ciro büyümesi ve FAVÖK marjı kaydırıcıları ile anlık dinamik hedef fiyat hesaplama.
  * **Tarihsel vs. Gelecek Projeksiyon Trend Grafiği:** Chart.js çift seri eğrisi.

---

### 3. **Portföy & Model Portföy (Strategy & Rebalancing Engine)**
* **Canlı Algoritmik Strateji:** BIST 30 Alpha Stratejisi Q1, Özel Rapor Oluştur ve Kendi Portföyünü Bağla butonları.
* **Model Portföy vs. BIST 100 Getiri Grafiği:** ₺1.250.000 büyüklük, +%84,6 yıllık getiri, +%33,4 net Alpha.
* **Risk Metrikleri:** Sharpe Oranı (2.14 Olağanüstü), Maksimum Kayıp (Drawdown: -%9.8), Beta Katsayısı (0.88 Defansif Tampon).
* **AI Algoritmik Dengeleme Önerisi:** Ocak ayı rebalancing sinyali (THYAO kâr satışı ➔ SISE alımı), Simülasyonu İncele ve Dengelemeyi Uygula modalı.
* **Varlık & Sektör Dağılımı Donut Grafiği:** Ulaştırma (%25), Bankacılık (%20), Enerji (%20), Sanayi (%20), Nakit (%15).
* **Model Portföy Pozisyonları Tablosu:** 8 aktif hisse (THYAO, PGSUS, GARAN, AKBNK, TUPRS, ENJSA, KCHOL, SISE), giriş ve güncel fiyatları, hedef fiyatlar, kâr/zarar oranları ve TUT/GÜÇLÜ AL tavsiyeleri.
* **3 Strateji Kartı:** İsviçre Risk Paritesi, Haftalık Bilanço Taraması, Otomatik API Senkronizasyonu.

---

### 4. **Sektörel Raporlar & Piyasa Kütüphanesi (Research Library)**
* **Başlık & Metrikler:** Kapsamdaki Şirket (142), Güncel Rapor (48 Adet), Ortalama ROE (%34.8).
* **2025 Q1 Makroekonomik Strateji Raporu (Hero Card):** 28 sayfalık analiz, kurumsal toplantı görseli, 4 temel strateji çıkarımı (Bankacılık NIM, Sanayi İskontosu, Defansif Tüketim, Tahvil Takası), Dr. Selim Karahan imzası, önizleme ve PDF indirme.
* **Sektörel Çarpan & Büyüme Matrisi:** Sektör filtre butonları (Bankacılık, Havacılık, Demir-Çelik, Perakende, Enerji, Telekom, Otomotiv), F/K vs. Gelir Büyümesi karşılaştırmalı çubuk grafiği.
* **BIST 100 Isı Haritası Fırsat Kartı:** En yüksek değerleme fırsatları (Bankacılık Risk Primi Cazip, Havacılık Nakit Akışı Güçlü).
* **Son Analiz & Değerleme Raporları:** 4 sektörel rapor kartı (Bankacılık NIM, Yenilenebilir Enerji, Perakende Gıda TMS 29, Otomotiv İhracatı), okuma süreleri, etiketler ve açılır modal okuyucu.
* **Finansal Terimler ve Bilanço Okuma Rehberi:** F/K, FAVÖK (EBITDA), ROE ve Net Borç/FAVÖK interaktif eğitim kartları.
* **Haftalık Bülten Abonelik Kutusu & SPK Yasal Uyarı Altlığı.**

---

## 🚀 Nasıl Çalıştırılır?

1. Masaüstündeki `Finans Deneme` klasöründe yer alan **`start.bat`** dosyasına çift tıklayın (yerel sunucuyu ve canlı KAP proxy'sini başlatır ve varsayılan tarayıcınızda açar) veya
2. Doğrudan **`index.html`** dosyasını herhangi bir web tarayıcısında (Chrome, Edge, Firefox, Safari) açın.
3. Herhangi bir ekstra kurulum (Node.js, npm, Python vs.) gerektirmez; tamamen saf, modern HTML5/CSS3/JavaScript ve yüksek hızlı CDN kütüphaneleriyle çalışır.
