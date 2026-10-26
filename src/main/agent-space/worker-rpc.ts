import { contactStorageDiagnostic, type StorageDiagnostic } from '../storage/contact-database'
import type { ContactCommandMap } from '../../shared/contact-commands'
import type { ContactIdentity } from '../contact-agent/contracts'

export type WorkerCommandMap = ContactCommandMap & {
  init: { args: [directory: string, runtime?: import('../harness/dsh/runtime').DshRuntimeOptions]; result: void }
  sync: { args: [identities: ContactIdentity[]]; result: void }
  syncContact: { args: [identity: ContactIdentity]; result: void }
  close: { args: []; result: void }
}
export type WorkerCommandName = keyof WorkerCommandMap
export type WorkerArgs<M extends WorkerCommandName> = WorkerCommandMap[M]['args']
export type WorkerResult<M extends WorkerCommandName> = WorkerCommandMap[M]['result']
type Worker = { postMessage(value: unknown): void; kill(): boolean | void }
type Entry = { worker: Worker; method: string; phase: string; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; born: number; startedAt?: number }
const timing = (entry: Entry) => ({ elapsedMs: Date.now() - entry.born,
  ...(entry.startedAt !== undefined ? { queueMs: entry.startedAt - entry.born, executionMs: Date.now() - entry.startedAt } : {}) })
/** Each deadline belongs to a worker generation and a request phase. */
export class AgentWorkerRPC {
  private sequence = 0
  private entries = new Map<number, Entry>()
  private probes = new Map<Worker, { id: number; timer: ReturnType<typeof setTimeout> }>()
  constructor(private diagnostic: (event: { method: string; phase: string; elapsedMs: number; queueMs?: number; executionMs?: number; storage?: StorageDiagnostic }, worker: Worker) => void = () => {}) {}
  request<M extends WorkerCommandName>(worker: Worker, method: M, id: string, args: WorkerArgs<M>): Promise<WorkerResult<M>> {
    return this.dispatchUnknown(worker, method, id, args) as Promise<WorkerResult<M>>
  }
  dispatchUnknown(worker: Worker, method: string, id: string, args: unknown[]): Promise<unknown> {
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
      this.diagnostic({ method: entry.method, phase: entry.phase, ...timing(entry) }, entry.worker)
      entry.reject(new Error(entry.method === 'init' ? '联系人执行进程启动超时，正在恢复。' : '联系人操作响应超时；结果尚未确认，请检查原事项状态，勿重复提交。'))
      if (entry.method === 'init') entry.worker.kill()
      else this.probe(entry.worker)
    }, duration)
  }
  private probe(worker: Worker) {
    if (this.probes.has(worker)) return
    const id = ++this.sequence
    const timer = setTimeout(() => {
      if (this.probes.get(worker)?.id !== id) return
      this.probes.delete(worker)
      this.diagnostic({ method: 'health', phase: 'unresponsive', elapsedMs: 5000 }, worker)
      this.exited(worker); worker.kill()
    }, 5000)
    this.probes.set(worker, { id, timer })
    try { worker.postMessage({ ping: id }) }
    catch { clearTimeout(timer); this.probes.delete(worker); this.exited(worker); worker.kill() }
  }
  receive(worker: Worker, message: { requestId?: number; pong?: number; started?: boolean; result?: unknown; error?: string; storage?: unknown; storageRetry?: { attempt: number; storage: unknown } }) {
    if (message.pong !== undefined) {
      const probe = this.probes.get(worker)
      if (probe?.id === message.pong) { clearTimeout(probe.timer); this.probes.delete(worker) }
      return
    }
    if (message.requestId === undefined) return
    const entry = this.entries.get(message.requestId)
    if (!entry || entry.worker !== worker) return
    if (message.storageRetry) {
      const storage = contactStorageDiagnostic(message.storageRetry.storage), attempt = message.storageRetry.attempt
      if (entry.method === 'init' && storage && Number.isInteger(attempt) && attempt >= 1 && attempt <= 3) this.diagnostic({ method: 'init', phase: `storage-retry:${attempt}`, elapsedMs: Date.now() - entry.born, storage }, worker)
      return
    }
    if (message.started) {
      if (entry.phase === 'running') return
      entry.phase = 'running'; entry.startedAt = Date.now(); this.arm(message.requestId, entry.method === 'init' ? 60000 : 15000); return
    }
    clearTimeout(entry.timer); this.entries.delete(message.requestId)
    if (message.error) this.diagnostic({ method: entry.method, phase: 'failed:' + entry.phase, ...timing(entry), storage: contactStorageDiagnostic(message.storage) }, worker)
    else if (entry.method === 'init' || Date.now() - entry.born >= 5000) this.diagnostic({ method: entry.method, phase: 'completed:' + entry.phase, ...timing(entry) }, worker)
    if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message.result)
  }
  exited(worker: Worker) {
    const probe = this.probes.get(worker)
    if (probe) { clearTimeout(probe.timer); this.probes.delete(worker) }
    for (const [id, entry] of this.entries) if (entry.worker === worker) {
      clearTimeout(entry.timer); this.entries.delete(id)
      entry.reject(new Error('联系人执行进程已退出，未完成工作将在恢复后继续。'))
    }
  }
}
