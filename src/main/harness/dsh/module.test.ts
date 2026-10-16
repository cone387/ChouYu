import { beforeEach, expect, it, vi } from 'vitest'
const runtime = vi.hoisted(() => ({
  acquire: vi.fn(), guard: vi.fn(), run: vi.fn(), invalidate: vi.fn(), flush: vi.fn(), receipt: vi.fn(),
  recover: vi.fn(), purge: vi.fn(), saved: vi.fn(), close: vi.fn()
}))
vi.mock('./service', () => ({
  existingDshService: () => undefined,
  dshService: () => { runtime.acquire(); return { adapter: { run: runtime.run, invalidate: runtime.invalidate, beforePersistentOffer: runtime.flush }, actions: { waitForActionReceipt: runtime.receipt } } },
  assertDshRecovered: runtime.guard, recoverDshService: runtime.recover, purgeDshData: runtime.purge,
  acknowledgeDshMessages: runtime.saved, closeDshService: runtime.close
}))
import { createDshModule } from './module'
import { createNativeModule } from '../native'
import { HarnessRegistry } from '../registry'
import { HarnessCoordinator } from '../coordinator'
import { DEFAULT_APP_CONFIG } from '../../../shared/config'
import type { HarnessInput } from '../contracts'
const input = (): HarnessInput => ({ requestId: 'r', attemptId: 'a', characterId: 'c', sessionId: 's', messages: [{ role: 'user', content: 'hi' }], systemPrompt: '', config: { ...DEFAULT_APP_CONFIG, baseUrl: 'http://fixture.test', apiKey: 'fixture', model: 'fixture' }, snapshotFingerprint: 's', configVersion: 'v', signal: new AbortController().signal, assertContext: async () => {} })
beforeEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals() })
it('registers lazily and leaves DSH untouched during native chat', async () => {
  const module = createDshModule({ cancelRun: async () => {} })
  const coordinator = new HarnessCoordinator(new HarnessRegistry([createNativeModule(), module]))
  vi.stubGlobal('fetch', async () => new Response('data: {"choices":[{"delta":{"content":"native reply"}}]}\n\ndata: [DONE]\n\n'))
  expect(await coordinator.run(input(), () => {})).toMatchObject({ state: 'completed', text: 'native reply' })
  expect(runtime.acquire).not.toHaveBeenCalled()
})
it('rejects unsupported DSH input before acquiring a runtime or running recovery guard', async () => {
  const coordinator = new HarnessCoordinator(new HarnessRegistry([createDshModule({ cancelRun: async () => {} })]), () => 'dsh', 'win32')
  const value = input(); value.messages[0].imageUrl = 'data:image/png;base64,AAAA'
  expect(await coordinator.run(value, () => {})).toMatchObject({ state: 'failed' })
  expect(runtime.acquire).not.toHaveBeenCalled(); expect(runtime.guard).not.toHaveBeenCalled()
})
it('binds durable confirmation to the exact request and delegates cancellation during purge', async () => {
  const cancelRun = vi.fn(async () => {}), module = createDshModule({ cancelRun }), value = input()
  const confirmation = module.confirmation(value)
  expect(runtime.acquire).not.toHaveBeenCalled()
  if (confirmation.mode !== 'await-receipt') throw new Error('missing receipt mode')
  const call = { id: 'call', name: 'set_contact_output_preference', arguments: '{}' }
  await confirmation.beforeOffer(call)
  await confirmation.waitForReceipt(call, { id: 'card' } as never)
  expect(runtime.flush).toHaveBeenCalledWith({ ...value, callId: 'call' })
  expect(runtime.receipt).toHaveBeenCalledWith({ ...value, callId: 'call' }, 'card', value.signal)
  runtime.purge.mockImplementation(async (_scope, cancel) => cancel('sender:r'))
  await module.lifecycle!.purge!({ characterId: 'c' })
  expect(cancelRun).toHaveBeenCalledWith('sender:r')
})
