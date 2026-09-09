import { describe, expect, it, vi } from 'vitest'
import { JournalPlaybookMemory } from './playbook-memory'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import type { JournalPlaybookEntry } from '../../shared/journal-playbook'
import type { MemoryRecord } from '../../shared/memory'

const entry: JournalPlaybookEntry = { id: 'test', revision: 1, title: '排错', problem: '无法连接', attempts: '', resolution: '修改地址', status: 'resolved', projectId: null, sourceIds: [], missingSourceIds: [], createdAt: 1, updatedAt: 1 }
const input = { id: entry.id, revision: 1, content: '遇到连接问题时先核对服务地址。', sensitive: false }
function fixture() {
  let entries = [entry], config = { ...DEFAULT_APP_CONFIG }, now = 1
  const write = vi.fn(async () => ({ id: 'memory', status: 'active' }) as MemoryRecord)
  const controller = new JournalPlaybookMemory(async () => entries, () => config, write, () => now)
  return { controller, write, changeEntries: (value: JournalPlaybookEntry[]) => { entries = value }, changeConfig: (value: Partial<typeof config>) => { config = { ...config, ...value } }, advance: () => { now += 600_001 } }
}
describe('playbook memory explicit confirmation', () => {
  it('previews without writing and writes only the reviewed summary and provenance once', async () => {
    const { controller, write } = fixture()
    const plan = await controller.prepare(1, input)
    expect(write).not.toHaveBeenCalled()
    await expect(controller.confirm(2, plan.token)).rejects.toThrow('失效')
    await controller.confirm(1, plan.token)
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ content: input.content, sourceMessageId: entry.id, type: 'workflow' }))
    await expect(controller.confirm(1, plan.token)).rejects.toThrow('失效')
    expect(write).toHaveBeenCalledTimes(1)
  })
  it('rejects stale, deleted and unresolved entries before writing', async () => {
    for (const entries of [[], [{ ...entry, revision: 2 }], [{ ...entry, status: 'open' as const }]]) {
      const f = fixture(), plan = await f.controller.prepare(1, input)
      f.changeEntries(entries)
      await expect(f.controller.confirm(1, plan.token)).rejects.toThrow()
      expect(f.write).not.toHaveBeenCalled()
    }
  })
  it('invalidates expired previews, replacement previews and changed configuration', async () => {
    for (const change of ['expiry', 'config', 'replacement']) {
      const f = fixture(), plan = await f.controller.prepare(1, input)
      if (change === 'expiry') f.advance()
      else if (change === 'config') f.changeConfig({ memorySyncApiKey: 'changed-secret' })
      else await f.controller.prepare(1, { ...input, content: '另一段摘要' })
      await expect(f.controller.confirm(1, plan.token)).rejects.toThrow()
      expect(f.write).not.toHaveBeenCalled()
    }
  })
  it('never truncates text and blocks secret/disabled memory requests', async () => {
    const f = fixture()
    for (const content of ['', 'x'.repeat(501), 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456']) await expect(f.controller.prepare(1, { ...input, content })).rejects.toThrow()
    f.changeConfig({ memoryEnabled: false })
    await expect(f.controller.prepare(1, input)).rejects.toThrow('启用')
    expect(f.write).not.toHaveBeenCalled()
  })
  it('discloses remote destination and vector indexing without exposing credentials', async () => {
    const f = fixture()
    f.changeConfig({ memoryEngineProvider: 'mem0-platform-engine', memorySyncApiKey: 'private-key', memorySyncBaseUrl: 'https://user:password@example.com/v3?key=private', memorySyncUserId: 'owner' })
    const plan = await f.controller.prepare(1, input)
    expect(plan.destination).toContain('https://example.com/v3')
    expect(JSON.stringify(plan)).not.toMatch(/password|private|user:/)
    f.changeConfig({ memoryEngineProvider: 'chouyu-sqlite', embeddingEnabled: true, embeddingProvider: 'openai', embeddingBaseUrl: 'https://embed.example/v1', embeddingModel: 'fixture' })
    expect((await f.controller.prepare(1, input)).indexing).toContain('https://embed.example/v1')
    f.changeConfig({ embeddingBaseUrl: '', baseUrl: 'https://fallback.example/v1' })
    expect((await f.controller.prepare(1, input)).indexing).toContain('https://fallback.example/v1')
  })
  it('propagates pending results and failures without automatically retrying', async () => {
    const f = fixture()
    f.write.mockResolvedValueOnce({ id: 'candidate', status: 'pending' } as MemoryRecord)
    expect((await f.controller.confirm(1, (await f.controller.prepare(1, input)).token)).status).toBe('pending')
    f.write.mockRejectedValueOnce(new Error('remote failed'))
    const plan = await f.controller.prepare(1, input)
    await expect(f.controller.confirm(1, plan.token)).rejects.toThrow('remote failed')
    await expect(f.controller.confirm(1, plan.token)).rejects.toThrow('失效')
    expect(f.write).toHaveBeenCalledTimes(2)
  })
})
