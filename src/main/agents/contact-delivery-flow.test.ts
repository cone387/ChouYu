import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentService } from './service'
import { createContactTools } from './tools'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import type { ToolExecutionContext } from '../tools/registry'

it('carries a chat style request through real service, runtime, versioned delivery and truthful inspection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-contact-flow-'))
  const model = vi.fn(async () => JSON.stringify({ presentation: { title: '随系统阅读', html: '<div id="content"></div>', css: '.body{line-height:2}', script: '' } }))
  const service = new AgentService(directory, () => {}, () => model)
  try {
    await service.sync([{ id: 'writer', soul: '阿笔', conversation: '旧聊天声称十章已经写完。', config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }])
    service.store.save('writer', { ...DEFAULT_AGENT_SETTINGS, goal: '写十章小说', sources: [], dailyCalls: 20 })
    const topicId = service.store.overview('writer').focusTopicId!, first = service.store.createRun('writer', '')
    service.store.finish(first, { runId: first, title: '第一章', body: '正文已保存', nextStep: '继续第二章', evidence: [], createdAt: Date.now() }, [],
      { judgement: '仅一章', nextStep: '继续第二章', reason: '实际成果', openQuestions: '', status: 'researching' },
      { completionCriteria: '完成十章', summary: '第一章', stages: [{ id: 'draft', title: '写作', status: 'active' }], section: { id: 'ch01', title: '第一章', body: '原始小说正文。\n\n第二段。' } })
    const tools = createContactTools({ owner: () => 'writer', request: (method, id, args) => service.request(method, id, args) })
    const context = { sessionId: 'chat' } as ToolExecutionContext
    const inspect = tools.find(t => t.name === 'get_contact_delivery')!
    const before = JSON.parse((await inspect.execute({ topicId }, context)).content)
    expect(before.savedSectionCount).toBe(1)
    const topic = service.store.topics.get('writer', topicId), artifact = service.store.deliveries.get(topicId)!
    const prepare = await tools.find(t => t.name === 'revise_contact_presentation')!.prepareAsync!({ topicId, revision: topic.revision, deliveryVersion: before.version, reason: '按系统亮色主题展示，保持原文' }, context)
    const accepted = JSON.parse((await prepare.execute()).content)
    expect(accepted.requestAccepted).toBe(true); expect(accepted.workCompleted).toBe(false)
    expect(accepted.run.revisionScope).toBe('presentation')
    await vi.waitFor(() => expect(service.store.getRun(accepted.run.id)?.status).toBe('completed'))
    const saved = JSON.parse((await inspect.execute({ topicId, sectionId: 'ch01' }, context)).content)
    expect(saved.version).toBe(2); expect(saved.savedSectionCount).toBe(1)
    expect(saved.section.body).toBe(artifact.sections[0].body)
    expect(saved.presentation.title).toBe('随系统阅读')
    expect(model).toHaveBeenCalledTimes(1)
    expect(service.store.topics.get('writer', topicId).status).toBe(topic.status)
    expect(service.store.deliveries.get(topicId, 1)).toEqual(artifact)
    expect(service.store.notices.pending('writer').some(n => n.content.includes('版本 2'))).toBe(true)
    model.mockImplementation(async () => '{"section":"不能用样式请求续写"}')
    const current = service.store.topics.get('writer', topicId)
    await service.request('reviseTopic', 'writer', [topicId, current.revision, '调整字体', undefined, 'presentation', 2])
    await vi.waitFor(() => expect(service.store.overview('writer').runs[0].status).toBe('failed'))
    model.mockImplementation(async () => JSON.stringify({ presentation: { title: '修复后的样式', html: '<div id="content"></div>', css: '', script: '' } }))
    const retry = await service.request('run', 'writer', [topicId])
    await vi.waitFor(() => expect(service.store.getRun(retry.runs[0].id)?.status).toBe('completed'))
    expect(service.store.deliveries.get(topicId)?.version).toBe(3)
    expect(service.store.deliveries.get(topicId)?.sections).toEqual(artifact.sections)
    expect(service.store.deliveries.get(topicId)?.presentation?.title).toBe('修复后的样式')
    expect(model).toHaveBeenCalledTimes(4)
    await expect(service.request('inspectDelivery', 'other', [topicId])).rejects.toThrow()
  } finally { await service.close(); rmSync(directory, { recursive: true, force: true }) }
})
