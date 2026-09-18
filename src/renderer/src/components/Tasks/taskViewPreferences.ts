import { TASK_SORT_LABELS, type TaskSortMode } from '../../../../shared/tasks'

export interface TaskViewPreferences {
  mode: 'list' | 'board'
  listGrouped: boolean
  groupMode: 'priority' | 'project' | 'field'
  groupFieldId: string | null
  sortMode: TaskSortMode
  hiddenFields: string[]
  taskOrder: string[]
}
export const defaultTaskPreferences: TaskViewPreferences = {
  mode: 'list', listGrouped: false, groupMode: 'priority', groupFieldId: null,
  sortMode: 'smart', hiddenFields: [], taskOrder: []
}
export const TASK_PREFERENCES_KEY = 'chouyu:task-view-preferences:v1'
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : []
export function parseTaskPreferences(raw: string | null): Record<string, TaskViewPreferences> {
  try {
    const data: unknown = JSON.parse(raw ?? '{}')
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    return Object.fromEntries(Object.entries(data).flatMap(([scope, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const item = value as Record<string, unknown>
      return [[scope, {
        mode: item.mode === 'board' ? 'board' : 'list', listGrouped: item.listGrouped === true,
        groupMode: item.groupMode === 'project' || item.groupMode === 'field' ? item.groupMode : 'priority',
        groupFieldId: typeof item.groupFieldId === 'string' ? item.groupFieldId : null,
        sortMode: typeof item.sortMode === 'string' && Object.hasOwn(TASK_SORT_LABELS, item.sortMode) ? item.sortMode as TaskSortMode : 'smart',
        hiddenFields: strings(item.hiddenFields), taskOrder: strings(item.taskOrder)
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
