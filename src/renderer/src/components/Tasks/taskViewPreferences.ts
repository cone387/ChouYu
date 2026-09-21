import { TASK_SORT_LABELS, type TaskSortMode } from '../../../../shared/tasks'

export interface TaskDisplayGroup {
  id: string
  name: string
  taskIds: string[]
}

export interface TaskViewPreferences {
  mode: 'list' | 'board'
  listGrouped: boolean
  groupMode: 'priority' | 'due' | 'project' | 'field' | 'custom' | 'status' | 'week' | 'overdue' | 'completed'
  statusFilter: 'open' | 'done' | 'all'
  groupFieldId: string | null
  sortMode: TaskSortMode
  hiddenFields: string[]
  taskOrder: string[]
  customGroups: TaskDisplayGroup[]
}
export const defaultTaskPreferences: TaskViewPreferences = {
  mode: 'list', listGrouped: false, groupMode: 'priority', groupFieldId: null, statusFilter: 'open',
  sortMode: 'smart', hiddenFields: [], taskOrder: [], customGroups: []
}
export const TASK_PREFERENCES_KEY = 'chouyu:task-view-preferences:v1'
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : []
function parseDisplayGroups(value: unknown): TaskDisplayGroup[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  const tasks = new Set<string>()
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim()) return []
    ids.add(item.id)
    const taskIds = strings(item.taskIds).filter(id => { if (tasks.has(id)) return false; tasks.add(id); return true })
    return [{ id: item.id, name: item.name.trim(), taskIds }]
  })
}
export function recommendedTaskPreferences(scope: string): TaskViewPreferences {
  const value = { ...defaultTaskPreferences, hiddenFields: [], taskOrder: [], customGroups: [] }
  switch (scope) {
    case 'today': return { ...value, listGrouped: true, groupMode: 'status', statusFilter: 'all', sortMode: 'priority' }
    case 'nextWeek':
    case 'week': return { ...value, listGrouped: true, groupMode: 'week', sortMode: 'priority' }
    case 'tomorrow':
    case 'unplanned': return { ...value, listGrouped: true, sortMode: 'priority' }
    case 'all': return { ...value, listGrouped: true, groupMode: 'project' }
    case 'overdue': return { ...value, listGrouped: true, groupMode: 'overdue', sortMode: 'priority' }
    case 'done': return { ...value, listGrouped: true, groupMode: 'completed', statusFilter: 'done', sortMode: 'completed' }
    default: return value
  }
}

/** A task belongs to at most one manual group in this view; other views are independent. */
export function assignTaskToGroup(groups: TaskDisplayGroup[], taskId: string, groupId: string): TaskDisplayGroup[] {
  if (groupId && !groups.some(group => group.id === groupId)) return groups
  return groups.map(group => ({ ...group, taskIds: [...group.taskIds.filter(id => id !== taskId), ...(group.id === groupId ? [taskId] : [])] }))
}

export function parseTaskPreferences(raw: string | null): Record<string, TaskViewPreferences> {
  try {
    const data: unknown = JSON.parse(raw ?? '{}')
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    return Object.fromEntries(Object.entries(data).flatMap(([scope, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const item = value as Record<string, unknown>
      return [[scope, {
        mode: item.mode === 'board' ? 'board' : 'list', listGrouped: item.listGrouped === true,
        groupMode: typeof item.groupMode === 'string' && ['project', 'field', 'due', 'custom', 'status', 'week', 'overdue', 'completed'].includes(item.groupMode) ? item.groupMode as TaskViewPreferences['groupMode'] : 'priority',
        statusFilter: item.statusFilter === 'done' || item.statusFilter === 'all' ? item.statusFilter : 'open',
        groupFieldId: typeof item.groupFieldId === 'string' ? item.groupFieldId : null,
        sortMode: typeof item.sortMode === 'string' && Object.hasOwn(TASK_SORT_LABELS, item.sortMode) ? item.sortMode as TaskSortMode : 'smart',
        hiddenFields: strings(item.hiddenFields), taskOrder: strings(item.taskOrder), customGroups: parseDisplayGroups(item.customGroups)
      }]]
    }))
  } catch { return {} }
}

/** Merge visible IDs without dropping the ordering of tasks outside the filter. */
export function moveTaskInOrder(order: string[], visible: string[], source: string, target: string | null, after: boolean): string[] {
  const ids = [...new Set([...order, ...visible, source])]
  if (source === target || (target !== null && !ids.includes(target))) return ids
  const rest = ids.filter(id => id !== source)
  const index = target === null ? rest.length : rest.indexOf(target) + Number(after)
  rest.splice(index, 0, source)
  return rest
}
export function applyTaskOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const ranks = new Map(order.map((id, index) => [id, index]))
  return [...items].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity))
}
