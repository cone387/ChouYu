import { afterEach, describe, expect, test, vi } from 'vitest'
import { TrayFlasher } from './tray-flasher'

afterEach(() => vi.useRealTimers())

describe('TrayFlasher', () => {
  test('start 后按周期在 blank 与 normal 间交替', () => {
    vi.useFakeTimers()
    const showNormal = vi.fn()
    const showBlank = vi.fn()
    const flasher = new TrayFlasher({ showNormal, showBlank, intervalMs: 600 })
    flasher.start()
    vi.advanceTimersByTime(599)
    expect(showBlank).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(showBlank).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(600)
    expect(showNormal).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1200)
    expect(showBlank).toHaveBeenCalledTimes(2)
    expect(showNormal).toHaveBeenCalledTimes(2)
    flasher.dispose()
  })

  test('start 幂等;stop 清定时器并恢复 normal;可重启', () => {
    vi.useFakeTimers()
    const showNormal = vi.fn()
    const showBlank = vi.fn()
    const flasher = new TrayFlasher({ showNormal, showBlank })
    expect(flasher.running).toBe(false)
    flasher.start()
    flasher.start()
    expect(flasher.running).toBe(true)
    vi.advanceTimersByTime(600)
    expect(showBlank).toHaveBeenCalledTimes(1)
    flasher.stop()
    expect(flasher.running).toBe(false)
    expect(showNormal).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(600)
    expect(showBlank).toHaveBeenCalledTimes(1)
    flasher.start()
    vi.advanceTimersByTime(600)
    expect(showBlank).toHaveBeenCalledTimes(2)
    flasher.dispose()
    expect(flasher.running).toBe(false)
  })

  test('未 start 时 stop 不调用 showNormal', () => {
    const showNormal = vi.fn()
    const flasher = new TrayFlasher({ showNormal, showBlank: vi.fn() })
    flasher.stop()
    expect(showNormal).not.toHaveBeenCalled()
  })
})
