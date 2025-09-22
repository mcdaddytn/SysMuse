\
@echo off
REM Clean and rebuild TypeScript to dist, regenerate Prisma types
REM Usage: scripts\rebuild.bat

setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "REPO_ROOT=%%~fI"
cd /d "%REPO_ROOT%"

call "%SCRIPT_DIR%clean.bat"

echo [rebuild] Regenerating Prisma client (if schema present)...
IF EXIST "prisma\schema.prisma" (
  npx prisma generate
) ELSE (
  echo [rebuild] (No prisma\schema.prisma found; skipping prisma generate)
)

echo [rebuild] TypeScript build...
npx tsc -b
IF ERRORLEVEL 1 (
  echo [rebuild] Incremental build failed or not supported, doing full tsc...
  npx tsc
)

echo [rebuild] Complete. Output in .\dist
endlocal
