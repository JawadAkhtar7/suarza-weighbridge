@echo off
setlocal

rem ---------------------------------------------------------------------------
rem  One-time setup for the weighbridge PC.
rem
rem  Installs everything, builds it, and puts a "Suarza Weighbridge" icon on the
rem  desktop. Run once; after that the operator only ever uses the icon.
rem
rem  Works from the repository root because the agent shares code with the rest
rem  of the project (@suarza/shared, @suarza/receipt-pdf) and serves the
rem  operator screen from apps\operator-web\dist. Installing the agent folder on
rem  its own would be missing all of that.
rem ---------------------------------------------------------------------------

rem windows -> agent -> apps -> repository root
cd /d "%~dp0..\..\.."

echo Suarza Weighbridge - setup
echo ==========================
echo.
echo Working in: %cd%
echo.

rem --- Node --------------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node --version') do set "NODE_VERSION=%%v"
echo Node.js %NODE_VERSION% found.

rem The SQLite driver ships prebuilt binaries only for certain Node versions.
rem On anything else Windows falls back to compiling it, which needs Python and
rem Visual Studio - a long detour that ends in failure on a plain office PC.
rem Checked here so it is caught in a second rather than five minutes in.
for /f "tokens=1 delims=." %%v in ("%NODE_VERSION%") do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=%NODE_MAJOR:v=%"
if %NODE_MAJOR% LSS 20 goto :wrongNode
if %NODE_MAJOR% GTR 22 goto :wrongNode

rem --- pnpm --------------------------------------------------------------------
rem The project is a pnpm workspace. Corepack ships with Node and installs the
rem exact pnpm version the lockfile was written with.
call corepack enable >nul 2>&1
where pnpm >nul 2>&1
if errorlevel 1 (
  echo Installing pnpm...
  call npm install -g pnpm
  if errorlevel 1 goto :failed
)
for /f "delims=" %%v in ('pnpm --version') do echo pnpm %%v found.

rem --- Configuration -----------------------------------------------------------
rem Detects the indicator's COM port and writes the settings file. Nothing to
rem edit by hand - see configure-env.ps1 for what it decides.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure-env.ps1"
if errorlevel 1 goto :failed

rem --- Install and build -------------------------------------------------------
echo.
echo Installing dependencies. The first time takes a few minutes...
call pnpm install
if errorlevel 1 goto :failed

echo.
echo Building...
call pnpm build
if errorlevel 1 goto :failed

rem --- Desktop icon ------------------------------------------------------------
rem A shortcut is a COM object, so PowerShell makes it - see make-shortcut.ps1.
echo.
echo Creating the desktop icon...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-shortcut.ps1"
if errorlevel 1 (
  echo Could not create the desktop icon automatically.
  echo Make a shortcut to windows\weighbridge.bat by hand instead.
)

echo.
echo ==========================
echo Setup finished.
echo.
echo The operator double-clicks "Suarza Weighbridge" on the desktop to start.
echo.
pause
exit /b 0

:wrongNode
echo.
echo   This Node.js version (%NODE_VERSION%) will not work here.
echo   Install Node.js 22 LTS from:  https://nodejs.org/dist/latest-v22.x/
echo   (pick the file ending in x64.msi, uninstall the current Node first)
echo.
echo   Why: the SQLite driver has no prebuilt binary for Node %NODE_MAJOR%, so
echo   Windows tries to compile it and needs Visual Studio and Python.
echo.
pause
exit /b 1

:failed
echo.
echo Setup failed - see the messages above.
echo.
pause
exit /b 1
