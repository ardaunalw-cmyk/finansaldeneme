# ONCE AND ALWAYS - High-Performance Zero-Dependency Static Web Server
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$port = 8080
$localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch "Loopback|vEthernet" -and $_.IPAddress -notlike "169.254*" } | Select-Object -First 1).IPAddress
if ([string]::IsNullOrWhiteSpace($localIp)) { $localIp = "127.0.0.1" }

$tcpListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   ONCE & ALWAYS - Finansal Terminal Web Sunucusu        " -ForegroundColor White
Write-Host "   Bilgisayarda Ac:  http://localhost:$port/              " -ForegroundColor Green
Write-Host "   Telefonda Ac:     http://$($localIp):$port/           " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Durdurmak icin pencereyi kapatabilir veya Ctrl+C yapabilirsiniz.`n" -ForegroundColor Gray

$mimeTypes = @{
    '.html'  = 'text/html; charset=utf-8'
    '.css'   = 'text/css; charset=utf-8'
    '.js'    = 'application/javascript; charset=utf-8'
    '.json'  = 'application/json; charset=utf-8'
    '.png'   = 'image/png'
    '.jpg'   = 'image/jpeg'
    '.jpeg'  = 'image/jpeg'
    '.svg'   = 'image/svg+xml'
    '.woff2' = 'font/woff2'
    '.woff'  = 'font/woff'
    '.ttf'   = 'font/ttf'
    '.ico'   = 'image/x-icon'
}

try {
    $tcpListener.Start()
    while ($true) {
        $client = $tcpListener.AcceptTcpClient()
        [System.Threading.Tasks.Task]::Run([Action]{
            try {
                $stream = $client.GetStream()
                $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII)
                $requestLine = $reader.ReadLine()
                if ([string]::IsNullOrWhiteSpace($requestLine)) {
                    $client.Close()
                    return
                }

                $parts = $requestLine.Split(' ')
                if ($parts.Length -lt 2) {
                    $client.Close()
                    return
                }

                $method = $parts[0]
                $rawUrl = $parts[1]

                # Drain remaining request headers
                while ($true) {
                    $h = $reader.ReadLine()
                    if ([string]::IsNullOrWhiteSpace($h)) { break }
                }

                # Parse Path & Query
                $path = $rawUrl.Split('?')[0].TrimStart('/')
                if ([string]::IsNullOrWhiteSpace($path) -or $path -eq '/') {
                    $path = 'index.html'
                }

                $fullPath = Join-Path $PSScriptRoot $path
                $writer = [System.IO.BinaryWriter]::new($stream)

                if (Test-Path $fullPath -PathType Leaf) {
                    $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
                    $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
                    $bytes = [System.IO.File]::ReadAllBytes($fullPath)

                    $headerStr = "HTTP/1.1 200 OK`r`n" +
                                 "Content-Type: $contentType`r`n" +
                                 "Content-Length: $($bytes.Length)`r`n" +
                                 "Access-Control-Allow-Origin: *`r`n" +
                                 "Cache-Control: no-cache`r`n" +
                                 "Connection: close`r`n`r`n"

                    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerStr)
                    $writer.Write($headerBytes)
                    $writer.Write($bytes)
                } else {
                    $notFoundBody = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
                    $headerStr = "HTTP/1.1 404 Not Found`r`n" +
                                 "Content-Type: text/plain`r`n" +
                                 "Content-Length: $($notFoundBody.Length)`r`n" +
                                 "Connection: close`r`n`r`n"
                    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerStr)
                    $writer.Write($headerBytes)
                    $writer.Write($notFoundBody)
                }
                $writer.Flush()
                $client.Close()
            } catch {
                try { $client.Close() } catch {}
            }
        }) | Out-Null
    }
} finally {
    $tcpListener.Stop()
}
