param(
  [Parameter(Mandatory=$true)][ValidateSet('backup','restore')] [string]$Op,
  [string]$Suffix = 'current',
  [string]$BackupDir = './backups'
)
$ErrorActionPreference = 'Stop'
function Log($m){ if($env:DEBUG -eq '1'){ Write-Host "[DBG] $m" } }

# Default the backup dir if wrapper passed an empty arg
if ([string]::IsNullOrWhiteSpace($BackupDir)) { $BackupDir = './backups' }
Log "Op=$Op Suffix=$Suffix BackupDir=$BackupDir"

# Load .env safely (no batch FOR /F)
$envPath = Join-Path (Get-Location) '.env'
if (Test-Path $envPath) {
  Log "Loading .env from $envPath"
  $text = Get-Content $envPath -Raw -Encoding UTF8
  foreach($line in ($text -split "`r?`n")){
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $t = $line.Trim()
    if ($t.StartsWith('#')) { continue }
    $kv = $t.Split('=',2)
    if ($kv.Count -lt 2) { continue }
    $k = $kv[0].Trim()
    $v = $kv[1]
    if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length-2) }
    elseif ($v.StartsWith("'") -and $v.EndsWith("'")) { $v = $v.Substring(1, $v.Length-2) }
    if ($k) { [Environment]::SetEnvironmentVariable($k, $v, 'Process') }
  }
} else {
  Log ".env not found; relying on env vars/DATABASE_URL"
}

# Parse DATABASE_URL if present and fill missing PG* vars
if ($env:DATABASE_URL) {
  Log "Parsing DATABASE_URL"
  $u = [Uri]$env:DATABASE_URL.Trim('"')
  $user = ''; $pass = ''
  if ($u.UserInfo) {
    $parts = $u.UserInfo.Split(':',2)
    $user = [Uri]::UnescapeDataString($parts[0])
    if ($parts.Count -gt 1) { $pass = [Uri]::UnescapeDataString($parts[1]) }
  }
  if (-not $env:PGUSER -and $user)     { $env:PGUSER     = $user }
  if (-not $env:PGPASSWORD -and $pass) { $env:PGPASSWORD = $pass }
  if (-not $env:PGHOST -and $u.Host)   { $env:PGHOST     = $u.Host }
  if (-not $env:PGPORT) {
    if ($u.Port -gt 0) { $env:PGPORT = $u.Port.ToString() } else { $env:PGPORT = '5432' }
  }
  if (-not $env:PGDATABASE) {
    $db = $u.AbsolutePath.TrimStart('/')
    if ($db) { $env:PGDATABASE = $db }
  }
}

# Validate required vars (PS5-safe dynamic env access)
foreach($name in 'PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE'){
  $val = (Get-Item -Path ("Env:{0}" -f $name) -ErrorAction SilentlyContinue).Value
  if ([string]::IsNullOrWhiteSpace($val)) {
    throw ("Missing {0} (and DATABASE_URL didn't provide it)." -f $name)
  }
}

# Prep paths
if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
$OutFile = Join-Path $BackupDir ("{0}_{1}.sql" -f $env:PGDATABASE,$Suffix)
Log ("OutFile = {0}" -f $OutFile)

# Docker detection (robust against warnings)
$dockerExec = $null

# If user provides a container name, prefer it
if ($env:POSTGRES_CONTAINER) {
  $name = $env:POSTGRES_CONTAINER
  $running = (& docker inspect -f '{{.State.Running}}' $name 2>$null)
  if ($LASTEXITCODE -eq 0 -and "$running".Trim() -eq 'true') {
    $dockerExec = @('docker','exec','-i',$name)
    Log ("Using specified container {0}" -f $name)
  } else {
    Log ("Specified container {0} not running; will try auto-detect" -f $name)
  }
}

if (-not $dockerExec) {
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    $rows = & docker ps --format '{{.ID}};{{.Image}};{{.Ports}}' 2>$null
    if ($LASTEXITCODE -eq 0) {
      $chosen = $null
      foreach($r in $rows){
        $cid,$img,$ports = $r -split ';',3
        if (-not $img) { continue }
        if ($img -notmatch 'postgres|timescale|bitnami/postgres') { continue }
        if ($ports -match (":{0}->(5432|{0})/tcp" -f $env:PGPORT)) { $chosen = $cid; break }
        if (-not $chosen) { $chosen = $cid }  # fallback: first postgres-like
      }
      if ($chosen) {
        $dockerExec = @('docker','exec','-i',$chosen)
        Log ("Using container {0}" -f $chosen)
      } else {
        Log "No postgres container found; will try local binaries"
      }
    } else {
      Log ("docker ps failed with code {0}; will try local binaries" -f $LASTEXITCODE)
    }
  } else {
    Log "docker not on PATH; will try local binaries"
  }
}

# If neither dockerExec nor local pg_dump exists, fail fast with guidance
$hasLocalPgDump = [bool](Get-Command pg_dump -ErrorAction SilentlyContinue)
if (-not $dockerExec -and -not $hasLocalPgDump) {
  throw "pg_dump not found on PATH and no running postgres container detected. 
Add Postgres bin to PATH (e.g. C:\Program Files\PostgreSQL\16\bin) 
or set POSTGRES_CONTAINER to your running container name."
}

$pgDumpArgs = @('-h',$env:PGHOST,'-p',$env:PGPORT,'-U',$env:PGUSER,'-d',$env:PGDATABASE,'--clean','--if-exists','--no-owner','--no-privileges')
$psqlArgs   = @('-h',$env:PGHOST,'-p',$env:PGPORT,'-U',$env:PGUSER,'-d',$env:PGDATABASE,'-v','ON_ERROR_STOP=1')

if ($Op -eq 'backup') {
  Write-Host ("Backing up {0} -> {1}" -f $env:PGDATABASE,$OutFile)
  if ($dockerExec){
    $cmd = "PGPASSWORD='$($env:PGPASSWORD)' pg_dump $($pgDumpArgs -join ' ')"
    $out = & $dockerExec[0] $dockerExec[1] $dockerExec[2] $dockerExec[3] 'sh' '-lc' $cmd 2>&1
    if ($LASTEXITCODE -ne 0) { $out | Write-Error; exit 1 }
    $out | Out-File -FilePath $OutFile -Encoding utf8
  } else {
    $env:PGPASSWORD = $env:PGPASSWORD
    & pg_dump @pgDumpArgs 2>&1 | Out-File -FilePath $OutFile -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed." }
  }
  Write-Host "Done."
  exit 0
}

# restore
if (-not (Test-Path $OutFile)) { throw ("Restore file not found: {0}" -f $OutFile) }
Write-Host ("Restoring {0} <- {1}" -f $env:PGDATABASE,$OutFile)
if ($dockerExec){
  $cmd = "PGPASSWORD='$($env:PGPASSWORD)' psql $($psqlArgs -join ' ')"
  Get-Content -Raw -Encoding UTF8 $OutFile | & $dockerExec[0] $dockerExec[1] $dockerExec[2] $dockerExec[3] 'sh' '-lc' $cmd
  if ($LASTEXITCODE -ne 0) { throw "psql failed inside container." }
} else {
  $env:PGPASSWORD = $env:PGPASSWORD
  & psql @psqlArgs '-f' $OutFile
  if ($LASTEXITCODE -ne 0) { throw "psql failed." }
}
Write-Host "Done."
