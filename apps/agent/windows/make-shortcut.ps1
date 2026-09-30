<#
  Creates the "Suarza Weighbridge" icon on the desktop.

  Kept as its own file rather than a one-liner inside install.bat: a shortcut is
  a COM object, and the quoting needed to build one inside batch is the kind of
  thing that breaks silently on someone else's machine.
#>

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

function New-DesktopShortcut {
  param([string]$Name, [string]$Script, [string]$Description, [int]$WindowStyle)

  $path = Join-Path $desktop "$Name.lnk"
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = Join-Path $here $Script
  $shortcut.WorkingDirectory = $here
  $shortcut.IconLocation = Join-Path $here 'suarza.ico'
  $shortcut.Description = $Description
  $shortcut.WindowStyle = $WindowStyle
  $shortcut.Save()
  Write-Host "Desktop icon created: $path"
}

# Minimised: the operator wants the weighing screen, not this window.
New-DesktopShortcut -Name 'Suarza Weighbridge' -Script 'weighbridge.bat' -Description 'Start the weighbridge software' -WindowStyle 7

# Normal window: an update takes minutes and the operator needs to read how it
# went — especially the line that says the old version was put back.
New-DesktopShortcut -Name 'Update Weighbridge' -Script 'update.bat' -Description 'Fetch and install the latest version' -WindowStyle 1
