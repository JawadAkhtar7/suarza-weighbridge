<#
  Copies the weighbridge database somewhere safe before an update.

  SQLite in WAL mode is three files — the database, its write-ahead log and its
  shared-memory index. Copying only the .sqlite can lose the most recent
  weighments, which are exactly the ones nobody has written down anywhere else.
#>

param([Parameter(Mandatory = $true)][string]$Destination)

$ErrorActionPreference = 'Stop'

$agentRoot = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..')
$envPath = Join-Path $agentRoot '.env'

# DATABASE_PATH is relative to the agent folder unless it is absolute.
$dbPath = Join-Path $agentRoot 'data\weighbridge.sqlite'
if (Test-Path $envPath) {
  $line = Get-Content $envPath | Where-Object { $_ -match '^\s*DATABASE_PATH\s*=' } | Select-Object -First 1
  if ($line) {
    $value = ($line -split '=', 2)[1].Trim()
    if ($value) {
      $dbPath = if ([System.IO.Path]::IsPathRooted($value)) { $value } else { Join-Path $agentRoot $value }
    }
  }
}

if (-not (Test-Path $dbPath)) {
  # Nothing recorded yet — a fresh install has no database to lose.
  Write-Host "No database yet at $dbPath — nothing to back up."
  exit 0
}

New-Item -ItemType Directory -Path $Destination -Force | Out-Null
foreach ($suffix in @('', '-wal', '-shm')) {
  $file = "$dbPath$suffix"
  if (Test-Path $file) {
    Copy-Item $file -Destination $Destination -Force
  }
}

$copied = (Get-ChildItem $Destination | Measure-Object -Property Length -Sum)
Write-Host ("Backed up {0} file(s), {1:N1} MB, to {2}" -f $copied.Count, ($copied.Sum / 1MB), $Destination)
