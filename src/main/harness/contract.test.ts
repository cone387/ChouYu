import { expect, it, vi } from 'vitest'
import { HarnessRegistry } from './registry'
import { HarnessCoordinator } from './coordinator'
import { createNativeModule } from './native'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import type { HarnessEvent, HarnessInput, HarnessSink } from './contracts'

const input = (): HarnessInput => ({ requestId: 'r', attemptId: 'a', messages: [], systemPrompt: '', config: DEFAULT_APP_CONFIG, configVersion: 'v', snapshotFingerprint: 's', signal: new AbortController().signal, assertContext: async () => {} })
it.each(['native', 'dsh'] as const)('%s has one terminal result and ordered events, with no post-completion output', async id => {
  const module = { ...createNativeModule(), id }, events: HarnessEvent[] = []
  let late!: HarnessSink
  module.adapter = { run: async (_input, emit) => { late = emit; emit({ type: 'text', operation: 'append', text: 'body' }); emit({ type: 'completed', text: 'duplicate' }); return { state: 'completed', text: 'body' } } }
  const coordinator = new HarnessCoordinator(new HarnessRegistry([module]))
  expect(await coordinator.run(input(), e => events.push(e), id)).toMatchObject({ state: 'completed', text: 'body' })
  late({ type: 'text', operation: 'append', text: 'too late' })
  expect(events.map(e => e.type)).toEqual(['started','text','completed'])
  expect(events.map(e => e.seq)).toEqual([1,2,3])
})
it.each(['native', 'dsh'] as const)('%s close waits for cancellation and rejects overlapping request identity', async id => {
  const module = { ...createNativeModule(), id }, events: HarnessEvent[] = []
  let finish!: () => void, entered!: () => void
  const active = new Promise<void>(resolve => { entered = resolve })
  module.adapter = { run: async (value) => { entered(); await new Promise<void>(resolve => { finish = resolve }); value.signal.throwIfAborted(); return { state: 'completed', text: 'never' } } }
  const coordinator = new HarnessCoordinator(new HarnessRegistry([module]))
  const first = coordinator.run(input(), e => events.push(e), id)
  await active
  expect(await coordinator.run(input(), () => {}, id)).toMatchObject({ state: 'failed' })
  const settled = vi.fn(), closed = coordinator.close().then(settled)
  await Promise.resolve()
  expect(settled).not.toHaveBeenCalled()
  finish(); await closed
  expect(await first).toMatchObject({ state: 'cancelled' })
  expect(events.map(e => e.type)).toEqual(['started','cancelled'])
})
