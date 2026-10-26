import { describe, expect, it } from 'vitest'
import { ContactRuntimeState, runtimeDiagnostic } from './runtime-status'

describe('shared contact runtime observations', () => {
  it('ignores an old process exit after a replacement is ready', () => {
    const state = new ContactRuntimeState()
    const old = state.start(10)
    state.update(old, { phase: 'ready', readyAt: 20 })
    const current = state.start(30)
    state.update(current, { phase: 'ready', readyAt: 40 })
    const before = state.read()
    state.update(old, { phase: 'unavailable', issue: { kind: 'exit', at: 50 } })
    expect(state.read()).toEqual(before)
    expect(before).toMatchObject({ generation: 2, phase: 'ready', restartCount: 1, readyAt: 40 })
  })

  it('keeps last observation time but removes live metrics when the worker exits', () => {
    const state = new ContactRuntimeState(), generation = state.start(10)
    state.update(generation, { phase: 'ready', syncedAt: 20, metrics: { observedAt: 25, activeRuns: 2, capacity: 8, pendingDeliveries: 3, oldestPendingAt: 12 } })
    state.update(generation, { phase: 'recovering', issue: { kind: 'exit', at: 30 } })
    expect(state.read()).toMatchObject({ phase: 'recovering', observedAt: 25, syncedAt: 20, issue: { kind: 'exit', at: 30 } })
    expect(state.read().metrics).toBeUndefined()
  })

  it('preserves failure evidence after a successful sync and protects returned snapshots', () => {
    const state = new ContactRuntimeState(), generation = state.start(10)
    state.update(generation, { phase: 'ready', issue: { kind: 'sync', at: 20 } })
    state.update(generation, { syncedAt: 30 })
    const copy = state.read(); copy.issue!.at = 999
    expect(state.read()).toMatchObject({ syncedAt: 30, issue: { kind: 'sync', at: 20 } })
  })

  it('projects diagnostics without retaining arbitrary exception text or payloads', () => {
    const event = { method: 'init', phase: 'failed:running', elapsedMs: 42, storage: { database: 'tasks', phase: 'wal', code: 'SQLITE_IOERR_TRUNCATE', path: 'private/file' }, error: 'secret-token', prompt: 'private text' }
    expect(runtimeDiagnostic(event, 3, 100)).toEqual({ at: 100, generation: 3, method: 'init', phase: 'failed:running', elapsedMs: 42, storage: { database: 'tasks', phase: 'wal', code: 'SQLITE_IOERR_TRUNCATE' } })
    expect(runtimeDiagnostic({ method: 'secret\n', phase: 'secret', elapsedMs: Infinity }, 3, 100)).toEqual({ at: 100, generation: 3, method: 'unknown', phase: 'unknown' })
  })
})
