<#
  Writes apps\agent\.env so nobody has to edit it by hand.

  What it decides:
    - a weight indicator is plugged in  -> use that COM port, simulator OFF
    - no serial port on the machine     -> simulator ON, and say so loudly

  The fallback to the simulator happens HERE, at setup, and never at run time.
  An agent that quietly switched to simulated weights because a cable came
  loose would print invented numbers onto real slips.

  An existing .env is left alone: on a machine that has been configured, the
  COM port and the cloud key are worth more than anything this could guess.
#>

$ErrorActionPreference = 'Stop'

$agentRoot = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..')
$envPath = Join-Path $agentRoot '.env'
$examplePath = Join-Path $agentRoot '.env.example'

function Set-EnvValue {
  param([string[]]$Lines, [string]$Key, [string]$Value)

  $written = $false
  $result = foreach ($line in $Lines) {
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=") {
      $written = $true
      "$Key=$Value"
    } else {
      $line
    }
  }
  if (-not $written) { $result += "$Key=$Value" }
  return $result
}

if (Test-Path $envPath) {
  Write-Host 'Configuration already exists (apps\agent\.env) — leaving it as it is.'
  $current = Get-Content $envPath
  ($current | Where-Object { $_ -match '^\s*(SERIAL_PORT|USE_SIMULATOR)\s*=' }) |
    ForEach-Object { Write-Host "  $_" }
  exit 0
}

Copy-Item $examplePath $envPath
$lines = Get-Content $envPath

# [System.IO.Ports] is part of .NET on Windows; this is the same list Device
# Manager shows under "Ports (COM & LPT)".
$ports = @([System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object)

if ($ports.Count -gt 0) {
  $chosen = $ports[0]
  $lines = Set-EnvValue -Lines $lines -Key 'SERIAL_PORT' -Value $chosen
  $lines = Set-EnvValue -Lines $lines -Key 'USE_SIMULATOR' -Value 'false'

  Write-Host "Weight indicator: using $chosen." -ForegroundColor Green
  if ($ports.Count -gt 1) {
    Write-Host "  Other ports on this PC: $($ports -join ', ')"
    Write-Host '  If the weight never moves, the indicator is on one of those —'
    Write-Host "  change SERIAL_PORT in $envPath"
  }
} else {
  $lines = Set-EnvValue -Lines $lines -Key 'USE_SIMULATOR' -Value 'true'
  Write-Host ''
  Write-Host '  No serial port found on this PC, so the SIMULATOR is switched on.' -ForegroundColor Yellow
  Write-Host '  Weights on screen are invented. Fine for testing, never for a real bridge.' -ForegroundColor Yellow
  Write-Host ''
}

Set-Content -Path $envPath -Value $lines -Encoding ASCII
Write-Host "Configuration written: $envPath"
