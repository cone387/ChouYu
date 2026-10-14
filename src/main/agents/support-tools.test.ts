import { expect, it, vi } from 'vitest'
import { createContactSupportTools } from './support-tools'
import type { ToolExecutionContext } from '../tools/registry'
import { validateToolArguments } from '../../shared/tools'

function fixture() {
  const access = { owner: () => 'alice', credential: () => ({ configured: false, revision: 0 }), saveCredential: vi.fn(() => ({ configured: true, revision: 1 })), skills: async () => ({ revision: 1, skills: [] }), catalog: async () => ({ total: 1, skills: [{ id: 'review', name: 'Review', description: 'Review method' }] }), runtime: async () => ({ ready: true, engineReady: true, message: 'Ready' }), install: vi.fn(async () => ({ id: 'review', name: 'Review', digest: 'digest' })), prepareRuntime: vi.fn(), prepareDependencies: vi.fn(), material: vi.fn() }
  const tools = createContactSupportTools(access as any)
  const prepare = (name: string, args: Record<string, unknown>, secureInput?: string) => { const tool = tools.find(t => t.name === name)!; return tool.prepareAsync!(validateToolArguments(tool.inputSchema, args), { sessionId: 'session', secureInput } as ToolExecutionContext) }
  return { access, tools, prepare }
}
it('requires a dedicated transient input for credentials and saves only a non-secret receipt', async () => {
  const f = fixture(), args = { revision: 0, reason: '更新搜索密钥' }
  const pending = await f.prepare('set_contact_search_credential', args)
  expect(pending.confirmationRequired).toBe(true)
  await expect(pending.execute()).rejects.toThrow('安全输入')
  expect(f.access.saveCredential).not.toHaveBeenCalled()
  const prepared = await f.prepare('set_contact_search_credential', args, 'private-search-value')
  const result = await prepared.execute()
  expect(f.access.saveCredential).toHaveBeenCalledExactlyOnceWith('alice', 'private-search-value', 0)
  expect(JSON.stringify(result)).not.toContain('private-search-value')
})
it('installs only a real catalog entry and does not silently enable it or authorize scripts', async () => {
  const f = fixture(), prepared = await f.prepare('install_contact_skill', { skillId: 'review', revision: 1, reason: '安装评审技能' })
  expect(f.access.install).not.toHaveBeenCalled()
  expect((await prepared.execute()).summary).toContain('未自动启用')
  expect(f.access.install).toHaveBeenCalledExactlyOnceWith('review')
  await expect(f.prepare('install_contact_skill', { skillId: 'invented', revision: 1, reason: '安装' })).rejects.toThrow('目录')
})
it('rejects outdated library versions and dependencies of unassigned skills', async () => {
  const f = fixture()
  await expect(f.prepare('install_contact_skill', { skillId: 'review', revision: 0, reason: '安装' })).rejects.toThrow('变化')
  await expect(f.prepare('prepare_contact_skill_environment', { phase: 'dependencies', skillId: 'review', revision: 1, reason: '准备依赖' })).rejects.toThrow('启用')
  expect(f.access.prepareDependencies).not.toHaveBeenCalled()
})
it('does not claim successful runtime preparation when the actual environment is not ready', async () => {
  const f = fixture(); f.access.prepareRuntime.mockResolvedValue({ ready: false, message: 'Docker未启动' })
  const prepared = await f.prepare('prepare_contact_skill_environment', { phase: 'runtime', revision: 1, reason: '准备运行环境' })
  await expect(prepared.execute()).rejects.toThrow('Docker未启动')
})
