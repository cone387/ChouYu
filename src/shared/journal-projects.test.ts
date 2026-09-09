import { describe, expect, it } from 'vitest'
import type { JournalSavedItem } from './journal'
import { resolveJournalProject, validateJournalProject, type JournalProject } from './journal-projects'
const project: JournalProject = { id: 'a', name: 'ChouYu', description: '', archived: false, createdAt: 1, updatedAt: 1, rules: [{ app: 'editor', title: 'chouyu' }] }
const item = { id: 'saved', title: 'title', activities: [{ app: 'EDITOR.EXE', title: 'ChouYu 排查' }], capture: null } as JournalSavedItem
describe('journal project rules', () => {
  it('suggests one match and exposes overlapping project rules as ambiguity', () => {
    expect(resolveJournalProject(item, { projects: [project], assignments: [] })).toEqual({ mode: 'suggested', projectIds: ['a'] })
    expect(resolveJournalProject(item, { projects: [project, { ...project, id: 'b' }], assignments: [] }).mode).toBe('ambiguous')
  })
  it('requires app and title to match the same source and treats wildcards literally', () => {
    const split = { ...item, activities: [{ app: 'editor', title: 'other' }, { app: 'browser', title: 'ChouYu' }] } as JournalSavedItem
    expect(resolveJournalProject(split, { projects: [project], assignments: [] }).mode).toBe('unassigned')
    expect(resolveJournalProject(item, { projects: [{ ...project, rules: [{ app: '_%', title: '' }] }], assignments: [] }).mode).toBe('unassigned')
  })
  it('preserves manual selection and explicit unassignment when rules change or projects are archived', () => {
    expect(resolveJournalProject(item, { projects: [{ ...project, archived: true }], assignments: [{ savedId: 'saved', projectId: 'a' }] })).toEqual({ mode: 'manual', projectIds: ['a'] })
    expect(resolveJournalProject(item, { projects: [project], assignments: [{ savedId: 'saved', projectId: null }] })).toEqual({ mode: 'manual', projectIds: [] })
    expect(resolveJournalProject(item, { projects: [{ ...project, archived: true }], assignments: [] }).mode).toBe('unassigned')
  })
  it('bounds stored project data and rejects empty match-all rules', () => {
    expect(validateJournalProject({ name: '  项目  ', description: '', archived: false, rules: [] }).name).toBe('项目')
    for (const patch of [{ name: '' }, { rules: [{ app: '', title: ' ' }] }, { rules: Array(21).fill({ app: 'editor', title: '' }) }, { description: 'x'.repeat(1001) }]) {
      expect(() => validateJournalProject({ name: '项目', description: '', archived: false, rules: [], ...patch })).toThrow()
    }
  })
})
