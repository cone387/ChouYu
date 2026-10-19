import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULT_APP_CONFIG } from '../../../shared/config'
import { createDshBackgroundModule } from './background'
import { HarnessRegistry } from '../registry'
import { startMockProvider } from './fixtures/mock-provider.mjs'
import { AgentOutputTruncatedError } from '../../agents/model-output'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
it('waits for a cancelled tool before purging its logs while a peer can purge independently', async () => {
  const home = mkdtempSync(join(tmpdir(), 'chouyu-dsh-purge-active-'))
  const provider = await startMockProvider('openai')
  const module = createDshBackgroundModule({ home, node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') })
  let release!: () => void, started = false, purged = false
  const held = new Promise<void>(resolve => { release = resolve })
  cleanup.push(() => rmSync(home, { recursive: true, force: true }), () => provider.close(), () => module.lifecycle!.close!(), () => release())
  const input = { characterId: 'alice', requestId: 'one', messages: [{ role: 'user' as const, content: 'work' }], systemPrompt: 'Persona',
    config: { ...DEFAULT_APP_CONFIG, provider: 'openai' as const, baseUrl: provider.baseUrl, apiKey: 'fixture', model: 'fixture' }, signal: new AbortController().signal,
    onChunk: () => {}, options: { maxOutputTokens: 512, timeoutMs: 30000 } }
  const running = module.background!.run({ ...input, tools: { definitions: [{ name: 'chouyu_fixture', displayName: 'fixture', description: 'fixture', source: 'builtin', risk: 'safe', requiresConfirmation: false, inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }],
    execute: async () => { started = true; await held; return 'finished' } } }).catch(error => error)
  await vi.waitFor(() => expect(started).toBe(true), { timeout: 10000 })
  const purge = module.lifecycle!.purge!({ characterId: 'alice' }).then(() => { purged = true })
  await module.background!.run({ ...input, characterId: 'bob' })
  let peerPurged = false
  const peer = module.lifecycle!.purge!({ characterId: 'bob' }).then(() => { peerPurged = true })
  try {
    await vi.waitFor(() => expect(peerPurged).toBe(true), { timeout: 2000 })
    expect(purged).toBe(false)
    expect(readdirSync(home, { recursive: true }).some(file => String(file).endsWith('.jsonl'))).toBe(true)
  } finally { release(); await Promise.all([purge, peer, running]) }
  expect(readdirSync(home, { recursive: true }).some(file => String(file).endsWith('.jsonl'))).toBe(false)
}, 30000)
it('runs the worker-safe background module with real SDK limits and cancels a timed out request', async () => {
  const home = mkdtempSync(join(tmpdir(), 'chouyu-dsh-background-'))
  const provider = await startMockProvider('openai', { tools: false, holdText: 'hold' })
  const module = createDshBackgroundModule({ home, node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') })
  cleanup.push(() => rmSync(home, { recursive: true, force: true }), () => provider.close(), () => module.lifecycle!.close!())
  const registry = new HarnessRegistry([module])
  const background = registry.background('dsh')
  let output = '', settled = 0
  const input = { characterId: 'alice', requestId: 'run:one', messages: [{ role: 'user' as const, content: 'work' }], systemPrompt: 'Persona',
    config: { ...DEFAULT_APP_CONFIG, provider: 'openai' as const, baseUrl: provider.baseUrl, apiKey: 'fixture', model: 'fixture' }, signal: new AbortController().signal,
    onChunk: (chunk: string) => { output += chunk }, options: { maxOutputTokens: 1024, beforeRound: () => 512, afterRound: () => { settled++ }, timeoutMs: 30000 } }
  await background.run(input)
  expect(output).toBe('DSH_OK')
  expect(settled).toBe(1)
  await expect(background.run({ ...input, messages: [{ role: 'user', content: 'hold' }], options: { ...input.options, timeoutMs: 500 } })).rejects.toThrow(/超时|timeout/i)
  expect(settled).toBe(2)
  expect(provider.requests).toHaveLength(2)
  await registry.get('dsh').lifecycle!.close!()
}, 60000)

it('preserves the original output-limit error and settles before returning to WorkLoop', async () => {
  const home = mkdtempSync(join(tmpdir(), 'chouyu-dsh-output-limit-'))
  const provider = await startMockProvider('openai', { tools: false })
  const module = createDshBackgroundModule({ home, node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') })
  cleanup.push(() => rmSync(home, { recursive: true, force: true }), () => provider.close(), () => module.lifecycle!.close!())
  const background = new HarnessRegistry([module]).background('dsh')
  const failure = new AgentOutputTruncatedError('saved partial')
  let settled = 0
  await expect(background.run({ characterId: 'alice', messages: [{ role: 'user', content: 'work' }], systemPrompt: 'Persona',
    config: { ...DEFAULT_APP_CONFIG, provider: 'openai', baseUrl: provider.baseUrl, apiKey: 'fixture', model: 'fixture' }, signal: new AbortController().signal,
    onChunk: () => { throw failure }, options: { maxOutputTokens: 512, afterRound: () => { settled++ }, timeoutMs: 30000 }
  })).rejects.toBe(failure)
  expect(settled).toBe(1)
  expect(provider.requests).toHaveLength(1)
}, 60000)
