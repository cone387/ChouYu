import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentService } from './service'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { streamNativeChat } from '../harness/native/runner'

vi.mock('../harness/native/runner', () => ({ streamNativeChat: vi.fn() }))

it.each([true, false])('distinguishes plan actions and disabled tools with shared access=%s without reading data', async (contactAccess) => {
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-tool-boundary-'))
  const service = new AgentService(directory, () => {})
  const responses: Record<string, string> = {}
  vi.mocked(streamNativeChat).mockImplementation(async (_messages, _system, _config, onChunk, _signal, tools) => {
    for (const name of ['read_contacts', 'discover_contacts', 'invented_tool', 'read_contact_material']) {
      responses[name] = await tools!.execute({ id: name, name, arguments: '{}' })
    }
    onChunk(JSON.stringify({ action: 'wait', reason: '测试边界', query: '', urls: [], checkAfterMinutes: 180 }), false)
  })
  try {
    service.store.save('reviewer', { ...DEFAULT_AGENT_SETTINGS, goal: '评审共享正文', enabled: false, readContactDeliveries: contactAccess, searchEnabled: false })
    await service.sync([{ id: 'reviewer', soul: '独立评审', conversation: '', skillToolsEnabled: true, disabledSkillTools: ['read_contact_material'], config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }])
    await service.request('run', 'reviewer', [service.store.overview('reviewer').focusTopicId])
    await vi.waitFor(() => expect(service.store.overview('reviewer').runs[0].status).toBe('completed'))
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
    expect(service.store.overview('reviewer').reports).toHaveLength(0)
  } finally {
    await service.close()
    rmSync(directory, { recursive: true, force: true })
    vi.mocked(streamNativeChat).mockReset()
  }
})
