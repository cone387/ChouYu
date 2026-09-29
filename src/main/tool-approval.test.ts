import { afterEach, describe, expect, it, vi } from 'vitest'
import { toolApprovalFailure, waitForToolApproval } from './tool-approval'

afterEach(() => vi.useRealTimers())

function pendingApproval() {
  vi.useFakeTimers()
  const controller = new AbortController()
  const cleanup = vi.fn()
  let respond!: (approved: boolean) => void
  const result = waitForToolApproval(controller.signal, callback => {
    respond = callback
    return cleanup
  })
  return { controller, cleanup, respond, result }
}

describe('tool approval outcomes', () => {
  it('expires after 60 seconds without attributing a refusal to the user', async () => {
    const pending = pendingApproval()
    const settled = vi.fn()
    void pending.result.then(settled)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending.result).toBe('expired')
    expect(pending.cleanup).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    pending.respond(true)
    expect(await pending.result).toBe('expired')
    expect(toolApprovalFailure('expired')).toMatchObject({ status: 'expired', summary: expect.stringContaining('并非用户拒绝') })
    expect(toolApprovalFailure('expired').content).toContain('不要换用其他工具重试')
  })

  it.each([true, false])('preserves the explicit user decision %s', async approved => {
    const pending = pendingApproval()
    pending.respond(approved)
    expect(await pending.result).toBe(approved ? 'approved' : 'denied')
    expect(pending.cleanup).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    pending.controller.abort()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await pending.result).toBe(approved ? 'approved' : 'denied')
    expect(pending.cleanup).toHaveBeenCalledOnce()
  })

  it('cancels on abort without treating it as a refusal', async () => {
    const pending = pendingApproval()
    pending.controller.abort()
    expect(await pending.result).toBe('cancelled')
    expect(pending.cleanup).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    pending.respond(true)
    expect(await pending.result).toBe('cancelled')
  })

  it('does not publish an already cancelled request', async () => {
    const controller = new AbortController()
    controller.abort()
    const subscribe = vi.fn()
    expect(await waitForToolApproval(controller.signal, subscribe)).toBe('cancelled')
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('cleans up a response delivered synchronously during subscription', async () => {
    vi.useFakeTimers()
    const cleanup = vi.fn()
    expect(await waitForToolApproval(new AbortController().signal, respond => {
      respond(true)
      return cleanup
    })).toBe('approved')
    expect(cleanup).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports delivery failure and clears the timer', async () => {
    vi.useFakeTimers()
    await expect(waitForToolApproval(new AbortController().signal, () => {
      throw new Error('delivery failed')
    })).rejects.toThrow('delivery failed')
    expect(vi.getTimerCount()).toBe(0)
  })
})
