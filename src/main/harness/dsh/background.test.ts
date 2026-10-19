import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULT_APP_CONFIG } from '../../../shared/config'
import { DshRuntimePool } from './runtime'
import { createDshBackgroundModule } from './background'
import { HarnessRegistry } from '../registry'
import { startMockProvider } from './fixtures/mock-provider.mjs'
import { AgentOutputTruncatedError } from '../../agents/model-output'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
it('runs the worker-safe background module with real SDK limits and cancels a timed out request', async () => {
  const home = mkdtempSync(join(tmpdir(), 'chouyu-dsh-background-'))
  const provider = await startMockProvider('openai', { tools: false, holdText: 'hold' })
  const pool = new DshRuntimePool({ home, node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') })
  cleanup.push(() => rmSync(home, { recursive: true, force: true }), () => provider.close(), () => pool.close())
  const registry = new HarnessRegistry([createDshBackgroundModule(pool)])
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
  const pool = new DshRuntimePool({ home, node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') })
  cleanup.push(() => rmSync(home, { recursive: true, force: true }), () => provider.close(), () => pool.close())
  const background = new HarnessRegistry([createDshBackgroundModule(pool)]).background('dsh')
  const failure = new AgentOutputTruncatedError('saved partial')
  let settled = 0
  await expect(background.run({ characterId: 'alice', messages: [{ role: 'user', content: 'work' }], systemPrompt: 'Persona',
    config: { ...DEFAULT_APP_CONFIG, provider: 'openai', baseUrl: provider.baseUrl, apiKey: 'fixture', model: 'fixture' }, signal: new AbortController().signal,
    onChunk: () => { throw failure }, options: { maxOutputTokens: 512, afterRound: () => { settled++ }, timeoutMs: 30000 }
  })).rejects.toBe(failure)
  expect(settled).toBe(1)
  expect(provider.requests).toHaveLength(1)
}, 60000)
