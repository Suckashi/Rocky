# Starts Rocky on this computer, or opens it if it is already running.
# Works with Windows PowerShell 5.1 and PowerShell 7. Saved as UTF-8 with BOM: without it,
# PowerShell 5.1 reads the file in the ANSI code page and garbles the Chinese text.
# Usage: right-click > Run with PowerShell,
# or in a terminal: powershell -ExecutionPolicy Bypass -File .\Start-Rocky.ps1
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$port = if ($env:ROCKY_PORT) { [int]$env:ROCKY_PORT } else { 4317 }
$dataDir = if ($env:ROCKY_DATA_DIR) { $env:ROCKY_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'Rocky' }
$tokenFile = Join-Path $dataDir 'api-token'

# Already running: ask it for a fresh one-time login URL and open the browser.
if (Test-Path -LiteralPath $tokenFile) {
  $token = (Get-Content -LiteralPath $tokenFile -Raw).Trim()
  try {
    $reply = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/login-code" `
      -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body '{}' -TimeoutSec 3
    Start-Process $reply.url
    exit 0
  } catch {
    # Not running (or an old token): start it below.
  }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Rocky 需要 Node.js 24：https://nodejs.org/  /  Rocky needs Node.js 24: https://nodejs.org/'
  exit 1
}
$version = (& node -p 'process.versions.node').Trim()
if ($version -notmatch '^24\.') {
  Write-Host "Rocky 需要 Node.js 24，目前是 $version。 / Rocky needs Node.js 24; found $version."
  exit 1
}

# First run, or the lockfile changed: install exactly the pinned dependencies (no compiler needed).
# -Force: PowerShell treats dot files as hidden outside Windows and Get-Item would not find it.
$installed = Join-Path 'node_modules' '.package-lock.json'
if (-not (Test-Path -LiteralPath $installed) -or
    (Get-Item -LiteralPath 'package-lock.json').LastWriteTime -gt (Get-Item -LiteralPath $installed -Force).LastWriteTime) {
  & npm ci
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

& npm start
exit $LASTEXITCODE
