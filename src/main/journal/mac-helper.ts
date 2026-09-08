import { execFile, type ChildProcess } from 'child_process'
import { app } from 'electron'
import { join } from 'path'

/** One bounded native macOS script invocation; stopping cancels the current read. */
export class MacJournalHelper {
  private child?: ChildProcess

  read(script: string, args: string[] = []): Promise<string> {
    if (this.child) return Promise.reject(new Error('macOS 采集正在进行。'))
    const directory = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    return new Promise((resolve, reject) => {
      const child = execFile('/usr/bin/osascript', ['-l', 'JavaScript', join(directory, script), ...args],
        { timeout: 15_000, maxBuffer: 200_000 }, (error, stdout) => {
          if (this.child === child) this.child = undefined
          if (error) reject(new Error('macOS 本地采集失败或已取消，请重试。'))
          else resolve(stdout.trim())
        })
      this.child = child
    })
  }

  stop(): void { const child = this.child; this.child = undefined; child?.kill() }
}
