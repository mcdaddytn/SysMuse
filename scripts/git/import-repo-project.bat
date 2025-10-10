@echo off
setlocal enabledelayedexpansion

REM Usage:
REM   import-repo-project.bat <git_repo_url> <project_name> <zip_full_path>
REM Example:
REM   import-repo-project.bat https://github.com/myorg/parent-repo.git judicial-transcripts "C:\zips\jt.zip"

if "%~3"=="" (
  echo Usage: %~nx0 ^<git_repo_url^> ^<project_name^> ^<zip_full_path^>
  exit /b 1
)

set "REPO_URL=%~1"
set "PROJECT_NAME=%~2"
set "ZIP_PATH=%~3"

if not exist "%ZIP_PATH%" (
  echo Zip file not found: %ZIP_PATH%
  exit /b 1
)

REM Derive local repo directory name from URL (strip .git)
for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "$u='%REPO_URL%'; $n=($u.Split('/')[-1]); if ($n -like '*.git') { $n=$n.Substring(0,$n.Length-4) }; Write-Output $n"`) do set "REPO_DIR=%%R"
if "%REPO_DIR%"=="" (
  echo Could not derive repository directory name from URL.
  exit /b 1
)

REM Clone into current directory if not already present
if exist "%REPO_DIR%" (
  echo Directory "%REPO_DIR%" already exists. Using it.
) else (
  echo Cloning %REPO_URL% into "%REPO_DIR%" ...
  git clone "%REPO_URL%" "%REPO_DIR%"
  if errorlevel 1 (
    echo git clone failed.
    exit /b 1
  )
)

pushd "%REPO_DIR%" || ( echo Failed to enter %REPO_DIR% & exit /b 1 )

REM Determine current branch (default branch of the clone)
for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%B"
if "%BRANCH%"=="" set "BRANCH=main"

REM Refuse to overwrite an existing project directory
if exist "%PROJECT_NAME%" (
  echo Target directory "%PROJECT_NAME%" already exists in repo root. Aborting to avoid overwrite.
  popd
  exit /b 1
)

mkdir "%PROJECT_NAME%"
if errorlevel 1 (
  echo Failed to create "%PROJECT_NAME%".
  popd
  exit /b 1
)

echo Extracting "%ZIP_PATH%" into "%PROJECT_NAME%" ...
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%ZIP_PATH%' -DestinationPath '%CD%\%PROJECT_NAME%' -Force"
if errorlevel 1 (
  echo Expand-Archive failed.
  popd
  exit /b 1
)

REM Stage, commit, push
git add "%PROJECT_NAME%"
if errorlevel 1 (
  echo git add failed.
  popd
  exit /b 1
)

git commit -m "Import project %PROJECT_NAME% from zip"
if errorlevel 1 (
  echo git commit failed. Nothing to commit or an error occurred.
  popd
  exit /b 1
)

echo Pushing to origin "%BRANCH%" ...
git push origin "%BRANCH%"
if errorlevel 1 (
  echo git push failed.
  popd
  exit /b 1
)

echo Import complete.
echo Repo path: %CD%
popd
