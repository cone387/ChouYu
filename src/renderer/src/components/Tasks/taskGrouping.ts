import { PRIORITY_LABELS, type TaskPriority, type TaskProject, type TaskRecord, type TaskSelectField, type TaskUpdateInput } from '../../../../shared/tasks'
import type { TaskDisplayGroup } from './taskViewPreferences'

export type BoardGroupMode = 'priority' | 'due' | 'project' | 'field' | 'custom'
export interface BoardColumn {
  key: string
  label: string
  patch: TaskUpdateInput
  archived?: boolean
}

export function groupTasks(tasks: TaskRecord[], projects: TaskProject[], fields: TaskSelectField[], groupMode: BoardGroupMode, groupFieldId: string | null, now = Date.now(), customGroups: TaskDisplayGroup[] = []) {
  const groupField = groupMode === 'field' ? fields.find(field => field.id === groupFieldId) ?? null : null
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const afterTomorrow = new Date(tomorrow); afterTomorrow.setDate(afterTomorrow.getDate() + 1)
  const dueKey = (task: TaskRecord) => task.dueAt == null ? 'none'
    : task.dueAt < today.getTime() ? 'past'
    : task.dueAt < tomorrow.getTime() ? 'today'
    : task.dueAt < afterTomorrow.getTime() ? 'tomorrow' : 'later'

  const columns: BoardColumn[] = []
  if (groupMode === 'priority') {
    for (const priority of ['high', 'medium', 'low'] as TaskPriority[]) {
      columns.push({ key: priority, label: `${PRIORITY_LABELS[priority]}优先级`, patch: { priority } })
    }
  } else if (groupMode === 'custom') {
    for (const group of customGroups) columns.push({ key: group.id, label: group.name, patch: {} })
    columns.push({ key: '', label: '未分组', patch: {} })
  } else if (groupMode === 'due') {
    for (const [key, label] of [['past', '早于今天'], ['today', '今天'], ['tomorrow', '明天'], ['later', '以后'], ['none', '无截止时间']]) {
      columns.push({ key, label, patch: {} })
    }
  } else if (groupMode === 'project') {
    for (const project of projects.filter(project => !project.archivedAt || tasks.some(task => task.projectId === project.id))) {
      columns.push({ key: project.id, label: `${project.name}${project.archivedAt ? '（已归档）' : ''}`, patch: { projectId: project.id }, archived: Boolean(project.archivedAt) })
    }
    if (!projects.some(project => project.isDefault)) columns.push({ key: '', label: '无清单', patch: { projectId: null } })
  } else if (groupField) {
    for (const option of groupField.options) columns.push({ key: option.id, label: option.name, patch: { customFields: { [groupField.id]: option.id } } })
    columns.push({ key: '', label: '未设置', patch: { customFields: { [groupField.id]: null } } })
  }
  const columnOf = (task: TaskRecord): string | undefined => {
    if (groupMode === 'priority') return task.priority
    if (groupMode === 'custom') return customGroups.find(group => group.taskIds.includes(task.id))?.id ?? ''
    if (groupMode === 'due') return dueKey(task)
    if (groupMode === 'project') return task.projectId ?? ''
    if (groupField) return task.customFields[groupField.id] ?? ''
    return undefined
  }
  return columns.map(column => ({ ...column, tasks: tasks.filter(task => columnOf(task) === column.key) }))
}
