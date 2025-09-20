\
@echo off
REM Clean build artifacts and caches for Node + TypeScript
REM Usage: scripts\clean.bat

SETLOCAL ENABLEDELAYEDEXPANSION
REM Move to repo root relative to this script
for %%I in ("%~dp0..") do set REPO_ROOT=%%~fI
cd /d "%REPO_ROOT%"

echo ==> Cleaning build outputs and caches...

REM Dist / coverage / tsbuildinfo
IF EXIST "dist" (rmdir /s /q "dist")
IF EXIST "coverage" (rmdir /s /q "coverage")
IF EXIST "tsconfig.tsbuildinfo" (del /f /q "tsconfig.tsbuildinfo")
IF EXIST "dist\.tsbuildinfo" (del /f /q "dist\.tsbuildinfo")

REM Common tool caches
IF EXIST "node_modules\.cache" (rmdir /s /q "node_modules\.cache")
IF EXIST "node_modules\.ts-node" (rmdir /s /q "node_modules\.ts-node")
IF EXIST "node_modules\.prisma" (rmdir /s /q "node_modules\.prisma")

REM Jest cache
IF EXIST "node_modules\.cache\jest" (rmdir /s /q "node_modules\.cache\jest")

REM Prisma generated client
IF EXIST "node_modules\@prisma\client" (rmdir /s /q "node_modules\@prisma\client")

echo ==> Clean complete.
ENDLOCAL
