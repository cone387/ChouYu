import type { RecoveryRequest } from '../../shared/contact-recovery'
export interface RecoveryBudgetPort {
  reserve(input: RecoveryRequest): Promise<void>
  settle(restoreId: string, requestId: string, tokens?: number): Promise<void>
}
export type RecoveryBudgetMessage = { sequence: number } & ({ operation: 'reserve'; input: RecoveryRequest } | { operation: 'settle'; restoreId: string; requestId: string; tokens?: number })
/** Main owns the durable ledger; a lost receipt never licenses another request. */
export class WorkerRecoveryPort implements RecoveryBudgetPort {
  private sequence = 0
  private pending = new Map<number, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  constructor(private send: (message: RecoveryBudgetMessage) => void) {}
  private request(message: Omit<Extract<RecoveryBudgetMessage, { operation: 'reserve' }>, 'sequence'> | Omit<Extract<RecoveryBudgetMessage, { operation: 'settle' }>, 'sequence'>): Promise<void> {
    return new Promise((resolve, reject) => {
      const sequence = ++this.sequence
      const timer = setTimeout(() => { this.pending.delete(sequence); reject(new Error('恢复额度记录尚未确认，本次未发起模型请求。')) }, 15000)
      this.pending.set(sequence, { resolve, reject, timer })
      try { this.send({ ...message, sequence }) }
      catch (error) { clearTimeout(timer); this.pending.delete(sequence); reject(error) }
    })
  }
  receive(sequence: number, error?: string) {
    const request = this.pending.get(sequence)
    if (!request) return
    this.pending.delete(sequence); clearTimeout(request.timer)
    if (error) request.reject(new Error(error)); else request.resolve()
  }
  reserve(input: RecoveryRequest) { return this.request({ operation: 'reserve', input }) }
  settle(restoreId: string, requestId: string, tokens?: number) { return this.request({ operation: 'settle', restoreId, requestId, tokens }) }
}
