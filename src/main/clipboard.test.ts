import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const readText = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ clipboard: { readText } }))
import { startClipboardWatcher, stopClipboardWatcher } from './clipboard'

const send = vi.fn()
const window = { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow

beforeEach(() => {
  vi.useFakeTimers()
  readText.mockReset()
  send.mockClear()
})
afterEach(() => {
  stopClipboardWatcher()
  vi.useRealTimers()
})

describe('asynchronous clipboard watcher', () => {
  it('establishes a baseline and only reports changed nonempty text', async () => {
    readText.mockResolvedValueOnce('existing').mockResolvedValueOnce('new').mockResolvedValueOnce('new').mockResolvedValueOnce('')
    startClipboardWatcher(window)
    await vi.advanceTimersByTimeAsync(4500)
    expect(send.mock.calls).toEqual([['clipboard:changed', 'new']])
  })

  it('does not overlap reads or deliver a pending read after stopping', async () => {
    let resolve!: (text: string) => void
    readText.mockResolvedValueOnce('baseline').mockImplementationOnce(() => new Promise<string>(done => { resolve = done }))
    startClipboardWatcher(window)
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(6000)
    expect(readText).toHaveBeenCalledTimes(2)
    stopClipboardWatcher()
    resolve('late')
    await vi.advanceTimersByTimeAsync(3000)
    expect(send).not.toHaveBeenCalled()
    expect(readText).toHaveBeenCalledTimes(2)
  })

  it('resumes polling after temporary read failures', async () => {
    readText.mockResolvedValueOnce('baseline').mockRejectedValueOnce(new Error('busy')).mockResolvedValueOnce('recovered')
    startClipboardWatcher(window)
    await vi.advanceTimersByTimeAsync(3000)
    expect(send).toHaveBeenCalledWith('clipboard:changed', 'recovered')
  })
})
