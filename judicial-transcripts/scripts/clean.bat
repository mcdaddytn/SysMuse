\
@echo off
REM Clean build artifacts and caches for Node + TypeScript
REM Usage: scripts\clean.bat

setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "REPO_ROOT=%%~fI"
cd /d "%REPO_ROOT%"

echo [clean] Cleaning build outputs and caches...

IF EXIST "dist" (rmdir /s /q "dist")
IF EXIST "coverage" (rmdir /s /q "coverage")
IF EXIST "tsconfig.tsbuildinfo" (del /f /q "tsconfig.tsbuildinfo")
IF EXIST "dist\.tsbuildinfo" (del /f /q "dist\.tsbuildinfo")

IF EXIST "node_modules\.cache" (rmdir /s /q "node_modules\.cache")
IF EXIST "node_modules\.ts-node" (rmdir /s /q "node_modules\.ts-node")
IF EXIST "node_modules\.prisma" (rmdir /s /q "node_modules\.prisma")
IF EXIST "node_modules\@prisma\client" (rmdir /s /q "node_modules\@prisma\client")

echo [clean] Done.
endlocal
