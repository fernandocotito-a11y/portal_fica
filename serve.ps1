# serve.ps1 — Servidor estático de desarrollo (alternativa a server.js sin Node)
# Uso:  powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 3000
param([int]$Port = 3000)

$root = (Get-Location).Path
$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch { Write-Output ("LISTENER_ERROR: " + $_.Exception.Message); exit 1 }
Write-Output ("SERVING " + $root + " on http://localhost:$Port/")

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
  } catch { break }
  $req = $ctx.Request
  $res = $ctx.Response
  $rawPath = $req.Url.AbsolutePath
  $path = [System.Uri]::UnescapeDataString($rawPath)
  if ($path -eq '/') { $path = '/index.html' }
  $relative = $path.TrimStart('/').Replace('/', '\')
  $filePath = Join-Path $root $relative

  if (Test-Path -LiteralPath $filePath -PathType Leaf) {
    $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
    $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    $res.StatusCode = 200
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $res.StatusCode = 404
    $res.ContentType = 'text/plain; charset=utf-8'
    $msg = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
    $res.OutputStream.Write($msg, 0, $msg.Length)
  }
  $res.Close()
}
