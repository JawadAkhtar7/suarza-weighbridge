<#
  Creates the "Suarza Weighbridge" icon on the desktop.

  Kept as its own file rather than a one-liner inside install.bat: a shortcut is
  a COM object, and the quoting needed to build one inside batch is the kind of
  thing that breaks silently on someone else's machine.
#>

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath('Desktop')
$linkPath = Join-Path $desktop 'Suarza Weighbridge.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = Join-Path $here 'weighbridge.bat'
$shortcut.WorkingDirectory = $here
$shortcut.IconLocation = Join-Path $here 'suarza.ico'
$shortcut.Description = 'Start the weighbridge software'
# Minimised: the operator wants the weighing screen, not this window.
$shortcut.WindowStyle = 7
$shortcut.Save()

Write-Host "Desktop icon created: $linkPath"
