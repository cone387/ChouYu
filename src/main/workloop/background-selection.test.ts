import { expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WorkLoopHost } from '../agent-space/workloop-host'
import { DshRuntimePool } from '../harness/dsh/runtime'
import { createDshBackgroundModule } from '../harness/dsh/background'
import { createNativeModule } from '../harness/native'
import { HarnessRegistry } from '../harness/registry'
import { startMockProvider } from '../harness/dsh/fixtures/mock-provider.mjs'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { evidenceFromText } from '../agents/sources'

it('executes selected DSH through real WorkLoop accounting and switches only the next round to native', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-background-choice-'))
  const report = JSON.stringify({ title: 'Saved', body: 'Evidence [1].', nextStep: 'Continue', memories: [], question: '', progress: { judgement: 'Saved', openQuestions: '', nextStep: 'Continue', reason: 'Evidence [1].', status: 'researching' } })
  const provider = await startMockProvider('openai', { tools: false, text: report })
  const home = join(dir, 'dsh'), pool = new DshRuntimePool({ home, node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') })
  const dsh = createDshBackgroundModule(pool), native = createNativeModule(), engines: string[] = []
  for (const module of [dsh, native]) {
    const run = module.background!.run.bind(module.background)
    module.background!.run = input => { engines.push(module.id); return run(input) }
  }
  const host = new WorkLoopHost(join(dir, 'contacts'), () => {}, undefined,
    async () => evidenceFromText('https://example.com/', 'Evidence. '.repeat(100)), undefined, undefined, undefined,
    { harnesses: new HarnessRegistry([native, dsh]) })
  const identity = { id: 'alice', soul: 'Alice', conversation: '', backgroundHarnessEngine: 'dsh' as const,
    config: { provider: 'openai' as const, baseUrl: provider.baseUrl, apiKey: 'fixture', model: 'fixture', thinkingDisabledModels: [] } }
  try {
    await host.sync([identity])
    await host.request('save', identity.id, [{ ...DEFAULT_AGENT_SETTINGS, goal: 'Research', sources: ['https://example.com/'], permissionLevel: 'sources', dailyCalls: 100, dailyTokenLimit: 100000 }])
    await host.request('run', identity.id)
    await vi.waitFor(() => expect(engines).toEqual(['dsh']), { timeout: 10000 })
    host.syncContact({ ...identity, backgroundHarnessEngine: 'native' })
    await vi.waitFor(() => expect(host.store.overview(identity.id).reports).toHaveLength(1), { timeout: 30000 })
    const first = host.store.overview(identity.id).runs[0]
    expect(JSON.parse(host.store.getRun(first.id)!.input).backgroundHarnessEngine).toBe('dsh')
    expect(host.store.tokens.usage(identity.id)).toMatchObject({ today: 18, estimated: 0 })
    expect(readdirSync(home, { recursive: true }).some(file => String(file).endsWith('.jsonl'))).toBe(true)
    await host.request('run', identity.id)
    await vi.waitFor(() => expect(host.store.overview(identity.id).reports).toHaveLength(2), { timeout: 30000 })
    expect(engines).toEqual(['dsh', 'native'])
    expect(provider.requests).toHaveLength(2)
    const second = host.store.overview(identity.id).runs[0]
    expect(JSON.parse(host.store.getRun(second.id)!.input).backgroundHarnessEngine).toBe('native')
    expect(host.store.tokens.usage(identity.id)).toMatchObject({ today: 36, estimated: 0 })
  } finally { await host.close(); await pool.close(); await provider.close(); rmSync(dir, { recursive: true, force: true }) }
}, 60000)
