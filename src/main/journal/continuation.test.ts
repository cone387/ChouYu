import { describe, expect, it } from 'vitest'
import type { JournalSavedItem, JournalTask } from '../../shared/journal'
import { continuationCandidates, matchesContinuation } from './continuation'

const task: JournalTask = { id: 'task:one', title: '登录排查', text: '检查接口', kind: 'activity', nextStep: '核对错误返回', organized: true,
  category: '', note: '', edited: false, sourceIds: ['activity:1', 'capture:a', 'capture:b'], activityIds: [1], captureIds: ['a', 'b'], apps: ['editor'], startedAt: 100, endedAt: 200, durationMs: 100 }
const range = { from: 0, to: 1000 }
const saved: JournalSavedItem = { id: 'saved', kind: 'continuation', createdAt: 300, title: task.title, note: '手动备注', pinned: true, completed: true, task, sourceRange: range, activities: [], capture: null, imageBytes: 0 }

describe('daily continuation selection and identity', () => {
  it('skips raw activity and summaries without a concrete next step, prioritizes blockers, and limits to five', () => {
    const items = continuationCandidates([{ ...task, id: 'raw', organized: false }, { ...task, id: 'empty', nextStep: '' },
      ...Array.from({ length: 6 }, (_, index) => ({ ...task, id: `task:${index}`, endedAt: 200 + index })),
      { ...task, id: 'blocked', kind: 'blocker', nextStep: '' }])
    expect(items.map(item => item.id)).toEqual(['blocked', 'task:5', 'task:4', 'task:3', 'task:2'])
  })
  it('recognizes completed and pinned cards without resetting their user state', () => {
    expect(matchesContinuation({ ...task, title: '模型重写标题' }, saved, range)).toBe(true)
    expect(saved).toMatchObject({ pinned: true, completed: true, note: '手动备注' })
  })
  it('matches an unambiguous majority of source IDs after regrouping', () => {
    expect(matchesContinuation({ ...task, id: 'new', sourceIds: ['activity:1', 'capture:a', 'capture:c'] }, saved, range)).toBe(true)
    expect(matchesContinuation({ ...task, id: 'new', sourceIds: ['capture:a', 'capture:c', 'capture:d'] }, saved, range)).toBe(false)
  })
  it('does not confuse a bookmark, a different day, reused IDs or unrelated sources with an existing continuation', () => {
    expect(matchesContinuation(task, { ...saved, kind: 'bookmark' }, range)).toBe(false)
    expect(matchesContinuation(task, saved, { from: 1000, to: 2000 })).toBe(false)
    expect(matchesContinuation({ ...task, startedAt: 400, endedAt: 500 }, saved, range)).toBe(false)
    expect(matchesContinuation({ ...task, sourceIds: ['activity:99'] }, saved, range)).toBe(false)
  })
})
