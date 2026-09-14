# 任务模块一期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 内置任务模块一期——独立 SQLite 存储、任务/项目 CRUD、优先级、截止与提醒、主进程调度、系统通知 + 主动消息中心、工作区「任务」页。

**Architecture:** 主进程新增 `src/main/tasks/`(store + scheduler + IPC),独立 `userData/tasks.db`(user_version 迁移、损坏隔离),与日志/记忆/聊天库零共享。渲染端工作区加 `tasks` 页,提醒经 `tasks:reminder` 推给 ProactiveEngine(`kind: 'task'`)。设计 spec: `docs/superpowers/specs/2026-09-14-task-management-design.md`。二期(重复任务逻辑、`create_task` 聊天工具、日志产物转任务)另行出计划。

**Tech Stack:** Electron 34+、better-sqlite3 13、React 18、Vitest(node 环境,globals)。

**验证命令:** 单测 `npx vitest --run <file>`;类型 `npm run typecheck`;构建 `npm run build`;Electron 冒烟 `npm run test:smoke`(build + smoke-electron.js,失败输出 `CHOUYU_SMOKE_FAILED`)。

---

## File Structure

- Create `src/shared/tasks.ts` — 类型 + 纯函数(排序/智能视图/提醒选项),主/渲染共享
- Create `src/shared/tasks.test.ts`
- Create `src/main/tasks/store.ts` — TasksStore:打开/迁移/隔离、任务与项目 CRUD、领取到期提醒
- Create `src/main/tasks/store.test.ts`
- Create `src/main/tasks/scheduler.ts` — startTaskScheduler:启动积压合并 + 周期 tick
- Create `src/main/tasks/scheduler.test.ts`
- Create `src/main/tasks/index.ts` — initializeTasks/closeTasks:IPC 注册、通知、广播
- Create `src/main/smoke/tasks-smoke.ts` — Electron 冒烟
- Modify `src/shared/config.ts` — AppConfig.taskNotifications
- Modify `src/main/index.ts` — 初始化/退出接线 + 冒烟链
- Modify `src/preload/index.ts` — tasks 命名空间 + 三个事件订阅
- Modify `src/renderer/src/shared/types.ts` — ElectronAPI 镜像
- Modify `src/renderer/src/core/proactive.ts` — 'task' kind + postExternal
- Create `src/renderer/src/core/proactive.test.ts`
- Create `src/renderer/src/components/Tasks/TasksView.tsx` + `Tasks.css` + `Tasks.regression.test.ts`
- Modify `src/renderer/src/components/Workspace/WorkspaceNav.tsx` — 'tasks' 页
- Modify `src/renderer/src/components/ChatPanel/ChatPanel.tsx` — 挂载任务页
- Modify `src/renderer/src/App.tsx` — 提醒订阅、打开任务页、ProactiveCenter 点击
- Modify `src/renderer/src/components/ProactiveCenter/ProactiveCenter.tsx` — task 条目可点击
- Modify `src/renderer/src/components/Settings/Settings.tsx` — 通知开关
- Modify `docs/roadmap.md` — 进度记录

---

### Task 1: 共享类型与纯函数

**Files:**
- Create: `src/shared/tasks.ts`
- Test: `src/shared/tasks.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/shared/tasks.test.ts
import { describe, expect, test } from 'vitest'
import {
  compareTasks, isDueThisWeek, isDueToday, isOverdue, remindAtFromChoice, TASK_PRIORITY_ORDER
} from './tasks'
import type { RemindChoiceId, TaskRecord } from './tasks'

const base = (patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 't', title: '任务', note: '', projectId: null, priority: 'medium', status: 'open',
  dueAt: null, remindAt: null, remindFiredAt: null, recurrence: 'none', recurrenceAnchorAt: null,
  createdAt: 1_000, updatedAt: 1_000, completedAt: null, ...patch
})

describe('remindAtFromChoice', () => {
  test('按截止时刻与提前量计算,none 或无截止返回 null', () => {
    expect(remindAtFromChoice('due', 5_000)).toBe(5_000)
    expect(remindAtFromChoice('m30', 5_000)).toBe(5_000 - 30 * 60_000)
    expect(remindAtFromChoice('none', 5_000)).toBeNull()
    expect(remindAtFromChoice('due', null)).toBeNull()
    expect(remindAtFromChoice('bogus' as RemindChoiceId, 5_000)).toBeNull()
  })
})

describe('smart view helpers', () => {
  test('过期=截止在今天零点前,今天=本日之内,互不重叠', () => {
    const now = new Date('2026-09-14T15:00:00').getTime()
    const startToday = new Date('2026-09-14T00:00:00').getTime()
    const yesterday = base({ dueAt: startToday - 1 })
    const thisMorning = base({ dueAt: startToday + 1 })
    const tonight = base({ dueAt: startToday + 23 * 3600_000 })
    const tomorrow = base({ dueAt: startToday + 25 * 3600_000 })
    expect(isOverdue(yesterday, now)).toBe(true)
    expect(isOverdue(thisMorning, now)).toBe(false)
    expect(isDueToday(thisMorning, now)).toBe(true)
    expect(isDueToday(tonight, now)).toBe(true)
    expect(isDueToday(tomorrow, now)).toBe(false)
    expect(isOverdue(base({ status: 'done', dueAt: 1 }), now)).toBe(false)
  })
  test('本周=本周一零点到周日末,以本地时区', () => {
    const now = new Date('2026-09-16T10:00:00').getTime() // 周三
    const monday = new Date('2026-09-14T00:00:00').getTime()
    const sundayNight = new Date('2026-09-20T23:00:00').getTime()
    const nextMonday = new Date('2026-09-21T00:00:00').getTime()
    expect(isDueThisWeek(base({ dueAt: monday }), now)).toBe(true)
    expect(isDueThisWeek(base({ dueAt: sundayNight }), now)).toBe(true)
    expect(isDueThisWeek(base({ dueAt: nextMonday }), now)).toBe(false)
  })
})

describe('compareTasks', () => {
  const now = new Date('2026-09-14T15:00:00').getTime()
  const startToday = new Date('2026-09-14T00:00:00').getTime()
  test('过期 > 今日 > 其他;同级按优先级、截止时刻、创建时间倒序', () => {
    const overdue = base({ id: 'a', dueAt: startToday - 1 })
    const today = base({ id: 'b', dueAt: startToday + 3600_000 })
    const future = base({ id: 'c', dueAt: startToday + 3 * 86400_000 })
    expect(compareTasks(overdue, today, now)).toBeLessThan(0)
    expect(compareTasks(today, future, now)).toBeLessThan(0)
    const high = base({ id: 'd', priority: 'high' })
    const low = base({ id: 'e', priority: 'low' })
    expect(compareTasks(high, low, now)).toBeLessThan(0)
    expect(TASK_PRIORITY_ORDER.high).toBeLessThan(TASK_PRIORITY_ORDER.medium)
    const earlier = base({ id: 'f', dueAt: 20_000 })
    const later = base({ id: 'g', dueAt: 21_000 })
    expect(compareTasks(earlier, later, now)).toBeLessThan(0)
    const noDue = base({ id: 'h', dueAt: null })
    expect(compareTasks(noDue, earlier, now)).toBeGreaterThan(0)
    const newer = base({ id: 'i', createdAt: 2_000 })
    expect(compareTasks(newer, base({ id: 'j', createdAt: 1_500 }), now)).toBeLessThan(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest --run src/shared/tasks.test.ts`
Expected: FAIL(无法解析 `./tasks`)

- [ ] **Step 3: 实现 src/shared/tasks.ts**

```ts
export type TaskPriority = 'high' | 'medium' | 'low'
export type TaskStatus = 'open' | 'done'
export type TaskRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'

export interface TaskProject {
  id: string
  name: string
  archivedAt?: number
  createdAt: number
}

export interface TaskRecord {
  id: string
  title: string
  note: string
  projectId: string | null
  priority: TaskPriority
  status: TaskStatus
  dueAt: number | null
  remindAt: number | null
  remindFiredAt: number | null
  recurrence: TaskRecurrence
  recurrenceAnchorAt: number | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

export interface TaskCreateInput {
  title: string
  note?: string
  projectId?: string | null
  priority?: TaskPriority
  dueAt?: number | null
  remindAt?: number | null
}

export interface TaskUpdateInput {
  title?: string
  note?: string | null
  projectId?: string | null
  priority?: TaskPriority
  dueAt?: number | null
  remindAt?: number | null
}

export interface TaskListResult {
  open: TaskRecord[]
  done: TaskRecord[]
  totalDone: number
  quarantinedAt: number | null
}

export interface TaskReminderPayload {
  id: string
  title: string
  dueAt: number | null
  priority: TaskPriority
}

export type TasksReminderEvent = { task: TaskReminderPayload } | { backlog: number }

export const TASK_PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }
export const PRIORITY_LABELS: Record<TaskPriority, string> = { high: '高', medium: '中', low: '低' }

export const REMIND_CHOICES = [
  { id: 'due', label: '截止时', offsetMs: 0 },
  { id: 'm30', label: '提前 30 分钟', offsetMs: 30 * 60_000 },
  { id: 'h1', label: '提前 1 小时', offsetMs: 60 * 60_000 },
  { id: 'd1', label: '提前 1 天', offsetMs: 24 * 60 * 60_000 },
  { id: 'none', label: '不提醒', offsetMs: null }
] as const
export type RemindChoiceId = (typeof REMIND_CHOICES)[number]['id']

export function remindAtFromChoice(choiceId: RemindChoiceId, dueAt: number | null): number | null {
  const choice = REMIND_CHOICES.find(item => item.id === choiceId)
  if (!choice || choice.offsetMs === null || dueAt === null || !Number.isFinite(dueAt)) return null
  return dueAt - choice.offsetMs
}

function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function addDays(at: number, days: number): number {
  const date = new Date(at)
  date.setDate(date.getDate() + days)
  return date.getTime()
}

export function isOverdue(task: TaskRecord, now: number): boolean {
  return task.status === 'open' && task.dueAt !== null && task.dueAt < startOfDay(now)
}

export function isDueToday(task: TaskRecord, now: number): boolean {
  if (task.dueAt === null) return false
  const start = startOfDay(now)
  return task.dueAt >= start && task.dueAt < addDays(start, 1)
}

export function isDueThisWeek(task: TaskRecord, now: number): boolean {
  if (task.dueAt === null) return false
  const current = new Date(startOfDay(now))
  const weekday = (current.getDay() + 6) % 7 // 周一为 0
  const monday = addDays(current.getTime(), -weekday)
  return task.dueAt >= monday && task.dueAt < addDays(monday, 7)
}

export function compareTasks(a: TaskRecord, b: TaskRecord, now: number): number {
  const bucket = (task: TaskRecord) => isOverdue(task, now) ? 0 : isDueToday(task, now) ? 1 : 2
  const byBucket = bucket(a) - bucket(b)
  if (byBucket !== 0) return byBucket
  const byPriority = TASK_PRIORITY_ORDER[a.priority] - TASK_PRIORITY_ORDER[b.priority]
  if (byPriority !== 0) return byPriority
  if (a.dueAt !== b.dueAt) {
    if (a.dueAt === null) return 1
    if (b.dueAt === null) return -1
    return a.dueAt - b.dueAt
  }
  return b.createdAt - a.createdAt
}

export interface TasksAPI {
  list(): Promise<TaskListResult>
  create(input: TaskCreateInput): Promise<TaskRecord>
  update(id: string, patch: TaskUpdateInput): Promise<TaskRecord>
  complete(id: string): Promise<TaskRecord>
  remove(id: string): Promise<void>
  projects(): Promise<TaskProject[]>
  createProject(name: string): Promise<TaskProject>
  renameProject(id: string, name: string): Promise<TaskProject>
  archiveProject(id: string, archived: boolean): Promise<TaskProject>
  onTasksReminder(callback: (event: TasksReminderEvent) => void): () => void
  onOpenTasksPanel(callback: () => void): () => void
  onTasksStoreRebuilt(callback: () => void): () => void
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest --run src/shared/tasks.test.ts`
Expected: PASS(3 个 describe 全绿)

- [ ] **Step 5: 提交**

```bash
git add src/shared/tasks.ts src/shared/tasks.test.ts
git commit -m "feat(tasks): add shared task types, sorting and reminder helpers"
```

---

### Task 2: 任务存储 TasksStore

**Files:**
- Create: `src/main/tasks/store.ts`
- Test: `src/main/tasks/store.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/main/tasks/store.test.ts
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openTasksStore } from './store'

const directories: string[] = []
const tempFile = (name: string) => {
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-tasks-'))
  directories.push(directory)
  return join(directory, name)
}
afterEach(() => { for (const directory of directories) rmSync(directory, { recursive: true, force: true }) })

describe('TasksStore', () => {
  test('打开即建表,重复打开保留数据', () => {
    const file = tempFile('tasks.db')
    const store = openTasksStore(file)
    const project = store.createProject('项目 A')
    const task = store.createTask({ title: '  写周报  ', priority: 'high', projectId: project.id })
    expect(task.title).toBe('写周报')
    expect(task.priority).toBe('high')
    expect(task.status).toBe('open')
    expect(task.recurrence).toBe('none')
    store.close()
    const reopened = openTasksStore(file)
    expect(reopened.listTasks().open.map(item => item.title)).toEqual(['写周报'])
    expect(reopened.listProjects().map(item => item.name)).toEqual(['项目 A'])
    reopened.close()
  })

  test('项目名唯一,重命名与归档', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const project = store.createProject('项目 A')
    expect(() => store.createProject('项目 A')).toThrow('同名项目已存在')
    expect(store.renameProject(project.id, ' 项目 B ').name).toBe('项目 B')
    expect(() => store.renameProject('missing', 'x')).toThrow()
    expect(store.archiveProject(project.id, true).archivedAt).toBeGreaterThan(0)
    expect(store.archiveProject(project.id, false).archivedAt).toBeUndefined()
    store.close()
  })

  test('任务输入校验:空标题、非法优先级、未知项目', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    expect(() => store.createTask({ title: '   ' })).toThrow('标题')
    expect(() => store.createTask({ title: 'x', priority: 'urgent' as never })).toThrow('优先级')
    expect(() => store.createTask({ title: 'x', projectId: 'missing' })).toThrow('项目')
    store.close()
  })

  test('更新、完成、删除', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const task = store.createTask({ title: '任务' })
    expect(store.updateTask(task.id, { title: '改名', note: '备注', priority: 'low' }).title).toBe('改名')
    expect(() => store.updateTask('missing', { title: 'x' })).toThrow()
    const done = store.completeTask(task.id)
    expect(done.status).toBe('done')
    expect(done.completedAt).toBeGreaterThan(0)
    const second = store.createTask({ title: '待删' })
    store.deleteTask(second.id)
    expect(store.listTasks().open).toHaveLength(0)
    expect(store.listTasks().done).toHaveLength(1)
    store.close()
  })

  test('完成列表最多返回 50 条并带总数', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    for (let index = 0; index < 55; index += 1) {
      const task = store.createTask({ title: `任务 ${index}` })
      store.completeTask(task.id)
    }
    const result = store.listTasks()
    expect(result.done).toHaveLength(50)
    expect(result.totalDone).toBe(55)
    expect(result.done[0].title).toBe('任务 54')
    store.close()
  })

  test('claimDueReminders 只领取一次且排除已完成/无提醒', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const now = 10_000
    const due = store.createTask({ title: '到期', remindAt: now - 1 })
    const later = store.createTask({ title: '未到', remindAt: now + 5_000 })
    const noRemind = store.createTask({ title: '无提醒' })
    const doneTask = store.createTask({ title: '已完成', remindAt: now - 1 })
    store.completeTask(doneTask.id)
    const first = store.claimDueReminders(now)
    expect(first.map(item => item.id)).toEqual([due.id])
    expect(first[0].remindFiredAt).toBe(now)
    expect(store.claimDueReminders(now + 6_000).map(item => item.id)).toEqual([later.id])
    expect(noRemind.remindAt).toBeNull()
    store.close()
  })

  test('修改提醒时间会重置已触发标记', () => {
    const store = openTasksStore(tempFile('tasks.db'))
    const task = store.createTask({ title: '改期', remindAt: 1_000 })
    expect(store.claimDueReminders(2_000).map(item => item.id)).toEqual([task.id])
    const updated = store.updateTask(task.id, { remindAt: 10_000 })
    expect(updated.remindFiredAt).toBeNull()
    expect(store.claimDueReminders(11_000).map(item => item.id)).toEqual([task.id])
    store.close()
  })

  test('拒绝高于当前支持的数据库版本', () => {
    const file = tempFile('tasks.db')
    const store = openTasksStore(file)
    store.close()
    const Database = (await import('better-sqlite3')).default
    const raw = new Database(file)
    raw.pragma('user_version = 99')
    raw.close()
    expect(() => openTasksStore(file)).toThrow('版本')
  })

  test('损坏文件被隔离并重建空库,WAL 侧文件不残留', () => {
    const file = tempFile('tasks.db')
    writeFileSync(file, 'this is definitely not a sqlite database')
    writeFileSync(`${file}-wal`, 'stale wal')
    writeFileSync(`${file}-shm`, 'stale shm')
    const store = openTasksStore(file)
    const result = store.listTasks()
    expect(result.open).toHaveLength(0)
    expect(result.quarantinedAt).toBeGreaterThan(0)
    store.close()
    const siblings = readdirSync(join(file, '..'))
    expect(siblings.filter(name => name.includes('corrupt')).length).toBeGreaterThan(0)
    expect(siblings.includes('tasks.db-wal')).toBe(false)
    expect(siblings.includes('tasks.db-shm')).toBe(false)
  })

  test('非损坏的打开失败原样抛出,不隔离不重建', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chouyu-tasks-block-'))
    directories.push(directory)
    expect(() => openTasksStore(directory)).toThrow()
  })
})
```

注意:`await import` 必须放在声明为 `async` 的测试里,写成 `test('拒绝…', async () => { ... })`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest --run src/main/tasks/store.test.ts`
Expected: FAIL(找不到 `./store`)

- [ ] **Step 3: 实现 src/main/tasks/store.ts**

```ts
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { existsSync, renameSync } from 'node:fs'
import type {
  TaskCreateInput, TaskListResult, TaskPriority, TaskProject, TaskRecord, TaskUpdateInput
} from '../../shared/tasks'

const SCHEMA_VERSION = 1
const PRIORITIES: TaskPriority[] = ['high', 'medium', 'low']

interface TaskRow {
  id: string; title: string; note: string | null; project_id: string | null; priority: string
  status: string; due_at: number | null; remind_at: number | null; remind_fired_at: number | null
  recurrence: string; recurrence_anchor_at: number | null
  created_at: number; updated_at: number; completed_at: number | null
}
interface ProjectRow { id: string; name: string; archived_at: number | null; created_at: number }

const assertTitle = (title: unknown): string => {
  const value = typeof title === 'string' ? title.trim() : ''
  if (!value) throw new Error('任务标题不能为空。')
  if (value.length > 200) throw new Error('任务标题过长。')
  return value
}
const assertProjectName = (name: unknown): string => {
  const value = typeof name === 'string' ? name.trim() : ''
  if (!value) throw new Error('项目名称不能为空。')
  if (value.length > 50) throw new Error('项目名称过长。')
  return value
}
const assertPriority = (priority: unknown): TaskPriority => {
  if (priority === undefined) return 'medium'
  if (typeof priority === 'string' && PRIORITIES.includes(priority as TaskPriority)) return priority as TaskPriority
  throw new Error('优先级无效。')
}
const assertTimestamp = (value: unknown, label: string): number | null => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}无效。`)
  return Math.round(value)
}
const assertText = (value: unknown, max: number): string | null => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error('文本内容无效。')
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

export class TasksSchemaVersionError extends Error {}

function migrate(database: Database.Database): void {
  database.pragma('journal_mode = WAL')
  database.pragma('synchronous = NORMAL')
  database.pragma('foreign_keys = ON')
  const current = database.pragma('user_version', { simple: true }) as number
  if (current > SCHEMA_VERSION) throw new TasksSchemaVersionError(`任务数据库版本过新（${current}），请先更新应用。`)
  if (current === SCHEMA_VERSION) return
  database.exec(`
    CREATE TABLE IF NOT EXISTS task_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, archived_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, note TEXT,
      project_id TEXT REFERENCES task_projects(id),
      priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'open',
      due_at INTEGER, remind_at INTEGER, remind_fired_at INTEGER,
      recurrence TEXT NOT NULL DEFAULT 'none', recurrence_anchor_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS tasks_status_due ON tasks(status, due_at);
    CREATE INDEX IF NOT EXISTS tasks_remind ON tasks(status, remind_at, remind_fired_at);
  `)
  database.pragma(`user_version = ${SCHEMA_VERSION}`)
}

const toTask = (row: TaskRow): TaskRecord => ({
  id: row.id, title: row.title, note: row.note ?? '', projectId: row.project_id,
  priority: (PRIORITIES.includes(row.priority as TaskPriority) ? row.priority : 'medium') as TaskPriority,
  status: row.status === 'done' ? 'done' : 'open',
  dueAt: row.due_at, remindAt: row.remind_at, remindFiredAt: row.remind_fired_at,
  recurrence: (['daily', 'weekly', 'monthly'].includes(row.recurrence) ? row.recurrence : 'none') as TaskRecord['recurrence'],
  recurrenceAnchorAt: row.recurrence_anchor_at,
  createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at
})
const toProject = (row: ProjectRow): TaskProject => ({
  id: row.id, name: row.name, ...(row.archived_at !== null ? { archivedAt: row.archived_at } : {}), createdAt: row.created_at
})

/** 仅确认的库损坏才允许隔离重建,被锁/磁盘满/权限等其他错误必须原样抛出。 */
const isCorruptionError = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null | undefined)?.code
  return code === 'SQLITE_NOTADB' || code === 'SQLITE_CORRUPT'
}

export class TasksStore {
  readonly quarantinedAt: number | null = null
  private constructor(private readonly database: Database.Database, quarantinedAt: number | null) {
    this.quarantinedAt = quarantinedAt
  }

  static open(filePath: string): TasksStore {
    let database: Database.Database | undefined
    try {
      database = new Database(filePath)
      migrate(database)
      return new TasksStore(database, null)
    } catch (error) {
      try { database?.close() } catch { /* 尽力关闭 */ }
      // 版本过新与非损坏错误原样抛出,只有确认损坏才隔离重建
      if (error instanceof TasksSchemaVersionError || !isCorruptionError(error)) throw error
      const quarantinedAt = Date.now()
      const quarantine = `${filePath}.corrupt-${quarantinedAt}`
      if (existsSync(filePath)) {
        try { renameSync(filePath, quarantine) } catch { /* 隔离失败则直接覆盖重建 */ }
      }
      for (const suffix of ['-wal', '-shm']) {
        const side = `${filePath}${suffix}`
        if (existsSync(side)) {
          try { renameSync(side, `${quarantine}${suffix}`) } catch { /* 尽力隔离侧文件 */ }
        }
      }
      try {
        database = new Database(filePath)
        migrate(database)
      } catch (rebuildError) {
        try { database?.close() } catch { /* 尽力关闭 */ }
        throw rebuildError
      }
      return new TasksStore(database, quarantinedAt)
    }
  }

  close(): void { this.database.close() }

  listProjects(): TaskProject[] {
    const rows = this.database.prepare('SELECT * FROM task_projects ORDER BY created_at').all() as ProjectRow[]
    return rows.map(toProject)
  }

  createProject(name: string): TaskProject {
    const clean = assertProjectName(name)
    const row: ProjectRow = { id: randomUUID(), name: clean, archived_at: null, created_at: Date.now() }
    try {
      this.database.prepare('INSERT INTO task_projects (id, name, archived_at, created_at) VALUES (?, ?, ?, ?)')
        .run(row.id, row.name, row.archived_at, row.created_at)
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error('同名项目已存在。')
      throw error
    }
    return toProject(row)
  }

  renameProject(id: string, name: string): TaskProject {
    const clean = assertProjectName(name)
    const result = this.database.prepare('UPDATE task_projects SET name = ? WHERE id = ?').run(clean, id)
    if (!result.changes) throw new Error('项目不存在。')
    return this.requireProject(id)
  }

  archiveProject(id: string, archived: boolean): TaskProject {
    const result = this.database.prepare('UPDATE task_projects SET archived_at = ? WHERE id = ?')
      .run(archived ? Date.now() : null, id)
    if (!result.changes) throw new Error('项目不存在。')
    return this.requireProject(id)
  }

  private requireProject(id: string): TaskProject {
    const row = this.database.prepare('SELECT * FROM task_projects WHERE id = ?').get(id) as ProjectRow | undefined
    if (!row) throw new Error('项目不存在。')
    return toProject(row)
  }

  private requireActiveProjectId(projectId: unknown): string | null {
    if (projectId === undefined || projectId === null) return null
    if (typeof projectId !== 'string') throw new Error('项目无效。')
    const row = this.database.prepare('SELECT id, archived_at FROM task_projects WHERE id = ?').get(projectId) as { id: string; archived_at: number | null } | undefined
    if (!row || row.archived_at !== null) throw new Error('项目不存在或已归档。')
    return row.id
  }

  createTask(input: TaskCreateInput): TaskRecord {
    const title = assertTitle(input?.title)
    const note = assertText(input?.note, 2_000)
    const projectId = input?.projectId === undefined ? null : this.requireActiveProjectId(input.projectId)
    const priority = assertPriority(input?.priority)
    const dueAt = assertTimestamp(input?.dueAt, '截止时间')
    const remindAt = assertTimestamp(input?.remindAt, '提醒时间')
    const now = Date.now()
    const info = this.database.prepare(`INSERT INTO tasks
      (id, title, note, project_id, priority, status, due_at, remind_at, remind_fired_at, recurrence, recurrence_anchor_at, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, NULL, 'none', NULL, ?, ?, NULL)`)
      .run(randomUUID(), title, note, projectId, priority, dueAt, remindAt, now, now)
    return this.requireTaskByRowid(Number(info.lastInsertRowid))
  }

  private requireTaskByRowid(rowid: number): TaskRecord {
    const row = this.database.prepare('SELECT * FROM tasks WHERE rowid = ?').get(rowid) as TaskRow
    return toTask(row)
  }

  updateTask(id: string, patch: TaskUpdateInput): TaskRecord {
    const current = this.database.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
    if (!current) throw new Error('任务不存在。')
    const title = patch?.title === undefined ? current.title : assertTitle(patch.title)
    const note = patch?.note === undefined ? current.note : assertText(patch.note, 2_000)
    const projectId = patch?.projectId === undefined ? current.project_id : this.requireActiveProjectId(patch.projectId)
    const priority = patch?.priority === undefined ? current.priority : assertPriority(patch.priority)
    const dueAt = patch?.dueAt === undefined ? current.due_at : assertTimestamp(patch.dueAt, '截止时间')
    const remindAt = patch?.remindAt === undefined ? current.remind_at : assertTimestamp(patch.remindAt, '提醒时间')
    const resetFired = patch?.remindAt !== undefined && remindAt !== current.remind_at
    this.database.prepare(`UPDATE tasks SET title = ?, note = ?, project_id = ?, priority = ?, due_at = ?, remind_at = ?, remind_fired_at = ?, updated_at = ? WHERE id = ?`)
      .run(title, note, projectId, priority, dueAt, remindAt, resetFired ? null : current.remind_fired_at, Date.now(), id)
    return this.requireTask(id)
  }

  completeTask(id: string): TaskRecord {
    const now = Date.now()
    const result = this.database.prepare(`UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`).run(now, now, id)
    if (!result.changes) throw new Error('任务不存在或已完成。')
    return this.requireTask(id)
  }

  deleteTask(id: string): void {
    this.database.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  private requireTask(id: string): TaskRecord {
    const row = this.database.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow
    if (!row) throw new Error('任务不存在。')
    return toTask(row)
  }

  listTasks(): TaskListResult {
    const open = (this.database.prepare(`SELECT * FROM tasks WHERE status = 'open' ORDER BY created_at`).all() as TaskRow[]).map(toTask)
    const done = (this.database.prepare(`SELECT * FROM tasks WHERE status = 'done' ORDER BY completed_at DESC LIMIT 50`).all() as TaskRow[]).map(toTask)
    const totalDone = (this.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE status = 'done'`).get() as { count: number }).count
    return { open, done, totalDone, quarantinedAt: this.quarantinedAt }
  }

  /** 原子领取到期提醒:先写 remind_fired_at 再由调用方发通知,保证只发一次。 */
  claimDueReminders(now: number): TaskRecord[] {
    const rows = this.database.prepare(`
      UPDATE tasks SET remind_fired_at = ?
      WHERE status = 'open' AND remind_at IS NOT NULL AND remind_at <= ? AND remind_fired_at IS NULL
      RETURNING *`).all(now, now) as TaskRow[]
    return rows.map(toTask)
  }
}

export function openTasksStore(filePath: string): TasksStore {
  return TasksStore.open(filePath)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest --run src/main/tasks/store.test.ts`
Expected: PASS(10 个测试全绿)

注意:如果「损坏文件被隔离」用例失败,原因通常是 `new Database(file)` 对垃圾字节懒打开成功、`migrate` 才抛错——实现已按「构造+迁移整体 try/catch」处理,隔离文件名以 `.corrupt-` 落盘为准。实测 SQLite close() 会自行删除 -wal/-shm(含损坏库),侧文件 rename 循环是 close 失败时的防御,测试断言的是「重建后原路径无侧文件残留」不变量。

- [ ] **Step 5: 提交**

```bash
git add src/main/tasks/store.ts src/main/tasks/store.test.ts
git commit -m "feat(tasks): add independent SQLite task store with migrations and quarantine"
```

---

### Task 3: 到期调度器

**Files:**
- Create: `src/main/tasks/scheduler.ts`
- Test: `src/main/tasks/scheduler.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/main/tasks/scheduler.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openTasksStore } from './store'
import { startTaskScheduler } from './scheduler'

const directories: string[] = []
const tempFile = () => {
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-scheduler-'))
  directories.push(directory)
  return join(directory, 'tasks.db')
}
afterEach(() => {
  vi.useRealTimers()
  for (const directory of directories) rmSync(directory, { recursive: true, force: true })
})

describe('startTaskScheduler', () => {
  test('启动时到期提醒合并为一条 backlog,不逐条回调', () => {
    vi.useFakeTimers()
    const store = openTasksStore(tempFile())
    store.createTask({ title: '过期一', remindAt: 1 })
    store.createTask({ title: '过期二', remindAt: 2 })
    const reminders: string[] = []
    let backlog = 0
    const scheduler = startTaskScheduler(
      now => store.claimDueReminders(now),
      { onReminder: task => { reminders.push(task.title) }, onBacklog: count => { backlog = count } },
      { intervalMs: 1_000, now: () => Date.now() }
    )
    expect(backlog).toBe(2)
    expect(reminders).toEqual([])
    vi.advanceTimersByTime(2_500)
    expect(reminders).toEqual([])
    scheduler.stop()
    store.close()
  })

  test('运行中到期逐条回调且只发一次', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const store = openTasksStore(tempFile())
    store.createTask({ title: '即将到期', remindAt: 10_500 })
    store.createTask({ title: '更晚', remindAt: 12_000 })
    const reminders: string[] = []
    const scheduler = startTaskScheduler(
      now => store.claimDueReminders(now),
      { onReminder: task => { reminders.push(task.title) }, onBacklog: () => {} },
      { intervalMs: 1_000, now: () => Date.now() }
    )
    vi.advanceTimersByTime(1_000) // 11_000:第一条到期
    expect(reminders).toEqual(['即将到期'])
    vi.advanceTimersByTime(2_000) // 13_000:第二条到期,第一条不重发
    expect(reminders).toEqual(['即将到期', '更晚'])
    vi.advanceTimersByTime(5_000)
    expect(reminders).toEqual(['即将到期', '更晚'])
    scheduler.stop()
    store.close()
  })

  test('领取抛错时不回调且不中断后续 tick', () => {
    vi.useFakeTimers()
    let failures = 0
    let calls = 0
    let healthy = false
    const claim = () => {
      calls += 1
      if (!healthy) { failures += 1; throw new Error('db busy') }
      return []
    }
    const scheduler = startTaskScheduler(claim, { onReminder: () => {}, onBacklog: () => {} }, { intervalMs: 1_000 })
    expect(failures).toBe(1) // 启动积压即失败
    healthy = true
    vi.advanceTimersByTime(1_000)
    expect(failures).toBe(1)
    expect(calls).toBe(2) // 恢复后 tick 仍在执行
    scheduler.stop()
  })

  test('onReminder 抛错不影响同批其余提醒与后续 tick', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const store = openTasksStore(tempFile())
    store.createTask({ title: '第一条', remindAt: 10_500 })
    store.createTask({ title: '第二条', remindAt: 10_600 })
    const seen: string[] = []
    let willThrow = true
    const scheduler = startTaskScheduler(
      now => store.claimDueReminders(now),
      {
        onReminder: task => {
          if (willThrow && task.title === '第一条') { willThrow = false; throw new Error('notify failed') }
          seen.push(task.title)
        },
        onBacklog: () => {}
      },
      { intervalMs: 1_000, now: () => Date.now() }
    )
    vi.advanceTimersByTime(1_000)
    expect(seen).toEqual(['第二条']) // 第一条抛错不吞掉第二条
    vi.advanceTimersByTime(1_000)
    expect(seen).toEqual(['第二条']) // 已领取的不重发
    scheduler.stop()
    store.close()
  })

  test('stop 后不再 tick', () => {
    vi.useFakeTimers()
    const store = openTasksStore(tempFile())
    store.createTask({ title: '稍后', remindAt: Date.now() + 900 })
    const reminders: string[] = []
    const scheduler = startTaskScheduler(
      now => store.claimDueReminders(now),
      { onReminder: task => { reminders.push(task.title) }, onBacklog: () => {} },
      { intervalMs: 1_000, now: () => Date.now() }
    )
    scheduler.stop()
    vi.advanceTimersByTime(5_000)
    expect(reminders).toEqual([])
    store.close()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest --run src/main/tasks/scheduler.test.ts`
Expected: FAIL(找不到 `./scheduler`)

- [ ] **Step 3: 实现 src/main/tasks/scheduler.ts**

```ts
import type { TaskRecord, TaskReminderPayload } from '../../shared/tasks'

export interface TaskSchedulerHandlers {
  onReminder(task: TaskReminderPayload): void
  onBacklog(count: number): void
}

export interface TaskSchedulerOptions {
  intervalMs?: number
  now?(): number
}

const toReminderPayload = (task: TaskRecord): TaskReminderPayload => ({
  id: task.id, title: task.title, dueAt: task.dueAt, priority: task.priority
})

export function startTaskScheduler(
  claim: (now: number) => TaskRecord[],
  handlers: TaskSchedulerHandlers,
  options: TaskSchedulerOptions = {}
): { stop(): void } {
  const intervalMs = options.intervalMs ?? 30_000
  const now = options.now ?? (() => Date.now())
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null

  // 启动积压:应用没开时错过的提醒合并成一条,不逐条轰炸
  let backlog: TaskRecord[] = []
  try {
    backlog = claim(now())
  } catch (error) {
    console.error('tasks scheduler backlog failed:', error)
  }
  if (backlog.length > 0) {
    try { handlers.onBacklog(backlog.length) } catch (error) { console.error('tasks scheduler backlog handler failed:', error) }
  }

  const tick = (): void => {
    if (stopped) return
    let due: TaskRecord[]
    try {
      due = claim(now())
    } catch (error) {
      console.error('tasks scheduler tick failed:', error)
      return
    }
    for (const task of due) {
      try { handlers.onReminder(toReminderPayload(task)) } catch (error) { console.error('tasks scheduler reminder handler failed:', error) }
    }
  }

  timer = setInterval(tick, intervalMs)
  return {
    stop(): void {
      stopped = true
      if (timer !== null) clearInterval(timer)
      timer = null
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest --run src/main/tasks/scheduler.test.ts`
Expected: PASS(5 个测试全绿)

- [ ] **Step 5: 提交**

```bash
git add src/main/tasks/scheduler.ts src/main/tasks/scheduler.test.ts
git commit -m "feat(tasks): add due reminder scheduler with merged backlog"
```

---

### Task 4: 配置开关 + 主进程接线

**Files:**
- Modify: `src/shared/config.ts`(AppConfig 约 77 行、DEFAULT 约 109 行、normalize 约 158 行)
- Create: `src/main/tasks/index.ts`
- Modify: `src/main/index.ts`(initializeJournal 调用后,约 266 行;before-quit 清理,约 336 行;冒烟链约 250 行)

- [ ] **Step 1: AppConfig 增加 taskNotifications**

`src/shared/config.ts` 接口(与 `proactiveRestReminder: boolean` 相邻)加:

```ts
  taskNotifications: boolean
```

`DEFAULT_APP_CONFIG`(与 `proactiveRestReminder: true` 相邻)加:

```ts
  taskNotifications: true,
```

`normalizeConfig` 返回对象(与 `proactiveRestReminder: source.proactiveRestReminder !== false` 相邻)加:

```ts
    taskNotifications: source.taskNotifications !== false,
```

`sanitizeConfigPatch`(与 `proactiveRestReminder` 白名单行相邻)加:

```ts
  if (typeof input.taskNotifications === 'boolean') patch.taskNotifications = input.taskNotifications
```

并在 `src/shared/config.test.ts` 的「accepts only known patch fields」用例 input 里加 `taskNotifications: false,`、断言 `patch.taskNotifications` 为 `false`(否则 T8 设置页保存的开关会被 sanitize 静默丢弃)。

- [ ] **Step 2: 实现 src/main/tasks/index.ts**

```ts
import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import { join } from 'node:path'
import { openTasksStore, type TasksStore } from './store'
import { startTaskScheduler } from './scheduler'

let store: TasksStore | undefined
let scheduler: { stop(): void } | undefined
let shuttingDown = false
let storeRebuilt = false
let pendingBacklog = 0
let readyDelivered = false

const broadcast = (channel: string, payload?: unknown): void => {
  if (shuttingDown) return
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

export interface TasksModuleOptions {
  notificationsEnabled(): boolean
  openTasksWorkspace(): void
}

export function initializeTasks(options: TasksModuleOptions): void {
  if (store) return
  shuttingDown = false
  store = openTasksStore(join(app.getPath('userData'), 'tasks.db'))
  if (store.quarantinedAt) storeRebuilt = true
  scheduler = startTaskScheduler(
    now => store!.claimDueReminders(now),
    {
      onBacklog: count => { pendingBacklog = count },
      onReminder: task => {
        if (options.notificationsEnabled() && Notification.isSupported()) {
          try {
            const notification = new Notification({ title: '任务提醒', body: task.title })
            notification.on('click', () => options.openTasksWorkspace())
            notification.show()
          } catch { /* 显示失败不阻塞消息中心留档 */ }
        }
        broadcast('tasks:reminder', { task })
      }
    }
  )
  ipcMain.handle('tasks:list', () => store!.listTasks())
  ipcMain.handle('tasks:create', (_event, input) => store!.createTask(input ?? {}))
  ipcMain.handle('tasks:update', (_event, id: string, patch) => store!.updateTask(id, patch ?? {}))
  ipcMain.handle('tasks:complete', (_event, id: string) => store!.completeTask(id))
  ipcMain.handle('tasks:delete', (_event, id: string) => store!.deleteTask(id))
  ipcMain.handle('tasks:projects', () => store!.listProjects())
  ipcMain.handle('tasks:createProject', (_event, name: string) => store!.createProject(name))
  ipcMain.handle('tasks:renameProject', (_event, id: string, name: string) => store!.renameProject(id, name))
  ipcMain.handle('tasks:archiveProject', (_event, id: string, archived: boolean) => store!.archiveProject(id, archived))
  // initializeTasks 在 createWindow 之前执行,启动期事件必须暂存,等渲染端 ready 后一次性投递
  ipcMain.on('tasks:ready', () => {
    if (readyDelivered) return
    readyDelivered = true
    if (storeRebuilt) broadcast('tasks:store-rebuilt')
    if (pendingBacklog > 0) broadcast('tasks:reminder', { backlog: pendingBacklog })
  })
}

export function closeTasks(): void {
  shuttingDown = true
  for (const channel of ['tasks:list', 'tasks:create', 'tasks:update', 'tasks:complete', 'tasks:delete', 'tasks:projects', 'tasks:createProject', 'tasks:renameProject', 'tasks:archiveProject']) ipcMain.removeHandler(channel)
  ipcMain.removeAllListeners('tasks:ready')
  storeRebuilt = false
  pendingBacklog = 0
  readyDelivered = false
  scheduler?.stop()
  scheduler = undefined
  try { store?.close() } catch { /* 退出路径上尽力关闭 */ }
  store = undefined
}
```

- [ ] **Step 3: 接入 src/main/index.ts**

顶部 journal import 旁加:

```ts
import { initializeTasks, closeTasks } from './tasks'
import { runTasksSmoke } from './smoke/tasks-smoke'
```

冒烟链:`await runJournalMigrationSmoke()` 之后加一行:

```ts
      await runTasksSmoke()
```

`initializeJournal({...})` 调用块之后加(与 journal 的 openWorkspace 回调同构):

```ts
  initializeTasks({
    notificationsEnabled: () => getConfig().taskNotifications !== false,
    openTasksWorkspace: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('open-tasks-panel')
    }
  })
```

`before-quit` 最终清理行(`stopClipboardWatcher()` 处)改为:

```ts
  stopClipboardWatcher()
  closeTasks()
  closeMemory()
```

- [ ] **Step 4: 冒烟文件先建占位**

`src/main/smoke/tasks-smoke.ts`(Task 9 会补全断言,先让它可编译、可跑通空数据):

```ts
import { app } from 'electron'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openTasksStore } from '../tasks/store'

export async function runTasksSmoke(): Promise<void> {
  const file = join(app.getPath('userData'), 'tasks-smoke.db')
  try { rmSync(file, { force: true }) } catch { /* 首次运行没有旧文件 */ }
  const store = openTasksStore(file)
  try {
    if (store.listTasks().open.length !== 0) throw new Error('Tasks smoke fixture is not empty')
    console.log('CHOUYU_TASKS_SMOKE_PASSED placeholder')
  } finally { store.close() }
}
```

(Task 9 会用完整断言替换此占位;先保证 `npm run test:smoke` 能通过空库路径。)

- [ ] **Step 5: 类型检查 + 全量单测**

Run: `npm run typecheck`
Expected: PASS(无输出)

Run: `npx vitest --run`
Expected: 全部 PASS(既有 450+ 与新增用例)

- [ ] **Step 6: 提交**

```bash
git add src/shared/config.ts src/main/tasks/index.ts src/main/index.ts src/main/smoke/tasks-smoke.ts
git commit -m "feat(tasks): wire task module into main process lifecycle and config"
```

---

### Task 5: preload 与渲染端类型

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/shared/types.ts`
- Modify: `src/shared/tasks.ts`(TasksAPI 加 ready)

- [ ] **Step 0: TasksAPI 加 ready**

`src/shared/tasks.ts` 的 `TasksAPI` 接口里加:

```ts
  ready(): void
```

(渲染端挂载完成后调用,通知主进程可以投递暂存的启动期任务事件。)

- [ ] **Step 1: preload 增加 tasks 命名空间**

`src/preload/index.ts` 顶部加 import:

```ts
import type { TasksAPI, TasksReminderEvent } from '../shared/tasks'
```

`const api = {` 内 `journal: {...} satisfies JournalAPI,` 之后加:

```ts
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    create: input => ipcRenderer.invoke('tasks:create', input),
    update: (id, patch) => ipcRenderer.invoke('tasks:update', id, patch),
    complete: id => ipcRenderer.invoke('tasks:complete', id),
    remove: id => ipcRenderer.invoke('tasks:delete', id),
    projects: () => ipcRenderer.invoke('tasks:projects'),
    createProject: name => ipcRenderer.invoke('tasks:createProject', name),
    renameProject: (id, name) => ipcRenderer.invoke('tasks:renameProject', id, name),
    archiveProject: (id, archived) => ipcRenderer.invoke('tasks:archiveProject', id, archived),
    ready: () => { ipcRenderer.send('tasks:ready') },
    onTasksReminder: callback => {
      const handler = (_event: unknown, payload: TasksReminderEvent) => callback(payload)
      ipcRenderer.on('tasks:reminder', handler)
      return () => { ipcRenderer.removeListener('tasks:reminder', handler) }
    },
    onOpenTasksPanel: callback => {
      ipcRenderer.on('open-tasks-panel', callback)
      return () => { ipcRenderer.removeListener('open-tasks-panel', callback) }
    },
    onTasksStoreRebuilt: callback => {
      ipcRenderer.on('tasks:store-rebuilt', callback)
      return () => { ipcRenderer.removeListener('tasks:store-rebuilt', callback) }
    }
  } satisfies TasksAPI,
```

- [ ] **Step 2: ElectronAPI 镜像**

`src/renderer/src/shared/types.ts` 的 `ElectronAPI` 接口内(与 `journal` 同级,`memory` 之前)加一行,与 journal 的内联 import 类型惯例完全同构(不手写镜像,避免与 TasksAPI 漂移):

```ts
  tasks: import('../../../shared/tasks').TasksAPI
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: PASS。若 preload 参数隐式 any 报错,给形参补类型(`input: TaskCreateInput` 等,以 `satisfies TasksAPI` 的上下文类型为准)。

- [ ] **Step 4: 提交**

```bash
git add src/preload/index.ts src/renderer/src/shared/types.ts
git commit -m "feat(tasks): expose tasks API over preload bridge"
```

---

### Task 6: ProactiveEngine 支持 task 类型

**Files:**
- Modify: `src/renderer/src/core/proactive.ts`
- Test: `src/renderer/src/core/proactive.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/renderer/src/core/proactive.test.ts
import { describe, expect, test } from 'vitest'
import { ProactiveEngine } from './proactive'

describe('ProactiveEngine.postExternal', () => {
  test('外部消息绕过冷却直接入列并回调,最新在前', () => {
    const engine = new ProactiveEngine()
    const seen: Array<{ message: string; kind?: string }> = []
    engine.start((message, kind) => { seen.push({ message, kind }) }, { greeting: false, restReminder: false })
    engine.postExternal('任务提醒：写周报', 'task')
    engine.postExternal('错过了 2 条任务提醒', 'task')
    const messages = engine.getMessages()
    expect(messages).toHaveLength(2)
    expect(messages[0].message).toBe('错过了 2 条任务提醒')
    expect(messages.every(item => item.kind === 'task')).toBe(true)
    expect(seen).toHaveLength(2)
    expect(seen.every(item => item.kind === 'task')).toBe(true)
    engine.stop()
  })

  test('postExternal 消息可被 hydrateMessages 保留', () => {
    const engine = new ProactiveEngine()
    engine.start(() => {}, { greeting: false, restReminder: false })
    engine.postExternal('任务提醒：写周报', 'task')
    const snapshot = engine.getMessages()
    engine.hydrateMessages(snapshot)
    expect(engine.getMessages()[0].message).toBe('任务提醒：写周报')
    engine.stop()
  })
})
```

注意:`proactive.ts` 目前导出的是单例 `proactiveEngine`;需要把 class 也导出(`export class ProactiveEngine`),单例保留。`start` 的回调签名是 `(message: string, kind?: ProactiveKind) => void`,测试里第二个参数忽略即可。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest --run src/renderer/src/core/proactive.test.ts`
Expected: FAIL(`postExternal is not a function` / `ProactiveEngine` 未导出)

- [ ] **Step 3: 修改 src/renderer/src/core/proactive.ts**

`export type ProactiveKind = 'greeting' | 'rest' | 'return'` 改为:

```ts
export type ProactiveKind = 'greeting' | 'rest' | 'return' | 'task'
```

`class ProactiveEngine` 改为 `export class ProactiveEngine`;`speak()` 里「unshift 消息 + persistMessages」两行抽成私有方法(放在 `speak` 之前),`speak` 与新方法共用:

```ts
  private enqueue(message: string, kind: ProactiveKind): void {
    this.messages.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, message, createdAt: Date.now(), kind })
    this.persistMessages()
  }
```

并在 `speak` 方法旁新增公开方法:

```ts
  /** 外部注入的确定性提醒(任务到期),不受 60 分钟冷却限制。 */
  postExternal(message: string, kind: ProactiveKind = 'task'): void {
    this.enqueue(message, kind)
    this.callback?.(message, kind)
  }
```

文件尾部保留 `export const proactiveEngine = new ProactiveEngine()`。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest --run src/renderer/src/core/proactive.test.ts`
Expected: PASS(2 个测试)

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/core/proactive.ts src/renderer/src/core/proactive.test.ts
git commit -m "feat(tasks): let proactive engine accept external task reminders"
```

---

### Task 7: 任务页 UI

**Files:**
- Create: `src/renderer/src/components/Tasks/TasksView.tsx`
- Create: `src/renderer/src/components/Tasks/Tasks.css`
- Test: `src/renderer/src/components/Tasks/Tasks.regression.test.ts`
- Modify: `src/renderer/src/components/Workspace/WorkspaceNav.tsx`
- Modify: `src/renderer/src/components/ChatPanel/ChatPanel.tsx`(import 区 + journal section 之后,约 745 行)

- [ ] **Step 1: 写源守卫失败测试**

```ts
// src/renderer/src/components/Tasks/Tasks.regression.test.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('Tasks 视图源守卫', () => {
  test('键盘与可达性:表单原生提交、Esc 取消、行内按钮 aria-label、列表 role', () => {
    const source = read('TasksView.tsx')
    expect(source).toContain('onSubmit={submitDraft}')
    expect(source).toContain("key === 'Escape'")
    expect(source).toContain('aria-label')
    expect(source).toContain('role="list"')
    expect(source).toContain('data-priority')
    expect(source).not.toContain('window.prompt')
    expect(source).toContain('tasks-new-project-form')
    expect(source).toContain('remindChoiceFromTask')
  })
  test('样式:使用全局 token、窄屏断点与减少动画', () => {
    const css = read('Tasks.css')
    for (const token of ['--bg-secondary', '--text-primary', '--border', '--accent', '--focus-ring']) {
      expect(css).toContain(`var(${token}`)
    }
    expect(css).toContain('max-width:')
    expect(css).toContain('prefers-reduced-motion')
  })
  test('导航注册 tasks 页', () => {
    const nav = read('../Workspace/WorkspaceNav.tsx')
    expect(nav).toContain("'tasks'")
    expect(nav).toContain('任务')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest --run src/renderer/src/components/Tasks/Tasks.regression.test.ts`
Expected: FAIL(文件不存在)

- [ ] **Step 3: 实现 TasksView.tsx**

```tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { RemindChoiceId, TaskPriority, TaskProject, TaskRecord } from '../../../../shared/tasks'
import {
  PRIORITY_LABELS, REMIND_CHOICES, compareTasks, isDueThisWeek, isDueToday, isOverdue, remindAtFromChoice
} from '../../../../shared/tasks'
import './Tasks.css'

type SmartView = 'today' | 'week' | 'overdue' | 'all'
type Selection = SmartView | `project:${string}`

const SMART_VIEWS: { id: SmartView; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'week', label: '本周' },
  { id: 'overdue', label: '过期' },
  { id: 'all', label: '全部' }
]

interface Draft {
  id: string
  title: string
  note: string
  projectId: string
  priority: TaskPriority
  dueDate: string
  dueTime: string
  remind: RemindChoiceId
}

const emptyDraft: Draft = { id: '', title: '', note: '', projectId: '', priority: 'medium', dueDate: '', dueTime: '09:00', remind: 'due' }

const toInputDate = (at: number): string => {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const draftDueAt = (draft: Draft): number | null => {
  if (!draft.dueDate) return null
  return new Date(`${draft.dueDate}T${draft.dueTime || '09:00'}`).getTime() || null
}
const remindChoiceFromTask = (task: TaskRecord): RemindChoiceId => {
  if (task.remindAt === null || task.dueAt === null) return 'none'
  for (const choice of REMIND_CHOICES) {
    if (remindAtFromChoice(choice.id, task.dueAt) === task.remindAt) return choice.id
  }
  return 'none'
}
const draftFromTask = (task: TaskRecord): Draft => ({
  id: task.id,
  title: task.title,
  note: task.note,
  projectId: task.projectId ?? '',
  priority: task.priority,
  dueDate: task.dueAt ? toInputDate(task.dueAt) : '',
  dueTime: task.dueAt ? new Date(task.dueAt).toTimeString().slice(0, 5) : '09:00',
  remind: remindChoiceFromTask(task)
})
const dueLabel = (at: number): string =>
  new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at)

export default function TasksView({ active }: { active: boolean }) {
  const [selection, setSelection] = useState<Selection>('today')
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [doneTasks, setDoneTasks] = useState<TaskRecord[]>([])
  const [totalDone, setTotalDone] = useState(0)
  const [projects, setProjects] = useState<TaskProject[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [quarantineNotice, setQuarantineNotice] = useState('')
  const [newProject, setNewProject] = useState<string | null>(null)

  const reload = useCallback(() => {
    void Promise.all([window.electronAPI.tasks.list(), window.electronAPI.tasks.projects()])
      .then(([list, projectList]) => {
        setTasks(list.open)
        setDoneTasks(list.done)
        setTotalDone(list.totalDone)
        setProjects(projectList)
        setQuarantineNotice(list.quarantinedAt ? '任务数据文件曾无法读取，已重建空库，原文件已隔离保存。' : '')
      })
      .catch(reason => setError(String(reason)))
  }, [])

  useEffect(() => { if (active) reload() }, [active, reload])

  const visible = tasks.filter(task => {
    if (selection.startsWith('project:')) return task.projectId === selection.slice('project:'.length)
    if (selection === 'today') return isDueToday(task, Date.now()) || isOverdue(task, Date.now())
    if (selection === 'week') return isDueThisWeek(task, Date.now())
    if (selection === 'overdue') return isOverdue(task, Date.now())
    return true
  }).sort((a, b) => compareTasks(a, b, Date.now()))

  const submitDraft = (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    const title = draft.title.trim()
    if (!title) { setError('任务标题不能为空。'); return }
    const dueAt = draftDueAt(draft)
    const remindAt = remindAtFromChoice(draft.remind, dueAt)
    setBusy(true); setError('')
    const request = draft.id
      ? window.electronAPI.tasks.update(draft.id, { title, note: draft.note, projectId: draft.projectId || null, priority: draft.priority, dueAt, remindAt })
      : window.electronAPI.tasks.create({ title, note: draft.note, projectId: draft.projectId || null, priority: draft.priority, dueAt, remindAt })
    void request
      .then(() => { setDraft(null); reload() })
      .catch(reason => setError(String(reason)))
      .finally(() => setBusy(false))
  }

  const complete = (id: string) => {
    void window.electronAPI.tasks.complete(id).then(reload).catch(reason => setError(String(reason)))
  }
  const remove = (id: string) => {
    if (!window.confirm('删除这个任务？此操作无法撤销。')) return
    void window.electronAPI.tasks.remove(id).then(reload).catch(reason => setError(String(reason)))
  }
  const submitProject = (event: FormEvent) => {
    event.preventDefault()
    const name = newProject?.trim()
    setNewProject(null)
    if (!name) return
    void window.electronAPI.tasks.createProject(name).then(reload).catch(reason => setError(String(reason)))
  }

  return <div className="tasks-view">
    <aside className="tasks-sidebar" aria-label="任务视图筛选">
      <ul role="list">
        {SMART_VIEWS.map(view => <li key={view.id}>
          <button type="button" aria-current={selection === view.id || undefined} onClick={() => setSelection(view.id)}>{view.label}</button>
        </li>)}
      </ul>
      <div className="tasks-sidebar-projects">
        <h2>项目</h2>
        <ul role="list">
          {projects.filter(project => !project.archivedAt).map(project => {
            const id = `project:${project.id}` as Selection
            return <li key={project.id}>
              <button type="button" aria-current={selection === id || undefined} onClick={() => setSelection(id)}>{project.name}</button>
            </li>
          })}
          {newProject === null
            ? <li><button type="button" className="tasks-new-project" onClick={() => setNewProject('')}>新建项目 +</button></li>
            : <li>
                <form className="tasks-new-project-form" onSubmit={submitProject}>
                  <input value={newProject} autoFocus aria-label="新项目名称" placeholder="项目名称"
                    onChange={e => setNewProject(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') setNewProject(null) }} />
                </form>
              </li>}
        </ul>
        {projects.some(project => project.archivedAt) && <details className="tasks-archived">
          <summary>已归档项目</summary>
          <ul role="list">{projects.filter(project => project.archivedAt).map(project => <li key={project.id}>{project.name}</li>)}</ul>
        </details>}
      </div>
    </aside>

    <section className="tasks-main" aria-label="任务列表">
      {quarantineNotice && <p role="alert" className="tasks-quarantine">{quarantineNotice}</p>}
      {error && <p role="alert" className="tasks-error">{error}</p>}
      <div className="tasks-toolbar">
        <p>{visible.length} 个进行中{totalDone > 0 ? ` · ${totalDone} 个已完成` : ''}</p>
        <button type="button" className="tasks-create" onClick={() => setDraft({ ...emptyDraft })}>新建任务</button>
      </div>

      {visible.length === 0 && !draft && <div className="tasks-empty">
        <h2>{selection.startsWith('project:') ? '这个项目还没有任务' : '这里没有待办任务'}</h2>
        <p>点击「新建任务」开始,支持截止日、提醒和优先级。</p>
      </div>}

      {draft && <form className="tasks-form" onSubmit={submitDraft} aria-label={draft.id ? '编辑任务' : '新建任务'}>
        <label>
          标题
          <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={e => { if (e.key === 'Escape') setDraft(null) }}
            autoFocus aria-label="任务标题" placeholder="要做什么？" />
        </label>
        <label>
          备注
          <textarea value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })}
            onKeyDown={e => { if (e.key === 'Escape') setDraft(null) }}
            aria-label="任务备注" rows={2} />
        </label>
        <div className="tasks-form-row">
          <label>
            项目
            <select value={draft.projectId} onChange={e => setDraft({ ...draft, projectId: e.target.value })} aria-label="任务项目">
              <option value="">不归属项目</option>
              {projects.filter(project => !project.archivedAt).map(project =>
                <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>
            优先级
            <select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as TaskPriority })} aria-label="任务优先级">
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </label>
        </div>
        <div className="tasks-form-row">
          <label>
            截止日期
            <input type="date" value={draft.dueDate} onChange={e => setDraft({ ...draft, dueDate: e.target.value })} aria-label="任务截止日期" />
          </label>
          <label>
            时间
            <input type="time" value={draft.dueTime} onChange={e => setDraft({ ...draft, dueTime: e.target.value })} aria-label="任务截止时间" />
          </label>
          <label>
            提醒
            <select value={draft.remind} onChange={e => setDraft({ ...draft, remind: e.target.value as RemindChoiceId })}
              disabled={!draft.dueDate} aria-label="任务提醒">
              {REMIND_CHOICES.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
            </select>
          </label>
        </div>
        <div className="tasks-form-actions">
          <button type="submit" disabled={busy}>{draft.id ? '保存' : '创建'}</button>
          <button type="button" onClick={() => setDraft(null)}>取消</button>
        </div>
      </form>}

      <ul role="list" className="tasks-list">
        {visible.map(task => <li key={task.id} className="tasks-item" data-priority={task.priority}>
          <button type="button" className="tasks-complete" aria-label={`完成 ${task.title}`} onClick={() => complete(task.id)} />
          <div className="tasks-item-body">
            <span className="tasks-item-title">{task.title}</span>
            <span className="tasks-item-meta">
              {projects.find(project => project.id === task.projectId)?.name}
              {task.dueAt !== null && <span className={isOverdue(task, Date.now()) ? 'tasks-overdue' : ''}>
                {isOverdue(task, Date.now()) ? '已过期 · ' : ''}{dueLabel(task.dueAt)}
              </span>}
              <span>{PRIORITY_LABELS[task.priority]}优先</span>
            </span>
            {task.note && <span className="tasks-item-note">{task.note}</span>}
          </div>
          <div className="tasks-item-actions">
            <button type="button" onClick={() => setDraft(draftFromTask(task))} aria-label={`编辑 ${task.title}`}>编辑</button>
            <button type="button" onClick={() => remove(task.id)} aria-label={`删除 ${task.title}`}>删除</button>
          </div>
        </li>)}
      </ul>

      {doneTasks.length > 0 && <div className="tasks-done">
        <button type="button" aria-expanded={showDone} onClick={() => setShowDone(value => !value)}>
          已完成 {doneTasks.length} 项 {showDone ? '收起' : '展开'}
        </button>
        {showDone && <ul role="list" className="tasks-list tasks-list-done">
          {doneTasks.map(task => <li key={task.id} className="tasks-item" data-priority={task.priority}>
            <span className="tasks-item-title tasks-item-done-title">{task.title}</span>
            <span className="tasks-item-meta">{task.completedAt ? dueLabel(task.completedAt) + ' 完成' : ''}</span>
          </li>)}
        </ul>}
      </div>}
    </section>
  </div>
}
```

- [ ] **Step 4: 实现 Tasks.css**

```css
.tasks-view {
  display: flex;
  gap: 16px;
  height: 100%;
  min-width: 0;
  padding: 16px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.tasks-sidebar { width: 168px; flex: none; display: flex; flex-direction: column; gap: 16px; }
.tasks-sidebar ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.tasks-sidebar button {
  appearance: none; border: none; background: none; text-align: left;
  padding: 6px 10px; border-radius: 8px; color: var(--text-secondary); cursor: pointer;
  font-size: 13px;
}
.tasks-sidebar button:hover { background: var(--hover-bg); color: var(--text-primary); }
.tasks-sidebar button[aria-current] { background: var(--hover-bg); color: var(--accent); font-weight: 600; }
.tasks-sidebar h2 { font-size: 12px; color: var(--text-muted); margin: 0 0 6px; font-weight: 500; }
.tasks-new-project { color: var(--text-muted) !important; }
.tasks-archived summary { font-size: 12px; color: var(--text-muted); cursor: pointer; padding: 6px 10px; }
.tasks-archived li { font-size: 12px; color: var(--text-muted); padding: 4px 10px; }
.tasks-new-project-form input {
  font: inherit; font-size: 12px; color: var(--text-primary);
  background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 6px; padding: 4px 8px; width: 100%;
}
.tasks-new-project-form input:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }

.tasks-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
.tasks-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tasks-toolbar p { margin: 0; font-size: 13px; color: var(--text-secondary); }
.tasks-create {
  appearance: none; border: 1px solid var(--border); background: var(--accent); color: var(--on-accent);
  border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer;
}
.tasks-create:hover { background: var(--accent-hover); }
.tasks-error, .tasks-quarantine { margin: 0; padding: 8px 12px; border-radius: 8px; font-size: 13px; }
.tasks-error { color: var(--error); border: 1px solid var(--error-border); }
.tasks-quarantine { color: var(--text-secondary); border: 1px solid var(--border); }
.tasks-empty { border: 1px dashed var(--border); border-radius: 12px; padding: 32px; text-align: center; color: var(--text-secondary); }
.tasks-empty h2 { font-size: 15px; margin: 0 0 6px; color: var(--text-primary); }
.tasks-empty p { margin: 0; font-size: 13px; }

.tasks-form {
  display: flex; flex-direction: column; gap: 10px;
  border: 1px solid var(--border); border-radius: 12px; padding: 12px; background: var(--bg-secondary);
}
.tasks-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); }
.tasks-form input, .tasks-form textarea, .tasks-form select {
  font: inherit; font-size: 13px; color: var(--text-primary);
  background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 8px; padding: 6px 10px;
}
.tasks-form input:focus-visible, .tasks-form textarea:focus-visible, .tasks-form select:focus-visible,
.tasks-form button:focus-visible, .tasks-view button:focus-visible {
  outline: 2px solid var(--focus-ring); outline-offset: 1px;
}
.tasks-form-row { display: flex; gap: 10px; flex-wrap: wrap; }
.tasks-form-row label { flex: 1; min-width: 120px; }
.tasks-form-actions { display: flex; gap: 8px; }
.tasks-form-actions button {
  appearance: none; border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer;
  border: 1px solid var(--border); background: var(--bg-primary); color: var(--text-primary);
}
.tasks-form-actions button[type='submit'] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.tasks-form-actions button[type='submit']:disabled { opacity: 0.6; cursor: default; }

.tasks-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.tasks-item {
  display: flex; align-items: flex-start; gap: 10px;
  border: 1px solid var(--border); border-left: 3px solid var(--border); border-radius: 10px;
  padding: 10px 12px; background: var(--bg-primary);
}
.tasks-item[data-priority='high'] { border-left-color: var(--error); }
.tasks-item[data-priority='medium'] { border-left-color: var(--accent); }
.tasks-item[data-priority='low'] { border-left-color: var(--border); }
.tasks-complete {
  appearance: none; flex: none; width: 18px; height: 18px; margin-top: 2px;
  border: 1.5px solid var(--border); border-radius: 50%; background: none; cursor: pointer;
}
.tasks-complete:hover { border-color: var(--success); background: var(--hover-bg); }
.tasks-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.tasks-item-title { font-size: 14px; color: var(--text-primary); overflow-wrap: anywhere; }
.tasks-item-done-title { color: var(--text-muted); text-decoration: line-through; }
.tasks-item-meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--text-muted); }
.tasks-overdue { color: var(--error); }
.tasks-item-note { font-size: 12px; color: var(--text-secondary); overflow-wrap: anywhere; }
.tasks-item-actions { display: flex; gap: 6px; flex: none; }
.tasks-item-actions button {
  appearance: none; border: none; background: none; color: var(--text-muted);
  font-size: 12px; cursor: pointer; padding: 2px 6px; border-radius: 6px;
}
.tasks-item-actions button:hover { background: var(--hover-bg); color: var(--text-primary); }
.tasks-done > button {
  appearance: none; border: none; background: none; color: var(--text-secondary);
  font-size: 13px; cursor: pointer; padding: 6px 0;
}
.tasks-list-done { opacity: 0.75; }

@media (max-width: 640px) {
  .tasks-view { flex-direction: column; padding: 10px; gap: 10px; }
  .tasks-sidebar { width: auto; flex-direction: row; align-items: center; overflow-x: auto; }
  .tasks-sidebar ul { flex-direction: row; flex-wrap: nowrap; }
  .tasks-sidebar-projects { display: flex; align-items: center; gap: 8px; }
  .tasks-sidebar-projects ul { flex-direction: row; }
}

@media (prefers-reduced-motion: reduce) {
  .tasks-view *, .tasks-view *::before, .tasks-view *::after { transition: none !important; animation: none !important; }
}
```

- [ ] **Step 5: 注册导航与挂载**

`src/renderer/src/components/Workspace/WorkspaceNav.tsx`:

```ts
export type WorkspacePage = 'chat' | 'tasks' | 'journal' | 'memory' | 'settings'
```

`pages` 数组 `chat` 项后插入:

```ts
  { id: 'tasks', label: '任务', path: 'M4 6l2 2 3-3M4 12l2 2 3-3M4 18l2 2 3-3M12 6h8M12 12h8M12 18h8' },
```

`src/renderer/src/components/ChatPanel/ChatPanel.tsx` import 区加:

```ts
import TasksView from '../Tasks/TasksView'
```

journal 的 `<section className="workspace-page workspace-journal" ...>` 之后加:

```tsx
        <section className="workspace-page workspace-tasks" hidden={activePage !== 'tasks'} aria-label="任务工作区">
          {visitedPages.tasks && <>
            <TasksView active={visible && activePage === 'tasks'} />
          </>}
        </section>
```

- [ ] **Step 6: 运行测试与类型检查**

Run: `npx vitest --run src/renderer/src/components/Tasks/Tasks.regression.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS(`FormEvent` 已在 import 中显式引入;若 `Selection` 未使用报错则删除该类型别名并直接内联 `` `project:${string}` ``)。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/components/Tasks src/renderer/src/components/Workspace/WorkspaceNav.tsx src/renderer/src/components/ChatPanel/ChatPanel.tsx
git commit -m "feat(tasks): add tasks workspace page with list, form and smart views"
```

---

### Task 8: App 接线、消息中心点击与设置开关

**Files:**
- Modify: `src/renderer/src/App.tsx`(journal 打开效果旁约 329 行;proactive 效果约 129 行)
- Modify: `src/renderer/src/components/ProactiveCenter/ProactiveCenter.tsx`
- Modify: `src/renderer/src/components/Settings/Settings.tsx`(久坐提醒卡片后约 680 行)

- [ ] **Step 1: App.tsx 增加打开任务页与提醒订阅**

`openSettings` 回调之后(journal 面板 effect 之前)加:

```ts
  const openTasksPage = useCallback(() => {
    ensurePanelPosition()
    setPanelVisible(true)
    setPanelInitialized(true)
    setShowSettings(false)
    setWorkspaceRequest(previous => ({ page: 'tasks', id: previous.id + 1 }))
    window.focus()
  }, [ensurePanelPosition])

  useEffect(() => window.electronAPI.tasks.onOpenTasksPanel(openTasksPage), [openTasksPage])

  useEffect(() => {
    const cleanup = window.electronAPI.tasks.onTasksReminder(payload => {
      if ('task' in payload) proactiveEngine.postExternal(`任务提醒：${payload.task.title}`, 'task')
      else if (payload.backlog > 0) proactiveEngine.postExternal(`错过了 ${payload.backlog} 条任务提醒`, 'task')
    })
    const rebuiltCleanup = window.electronAPI.tasks.onTasksStoreRebuilt(() => {
      proactiveEngine.postExternal('任务数据文件无法读取，已重建空库，原文件已隔离保存。', 'task')
    })
    window.electronAPI.tasks.ready()
    return () => { cleanup(); rebuiltCleanup() }
  }, [])
```

`ProactiveCenter` 调用处(props 列表)加:

```tsx
          onOpenTask={() => { setShowProactiveCenter(false); openTasksPage() }}
```

说明:`postExternal` 会触发 `proactiveEngine.start` 注册的回调,消息中心列表、气泡与持久化复用现有链路,无需新状态。

- [ ] **Step 2: ProactiveCenter 支持任务条目点击**

Props 接口加:

```ts
  onOpenTask?: () => void
```

解构参数加 `onOpenTask`,消息渲染处把 `<p>{item.message}</p>` 替换为:

```tsx
            {item.kind === 'task' && onOpenTask ? (
              <button type="button" className="proactive-center-task-link" onClick={onOpenTask}>{item.message}</button>
            ) : (
              <p>{item.message}</p>
            )}
```

`ProactiveCenter.css` 加:

```css
.proactive-center-task-link {
  appearance: none; border: none; background: none; padding: 0; margin: 0;
  text-align: left; font: inherit; color: var(--accent); cursor: pointer;
}
.proactive-center-item > .proactive-center-task-link { display: block; margin-top: var(--space-3); font-size: var(--font-md); line-height: var(--leading-normal); white-space: pre-wrap; }
.proactive-center-task-link:hover { text-decoration: underline; }
```

- [ ] **Step 3: 设置页开关**

`Settings.tsx`「久坐提醒」卡片之后加(样式与相邻项一致):

```tsx
              <div className="settings-field settings-field-row">
                <label>任务到期通知</label>
                <label className="settings-switch">
                  <input
                    type="checkbox"
                    aria-label="任务到期通知"
                    checked={config.taskNotifications !== false}
                    onChange={(e) => save({ taskNotifications: e.target.checked })}
                  />
                  <span className="settings-switch-slider" />
                </label>
              </div>
```

- [ ] **Step 4: 类型检查 + 单测**

Run: `npm run typecheck`
Expected: PASS

Run: `npx vitest --run`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/ProactiveCenter/ProactiveCenter.tsx src/renderer/src/components/ProactiveCenter/ProactiveCenter.css src/renderer/src/components/Settings/Settings.tsx
git commit -m "feat(tasks): route reminders into message center and add notification toggle"
```

---

### Task 9: Electron 冒烟与全量门禁

**Files:**
- Modify: `src/main/smoke/tasks-smoke.ts`(替换 Task 4 的占位)

- [ ] **Step 1: 完整冒烟实现**

```ts
import { app } from 'electron'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { openTasksStore } from '../tasks/store'
import { startTaskScheduler } from '../tasks/scheduler'

export async function runTasksSmoke(): Promise<void> {
  const file = join(app.getPath('userData'), 'tasks-smoke.db')
  try { rmSync(file, { force: true }) } catch { /* 首次运行没有旧文件 */ }
  const store = openTasksStore(file)
  const reminders: string[] = []
  let backlog = 0
  let scheduler: { stop(): void } | null = null
  try {
    const project = store.createProject('冒烟项目')
    let rejected = false
    try { store.createProject('冒烟项目') } catch { rejected = true }
    if (!rejected) throw new Error('Duplicate task project name was accepted')

    // 启动调度器前先落下一条过期提醒,模拟应用未运行期间错过的积压
    const overdue = store.createTask({ title: '过期任务', priority: 'high', dueAt: Date.now() - 3_600_000, remindAt: Date.now() - 1_800_000 })
    scheduler = startTaskScheduler(
      now => store.claimDueReminders(now),
      {
        onReminder: task => { reminders.push(task.id) },
        onBacklog: count => { backlog += count }
      },
      { intervalMs: 50 }
    )

    const due = store.createTask({ title: '即将到期', dueAt: Date.now() + 400, remindAt: Date.now() + 120 })
    const toComplete = store.createTask({ title: '先完成', dueAt: Date.now() + 400, remindAt: Date.now() + 120 })
    store.completeTask(toComplete.id)

    if (backlog !== 1) throw new Error(`Expected one merged backlog reminder, got ${backlog}`)
    await new Promise(resolve => setTimeout(resolve, 600))
    if (reminders.length !== 1 || reminders[0] !== due.id) throw new Error(`Expected exactly the due reminder, got ${JSON.stringify(reminders)}`)
    if (store.listTasks().open.find(task => task.id === overdue.id)?.remindFiredAt == null) throw new Error('Backlog reminder was not marked fired')
    await new Promise(resolve => setTimeout(resolve, 200))
    if (reminders.length !== 1) throw new Error('Reminder fired more than once')

    store.deleteTask(due.id)
    store.close()
    const reopened = openTasksStore(file)
    const persisted = reopened.listTasks()
    if (persisted.open.length !== 1 || persisted.done.length !== 1) throw new Error('Task rows did not survive reopen')
    if (!reopened.listProjects().some(item => item.id === project.id)) throw new Error('Project did not survive reopen')
    reopened.close()
    console.log('CHOUYU_TASKS_SMOKE_PASSED backlog merge, fire-once, complete cancels, persistence')
  } finally {
    scheduler?.stop()
    try { store.close() } catch { /* 已在用例内关闭 */ }
  }
}
```

注意顺序:过期任务必须在 `startTaskScheduler` **之前**入库,否则调度器启动时库为空、积压恒为 0。

- [ ] **Step 2: 全量门禁**

Run: `npm run typecheck`
Expected: PASS

Run: `npx vitest --run`
Expected: 全部 PASS

Run: `npm run test:smoke`
Expected: 输出含 `CHOUYU_TASKS_SMOKE_PASSED`,进程以 `CHOUYU_SMOKE_READY`/退出码 0 结束(脚本既有约定)

- [ ] **Step 3: 提交**

```bash
git add src/main/smoke/tasks-smoke.ts
git commit -m "test(tasks): cover reminder lifecycle in electron smoke run"
```

---

### Task 10: 手动验证与文档

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1: npm run dev 手验清单**

1. 工作区导航出现「任务」图标,点击进入任务页。
2. 新建项目、新建任务(标题+截止明天 09:00+提前 1 天+高优先):列表立即出现,左侧色条为红。
3. 再建一个任务截止时间设为 2 分钟后、提醒「截止时」:等到期后收到 Windows 系统通知,点击通知跳到任务页;助手消息中心出现「任务提醒：…」条目,点击可跳任务页;宠物气泡短暂显示。
4. 勾选完成:任务进入「已完成」折叠区;编辑、删除正常;重开应用后任务与项目都在。
5. 设置 → 智能功能 → 关闭「任务到期通知」:到期只进消息中心,不再弹系统通知。
6. 暗色主题、375px 窄视口、Tab 键遍历表单与列表、系统开启"减少动画"时无过渡。
7. 会话/活动/记忆页无回归;托盘退出无报错。

- [ ] **Step 2: 更新 roadmap**

`docs/roadmap.md` 顶部「已确认的后续迭代顺序」小节后追加一段(日期用当天):

```markdown
任务模块一期已实现:独立 SQLite 任务库(独立迁移与损坏隔离)、任务/项目 CRUD、优先级、截止与提醒、主进程到期调度、系统通知 + 主动消息中心留档与点击跳转、工作区「任务」页(智能视图/项目分组/键盘可用)。设计见 [任务模块 spec](superpowers/specs/2026-09-14-task-management-design.md)。二期(重复任务、聊天建任务工具、日志产物转任务)与真实环境验收(多屏、休眠唤醒、全天使用)待后续批次。
```

- [ ] **Step 3: 提交**

```bash
git add docs/roadmap.md
git commit -m "docs: record task module phase one progress in roadmap"
```

---

## Self-Review 记录

- Spec 覆盖:一期范围(存储/CRUD/优先级/截止提醒/调度/通知+消息中心/任务页/设置开关/冒烟/窄屏暗色键盘减少动画)分别落在 Task 1-9;二期与时机决策明确排除在本计划外。
- 类型一致性:`TasksStore.listTasks()` 无参、`claimDueReminders(now)`、`startTaskScheduler(claim, handlers, options)`、preload `tasks.remove`(IPC 通道名 `tasks:delete`)在 Task 2/3/4/5/7/9 间已对齐;`TasksReminderEvent` 联合类型由 `satisfies TasksAPI` 约束。
- 已修复:隔离重建前必须先关 SQLite 句柄(Windows 重命名限制);`TasksSchemaVersionError` 与损坏隔离分流,未来版本正常拒绝不隔离;`createTask` 用 `lastInsertRowid` 回读,避免同标题同毫秒歧义;regression 断言改为与实现一致的 `onSubmit` 原生提交。
- 占位符:无 TBD;Task 4 的冒烟占位在 Task 9 完整替换,是有意的两步交付。

