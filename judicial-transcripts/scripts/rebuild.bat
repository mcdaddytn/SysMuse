\
@echo off
REM Clean and rebuild TypeScript to dist, regenerate Prisma types
REM Usage: scripts\rebuild.bat

SETLOCAL ENABLEDELAYEDEXPANSION
for %%I in ("%~dp0..") do set REPO_ROOT=%%~fI
cd /d "%REPO_ROOT%"

call "%~dp0clean.bat"

echo ==> Regenerating Prisma client (if schema present)...
IF EXIST "prisma\schema.prisma" (
  npx prisma generate
) ELSE (
  echo     (No prisma\schema.prisma found; skipping prisma generate)
)

echo ==> TypeScript build...
npx tsc -b || npx tsc

echo ==> Rebuild complete. Output in .\dist
ENDLOCAL
