@echo off
setlocal enabledelayedexpansion

rem ---------------------------------------------------------------------------
rem  Suarza Weighbridge — the operator's desktop icon points here.
rem
rem  Starts the agent if it is not already running, waits until it answers, then
rem  opens the operator screen. Clicking the icon again does NOT start a second
rem  copy: it finds the running one and just reopens the window. A second copy
rem  would fight over the port and the database file, and the error it produced
rem  would mean nothing to the person reading it.
rem ---------------------------------------------------------------------------

rem Work from the agent folder, whatever folder the shortcut was launched from.
cd /d "%~dp0.."

rem The port comes from .env so the two can never disagree; 3100 if unset.
set "PORT=3100"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if /i "%%a"=="PORT" set "PORT=%%b"
  )
)
rem Strip stray spaces a hand-edited .env may leave behind.
set "PORT=%PORT: =%"
set "URL=http://localhost:%PORT%"

rem Windows 10 (1803) and later ship curl; PowerShell is the fallback for older
rem machines. Decided once here rather than on every probe.
set "PROBE=curl"
where curl >nul 2>&1 || set "PROBE=powershell"

echo Suarza Weighbridge
echo ------------------

call :isUp
if not errorlevel 1 (
  echo Already running. Opening the screen...
  goto :openBrowser
)

if not exist "dist\index.js" (
  echo.
  echo The software has not been built yet.
  echo Run install.bat in the windows folder first.
  echo.
  pause
  exit /b 1
)

echo Starting the weighbridge software...
start "Suarza Weighbridge Agent" /min cmd /c "node dist\index.js"

set /a tries=0
:waitLoop
set /a tries+=1
call :isUp
if not errorlevel 1 goto :openBrowser
if %tries% geq 60 (
  echo.
  echo The software did not start.
  echo Look at the minimised "Suarza Weighbridge Agent" window for the reason.
  echo.
  pause
  exit /b 1
)
rem Roughly one second per try, so 60 tries is a one-minute ceiling.
ping -n 2 127.0.0.1 >nul
goto :waitLoop

:openBrowser
rem Checked one at a time rather than in a for loop: %ProgramFiles(x86)%
rem contains brackets, which break a parenthesised block in batch.
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined CHROME set "PF86=%ProgramFiles(x86)%"
if not defined CHROME if exist "!PF86!\Google\Chrome\Application\chrome.exe" set "CHROME=!PF86!\Google\Chrome\Application\chrome.exe"

if defined CHROME (
  rem --app gives a window with no address bar; --kiosk-printing sends receipts
  rem straight to the default printer instead of showing a print dialog.
  start "" "!CHROME!" --app=%URL% --kiosk-printing
) else (
  echo Chrome was not found, opening the default browser instead.
  echo Receipts will ask before printing until Chrome is installed.
  start "" %URL%
)

exit /b 0

rem --- Succeeds only when the agent's health route answers --------------------
:isUp
if "%PROBE%"=="curl" (
  curl --silent --fail --max-time 2 --output nul "%URL%/health"
  exit /b %errorlevel%
)
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%URL%/health' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
exit /b %errorlevel%
