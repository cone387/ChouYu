import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeUsage, closeUsage, getUsageStore } from './index'
import { streamNativeChat } from '../harness/native/runner'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { OpenAIEmbeddingClient } from '../memory/embedding-client'
import { extractMemoriesWithLLM } from '../memory/llm-extractor'
import { probeConversation } from '../provider-probe'

const config = { ...DEFAULT_APP_CONFIG, provider: 'openai' as const, baseUrl: 'https://fixture.invalid/v1', apiKey: 'secret', model: 'requested' }
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'chouyu-provider-usage-')); initializeUsage(dir) })
afterEach(() => { closeUsage(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals() })
const sse = (...events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
const stats = () => getUsageStore().statistics(7)

it('records ordinary OpenAI chat without a metadata callback and merges repeated cumulative usage', async () => {
  const request = vi.fn(async (_url: string, _options: RequestInit) => sse({ model: 'actual', usage: { total_tokens: 12 } }, { usage: { total_tokens: 20 } }, { usage: { total_tokens: 20 }, choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }))
  vi.stubGlobal('fetch', request)
  await streamNativeChat([{ role: 'user', content: 'hello' }], '', config, () => {})
  expect(JSON.parse(request.mock.calls[0][1].body as string).stream_options).toEqual({ include_usage: true })
  expect(stats()).toMatchObject({ calls: 1, reported: 1, tokens: 20, models: [{ model: 'actual', tokens: 20 }] })
})

it('keeps Claude cache/input/output counters from split events even if the consumer fails', async () => {
  vi.stubGlobal('fetch', async () => sse({ type: 'message_start', message: { model: 'actual', usage: { input_tokens: 8, output_tokens: 0, cache_read_input_tokens: 5 } } }, { type: 'message_delta', usage: { output_tokens: 3 } }, { type: 'content_block_delta', delta: { text: 'ok' } }))
  await expect(streamNativeChat([{ role: 'user', content: 'hello' }], '', { ...config, provider: 'claude' }, () => { throw new Error('consumer closed') })).rejects.toThrow()
  expect(stats()).toMatchObject({ calls: 1, reported: 1, tokens: 16 })
})

it('counts each provider request in a native tool loop once, independently of budget metadata callbacks', async () => {
  let round = 0
  vi.stubGlobal('fetch', async () => ++round === 1
    ? sse({ usage: { total_tokens: 10 }, choices: [{ delta: { tool_calls: [{ index: 0, id: 'one', function: { name: 'read', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] })
    : sse({ usage: { total_tokens: 15 }, choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }))
  await streamNativeChat([{ role: 'user', content: 'hello' }], '', config, () => {}, undefined,
    { definitions: [{ name: 'read', displayName: 'read', description: 'read', source: 'builtin', risk: 'read', requiresConfirmation: false, inputSchema: { type: 'object', properties: {} } }], execute: async () => 'result' }, { onMetadata() {}, beforeRound: () => 100 })
  expect(stats()).toMatchObject({ calls: 2, reported: 2, tokens: 25 })
})

it('records unreported HTTP failures and the usage from a compatibility retry', async () => {
  let round = 0
  vi.stubGlobal('fetch', async () => ++round === 1 ? new Response('stream_options unsupported', { status: 400 }) : sse({ usage: { total_tokens: 9 } }))
  await streamNativeChat([{ role: 'user', content: 'hello' }], '', config, () => {})
  expect(stats()).toMatchObject({ calls: 2, reported: 1, tokens: 9 })
})

it('retains tools when an endpoint rejects only usage reporting', async () => {
  const bodies: any[] = []
  vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string); bodies.push(body)
    if (body.stream_options) return new Response('stream_options unsupported', { status: 400 })
    return sse({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })
  })
  await streamNativeChat([{ role: 'user', content: 'hello' }], '', config, () => {}, undefined,
    { definitions: [{ name: 'read', displayName: 'read', description: 'read', source: 'builtin', risk: 'read', requiresConfirmation: false, inputSchema: { type: 'object', properties: {} } }], execute: async () => 'result' })
  expect(bodies).toHaveLength(2)
  expect(bodies[1].tools).toEqual(bodies[0].tools)
  expect(stats()).toMatchObject({ calls: 2, reported: 0, tokens: null })
})

it('records embedding and memory extraction even when returned content is invalid', async () => {
  await expect(new OpenAIEmbeddingClient(config, async () => Response.json({ usage: { total_tokens: 12 }, data: [] })).embed(['text'])).rejects.toThrow()
  await extractMemoriesWithLLM('I like tea', config, async () => Response.json({ model: 'memory', usage: { total_tokens: 23 }, choices: [] }))
  await extractMemoriesWithLLM('I like tea', { ...config, provider: 'claude' }, async () => Response.json({ model: 'claude-memory', usage: { input_tokens: 7, output_tokens: 2, cache_creation_input_tokens: 4 }, content: [] }))
  expect(stats()).toMatchObject({ calls: 3, reported: 3, tokens: 48 })
})

it('records real diagnostic conversation requests', async () => {
  await probeConversation(config, async () => sse({ usage: { total_tokens: 11 }, choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }))
  expect(stats()).toMatchObject({ calls: 1, reported: 1, tokens: 11 })
})
