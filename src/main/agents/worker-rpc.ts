type Worker = { postMessage(value: unknown): void; kill(): boolean | void }
type Entry = { worker: Worker; method: string; phase: string; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; born: number }
/** Each deadline belongs to a worker generation and a request phase. */
export class AgentWorkerRPC {
  private sequence = 0
  private entries = new Map<number, Entry>()
  constructor(private diagnostic: (event: { method: string; phase: string; elapsedMs: number }) => void = () => {}) {}
  request(worker: Worker, method: string, id: string, args: unknown[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = ++this.sequence
      const entry: Entry = { worker, method, phase: method === 'init' ? 'startup' : 'queue', resolve, reject, timer: undefined!, born: Date.now() }
      this.entries.set(requestId, entry); this.arm(requestId, 60000)
      try { worker.postMessage({ requestId, method, id, args }) }
      catch (error) { clearTimeout(entry.timer); this.entries.delete(requestId); reject(error) }
    })
  }
  private arm(id: number, duration: number) {
    const entry = this.entries.get(id)!
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      if (this.entries.get(id) !== entry) return
      this.entries.delete(id)
      this.diagnostic({ method: entry.method, phase: entry.phase, elapsedMs: Date.now() - entry.born })
      entry.reject(new Error(entry.phase === 'startup' ? '联系人执行进程启动超时，正在恢复。' : '联系人执行进程响应超时，正在恢复；未确认的操作请检查原事项状态。'))
      entry.worker.kill()
    }, duration)
  }
  receive(worker: Worker, message: { requestId: number; started?: boolean; result?: unknown; error?: string }) {
    const entry = this.entries.get(message.requestId)
    if (!entry || entry.worker !== worker) return
    if (message.started) {
      if (entry.phase === 'running') return
      entry.phase = 'running'; this.arm(message.requestId, entry.method === 'init' ? 60000 : 15000); return
    }
    clearTimeout(entry.timer); this.entries.delete(message.requestId)
    if (entry.method === 'init' || Date.now() - entry.born >= 5000) this.diagnostic({ method: entry.method, phase: 'completed:' + entry.phase, elapsedMs: Date.now() - entry.born })
    if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message.result)
  }
  exited(worker: Worker) {
    for (const [id, entry] of this.entries) if (entry.worker === worker) {
      clearTimeout(entry.timer); this.entries.delete(id)
      entry.reject(new Error('联系人执行进程已退出，未完成工作将在恢复后继续。'))
    }
  }
}
