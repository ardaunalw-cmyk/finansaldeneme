# UTL FINANS - Static Web Server & KAP API Bridge in PowerShell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$port = 8080
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

Write-Host "=========================================================="
Write-Host "   UTL FINANS - Sovereign Intelligence Server running     "
Write-Host "   URL: http://localhost:$port/                          "
Write-Host "   Live KAP Bridge: Active                                "
Write-Host "=========================================================="

try {
    $listener.Start()
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        # Add CORS Headers for local development
        $response.AddHeader("Access-Control-Allow-Origin", "*")
        $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.AddHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

        if ($request.HttpMethod -eq 'OPTIONS') {
            $response.StatusCode = 204
            $response.Close()
            continue
        }

        $localPath = $request.Url.LocalPath.TrimStart('/')

        # -----------------------------------------------------------
        # API Route: Live KAP Disclosures Bridge
        # -----------------------------------------------------------
        if ($localPath -eq 'api/kap/disclosures') {
            $mkkOid = $request.QueryString['oid']
            $response.ContentType = 'application/json; charset=utf-8'

            if ([string]::IsNullOrWhiteSpace($mkkOid)) {
                $errorBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error": "Missing oid parameter"}')
                $response.OutputStream.Write($errorBytes, 0, $errorBytes.Length)
                $response.Close()
                continue
            }

            try {
                $today = (Get-Date).ToString('yyyy-MM-dd')
                $past = (Get-Date).AddDays(-45).ToString('yyyy-MM-dd')
                $body = @{
                    fromDate = $past
                    toDate = $today
                    mkkMemberOidList = @($mkkOid)
                    subjectList = @()
                } | ConvertTo-Json

                $kapUrl = 'https://www.kap.org.tr/tr/api/disclosure/members/byCriteria'
                $kapRes = Invoke-RestMethod -Uri $kapUrl -Method Post -Body $body -ContentType 'application/json' -Headers @{'User-Agent'='Mozilla/5.0'} -TimeoutSec 7
                $jsonRes = $kapRes | ConvertTo-Json -Depth 4
                $resBytes = [System.Text.Encoding]::UTF8.GetBytes($jsonRes)
                $response.OutputStream.Write($resBytes, 0, $resBytes.Length)
            } catch {
                $errJson = '{"error": "' + $_.Exception.Message.Replace('"', '\"') + '"}'
                $errBytes = [System.Text.Encoding]::UTF8.GetBytes($errJson)
                $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
            }
            $response.Close()
            continue
        }

        # -----------------------------------------------------------
        # Static Files Serving
        # -----------------------------------------------------------
        if ([string]::IsNullOrWhiteSpace($localPath) -or $localPath -eq '/') {
            $localPath = 'index.html'
        }

        $fullPath = Join-Path $PSScriptRoot $localPath

        if (Test-Path $fullPath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
            switch ($ext) {
                '.html' { $contentType = 'text/html; charset=utf-8' }
                '.css'  { $contentType = 'text/css; charset=utf-8' }
                '.js'   { $contentType = 'application/javascript; charset=utf-8' }
                '.json' { $contentType = 'application/json; charset=utf-8' }
                '.png'  { $contentType = 'image/png' }
                '.jpg'  { $contentType = 'image/jpeg' }
                '.jpeg' { $contentType = 'image/jpeg' }
                '.svg'  { $contentType = 'image/svg+xml' }
                default { $contentType = 'application/octet-stream' }
            }

            $bytes = [System.IO.File]::ReadAllBytes($fullPath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
        }
        $response.Close()
    }
} finally {
    $listener.Stop()
}
