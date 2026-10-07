param([switch]$NoOpen)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$viewerUrl = 'http://127.0.0.1:4321/assets/index.html'
$builtIndex = Join-Path $PSScriptRoot 'app\src\main\assets\index.html'

if (!(Test-Path -LiteralPath $builtIndex)) {
  & npm.cmd run build
  if ($LASTEXITCODE) { throw 'Acu Map website build failed.' }
}

$serverReady = $false
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $viewerUrl -TimeoutSec 1
  $serverReady = $response.StatusCode -eq 200
} catch {}

if (!$serverReady) {
  $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
  Start-Process -FilePath $nodeExe -ArgumentList 'scripts/serve-built.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden

  foreach ($attempt in 1..40) {
    Start-Sleep -Milliseconds 250
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $viewerUrl -TimeoutSec 1
      if ($response.StatusCode -eq 200) {
        $serverReady = $true
        break
      }
    } catch {}
  }
}

if (!$serverReady) { throw "The Acu Map server did not start at $viewerUrl" }
if (!$NoOpen) { Start-Process $viewerUrl }
Write-Output "Acu Map website: $viewerUrl"
