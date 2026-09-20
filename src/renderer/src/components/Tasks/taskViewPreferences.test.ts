import { describe, expect, it } from 'vitest'
import { applyTaskOrder, defaultTaskPreferences, moveTaskInOrder, parseTaskPreferences } from './taskViewPreferences'

describe('task view preferences', () => {
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
