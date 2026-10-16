import { expect, it, vi } from 'vitest'
import { HarnessRegistry } from './registry'
import { createNativeModule } from './native'
import { prepareHarnessInput } from './prepare'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import type { AIToolDefinition } from '../../shared/tools'

const tool = (name: string): AIToolDefinition => ({ name, displayName: name, description: name, source: 'builtin', risk: 'read', requiresConfirmation: false, inputSchema: { type: 'object', properties: {} } })
const prepare = () => prepareHarnessInput({ requestId: 'r', systemPrompt: '', messages: [{ role: 'user', content: 'hi' }] }, { config: DEFAULT_APP_CONFIG, signal: new AbortController().signal, assertContext: async () => {}, citationContext: async () => '', privateContext: '', skillContext: '', communication: '' })
it('restricts both exposed definitions and actual execution without altering host tools', async () => {
  const module = createNativeModule(), input = await prepare(), execute = vi.fn(async () => 'allowed result')
  module.capabilities = { ...module.capabilities, tools: ['read'] }
  input.tools = { definitions: [tool('read'), tool('write')], execute }
  const narrowed = new HarnessRegistry([module]).prepare('native', input, 'win32')
  expect(narrowed.tools!.definitions.map(t => t.name)).toEqual(['read'])
  expect(input.tools.definitions).toHaveLength(2)
  await expect(narrowed.tools!.execute({ id: 'x', name: 'write', arguments: '{}' })).rejects.toThrow()
  expect(execute).not.toHaveBeenCalled()
  expect(await narrowed.tools!.execute({ id: 'r', name: 'read', arguments: '{}' })).toBe('allowed result')
})
it.each(['platform', 'images', 'systemHistory', 'scenario'] as const)('rejects unsupported %s before invoking an adapter', async kind => {
  const module = createNativeModule(), input = await prepare()
  if (kind === 'platform') module.capabilities = { ...module.capabilities, platforms: ['win32'] }
  if (kind === 'images') { module.capabilities = { ...module.capabilities, images: false }; input.messages[0].imageUrl = 'data:image/png;base64,AAAA' }
  if (kind === 'systemHistory') { module.capabilities = { ...module.capabilities, systemHistory: false }; input.messages.push({ role: 'system', content: 'extra' }) }
  if (kind === 'scenario') module.capabilities = { ...module.capabilities, scenarios: [] }
  expect(() => new HarnessRegistry([module]).prepare('native', input, 'darwin')).toThrow()
})
it('rejects duplicate and unavailable modules', () => {
  expect(() => new HarnessRegistry([createNativeModule(), createNativeModule()])).toThrow()
  expect(() => new HarnessRegistry([createNativeModule()]).get('dsh')).toThrow()
})
