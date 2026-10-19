import { expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { streamNativeChat } from '../harness/native/runner'
import { ContactTaskStore } from '../task-center/contact-store'
import { parseDraft, type AgentModel } from '../workloop/workflow'
import { WritingRecovery } from './writing-recovery'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { resolveCharacterConfig } from '../../shared/characters'
import type { AIResponseMetadata } from '../../shared/ai-usage'

// Paid opt-in. Replays the synthetic v6 opening through the real metadata recovery
// and persistence path; prose is already complete, so no new story is requested.
it.skipIf(!process.env.CHOUYU_RECOVERY_ACCEPTANCE)('live recovery describes the unpublished opening without inventing the following chapter', async () => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG!), resolved = resolveCharacterConfig(data.characters[0], data.config)
  if (!resolved.ok) throw Error('验收模型不可用')
  const config = { ...DEFAULT_APP_CONFIG, ...data.config, ...resolved.config }
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-live-recovery-')), store = new ContactTaskStore(join(directory, 'agents.db'))
  const body = readFileSync(new URL('./fixtures/recovery-opening.txt', import.meta.url), 'utf8')
  const records: { output: string; metadata: AIResponseMetadata }[] = []
  let runId = '', topicId = '', result: ReturnType<typeof parseDraft> | undefined
  try {
    store.save('writer', { ...DEFAULT_AGENT_SETTINGS, enabled: false, goal: '持续创作雾港灯塔故事，主角沈青，灯塔每周四亮蓝灯。每轮交付一段300–500字正文，承接实际已保存内容，不重复旧段，不结束整个持续任务。', dailyCalls: 2, dailyTokenLimit: 60000 })
    topicId = store.overview('writer').focusTopicId!
    const topic = store.topics.get('writer', topicId)
    store.setTaskBudget('writer', topicId, topic.revision, { modelCalls: 2, tokens: 60000, reason: '隔离正文恢复验收固定额度' })
    runId = store.createRun('writer', '', Date.now(), topicId)
    const context = {
      soul: '独立小说作者，直接交付正文。', topic: store.topics.get('writer', topicId), memories: [],
      delivery: { version: 0, directory: [], sections: [], summary: '准备创作首段正文，尚无正式交付。', completionCriteria: '持续创作，每期交付一段正文；不以首段为任务终点。',
        stages: [{ id: 'write_episode', title: '撰写本期正文', status: 'pending' }, { id: 'save_delivery', title: '保存本期正文', status: 'pending' }] }
    }
    const recovery = new WritingRecovery(store, runId, context)
    recovery.retain('上次结构化输出无效；正文已通过独立步骤生成。')
    store.db.prepare("UPDATE writing_drafts SET value=json_set(value,'$.body',?,'$.complete',json('true')) WHERE topic_id=?").run(body, topicId)
    const model: AgentModel = async (prompt, signal, options) => {
      expect(options?.plainText).not.toBe(true)
      let output = '', metadata: AIResponseMetadata = { model: config.model }, reservation: string | undefined
      const callId = store.latestCallId(runId)!
      try {
        await streamNativeChat([{ role: 'user', content: prompt }], 'Follow the work instruction and return JSON. Distinguish facts, assumptions, and sources.', config, chunk => { output += chunk }, signal, undefined, {
          timeoutMs: 90000, maxOutputTokens: 4000,
          beforeRound: (_round, input) => { const value = store.tokens.reserve(runId, callId, 'writer', topicId, input, 4000); if ('error' in value) throw Error(value.error); reservation = value.key; return value.maxOutputTokens },
          onMetadata: value => { metadata = value }
        })
        return output
      } finally {
        store.recordCallMetadata(callId, metadata); if (reservation) store.tokens.settle(reservation, metadata)
        records.push({ output, metadata })
      }
    }
    result = parseDraft(await recovery.generate(model, AbortSignal.timeout(190000), context, parseDraft, () => {}))
    expect(result.delivery?.section?.body).toBe(body)
    expect(result.progress?.status).toBe('researching')
    expect(result.delivery?.section?.title).not.toMatch(/第二章|第2章|chapter\s*2/i)
    // Specific fabricated facts observed in v6: none occur in this first visit.
    const claimedFacts = JSON.stringify({ title: result.title, body: result.body, summary: result.delivery?.summary, judgement: result.progress?.judgement, reason: result.progress?.reason, memories: result.memories })
    expect(claimedFacts).not.toMatch(/17-A|指甲刻|半截铁门|进入灯塔内部|第二个周四|第二章续写/)
    expect(claimedFacts).toContain('沈青')
    expect(claimedFacts).toContain('蓝')
    store.finish(runId, { runId, title: result.title, body: result.body, nextStep: result.progress!.nextStep, evidence: [], createdAt: Date.now() }, result.memories, result.progress, result.delivery)
    expect(store.deliveries.get(topicId)?.sections).toHaveLength(1)
    expect(store.deliveries.get(topicId)?.sections[0].body).toBe(body)
    const savedMemories = store.memoryLibrary.list('writer')
    expect(savedMemories.map(memory => memory.content).sort()).toEqual([...result.memories].sort())
    expect(savedMemories.every(memory => memory.status === 'candidate' && memory.source.kind === 'research' && memory.source.runId === runId)).toBe(true)
    expect(store.callCount('writer')).toBe(records.length)
    expect(records.length).toBeLessThanOrEqual(2)
  } finally {
    mkdirSync('artifacts/contact-next', { recursive: true })
    writeFileSync('artifacts/contact-next/live-recovery.json', JSON.stringify({ model: config.model, candidate: body, result, delivery: topicId ? store.deliveries.get(topicId) : null, memories: store.memoryLibrary.list('writer'), overview: store.overview('writer'), records }, null, 2))
    store.close(); rmSync(directory, { recursive: true, force: true })
  }
}, 210000)
