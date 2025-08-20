@echo off
setlocal EnableExtensions
set "URL=%~1"
if "%URL%"=="" (
  echo Usage: %~nx0 "postgresql://user:pass@host:5432/db?schema=public"
  exit /b 2
)
for /f "usebackq tokens=* delims=" %%J in (`powershell -NoProfile -Command ^
  "$u=[uri]('%URL%'.Trim('`"')); $ui=$u.UserInfo; $user,$pass=$ui.Split(':',2); "^
  "$host=$u.Host; $port=if($u.Port -gt 0){$u.Port}else{5432}; $db=$u.AbsolutePath.TrimStart('/'); "^
  "$user=[uri]::UnescapeDataString($user); $pass=[uri]::UnescapeDataString($pass);" ^
  "$pairs=@('PGHOST='+$host,'PGPORT='+$port,'PGUSER='+$user,'PGPASSWORD='+$pass,'PGDATABASE='+$db);" ^
  "$envpath='.env'; if(-not (Test-Path $envpath)){ ''^|Out-File -FilePath $envpath -Encoding utf8 }; "^
  "$envtxt=Get-Content $envpath -Raw; foreach($p in $pairs){ $k,$v=$p.Split('='); if($envtxt -match \"(?m)^$k=\"){$envtxt=[regex]::Replace($envtxt,\"(?m)^$k=.*$\",\"$k=$v\")}else{$envtxt+=\"`n$k=$v\"} }; "^
  "$envtxt | Set-Content $envpath -NoNewline -Encoding utf8; "^
  "Write-Output 'Updated .env with PG* variables.'"`) do echo %%J
