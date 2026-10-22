# Generate optimized KAP Database for UTL Finans
# NOTE: This file must stay saved as UTF-8 *with BOM*; otherwise Windows PowerShell 5.1
# reads it as ANSI and every Turkish literal below ends up mojibake in kap-database.js.
# Usage: .\generate-database.ps1 [-Offline]   (-Offline skips the KAP download and uses data\kap-all.json)
param([switch]$Offline)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Raw source lives outside assets/ so it is not deployed to clients
$rawPath = Join-Path $PSScriptRoot "data\kap-all.json"

Write-Host "Fetching all 1049+ companies from KAP (IGS/ALL)..."
try {
    if ($Offline) { throw "Offline mode requested" }
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
    # Short keywords need word boundaries: 'ET' otherwise matches every 'TICARET'
    if ($cleanT -match 'GIDA|\bUN\b|SEKER|\bSUT|\bET\b|ICECEK|TARIM|MEYVE|ZEYTIN') { return 'Gıda, Tarım & İçecek' }
    if ($cleanT -match 'TEKSTIL|MENSUCAT|\bYUN\b|IPLIK|\bDERI\b|GIYIM') { return 'Tekstil & Konfeksiyon' }
    if ($cleanT -match 'HOLDING') { return 'Holding & Girişim Sermayesi' }
    if ($cleanT -match 'MADEN|MADENCILIK|MERMER') { return 'Madencilik & Doğal Kaynaklar' }
    if ($cleanT -match 'OTOMOTIV|MOTOR|TASIT|\bARAC\b|ARACLARI') { return 'Otomotiv & Ulaşım Araçları' }
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

    # Compact record: fields equal to the client-side defaults are omitted.
    # 's' only carries colloquial aliases; app.js already indexes code + name + sector.
    $rec = [ordered]@{ c = $code; n = $comp.kapMemberTitle }
    if ($aliasMap.ContainsKey($code)) { $rec.s = $aliasMap[$code] }
    $rec.sec = $sector
    if ($idx -ne "BIST TÜM") { $rec.idx = $idx }
    $rec.cap = Format-Money $paidCapNum
    $rec.capRaw = $paidCapNum
    $rec.ceil = Format-Money $capCeilNum
    if ($cCity -ne "İSTANBUL") { $rec.city = $cCity }
    $rec.aud = $cAuditor
    $rec.mkk = $comp.mkkMemberOid
    $rec.kap = $comp.kapMemberOid
    $rec.cc = $comp.companyCode

    $companiesList += [PSCustomObject]$rec
}

Write-Host "Processed $($companiesList.Count) unique listed companies."

$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine("/* KAP company registry (codes, names, sectors, capital, auditors) */")
[void]$sb.AppendLine("/* Auto-generated by generate-database.ps1 */")
[void]$sb.AppendLine("const KAP_RAW_COMPANIES = " + ($companiesList | ConvertTo-Json -Compress) + ";")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("if (typeof window !== 'undefined') { window.KAP_RAW_COMPANIES = KAP_RAW_COMPANIES; }")

[System.IO.File]::WriteAllText($dbPath, $sb.ToString(), [System.Text.Encoding]::UTF8)
Write-Host "Wrote kap-database.js ($([math]::Round((Get-Item $dbPath).Length / 1KB, 1)) KB) successfully!"

