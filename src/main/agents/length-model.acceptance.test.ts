import { expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { streamAIChat } from '../ai'
import { AgentStore } from './store'
import { enforceDeliveryLength } from './delivery-length'
import { parseDraft, type AgentModel } from './runtime'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { resolveCharacterConfig } from '../../shared/characters'
import type { AIResponseMetadata } from '../../shared/ai-usage'

// Paid opt-in: same synthetic oversized opening that failed the v7 run.
it.skipIf(!process.env.CHOUYU_LENGTH_ACCEPTANCE)('live repair satisfies the original per-period length without cutting the ending or advancing to another episode', async () => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG!), resolved = resolveCharacterConfig(data.characters[0], data.config)
  if (!resolved.ok) throw Error('验收模型不可用')
  const config = { ...DEFAULT_APP_CONFIG, ...data.config, ...resolved.config }
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-live-length-')), store = new AgentStore(join(directory, 'agents.db'))
  const body = readFileSync(new URL('./fixtures/oversized-opening.txt', import.meta.url), 'utf8')
  const records: { output: string; metadata: AIResponseMetadata }[] = []
  let runId = '', topicId = '', result: ReturnType<typeof parseDraft> | undefined
  try {
    store.save('writer', { ...DEFAULT_AGENT_SETTINGS, enabled: false, goal: '持续写作合成灯塔故事，每个日历期次交付一段300至500字正文并正式保存。主角沈青，地点雾港，灯塔每周四亮蓝灯。沿用已经保存的故事进展，不重复旧段，不结束整个重复任务。', dailyCalls: 2, dailyTokenLimit: 60000 })
    topicId = store.overview('writer').focusTopicId!
    const topic = store.topics.get('writer', topicId)
    store.setTaskBudget('writer', topicId, topic.revision, { modelCalls: 2, tokens: 60000, reason: '隔离篇幅修订验收固定额度' })
    runId = store.createRun('writer', '', Date.now(), topicId)
    const draft = parseDraft(JSON.stringify({ title: '蓝灯之夜·抵达', body: '首次交付：沈青抵达雾港，首见周四蓝灯亮起，建立故事起点与世界观，约480字。', question: '', memories: ['沈青的母亲三个月前去世，却有迟到的来信指引他周四前往灯塔。'],
      progress: { judgement: '沈青抵达雾港，见到海面异象。', reason: '首次开篇', nextStep: '继续写沈青探查灯塔', openQuestions: '', status: 'researching' },
      delivery: { completionCriteria: '持续写作，每期300至500字', stages: [{ id: 'story', title: '创作故事', status: 'active' }], summary: '沈青抵达雾港，看到蓝灯与海面轮廓。', section: { id: 'opening', title: '蓝灯之夜·抵达', body } } }))
    const model: AgentModel = async (prompt, signal) => {
      let output = '', metadata: AIResponseMetadata = { model: config.model }, reservation: string | undefined
      const callId = store.latestCallId(runId)!
      try {
        await streamAIChat([{ role: 'user', content: prompt }], 'Follow the work instruction and return JSON. Preserve established story facts.', config, chunk => { output += chunk }, signal, undefined, {
          timeoutMs: 90000, maxOutputTokens: 4000,
          beforeRound: (_round, input) => { const value = store.tokens.reserve(runId, callId, 'writer', topicId, input, 4000); if ('error' in value) throw Error(value.error); reservation = value.key; return value.maxOutputTokens },
          onMetadata: value => { metadata = value }
        })
        return output
      } finally { store.recordCallMetadata(callId, metadata); if (reservation) store.tokens.settle(reservation, metadata); records.push({ output, metadata }) }
    }
    result = await enforceDeliveryLength(store, runId, store.topics.get('writer', topicId), draft, model, AbortSignal.timeout(100000), () => store.assertLive(runId), parseDraft)
    const text = result.delivery!.section!.body
    const actual = (text.match(/[\p{L}\p{N}]/gu) || []).length
    expect(actual).toBeGreaterThanOrEqual(300); expect(actual).toBeLessThanOrEqual(500)
    expect(text).toContain('沈青'); expect(text).toContain('雾港'); expect(text).toContain('周四'); expect(text).toContain('蓝')
    expect(text).toMatch(/母亲|母/); expect(text).toContain('信'); expect(text).toMatch(/轮廓|异象|影/)
    expect(text).toMatch(/[。！？！”」]$/)
    expect(result.progress?.status).toBe('researching')
    expect(result.delivery?.section?.id).toBe('opening')
    expect(result.delivery?.section?.title).toBe('蓝灯之夜·抵达')
    expect(result.body).not.toMatch(/约\s*480\s*字/)
    store.finish(runId, { runId, title: result.title, body: result.body, nextStep: result.nextStep, evidence: [], createdAt: Date.now() }, result.memories, result.progress, result.delivery)
    expect(store.deliveries.get(topicId)?.sections[0].body).toBe(text)
    expect(store.callCount('writer')).toBe(1)
    expect(records).toHaveLength(1)
  } finally {
    mkdirSync('artifacts/contact-next', { recursive: true })
    writeFileSync('artifacts/contact-next/live-length.json', JSON.stringify({ model: config.model, candidate: body, result, delivery: topicId ? store.deliveries.get(topicId) : null, overview: store.overview('writer'), records }, null, 2))
    store.close(); rmSync(directory, { recursive: true, force: true })
  }
}, 120000)
