import { expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { streamNativeChat } from '../harness/native/runner'
import { AgentStore } from './store'
import { ContactSources } from './contact-sources'
import { correctDeliveryCounts } from './delivery-counts'
import { parseDraft, type AgentModel } from './runtime'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { resolveCharacterConfig } from '../../shared/characters'
import type { AIResponseMetadata } from '../../shared/ai-usage'

it.skipIf(!process.env.CHOUYU_COUNTS_ACCEPTANCE)('live metadata corrections use actual author and source counts, leaving both saved texts unchanged', async () => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG!), resolved = resolveCharacterConfig(data.characters[0], data.config)
  if (!resolved.ok) throw Error('验收模型不可用')
  const config = { ...DEFAULT_APP_CONFIG, ...data.config, ...resolved.config }
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-live-counts-')), store = new AgentStore(join(directory, 'agents.db'))
  const authorBody = readFileSync(new URL('./fixtures/oversized-opening.txt', import.meta.url), 'utf8')
  const review = JSON.parse(readFileSync(new URL('./fixtures/reviewer-count.json', import.meta.url), 'utf8')) as { body: string; summary: string }
  const records: { owner: string; output: string; metadata: AIResponseMetadata }[] = []
  const results: { owner: string; run: string; topic: string; result: ReturnType<typeof parseDraft> }[] = []
  try {
    for (const owner of ['writer', 'reviewer']) {
      store.save(owner, { ...DEFAULT_AGENT_SETTINGS, enabled: false, goal: owner === 'writer' ? '持续创作雾港灯塔故事' : '持续独立评审作者正文', dailyCalls: 2, dailyTokenLimit: 60000, shareDeliveries: owner === 'writer', readContactDeliveries: owner === 'reviewer' })
      const topicId = store.overview(owner).focusTopicId!, topic = store.topics.get(owner, topicId)
      store.setTaskBudget(owner, topicId, topic.revision, { modelCalls: 2, tokens: 60000, reason: '隔离字数说明验收固定额度' })
      const runId = store.createRun(owner, '', Date.now(), topicId)
      const writer = results[0]
      const evidence = owner === 'reviewer' ? new ContactSources(store).read(owner, topicId, [{ characterId: 'writer', topicId: writer.topic, sectionId: 'opening', version: 1 }]) : []
      const body = owner === 'writer' ? authorBody : review.body
      const draft = parseDraft(JSON.stringify({ title: owner === 'writer' ? '蓝灯之夜·抵达' : '蓝灯之夜开篇评审', body: owner === 'writer' ? '首次交付：沈青抵达雾港，首见周四蓝灯亮起，建立故事起点与世界观，约480字。' : '已评审作者开篇。', question: '', memories: [],
        progress: { judgement: '本轮已有实际正文。', reason: '本轮推进', nextStep: '继续原任务', openQuestions: '', status: 'researching' },
        delivery: { completionCriteria: '持续推进原任务', stages: [{ id: 'ongoing', title: '持续推进', status: 'active' }], summary: owner === 'writer' ? '沈青抵达雾港，看到蓝灯与海面轮廓。' : review.summary, section: { id: 'opening', title: owner === 'writer' ? '蓝灯之夜·抵达' : '开篇评审', body } } }))
      const model: AgentModel = async (prompt, signal) => {
        let output = '', metadata: AIResponseMetadata = { model: config.model }, reservation: string | undefined
        const callId = store.latestCallId(runId)!
        try {
          await streamNativeChat([{ role: 'user', content: prompt }], 'Follow the work instruction and return JSON. Do not invent counts or facts.', config, chunk => { output += chunk }, signal, undefined, {
            timeoutMs: 90000, maxOutputTokens: 2500,
            beforeRound: (_round, input) => { const value = store.tokens.reserve(runId, callId, owner, topicId, input, 2500); if ('error' in value) throw Error(value.error); reservation = value.key; return value.maxOutputTokens }, onMetadata: value => { metadata = value }
          })
          return output
        } finally { store.recordCallMetadata(callId, metadata); if (reservation) store.tokens.settle(reservation, metadata); records.push({ owner, output, metadata }) }
      }
      const result = await correctDeliveryCounts(store, runId, store.topics.get(owner, topicId), draft, evidence, model, AbortSignal.timeout(100000), () => store.assertLive(runId), parseDraft)
      results.push({ owner, run: runId, topic: topicId, result })
      expect(result.delivery!.section!.body).toBe(body)
      expect(result.progress).toEqual(draft.progress)
      expect(result.delivery!.stages).toEqual(draft.delivery!.stages)
      expect(result.delivery!.summary).not.toContain('900字')
      expect(result.body).not.toContain('480字')
      store.finish(runId, { runId, title: result.title, body: result.body, nextStep: result.nextStep, evidence, createdAt: Date.now() }, result.memories, result.progress, result.delivery)
      expect(store.deliveries.get(topicId)?.sections[0].body).toBe(body)
      expect(store.callCount(owner)).toBe(1)
      if (owner === 'reviewer') expect(evidence[0].text).toBe(authorBody)
    }
  } finally {
    mkdirSync('artifacts/contact-next', { recursive: true })
    writeFileSync('artifacts/contact-next/live-counts.json', JSON.stringify({ model: config.model, results, records, writer: store.overview('writer'), reviewer: store.overview('reviewer') }, null, 2))
    store.close(); rmSync(directory, { recursive: true, force: true })
  }
}, 210000)
