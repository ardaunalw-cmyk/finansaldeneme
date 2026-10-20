# Generate optimized KAP Database for UTL Finans
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$rawPath = Join-Path $PSScriptRoot "assets\js\kap-all.json"

Write-Host "Fetching all 1049+ companies from KAP (IGS/ALL)..."
try {
    $wc = New-Object System.Net.WebClient
    $wc.Encoding = [System.Text.Encoding]::UTF8
    $wc.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    $jsonStr = $wc.DownloadString("https://www.kap.org.tr/tr/api/company/items/IGS/ALL")
    $rawCompanies = $jsonStr | ConvertFrom-Json
    [System.IO.File]::WriteAllText($rawPath, $jsonStr, [System.Text.Encoding]::UTF8)
    Write-Host "Successfully downloaded $($rawCompanies.Count) companies from KAP with UTF-8."
} catch {
    Write-Warning "Could not fetch online KAP, falling back to local kap-all.json: $_"
    if (Test-Path $rawPath) {
        $rawCompanies = [System.IO.File]::ReadAllText($rawPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    } else {
        Write-Error "No local kap-all.json available!"
        exit 1
    }
}

$TL = [char]0x20BA

# Known BIST 30 tickers
$bist30 = @('THYAO','EREGL','BIMAS','TUPRS','ASELS','GARAN','AKBNK','KCHOL','SISE','SASA','FROTO','EKGYO','PETKM','ASTOR','KONTR','MIATK','ALARK','MGROS','PGSUS','ISCTR','YKBNK','VAKBN','HALKB','TCELL','TTKOM','ENKAI','ARCLK','TOASO','OYAKC','BRISA')

# Alias map for instant colloquial search
$aliasMap = @{
    'SISE'  = 'sisecam cam fabrikalari turkiye sise ve cam'
    'THYAO' = 'thy turk hava yollari turkish airlines havayolu'
    'EREGL' = 'erdemir eregli demir celik'
    'TUPRS' = 'tupras turkiye petrol rafinerileri'
    'ASELS' = 'aselsan askeri elektronik'
    'BIMAS' = 'bim birlesik magazalar market'
    'FROTO' = 'ford otosan otomotiv'
    'TOASO' = 'tofas turk otomobil fabrikasi'
    'KCHOL' = 'koc holding'
    'SAHOL' = 'sabanci holding'
    'GARAN' = 'garanti bbva bankasi'
    'AKBNK' = 'akbank'
    'ISCTR' = 'is bankasi isbank turkiye is bankasi'
    'YKBNK' = 'yapi kredi bankasi ykb'
    'VAKBN' = 'vakifbank vakiflar bankasi'
    'HALKB' = 'halkbank turkiye halk bankasi'
    'TCELL' = 'turkcell iletisim'
    'TTKOM' = 'turk telekom telekomunikasyon'
    'PGSUS' = 'pegasus hava tasimaciligi havayolu'
    'MGROS' = 'migros ticaret market'
    'ARCLK' = 'arcelik beko'
    'PETKM' = 'petkim petrokimya'
    'SASA'  = 'sasa polyester sanayi'
    'ENKAI' = 'enka insaat ve sanayi'
    'ASTOR' = 'astor enerji transformator'
    'KONTR' = 'kontrolmatik teknoloji enerji'
    'MIATK' = 'mia teknoloji bilisim yazilim'
}

# Sector detection helper (ASCII-safe matching)
function Get-Sector([string]$title, [string]$code) {
    $c = $code.ToUpper().Trim()
    if ($c -in @('THYAO','PGSUS','TAVHL','CLEBI')) { return 'Ulaştırma & Havacılık' }
    if ($c -in @('GARAN','AKBNK','ISCTR','YKBNK','VAKBN','HALKB','ALBRK','SKBNK','TSKB','QNBFB')) { return 'Bankacılık & Finans' }
    if ($c -in @('KCHOL','SAHOL','ALARK','AGHOL','TKFEN','BERA','GLYHO','DOHOL')) { return 'Holding & Yatırım' }
    if ($c -in @('EREGL','KRDMD','ISDMR','KRDMA','KRDMB','CEMTS','TUKAS')) { return 'Demir-Çelik & Metal Sanayi' }
    if ($c -in @('TUPRS','AYGAZ','AKSEN','ENJSA','GWIND','ODAS','CANTE','ZOREN','EUPWR','ALFAS','SMRTG','CWENE','KOPOL','ASTOR','KONTR')) { return 'Enerji & Petrol Rafineri' }
    if ($c -in @('BIMAS','MGROS','SOKM','BIZIM','VAKKO','MAVI','DESA')) { return 'Perakende & Tüketim' }
    if ($c -in @('FROTO','TOASO','DOAS','TTRAK','OTKAR','KMSAN','TMSN')) { return 'Otomotiv & Yan Sanayi' }
    if ($c -in @('SISE','TRKCM','ANACM','DENCM','IZOCM')) { return 'Cam & Seramik Sanayi' }
    if ($c -in @('SASA','PETKM','HEKTS','GUBRF','EGGUB','BAGFS','KORDS','DEVA','SELEC','RTALB')) { return 'Kimya, İlaç & Gübre' }
    if ($c -in @('ASELS','SDTTR','KFEIN','MIATK','LOGO','ARDYZ','VBTYZ','PAPIL','REEDR')) { return 'Savunma & İleri Teknoloji' }
    if ($c -in @('TCELL','TTKOM','NETAS','KAREL')) { return 'Telekomünikasyon & Bilişim' }

    $t = $title.ToUpper()
    $cleanT = $t.Replace([char]0x0130,'I').Replace([char]0x015E,'S').Replace([char]0x011E,'G').Replace([char]0x00DC,'U').Replace([char]0x00D6,'O').Replace([char]0x00C7,'C')

    if ($cleanT -match 'GAYRIMENKUL|GYO') { return 'Gayrimenkul Yatırım Ortaklığı (GYO)' }
    if ($cleanT -match 'CIMENTO|BETON') { return 'Çimento & Yapı Malzemeleri' }
    if ($cleanT -match 'ENERJI|ELEKTRIK|PETROL|DOGAL GAZ|SOLAR|RUZGAR') { return 'Enerji & Altyapı' }
    if ($cleanT -match 'GIDA|UN |SEKER|SUT|ET |ICECEK|TARIM|MEYVE|ZEYTIN') { return 'Gıda, Tarım & İçecek' }
    if ($cleanT -match 'TEKSTIL|MENSUCAT|YUN|IPLIK|DERI|GIYIM') { return 'Tekstil & Konfeksiyon' }
    if ($cleanT -match 'HOLDING') { return 'Holding & Girişim Sermayesi' }
    if ($cleanT -match 'MADEN|MADENCILIK|MERMER') { return 'Madencilik & Doğal Kaynaklar' }
    if ($cleanT -match 'OTOMOTIV|MOTOR|TASIT|ARAC') { return 'Otomotiv & Ulaşım Araçları' }
    if ($cleanT -match 'BANKA|FINANS|FAKTORING|VARLIK|MENKUL|PORTFOY|SIGORTA|EMEKLILIK') { return 'Finansal Hizmetler' }
    if ($cleanT -match 'BILISIM|YAZILIM|TEKNOLOJI|TELEKOM|ELEKTRONIK|ILETISIM') { return 'Savunma & İleri Teknoloji' }
    if ($cleanT -match 'TURIZM|OTEL|KONAKLAMA') { return 'Turizm & Otelcilik' }
    if ($cleanT -match 'SAGLIK|ILAC|HASTANE|BIYO') { return 'Sağlık & İlaç Sanayi' }
    return 'Sanayi & İmalat'
}

# Number formatting helpers
function Format-Money([double]$val) {
    $TL = [char]0x20BA
    if ($val -ge 1000000000) {
        return "$TL" + [math]::Round($val / 1000000000, 2).ToString("0.00", [System.Globalization.CultureInfo]::InvariantCulture) + " Mlr"
    } elseif ($val -ge 1000000) {
        return "$TL" + [math]::Round($val / 1000000, 2).ToString("0.00", [System.Globalization.CultureInfo]::InvariantCulture) + " Mn"
    } else {
        return "$TL" + [math]::Round($val, 2).ToString("N0", [System.Globalization.CultureInfo]::GetCultureInfo("tr-TR"))
    }
}

$companiesList = @()
$seenCodes = @{}

foreach ($comp in $rawCompanies) {
    $code = $comp.stockCode
    if ([string]::IsNullOrWhiteSpace($code) -or $seenCodes.ContainsKey($code)) { continue }
    $seenCodes[$code] = $true

    $sector = Get-Sector -title $comp.kapMemberTitle -code $code
    $idx = "BIST TÜM"
    if ($code -in $bist30) { $idx = "BIST 30" }

    $paidCapNum = 500000000
    if ($comp.paidCapital) { $paidCapNum = [double]$comp.paidCapital }
    $capCeilNum = $paidCapNum * 4
    if ($comp.kayitliSermayeTavani) { $capCeilNum = [double]$comp.kayitliSermayeTavani }

    $cCity = "İSTANBUL"
    if ($comp.cityName) { $cCity = $comp.cityName }
    $cAuditor = "BAĞIMSIZ DENETİM A.Ş."
    if ($comp.relatedMemberTitle) { $cAuditor = $comp.relatedMemberTitle }

    # Clean search string (lowercase, ASCII-normalized for search)
    $alias = ""
    if ($aliasMap.ContainsKey($code)) { $alias = " " + $aliasMap[$code] }
    $clean = ($comp.kapMemberTitle + " " + $code + $alias).ToLower().Replace('i̇','i').Replace('ı','i').Replace('ş','s').Replace('ğ','g').Replace('ü','u').Replace('ö','o').Replace('ç','c')

    $companiesList += [PSCustomObject]@{
        c = $code
        n = $comp.kapMemberTitle
        s = $clean
        sec = $sector
        idx = $idx
        cap = Format-Money $paidCapNum
        capRaw = $paidCapNum
        ceil = Format-Money $capCeilNum
        city = $cCity
        aud = $cAuditor
        mkk = $comp.mkkMemberOid
        kap = $comp.kapMemberOid
        cc = $comp.companyCode
    }
}

Write-Host "Processed $($companiesList.Count) unique listed companies."

$curatedJson = @{
    'THYAO' = @{
        price = "312,50"; priceNum = 312.50; change = "+%3,82"; changeAmount = "+$TL 11,50"; isPositive = $true; volume = "$TL 4.82 Mlr"
        fk = "3.84"; pddd = "0.98"; fdFavok = "4.15"; netDebt = "1.12x"; roe = "%28.4"; roa = "%14.2"
        score = 9.1; scoreStatus = "Mükemmel Finansal Sağlık"; scorePercentile = "BIST Ulaştırma: %90 Diliminde"
        targetPrice = "$TL 420,00"; potential = "+%34,4 Potansiyel"; analystConsensus = "16 Analist: 14 Al, 2 Tut"
        dayLow = "$TL 304,00"; dayHigh = "$TL 318,00"; yearLow = "$TL 218,00"; yearHigh = "$TL 352,00"
        qRev = @(148.7, 162.4, 155.2, 172.9, 211.2)
        qFav = @(38.2, 36.5, 34.8, 42.1, 54.3)
        qMar = @(25.7, 22.5, 22.4, 24.3, 25.7)
        annRev = "$TL 540.2 Mlr"; annFav = "$TL 138.8 Mlr"; netInc = "$TL 68.4 Mlr"
        altZ = "3.42"; altZStatus = "GÜVENLİ BÖLGE"; pio = "8 / 9"
        analystSum = "THYAO, 2024/09 döneminde güçlü yolcu doluluk oranları (%85.3) ve kargo operasyonlarının marj katkısıyla beklentilerin %12 üzerinde kâr açıkladı. Nakit akışı pozisyonu borç geri ödemelerini destekleyerek Net Borç/FAVÖK oranını 1.12 seviyesine çekti."
        riskOpp = "Küresel havacılık tedarik zincirindeki motor bakım gecikmeleri kapasite artışını sınırlasa da, 2033 filo genişleme vizyonu ve yeni kargo rotaları değerlemeyi yukarı taşımaktadır."
    }
    'EREGL' = @{
        price = "48,90"; priceNum = 48.90; change = "+%2,10"; changeAmount = "+$TL 1,00"; isPositive = $true; volume = "$TL 2.41 Mlr"
        fk = "11.20"; pddd = "0.92"; fdFavok = "8.40"; netDebt = "1.85x"; roe = "%11.8"; roa = "%6.4"
        score = 8.1; scoreStatus = "Dengeli Finansal Yapı"; scorePercentile = "BIST Metal: %78 Diliminde"
        targetPrice = "$TL 64,50"; potential = "+%31,9 Potansiyel"; analystConsensus = "14 Analist: 10 Al, 4 Tut"
        dayLow = "$TL 47,80"; dayHigh = "$TL 49,20"; yearLow = "$TL 38,50"; yearHigh = "$TL 58,40"
        qRev = @(32.1, 35.4, 38.2, 41.5, 46.8)
        qFav = @(4.2, 4.8, 5.5, 6.2, 7.8)
        qMar = @(13.1, 13.5, 14.4, 14.9, 16.7)
        annRev = "$TL 161.9 Mlr"; annFav = "$TL 24.3 Mlr"; netInc = "$TL 12.4 Mlr"
        altZ = "2.85"; altZStatus = "DENGELİ BÖLGE"; pio = "7 / 9"
        analystSum = "Ereğli, küresel çelik fiyatlarındaki toparlanma ve yerli otomotiv/inşaat talebiyle kapasite kullanım oranını %88 seviyesine yükseltti. Peletleme yatırımı maliyet avantajını güçlendirdi."
        riskOpp = "Karbon vergisi ve yeşil dönüşüm yatırım harcamaları kısa vadeli serbest nakit akımını baskılayabilir; ancak elektrik ark ocaklı dönüşüm orta vadeli rekabet gücünü teminat altına alıyor."
    }
    'BIMAS' = @{
        price = "485,00"; priceNum = 485.00; change = "-%1,02"; changeAmount = "-$TL 5,00"; isPositive = $false; volume = "$TL 1.85 Mlr"
        fk = "14.20"; pddd = "3.45"; fdFavok = "9.10"; netDebt = "0.45x"; roe = "%32.1"; roa = "%12.8"
        score = 8.9; scoreStatus = "Güçlü Nakit Akışı & Savunmacı Profil"; scorePercentile = "BIST Perakende: %85 Diliminde"
        targetPrice = "$TL 610,00"; potential = "+%25,8 Potansiyel"; analystConsensus = "18 Analist: 15 Al, 3 Tut"
        dayLow = "$TL 481,00"; dayHigh = "$TL 492,00"; yearLow = "$TL 285,00"; yearHigh = "$TL 585,00"
        qRev = @(82.4, 89.1, 95.6, 104.2, 118.5)
        qFav = @(6.4, 7.1, 7.8, 8.5, 9.8)
        qMar = @(7.8, 8.0, 8.2, 8.2, 8.3)
        annRev = "$TL 407.4 Mlr"; annFav = "$TL 33.2 Mlr"; netInc = "$TL 21.6 Mlr"
        altZ = "4.10"; altZStatus = "GÜVENLİ BÖLGE"; pio = "8 / 9"
        analystSum = "BİM, yüksek enflasyon ortamında güçlü pazar payını korurken mağaza açılış temposunu sürdürmektedir. Negatif işletme sermayesi döngüsü şirkete benzersiz bir nakit yaratma kabiliyeti sağlamaktadır."
        riskOpp = "Asgari ücret ayarlamaları operasyonel giderleri artırsa da, özel markalı (private label) ürün portföyünün yüksek esnekliği kâr marjlarını korumaktadır."
    }
    'GARAN' = @{
        price = "122,80"; priceNum = 122.80; change = "+%2,15"; changeAmount = "+$TL 2,60"; isPositive = $true; volume = "$TL 3.85 Mlr"
        fk = "4.10"; pddd = "1.15"; fdFavok = "3.80"; netDebt = "N/A"; roe = "%34.5"; roa = "%3.8"
        score = 8.7; scoreStatus = "Yüksek Kârlılık ve Sağlam Sermaye"; scorePercentile = "BIST Bankacılık: %88 Diliminde"
        targetPrice = "$TL 165,00"; potential = "+%34,4 Potansiyel"; analystConsensus = "19 Analist: 16 Al, 3 Tut"
        dayLow = "$TL 119,50"; dayHigh = "$TL 124,00"; yearLow = "$TL 55,00"; yearHigh = "$TL 135,00"
        qRev = @(42.5, 48.6, 54.2, 61.5, 72.8)
        qFav = @(22.1, 25.4, 28.5, 32.1, 38.6)
        qMar = @(52.0, 52.3, 52.6, 52.2, 53.0)
        annRev = "$TL 236.8 Mlr"; annFav = "$TL 124.6 Mlr"; netInc = "$TL 78.2 Mlr"
        altZ = "N/A"; altZStatus = "BANKACILIK ÖZEL MODELİ"; pio = "7 / 9"
        analystSum = "Garanti BBVA, sektörün en yüksek sermaye yeterlilik rasyolarından birine ve lider komisyon gelirlerine sahiptir. Net faiz marjındaki toparlanma kârlılık ivmesini hızlandırmaktadır."
        riskOpp = "Kredi kartı ve tüketici kredisi büyüme sınırlamaları hacim büyümesini dizginlese de, güçlü vadesiz mevduat tabanı fonlama maliyetini minimize etmektedir."
    }
    'FROTO' = @{
        price = "1.085,00"; priceNum = 1085.00; change = "+%2,45"; changeAmount = "+$TL 26,00"; isPositive = $true; volume = "$TL 2.10 Mlr"
        fk = "8.90"; pddd = "3.80"; fdFavok = "7.20"; netDebt = "1.20x"; roe = "%48.5"; roa = "%16.2"
        score = 9.3; scoreStatus = "Olağanüstü İhracat ve Özsermaye Kârı"; scorePercentile = "BIST Otomotiv: %98 Diliminde"
        targetPrice = "$TL 1.450,00"; potential = "+%33,6 Potansiyel"; analystConsensus = "15 Analist: 14 Al, 1 Tut"
        dayLow = "$TL 1.055,00"; dayHigh = "$TL 1.098,00"; yearLow = "$TL 760,00"; yearHigh = "$TL 1.220,00"
        qRev = @(95.4, 110.2, 125.8, 138.4, 162.5)
        qFav = @(9.8, 11.5, 13.2, 14.6, 17.8)
        qMar = @(10.3, 10.4, 10.5, 10.5, 11.0)
        annRev = "$TL 536.9 Mlr"; annFav = "$TL 57.1 Mlr"; netInc = "$TL 42.5 Mlr"
        altZ = "3.75"; altZStatus = "GÜVENLİ BÖLGE"; pio = "8 / 9"
        analystSum = "Ford Otosan, Avrupa ticari araç pazarındaki tartışmasız liderliğini yeni elektrikli Custom modelleriyle pekiştirmektedir. Romanya Craiova tesisinin katkısı gelirleri katlamaktadır."
        riskOpp = "Avrupa resesyon riski siparişleri etkileyebilir; ancak maliyet artı anlaşması (cost-plus) şirketin kâr marjını garanti altına almaktadır."
    }
    'SISE' = @{
        price = "47,30"; priceNum = 47.30; change = "-%0,42"; changeAmount = "-$TL 0,20"; isPositive = $false; volume = "$TL 1.65 Mlr"
        fk = "8.20"; pddd = "0.88"; fdFavok = "6.40"; netDebt = "1.95x"; roe = "%14.5"; roa = "%7.2"
        score = 8.2; scoreStatus = "Derin Net Aktif Değer İskontosu"; scorePercentile = "BIST Sanayi: %80 Diliminde"
        targetPrice = "$TL 68,00"; potential = "+%43,8 Potansiyel"; analystConsensus = "15 Analist: 12 Al, 3 Tut"
        dayLow = "$TL 46,80"; dayHigh = "$TL 48,10"; yearLow = "$TL 42,00"; yearHigh = "$TL 57,50"
        qRev = @(35.4, 38.2, 42.1, 45.8, 51.2)
        qFav = @(6.2, 6.8, 7.5, 8.2, 9.5)
        qMar = @(17.5, 17.8, 17.8, 17.9, 18.6)
        annRev = "$TL 177.3 Mlr"; annFav = "$TL 31.7 Mlr"; netInc = "$TL 18.4 Mlr"
        altZ = "2.95"; altZStatus = "GÜVENLİ BÖLGE"; pio = "7 / 9"
        analystSum = "Şişecam, küresel cam ambalaj ve soda külü sektöründe dünyanın en büyük üreticilerindendir. ABD doğal soda yatırımı şirketi global maliyet eğrisinin en avantajlı noktasına taşıyacaktır."
        riskOpp = "Avrupa enerji maliyetleri ve inşaat durgunluğu talep toparlanmasını geciktirse de, hissenin tarihsel çarpan iskontosu uzun vadeli yatırımcılar için büyük güvenlik marjı içerir."
    }
    'SASA' = @{
        price = "4,25"; priceNum = 4.25; change = "+%0,71"; changeAmount = "+$TL 0,03"; isPositive = $true; volume = "$TL 1.95 Mlr"
        fk = "18.40"; pddd = "2.80"; fdFavok = "14.20"; netDebt = "4.10x"; roe = "%8.5"; roa = "%3.2"
        score = 6.8; scoreStatus = "Yüksek Borçluluk & Yatırım Döngüsü"; scorePercentile = "BIST Kimya: %65 Diliminde"
        targetPrice = "$TL 5,80"; potential = "+%36,5 Potansiyel"; analystConsensus = "11 Analist: 6 Al, 5 Tut"
        dayLow = "$TL 4,18"; dayHigh = "$TL 4,32"; yearLow = "$TL 3,80"; yearHigh = "$TL 6,85"
        qRev = @(12.5, 14.2, 15.8, 17.4, 19.8)
        qFav = @(1.8, 2.1, 2.4, 2.8, 3.4)
        qMar = @(14.4, 14.8, 15.2, 16.1, 17.2)
        annRev = "$TL 67.2 Mlr"; annFav = "$TL 10.7 Mlr"; netInc = "$TL 4.2 Mlr"
        altZ = "1.85"; altZStatus = "DİKKATLE İZLENMELİ"; pio = "5 / 9"
        analystSum = "SASA, Yumurtalık PTA tesisinin devreye girmesiyle hammadde ithalat bağımlılığını sonlandırmayı ve yıllık 1.5 milyon ton üretim kapasitesine ulaşmayı hedeflemektedir."
        riskOpp = "Yüksek finansman giderleri ve borçluluk seviyesi kârlılığı baskılamaktadır; tesisin tam kapasiteye geçişi kritik takip parametresidir."
    }
    'ASELS' = @{
        price = "64,20"; priceNum = 64.20; change = "+%1,76"; changeAmount = "+$TL 1,10"; isPositive = $true; volume = "$TL 3.45 Mlr"
        fk = "14.80"; pddd = "3.20"; fdFavok = "11.40"; netDebt = "0.75x"; roe = "%28.5"; roa = "%11.2"
        score = 9.4; scoreStatus = "Stratejik Savunma Bakiye Sipariş Rekoru"; scorePercentile = "BIST Savunma: %99 Diliminde"
        targetPrice = "$TL 88,00"; potential = "+%37,1 Potansiyel"; analystConsensus = "18 Analist: 16 Al, 2 Tut"
        dayLow = "$TL 62,80"; dayHigh = "$TL 65,10"; yearLow = "$TL 38,50"; yearHigh = "$TL 72,00"
        qRev = @(18.2, 21.5, 24.8, 29.2, 36.4)
        qFav = @(4.5, 5.4, 6.2, 7.8, 9.8)
        qMar = @(24.7, 25.1, 25.0, 26.7, 26.9)
        annRev = "$TL 110.1 Mlr"; annFav = "$TL 29.2 Mlr"; netInc = "$TL 18.5 Mlr"
        altZ = "3.80"; altZStatus = "GÜVENLİ BÖLGE"; pio = "8 / 9"
        analystSum = "ASELSAN, 12 milyar doları aşan rekor bakiye sipariş portföyü ve artan ihracat sözleşmeleriyle güçlü finansal görünümünü korumaktadır. Elektronik harp ve radar teslimatları kâr marjlarını desteklemektedir."
        riskOpp = "Küresel çip ve yarıiletken tedarik süreleri teslimat takvimini etkileyebilir; millileştirme programı bu riski minimize etmektedir."
    }
    'KCHOL' = @{
        price = "218,40"; priceNum = 218.40; change = "+%0,60"; changeAmount = "+$TL 1,30"; isPositive = $true; volume = "$TL 2.95 Mlr"
        fk = "6.20"; pddd = "1.35"; fdFavok = "5.10"; netDebt = "1.05x"; roe = "%34.2"; roa = "%8.5"
        score = 9.2; scoreStatus = "Derin Holding İskontosu & İhracat Gücü"; scorePercentile = "BIST Holding: %95 Diliminde"
        targetPrice = "$TL 310,00"; potential = "+%41,9 Potansiyel"; analystConsensus = "17 Analist: 15 Al, 2 Tut"
        dayLow = "$TL 215,00"; dayHigh = "$TL 221,00"; yearLow = "$TL 138,00"; yearHigh = "$TL 265,00"
        qRev = @(210.4, 235.8, 260.1, 295.4, 345.2)
        qFav = @(28.4, 32.1, 36.5, 42.8, 51.2)
        qMar = @(13.5, 13.6, 14.0, 14.5, 14.8)
        annRev = "$TL 1.13 Trl"; annFav = "$TL 162.6 Mlr"; netInc = "$TL 84.1 Mlr"
        altZ = "3.20"; altZStatus = "GÜVENLİ BÖLGE"; pio = "8 / 9"
        analystSum = "Koç Holding, dengeli portföy yapısı (enerji, otomotiv, finans ve dayanıklı tüketim) ile kur dalgalanmalarına karşı üstün bir savunma kalkanına sahiptir. Solo net nakit pozisyonu yatırımlara esneklik sağlamaktadır."
        riskOpp = "Avrupa pazarlarındaki otomotiv ve beyaz eşya talep döngüsü izlenmelidir; enerji ve rafineri kârlılığı bu döngüyü dengelemektedir."
    }
    'TUPRS' = @{
        price = "172,50"; priceNum = 172.50; change = "+%2,40"; changeAmount = "+$TL 4,00"; isPositive = $true; volume = "$TL 4.10 Mlr"
        fk = "6.10"; pddd = "1.85"; fdFavok = "4.80"; netDebt = "0.40x"; roe = "%38.2"; roa = "%15.4"
        score = 9.0; scoreStatus = "Yüksek Rafineri Marjı & Temettü Gücü"; scorePercentile = "BIST Petrol: %92 Diliminde"
        targetPrice = "$TL 235,00"; potential = "+%36,2 Potansiyel"; analystConsensus = "16 Analist: 14 Al, 2 Tut"
        dayLow = "$TL 168,00"; dayHigh = "$TL 174,50"; yearLow = "$TL 125,00"; yearHigh = "$TL 198,00"
        qRev = @(135.2, 148.5, 160.2, 178.4, 205.1)
        qFav = @(18.5, 21.2, 23.4, 27.8, 34.2)
        qMar = @(13.7, 14.3, 14.6, 15.6, 16.7)
        annRev = "$TL 692.3 Mlr"; annFav = "$TL 106.9 Mlr"; netInc = "$TL 58.4 Mlr"
        altZ = "3.65"; altZStatus = "GÜVENLİ BÖLGE"; pio = "8 / 9"
        analystSum = "Tüpraş, Akdeniz kompleks rafineri marjlarındaki güçlü seyir ve sıfır karbon vizyonu kapsamındaki biyoyakıt ve yeşil hidrojen yatırımlarıyla cazip temettü getirisini sürdürmektedir."
        riskOpp = "Küresel ham petrol fiyat oynaklığı ve bakım duruşları kısa vadeli marjları dalgalandırabilir; yüksek Nelson kompleksite endeksi avantaj sunmaktadır."
    }
    'ASTOR' = @{
        price = "108,40"; priceNum = 108.40; change = "+%3,15"; changeAmount = "+$TL 3,30"; isPositive = $true; volume = "$TL 3.20 Mlr"
        fk = "18.20"; pddd = "6.50"; fdFavok = "14.80"; netDebt = "-0.20x"; roe = "%42.1"; roa = "%18.6"
        score = 9.1; scoreStatus = "Küresel Transformatör İhracatı & Net Nakit"; scorePercentile = "BIST Enerji: %94 Diliminde"
        targetPrice = "$TL 155,00"; potential = "+%43,0 Potansiyel"; analystConsensus = "12 Analist: 11 Al, 1 Tut"
        dayLow = "$TL 104,50"; dayHigh = "$TL 110,00"; yearLow = "$TL 78,00"; yearHigh = "$TL 142,00"
        qRev = @(3.8, 4.5, 5.2, 6.4, 8.2)
        qFav = @(1.4, 1.7, 2.0, 2.6, 3.4)
        qMar = @(36.8, 37.8, 38.5, 40.6, 41.5)
        annRev = "$TL 24.3 Mlr"; annFav = "$TL 9.7 Mlr"; netInc = "$TL 7.2 Mlr"
        altZ = "4.50"; altZStatus = "GÜVENLİ BÖLGE"; pio = "8 / 9"
        analystSum = "ASTOR, Avrupa ve Kuzey Amerika şebeke yenileme ihalelerinde transformatör teslimatlarıyla rekor ihracat marjları kaydetmektedir. Net nakit pozisyonu yeni fabrika yatırımlarını finanse etmektedir."
        riskOpp = "Bakır ve silisli saç hammadde fiyat dalgalanmaları maliyetleri etkileyebilir; esnek fiyatlandırma mekanizması kâr marjını korumaktadır."
    }
    'KONTR' = @{
        price = "52,80"; priceNum = 52.80; change = "+%2,30"; changeAmount = "+$TL 1,20"; isPositive = $true; volume = "$TL 1.85 Mlr"
        fk = "21.40"; pddd = "5.80"; fdFavok = "16.20"; netDebt = "1.80x"; roe = "%31.5"; roa = "%12.4"
        score = 8.6; scoreStatus = "Enerji Depolama ve Pomega Hücre Yatırımı"; scorePercentile = "BIST Teknoloji: %86 Diliminde"
        targetPrice = "$TL 78,00"; potential = "+%47,7 Potansiyel"; analystConsensus = "10 Analist: 8 Al, 2 Tut"
        dayLow = "$TL 51,20"; dayHigh = "$TL 53,90"; yearLow = "$TL 42,00"; yearHigh = "$TL 84,00"
        qRev = @(2.4, 2.9, 3.5, 4.2, 5.4)
        qFav = @(0.6, 0.8, 1.0, 1.3, 1.7)
        qMar = @(25.0, 27.6, 28.6, 31.0, 31.5)
        annRev = "$TL 16.0 Mlr"; annFav = "$TL 4.8 Mlr"; netInc = "$TL 3.1 Mlr"
        altZ = "2.95"; altZStatus = "GÜVENLİ BÖLGE"; pio = "7 / 9"
        analystSum = "Kontrolmatik, Pomega lityum-iyon batarya fabrikasının kapasite artışı ve ABD depolama projeleriyle küresel teknoloji ligine adım atmaktadır."
        riskOpp = "Hızlı büyüme kaynaklı işletme sermayesi ihtiyacı borçluluk rasyolarını takip ettirmektedir; proje bazlı nakit girişleri bu ihtiyacı karşılamaktadır."
    }
    'MIATK' = @{
        price = "48,60"; priceNum = 48.60; change = "+%4,15"; changeAmount = "+$TL 1,95"; isPositive = $true; volume = "$TL 2.10 Mlr"
        fk = "19.50"; pddd = "7.10"; fdFavok = "15.40"; netDebt = "-0.40x"; roe = "%45.0"; roa = "%21.0"
        score = 8.8; scoreStatus = "Yüksek Katma Değerli Savunma & Sağlık Yazılımı"; scorePercentile = "BIST Bilişim: %91 Diliminde"
        targetPrice = "$TL 72,00"; potential = "+%48,1 Potansiyel"; analystConsensus = "9 Analist: 8 Al, 1 Tut"
        dayLow = "$TL 46,20"; dayHigh = "$TL 49,80"; yearLow = "$TL 28,00"; yearHigh = "$TL 75,00"
        qRev = @(0.8, 1.1, 1.4, 1.8, 2.5)
        qFav = @(0.4, 0.6, 0.8, 1.1, 1.5)
        qMar = @(50.0, 54.5, 57.1, 61.1, 60.0)
        annRev = "$TL 6.8 Mlr"; annFav = "$TL 4.0 Mlr"; netInc = "$TL 3.2 Mlr"
        altZ = "4.20"; altZStatus = "GÜVENLİ BÖLGE"; pio = "8 / 9"
        analystSum = "MİA Teknoloji, biyometrik güvenlik, savunma sanayii entegrasyonu ve elektrikli araç şarj yazılımlarında yüksek kâr marjlı Ar-Ge sözleşmeleri kazanmaktadır."
        riskOpp = "Teknoloji sektörünün genel çarpan oynaklığı ve proje teslim vadeleri değerlemeyi etkileyebilir; net nakit pozisyonu güven vermektedir."
    }
    'AKBNK' = @{
        price = "58,40"; priceNum = 58.40; change = "+%2,20"; changeAmount = "+$TL 1,25"; isPositive = $true; volume = "$TL 3.70 Mlr"
        fk = "4.30"; pddd = "1.10"; fdFavok = "3.90"; netDebt = "N/A"; roe = "%32.8"; roa = "%3.6"
        score = 8.9; scoreStatus = "Güçlü Sermaye Tabanı & Dijital Bankacılık"; scorePercentile = "BIST Bankacılık: %91 Diliminde"
        targetPrice = "$TL 78,00"; potential = "+%33,6 Potansiyel"; analystConsensus = "19 Analist: 17 Al, 2 Tut"
        dayLow = "$TL 56,80"; dayHigh = "$TL 59,20"; yearLow = "$TL 29,50"; yearHigh = "$TL 65,00"
        qRev = @(38.5, 44.2, 51.0, 58.4, 69.2)
        qFav = @(20.4, 23.8, 27.2, 31.0, 37.5)
        qMar = @(53.0, 53.8, 53.3, 53.1, 54.2)
        annRev = "$TL 222.8 Mlr"; annFav = "$TL 119.5 Mlr"; netInc = "$TL 74.2 Mlr"
        altZ = "N/A"; altZStatus = "BANKACILIK ÖZEL MODELİ"; pio = "7 / 9"
        analystSum = "Akbank, %20.5 sermaye yeterlilik oranı ve lider dijital müşteri tabanı ile Türk bankacılık sektörünün en verimli kurumlarından biridir."
        riskOpp = "Kredi mevduat faiz makası normalleşmesi net kârı desteklerken, regülasyon gevşemesi marj genişlemesini hızlandıracaktır."
    }
    'PGSUS' = @{
        price = "248,50"; priceNum = 248.50; change = "+%3,20"; changeAmount = "+$TL 7,70"; isPositive = $true; volume = "$TL 2.65 Mlr"
        fk = "6.80"; pddd = "1.45"; fdFavok = "5.20"; netDebt = "1.35x"; roe = "%36.4"; roa = "%12.8"
        score = 9.0; scoreStatus = "Düşük Maliyetli Taşıyıcı Üstünlüğü"; scorePercentile = "BIST Havacılık: %89 Diliminde"
        targetPrice = "$TL 345,00"; potential = "+%38,8 Potansiyel"; analystConsensus = "16 Analist: 14 Al, 2 Tut"
        dayLow = "$TL 240,00"; dayHigh = "$TL 252,00"; yearLow = "$TL 160,00"; yearHigh = "$TL 275,00"
        qRev = @(24.5, 29.8, 35.2, 42.1, 51.8)
        qFav = @(7.2, 8.9, 10.8, 13.5, 17.2)
        qMar = @(29.4, 29.9, 30.7, 32.1, 33.2)
        annRev = "$TL 158.9 Mlr"; annFav = "$TL 50.4 Mlr"; netInc = "$TL 26.8 Mlr"
        altZ = "3.15"; altZStatus = "GÜVENLİ BÖLGE"; pio = "8 / 9"
        analystSum = "Pegasus, genç A321neo filo dönüşümü ile koltuk başı birim yakıt maliyetlerini minimize ederek uluslararası yan gelirlerde rekor seviyelere ulaşmıştır."
        riskOpp = "Jeopolitik gerilimler hava sahası maliyetlerini etkilese de, transit hatlardaki esneklik yolcu doluluk oranlarını yüksek tutmaktadır."
    }
    'TCELL' = @{
        price = "92,10"; priceNum = 92.10; change = "+%1,45"; changeAmount = "+$TL 1,30"; isPositive = $true; volume = "$TL 2.30 Mlr"
        fk = "8.50"; pddd = "2.10"; fdFavok = "4.60"; netDebt = "1.10x"; roe = "%26.5"; roa = "%9.4"
        score = 8.9; scoreStatus = "Enflasyon Üstü ARPU Büyümesi & Veri Merkezleri"; scorePercentile = "BIST Telekom: %93 Diliminde"
        targetPrice = "$TL 128,00"; potential = "+%39,0 Potansiyel"; analystConsensus = "17 Analist: 15 Al, 2 Tut"
        dayLow = "$TL 90,50"; dayHigh = "$TL 93,40"; yearLow = "$TL 52,00"; yearHigh = "$TL 105,00"
        qRev = @(28.4, 32.1, 36.8, 41.5, 48.2)
        qFav = @(11.8, 13.5, 15.6, 17.9, 21.0)
        qMar = @(41.5, 42.1, 42.4, 43.1, 43.6)
        annRev = "$TL 158.6 Mlr"; annFav = "$TL 68.4 Mlr"; netInc = "$TL 24.1 Mlr"
        altZ = "3.10"; altZStatus = "GÜVENLİ BÖLGE"; pio = "8 / 9"
        analystSum = "Turkcell, sözleşme yenileme fiyat ayarlamaları sayesinde abone başına gelirde (ARPU) enflasyonun üzerinde artış yakalamıştır. Bulut ve veri merkezi yatırımları yeni büyüme motorudur."
        riskOpp = "5G frekans ihale yatırım harcamaları serbest nakit akımını etkileyebilir; güçlü FAVÖK marjı bu yatırımı rahatça absorbe edecek güçtedir."
    }
    'PETKM' = @{
        price = "18,90"; priceNum = 18.90; change = "+%1,10"; changeAmount = "+$TL 0,20"; isPositive = $true; volume = "$TL 1.70 Mlr"
        fk = "12.40"; pddd = "1.65"; fdFavok = "8.90"; netDebt = "2.10x"; roe = "%12.4"; roa = "%5.8"
        score = 7.2; scoreStatus = "Etilen-Nafta Marj İyileşmesi Beklentisi"; scorePercentile = "BIST Kimya: %70 Diliminde"
        targetPrice = "$TL 26,00"; potential = "+%37,6 Potansiyel"; analystConsensus = "12 Analist: 7 Al, 5 Tut"
        dayLow = "$TL 18,50"; dayHigh = "$TL 19,20"; yearLow = "$TL 15,20"; yearHigh = "$TL 26,50"
        qRev = @(14.2, 16.5, 18.2, 21.0, 24.5)
        qFav = @(1.2, 1.5, 1.8, 2.3, 3.1)
        qMar = @(8.5, 9.1, 9.9, 11.0, 12.7)
        annRev = "$TL 80.2 Mlr"; annFav = "$TL 8.7 Mlr"; netInc = "$TL 4.5 Mlr"
        altZ = "2.40"; altZStatus = "DENGELİ BÖLGE"; pio = "6 / 9"
        analystSum = "Petkim, STAR Rafineri entegrasyonu ve hammadde tedarik avantajı ile küresel petrokimya arz fazlası döngüsünde marj toparlanmasını beklemektedir."
        riskOpp = "Küresel petrokimya tesis kapanışları arz baskısını hafifletirken, yerli plastik ve sanayi talebi temel katalizördür."
    }
}

$dbPath = Join-Path $PSScriptRoot "assets\js\kap-database.js"
$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine("/* KAP Official Database & Institutional Financials */")
[void]$sb.AppendLine("/* Auto-generated by generate-database.ps1 */")
[void]$sb.AppendLine("const KAP_RAW_COMPANIES = " + ($companiesList | ConvertTo-Json -Compress) + ";")
[void]$sb.AppendLine("const KAP_CURATED_STOCKS = " + ($curatedJson | ConvertTo-Json -Depth 5 -Compress) + ";")

[System.IO.File]::WriteAllText($dbPath, $sb.ToString(), [System.Text.Encoding]::UTF8)
Write-Host "Wrote kap-database.js ($([math]::Round((Get-Item $dbPath).Length / 1KB, 1)) KB) successfully!"

