param(
  [Parameter(Mandatory = $true)][int]$MainProcessId,
  [ValidateRange(2, 86400)][int]$DurationSeconds = 300,
  [ValidateRange(1, 60)][int]$IntervalSeconds = 2,
  [string]$OutputPath = ''
)

# Read-only sampling of one app's process tree. No window titles, command lines,
# screenshots or application data are written to the CSV. CPU is machine-wide %.
$ErrorActionPreference = 'Stop'
$rootProcess = Get-Process -Id $MainProcessId
$rootStarted = $rootProcess.StartTime.Ticks
$cores = [Environment]::ProcessorCount
if (-not $OutputPath) {
  $OutputPath = Join-Path $PSScriptRoot "../temp/performance-$MainProcessId-$(Get-Date -Format yyyyMMdd-HHmmss).csv"
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $OutputPath) { throw "Refusing to overwrite $OutputPath" }
[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($OutputPath))
$clock = [Diagnostics.Stopwatch]::StartNew()
$nextDiscovery = 0
$tracked = @{}
$previous = @{}
$firstWrite = $true
Write-Output "Sampling PID $MainProcessId for $DurationSeconds seconds -> $OutputPath"
while ($clock.Elapsed.TotalSeconds -lt $DurationSeconds) {
  $currentRoot = Get-Process -Id $MainProcessId -ErrorAction SilentlyContinue
  if (-not $currentRoot -or $currentRoot.StartTime.Ticks -ne $rootStarted) {
    Write-Output 'Main process exited; sampling stopped.'
    break
  }
  if ($clock.Elapsed.TotalSeconds -ge $nextDiscovery) {
    # Discover new renderers/helpers every 30s, not on every sample (WMI is costly).
    $inventory = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
    $tree = @{ $MainProcessId = $true }
    do {
      $added = $false
      foreach ($entry in $inventory) {
        $entryId = [int]$entry.ProcessId
        if ($tree.ContainsKey([int]$entry.ParentProcessId) -and -not $tree.ContainsKey($entryId)) {
          $tree[$entryId] = $true
          $added = $true
        }
      }
    } while ($added)
    $tracked = $tree
    $nextDiscovery = $clock.Elapsed.TotalSeconds + 30
  }
  $sampleAt = $clock.Elapsed.TotalSeconds
  $stamp = [DateTime]::UtcNow.ToString('o')
  $rows = foreach ($process in @(Get-Process -Id @($tracked.Keys) -ErrorAction SilentlyContinue)) {
    try {
      $identity = "$($process.Id):$($process.StartTime.Ticks)"
      $cpu = $process.TotalProcessorTime.TotalSeconds
      $cpuPercent = $null
      if ($previous.ContainsKey($identity)) {
        $last = $previous[$identity]
        $cpuPercent = [math]::Round(100 * [math]::Max(0.0, $cpu - $last.Cpu) / ($sampleAt - $last.At) / $cores, 3)
      }
      $previous[$identity] = @{ Cpu = $cpu; At = $sampleAt }
      [pscustomobject]@{
        Utc = $stamp; ElapsedSeconds = [math]::Round($sampleAt, 2)
        ProcessId = $process.Id; Name = $process.ProcessName
        CpuPercent = $cpuPercent
        WorkingSetMB = [math]::Round($process.WorkingSet64 / 1MB, 2)
        PrivateMB = [math]::Round($process.PrivateMemorySize64 / 1MB, 2)
        Handles = $process.HandleCount; Threads = $process.Threads.Count
      }
    } catch { # A renderer/helper may exit during a sample.
      continue
    }
  }
  if ($rows) {
    if ($firstWrite) { $rows | Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Encoding UTF8; $firstWrite = $false }
    else { $rows | Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Encoding UTF8 -Append }
  }
  # Bound bookkeeping even across many short-lived helper processes.
  foreach ($key in @($previous.Keys)) {
    if ($sampleAt - $previous[$key].At -gt 60) { $previous.Remove($key) }
  }
  $remaining = $DurationSeconds - $clock.Elapsed.TotalSeconds
  if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int][math]::Ceiling(1000 * [math]::Min([double]$IntervalSeconds, $remaining))) }
}
Write-Output "Finished: $OutputPath"
