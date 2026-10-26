import { expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { requestContactTask } from './gateway'
import { AssistantRoutineService } from './service'
import { ContactTaskDraftStore } from './drafts'
import { ContactTaskStore } from '../task-center/contact-store'
import { createBackgroundHarnesses } from '../harness/background'
import { reliabilityReport } from '../harness/reliability-report'
import { resolveCharacterConfig } from '../../shared/characters'
import type { AIResponseMetadata } from '../../shared/ai-usage'
import type { TaskEndingRequest } from '../../shared/task-ending'

const scenarios = [
  ['ongoing', '24h持续工作，研究灯塔建筑，允许后台持续整理想法。'],
  ['deadline', '每天下午三点写一段灯塔故事，只工作24小时后结束。'],
  ['delivered-count', '每天下午三点写一段灯塔故事，成功发送到聊天3次后停止。'],
  ['ambiguous-count', '每天下午三点写一段灯塔故事，总共执行3次。']
] as const
for (const engine of ['native', 'dsh'] as const) it.skipIf(!process.env.CHOUYU_RELIABILITY_ACCEPTANCE).each(scenarios.filter(([scenario]) => !process.env.CHOUYU_RELIABILITY_CASE || scenario === process.env.CHOUYU_RELIABILITY_CASE))(`${engine} live reliability %s persists semantics`, async (scenario, message) => {
  const started = Date.now(), sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim()
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG!), resolved = resolveCharacterConfig(data.characters[0], data.config)
  if (!resolved.ok || !resolved.config.apiKey) throw new Error('Configured provider unavailable')
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-reliability-live-')), file = join(directory, 'agents.db')
  let store = new ContactTaskStore(file), calls = 0, attempts = 0, passed = false
  let draftValue = ''
  const metadata: AIResponseMetadata[] = []
  const registry = createBackgroundHarnesses({ home: join(directory, 'dsh'), node: process.execPath, helper: resolve('runtime/dsh/helper.mjs') })
  const service = new AssistantRoutineService({ read: () => undefined, write: () => {}, readHistory: () => undefined, writeHistory: () => {}, generate: async () => { throw new Error('No execution during interpretation') }, deliver: () => {} })
  const drafts = new ContactTaskDraftStore({ read: () => draftValue, write: value => { draftValue = value } })
  try {
    const result = await requestContactTask({ kind: 'create', characterId: 'fixture' }, message, {
      routineService: service, drafts, defaultCharacterId: 'chouyu', config: () => ({ proactiveReturnAwayMinutes: 10, proactiveRestMinutes: 60, proactiveCooldownMinutes: 60 }), saveConfig: () => { throw new Error('Unexpected config mutation') },
      agents: async (owner, method, args) => {
        if (method === 'get') return store.overview(owner)
        if (method === 'assignCalendarTopic') return store.assignCalendarTopic(owner, args[0], '', args[1] as string)
        if (method === 'assignTopic') return store.assignTopic(owner, args[0], '', args[1] as string, args[2] as number | undefined, args[3] as TaskEndingRequest | undefined)
        throw new Error('Unexpected mutation')
      }
    }, async (instruction, content) => {
      if (++attempts > 2) throw new Error('Bounded semantic attempts exhausted')
      let answer = ''
      await registry.background(engine).run({ characterId: 'fixture', requestId: `${engine}-${scenario}-${attempts}`, messages: [{ role: 'user', content }], systemPrompt: instruction,
        config: { ...data.config, ...resolved.config }, signal: AbortSignal.timeout(45000), onChunk: chunk => { answer += chunk },
        options: { timeoutMs: 45000, maxOutputTokens: 1800, beforeRound: () => { if (++calls > 2) throw new Error('Call cap'); return 1800 }, onMetadata: item => { metadata[calls - 1] = { ...metadata[calls - 1], ...item } } } })
      if (process.env.CHOUYU_RELIABILITY_TRACE) {
        try { const value = JSON.parse(answer); console.log('RELIABILITY_SCHEMA', { engine, scenario, kind: value.kind, keys: Object.keys(value), inputKeys: Object.keys(value.input ?? {}), endingKeys: Object.keys(value.ending ?? {}), inputKind: value.input?.kind }) } catch { console.log('RELIABILITY_SCHEMA invalid-json') }
      }
      return answer
    })
    store.close(); store = new ContactTaskStore(file)
    const topics = store.overview('fixture').topics
    if (scenario === 'ambiguous-count') { expect(result.kind).toBe('question'); expect(topics).toHaveLength(0) }
    else {
      expect(result.kind).toBe('work-created'); expect(topics).toHaveLength(1)
      const ending = topics[0].ending
      if (scenario === 'ongoing') expect(ending?.deadline).toBeUndefined()
      if (scenario === 'deadline') { expect(ending?.deadline?.at).toBe(ending!.acceptedAt + 86400000); expect(topics[0].calendar?.cadence).toBe('daily') }
      if (scenario === 'delivered-count') expect(ending?.count).toMatchObject({ mode: 'delivered', target: 3 })
    }
    passed = true
  } finally {
    mkdirSync('artifacts/contact-reliability', { recursive: true })
    writeFileSync(`artifacts/contact-reliability/live-${engine}-${scenario}.json`, JSON.stringify(reliabilityReport({ sourceCommit, model: resolved.config.model, engine, scenario, passed, attempts, calls, metadata, elapsedMs: Date.now() - started }), null, 2))
    await registry.get('dsh').lifecycle?.close?.(); store.close(); rmSync(directory, { recursive: true, force: true })
  }
}, 95000)
