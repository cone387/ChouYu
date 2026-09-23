import { describe, expect, it, vi, beforeEach } from 'vitest'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { readSource } from './sources'
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('node:https', () => ({ request: vi.fn() }))
beforeEach(() => vi.clearAllMocks())
describe('agent network permission boundary', () => {
  it('rejects mixed public/private DNS answers before creating a socket', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] as never)
    await expect(readSource('https://public-looking.example', new AbortController().signal)).rejects.toThrow('内网')
    expect(request).not.toHaveBeenCalled()
  })
  it('pins DNS at connection time and rejects a redirect outside the approved origin', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never)
    vi.mocked(request).mockImplementation(((_url: unknown, options: any, callback: any) => {
      const result = vi.fn(); options.lookup('public-looking.example', {}, result)
      expect(result).toHaveBeenCalledWith(null, '8.8.8.8', 4)
      const all = vi.fn(); options.lookup('public-looking.example', { all: true }, all)
      expect(all).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }], 4)
      expect(options.headers.Authorization).toBeUndefined()
      return { setTimeout() {}, on() {}, end() { callback({ statusCode: 302, headers: { location: 'https://127.0.0.1/private' }, resume() {} }) } }
    }) as never)
    await expect(readSource('https://public-looking.example', new AbortController().signal)).rejects.toThrow('同站')
    expect(request).toHaveBeenCalledTimes(1); expect(lookup).toHaveBeenCalledTimes(1)
  })
  it('cancels a stuck DNS lookup so it cannot hold the execution queue', async () => {
    vi.mocked(lookup).mockReturnValue(new Promise(() => {}) as never)
    const controller = new AbortController(), result = readSource('https://public-looking.example', controller.signal)
    controller.abort(new Error('cancelled'))
    await expect(result).rejects.toThrow('cancelled'); expect(request).not.toHaveBeenCalled()
  })
})
