import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createBackgroundHarnesses } from './background'
import { startMockProvider } from './dsh/fixtures/mock-provider.mjs'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { assertTaskEnding, type TaskEnding } from '../../shared/task-ending'

for (const engine of ['native', 'dsh'] as const) for (const reject of [false, true])
  it(`${engine} awaits asynchronous settlement before tools or another round (reject=${reject})`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'chouyu-settlement-protocol-')), mock = await startMockProvider('openai')
    const registry = createBackgroundHarnesses({ home, node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') })
    let release!: () => void, entered = false, tools = 0, settled = false
    const gate = new Promise<void>(resolve => { release = resolve })
    const outcome = registry.background(engine).run({ characterId: 'fixture', requestId: `${engine}-settle`, messages: [{ role: 'user', content: 'current input' }], systemPrompt: 'Fixture',
      config: { ...DEFAULT_APP_CONFIG, provider: 'openai', baseUrl: mock.baseUrl, apiKey: 'fixture', model: 'fixture' }, signal: AbortSignal.timeout(30000), onChunk: () => {},
      options: { maxOutputTokens: 512, afterRound: async () => { entered = true; await gate; if (reject) throw new Error('settlement rejected'); settled = true } },
      tools: { definitions: [{ name: 'chouyu_fixture', displayName: 'Fixture', description: 'fixture', source: 'builtin', risk: 'read', requiresConfirmation: false, inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }],
        execute: async () => { expect(settled).toBe(true); tools++; return 'fixture-result' } }
    }).then(() => undefined, error => error)
    try {
      await vi.waitFor(() => expect(entered).toBe(true), { timeout: 20000 })
      expect(tools).toBe(0); expect(mock.requests).toHaveLength(1)
      release()
      const error = await outcome
      if (reject) { expect(error?.message).toContain('settlement rejected'); expect(tools).toBe(0); expect(mock.requests).toHaveLength(1) }
      else { expect(error).toBeUndefined(); expect(tools).toBe(1) }
    } finally { release(); await outcome; await registry.get('dsh').lifecycle?.close?.(); await mock.close(); rmSync(home, { recursive: true, force: true }) }
  }, 40000)

for (const engine of ['native', 'dsh'] as const) for (const provider of ['openai', 'claude'] as const)
  for (const boundary of ['tool', 'next-round'] as const) it(`${engine}/${provider} stops at deadline before ${boundary} with one actual HTTP attempt`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'chouyu-ending-protocol-')), mock = await startMockProvider(provider)
    const registry = createBackgroundHarnesses({ home, node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') })
    const harness = registry.background(engine)
    let now = 1, tools = 0, rounds = 0
    const ending: TaskEnding = { version: 1, acceptedAt: 1, timeZone: 'UTC', deadline: { at: 2, source: 'fixture', acceptedAt: 1, timeZone: 'UTC' }, occurrences: {} }
    try {
      await expect(harness.run({ characterId: 'fixture', requestId: `${engine}-${provider}-${boundary}`, messages: [{ role: 'user', content: 'current input' }], systemPrompt: 'Fixture',
        config: { ...DEFAULT_APP_CONFIG, provider, baseUrl: mock.baseUrl, apiKey: 'fixture', model: 'fixture' }, signal: AbortSignal.timeout(30000), onChunk: () => {},
        options: { maxOutputTokens: 512, beforeRound: () => { assertTaskEnding(ending, now); rounds++; return 512 }, afterRound: () => { if (boundary === 'tool') now = 2 } },
        tools: { definitions: [{ name: 'chouyu_fixture', displayName: 'Fixture', description: 'fixture', source: 'builtin', risk: 'read', requiresConfirmation: false, inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }],
          execute: async () => { assertTaskEnding(ending, now); tools++; now = 2; return 'fixture-result' } }
      })).rejects.toThrow(/截止/)
      expect(mock.requests).toHaveLength(1)
      expect(rounds).toBe(1)
      expect(tools).toBe(boundary === 'tool' ? 0 : 1)
    } finally { await registry.get('dsh').lifecycle?.close?.(); await mock.close(); rmSync(home, { recursive: true, force: true }) }
  }, 40000)
