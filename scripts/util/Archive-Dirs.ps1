<# 
Archive-Dirs.ps1
Copies a list of source directories to a destination root using Robocopy.
- Continues on errors (per-item)
- Produces logs and a summary at the end

Usage:
  powershell.exe -ExecutionPolicy Bypass -File .\Archive-Dirs.ps1 -ListFile "C:\lists\dirs.txt" -DestRoot "E:\Archive"

List file format:
  One full directory path per line. Blank lines and lines starting with # are ignored.
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$ListFile,

  [Parameter(Mandatory=$true)]
  [string]$DestRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Normalize-Path([string]$p) {
  # Expand environment variables and resolve relative paths
  $expanded = [Environment]::ExpandEnvironmentVariables($p)
  return (Resolve-Path -LiteralPath $expanded).Path
}

function Get-RelativePathForDest([string]$src) {
  # Recreate each source under DestRoot in a predictable way:
  # C:\Foo\Bar   ->  DestRoot\C\Foo\Bar
  # \\Server\Share\X -> DestRoot\UNC\Server\Share\X
  if ($src.StartsWith("\\\")) { } # no-op, just to avoid accidental escaping in editors
  if ($src.StartsWith("\\")) {
    $trim = $src.TrimStart("\")
    return Join-Path "UNC" $trim
  } else {
    $drive = $src.Substring(0,1)  # "C"
    $rest  = $src.Substring(2).TrimStart("\") # after "C:"
    return Join-Path $drive $rest
  }
}

# --- Validate inputs ---
if (-not (Test-Path -LiteralPath $ListFile)) {
  throw "List file not found: $ListFile"
}

if (-not (Test-Path -LiteralPath $DestRoot)) {
  New-Item -ItemType Directory -Path $DestRoot | Out-Null
}

$DestRoot = (Resolve-Path -LiteralPath $DestRoot).Path

# --- Read list ---
$rawLines = Get-Content -LiteralPath $ListFile -ErrorAction Stop
$srcDirs = @()
foreach ($line in $rawLines) {
  $t = $line.Trim()
  if ($t.Length -eq 0) { continue }
  if ($t.StartsWith("#")) { continue }
  $srcDirs += $t
}

if ($srcDirs.Count -eq 0) {
  throw "No source directories found in list file (after trimming comments/blanks)."
}

# --- Logging setup ---
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$sessionLogDir = Join-Path $DestRoot "_archive_logs_$timestamp"
New-Item -ItemType Directory -Path $sessionLogDir | Out-Null

$summary = New-Object System.Collections.Generic.List[object]

Write-Host "DestRoot: $DestRoot"
Write-Host "ListFile: $ListFile"
Write-Host "LogDir:   $sessionLogDir"
Write-Host "Items:    $($srcDirs.Count)"
Write-Host "------------------------------------------------------------"

# Robocopy flags:
# /E        copy subdirs incl empty
# /COPY:DAT copy data, attributes, timestamps (no ACLs) (change to /COPY:DATS if you want security too)
# /DCOPY:DAT copy dir timestamps too
# /R:1 /W:1 minimal retry (avoid long hangs on bad files; you can raise if you want)
# /Z        restartable mode (better resilience on flaky connections)
# /TEE      show output AND log
# /NP       no progress (cleaner logs)
# /NFL /NDL optional: reduce file/dir list spam (commented out by default)
# /XJ       exclude junction points (prevents some recursion surprises)
$roboCommon = @(
  "/E",
  "/COPY:DAT",
  "/DCOPY:DAT",
  "/R:1",
  "/W:1",
  "/Z",
  "/TEE",
  "/NP",
  "/XJ"
  #,"/NFL","/NDL"
)

foreach ($srcRaw in $srcDirs) {
  $start = Get-Date
  $src = $srcRaw
  $srcResolved = $null
  $status = "UNKNOWN"
  $exitCode = $null
  $dest = $null
  $logFile = $null
  $err = $null

  try {
    if (-not (Test-Path -LiteralPath $src)) {
      throw "Source directory not found: $src"
    }

    $srcResolved = Normalize-Path $src

    # Build destination path (recreate source structure under dest root)
    $rel = Get-RelativePathForDest $srcResolved
    $dest = Join-Path $DestRoot $rel

    # Ensure destination exists
    New-Item -ItemType Directory -Path $dest -Force | Out-Null

    $safeName = ($rel -replace "[\\\/:]", "_")
    $logFile = Join-Path $sessionLogDir ("robocopy_" + $safeName + ".log")

    Write-Host ""
    Write-Host "COPY: $srcResolved"
    Write-Host "  -> $dest"
    Write-Host "LOG:  $logFile"

    # Robocopy copies CONTENTS of source dir into dest dir when we use src and dest.
    $cmdArgs = @($srcResolved, $dest) + $roboCommon + @("/LOG+:$logFile")

    & robocopy @cmdArgs
    $exitCode = $LASTEXITCODE

    # Robocopy exit codes: 0-7 are generally "success with info"; >= 8 indicates failure.
    if ($exitCode -ge 8) {
      $status = "FAILED"
    } else {
      $status = "OK"
    }
  }
  catch {
    $status = "ERROR"
    $err = $_.Exception.Message
    Write-Host "ERROR: $err" -ForegroundColor Red
  }
  finally {
    $end = Get-Date
    $durationSec = [Math]::Round(($end - $start).TotalSeconds, 1)

    $summary.Add([pscustomobject]@{
      Source       = $srcRaw
      SourceResolved = $srcResolved
      Dest         = $dest
      Status       = $status
      RoboExitCode = $exitCode
      Seconds      = $durationSec
      LogFile      = $logFile
      Error        = $err
    }) | Out-Null
  }
}

# --- Write summary files ---
$summaryCsv = Join-Path $sessionLogDir "summary.csv"
$summaryJson = Join-Path $sessionLogDir "summary.json"

$summary | Export-Csv -NoTypeInformation -LiteralPath $summaryCsv
$summary | ConvertTo-Json -Depth 6 | Out-File -LiteralPath $summaryJson -Encoding UTF8

Write-Host ""
Write-Host "==================== SUMMARY ===================="
$ok     = @($summary | Where-Object { $_.Status -eq "OK" }).Count
$failed = @($summary | Where-Object { $_.Status -ne "OK" }).Count

Write-Host "OK:     $ok"
Write-Host "Issues: $failed"
Write-Host "Summary CSV:  $summaryCsv"
Write-Host "Summary JSON: $summaryJson"

if ($failed -gt 0) {
  Write-Host ""
  Write-Host "Items with issues:" -ForegroundColor Yellow
  $summary | Where-Object { $_.Status -ne "OK" } | Format-Table -AutoSize
}

Write-Host "Done."


