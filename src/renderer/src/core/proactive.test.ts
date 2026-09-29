import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ProactiveEngine } from './proactive'
let idle = 0
let engine: ProactiveEngine
const seen: string[] = []
const state = new Map<string, string>()
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 29, 8))
  idle = 0; seen.length = 0; state.clear(); engine = new ProactiveEngine()
  vi.stubGlobal('localStorage', { getItem: (key: string) => state.get(key), setItem: (key: string, value: string) => state.set(key, value) })
  vi.stubGlobal('window', { electronAPI: { getSystemIdleSeconds: async () => idle } })
})
afterEach(() => { engine.stop(); vi.unstubAllGlobals(); vi.useRealTimers() })
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)
const start = (greeting = false, restReminder = true, returnReminder = true) => engine.start((_message, kind) => { seen.push(kind!) }, { greeting, restReminder, returnReminder })
describe('companion activity reminders', () => {
  test('greets once per local day, including across restart and midnight', async () => {
    start(true, false); await advance(3000); expect(seen).toEqual(['greeting'])
    engine.stop(); start(true, false); await advance(3000); expect(seen).toHaveLength(1)
    vi.setSystemTime(new Date(2026, 8, 30, 8)); await advance(15_000); expect(seen).toEqual(['greeting', 'greeting'])
  })
  test('opening the panel does not defer a rest; real inactivity resets it', async () => {
    start(); await advance(30 * 60_000); engine.userActivity(); await advance(31 * 60_000)
    expect(seen).toEqual(['rest'])
    idle = 360; await advance(30 * 60_000); expect(seen).toEqual(['rest'])
    idle = 0; await advance(31 * 60_000); expect(seen).toEqual(['rest'])
    await advance(30 * 60_000); expect(seen).toEqual(['rest', 'rest'])
  })
  test('long timer gaps do not count as continuous use', async () => {
    start(false, true, false); await advance(30 * 60_000)
    vi.setSystemTime(Date.now() + 8 * 60 * 60_000); await advance(15_000)
    expect(seen).toEqual([]); await advance(61 * 60_000); expect(seen).toEqual(['rest'])
  })
  test('return has an independent switch and never arrives late after cooldown', async () => {
    start(true); await advance(3000)
    idle = 700; await advance(15_000); idle = 0; await advance(15_000)
    await advance(55 * 60_000); expect(seen).toEqual(['greeting'])
    start(false, false, false); idle = 700; await advance(15_000); idle = 0; await advance(15_000)
    expect(seen).toEqual(['greeting'])
  })
  test('returns once after a break and only while recently active', async () => {
    start(false, false); idle = 700; await advance(20_000); idle = 45; await advance(15_000)
    expect(seen).toEqual([]); idle = 0; await advance(15_000); expect(seen).toEqual(['return'])
    await advance(70 * 60_000); expect(seen).toHaveLength(1)
  })
  test('failed greeting delivery is retried, stop invalidates in-flight idle reads', async () => {
    let failures = 1
    engine.start((_msg, kind) => { if (failures--) throw new Error('disk full'); seen.push(kind!) }, { greeting: true, restReminder: false })
    await advance(3000); expect(seen).toEqual([]); await advance(15_000); expect(seen).toEqual(['greeting'])
    engine.stop()
    let finish!: (n: number) => void
    window.electronAPI.getSystemIdleSeconds = () => new Promise(resolve => { finish = resolve })
    start(false, true); await advance(3000); engine.stop(); finish(0); await advance(100_000); expect(seen).toHaveLength(1)
  })
})


test('return context points to the last activity before leaving, not the last half hour after return', async () => {
  const contexts: number[] = []
  engine.start((_message, kind, _id, context) => { if (kind === 'return') contexts.push(context!.leftAt) }, { greeting: false, restReminder: false })
  const before = Date.now(); idle = 3600; await advance(3000); idle = 0; await advance(15_000)
  expect(contexts).toEqual([before + 3000 - 3600_000])
})
