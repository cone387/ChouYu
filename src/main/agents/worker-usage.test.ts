import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeUsage, getUsageStore } from '../usage'
import { UsageStore } from '../usage/store'

const fixture = vi.hoisted(() => ({ fail: false, close: vi.fn(async () => {}) }))
vi.mock('../agent-space/workloop-host', () => ({ WorkLoopHost: class { constructor() { if (fixture.fail) throw new Error('init failed') } close = fixture.close } }))
vi.mock('../skills/library', () => ({ SkillLibrary: class {} }))
vi.mock('./sources', () => ({ evidenceFromText: vi.fn() }))
const old = Object.getOwnPropertyDescriptor(process, 'parentPort')
afterEach(() => { closeUsage(); fixture.fail = false; if (old) Object.defineProperty(process, 'parentPort', old); else Reflect.deleteProperty(process, 'parentPort') })

it('opens the main application ledger in the actual worker init path and closes it after worker shutdown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-worker-usage-'))
  let receive!: (event: any) => void
  const replies: any[] = []
  Object.defineProperty(process, 'parentPort', { configurable: true, value: { on: (_: string, callback: typeof receive) => { receive = callback }, postMessage: (value: any) => replies.push(value) } })
  try {
    await import('./worker')
    receive({ data: { requestId: 1, method: 'init', id: '', args: [join(dir, 'contact-agents')] } })
    await vi.waitFor(() => expect(replies.some(reply => reply.requestId === 1 && 'result' in reply)).toBe(true))
    getUsageStore().begin('worker-call', 'worker-model')
    getUsageStore().update('worker-call', { usage: { totalTokens: 19 } })
    const main = new UsageStore(dir)
    expect(main.statistics(7)).toMatchObject({ calls: 1, tokens: 19 })
    main.close()
    receive({ data: { requestId: 2, method: 'close', id: '', args: [] } })
    await vi.waitFor(() => expect(replies.some(reply => reply.requestId === 2 && 'result' in reply)).toBe(true))
    expect(fixture.close).toHaveBeenCalledTimes(1)
    expect(() => getUsageStore()).toThrow()
    fixture.fail = true
    receive({ data: { requestId: 3, method: 'init', id: '', args: [join(dir, 'contact-agents')] } })
    await vi.waitFor(() => expect(replies.some(reply => reply.requestId === 3 && reply.error === 'init failed')).toBe(true))
    expect(() => getUsageStore()).toThrow()
  } finally { closeUsage(); rmSync(dir, { recursive: true, force: true }) }
})
