import { describe, expect, it } from 'vitest'
import { ContactTaskDraftStore } from './drafts'

function store() {
  let value: string | undefined
  const drafts = new ContactTaskDraftStore({ read: () => value, write: text => { value = text } })
  return { drafts, raw: () => value }
}
describe('contact task drafts', () => {
  it('appends turns under a target key and restores them', () => {
    const { drafts } = store()
    drafts.append('create:chouyu', { role: 'user', text: '每个工作日早上汇总' })
    drafts.append('create:chouyu', { role: 'assistant', text: '每个工作日早上几点汇报？' })
    expect(drafts.get('create:chouyu')?.turns).toEqual([
      { role: 'user', text: '每个工作日早上汇总' },
      { role: 'assistant', text: '每个工作日早上几点汇报？' }
    ])
  })
  it('clears one draft without touching others or the routines key', () => {
    const { drafts, raw } = store()
    drafts.append('create:chouyu', { role: 'user', text: 'a' })
    drafts.append('edit-work:c1:t1', { role: 'user', text: 'b' })
    drafts.clear('create:chouyu')
    expect(drafts.get('create:chouyu')).toBeUndefined()
    expect(drafts.get('edit-work:c1:t1')).toBeTruthy()
    expect(raw()).not.toContain('assistant-routines-v1')
  })
  it('caps drafts and per-draft size, dropping the oldest first', () => {
    const { drafts } = store()
    for (let i = 0; i < 22; i++) drafts.append(`create:c${i}`, { role: 'user', text: `x${i}` })
    expect(drafts.list()).toHaveLength(20)
    expect(drafts.list()[0].targetKey).toBe('create:c2')
    const key = 'create:c3'
    for (let i = 0; i < 500; i++) drafts.append(key, { role: 'user', text: '……很长……'.repeat(20) })
    expect(JSON.stringify(drafts.get(key)!.turns).length).toBeLessThanOrEqual(8000)
    expect(drafts.get(key)?.truncated).toBe(true)
    expect(ContactTaskDraftStore.render(drafts.get(key), '最终要求')).toContain('更早的补问因草稿长度限制未保留')
  })
  it('quarantines a corrupt store and starts empty instead of replacing unreadable state silently', () => {
    let value = '{bad json', quarantined = ''
    const drafts = new ContactTaskDraftStore({ read: () => value, write: text => { value = text }, quarantine: text => { quarantined = text } })
    expect(drafts.list()).toEqual([])
    expect(quarantined).toBe('{bad json')
  })
})
