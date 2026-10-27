import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkLoopHost } from '../agent-space/workloop-host'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { streamNativeChat } from '../harness/native/runner'

vi.mock('../harness/native/runner', () => ({ streamNativeChat: vi.fn() }))

it.each([true, false])('distinguishes plan actions and disabled tools with shared access=%s without reading data', async (contactAccess) => {
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-tool-boundary-'))
  const service = new WorkLoopHost(directory, () => {})
  const responses: Record<string, string> = {}
  let rounds = 0
  const sharedRead = vi.spyOn(service.runtime.contactSources, 'read')
  vi.mocked(streamNativeChat).mockImplementation(async (_messages, _system, _config, onChunk, _signal, tools) => {
    if (++rounds === 1) {
      expect(tools!.definitions.map(tool => tool.name).toSorted()).toEqual(['read_task_context', 'search_task_context'])
      expect(await tools!.execute({ id: 'planning-upload', name: 'read_contact_material', arguments: '{}' })).toBe('工具已被用户禁用。')
      onChunk(JSON.stringify({ action: 'write', reason: '创作虚构故事', query: '', urls: [], checkAfterMinutes: 180 }), false)
      return
    }
    expect(tools).toBeDefined()
    for (const name of ['read_contacts', 'discover_contacts', 'invented_tool', 'read_contact_material']) {
      responses[name] = await tools!.execute({ id: name, name, arguments: '{}' })
    }
    onChunk(JSON.stringify({ title: '虚构故事', body: '灯塔亮起蓝光。', nextStep: '继续创作', memories: [], question: '',
      progress: { status: 'researching', judgement: '本轮已创作', openQuestions: '', nextStep: '继续创作', reason: '虚构正文，无外部资料' },
      delivery: { completionCriteria: '持续创作虚构故事', summary: '首段', stages: [{ id: 'story', title: '创作', status: 'active' }], section: { id: 'opening', title: '开篇', body: '灯塔亮起蓝光。' } } }), false)
  })
  try {
    service.store.save('reviewer', { ...DEFAULT_AGENT_SETTINGS, goal: '写一个虚构故事', enabled: false, readContactDeliveries: contactAccess, searchEnabled: false })
    await service.sync([{ id: 'reviewer', soul: '独立评审', conversation: '', skillToolsEnabled: true, disabledSkillTools: ['read_contact_material'], config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }])
    await service.request('run', 'reviewer', [service.store.overview('reviewer').focusTopicId! ])
    await vi.waitFor(() => {
      const run = service.store.overview('reviewer').runs[0]
      expect(run.status, JSON.stringify(run)).toBe('completed')
    })
    for (const name of ['read_contacts', 'discover_contacts']) {
      if (contactAccess) {
        expect(responses[name]).toContain('action')
        expect(responses[name]).toContain('JSON')
      } else expect(responses[name]).toContain('未授权')
      expect(responses[name]).not.toContain('用户禁用')
    }
    expect(responses.invented_tool).toContain('不存在')
    expect(responses.invented_tool).not.toContain('用户禁用')
    expect(responses.read_contact_material).toBe('工具已被用户禁用。')
    expect(rounds).toBe(2)
    expect(sharedRead).not.toHaveBeenCalled()
    expect(service.store.overview('reviewer').reports[0].evidence).toEqual([])
  } finally {
    await service.close()
    rmSync(directory, { recursive: true, force: true })
    vi.mocked(streamNativeChat).mockReset()
  }
})
