import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { StringDecoder } from 'string_decoder'
import { app } from 'electron'
import { join } from 'path'

/** One persistent OCR process and one outstanding image; no per-frame PowerShell startup. */
export class JournalOcr {
  private child?: ChildProcessWithoutNullStreams
  private pending?: { resolve(text: string): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }

  read(path: string): Promise<string> {
    if (this.pending) return Promise.reject(new Error('OCR 正忙。'))
    if (!this.child) {
      const script = join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'journal-ocr.ps1')
      const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], {
        windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
        env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP }
      })
      this.child = child
      let buffer = ''; const decoder = new StringDecoder('utf8')
      child.stderr.resume()
      child.on('error', () => { if (this.child === child) this.stop() })
      child.on('exit', () => { if (this.child === child) this.stop() })
      child.stdin.on('error', () => { if (this.child === child) this.stop() })
      child.stdout.on('data', (chunk: Buffer) => {
        if (this.child !== child) return
        buffer += decoder.write(chunk)
        if (buffer.length > 200_000) { this.stop(); return }
        const newline = buffer.indexOf('\n')
        if (newline < 0 || !this.pending) return
        const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer)
        try {
          const result = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1)
          if (!result.ok || typeof result.text !== 'string') throw new Error('离线 OCR 失败，请检查 Windows OCR 语言包后重试。')
          pending.resolve(result.text.slice(0, 30000))
        } catch (error) { pending.reject(error instanceof Error ? error : new Error('OCR 返回无效数据。')) }
      })
    }
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, timer: setTimeout(() => this.stop(), 30_000) }
      this.child!.stdin.write(JSON.stringify({ path }) + '\n')
    })
  }
  stop(): void {
    const pending = this.pending; this.pending = undefined
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error('OCR 已停止或超时。')) }
    const child = this.child; this.child = undefined; child?.kill()
  }
}
