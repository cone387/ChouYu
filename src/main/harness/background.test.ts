import { afterEach, expect, it, vi } from 'vitest'
import { HarnessRegistry } from './registry'
import { createNativeModule } from './native'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import type { HarnessModule } from './contracts'

afterEach(() => vi.unstubAllGlobals())
it('rejects a registered module without the budgeted background contract', () => {
  const native = createNativeModule()
  const unsupported: HarnessModule = { ...native, id: 'dsh', label: 'DSH', background: undefined }
  const registry = new HarnessRegistry([native, unsupported])
  expect(() => registry.background('dsh')).toThrow(/后台/)
})
it('reserves before a real native provider request and settles it through the module entry', async () => {
  const timeline: string[] = [], bodies: any[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    timeline.push('request'); bodies.push(JSON.parse(String(init.body)))
    return new Response('data: {"choices":[{"delta":{"content":"actual result"}}]}\n\ndata: [DONE]\n\n')
  })
  const registry = new HarnessRegistry([createNativeModule()]); let text = ''
  await registry.background('native').run({ messages: [{ role: 'user', content: 'work' }], systemPrompt: '',
    config: { ...DEFAULT_APP_CONFIG, baseUrl: 'https://fixture.example', apiKey: 'fixture', model: 'fixture' }, signal: new AbortController().signal,
    onChunk: chunk => { text += chunk }, options: { beforeRound: () => { timeline.push('reserve'); return 700 }, afterRound: () => { timeline.push('settle') } } })
  expect(text).toBe('actual result'); expect(timeline).toEqual(['reserve', 'request', 'settle'])
  expect(bodies[0].max_tokens).toBe(700)
})
it('does not start a provider request after cancellation or denied capacity', async () => {
  let requests = 0; vi.stubGlobal('fetch', async () => { requests++; return new Response('') })
  const registry = new HarnessRegistry([createNativeModule()]), abort = new AbortController()
  abort.abort()
  const input = { messages: [], systemPrompt: '', config: { ...DEFAULT_APP_CONFIG, baseUrl: 'https://fixture.example', apiKey: 'test', model: 'test' }, signal: abort.signal, onChunk: () => {} }
  await expect(registry.background('native').run(input)).rejects.toThrow()
  await expect(registry.background('native').run({ ...input, signal: new AbortController().signal, options: { beforeRound: () => { throw new Error('budget denied') } } })).rejects.toThrow('budget denied')
  expect(requests).toBe(0)
})
