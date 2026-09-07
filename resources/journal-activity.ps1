$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class JournalWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
}
'@
while ($null -ne ($journalRequest = [Console]::ReadLine())) {
  try {
    $journalWindow = [JournalWindow]::GetForegroundWindow()
    if ($journalWindow -eq [IntPtr]::Zero) { throw 'No foreground window' }
    $journalText = New-Object System.Text.StringBuilder 513
    [void][JournalWindow]::GetWindowText($journalWindow, $journalText, 513)
    [uint32]$journalProcessId = 0
    [void][JournalWindow]::GetWindowThreadProcessId($journalWindow, [ref]$journalProcessId)
    $journalProcess = Get-Process -Id $journalProcessId -ErrorAction Stop
    @{ ok=$true; app=($journalProcess.ProcessName + '.exe'); title=$journalText.ToString(); pid=$journalProcessId; hwnd=$journalWindow.ToInt64().ToString() } | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) }
  } catch {
    [Console]::WriteLine('{"ok":false,"error":"Unable to read foreground activity"}')
  }
}
