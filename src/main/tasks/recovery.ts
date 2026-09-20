import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { TaskTrashEntry } from '../../shared/tasks'

type Row = Record<string, string | number | null>
interface DeletedContent {
  groups: Row[]
  projects: Row[]
  tasks: Row[]
  fields: Row[]
  movedProjectIds?: string[]
}

function rows(database: Database.Database, table: string, ids: string[]): Row[] {
  return ids.length ? database.prepare(`SELECT * FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids)) as Row[] : []
}

/** Caller wraps capture and deletion in the same transaction. */
export function captureDeleted(database: Database.Database, kind: TaskTrashEntry['kind'], id: string, deleteContents = true): void {
  const table = kind === 'task' ? 'tasks' : kind === 'project' ? 'task_projects' : 'task_groups'
  const item = database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined
  if (!item) return
  const projects = kind === 'group'
    ? database.prepare('SELECT * FROM task_projects WHERE group_id = ?').all(id) as Row[]
    : kind === 'project' ? [item] : rows(database, 'task_projects', item.project_id ? [String(item.project_id)] : [])
  const tasks = kind === 'task' ? [item] : deleteContents
    ? database.prepare('SELECT * FROM tasks WHERE project_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(projects.map(project => project.id))) as Row[] : []
  const groups = kind === 'group' ? [item] : rows(database, 'task_groups', [...new Set(projects.flatMap(project => project.group_id ? [String(project.group_id)] : []))])
  const fieldIds = [...new Set(tasks.flatMap(task => Object.keys(JSON.parse(String(task.custom_fields ?? '{}')))))]
  const payload: DeletedContent = { groups, projects, tasks, fields: rows(database, 'task_fields', fieldIds), ...(kind === 'group' && !deleteContents ? { movedProjectIds: projects.map(project => String(project.id)) } : {}) }
  database.prepare('INSERT INTO task_trash (id, kind, name, deleted_at, task_count, payload) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), kind, String(item.title ?? item.name), Date.now(), tasks.length, JSON.stringify(payload))
}

export function listTrash(database: Database.Database): TaskTrashEntry[] {
  return database.prepare('SELECT id, kind, name, deleted_at AS deletedAt, task_count AS taskCount FROM task_trash ORDER BY deleted_at DESC, rowid DESC').all() as TaskTrashEntry[]
}

export function restoreTrash(database: Database.Database, id: string): void {
  database.transaction(() => {
    const entry = database.prepare('SELECT payload FROM task_trash WHERE id = ?').get(id) as { payload: string } | undefined
    if (!entry) throw new Error('回收记录不存在。')
    const payload = JSON.parse(entry.payload) as DeletedContent
    const insertMissing = (table: string, input: Row) => {
      if (database.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(input.id)) return
      const row = { ...input }
      if (table === 'task_groups' || table === 'task_projects') {
        // Renaming avoids colliding with new work that reused the deleted name.
        let name = String(row.name), index = 1
        while (database.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name)) name = `${row.name}（恢复 ${index++}）`
        row.name = name
        row.is_default = 0
      }
      if (table === 'tasks') {
        const values = JSON.parse(String(row.custom_fields ?? '{}')) as Record<string, string>
        for (const [fieldId, optionId] of Object.entries(values)) {
          const field = database.prepare('SELECT options FROM task_fields WHERE id = ?').get(fieldId) as { options: string } | undefined
          if (!field || !(JSON.parse(field.options) as { id: string }[]).some(option => option.id === optionId)) delete values[fieldId]
        }
        row.custom_fields = JSON.stringify(values)
        row.updated_at = Date.now()
        // Do not turn recovery of old work into a burst of overdue notifications.
        if (typeof row.remind_at === 'number' && row.remind_at <= Date.now() && row.remind_fired_at == null) row.remind_fired_at = Date.now()
      }
      const allowed = new Set((database.pragma(`table_info(${table})`) as { name: string }[]).map(column => column.name))
      const keys = Object.keys(row).filter(key => allowed.has(key))
      database.prepare(`INSERT INTO ${table} (${keys.map(key => `"${key}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => row[key]))
    }
    for (const group of payload.groups) insertMissing('task_groups', group)
    for (const project of payload.projects) insertMissing('task_projects', project)
    for (const field of payload.fields) insertMissing('task_fields', field)
    for (const task of payload.tasks) insertMissing('tasks', task)
    for (const projectId of payload.movedProjectIds ?? []) {
      const original = payload.projects.find(project => project.id === projectId)
      if (original) database.prepare('UPDATE task_projects SET group_id = ? WHERE id = ? AND group_id IN (SELECT id FROM task_groups WHERE is_default = 1)').run(original.group_id, projectId)
    }
    database.prepare('DELETE FROM task_trash WHERE id = ?').run(id)
  })()
}
