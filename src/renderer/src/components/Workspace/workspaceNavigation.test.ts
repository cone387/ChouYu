import { expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { NavigationAuthority, validateWorkspaceSession } from './workspaceNavigation'

it('rejects late source resolution after a new navigation without changing the current page', async () => {
  const navigation = new NavigationAuthority()
  let release!: (value: string) => void
  const read = new Promise<string>(resolve => { release = resolve })
  const apply = vi.fn()
  const first = navigation.resolve(() => read, apply)
  await navigation.resolve(async () => 'tasks', apply)
  release('old-contact')
  await expect(first).rejects.toThrow('替代')
  expect(apply.mock.calls).toEqual([['tasks']])
})

it('preserves the return snapshot until validation succeeds, including exact session and reading position', async () => {
  const navigation = new NavigationAuthority()
  const origin = { page: 'chat', characterId: 'alice', sessionId: 's1', scrollTop: 250 }
  let saved: typeof origin | undefined = origin
  const restore = vi.fn(value => { expect(value).toBe(origin); saved = undefined })
  await expect(navigation.resolve(async () => { throw new Error('来源已删除') }, restore)).rejects.toThrow('已删除')
  expect(saved).toBe(origin)
  await navigation.resolve(async () => saved, restore)
  expect(restore).toHaveBeenCalledExactlyOnceWith(origin)
  expect(saved).toBeUndefined()
})

it('invalidates an in-flight return when the user changes pages', () => {
  const navigation = new NavigationAuthority()
  const current = navigation.begin()
  // Page lifetime and its execution have separate owners.
  navigation.begin()
  expect(() => current()).toThrow('替代')
})

it('refuses a removed or reassigned origin session instead of restoring another conversation', () => {
  const origin = { id: 'old', characterId: 'alice', scrollTop: 235 }
  expect(() => validateWorkspaceSession(origin, [])).toThrow('删除')
  expect(() => validateWorkspaceSession(origin, [{ id: 'old', characterId: 'bob' }])).toThrow('归属')
  expect(() => validateWorkspaceSession(origin, [{ id: 'old', characterId: 'alice' }])).not.toThrow()
})

it('keeps one session lifetime in Workspace and business pages outside ChatPanel', () => {
  const root = 'src/renderer/src/components/'
  const workspace = readFileSync(root + 'Workspace/Workspace.tsx', 'utf8')
  const chat = readFileSync(root + 'ChatPanel/ChatPanel.tsx', 'utf8')
  expect(workspace.match(/= useSessionWorkspace\(/g)).toHaveLength(1)
  expect(chat).not.toMatch(/from ['"].*(TasksView|Journal\/Journal|Settings\/Settings)/)
  expect(workspace).toContain('hidden={!isChat}')
  expect(workspace).toContain('<ChatPanel model=')
})
