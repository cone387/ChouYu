import type Database from 'better-sqlite3'
import { taskScheduleBounds, type TaskGroupingQuery } from '../../shared/tasks'

/** Aggregate the full filtered history before pagination, without loading task bodies. */
export function countDoneGroups(database: Database.Database, where: string, params: (string | number)[], grouping: TaskGroupingQuery | undefined, now: number, weekPeriod: 'week' | 'nextWeek' = 'week'): Record<string, number> {
  if (!grouping) return {}
  const args: (string | number)[] = []
  const day = (offset: number) => {
    const date = new Date(now); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + offset)
    return date.getTime()
  }
  let key: string
  switch (grouping.mode) {
    case 'priority': key = 'priority'; break
    case 'project': key = "coalesce(project_id, '')"; break
    case 'status': key = "'done'"; break
    case 'overdue': key = "'other'"; break
    case 'field':
      if (typeof grouping.fieldId !== 'string') return {}
      key = "coalesce(json_extract(custom_fields, ?), '')"
      args.push(`$.${JSON.stringify(grouping.fieldId)}`)
      break
    case 'custom': {
      if (!Array.isArray(grouping.groups) || grouping.groups.some(group => !group || typeof group.id !== 'string' || !Array.isArray(group.taskIds) || group.taskIds.some(id => typeof id !== 'string'))) throw new Error('任务分组无效。')
      key = grouping.groups.length ? `CASE ${grouping.groups.map(group => {
        args.push(JSON.stringify(group.taskIds), group.id)
        return 'WHEN id IN (SELECT value FROM json_each(?)) THEN ?'
      }).join(' ')} ELSE '' END` : "''"
      break
    }
    case 'due':
      key = "CASE WHEN due_at IS NULL THEN 'none' WHEN due_at < ? THEN 'past' WHEN due_at < ? THEN 'today' WHEN due_at < ? THEN 'tomorrow' ELSE 'later' END"
      args.push(day(0), day(1), day(2))
      break
    case 'completed':
      key = "CASE WHEN completed_at IS NULL THEN 'other' WHEN completed_at >= ? AND completed_at < ? THEN 'today' WHEN completed_at >= ? AND completed_at < ? THEN 'yesterday' WHEN completed_at >= ? AND completed_at < ? THEN 'recent' ELSE 'earlier' END"
      args.push(day(0), day(1), day(-1), day(0), day(-6), day(-1))
      break
    case 'week': {
      const [start, end] = taskScheduleBounds(weekPeriod, now)
      key = "CASE WHEN completed_at >= ? AND completed_at < ? THEN strftime('%Y', completed_at / 1000, 'unixepoch', 'localtime') || '-' || CAST(strftime('%m', completed_at / 1000, 'unixepoch', 'localtime') AS INTEGER) || '-' || CAST(strftime('%d', completed_at / 1000, 'unixepoch', 'localtime') AS INTEGER) ELSE 'other' END"
      args.push(start, end)
      break
    }
    default: throw new Error('任务分组无效。')
  }
  const rows = database.prepare(`SELECT ${key} AS group_key, COUNT(*) AS count FROM tasks WHERE ${where} GROUP BY group_key`).all(...args, ...params) as { group_key: string; count: number }[]
  return Object.fromEntries(rows.map(row => [row.group_key, row.count]))
}
