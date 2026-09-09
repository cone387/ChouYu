import type { JournalSavedItem } from './journal'

export interface JournalProjectRule { app: string; title: string }
export interface JournalProjectInput { id?: string; name: string; description: string; archived: boolean; rules: JournalProjectRule[] }
export interface JournalProject extends JournalProjectInput { id: string; createdAt: number; updatedAt: number }
export interface JournalProjectAssignment { savedId: string; projectId: string | null }
export interface JournalProjectState { projects: JournalProject[]; assignments: JournalProjectAssignment[] }

export function validateJournalProject(value: JournalProjectInput): JournalProjectInput {
  if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 80 || typeof value.description !== 'string' || value.description.length > 1000 || typeof value.archived !== 'boolean' || !Array.isArray(value.rules) || value.rules.length > 20 ||
    value.id !== undefined && (typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id))) throw new Error('项目名称最多 80 字，说明最多 1000 字，规则最多 20 条。')
  const rules = value.rules.map(rule => {
    if (!rule || typeof rule.app !== 'string' || typeof rule.title !== 'string' || rule.app.length > 120 || rule.title.length > 120 || !(rule.app.trim() || rule.title.trim())) throw new Error('每条规则需填写应用或标题，分别最多 120 字。')
    return { app: rule.app.trim(), title: rule.title.trim() }
  })
  return { id: value.id, name: value.name.trim(), description: value.description.trim(), archived: value.archived, rules }
}

export function resolveJournalProject(item: JournalSavedItem, state: JournalProjectState): { mode: 'manual' | 'suggested' | 'ambiguous' | 'unassigned'; projectIds: string[] } {
  const manual = state.assignments.find(value => value.savedId === item.id)
  if (manual) return { mode: 'manual', projectIds: manual.projectId && state.projects.some(project => project.id === manual.projectId) ? [manual.projectId] : [] }
  const sources = [...item.activities.map(value => ({ app: value.app, title: value.title })), ...(item.capture ? [{ app: item.capture.app, title: item.capture.title }] : [])]
  if (!sources.length) sources.push({ app: '', title: item.title })
  const projectIds = state.projects.filter(project => !project.archived && project.rules.some(rule => sources.some(source =>
    (!rule.app || source.app.toLocaleLowerCase().includes(rule.app.toLocaleLowerCase())) && (!rule.title || source.title.toLocaleLowerCase().includes(rule.title.toLocaleLowerCase()))))).map(project => project.id)
  return { mode: projectIds.length === 1 ? 'suggested' : projectIds.length > 1 ? 'ambiguous' : 'unassigned', projectIds }
}
