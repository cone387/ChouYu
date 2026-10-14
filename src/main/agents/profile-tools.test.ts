import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDefaultCharacter } from '../../shared/characters'
import { DEFAULT_APP_CONFIG } from '../../shared/config'
import { applyContactProfilePatch, contactProfileSnapshot } from '../../shared/contact-profile-settings'
import { validateToolArguments } from '../../shared/tools'
import { SkillLibrary } from '../skills/library'
import { createContactProfileTools } from './profile-tools'
import { routeContactChange } from './chat-changes'
import type { ToolExecutionContext } from '../tools/registry'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'contact-profile-tools-')); roots.push(root)
  const source = join(root, 'source'); mkdirSync(source)
  writeFileSync(join(source, 'SKILL.md'), '---\nname: careful-review\ndescription: Review\n---\nRead carefully.')
  const library = new SkillLibrary(join(root, 'skills'))
  library.publish('careful-review', source)
  let owner = 'alice', character = { ...createDefaultCharacter(1), id: 'alice', name: '作者', builtIn: false, soulMd: '原人设' }
  const read = () => contactProfileSnapshot(character, DEFAULT_APP_CONFIG)
  const write = vi.fn(async (id, patch, revision, _reason) => {
    if (id !== owner || revision !== read().revision) throw new Error('联系人资料已变化')
    character = { ...character, ...applyContactProfilePatch(read(), patch), updatedAt: character.updatedAt + 1 }
    return read()
  })
  const configure = vi.fn(async (id, skill, action, revision) => library.configure(id, skill, action, revision))
  const tools = createContactProfileTools({ owner: () => owner, profile: async () => read(), update: write, skills: async id => library.list(id), configure })
  const prepare = (name: string, args: Record<string, unknown>) => {
    const tool = tools.find(t => t.name === name)!
    return tool.prepareAsync!(validateToolArguments(tool.inputSchema, args), { sessionId: 'chat' } as ToolExecutionContext)
  }
  const route = (message: string, plan: unknown) => routeContactChange([{ role: 'user', content: message }], {
    read: async () => ({ topics: [], runs: [], settings: {}, revision: 1 }),
    configuration: async () => ({ profile: read(), skills: library.list(owner) }),
    model: async () => JSON.stringify(plan), execute: async call => (await (await prepare(call.name, JSON.parse(call.arguments))).execute()).content
  })
  return { library, read, write, configure, tools, prepare, route, owner: (id: string) => { owner = id } }
}
it('routes profile changes without a task and returns only a verified saved receipt', async () => {
  const f = fixture()
  expect(await f.route('以后叫你阿笔', { kind: 'profile', patch: { name: '阿笔' } })).toContain('已保存')
  expect(f.read().profile).toMatchObject({ name: '阿笔', soulMd: '原人设' })
  expect(f.write).toHaveBeenCalledOnce()
})
it('prepares a concrete profile change and rechecks ownership/version before writing', async () => {
  const f = fixture(), revision = f.read().revision
  const prepared = await f.prepare('edit_contact_profile', { revision, name: '阿笔', reason: '名字改为阿笔' })
  expect(prepared.preview).toContain('阿笔')
  expect(f.write).not.toHaveBeenCalled()
  f.owner('bob')
  await expect(prepared.execute()).rejects.toThrow('归属')
  expect(f.write).not.toHaveBeenCalled()
  f.owner('alice')
  const stale = await f.prepare('edit_contact_profile', { revision, avatar: '✍️', reason: '换头像' })
  await f.route('名字改为阿笔', { kind: 'profile', patch: { name: '阿笔' } })
  await expect(stale.execute()).rejects.toThrow('变化')
})
it('routes skill actions to the installed catalog and persists independent enablement', async () => {
  const f = fixture()
  const reply = await f.route('启用细致评审技能', { kind: 'skill', skillId: 'careful-review', action: 'enable' })
  expect(reply).toContain('已启用')
  expect(f.library.snapshot('alice').entries).toHaveLength(1)
  expect(f.library.snapshot('alice').entries[0].scriptsEnabled).toBe(false)
  expect(f.library.snapshot('bob').entries).toEqual([])
  expect(await f.route('停用这个技能', { kind: 'skill', skillId: 'careful-review', action: 'disable' })).toContain('已停用')
})
it('rejects a fabricated skill and stale configuration and never repeats a prepared action', async () => {
  const f = fixture()
  await expect(f.route('启用技能', { kind: 'skill', skillId: 'not-installed', action: 'enable' })).rejects.toThrow('安装')
  expect(f.configure).not.toHaveBeenCalled()
  const args = { skillId: 'careful-review', action: 'enable', revision: 0, reason: '启用技能' }
  const first = await f.prepare('configure_contact_skill', args), stale = await f.prepare('configure_contact_skill', args)
  await first.execute()
  await expect(first.execute()).rejects.toThrow('执行')
  await expect(stale.execute()).rejects.toThrow('变化')
  expect(f.library.list('alice').revision).toBe(1)
})
it('does not report success when saving a profile or configuring a skill fails', async () => {
  const f = fixture()
  f.write.mockRejectedValueOnce(new Error('disk full'))
  await expect(f.route('名字改成阿笔', { kind: 'profile', patch: { name: '阿笔' } })).rejects.toThrow('disk full')
  expect(f.read().profile.name).toBe('作者')
  f.configure.mockRejectedValueOnce(new Error('disk full'))
  await expect(f.route('启用技能', { kind: 'skill', skillId: 'careful-review', action: 'enable' })).rejects.toThrow('disk full')
  expect(f.library.snapshot('alice').entries).toEqual([])
})
it('rejects oversized model and persona parameters before they can be silently truncated by tool validation', async () => {
  const f = fixture()
  for (const patch of [{ model: 'm'.repeat(257) }, { soulMd: 's'.repeat(50001) }, { providerProfileId: 'p'.repeat(129) }]) {
    await expect(f.prepare('edit_contact_profile', { ...patch, revision: f.read().revision, reason: '修改配置' })).rejects.toThrow()
  }
  expect(f.write).not.toHaveBeenCalled()
})
