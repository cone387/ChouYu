import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULT_APP_CONFIG } from '../../../shared/config'
import { prepareHarnessInput } from '../prepare'
import { DshRuntimePool } from './runtime'
import { startMockProvider } from './fixtures/mock-provider.mjs'
import type { BackgroundHarnessInput } from '../contracts'
import type { AIResponseMetadata } from '../../../shared/ai-usage'
import { initializeUsage, closeUsage, getUsageStore } from '../../usage'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function fixture(provider: 'openai' | 'claude', options = {}) {
  const home = mkdtempSync(join(tmpdir(), 'chouyu-dsh-budget-'))
  const mock = await startMockProvider(provider, options)
  const pool = new DshRuntimePool({ home, node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') })
  cleanup.push(() => rmSync(home, { recursive: true, force: true }), () => mock.close(), () => pool.close())
  const controller = new AbortController()
  const tools = { definitions: [{ name: 'chouyu_fixture', displayName: 'Fixture', description: 'test tool', source: 'builtin' as const, risk: 'read' as const, requiresConfirmation: false, inputSchema: { type: 'object' as const, properties: { value: { type: 'string' as const } } } }], execute: async () => 'fixture-result' }
  const input = await prepareHarnessInput({ requestId: 'budget-test', characterId: 'alice', systemPrompt: 'Alice persona', messages: [{ role: 'user', content: 'current input' }] },
    { config: { ...DEFAULT_APP_CONFIG, provider, baseUrl: mock.baseUrl, apiKey: 'fixture', model: 'fixture' }, signal: controller.signal, tools,
      assertContext: async () => {}, citationContext: async () => '', privateContext: '', skillContext: '', communication: '' })
  return { mock, pool, input, controller, home }
}

it.each([['openai', false], ['openai', true], ['claude', false], ['claude', true]] as const)('persists every actual DSH %s tool round once with budget mode %s', async (provider, budgeted) => {
  const { mock, pool, input, home } = await fixture(provider)
  initializeUsage(home); cleanup.push(closeUsage)
  if (budgeted) Object.assign(input, { rounds: { maxOutputTokens: 1024, beforeRound: () => 700, onMetadata() {}, afterRound() {} } })
  const lease = await pool.acquire(input)
  await lease.run(input, () => {})
  await lease.release()
  expect(mock.requests).toHaveLength(2)
  expect(getUsageStore().statistics(7)).toMatchObject({ calls: 2, reported: 2, tokens: 36 })
}, 60000)

it('records a DSH request whose provider does not report token usage as unknown', async () => {
  const { pool, input, home } = await fixture('openai', { tools: false, omitUsage: true })
  initializeUsage(home); cleanup.push(closeUsage)
  const lease = await pool.acquire(input)
  await lease.run(input, () => {})
  await lease.release()
  expect(getUsageStore().statistics(7)).toMatchObject({ calls: 1, reported: 0, tokens: null })
}, 60000)

for (const provider of ['openai', 'claude'] as const) it(`reserves and settles each actual SDK ${provider} request with the lower logged output cap`, async () => {
  const { mock, pool, input, home } = await fixture(provider)
  const prepared: string[] = [], metadata: AIResponseMetadata[] = [], settled: number[] = []
  const rounds: BackgroundHarnessInput['options'] = { maxOutputTokens: 1024,
    beforeRound: (round, serialized) => { expect(mock.requests).toHaveLength(round); prepared.push(serialized); return round ? 600 : 700 },
    onMetadata: value => metadata.push(value), afterRound: () => { settled.push(mock.requests.length) } }
  input.tools!.execute = async () => { expect(settled).toEqual([1]); return 'fixture-result' }
  Object.assign(input, { rounds })
  const lease = await pool.acquire(input)
  const result = await lease.run(input, () => {})
  await lease.release()
  expect(result).toMatchObject({ state: 'completed', text: 'DSH_OK' })
  expect(mock.requests).toHaveLength(2)
  expect(mock.requests.map(request => request.body.max_tokens ?? request.body.max_completion_tokens)).toEqual([700, 600])
  expect(prepared).toHaveLength(2)
  expect(prepared[0]).toContain('current input')
  expect(prepared[1]).toContain('fixture-result')
  expect(settled).toEqual([1, 2])
  expect(metadata).toHaveLength(2)
  expect(metadata[0]).toMatchObject({ finishReason: 'tool_calls', usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } })
  expect(metadata[1]).toMatchObject({ finishReason: 'stop', usage: { totalTokens: 18 } })
  const logs = readdirSync(home, { recursive: true }).filter(file => String(file).endsWith('.jsonl'))
  const events = logs.flatMap(file => readFileSync(join(home, String(file)), 'utf8').trim().split('\n').map(line => JSON.parse(line)))
  const caps = events.filter(event => event.type === 'request/header').map(event => event.data.header.config.maxTokens)
  expect(caps).toContain(700)
  expect(caps.at(-1)).toBe(600)
}, 60000)

it('preserves provider failure classification for the existing WorkLoop recovery policy', async () => {
  const { mock, pool, input } = await fixture('openai', { failure: { status: 402, message: 'Insufficient balance for this request' } })
  const metadata: AIResponseMetadata[] = []
  let settled = 0
  Object.assign(input, { rounds: { maxOutputTokens: 1024, beforeRound: () => 512, onMetadata: (value: AIResponseMetadata) => metadata.push(value), afterRound: () => { settled++ } } })
  const lease = await pool.acquire(input)
  await expect(lease.run(input, () => {})).rejects.toThrow(/balance/i)
  expect(mock.requests).toHaveLength(1)
  expect(settled).toBe(1)
  expect(metadata[0].usage).toBeUndefined()
  await lease.release()
}, 60000)

it('returns truncated text with its terminal metadata so WorkLoop can retain a partial draft', async () => {
  const { pool, input } = await fixture('openai', { tools: false, truncated: true })
  const metadata: AIResponseMetadata[] = []
  Object.assign(input, { rounds: { maxOutputTokens: 1024, beforeRound: () => 512, onMetadata: (value: AIResponseMetadata) => metadata.push(value) } })
  const lease = await pool.acquire(input)
  expect(await lease.run(input, () => {})).toMatchObject({ state: 'completed', text: 'DSH_OK' })
  expect(metadata.at(-1)?.finishReason).toBe('length')
  await lease.release()
}, 60000)

it('leaves missing usage unknown after a completed provider response', async () => {
  const { pool, input } = await fixture('openai', { tools: false, omitUsage: true })
  const metadata: AIResponseMetadata[] = []
  Object.assign(input, { rounds: { maxOutputTokens: 1024, beforeRound: () => 512, onMetadata: (value: AIResponseMetadata) => metadata.push(value) } })
  const lease = await pool.acquire(input)
  expect(await lease.run(input, () => {})).toMatchObject({ state: 'completed' })
  expect(metadata).toHaveLength(1)
  expect(metadata[0]).toMatchObject({ finishReason: 'stop' })
  expect(metadata[0].usage).toBeUndefined()
  await lease.release()
}, 60000)

it('bounds continuous SDK tool calls to six actual provider requests', async () => {
  const { pool, input, mock } = await fixture('openai', { tools: 'always' })
  let settled = 0
  Object.assign(input, { rounds: { maxOutputTokens: 1024, beforeRound: () => 512, afterRound: () => { settled++ } } })
  const lease = await pool.acquire(input)
  await expect(lease.run(input, () => {})).rejects.toThrow(/安全上限/)
  expect(mock.requests).toHaveLength(6)
  expect(settled).toBe(6)
  await lease.release()
}, 60000)

it('denies the next tool round before sending HTTP and preserves the host budget failure', async () => {
  const { mock, pool, input } = await fixture('openai')
  let settled = 0
  Object.assign(input, { rounds: { maxOutputTokens: 1024, beforeRound: (round: number) => { if (round) throw new Error('任务额度不足'); return 512 }, afterRound: () => { settled++ } } })
  const lease = await pool.acquire(input)
  await expect(lease.run(input, () => {})).rejects.toThrow('任务额度不足')
  expect(mock.requests).toHaveLength(1)
  expect(settled).toBe(1)
  await lease.release()
}, 60000)

it('settles an aborted provider attempt as unknown and drains it before returning', async () => {
  const { mock, pool, input, controller } = await fixture('openai', { holdText: 'current input', tools: false })
  const metadata: AIResponseMetadata[] = []
  let settled = 0
  Object.assign(input, { rounds: { maxOutputTokens: 1024, beforeRound: () => 512, onMetadata: (value: AIResponseMetadata) => metadata.push(value), afterRound: () => { settled++ } } })
  const lease = await pool.acquire(input), running = lease.run(input, () => {})
  await vi.waitFor(() => expect(mock.requests).toHaveLength(1), { timeout: 30000 })
  controller.abort()
  expect(await running).toMatchObject({ state: 'cancelled' })
  expect(settled).toBe(1)
  expect(metadata).toHaveLength(1)
  expect(metadata[0].finishReason).toBeUndefined()
  expect(metadata[0].usage).toBeUndefined()
  await lease.release()
}, 60000)
