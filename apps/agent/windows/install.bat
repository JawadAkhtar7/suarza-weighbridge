@echo off
setlocal

rem ---------------------------------------------------------------------------
rem  One-time setup for the weighbridge PC.
rem
rem  Installs the dependencies, builds the software, and puts a "Suarza
rem  Weighbridge" icon on the desktop. Run it once; after that the operator only
rem  ever uses the icon.
rem ---------------------------------------------------------------------------

cd /d "%~dp0.."

echo Suarza Weighbridge — setup
echo ==========================
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
for /f "delims=" %%v in ('node --version') do echo Node.js %%v found.

rem --- Configuration -----------------------------------------------------------
if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo.
    echo A configuration file has been created: .env
    echo Open it in Notepad and set SERIAL_PORT to the indicator's COM port
    echo before weighing anything.
  ) else (
    echo No .env or .env.example found. Cannot continue.
    pause
    exit /b 1
  )
)

rem --- Dependencies and build --------------------------------------------------
echo.
echo Installing dependencies. This takes a few minutes the first time...
call npm install --omit=dev
if errorlevel 1 goto :failed

echo.
echo Building...
call npm run build
if errorlevel 1 goto :failed

rem --- Desktop icon ------------------------------------------------------------
rem A shortcut is a COM object, so PowerShell makes it — see make-shortcut.ps1.
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

:failed
echo.
echo Setup failed — see the messages above.
echo.
pause
exit /b 1
