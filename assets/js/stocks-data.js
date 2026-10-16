/**
 * UTL FİNANS - Sovereign Intelligence Data Store
 * BIST 100 & BIST 30 Financial Datasets, Multipliers, Reports & Model Portfolio
 */

const UTL_DATA = {
  marketStats: {
    bist100: {
      price: 9420.15,
      changePercent: 1.42,
      changeVal: 131.80,
      volume: "114.8 Mlr ₺",
      dayRange: "9.310 - 9.445",
      sparkline: [9310, 9330, 9355, 9340, 9380, 9405, 9390, 9420.15]
    },
    leaders: [
      { code: "THYAO", change: "+3.80%", isUp: true },
      { code: "ASELS", change: "+1.76%", isUp: true },
      { code: "GARAN", change: "+2.15%", isUp: true },
      { code: "KCHOL", change: "+0.60%", isUp: true }
    ],
    indexWeight: "%30.2'si",
    alphaScore: 8.4,
    fearGreed: 68,
    marketTime: "16:45:00 TSI",
    bistStatus: "Açık",
    support1: "9.250 TL",
    resistance1: "9.680 TL",
    ma20: "9.314 TL",
    ma200: "8.940 TL"
  },

  sectorsFlow: [
    { code: "XULAS", name: "Ulaştırma", change: "+3.45%", share: "%23.5", isPositive: true },
    { code: "XBANK", name: "Bankacılık", change: "+1.82%", share: "%26.1", isPositive: true },
    { code: "XMANA", name: "Metal/Demir", change: "+1.20%", share: "%18.9", isPositive: true },
    { code: "XKMYA", name: "Kimya/Petrol", change: "-0.42%", share: "%12.8", isPositive: false }
  ],

  stocks: {
    THYAO: {
      code: "THYAO",
      name: "Türk Hava Yolları A.O.",
      symbol: "THYAO.IS",
      sector: "Ulaştırma & Lojistik",
      index: "BIST 30",
      price: "312,50",
      changePercent: "+%3,82",
      changeAmount: "+₺11,50",
      volume: "₺4.82 Mlr",
      isPositive: true,
      fk: "3.84",
      pddd: "0.98",
      fdFavok: "4.15",
      netDebtFavok: "1.12x",
      roe: "%28.4",
      roa: "%14.2",
      score: 9.1,
      scoreStatus: "Mükemmel Finansal Sağlık",
      scorePercentile: "BIST Ulaştırma: %90 Diliminde",
      targetPrice: "₺420,00",
      potential: "+%34,4 Potansiyel",
      analystConsensus: "16 Analist: 14 Al, 2 Tut",
      dayLow: "₺304,00",
      dayHigh: "₺318,00",
      yearLow: "₺218,00",
      yearHigh: "₺352,00",
      fkStatus: "İSKONTOLU",
      fkAvg: "7.40",
      pdddStatus: "CAZİP",
      pdddAvg: "1.45",
      fdFavokStatus: "UYGUN",
      fdFavokAvg: "5.20",
      netDebtStatus: "GÜÇLÜ",
      netDebtLimit: "< 3.00x",
      roePrev: "%24.1",
      roaAvg: "%8.9",
      
      // Financial dynamics (Quarterly / Annual)
      quarterly: {
        periods: ["2023/09", "2023/12", "2024/03", "2024/06", "2024/09 (Son)"],
        revenue: [148.7, 162.4, 155.2, 172.9, 211.2],
        favok: [38.2, 36.5, 34.8, 42.1, 54.3],
        margin: [25.7, 22.5, 22.4, 24.3, 25.7],
        annualRevenue: "₺540.2 Mlr",
        annualRevenueGrowth: "+%42.0 YoY Artış",
        annualFavok: "₺138.8 Mlr",
        favokMargin: "%25.7 Marj Oranı",
        netIncome: "₺68.4 Mlr",
        netIncomeStatus: "Rekor Seviye"
      },

      // Reliability & Solvency
      altmanZ: {
        score: "3.42",
        status: "GÜVENLİ BÖLGE",
        threshold: "> 2.99 Güvenli",
        desc: "Şirketin kısa vadeli nakit ve işletme sermayesi yükümlülükleri iflas riski taşımamaktadır."
      },
      piotroski: {
        score: "8 / 9",
        status: "GÜÇLÜ İYİLEŞME",
        criteria: "9 Kriterden 8'i Pozitif",
        desc: "Kârlılık, kaldıraç verimliliği ve operasyonel nakit akışı parametreleri tepe noktada."
      },
      cashflowCallout: "Hisse başına net nakit akışı son 3 yılda %180 bileşik artış sergiledi.",

      // DuPont Analysis
      dupont: {
        netMargin: "%12.66",
        netMarginFormula: "Net Kâr / Satışlar",
        netMarginChange: "+%1.8 Marj Genişlemesi",
        assetTurnover: "1.12x",
        assetTurnoverFormula: "Satışlar / Toplam Varlık",
        assetTurnoverDesc: "Hızlı Varlık Verimliliği",
        leverage: "2.00x",
        leverageFormula: "Toplam Varlık / Özkaynak",
        leverageDesc: "Kontrollü Borçluluk Oranı",
        equation: "%12.66 (Net Marj) × 1.12 (Devir Hızı) × 2.00 (Kaldıraç) = %28.4 ROE"
      },

      // Analyst Note
      analystNote: {
        title: "Bilanço Analist Notu",
        author: "Emre Karadağ, CFA",
        date: "GÜNCEL DÜN 16:30",
        summary: "THYAO, 2024/09 döneminde güçlü yolcu doluluk oranları (%85.3) ve kargo operasyonlarının marj katkısıyla beklentilerin %12 üzerinde kâr açıkladı. Para girişi ve vadeli nakit akışı pozisyonu borç geri ödemelerini destekleyerek Net Borç/FAVÖK oranını 1.12 seviyesine çekti.",
        riskOpportunity: "Küresel havacılık tedarik zincirindeki motor bakım gecikmeleri kapasite artışını sınırlasa da, 2033 filo genişleme vizyonu ve yeni kargo rotaları değerlemeyi yukarı taşımaktadır."
      },

      // Financial breakdown table
      breakdown: [
        { item: "Toplam Dönen Varlıklar", q3_24: "₺218.420 Mn", q2_24: "₺192.110 Mn", q3_23: "₺154.300 Mn", yoy: "+%41,5", trend: "YÜKSELİŞ", trendClass: "bg-emerald-50 text-emerald-700 border-emerald-200" },
        { item: "Duran Varlıklar (Filo & Tesisler)", q3_24: "₺592.830 Mn", q2_24: "₺548.200 Mn", q3_23: "₺420.150 Mn", yoy: "+%41,1", trend: "SABİT", trendClass: "bg-slate-100 text-slate-700 border-slate-200" },
        { item: "Kısa Vadeli Yükümlülükler", q3_24: "₺178.640 Mn", q2_24: "₺165.400 Mn", q3_23: "₺132.800 Mn", yoy: "+%34,5", trend: "NORMAL", trendClass: "bg-blue-50 text-blue-700 border-blue-200" },
        { item: "Toplam Özkaynaklar", q3_24: "₺384.950 Mn", q2_24: "₺330.120 Mn", q3_23: "₺265.440 Mn", yoy: "+%45,0", trend: "GÜÇLÜ", trendClass: "bg-emerald-50 text-emerald-700 border-emerald-200" },
        { item: "Net Satış Hasılatı", q3_24: "₺211.200 Mn", q2_24: "₺172.900 Mn", q3_23: "₺148.700 Mn", yoy: "+%42,0", trend: "LİDER", trendClass: "bg-amber-50 text-amber-700 border-amber-200" },
        { item: "Dönem Net Kârı", q3_24: "₺32.480 Mn", q2_24: "₺19.850 Mn", q3_23: "₺24.200 Mn", yoy: "+%34,2", trend: "REKOR", trendClass: "bg-emerald-100 text-emerald-800 border-emerald-300" }
      ]
    },

    EREGL: {
      code: "EREGL",
      name: "Ereğli Demir Çelik",
      symbol: "EREGL.IS",
      sector: "Demir - Çelik & Metal",
      index: "BIST 30",
      price: "48,90",
      changePercent: "+%2,10",
      changeAmount: "+₺1,00",
      volume: "₺2.41 Mlr",
      isPositive: true,
      fk: "11.20",
      pddd: "0.92",
      fdFavok: "8.40",
      netDebtFavok: "1.85x",
      roe: "%11.8",
      roa: "%6.4",
      score: 8.1,
      scoreStatus: "Dengeli Finansal Yapı",
      scorePercentile: "BIST Metal: %78 Diliminde",
      targetPrice: "₺64,50",
      potential: "+%31,9 Potansiyel",
      analystConsensus: "14 Analist: 10 Al, 4 Tut",
      dayLow: "₺47,80",
      dayHigh: "₺49,20",
      yearLow: "₺38,50",
      yearHigh: "₺58,40"
    },

    BIMAS: {
      code: "BIMAS",
      name: "BİM Birleşik Mağazalar",
      symbol: "BIMAS.IS",
      sector: "Tüketim & Perakende",
      index: "BIST 30",
      price: "485,00",
      changePercent: "-%0,90",
      changeAmount: "-₺4,40",
      volume: "₺1.85 Mlr",
      isPositive: false,
      fk: "14.60",
      pddd: "3.45",
      fdFavok: "7.90",
      netDebtFavok: "0.45x",
      roe: "%32.4",
      roa: "%15.8",
      score: 7.2,
      scoreStatus: "Sağlam Operasyonel Nakit",
      scorePercentile: "BIST Perakende: %85 Diliminde",
      targetPrice: "₺610,00",
      potential: "+%25,8 Potansiyel",
      analystConsensus: "18 Analist: 15 Al, 3 Tut",
      dayLow: "₺481,00",
      dayHigh: "₺492,00",
      yearLow: "₺295,00",
      yearHigh: "₺598,00"
    },

    TUPRS: {
      code: "TUPRS",
      name: "Tüpraş Türkiye Petrol Raf.",
      symbol: "TUPRS.IS",
      sector: "Enerji & Petrol Rafineri",
      index: "BIST 30",
      price: "162,30",
      changePercent: "+%1,90",
      changeAmount: "+₺3,00",
      volume: "₺3.12 Mlr",
      isPositive: true,
      fk: "6.10",
      pddd: "1.85",
      fdFavok: "4.80",
      netDebtFavok: "0.60x",
      roe: "%36.8",
      roa: "%18.2",
      score: 8.8,
      scoreStatus: "Çok Yüksek Getiri Potansiyeli",
      scorePercentile: "BIST Enerji: %94 Diliminde",
      targetPrice: "₺215,00",
      potential: "+%32,5 Potansiyel",
      analystConsensus: "17 Analist: 15 Al, 2 Tut",
      dayLow: "₺159,50",
      dayHigh: "₺164,00",
      yearLow: "₺128,00",
      yearHigh: "₺198,00"
    }
  },

  // Overview Table
  overviewTable: [
    { code: "THYAO", name: "Türk Hava Yolları A.O.", price: "312.50 TL", change: "+3.80%", isUp: true, fk: "3.84", pddd: "0.98", score: "9.4 / 10" },
    { code: "EREGL", name: "Ereğli Demir Çelik", price: "48.90 TL", change: "+2.10%", isUp: true, fk: "11.20", pddd: "0.92", score: "8.1 / 10" },
    { code: "BIMAS", name: "BİM Birleşik Mağazalar", price: "485.00 TL", change: "-0.90%", isUp: false, fk: "14.60", pddd: "3.45", score: "7.2 / 10" },
    { code: "TUPRS", name: "Tüpraş Türkiye Petrol Raf.", price: "162.30 TL", change: "+1.90%", isUp: true, fk: "6.10", pddd: "1.85", score: "8.8 / 10" }
  ],

  // Model Portfolio Data (Screen 3)
  modelPortfolio: {
    totalValue: "₺1.250.000",
    annualReturn: "+%84,6 Yıllık",
    bist100Comparison: "+%51,2",
    netAlpha: "+%33,4",
    sharpe: { value: "2.14", badge: "Olağanüstü Risk Primi", desc: "Sektör medyanı: 1.18 | Sınıfının en iyisi" },
    maxDrawdown: { value: "-%9.8", badge: "Kontrollü Dip Riski", desc: "BIST 100 Maks. Kayıp: -%22.4" },
    beta: { value: "0.88", badge: "Düşük Oynaklık Kalkanı", desc: "Piyasa hareketlerine karşı %12 defansif tampon" },
    
    rebalanceSignal: {
      title: "Ocak Ayı Dengelemesi: THYAO ağırlığının kâr satışı ile %20'ye çekilip, iskontolu kalan SISE hissesine aktarılması önerilmektedir.",
      reason: "Gerekçe: Ulaştırma çarpanları tarihsel zirveye yaklaştı. SISE cam ambalaj marjları toparlanırken net aktif değer iskontosu %38 seviyesinde cazip fırsat sunuyor."
    },

    sectors: [
      { name: "Ulaştırma & Lojistik", weight: "%25,0", amount: "₺312.500", stocks: "THYAO, PGSUS", color: "#C59B27" },
      { name: "Bankacılık & Finans", weight: "%20,0", amount: "₺250.000", stocks: "GARAN, AKBNK", color: "#1E293B" },
      { name: "Enerji & İklim", weight: "%20,0", amount: "₺250.000", stocks: "TUPRS, ENJSA", color: "#10B981" },
      { name: "Sanayi & Holding", weight: "%20,0", amount: "₺250.000", stocks: "KCHOL, SISE", color: "#64748B" },
      { name: "Nakit & Para Piyasası", weight: "%15,0", amount: "₺187.500", stocks: "Gecelik Repo & PPF", color: "#93C5FD" }
    ],

    holdings: [
      { code: "THYAO", name: "Türk Hava Yolları", weight: "%15,0", entry: "₺248,50", current: "₺314,75", target: "₺385,00", pnl: "+%26,6", isUp: true, status: "TUT", statusClass: "bg-amber-50 text-amber-700 border-amber-200" },
      { code: "PGSUS", name: "Pegasus Hava Taşımacılığı", weight: "%10,0", entry: "₺184,20", current: "₺232,40", target: "₺290,00", pnl: "+%26,1", isUp: true, status: "GÜÇLÜ AL", statusClass: "bg-emerald-50 text-emerald-700 border-emerald-200" },
      { code: "GARAN", name: "Garanti BBVA", weight: "%12,0", entry: "₺88,00", current: "₺122,80", target: "₺145,00", pnl: "+%39,5", isUp: true, status: "GÜÇLÜ AL", statusClass: "bg-emerald-50 text-emerald-700 border-emerald-200" },
      { code: "AKBNK", name: "Akbank T.A.Ş.", weight: "%8,0", entry: "₺45,10", current: "₺58,60", target: "₺72,50", pnl: "+%29,9", isUp: true, status: "TUT", statusClass: "bg-amber-50 text-amber-700 border-amber-200" },
      { code: "TUPRS", name: "Tüpraş Rafinerileri", weight: "%12,0", entry: "₺152,00", current: "₺178,30", target: "₺215,00", pnl: "+%17,3", isUp: true, status: "GÜÇLÜ AL", statusClass: "bg-emerald-50 text-emerald-700 border-emerald-200" },
      { code: "ENJSA", name: "Enerjisa Enerji", weight: "%8,0", entry: "₺52,40", current: "₺63,90", target: "₺80,00", pnl: "+%21,9", isUp: true, status: "TUT", statusClass: "bg-amber-50 text-amber-700 border-amber-200" },
      { code: "KCHOL", name: "Koç Holding", weight: "%12,0", entry: "₺195,00", current: "₺218,50", target: "₺275,00", pnl: "+%12,0", isUp: true, status: "GÜÇLÜ AL", statusClass: "bg-emerald-50 text-emerald-700 border-emerald-200" },
      { code: "SISE", name: "Türkiye Şişe ve Cam Fab.", weight: "%8,0", entry: "₺49,80", current: "₺47,30", target: "₺68,00", pnl: "-%5,0", isUp: false, status: "GÜÇLÜ AL", statusClass: "bg-emerald-50 text-emerald-700 border-emerald-200" }
    ],

    features: [
      {
        icon: "fa-shield-halved",
        title: "İsviçre Risk Paritesi",
        desc: "Portföydeki tekil hisse ağırlığı azami %20 ile sınırlandırılarak volatilite ve likidite riski minimize edilir."
      },
      {
        icon: "fa-fingerprint",
        title: "Haftalık Bilanço Taraması",
        desc: "Algoritma, FAVÖK marjı büyümesi ve serbest nakit akışı verimliliğini 7/24 takip ederek tetikleyici üretir."
      },
      {
        icon: "fa-mobile-screen",
        title: "Otomatik API Senkronizasyonu",
        desc: "Aracı kurum hesabınızı güvenle bağlayarak model portföy emirlerini tek tıkla kendi portföyünüze yansıtın."
      }
    ]
  },

  // Sectoral Reports & Research Library (Screen 4)
  reportsPage: {
    stats: {
      coveredCompanies: "142",
      activeReports: "48 Adet",
      avgRoe: "%34.8"
    },
    featuredReport: {
      badge1: "28 Sayfa Derinlikli Analiz",
      badge2: "Yayınlanma: 14 Ocak 2025",
      badge3: "BIST 100 İÇİN DÖNEMLİ",
      title: "2025 İlk Çeyrek Türkiye Makroekonomik Görünüm & BIST Sektörel Rotasyon Stratejisi",
      subtitle: "TCMB dezenflasyon takvimi ve sıkı para politikasının ikinci fazında bilanço dayanıklılığı yüksek, operasyonel nakit akışı kuvvetli ve ihracat payı dengeli hisselere kantitatif ağırlıklandırma.",
      insights: [
        { num: "1", title: "Bankacılık & Spread", desc: "2. çeyrek ve sonrasında faiz indirim döngüsüyle pozitif NIM genişlemesi." },
        { num: "2", title: "Sanayi İskontosu", desc: "Yüksek finansman maliyeti dayanıklılığına ve yenilenebilir enerjiye teşvikli sektör potansiyeli." },
        { num: "3", title: "Defansif Tüketim", desc: "Yüksek iç tüketim talebi esnekliğine sahip gıda perakendesinde belirgin kazanç." },
        { num: "4", title: "Tahvil Takası", desc: "Enflasyon muhasebesi (TMS 29) sonrasında F/K ve Özkaynak çarpanı liderliği." }
      ],
      author: "Dr. Selim Karahan",
      authorRole: "Baş Makro Stratejist & Makro Araştırma Direktörü"
    },
    sectorMultipliers: [
      { sector: "Bankacılık", fk: 4.8, growth: 42 },
      { sector: "Havacılık", fk: 6.2, growth: 38 },
      { sector: "Demir-Çelik", fk: 11.4, growth: 16 },
      { sector: "Perakende", fk: 8.5, growth: 49 },
      { sector: "Enerji", fk: 7.2, growth: 35 },
      { sector: "Telekom", fk: 7.1, growth: 27 },
      { sector: "Otomotiv", fk: 5.4, growth: 18 }
    ],
    recentReports: [
      {
        id: "rep-1",
        title: "Bankacılık Sektöründe Net Faiz Marjı (NIM) İyileşme Döngüsü",
        category: "Bankacılık",
        date: "12 Ocak 2025",
        reads: "3.4k Okunma",
        badge: "BIST XBANK",
        actionBadge: "GÜÇLÜ AL",
        actionBadgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
        pages: "14 Sayfa",
        summary: "Parasal sıkılaşma döngüsünün gevşeme sürecinde TCMB gelişmelerine göre net faiz marjında beklenen toparlanma: AKBNK, Garanti BBVA ve İş Bankası hedef fiyat revizyonları.",
        imageUrl: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=800&q=80"
      },
      {
        id: "rep-2",
        title: "Yenilenebilir Enerji Şirketlerinde Kapasite Artışı ve Çarpan Analizi",
        category: "Çeşitlilik & Enerji",
        date: "10 Ocak 2025",
        reads: "2.8k Okunma",
        badge: "YENİ ENERJİ",
        actionBadge: "ODAK İZLE",
        actionBadgeClass: "bg-amber-50 text-amber-700 border-amber-200",
        pages: "21 Sayfa",
        summary: "YEKA 5 projeleri ve hibrit depolama yatırımlarının FAVÖK marjlarına etkisi: ENJSA ve GWIND çarpanlarının sektörel iskontolarının detaylı incelemesi.",
        imageUrl: "https://images.unsplash.com/photo-1466611653911-95081537e5b7?auto=format&fit=crop&w=800&q=80"
      },
      {
        id: "rep-3",
        title: "Perakende Gıda Sektöründe Enflasyon Muhasebesi Etkileri",
        category: "Tüketim & Perakende",
        date: "09 Ocak 2025",
        reads: "4.1k Okunma",
        badge: "BIST XTUM",
        actionBadge: "GÜÇLÜ AL",
        actionBadgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
        pages: "16 Sayfa",
        summary: "TMS 29 enflasyon muhasebesi sonrası net nakit pozisyonu yüksek BIMAS, MGROS ve SOK market karşılaştırması ve marj dayanıklılığı analizleri.",
        imageUrl: "https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=800&q=80"
      },
      {
        id: "rep-4",
        title: "Otomotiv İhracat Pazarları ve Karlılık Görünümü",
        category: "Sanayi & İhracat",
        date: "05 Ocak 2025",
        reads: "1.9k Okunma",
        badge: "BIST XMANA",
        actionBadge: "YÜKSEK RİSK",
        actionBadgeClass: "bg-rose-50 text-rose-700 border-rose-200",
        pages: "18 Sayfa",
        summary: "Avrupa pazarındaki daralma ve elektrikli araç geçiş maliyetlerinin FROTO ve TOASO marj beklentilerine etkisi: 2025 marj baskısı ve model güncellemeleri.",
        imageUrl: "https://images.unsplash.com/photo-1617788138017-80ad40651399?auto=format&fit=crop&w=800&q=80"
      }
    ],
    glossary: [
      {
        key: "fk",
        title: "Fiyat / Kazanç (F/K)",
        category: "DEĞERLEME METRİĞİ",
        badge: "BIST Medyanı: 7.4x",
        badgeClass: "bg-slate-100 text-slate-700",
        formula: "Hisse Fiyatı / Hisse Başına Kâr",
        desc: "Hisse senedinin piyasa değerinin elde ettiği net kâra oranı. Şirkete yatırılan sermayenin kaç yılda amorti edileceğini gösterir."
      },
      {
        key: "favok",
        title: "FAVÖK (EBITDA)",
        category: "OPERASYONEL ÖLÇÜ",
        badge: "AVANTAJ",
        badgeClass: "bg-emerald-50 text-emerald-700",
        formula: "Faiz + Amortisman + Vergi Öncesi Kâr",
        desc: "Finansman maliyetleri ve vergi politikalarından bağımsız ana operasyonel nakit üretme kabiliyetini gösterir."
      },
      {
        key: "roe",
        title: "Özsermaye Kârlılığı (ROE)",
        category: "SERMAYE VERİMİ",
        badge: "Kritik Eşik: > %30",
        badgeClass: "bg-amber-50 text-amber-700",
        formula: "Net Dönem Kârı / Toplam Özkaynaklar",
        desc: "Hissedarların koyduğu her 100 TL özkaynak karşılığında yaratılan net kâr. Enflasyonun üzerindeki ROE değerleri reel değer yaratır."
      },
      {
        key: "netdebt",
        title: "Net Borç / FAVÖK",
        category: "SOLVENCY / KALDIRAÇ",
        badge: "İdeal: < 1.5x",
        badgeClass: "bg-blue-50 text-blue-700",
        formula: "(Kısa + Uzun Borçlar - Nakit) / FAVÖK",
        desc: "Şirketin operasyonel nakdiyle mevcut borçlarını kaç yılda kapatabileceğini gösteren borç ödeme kabiliyeti göstergesi."
      }
    ]
  }
};
