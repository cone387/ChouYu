import { expect, it, vi } from 'vitest'
const mocked = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), statistics: vi.fn(() => ({ calls: 2 })) }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => mocked.handlers.set(name, fn), removeHandler: (name: string) => mocked.handlers.delete(name) } }))
vi.mock('../usage', () => ({ getUsageStore: () => ({ statistics: mocked.statistics }) }))
import { registerUsageHandlers } from './usage'
import { createUsageBridge } from '../../preload/bridges/usage'

it('registers one read-only aggregate handler, validates range, bridges and disposes it', async () => {
  const dispose = registerUsageHandlers()
  try {
    const handler = mocked.handlers.get('usage:statistics')!
    const invoke = vi.fn(async (channel, ...args) => mocked.handlers.get(channel)!({}, ...args))
    const bridge = createUsageBridge({ invoke } as any)
    expect(await bridge.usage.statistics(30)).toEqual({ calls: 2 })
    expect(mocked.statistics).toHaveBeenCalledWith(30)
    expect(() => handler({}, 8)).toThrow()
    expect(mocked.statistics).toHaveBeenCalledTimes(1)
    expect([...mocked.handlers.keys()]).toEqual(['usage:statistics'])
  } finally { dispose() }
  expect(mocked.handlers.size).toBe(0)
})
