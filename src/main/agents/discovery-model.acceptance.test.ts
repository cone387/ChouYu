import { expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveCharacterConfig } from '../../shared/characters'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { AgentService } from './service'

// Paid opt-in: real service and native tool definitions, synthetic data, no user contacts.
it.skipIf(!process.env.CHOUYU_DISCOVERY_ACCEPTANCE)('real reviewer finds published prose despite an empty uploaded-material directory', async () => {
  const data = JSON.parse(process.env.CHOUYU_ACCEPTANCE_CONFIG!)
  const resolved = resolveCharacterConfig(data.characters[0], data.config)
  if (!resolved.ok) throw Error('联系人模型配置不可用')
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-live-discovery-'))
  const service = new AgentService(directory, () => {})
  let runId = ''
  try {
    service.store.save('writer', { ...DEFAULT_AGENT_SETTINGS, goal: '持续写作灯塔故事', enabled: false, shareDeliveries: true })
    service.store.save('reviewer', { ...DEFAULT_AGENT_SETTINGS, goal: '持续独立评审验收作者的灯塔故事。先读取作者最新保存的正式正文，再给结论、引用依据和一项具体建议，保存评审正文。没有新正文才等待。不引用自己的旧评审冒充原文，不替作者改写，不询问用户。', enabled: false, dailyCalls: 12, dailyTokenLimit: 100000, readContactDeliveries: true, searchEnabled: false })
    const body = '沈青推开雾港灯塔的铁门，门轴一声未响。今天是周四，塔顶按惯例亮着蓝灯。可楼梯尽头的铜铃正朝着海风吹来的方向摆动。\n\n他停下脚步，握紧工具包。退休钟表匠陈伯从阴影里走出来，把一封密封的信递给他：“先看灯，再看信。”沈青抬头，蓝光在墙面缓缓移动，铜铃却始终没有声音。'
    const writerTopic = service.store.overview('writer').focusTopicId!, published = service.store.createRun('writer', '')
    service.store.finish(published, { runId: published, title: '蓝灯与铜铃', body, nextStep: '继续', evidence: [], createdAt: Date.now() }, [],
      { status: 'researching', judgement: '首段已保存', reason: '实际交付', openQuestions: '', nextStep: '继续' },
      { completionCriteria: '持续写作', summary: '雾港灯塔开篇', stages: [{ id: 'story', title: '故事', status: 'active' }], section: { id: 'opening', title: '蓝灯与铜铃', body } })
    const topic = service.store.topics.get('reviewer', service.store.overview('reviewer').focusTopicId!)
    service.store.setTaskBudget('reviewer', topic.id, topic.revision, { modelCalls: 12, tokens: 100000, reason: '隔离评审发现验收的固定额度' })
    expect(service.store.materials.list({ characterId: 'reviewer', query: '' })).toEqual([])
    await service.sync([
      { id: 'writer', name: '验收作者', soul: '独立作者。', conversation: '', config: null },
      { id: 'reviewer', name: '验收评审', soul: '你是独立评审者，按实际原文给出结论和依据。', conversation: '', config: { ...resolved.config, thinkingDisabledModels: data.config.thinkingDisabledModels }, skillToolsEnabled: true }
    ])
    await service.request('run', 'reviewer', [topic.id])
    runId = service.store.overview('reviewer').runs[0].id
    await vi.waitFor(() => expect(['completed', 'failed', 'waiting', 'cancelled']).toContain(service.store.getRun(runId)?.status), { timeout: 195000, interval: 500 })
    const detail = service.store.detail('reviewer', runId)
    expect(detail.run.status, detail.run.error).toBe('completed')
    expect(detail.report?.evidence.some(item => item.url.startsWith(`contact-delivery://writer/${writerTopic}/opening?version=1`) && item.text === body)).toBe(true)
    expect(service.store.deliveries.get(topic.id)?.sections.at(-1)?.body.length).toBeGreaterThan(50)
    expect(service.store.deliveries.get(writerTopic)?.sections[0].body).toBe(body)
  } finally {
    mkdirSync('artifacts/contact-next', { recursive: true })
    writeFileSync('artifacts/contact-next/live-discovery.json', JSON.stringify({ model: resolved.config.model, detail: runId ? service.store.detail('reviewer', runId) : null, overview: service.store.overview('reviewer') }, null, 2))
    await service.close(); rmSync(directory, { recursive: true, force: true })
  }
}, 215000)
