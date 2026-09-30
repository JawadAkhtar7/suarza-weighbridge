@echo off
setlocal enabledelayedexpansion

rem ---------------------------------------------------------------------------
rem  Suarza Weighbridge - update.
rem
rem  Stops the software, backs up the records, fetches the new version, rebuilds
rem  and starts it again. If the new version does not come up, it puts the old
rem  one back by itself.
rem
rem  Run it when the yard is quiet: the software is down for a couple of minutes.
rem ---------------------------------------------------------------------------

rem windows -> agent -> apps -> repository root
cd /d "%~dp0..\..\.."
set "REPO=%cd%"
set "AGENT=%REPO%\apps\agent"

echo Suarza Weighbridge - update
echo ===========================
echo.

rem --- Is this a clone we can update? -----------------------------------------
where git >nul 2>&1
if errorlevel 1 goto :noGit
if not exist ".git" goto :notAClone

rem --- Which port, so we can stop and check the right thing --------------------
set "PORT=3100"
if exist "apps\agent\.env" (
  for /f "usebackq tokens=1,* delims==" %%a in ("apps\agent\.env") do (
    if /i "%%a"=="PORT" set "PORT=%%b"
  )
)
set "PORT=%PORT: =%"
set "URL=http://localhost:%PORT%"

set "PROBE=curl"
where curl >nul 2>&1 || set "PROBE=powershell"

rem --- Back up the records BEFORE anything else -------------------------------
rem Everything ever weighed is in that file. A copy costs a second.
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%t"
set "BACKUP=%AGENT%\data\backups\update-%STAMP%"

echo Backing up the records...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-database.ps1" -Destination "%BACKUP%"
if errorlevel 1 goto :backupFailed

rem --- Stop the software ------------------------------------------------------
echo Stopping the software...
call :stopAgent

rem --- Remember where we are, so we can come back -----------------------------
for /f "delims=" %%c in ('git rev-parse HEAD') do set "BEFORE=%%c"

echo Fetching the new version...
git pull --ff-only
if errorlevel 1 goto :pullFailed

for /f "delims=" %%c in ('git rev-parse HEAD') do set "AFTER=%%c"
if "%BEFORE%"=="%AFTER%" goto :alreadyCurrent

echo.
echo Installing and building. This takes a few minutes...
call pnpm install
if errorlevel 1 goto :rollback
call pnpm exec turbo run build --filter=@suarza/agent --filter=@suarza/operator-web
if errorlevel 1 goto :rollback

rem --- Start it and make sure it really came up -------------------------------
echo.
echo Starting the software...
call :startAgent
call :waitForAgent
if errorlevel 1 goto :rollback

echo.
echo ===========================
echo Update finished. The software is running the new version.
echo.
echo Records were backed up to:
echo   %BACKUP%
echo.
rem Bring the weighing screen back up for the operator.
start "" "%~dp0weighbridge.bat"
pause
exit /b 0

rem --- Nothing to do ----------------------------------------------------------
:alreadyCurrent
echo.
echo Already up to date - nothing to install.
call :startAgent
call :waitForAgent
start "" "%~dp0weighbridge.bat"
echo.
pause
exit /b 0

rem --- Put the old version back ------------------------------------------------
:rollback
echo.
echo The new version did not start. Putting the previous one back...
git reset --hard %BEFORE%
call pnpm install
call pnpm exec turbo run build --filter=@suarza/agent --filter=@suarza/operator-web
call :startAgent
call :waitForAgent
if errorlevel 1 goto :rollbackFailed

echo.
echo ===========================
echo The previous version is running again. Nothing was lost.
echo Tell Jawad the update did not work, and read him this line:
echo   rollback to %BEFORE%
echo.
start "" "%~dp0weighbridge.bat"
pause
exit /b 1

:rollbackFailed
echo.
echo ===========================
echo THE SOFTWARE IS NOT RUNNING and the previous version did not start either.
echo.
echo Call Jawad. Your records are safe, in:
echo   %BACKUP%
echo.
pause
exit /b 1

rem --- Things that stop us before we touch anything -----------------------------
:noGit
echo Git is not installed on this PC, so the software cannot update itself.
echo Install it from https://git-scm.com and run this again.
echo.
pause
exit /b 1

:notAClone
echo This copy of the software was not downloaded with Git, so it cannot
echo update itself. Call Jawad - it is a one-time fix.
echo.
pause
exit /b 1

:backupFailed
echo.
echo Could not back up the records, so nothing has been changed.
echo Call Jawad.
echo.
pause
exit /b 1

:pullFailed
echo.
echo Could not fetch the new version. The old one is being started again.
echo Check the internet connection, or call Jawad.
echo.
call :startAgent
call :waitForAgent
start "" "%~dp0weighbridge.bat"
pause
exit /b 1

rem --- Helpers ------------------------------------------------------------------

rem Stops whatever is listening on the port, whichever way it was started.
:stopAgent
powershell -NoProfile -Command "try { Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } } catch {}" >nul 2>&1
taskkill /FI "WINDOWTITLE eq Suarza Weighbridge Agent*" /T /F >nul 2>&1
rem Give Windows a moment to release the port.
ping -n 3 127.0.0.1 >nul
exit /b 0

:startAgent
start "Suarza Weighbridge Agent" /min cmd /c "cd /d "%AGENT%" && node dist\index.js"
exit /b 0

rem Succeeds once the agent answers; fails after about a minute.
:waitForAgent
set /a tries=0
:waitLoop
set /a tries+=1
call :isUp
if not errorlevel 1 exit /b 0
if %tries% geq 60 exit /b 1
ping -n 2 127.0.0.1 >nul
goto :waitLoop

rem Deliberately flat: inside an if(...) block, batch expands %errorlevel% when
rem it PARSES the block, so this would report success every time.
:isUp
if "%PROBE%"=="powershell" goto :isUpPowershell
curl --silent --fail --max-time 2 --output nul "%URL%/health"
exit /b %errorlevel%

:isUpPowershell
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%URL%/health' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
exit /b %errorlevel%
