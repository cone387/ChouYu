import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ selected: 'native', recover: vi.fn(), purge: vi.fn(), saved: vi.fn(), close: vi.fn(), run: vi.fn() }))
vi.mock('../database', () => ({ getCharacter: () => ({ harnessEngine: fixture.selected }) }))
vi.mock('./dsh/module', () => ({ createDshModule: () => ({ id: 'dsh', label: 'DSH', capabilities: { platforms: ['win32'], scenarios: ['chat'], images: false, systemHistory: false, tools: [], confirmation: 'await-receipt', recovery: 'committed-result' }, adapter: { run: fixture.run }, confirmation: () => ({ mode: 'return-card' }), lifecycle: { recover: fixture.recover, purge: fixture.purge, acknowledgeSaved: fixture.saved, close: fixture.close } }) }))
import { chatHarness, harnessRegistry, recoverHarnessModules, purgeHarnessData, acknowledgeHarnessMessages, closeHarnessModules } from './service'
beforeEach(() => { vi.resetAllMocks(); fixture.selected = 'native'; harnessRegistry.get('native').lifecycle = undefined })
afterEach(() => { harnessRegistry.get('native').lifecycle = undefined })
it('reads contact selection without changing an already selected request engine', () => {
  const chosen = chatHarness.engineFor('contact')
  fixture.selected = 'dsh'
  expect(chosen).toBe('native'); expect(chatHarness.engineFor('contact')).toBe('dsh')
})
it('dispatches persistence lifecycle through modules and keeps cleanup failures visible', async () => {
  await recoverHarnessModules(); await acknowledgeHarnessMessages('s')
  expect(fixture.recover).toHaveBeenCalledTimes(1); expect(fixture.saved).toHaveBeenCalledWith('s')
  fixture.purge.mockRejectedValueOnce(new Error('logs locked'))
  await expect(purgeHarnessData({ characterId: 'c', sessionId: 's' })).rejects.toThrow('logs locked')
  expect(fixture.purge).toHaveBeenCalledWith({ characterId: 'c', sessionId: 's' })
})
it('closes all registered modules even if another module fails to close', async () => {
  harnessRegistry.get('native').lifecycle = { close: async () => { throw new Error('native close failed') } }
  await expect(closeHarnessModules()).rejects.toThrow('native close failed')
  expect(fixture.close).toHaveBeenCalledTimes(1)
})
