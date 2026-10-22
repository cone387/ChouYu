import { expect, it, vi } from 'vitest'
import { StorageQuitGuard } from './quit-guard'

it('checks late writes after workers finish and blocks exit until retry or explicit discard', () => {
  let error: string | null = null
  const ask = vi.fn(() => false), flush = vi.fn(() => ({ error, notice: null, revision: 0 }))
  const guard = new StorageQuitGuard(flush, ask)
  expect(guard.mayExit()).toBe(true)
  // A worker finishes after the first before-quit, but its final save fails.
  error = 'late save failed'
  expect(guard.mayExit()).toBe(false)
  expect(ask).toHaveBeenCalledWith('late save failed')
  error = null
  expect(guard.mayExit()).toBe(true)
  expect(flush).toHaveBeenCalledTimes(3)
})

it('remembers an explicit discard choice while still attempting the final flush', () => {
  const flush = vi.fn(() => ({ error: 'failed', notice: null, revision: 0 })), ask = vi.fn(() => true)
  const guard = new StorageQuitGuard(flush, ask)
  expect(guard.mayExit()).toBe(true)
  expect(guard.mayExit()).toBe(true)
  expect(flush).toHaveBeenCalledTimes(2)
  expect(ask).toHaveBeenCalledTimes(1)
})
