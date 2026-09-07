import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import { join } from 'path'
import { app } from 'electron'
import type { JournalSample } from '../../shared/journal'

export class ActivityHelper {
  private child?: ChildProcessWithoutNullStreams
  private pending?: { resolve(value: Omit<JournalSample, 'idleSeconds'>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }

  read(): Promise<Omit<JournalSample, 'idleSeconds'>> {
    if (this.pending) return Promise.reject(new Error('已有活动读取请求。'))
    if (!this.child) {
      const script = join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'journal-activity.ps1')
      this.child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], {
        windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
        env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP }
      })
      const child = this.child
      child.stderr.resume()
      child.on('error', () => { if (this.child === child) this.stop('活动采集进程无法启动。') })
      child.on('exit', () => { if (this.child === child) this.stop('活动采集进程已退出，请重试。') })
      child.stdin.on('error', () => { if (this.child === child) this.stop('活动采集连接中断。') })
      createInterface({ input: child.stdout }).on('line', line => {
        if (this.child !== child || !this.pending) return
        const pending = this.pending
        try {
          if (line.length > 8192) throw new Error('活动采集响应过长。')
          const value = JSON.parse(line)
          if (!value.ok || typeof value.app !== 'string' || typeof value.title !== 'string' || !Number.isSafeInteger(value.pid)) throw new Error('暂时无法读取前台窗口。')
          if (typeof value.hwnd !== 'string' || !/^\d+$/.test(value.hwnd)) throw new Error('前台窗口标识无效。')
          clearTimeout(pending.timer); this.pending = undefined
          pending.resolve({ app: value.app.slice(0, 120), title: value.title.slice(0, 512), pid: value.pid, hwnd: value.hwnd })
        } catch (error) { this.stop(error instanceof Error ? error.message : '活动读取失败。') }
      })
    }
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, timer: setTimeout(() => this.stop('活动读取超时，请检查系统脚本策略。'), 15_000) }
      this.child!.stdin.write('sample\n')
    })
  }

  stop(message = '活动采集已停止。'): void {
    const pending = this.pending
    this.pending = undefined
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(message)) }
    const child = this.child; this.child = undefined
    child?.kill()
  }
}
