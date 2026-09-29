export type ToolApprovalOutcome = 'approved' | 'denied' | 'expired' | 'cancelled'

/** Only an explicit renderer response counts as a user decision. */
export function waitForToolApproval(
  signal: AbortSignal,
  subscribe: (respond: (approved: boolean) => void) => () => void
): Promise<ToolApprovalOutcome> {
  if (signal.aborted) return Promise.resolve('cancelled')
  return new Promise((resolve, reject) => {
    let settled = false
    let unsubscribe: (() => void) | undefined
    const cleanup = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      unsubscribe?.()
    }
    const finish = (outcome: ToolApprovalOutcome) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(outcome)
    }
    const abort = () => finish('cancelled')
    const timeout = setTimeout(() => finish('expired'), 60_000)
    signal.addEventListener('abort', abort, { once: true })
    try {
      unsubscribe = subscribe(approved => finish(approved ? 'approved' : 'denied'))
      if (settled) unsubscribe()
    } catch (error) {
      settled = true
      cleanup()
      reject(error)
    }
  })
}

export function toolApprovalFailure(outcome: Exclude<ToolApprovalOutcome, 'approved'>) {
  const summary = outcome === 'expired'
    ? '等待确认超时，操作未执行（并非用户拒绝）'
    : outcome === 'cancelled'
      ? '请求已取消，操作未执行（并非用户拒绝）'
      : '用户拒绝了此操作'
  return {
    status: outcome,
    summary,
    content: `${summary}。请如实说明原因，不要换用其他工具重试此操作；等待用户新的明确指令。`
  }
}
