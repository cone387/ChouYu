import { describe, expect, it } from 'vitest'
import { applyTaskOrder, assignTaskToGroup, defaultTaskPreferences, moveTaskInOrder, parseTaskPreferences } from './taskViewPreferences'

describe('task view preferences', () => {
  it('restores named groups per view and repairs invalid or duplicated memberships', () => {
    const restored = parseTaskPreferences(JSON.stringify({ all: { groupMode: 'custom', customGroups: [
      { id: 'a', name: '  需求  ', taskIds: ['t1', 't1', 3] },
      { id: 'b', name: '执行', taskIds: ['t1', 't2'] },
      { id: 'a', name: '重复', taskIds: ['t3'] }, { id: '', name: '错误' }, null
    ] }, today: { groupMode: 'due' } }))
    expect(restored.all.customGroups).toEqual([{ id: 'a', name: '需求', taskIds: ['t1'] }, { id: 'b', name: '执行', taskIds: ['t2'] }])
    expect(restored.all.groupMode).toBe('custom')
    expect(restored.today.customGroups).toEqual([])
  })
  it('moves between custom groups without dropping hidden tasks or mutating the source', () => {
    const groups = [{ id: 'a', name: '需求', taskIds: ['t1', 'hidden'] }, { id: 'b', name: '执行', taskIds: [] }]
    const moved = assignTaskToGroup(groups, 't1', 'b')
    expect(moved.map(group => group.taskIds)).toEqual([['hidden'], ['t1']])
    expect(assignTaskToGroup(moved, 't1', '').map(group => group.taskIds)).toEqual([['hidden'], []])
    expect(assignTaskToGroup(groups, 't1', 'deleted')).toBe(groups)
    expect(groups[0].taskIds).toEqual(['t1', 'hidden'])
  })
  it('restores independent view settings including hidden fields and manual order', () => {
    const stored = parseTaskPreferences(JSON.stringify({
      'project:a': { ...defaultTaskPreferences, mode: 'board', sortMode: 'manual', hiddenFields: ['due'], taskOrder: ['b', 'a'] },
      'project:b': { ...defaultTaskPreferences, groupMode: 'field', groupFieldId: 'stage' }
    }))
    expect(stored['project:a']).toMatchObject({ mode: 'board', hiddenFields: ['due'], taskOrder: ['b', 'a'] })
    expect(stored['project:b']).toMatchObject({ mode: 'list', hiddenFields: [], groupFieldId: 'stage' })
  })
  it('recovers malformed storage and invalid values without breaking the workspace', () => {
    expect(parseTaskPreferences('{bad')).toEqual({})
    expect(parseTaskPreferences('[]')).toEqual({})
    expect(parseTaskPreferences('{"today":{"mode":"bad","sortMode":"toString","hiddenFields":["due",1,"due"]}}').today).toEqual({ ...defaultTaskPreferences, hiddenFields: ['due'] })
  })
  it('preserves date grouping independently for each task view', () => {
    const saved = parseTaskPreferences(JSON.stringify({ all: { ...defaultTaskPreferences, listGrouped: true, groupMode: 'due' }, today: defaultTaskPreferences }))
    expect(saved.all).toMatchObject({ listGrouped: true, groupMode: 'due' })
    expect(saved.today).toMatchObject({ listGrouped: false, groupMode: 'priority' })
  })
  it('preserves filtered-out tasks while moving before and after a visible target', () => {
    expect(moveTaskInOrder(['a', 'hidden', 'b', 'c'], ['a', 'b', 'c'], 'c', 'a', false)).toEqual(['c', 'a', 'hidden', 'b'])
    expect(moveTaskInOrder(['a', 'hidden', 'b', 'c'], ['a', 'b', 'c'], 'a', 'b', true)).toEqual(['hidden', 'b', 'a', 'c'])
  })
  it('handles empty columns, new tasks and no-op drops', () => {
    expect(moveTaskInOrder(['a', 'b'], ['a', 'b', 'c'], 'a', null, true)).toEqual(['b', 'c', 'a'])
    expect(moveTaskInOrder(['a', 'b'], ['a', 'b'], 'a', 'a', true)).toEqual(['a', 'b'])
    expect(moveTaskInOrder(['a', 'b'], ['a', 'b'], 'a', 'missing', true)).toEqual(['a', 'b'])
  })
  it('ignores stale task IDs and appends new tasks stably without mutating input', () => {
    const input = [{ id: 'a' }, { id: 'b' }, { id: 'new' }]
    expect(applyTaskOrder(input, ['deleted', 'b', 'a']).map(task => task.id)).toEqual(['b', 'a', 'new'])
    expect(input.map(task => task.id)).toEqual(['a', 'b', 'new'])
  })
})
