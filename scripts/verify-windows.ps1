# Checks Rocky on this Windows computer and writes a summary to paste back.
# Works with Windows PowerShell 5.1 and PowerShell 7. Saved as UTF-8 with BOM (see Start-Rocky.ps1).
#
# Usage, in a terminal in the Rocky folder:
#   powershell -ExecutionPolicy Bypass -File .\scripts\verify-windows.ps1
# With the live-model evaluation (about 30-60 minutes; uses your API key, never printed or saved):
#   powershell -ExecutionPolicy Bypass -File .\scripts\verify-windows.ps1 -Eval `
#     -EvalBaseUrl https://api.example.com/v1 -EvalModel some/model
#
# Each step's full output goes to verify-results\<time>\<step>.log (ignored by Git); the summary is
# summary.md in the same folder. Nothing here touches your real Rocky data folder or settings.
param(
  [switch]$Eval,
  [string]$EvalBaseUrl = $env:ROCKY_EVAL_BASE_URL,
  [string]$EvalModel = $env:ROCKY_EVAL_MODEL,
  [int]$EvalRepeat = 3,
  # A Chromium-based browser for the end-to-end tests; default: the system Edge.
  [string]$Browser = $env:ROCKY_E2E_BROWSER
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

$onWindows = ($PSVersionTable.PSVersion.Major -lt 6) -or $IsWindows
$npm = if ($onWindows) { 'npm.cmd' } else { 'npm' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path (Join-Path $root 'verify-results') $stamp
New-Item -ItemType Directory -Force -Path $out | Out-Null

# The API key for the evaluation: from the environment, or asked for without echoing it.
$apiKey = $env:ROCKY_EVAL_API_KEY
if ($Eval -and -not $apiKey) {
  $secure = Read-Host -AsSecureString '評測用的 API key（不會顯示、不會存檔） / API key for the evaluation (hidden, not saved)'
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# Logs never keep the key, even if a tool printed it.
function Hide-Secret([string]$path) {
  if (-not $apiKey -or -not (Test-Path -LiteralPath $path)) { return }
  $text = [IO.File]::ReadAllText($path)
  if ($text.Contains($apiKey)) { [IO.File]::WriteAllText($path, $text.Replace($apiKey, '[redacted]')) }
}

function First-Line([string]$file, [string[]]$arguments) {
  try { return ((& $file @arguments 2>&1) | Select-Object -First 1).ToString().Trim() }
  catch { return '(not found)' }
}

Write-Host '開始前請先關閉正在執行的 Rocky。 / Close Rocky first if it is running.'

# --- The machine ---
$os = if ($onWindows) {
  $info = Get-CimInstance Win32_OperatingSystem
  "$($info.Caption) $($info.Version) ($($info.OSArchitecture))"
} else { [Environment]::OSVersion.VersionString }
$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
$openCode = if ($env:ROCKY_OPENCODE_BIN) { $env:ROCKY_OPENCODE_BIN }
            else { (Get-Command opencode -ErrorAction SilentlyContinue | Select-Object -First 1).Source }
$font = if ($onWindows) { Test-Path -LiteralPath (Join-Path $env:WINDIR 'Fonts\msjh.ttc') } else { $null }
$machine = [ordered]@{
  'Windows'      = $os
  'PowerShell'   = $PSVersionTable.PSVersion.ToString()
  'Node.js'      = First-Line 'node' @('-v')
  'npm'          = First-Line $npm @('-v')
  'Git'          = First-Line 'git' @('--version')
  'Git commit'   = First-Line 'git' @('rev-parse', '--short', 'HEAD')
  'Edge'         = if ($edge) { $edge } else { '(not found)' }
  'Browser used' = if ($Browser) { $Browser } else { 'Edge (msedge channel)' }
  'OpenCode'     = if ($openCode) { "$openCode ($(First-Line $openCode @('--version')))" } else { '(not found)' }
  'msjh.ttc'     = if ($null -eq $font) { 'n/a' } elseif ($font) { 'present' } else { 'missing' }
}

# --- Steps ---
$results = New-Object System.Collections.ArrayList
$total = 7

function Invoke-Step([int]$n, [string]$name, [string]$file, [string[]]$arguments, [hashtable]$envVars) {
  $log = Join-Path $out "$n-$name.log"
  $command = "$file $($arguments -join ' ')"
  Write-Host ("[{0}/{1}] {2} ..." -f $n, $total, $command)
  $saved = @{}
  foreach ($k in $envVars.Keys) {
    $saved[$k] = [Environment]::GetEnvironmentVariable($k)
    [Environment]::SetEnvironmentVariable($k, $envVars[$k])
  }
  $watch = [Diagnostics.Stopwatch]::StartNew()
  try {
    $errLog = "$log.stderr"
    $p = Start-Process -FilePath $file -ArgumentList $arguments -NoNewWindow -PassThru `
      -RedirectStandardOutput $log -RedirectStandardError $errLog
    $null = $p.Handle  # keeps the exit code readable after the process ends
    $p.WaitForExit()
    $code = $p.ExitCode
    Add-Content -LiteralPath $log -Value (Get-Content -LiteralPath $errLog -Raw -ErrorAction SilentlyContinue)
    Remove-Item -LiteralPath $errLog -ErrorAction SilentlyContinue
  } catch {
    $code = -1
    Add-Content -LiteralPath $log -Value "Could not start: $($_.Exception.Message)"
  } finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  }
  $watch.Stop()
  Hide-Secret $log
  $result = if ($code -eq 0) { 'PASS' } else { 'FAIL' }
  Write-Host ("      {0} (exit {1}, {2:N0} s)" -f $result, $code, $watch.Elapsed.TotalSeconds)
  [void]$results.Add([pscustomobject]@{ N = $n; Name = $name; Command = $command; Exit = $code;
    Seconds = [int]$watch.Elapsed.TotalSeconds; Result = $result; Log = $log; Note = '' })
}

function Skip-Step([int]$n, [string]$name, [string]$command, [string]$why) {
  Write-Host ("[{0}/{1}] {2}: SKIPPED ({3})" -f $n, $total, $command, $why)
  [void]$results.Add([pscustomobject]@{ N = $n; Name = $name; Command = $command; Exit = '';
    Seconds = 0; Result = 'SKIPPED'; Log = ''; Note = $why })
}

$e2eEnv = @{ ROCKY_E2E_SCREENSHOTS = (New-Item -ItemType Directory -Force -Path (Join-Path $out 'screenshots')).FullName }
if ($Browser) { $e2eEnv['ROCKY_E2E_BROWSER'] = $Browser }
$checkEnv = @{}
if ($openCode) { $checkEnv['ROCKY_REQUIRE_OPENCODE'] = '1'; $checkEnv['ROCKY_OPENCODE_BIN'] = $openCode; $e2eEnv['ROCKY_OPENCODE_BIN'] = $openCode }

Invoke-Step 1 'npm-ci' $npm @('ci') @{}
Invoke-Step 2 'check' $npm @('run', 'check') $checkEnv
Invoke-Step 3 'e2e' $npm @('run', 'test:e2e') $e2eEnv
if ($openCode) { Invoke-Step 4 'e2e-jobs' $npm @('run', 'test:e2e:jobs') $e2eEnv }
else { Skip-Step 4 'e2e-jobs' "$npm run test:e2e:jobs" 'OpenCode not installed (npm i -g opencode-ai)' }

# 5. The launcher itself: start it with a throwaway data folder and port, wait for the server,
# stop it, then check nothing is left listening on the port.
$port = 4300 + (Get-Random -Maximum 90)
$launchLog = Join-Path $out '5-start-rocky.log'
Write-Host ("[5/{0}] Start-Rocky.ps1 (port {1}, temporary data folder) ..." -f $total, $port)
$watch = [Diagnostics.Stopwatch]::StartNew()
$dataDir = Join-Path ([IO.Path]::GetTempPath()) "rocky-verify-$stamp"
$saved = @{ ROCKY_DATA_DIR = $env:ROCKY_DATA_DIR; ROCKY_PORT = $env:ROCKY_PORT; ROCKY_OPEN_BROWSER = $env:ROCKY_OPEN_BROWSER }
$env:ROCKY_DATA_DIR = $dataDir; $env:ROCKY_PORT = "$port"; $env:ROCKY_OPEN_BROWSER = '0'
$shell = if ($onWindows) { 'powershell.exe' } else { (Get-Process -Id $PID).Path }
$launcher = Start-Process -FilePath $shell -PassThru -NoNewWindow `
  -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'Start-Rocky.ps1')) `
  -RedirectStandardOutput $launchLog -RedirectStandardError "$launchLog.stderr"
$null = $launcher.Handle
foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
function Test-Port([int]$port) {
  $client = New-Object Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1', $port); return $true } catch { return $false } finally { $client.Dispose() }
}
$up = $false
for ($i = 0; $i -lt 120 -and -not $launcher.HasExited; $i++) {
  if (Test-Port $port) { $up = $true; break }
  Start-Sleep -Seconds 1
}
$page = ''
if ($up) {
  try { $page = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/" -TimeoutSec 10).StatusCode }
  catch { $page = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { $_.Exception.Message } }
}
# Stop the launcher and everything it started (the same tree kill Rocky uses on Windows).
function Stop-Tree([int]$id) {
  if ($onWindows) { & taskkill.exe /PID $id /T /F 2>&1 | Out-Null; return }
  $kids = @((& ps -o pid= --ppid $id) -split '\s+' | Where-Object { $_ })
  foreach ($kid in $kids) { Stop-Tree ([int]$kid) }
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
}
if (-not $launcher.HasExited) { Stop-Tree $launcher.Id }
Start-Sleep -Seconds 3
$left = Test-Port $port
if ($left -and $onWindows) {
  # Something survived the tree kill (see the Job Object note in docs/adr/0007): name it.
  $owner = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
  if ($owner) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $owner"
    Add-Content -LiteralPath $launchLog -Value "Still listening after stop: PID $owner $($proc.Name) $($proc.CommandLine)"
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
  }
}
Add-Content -LiteralPath $launchLog -Value (Get-Content -LiteralPath "$launchLog.stderr" -Raw -ErrorAction SilentlyContinue)
Remove-Item -LiteralPath "$launchLog.stderr" -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue
$watch.Stop()
$ok = $up -and -not $left
$note = "server up: $up; GET / -> $page; still listening after stop: $left"
Write-Host ("      {0} ({1}, {2:N0} s)" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $note, $watch.Elapsed.TotalSeconds)
[void]$results.Add([pscustomobject]@{ N = 5; Name = 'start-rocky'; Command = 'Start-Rocky.ps1'; Exit = '';
  Seconds = [int]$watch.Elapsed.TotalSeconds; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }); Log = $launchLog; Note = $note })

# 6. Leftover processes: anything still running from this folder after the tests.
$here = $root.ToLower()
$leftover = @()
if ($onWindows) {
  $leftover = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'opencode.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($here) -and $_.ProcessId -ne $PID })
}
$names = ($leftover | ForEach-Object { "PID $($_.ProcessId) $($_.Name): $($_.CommandLine)" }) -join '; '
$result6 = if ($leftover.Count -eq 0) { 'PASS' } else { 'FAIL' }
Write-Host ("[6/{0}] leftover processes: {1}" -f $total, $(if ($names) { $names } else { 'none' }))
[void]$results.Add([pscustomobject]@{ N = 6; Name = 'leftovers'; Command = 'Get-CimInstance Win32_Process'; Exit = '';
  Seconds = 0; Result = $result6; Log = ''; Note = $(if ($names) { $names } else { 'none' }) })

# 7. The live-model evaluation, only when asked for.
if ($Eval) {
  if (-not $EvalBaseUrl -or -not $EvalModel -or -not $apiKey) {
    Skip-Step 7 'eval' "$npm run eval" 'needs -EvalBaseUrl, -EvalModel and an API key'
  } else {
    $evalEnv = @{ ROCKY_EVAL_BASE_URL = $EvalBaseUrl; ROCKY_EVAL_MODEL = $EvalModel; ROCKY_EVAL_API_KEY = $apiKey }
    if ($openCode) { $evalEnv['ROCKY_OPENCODE_BIN'] = $openCode }
    Invoke-Step 7 'eval' $npm @('run', 'eval', '--', '--repeat', "$EvalRepeat") $evalEnv
  }
} else {
  Skip-Step 7 'eval' "$npm run eval" 'not requested (add -Eval)'
}

# --- Summary ---
$lines = New-Object System.Collections.ArrayList
[void]$lines.Add("# Rocky Windows verification $stamp")
[void]$lines.Add('')
foreach ($k in $machine.Keys) { [void]$lines.Add("- ${k}: $($machine[$k])") }
[void]$lines.Add('')
[void]$lines.Add('| # | Command | Exit | Seconds | Result | Note |')
[void]$lines.Add('| - | ------- | ---- | ------- | ------ | ---- |')
foreach ($r in $results) { [void]$lines.Add("| $($r.N) | ``$($r.Command)`` | $($r.Exit) | $($r.Seconds) | $($r.Result) | $($r.Note) |") }
foreach ($r in $results) {
  if ($r.Result -ne 'FAIL' -or -not $r.Log -or -not (Test-Path -LiteralPath $r.Log)) { continue }
  # The end of a failed step's log: where the error is. ANSI colours are removed.
  $tail = Get-Content -LiteralPath $r.Log -Tail 60 | ForEach-Object { $_ -replace "\x1b\[[0-9;]*m", '' }
  [void]$lines.Add('')
  [void]$lines.Add("## $($r.N) $($r.Name): last lines of the log")
  [void]$lines.Add('')
  [void]$lines.Add('```')
  foreach ($l in $tail) { [void]$lines.Add($l) }
  [void]$lines.Add('```')
}
if ($Eval) {
  $evalLog = Join-Path $out '7-eval.log'
  if (Test-Path -LiteralPath $evalLog) {
    [void]$lines.Add('')
    [void]$lines.Add('## Evaluation')
    [void]$lines.Add('')
    [void]$lines.Add('```')
    Get-Content -LiteralPath $evalLog | Where-Object { $_ -cmatch 'FAIL|score|baseline|SKIPPED' }  # case-sensitive: not "failed" |
      ForEach-Object { [void]$lines.Add(($_ -replace "\x1b\[[0-9;]*m", '')) }
    [void]$lines.Add('```')
  }
}
$summary = Join-Path $out 'summary.md'
[IO.File]::WriteAllLines($summary, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
Hide-Secret $summary

$failed = @($results | Where-Object { $_.Result -eq 'FAIL' }).Count
Write-Host ''
Write-Host "摘要 / Summary: $summary"
Write-Host '請把 summary.md 的內容貼回對話 / Paste the contents of summary.md back into the chat.'
if ($failed -gt 0) { exit 1 } else { exit 0 }
