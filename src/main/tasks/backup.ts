import Database from 'better-sqlite3'
import type { TaskUISettings } from '../../shared/tasks'
import { validateTaskChecklist, validateTaskSource } from '../../shared/tasks'
import { TASK_RECURRENCES, parseImportedRepeatRule, repeatRuleFor, validateRepeatRule, validateReminders } from '../../shared/taskScheduling'

const tables = ['task_groups', 'task_projects', 'task_fields', 'task_views', 'tasks', 'task_trash'] as const
type Table = typeof tables[number]
type Row = Record<string, string | number | null>
export interface TaskBackup {
  format: 'chouyu-tasks'
  version: 1
  schemaVersion: number
  createdAt: number
  settings: TaskUISettings
  tables: Record<Table, Row[]>
}

export function validateTaskSettings(input: unknown): TaskUISettings {
  if (!input || typeof input !== 'object') throw new Error('任务界面配置无效。')
  const settings = input as TaskUISettings
  for (const key of ['preferences', 'layoutOrder'] as const) {
    if (typeof settings[key] !== 'string' || settings[key].length > 4_000_000) throw new Error('任务界面配置过大或无效。')
    const value = JSON.parse(settings[key])
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('任务界面配置无效。')
  }
  if (typeof settings.selection !== 'string' || settings.selection.length > 200) throw new Error('任务视图选择无效。')
  return { preferences: settings.preferences, layoutOrder: settings.layoutOrder, selection: settings.selection }
}

export function createTaskBackup(database: Database.Database, settings: TaskUISettings): TaskBackup {
  return database.transaction(() => ({ format: 'chouyu-tasks' as const, version: 1 as const,
    schemaVersion: database.pragma('user_version', { simple: true }) as number, createdAt: Date.now(), settings: validateTaskSettings(settings),
    tables: Object.fromEntries(tables.map(table => [table, database.prepare(`SELECT * FROM ${table}`).all()])) as TaskBackup['tables']
  }))()
}

function insertRows(database: Database.Database, backup: TaskBackup) {
  for (const table of tables) {
    const columns = (database.pragma(`table_info(${table})`) as { name: string }[]).map(column => column.name)
    const insert = database.prepare(`INSERT INTO ${table} (${columns.map(column => `"${column}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
    for (const row of backup.tables[table]) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== columns.length || columns.some(column => !Object.hasOwn(row, column))) throw new Error(`备份中的 ${table} 字段不完整。`)
      if (Object.values(row).some(value => value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))) throw new Error('备份包含无效数据。')
      if (typeof row.id !== 'string' || !row.id || row.id.length > 200) throw new Error('备份包含无效标识。')
      if (table === 'tasks') {
        validateTaskChecklist(JSON.parse(String(row.checklist)))
        validateTaskSource(row.source ? JSON.parse(String(row.source)) : null)
        if (typeof row.title !== 'string' || !row.title.trim() || !['open', 'done'].includes(String(row.status)) || !['high', 'medium', 'low'].includes(String(row.priority)) || !TASK_RECURRENCES.includes(row.recurrence as typeof TASK_RECURRENCES[number])) throw new Error('备份中的任务内容无效。')
        repeatRuleFor(row.recurrence as typeof TASK_RECURRENCES[number], validateRepeatRule(row.repeat_rule ? JSON.parse(String(row.repeat_rule)) : null))
        validateReminders(JSON.parse(String(row.reminders)))
        if (!Number.isInteger(row.recurrence_index) || Number(row.recurrence_index) < 1) throw new Error('重复周期记录无效。')
        for (const key of ['start_at', 'due_at', 'remind_at', 'remind_fired_at', 'completed_at', 'recurrence_anchor_at', 'created_at', 'updated_at']) if (row[key] != null && (typeof row[key] !== 'number' || !Number.isFinite(new Date(row[key] as number).getTime()))) throw new Error('备份中的任务时间无效。')
        if (typeof row.start_at === 'number' && typeof row.due_at === 'number' && row.start_at > row.due_at) throw new Error('备份中的开始时间晚于截止时间。')
        const values = JSON.parse(String(row.custom_fields))
        if (!values || typeof values !== 'object' || Array.isArray(values) || Object.values(values).some(value => typeof value !== 'string')) throw new Error('备份中的任务字段无效。')
      } else if (table === 'task_fields') {
        const options = JSON.parse(String(row.options))
        if (!Array.isArray(options) || options.some(option => !option || typeof option.id !== 'string' || typeof option.name !== 'string')) throw new Error('备份中的字段选项无效。')
      } else if (table === 'task_views') {
        if (!['today', 'week', 'overdue', 'none', 'any'].includes(String(row.due_range))) throw new Error('备份中的视图范围无效。')
        for (const key of ['project_ids', 'priorities']) {
          const values = JSON.parse(String(row[key]))
          if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new Error('备份中的视图筛选无效。')
        }
      } else if (table === 'task_trash') {
        const payload = JSON.parse(String(row.payload))
        if (!['task', 'project', 'group'].includes(String(row.kind)) || !payload || ['groups', 'projects', 'tasks', 'fields'].some(key => !Array.isArray(payload[key]))) throw new Error('备份中的回收记录无效。')
        if (payload.movedProjectIds !== undefined && (!Array.isArray(payload.movedProjectIds) || payload.movedProjectIds.some((id: unknown) => typeof id !== 'string'))) throw new Error('备份中的回收归属无效。')
        const trashDatabase = new Database(':memory:')
        try {
          trashDatabase.pragma('foreign_keys = ON')
          for (const name of tables) {
            const schema = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { sql: string }
            trashDatabase.exec(schema.sql)
          }
          insertRows(trashDatabase, { ...backup, tables: { task_groups: payload.groups, task_projects: payload.projects, task_fields: payload.fields, task_views: [], task_trash: [], tasks: payload.tasks.map((task: Row) => ({ checklist: '[]', source: null, repeat_rule: null, recurrence_index: 1, reminders: legacyReminders(task), ...task })) } })
        } finally { trashDatabase.close() }
      }
      insert.run(...columns.map(column => row[column]))
    }
  }
}

/** Validate in an isolated database using the current schema before any real mutation. */
function legacyReminders(task: Row): string {
  return JSON.stringify(task.remind_at == null ? [] : [{ at: task.remind_at, firedAt: task.remind_fired_at ?? null }])
}

export function validateTaskBackup(database: Database.Database, input: unknown): TaskBackup {
  let backup = input as TaskBackup
  if (backup?.format === 'chouyu-tasks' && backup.version === 1 && backup.schemaVersion === 9 && database.pragma('user_version', { simple: true }) === 10 && Array.isArray(backup.tables?.tasks)) {
    backup = structuredClone(backup)
    backup.schemaVersion = 10
    backup.tables.tasks = backup.tables.tasks.map(task => {
      const flag = String(task.id).startsWith('dida:') && task.status === 'open' && task.recurrence === 'none' && String(task.note).includes('此重复规则仅保留记录，ChouYu 暂不支持自动重复。') ? /原重复规则：([^\r\n]+)/.exec(String(task.note ?? ''))?.[1] : undefined
      const rule = flag ? parseImportedRepeatRule(flag) : null
      return { ...task, repeat_rule: rule ? JSON.stringify(rule) : null, recurrence_index: 1, reminders: legacyReminders(task), ...(rule ? { recurrence: 'custom', note: String(task.note).replace('此重复规则仅保留记录，ChouYu 暂不支持自动重复。', '原重复规则已启用。') } : {}) }
    })
  }
  if (!backup || backup.format !== 'chouyu-tasks' || backup.version !== 1 || backup.schemaVersion !== database.pragma('user_version', { simple: true })) throw new Error('备份格式或数据库版本不兼容。请使用相同版本的应用恢复。')
  if (typeof backup.createdAt !== 'number' || !Number.isFinite(backup.createdAt) || !backup.tables || tables.some(table => !Array.isArray(backup.tables[table]))) throw new Error('备份数据不完整。')
  validateTaskSettings(backup.settings)
  const temporary = new Database(':memory:')
  try {
    temporary.pragma('foreign_keys = ON')
    for (const table of tables) {
      const schema = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string }
      temporary.exec(schema.sql)
    }
    temporary.transaction(() => insertRows(temporary, backup))()
    for (const table of ['task_groups', 'task_projects']) {
      const count = temporary.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE is_default = 1`).get() as { count: number }
      if (count.count !== 1) throw new Error('备份必须包含唯一的默认分组和清单。')
    }
    if ((temporary.pragma('foreign_key_check') as unknown[]).length) throw new Error('备份的任务归属不完整。')
  } finally { temporary.close() }
  return backup
}

export function restoreTaskBackup(database: Database.Database, input: unknown): TaskUISettings {
  const backup = validateTaskBackup(database, input)
  database.transaction(() => {
    for (const table of [...tables].reverse()) database.prepare(`DELETE FROM ${table}`).run()
    insertRows(database, backup)
  })()
  return backup.settings
}
