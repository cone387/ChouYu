import { app, nativeImage } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import type { OfflineOcrResult } from '../shared/ocr'

let busy = false

export async function recognizeOfflineImage(dataUrl: unknown): Promise<OfflineOcrResult> {
  if (process.platform !== 'win32') throw new Error('离线识别目前仅支持 Windows；其他系统可以选择 AI 识别。')
  if (busy) throw new Error('已有图片正在识别，请等待完成后重试。')
  if (typeof dataUrl !== 'string' || dataUrl.length > 22_000_000 || !/^data:image\/(?:png|jpeg|webp|bmp);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw new Error('图片格式无效或超过 16 MB；请使用 PNG、JPEG、WebP 或 BMP。')
  const image = nativeImage.createFromDataURL(dataUrl)
  const size = image.getSize()
  if (image.isEmpty() || size.width * size.height > 20_000_000) throw new Error('图片无法读取或像素过大，请裁剪后重试。')
  busy = true
  let directory: string | undefined
  try {
    directory = await fs.mkdtemp(path.join(app.getPath('temp'), 'chouyu-ocr-'))
    const imagePath = path.join(directory, 'image.png')
    await fs.writeFile(imagePath, image.toPNG())
    const script = app.isPackaged ? path.join(process.resourcesPath, 'offline-ocr.ps1') : path.join(app.getAppPath(), 'resources', 'offline-ocr.ps1')
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return await new Promise<OfflineOcrResult>((resolve, reject) => {
      const child = execFile(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], {
        windowsHide: true, timeout: 30_000, maxBuffer: 1_000_000, encoding: 'utf8',
        env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP }
      }, (error, stdout) => {
        try {
          const result = JSON.parse(stdout.trim()) as { ok?: boolean; text?: unknown; language?: unknown; error?: unknown }
          if (result.ok !== true) throw new Error(`离线识别失败：${String(result.error || '系统 OCR 不可用。')}`)
          if (typeof result.text !== 'string' || typeof result.language !== 'string') throw new Error('离线识别返回了无效结果。')
          if (error) throw error
          resolve({ text: result.text, language: result.language })
        } catch (parseError) {
          reject(error?.killed ? new Error('离线识别超时，请裁剪图片后重试。') : parseError instanceof SyntaxError ? new Error('系统 OCR 无法启动，请检查 Windows 语言包和脚本运行策略。') : parseError)
        }
      })
      child.stdin?.on('error', () => { /* execFile callback reports child startup failures. */ })
      child.stdin?.end(JSON.stringify({ path: imagePath }))
    })
  } finally {
    if (directory) {
      // Only remove the single file and empty directory created by this request.
      await fs.unlink(path.join(directory, 'image.png')).catch(() => {})
      await fs.rmdir(directory).catch(() => {})
    }
    busy = false
  }
}
