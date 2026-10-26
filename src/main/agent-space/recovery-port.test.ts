import { expect, it, vi } from 'vitest'
import { WorkerRecoveryPort } from './recovery-port'

it('does not proceed without the persisted reservation receipt and ignores late receipts', async () => {
  vi.useFakeTimers()
  try {
    const send = vi.fn(), port = new WorkerRecoveryPort(send)
    const reserve = port.reserve({ restoreId: 'r', requestId: 'call', owner: 'alice', topicId: 'task', tokens: 100 })
    const failed = expect(reserve).rejects.toThrow(/尚未确认/)
    await vi.advanceTimersByTimeAsync(15000); await failed
    expect(send).toHaveBeenCalledOnce()
    port.receive(1)
    const next = port.settle('r', 'call')
    port.receive(2, 'application storage unavailable')
    await expect(next).rejects.toThrow('application storage unavailable')
  } finally { vi.useRealTimers() }
})
