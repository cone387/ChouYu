$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
$journalAsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await-JournalWinRT($operation, [Type]$resultType) {
  $task = $journalAsTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.GetAwaiter().GetResult()
}
while ($null -ne ($journalLine = [Console]::ReadLine())) {
  $journalStream = $null
  $journalBitmap = $null
  try {
    $journalRequest = $journalLine | ConvertFrom-Json
    $journalEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $journalEngine) { throw 'No Windows OCR language pack available.' }
    $journalFile = Await-JournalWinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($journalRequest.path)) ([Windows.Storage.StorageFile])
    $journalStream = Await-JournalWinRT ($journalFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $journalDecoder = Await-JournalWinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($journalStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    if ($journalDecoder.PixelWidth -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or $journalDecoder.PixelHeight -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) { throw 'Image exceeds OCR size limit.' }
    $journalBitmap = Await-JournalWinRT ($journalDecoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $journalResult = Await-JournalWinRT ($journalEngine.RecognizeAsync($journalBitmap)) ([Windows.Media.Ocr.OcrResult])
    $journalText = (($journalResult.Lines | ForEach-Object { $_.Text }) -join "`n")
    if ($journalText.Length -gt 30000) { $journalText = $journalText.Substring(0, 30000) }
    @{ ok=$true; text=$journalText } | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) }
  } catch {
    [Console]::WriteLine('{"ok":false,"error":"Offline OCR failed; check installed Windows OCR language packs."}')
  } finally {
    if ($null -ne $journalBitmap) { $journalBitmap.Dispose() }
    if ($null -ne $journalStream) { $journalStream.Dispose() }
  }
}
