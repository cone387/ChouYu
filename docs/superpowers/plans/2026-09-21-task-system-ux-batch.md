# 任务系统 UX 批次 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现「任务系统」清单 4 个待办：侧栏视图手动收纳+拖拽排序、任务卡片统一「⋯」菜单、子项可设截止时间+提醒、侧栏视图区/清单区拖拽分割线。

**Architecture:** 全部为 Electron 应用内改动：shared 层扩展 `TaskChecklistItem`（不动 tasks.db 表结构，子项时间/提醒存于任务自身 checklist JSON），主进程 `claimDueReminders` 扩展扫描子项提醒，renderer 侧栏改为「视图区 + 拖拽手柄 + 清单区」三段布局并以 localStorage 配置驱动视图导航。

**Tech Stack:** React + TypeScript + better-sqlite3 + vitest，localStorage 持久化（沿用 `chouyu:*` 键约定）。

**规格文档:** `docs/superpowers/specs/2026-09-21-task-system-ux-batch-design.md`

**测试命令:** 单文件 `npx vitest --run <file>`；全量 `npm test`；类型 `npm run typecheck`。

---

### Task 1: 建分支 + 子项数据模型扩展（shared）

**Files:**
- Modify: `src/shared/tasks.ts`（`TaskChecklistItem` 接口 line 5、`validateTaskChecklist` lines 8-17、顶部 import line 1）
- Test: `src/shared/tasks.test.ts`（追加 describe）

- [ ] **Step 1: 从 master 建功能分支**

```bash
git checkout master && git pull && git checkout -b feature/task-system-ux-batch
```

- [ ] **Step 2: 写失败测试**（追加到 `src/shared/tasks.test.ts` 末尾）

```ts
import { validateTaskChecklist } from './tasks'

describe('validateTaskChecklist 子项时间与提醒', () => {
  test('接受可选截止时间与提醒，缺省字段兼容旧数据', () => {
    const items = validateTaskChecklist([
      { id: 'a', title: '旧格式', done: false },
      { id: 'b', title: '带时间', done: false, dueAt: 1000, reminders: [{ at: 900, firedAt: null }] },
      { id: 'c', title: '已清空', done: false, dueAt: null, reminders: [] }
    ])
    expect(items[0]).toEqual({ id: 'a', title: '旧格式', done: false })
    expect(items[1]).toEqual({ id: 'b', title: '带时间', done: false, dueAt: 1000, reminders: [{ at: 900, firedAt: null }] })
    expect(items[2]).toEqual({ id: 'c', title: '已清空', done: false })
  })
  test('无截止时间不许带提醒；非法时间与提醒结构报错', () => {
    expect(() => validateTaskChecklist([{ id: 'a', title: 'x', done: false, reminders: [{ at: 1, firedAt: null }] }])).toThrow('子项提醒需要先设置截止时间。')
    expect(() => validateTaskChecklist([{ id: 'a', title: 'x', done: false, dueAt: NaN }])).toThrow('任务子项无效。')
    expect(() => validateTaskChecklist([{ id: 'a', title: 'x', done: false, dueAt: 1, reminders: [{ at: 'bad', firedAt: null }] }])).toThrow()
  })
})
```

注意：`validateTaskChecklist` 若文件顶部尚未 import 需并入现有 import；`tasks.test.ts` 顶部已有 `import { ... } from './tasks'`，把 `validateTaskChecklist` 加进该 import 列表即可，不要重复 import。

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest --run src/shared/tasks.test.ts`
Expected: FAIL（旧 `validateTaskChecklist` 会把 dueAt/reminders 字段丢掉，第一断言不等；第三组不抛错）

- [ ] **Step 4: 最小实现**（`src/shared/tasks.ts`）

接口（替换 line 5）：

```ts
export interface TaskChecklistItem { id: string; title: string; done: boolean; dueAt?: number | null; reminders?: TaskReminder[] }
```

顶部 import（line 1，把 `validateReminders` 加进去）：

```ts
import { nextTaskOccurrence, validateReminders, type TaskRecurrence, type TaskRepeatRule, type TaskReminder } from './taskScheduling'
```

校验函数（替换 lines 8-17 整个函数体）：

```ts
export function validateTaskChecklist(input: unknown): TaskChecklistItem[] {
  if (input === undefined) return []
  if (!Array.isArray(input) || input.length > 100) throw new Error('任务子项最多 100 项。')
  const ids = new Set<string>()
  return input.map(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || item.id.length > 200 || ids.has(item.id) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200 || typeof item.done !== 'boolean') throw new Error('任务子项无效。')
    ids.add(item.id)
    const result: TaskChecklistItem = { id: item.id, title: item.title.trim(), done: item.done }
    if (item.dueAt !== undefined && item.dueAt !== null) {
      if (typeof item.dueAt !== 'number' || !Number.isFinite(item.dueAt)) throw new Error('任务子项无效。')
      result.dueAt = Math.round(item.dueAt)
    }
    const reminders = item.reminders === undefined ? [] : validateReminders(item.reminders)
    if (reminders.length > 0 && result.dueAt === undefined) throw new Error('子项提醒需要先设置截止时间。')
    if (reminders.length) result.reminders = reminders
    return result
  })
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest --run src/shared/tasks.test.ts`
Expected: PASS（含原有全部用例）

- [ ] **Step 6: Commit**

```bash
git add src/shared/tasks.ts src/shared/tasks.test.ts
git commit -m "feat(tasks): checklist items gain optional due time and reminders"
```

---

### Task 2: 主进程子项提醒扫描 + 提醒文案「任务 · 子项」

**Files:**
- Modify: `src/main/tasks/store.ts`（`claimDueReminders` lines 779-795；新增导出类型）
- Modify: `src/main/tasks/scheduler.ts`（全文重写，约 68 行）
- Test: `src/main/tasks/scheduling.test.ts`（改 3 处 `.map(t => t.id)`，追加 2 个用例）

- [ ] **Step 1: 写失败测试**（`src/main/tasks/scheduling.test.ts` 末尾追加）

```ts
test('子项提醒按子项逐条领取，标题为任务·子项，重启后不重复', () => {
  const file = path(), store = open(file)
  const task = store.createTask({ title: '父任务', dueAt: 2000, checklist: [
    { id: 'a', title: '子项甲', done: false, dueAt: 100, reminders: [{ at: 90, firedAt: null }] },
    { id: 'b', title: '子项乙', done: false, dueAt: 300, reminders: [{ at: 280, firedAt: null }] }
  ] })
  const first = store.claimDueReminders(100)
  expect(first.map(entry => entry.itemTitle)).toEqual(['子项甲'])
  expect(store.getTask(task.id)!.checklist![0].reminders![0].firedAt).toBe(100)
  expect(store.claimDueReminders(200)).toEqual([])
  const restarted = open(file)
  const second = restarted.claimDueReminders(300)
  expect(second.map(entry => entry.itemTitle)).toEqual(['子项乙'])
  expect(second[0].task.title).toBe('父任务')
})
test('同轮任务级与子项级提醒各发一条且原子记录', () => {
  const store = open()
  const task = store.createTask({ title: '混合', dueAt: 1000, reminderTimes: [900], checklist: [
    { id: 'a', title: '步骤', done: false, dueAt: 950, reminders: [{ at: 940, firedAt: null }] }
  ] })
  const claimed = store.claimDueReminders(1000)
  expect(claimed.map(entry => entry.itemTitle ?? null)).toEqual([null, '步骤'])
  expect(claimed[0].task.remindFiredAt).toBe(1000)
  expect(store.claimDueReminders(1000)).toEqual([])
})
```

- [ ] **Step 2: 同文件改既有断言**（返回结构从 TaskRecord 变 `{ task, itemTitle? }`）

- line 16: `expect(store.claimDueReminders(100).map(t => t.id)).toEqual([task.id])` → `.map(t => t.task.id)`
- line 20: `expect(restarted.claimDueReminders(200)).toHaveLength(1)` 不变
- line 22: `expect(restarted.claimDueReminders(300)).toHaveLength(1)` 不变

另在 `src/main/tasks/store.test.ts` 同步三处：

- line 210: `expect(first.map(item => item.id))` → `expect(first.map(item => item.task.id))`
- line 211: `expect(first[0].remindFiredAt)` → `expect(first[0].task.remindFiredAt)`
- lines 212/220/223: `.map(item => item.id)` → `.map(item => item.task.id)`

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest --run src/main/tasks/scheduling.test.ts src/main/tasks/store.test.ts`
Expected: FAIL（类型不匹配 / itemTitle 不存在）

- [ ] **Step 4: 实现 store.ts**

在 `TasksStore` 类定义前（line 291 附近）加导出类型：

```ts
/** 被领取的提醒：任务级或某个子项级；itemTitle 存在即子项提醒。 */
export interface ClaimedReminder { task: TaskRecord; itemTitle?: string }
```

替换 `claimDueReminders`（lines 779-795 整个方法，含原注释）：

```ts
  /** 原子记录各提醒的发送状态，再由调用方通知。任务级与子项级同轮各自领取，积压由调用方合并。 */
  claimDueReminders(now: number): ClaimedReminder[] {
    return this.database.transaction(() => {
      const rows = this.database.prepare(`SELECT * FROM tasks
        WHERE status = 'open'
          AND ((remind_at IS NOT NULL AND remind_at <= ? AND remind_fired_at IS NULL) OR checklist LIKE '%"reminders":%')
          AND (project_id IS NULL OR project_id NOT IN (SELECT id FROM task_projects WHERE archived_at IS NOT NULL))`).all(now) as TaskRow[]
      const claimed: ClaimedReminder[] = []
      for (const row of rows) {
        const checklist = validateTaskChecklist(JSON.parse(row.checklist ?? '[]'))
        const firedItems: string[] = []
        const nextChecklist = checklist.map(item => {
          if (!item.reminders?.some(r => r.firedAt === null && r.at <= now)) return item
          firedItems.push(item.title)
          return { ...item, reminders: item.reminders.map(r => r.firedAt === null && r.at <= now ? { ...r, firedAt: now } : r) }
        })
        const reminders = rowReminders(row)
        const taskDue = reminders.some(r => r.firedAt === null && r.at <= now)
        const updatedReminders = taskDue ? reminders.map(r => r.firedAt === null && r.at <= now ? { ...r, firedAt: now } : r) : reminders
        if (taskDue || firedItems.length) {
          this.database.prepare('UPDATE tasks SET reminders = ?, remind_fired_at = ?, checklist = ? WHERE id = ?')
            .run(JSON.stringify(updatedReminders), taskDue ? firedSummary(updatedReminders) : row.remind_fired_at, JSON.stringify(nextChecklist), row.id)
        }
        const snapshot = toTask({ ...row, reminders: JSON.stringify(updatedReminders), remind_fired_at: taskDue ? firedSummary(updatedReminders) : row.remind_fired_at, checklist: JSON.stringify(nextChecklist) })
        if (taskDue) claimed.push({ task: snapshot })
        for (const title of firedItems) claimed.push({ task: snapshot, itemTitle: title })
      }
      return claimed
    }).immediate()
  }
```

- [ ] **Step 5: 实现 scheduler.ts**（替换 lines 1-15 的 import 与 `toReminderPayload`，及 `claim`/循环签名）

```ts
import type { TaskRecord, TaskReminderPayload } from '../../shared/tasks'
import type { ClaimedReminder } from './store'

export interface TaskSchedulerHandlers {
  onReminder(task: TaskReminderPayload): void
  onBacklog(count: number): void
}

export interface TaskSchedulerOptions {
  intervalMs?: number
  now?(): number
}

const toReminderPayload = (entry: ClaimedReminder): TaskReminderPayload => ({
  id: entry.task.id,
  title: entry.itemTitle ? `${entry.task.title} · ${entry.itemTitle}` : entry.task.title,
  dueAt: entry.task.dueAt,
  priority: entry.task.priority
})
```

`startTaskScheduler` 签名与内部：

- `claim: (now: number) => TaskRecord[]` → `claim: (now: number) => ClaimedReminder[]`
- `let backlog: TaskRecord[] = []` → `let backlog: ClaimedReminder[] = []`
- `for (const task of due) { ... handlers.onReminder(toReminderPayload(task)) ... }` → `for (const entry of due) { ... handlers.onReminder(toReminderPayload(entry)) ... }`

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest --run src/main/tasks/scheduling.test.ts src/main/tasks/store.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/tasks/store.ts src/main/tasks/scheduler.ts src/main/tasks/scheduling.test.ts src/main/tasks/store.test.ts
git commit -m "feat(tasks): reminders fire for checklist items as task · item"
```

---

### Task 3: 重复任务下一期重置子项勾选与提醒

**Files:**
- Modify: `src/main/tasks/store.ts`（`completeTask` 内 INSERT 的 checklist 表达式，line 672）
- Test: `src/main/tasks/scheduling.test.ts`（追加 1 用例）

- [ ] **Step 1: 写失败测试**（`scheduling.test.ts` 末尾追加）

```ts
test('重复任务下一期重置子项勾选并按周期偏移子项时间与提醒', () => {
  const store = open()
  const due = new Date(2030, 0, 1, 9).getTime()
  vi.spyOn(Date, 'now').mockReturnValue(due)
  const task = store.createTask({ title: '每周复查', dueAt: due, recurrence: 'weekly', checklist: [
    { id: 'a', title: '整理', done: true, dueAt: due + 60_000, reminders: [{ at: due + 30_000, firedAt: 123 }] }
  ] })
  store.completeTask(task.id)
  const next = store.listTasks().open[0]
  expect(next.dueAt).toBe(due + 7 * 86_400_000)
  const item = next.checklist![0]
  expect(item.done).toBe(false)
  expect(item.dueAt).toBe(due + 7 * 86_400_000 + 60_000)
  expect(item.reminders).toEqual([{ at: due + 7 * 86_400_000 + 30_000, firedAt: null }])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest --run src/main/tasks/scheduling.test.ts`
Expected: FAIL（现逻辑仅重置 done，不偏移 dueAt/reminders）

- [ ] **Step 3: 实现**（`store.ts` `completeTask` 内 INSERT 的 checklist 实参，替换）

原来：

```ts
JSON.stringify(validateTaskChecklist(JSON.parse(current.checklist ?? '[]')).map(item => ({ ...item, done: false })))
```

改为：

```ts
JSON.stringify(validateTaskChecklist(JSON.parse(current.checklist ?? '[]')).map(item => {
  const delta = nextDueAt - current.due_at!
  return {
    ...item, done: false,
    ...(item.dueAt != null ? { dueAt: item.dueAt + delta } : {}),
    ...(item.reminders?.length ? { reminders: item.reminders.map(r => ({ at: r.at + delta, firedAt: null })) } : {})
  }
}))
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest --run src/main/tasks/scheduling.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/tasks/store.ts src/main/tasks/scheduling.test.ts
git commit -m "feat(tasks): recurring successors reset checklist done state and shift item times"
```

---

### Task 4: 移除快捷编辑，看板/列表卡片统一「⋯」菜单

**Files:**
- Delete: `src/renderer/src/components/Tasks/TaskQuickEdit.tsx`
- Modify: `src/renderer/src/components/Tasks/TasksBoard.tsx`（import line 4、props line 17、卡片 onClick 选择器 line 243、卡片尾部 line 262）
- Modify: `src/renderer/src/components/Tasks/TasksView.tsx`（import line 15、renderTask 内 line 758 与 onClick 选择器 line 736、TasksBoard 调用 line 1032）
- Modify: `src/shared/tasks.ts`（删除 `rescheduleTaskDate` lines 137-152）

- [ ] **Step 1: 看板卡接菜单**

`TasksBoard.tsx`：

1. 删除 line 4 `import TaskQuickEdit from './TaskQuickEdit'`。
2. props 接口里删除 `onQuickEdit?: (id: string, patch: TaskUpdateInput) => Promise<unknown>`（line 17），新增一行：

```ts
  onRemove: (id: string) => void
```

3. 函数签名解构参数里删 `onQuickEdit`、加 `onRemove`（line 42）。
4. 卡片 `onClick` 选择器（line 243）`'button, summary, .tasks-quick-edit, a, input, select, textarea'` → `'button, summary, a, input, select, textarea'`。
5. 替换 line 262 `{onQuickEdit && <TaskQuickEdit task={task} projects={projects} onSave={patch => onQuickEdit(task.id, patch)} />}` 为：

```tsx
              <details className="tasks-item-menu">
                <summary aria-label={`更多操作 ${task.title}`} title="更多操作"><TaskIcon name="more" /></summary>
                <div className="tasks-item-menu-popover">
                  <button type="button" onClick={() => onEdit(task)}>编辑任务</button>
                  <button type="button" className="tasks-item-menu-danger" onClick={() => onRemove(task.id)}>删除任务</button>
                </div>
              </details>
```

- [ ] **Step 2: TasksView 接线**

1. 删除 line 15 `import TaskQuickEdit from './TaskQuickEdit'`。
2. `renderTask` 内删除 line 758 的 `<TaskQuickEdit ... />`（其后紧跟的 `tasks-item-menu` details 保留不动）。
3. line 736 onClick 选择器 `'button, .tasks-item-menu, .tasks-quick-edit, a, input, select, textarea, [role="button"]'` → `'button, .tasks-item-menu, a, input, select, textarea, [role="button"]'`。
4. TasksBoard 调用处（line 1032）删除 `onQuickEdit={async (id, patch) => { await window.electronAPI.tasks.update(id, patch); reloadRef.current() }}`，新增一行：

```tsx
            onRemove={remove}
```

（`remove` 即文件内已有的确认删除函数，lines 412-415。）

- [ ] **Step 3: 删除组件与无引用工具**

```bash
git rm src/renderer/src/components/Tasks/TaskQuickEdit.tsx
```

`src/shared/tasks.ts` 删除 lines 137-152 的 `rescheduleTaskDate` 函数及其上方注释行（`/** Changing a deadline preserves ... */`）。全仓 grep `rescheduleTaskDate`、`TaskQuickEdit`、`tasks-quick-edit` 确认无残留引用（`tasks.test.ts` 无相关用例，已核实）。

- [ ] **Step 4: 类型与单测验证**

Run: `npm run typecheck && npx vitest --run src/renderer/src/components/Tasks/Tasks.regression.test.ts`
Expected: PASS（回归守卫不引用快捷编辑，已核实）

- [ ] **Step 5: Commit**

```bash
git add -A src/renderer/src/components/Tasks src/shared/tasks.ts
git commit -m "feat(tasks): unify card actions into a single menu with edit and delete"
```

---

### Task 5: 卡片「n 个子项过期」角标

**Files:**
- Modify: `src/renderer/src/components/Tasks/TaskCardMeta.tsx`（line 17 附近）
- Test: 无独立测试文件（纯展示），由回归测试与手验覆盖

- [ ] **Step 1: 实现**

`TaskCardMeta` 组件 `return` 前加：

```ts
  const overdueItems = task.checklist?.filter(item => !item.done && item.dueAt != null && item.dueAt < now.getTime()) ?? []
```

组件内顶部（`const project = ...` 之前）加 `const now = new Date()`。

在「子项 x/y」那一行（line 17）之后插入：

```tsx
      {!!overdueItems.length && <span className="task-card-detail tasks-subitem-overdue" title={overdueItems.map(item => item.title).join('、')}>{overdueItems.length} 个子项过期</span>}
```

- [ ] **Step 2: 样式**

`Tasks.css` 追加：

```css
.tasks-subitem-overdue { color: var(--error); }
```

- [ ] **Step 3: 验证 + Commit**

Run: `npm run typecheck`
Expected: 无错误

```bash
git add src/renderer/src/components/Tasks/TaskCardMeta.tsx src/renderer/src/components/Tasks/Tasks.css
git commit -m "feat(tasks): cards show overdue checklist count"
```

---

### Task 6: 编辑器子项行升级（截止时间 / 提醒 / 行间「+」）

**Files:**
- Modify: `src/renderer/src/components/Tasks/TaskEditorDialog.tsx`（checklist fieldset lines 115-124、imports）
- Modify: `src/renderer/src/components/Tasks/TasksView.tsx`（`submitDraft` 内两处 `checklist: draft.checklist`，lines 385-386）
- Modify: `src/renderer/src/components/Tasks/Tasks.css`（追加样式）
- Test: `src/renderer/src/components/Tasks/Tasks.regression.test.ts`（第 1 个测试断言列表追加两条）

- [ ] **Step 1: 回归守卫先行**（`Tasks.regression.test.ts` 第 1 个 test 的断言列表末尾追加）

```ts
    expect(source).toContain('tasks-checklist-due')
    expect(source).toContain('tasks-checklist-insert')
```

Run: `npx vitest --run src/renderer/src/components/Tasks/Tasks.regression.test.ts`
Expected: FAIL

- [ ] **Step 2: TaskEditorDialog 实现**

imports（line 2-3）改为：

```ts
import type { RemindChoiceId, TaskChecklistItem, TaskGroup, TaskPriority, TaskProject, TaskRecord, TaskSelectField } from '../../../../shared/tasks'
import { PRIORITY_LABELS, REMIND_CHOICES, remindAtFromChoice } from '../../../../shared/tasks'
```

组件内（`const [newItem, setNewItem] = useState('')` 之后）加：

```ts
  const [insertedId, setInsertedId] = useState('')
  const toDateTimeLocal = (at: number | null | undefined): string => {
    if (at == null) return ''
    const date = new Date(at)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  const itemDueAt = (value: string): number | null => value ? new Date(value).getTime() : null
  const itemRemindChoice = (item: TaskChecklistItem): RemindChoiceId => {
    if (item.dueAt == null || item.reminders?.length !== 1 || item.reminders[0].firedAt !== null) return 'none'
    for (const choice of REMIND_CHOICES) if (remindAtFromChoice(choice.id, item.dueAt) === item.reminders[0].at) return choice.id
    return 'none'
  }
  const patchItem = (id: string, patch: Partial<TaskChecklistItem>) => onChange({ ...draft, checklist: draft.checklist!.map(value => value.id === id ? { ...value, ...patch } : value) })
  const insertAfter = (id: string) => {
    if ((draft.checklist?.length ?? 0) >= 100) return
    const item: TaskChecklistItem = { id: crypto.randomUUID(), title: '', done: false }
    const index = draft.checklist!.findIndex(value => value.id === id)
    const next = [...draft.checklist!]
    next.splice(index + 1, 0, item)
    setInsertedId(item.id)
    onChange({ ...draft, checklist: next })
  }
```

替换 fieldset 内子项行循环（lines 118-122 的 `(draft.checklist ?? []).map(item => <div key={item.id}>...</div>)`）：

```tsx
          {(draft.checklist ?? []).map(item => <div key={item.id} className="tasks-checklist-row">
            <input type="checkbox" aria-label={`完成子项 ${item.title}`} checked={item.done} onChange={event => patchItem(item.id, { done: event.target.checked })} />
            <input className="tasks-checklist-title" aria-label="子项名称" maxLength={200} value={item.title} autoFocus={insertedId === item.id}
              onChange={event => patchItem(item.id, { title: event.target.value })}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); insertAfter(item.id) } }} />
            <input type="datetime-local" className="tasks-checklist-due" aria-label={`子项截止时间 ${item.title}`} value={toDateTimeLocal(item.dueAt)}
              onChange={event => patchItem(item.id, itemDueAt(event.target.value) === null ? { dueAt: null, reminders: [] } : { dueAt: itemDueAt(event.target.value)!, reminders: [] })} />
            <select className="tasks-checklist-remind" aria-label={`子项提醒 ${item.title}`} disabled={busy || item.dueAt == null} value={itemRemindChoice(item)}
              onChange={event => { const at = remindAtFromChoice(event.target.value as RemindChoiceId, item.dueAt ?? null); patchItem(item.id, at === null ? { reminders: [] } : { reminders: [{ at, firedAt: null }] }) }}>
              {REMIND_CHOICES.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
            </select>
            <button type="button" className="tasks-checklist-insert" aria-label={`在 ${item.title || '子项'} 下方添加子项`} title="在下方添加子项" onClick={() => insertAfter(item.id)}>+</button>
            <button type="button" aria-label={`删除子项 ${item.title}`} onClick={() => onChange({ ...draft, checklist: draft.checklist!.filter(value => value.id !== item.id) })}>×</button>
          </div>)}
```

替换 `<small>` 提示（line 117）：

```tsx
          <small>子项可设截止时间与提醒，到点以「任务 · 子项」提醒；勾选子项不改变父任务状态。重复任务下一期会重置子项勾选与提醒。子项不进入任务视图。</small>
```

- [ ] **Step 3: 提交时空标题子项过滤**（`TasksView.tsx` `submitDraft`，lines 385-386 两处）

两处 `checklist: draft.checklist` 均改为：

```ts
checklist: draft.checklist?.filter(item => item.title.trim())
```

- [ ] **Step 4: 样式**（`Tasks.css` 追加）

```css
.tasks-checklist-row { display: flex; align-items: center; gap: 6px; }
.tasks-checklist-row .tasks-checklist-title { flex: 1; min-width: 0; }
.tasks-checklist-due, .tasks-checklist-remind { flex: none; font-size: 12px; }
.tasks-checklist-insert { visibility: hidden; }
.tasks-checklist-row:hover .tasks-checklist-insert, .tasks-checklist-row:focus-within .tasks-checklist-insert { visibility: visible; }
```

- [ ] **Step 5: 验证 + Commit**

Run: `npm run typecheck && npx vitest --run src/renderer/src/components/Tasks/Tasks.regression.test.ts`
Expected: PASS

```bash
git add src/renderer/src/components/Tasks/TaskEditorDialog.tsx src/renderer/src/components/Tasks/TasksView.tsx src/renderer/src/components/Tasks/Tasks.css src/renderer/src/components/Tasks/Tasks.regression.test.ts
git commit -m "feat(tasks): checklist editor gains per-item due time, reminder and insert below"
```

---

### Task 7: 侧栏分割线拖拽

**Files:**
- Create: `src/renderer/src/components/Tasks/useSidebarSplit.ts`
- Test: `src/renderer/src/components/Tasks/useSidebarSplit.test.ts`
- Modify: `src/renderer/src/components/Tasks/TasksView.tsx`（sidebar 结构 lines 770-795、832-833；新增 hook 调用）
- Modify: `src/renderer/src/components/Tasks/Tasks.css`（line 15 `.tasks-sidebar`、line 350 `.tasks-sidebar-projects`、追加手柄样式与 ≤640 覆盖）

- [ ] **Step 1: 写失败测试**（新建 `useSidebarSplit.test.ts`）

```ts
import { describe, expect, test } from 'vitest'
import { parseSidebarSplit } from './useSidebarSplit'

describe('parseSidebarSplit', () => {
  test('合法像素值保留，空/非法/越界恢复 auto', () => {
    expect(parseSidebarSplit(null)).toBeNull()
    expect(parseSidebarSplit('300')).toBe(300)
    expect(parseSidebarSplit('99')).toBeNull()
    expect(parseSidebarSplit('5000')).toBeNull()
    expect(parseSidebarSplit('abc')).toBeNull()
  })
})
```

Run: `npx vitest --run src/renderer/src/components/Tasks/useSidebarSplit.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现 hook**（新建 `useSidebarSplit.ts`）

```ts
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

export const SIDEBAR_SPLIT_KEY = 'chouyu:task-sidebar-split:v1'
const MIN_RATIO = 0.2
const MAX_RATIO = 0.8

export function parseSidebarSplit(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 100 && value <= 4000 ? Math.round(value) : null
}

export default function useSidebarSplit(sidebarRef: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState<number | null>(() => {
    try { return parseSidebarSplit(localStorage.getItem(SIDEBAR_SPLIT_KEY)) } catch { return null }
  })
  const [storageError, setStorageError] = useState('')
  const dragging = useRef(false)
  useEffect(() => {
    if (height === null) return
    try { localStorage.setItem(SIDEBAR_SPLIT_KEY, String(height)); setStorageError('') }
    catch { setStorageError('侧栏分割位置暂时无法保存，重启后可能恢复默认。') }
  }, [height])
  const applyPointer = (event: PointerEvent<HTMLElement>) => {
    const sidebar = sidebarRef.current
    if (!sidebar) return
    const rect = sidebar.getBoundingClientRect()
    setHeight(Math.round(Math.min(Math.max(event.clientY - rect.top, rect.height * MIN_RATIO), rect.height * MAX_RATIO)))
  }
  const dividerProps = {
    role: 'separator' as const, tabIndex: 0, 'aria-orientation': 'horizontal' as const,
    'aria-label': '拖动调整视图区高度；双击恢复自动',
    title: '拖动调整视图区高度；双击恢复自动',
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      dragging.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => { if (dragging.current) applyPointer(event) },
    onPointerUp: (event: PointerEvent<HTMLElement>) => { dragging.current = false; try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 已释放 */ } },
    onDoubleClick: () => setHeight(null),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const sidebar = sidebarRef.current
        const current = height ?? (sidebar ? sidebar.getBoundingClientRect().height * 0.4 : 200)
        setHeight(Math.round(event.key === 'ArrowUp' ? current - 10 : current + 10))
      } else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); setHeight(null) }
    }
  }
  const reset = useCallback(() => setHeight(null), [])
  return { height, dividerProps, storageError, reset }
}
```

Run: `npx vitest --run src/renderer/src/components/Tasks/useSidebarSplit.test.ts`
Expected: PASS

- [ ] **Step 3: TasksView 接线**

import 区加 `import useSidebarSplit from './useSidebarSplit'`。组件内（`const menusRef = useTaskMenus(active)` 之后）加：

```ts
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarSplit = useSidebarSplit(sidebarRef)
```

`<aside id="tasks-sidebar" className="tasks-sidebar" ...>`（line 770）加 `ref={sidebarRef}`。视图区容器（line 772 `<div className="tasks-sidebar-view-nav" role="region" aria-label="视图选择">`）加内联样式：

```tsx
      <div className="tasks-sidebar-view-nav" role="region" aria-label="视图选择" style={sidebarSplit.height === null ? undefined : { height: sidebarSplit.height, flex: 'none' }}>
```

在该 `</div>`（「更多」details 之后、`.tasks-sidebar-projects` 之前，lines 793-795 之间）插入手柄：

```tsx
      <div className="tasks-sidebar-divider" {...sidebarSplit.dividerProps} />
```

存储错误提示（line 836-837 一组 notice 之后追加一行）：

```tsx
      {sidebarSplit.storageError && <p role="status" className="tasks-notice">{sidebarSplit.storageError}</p>}
```

- [ ] **Step 4: 样式**（`Tasks.css`）

line 15 `.tasks-sidebar` 整条替换为（去掉 `overflow-y: auto`，其余不变）：

```css
.tasks-sidebar { width: 204px; min-width: 0; padding-right: 12px; border-right: 1px solid var(--border); overflow: hidden; flex: none; display: flex; flex-direction: column; gap: 8px; }
```

line 350 `.tasks-sidebar-projects { border-top: 1px solid var(--border); padding-top: 12px; }` 替换并追加新规则：

```css
.tasks-sidebar-view-nav { overflow-y: auto; min-height: 0; max-height: 80%; flex: 0 1 auto; }
.tasks-sidebar-divider { flex: none; height: 6px; margin: 0 -4px; cursor: row-resize; touch-action: none; border-radius: 3px; }
.tasks-sidebar-divider::after { content: ''; display: block; margin: 2px auto; width: 36px; height: 2px; border-radius: 1px; background: var(--border); }
.tasks-sidebar-divider:hover, .tasks-sidebar-divider:focus-visible { background: var(--hover-bg); outline: none; }
.tasks-sidebar-projects { flex: 1 1 0; min-height: 0; overflow-y: auto; padding-top: 4px; }
```

现有 `@media (max-width: 640px)` 块（line 263 起）内追加：

```css
  .tasks-sidebar-divider { display: none; }
  .tasks-sidebar-view-nav { max-height: none; overflow: visible; flex: none; }
  .tasks-sidebar-projects { flex: none; overflow: visible; border-top: 1px solid var(--border); }
```

- [ ] **Step 5: 验证 + Commit**

Run: `npm run typecheck && npx vitest --run src/renderer/src/components/Tasks/useSidebarSplit.test.ts src/renderer/src/components/Tasks/Tasks.regression.test.ts`
Expected: PASS

```bash
git add src/renderer/src/components/Tasks/useSidebarSplit.ts src/renderer/src/components/Tasks/useSidebarSplit.test.ts src/renderer/src/components/Tasks/TasksView.tsx src/renderer/src/components/Tasks/Tasks.css
git commit -m "feat(tasks): draggable divider between sidebar view and project regions"
```

---

### Task 8: 视图导航配置（手动收纳 + 排序，替换自动收纳）

**Files:**
- Create: `src/renderer/src/components/Tasks/taskViewConfig.ts`
- Test: `src/renderer/src/components/Tasks/taskViewConfig.test.ts`
- Modify: `src/renderer/src/components/Tasks/TasksView.tsx`（删除 lines 106-120 自动收纳、替换 lines 666-668 与侧栏/更多渲染 lines 772-793；新增配置状态）

- [ ] **Step 1: 写失败测试**（新建 `taskViewConfig.test.ts`）

```ts
import { describe, expect, test } from 'vitest'
import { defaultTaskNavConfig, normalizeTaskNavConfig, parseTaskNavConfig } from './taskViewConfig'

describe('taskViewConfig', () => {
  test('默认：智能视图顺序，done 收进更多', () => {
    expect(defaultTaskNavConfig()).toEqual({ order: ['today', 'week', 'unplanned', 'all', 'overdue', 'done'], hidden: ['done'] })
    expect(parseTaskNavConfig(null)).toEqual(defaultTaskNavConfig())
    expect(parseTaskNavConfig('not json')).toEqual(defaultTaskNavConfig())
  })
  test('解析保留合法项并去掉不在 order 里的 hidden', () => {
    expect(parseTaskNavConfig('{"order":["all","today","view:x"],"hidden":["today","gone"]}')).toEqual({ order: ['all', 'today', 'view:x'], hidden: ['today'] })
  })
  test('归一化：补齐缺失智能键、追加新视图并默认收起、剔除已删视图', () => {
    const normalized = normalizeTaskNavConfig({ order: ['today', 'view:old', 'view:keep'], hidden: ['view:old'] }, [{ id: 'keep' }, { id: 'new' }])
    expect(normalized.order).toEqual(['today', 'view:keep', 'week', 'unplanned', 'all', 'overdue', 'done', 'view:new'])
    expect(normalized.hidden).toEqual(['view:new'])
  })
})
```

Run: `npx vitest --run src/renderer/src/components/Tasks/taskViewConfig.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现**（新建 `taskViewConfig.ts`）

```ts
export interface TaskNavConfig { order: string[]; hidden: string[] }
export const TASK_VIEW_CONFIG_KEY = 'chouyu:task-view-config:v1'
export const SMART_NAV_ORDER = ['today', 'week', 'unplanned', 'all', 'overdue', 'done'] as const

const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : []

export function defaultTaskNavConfig(): TaskNavConfig {
  return { order: [...SMART_NAV_ORDER], hidden: ['done'] }
}

export function parseTaskNavConfig(raw: string | null): TaskNavConfig {
  if (raw === null) return defaultTaskNavConfig()
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return defaultTaskNavConfig()
    const item = data as { order?: unknown; hidden?: unknown }
    const order = strings(item.order)
    return { order, hidden: strings(item.hidden).filter(key => order.includes(key)) }
  } catch { return defaultTaskNavConfig() }
}

/** 智能视图键为固定全集；自定义视图随增删同步，新视图默认收进「更多」。 */
export function normalizeTaskNavConfig(config: TaskNavConfig, views: { id: string }[]): TaskNavConfig {
  const viewKeys = new Set(views.map(view => `view:${view.id}`))
  const known = new Set<string>(SMART_NAV_ORDER)
  const appended = [...viewKeys].filter(key => !config.order.includes(key))
  const order = [
    ...config.order.filter(key => known.has(key) || viewKeys.has(key)),
    ...[...known].filter(key => !config.order.includes(key)),
    ...appended
  ]
  return { order, hidden: [...new Set([...config.hidden.filter(key => order.includes(key)), ...appended])] }
}
```

Run: `npx vitest --run src/renderer/src/components/Tasks/taskViewConfig.test.ts`
Expected: PASS

- [ ] **Step 3: TasksView 接线**

import 区加：

```ts
import { defaultTaskNavConfig, normalizeTaskNavConfig, parseTaskNavConfig, TASK_VIEW_CONFIG_KEY, type TaskNavConfig } from './taskViewConfig'
```

删除 lines 106-120（`const [visibleViewCount, setVisibleViewCount] = useState(4)` 起的整段 state + useEffect + ResizeObserver）。原位置加：

```ts
  const [navConfig, setNavConfig] = useState<TaskNavConfig>(() => { try { return parseTaskNavConfig(localStorage.getItem(TASK_VIEW_CONFIG_KEY)) } catch { return defaultTaskNavConfig() } })
  const [navStorageError, setNavStorageError] = useState('')
  const nav = normalizeTaskNavConfig(navConfig, views)
  useEffect(() => {
    try { localStorage.setItem(TASK_VIEW_CONFIG_KEY, JSON.stringify(nav)); setNavStorageError('') }
    catch { setNavStorageError('视图导航配置暂时无法保存，重启后可能恢复默认。') }
  }, [nav])
```

（`views` state 声明在 line 143，早于使用即可；如 TS 报使用先于声明，把上面整块移到 line 145 `const [views, setViews] = useState<TaskView[]>([])` 之后。）

替换 lines 666-668：

```tsx
  const visibleSmartViews = SMART_VIEWS.filter(view => view.id !== 'done').slice(0, visibleViewCount)
  const hiddenSmartViews = SMART_VIEWS.filter(view => !visibleSmartViews.includes(view))
  const hiddenViewSelected = selection.startsWith('view:') || hiddenSmartViews.some(view => view.id === navigationSelection)
```

为：

```tsx
  interface NavEntry { key: Selection; label: string; icon: IconName; custom?: TaskView }
  const navEntries: NavEntry[] = nav.order.flatMap(key => {
    if (key.startsWith('view:')) {
      const custom = views.find(item => `view:${item.id}` === key)
      return custom ? [{ key: key as Selection, label: custom.name, icon: 'filter' as IconName, custom }] : []
    }
    const smart = SMART_VIEWS.find(item => item.id === key)
    return smart ? [{ key: smart.id as Selection, label: smart.label, icon: SMART_ICONS[smart.id] }] : []
  })
  const visibleNavEntries = navEntries.filter(entry => !nav.hidden.includes(entry.key))
  const hiddenNavEntries = navEntries.filter(entry => nav.hidden.includes(entry.key))
  const hiddenViewSelected = nav.hidden.includes(selection.startsWith('view:') ? selection : navigationSelection)
```

（`interface NavEntry` 移到组件外文件顶部与 `ViewDraft` 并列，避免渲染内声明。）

侧栏视图列表（lines 773-777 的 `visibleSmartViews.map`）替换为：

```tsx
          {visibleNavEntries.map(entry => <li key={entry.key}>
            <button type="button" data-view-selection={entry.key} aria-current={navigationSelection === entry.key || selection === entry.key || undefined} onClick={() => setSelection(entry.key)}><TaskIcon name={entry.icon} /><span className="tasks-nav-label">{entry.label}</span><span className="tasks-count">{countFor(entry.key)}</span></button>
          </li>)}
```

「更多」弹层（lines 780-792）内：`{hiddenSmartViews.map(...)}` 整段替换为：

```tsx
            {hiddenNavEntries.map(entry => entry.custom
              ? <div className="tasks-more-view-row" key={entry.key}>
                <button type="button" data-view-selection={entry.key} aria-current={selection === entry.key || undefined} onClick={() => setSelection(entry.key)} title={entry.label}><TaskIcon name={entry.icon} /><span className="tasks-nav-label">{entry.label}</span><span className="tasks-count">{countFor(entry.key)}</span></button>
                <button type="button" className="tasks-more-view-action" aria-label={`编辑视图 ${entry.label}`} title="编辑视图" onClick={() => setViewDraft({ id: entry.custom!.id, name: entry.custom!.name, projectIds: [...entry.custom!.projectIds], priorities: [...entry.custom!.priorities], dueRange: entry.custom!.dueRange })}><TaskIcon name="edit" /></button>
                <button type="button" className="tasks-more-view-action tasks-item-menu-danger" aria-label={`删除视图 ${entry.label}`} title="删除视图" onClick={() => removeView(entry.custom!)}><TaskIcon name="trash" /></button>
              </div>
              : <button key={entry.key} type="button" data-view-selection={entry.key} aria-current={navigationSelection === entry.key || selection === entry.key || undefined} onClick={() => setSelection(entry.key)}><TaskIcon name={entry.icon} /><span className="tasks-nav-label">{entry.label}</span><span className="tasks-count">{countFor(entry.key)}</span></button>)}
```

`{views.length > 0 && <p className="tasks-tool-title">自定义视图</p>}` 删除（条目已混排）。「新建自定义视图」按钮保留。弹层顶部（第一个子元素位置）加：

```tsx
            <button type="button" className="tasks-more-view-create" onClick={() => setManageViewsOpen(true)}><TaskIcon name="fields" />管理视图</button>
```

并新增 state（`const [viewDraft, setViewDraft]` 附近）：

```ts
  const [manageViewsOpen, setManageViewsOpen] = useState(false)
```

存储错误提示（`sidebarSplit.storageError` 那行之后）：

```tsx
      {navStorageError && <p role="status" className="tasks-notice">{navStorageError}</p>}
```

既有 Escape 关闭 effect（lines 284-298）：条件改为 `if (!draft && !viewDraft && !fieldsOpen && !manageViewsOpen) return`，并在 `if (fieldsOpen) setFieldsOpen(false)` 之后加 `else if (manageViewsOpen) setManageViewsOpen(false)`。

- [ ] **Step 4: 验证 + Commit**

Run: `npm run typecheck && npx vitest --run src/renderer/src/components/Tasks/taskViewConfig.test.ts src/renderer/src/components/Tasks/Tasks.regression.test.ts`
Expected: PASS（回归第 4 测试断言 `{ id: 'today', label: '今天' }` 与 `{ id: 'done', label: '已完成' }` 来自 SMART_VIEWS，未删）

```bash
git add src/renderer/src/components/Tasks/taskViewConfig.ts src/renderer/src/components/Tasks/taskViewConfig.test.ts src/renderer/src/components/Tasks/TasksView.tsx
git commit -m "feat(tasks): sidebar views follow manual config with drag order support"
```

---

### Task 9: 管理视图弹层

**Files:**
- Create: `src/renderer/src/components/Tasks/TaskViewManageDialog.tsx`
- Modify: `src/renderer/src/components/Tasks/TasksView.tsx`（渲染 dialog、toggle/reorder 回调）
- Modify: `src/renderer/src/components/Tasks/Tasks.css`（追加样式）
- Test: `src/renderer/src/components/Tasks/Tasks.regression.test.ts`（断言追加）

- [ ] **Step 1: 回归守卫**（`Tasks.regression.test.ts` 第 1 个 test 断言列表追加）

```ts
    expect(read('TaskViewManageDialog.tsx')).toContain('role="dialog"')
    expect(read('TaskViewManageDialog.tsx')).toContain('aria-modal="true"')
```

Run: `npx vitest --run src/renderer/src/components/Tasks/Tasks.regression.test.ts`
Expected: FAIL（文件不存在；`read` 相对 import.meta.url，与现有用法一致）

- [ ] **Step 2: 实现 dialog**（新建 `TaskViewManageDialog.tsx`）

```tsx
import { useState, type DragEvent } from 'react'
import type { TaskView } from '../../../../shared/tasks'
import TaskIcon, { type IconName } from './TaskIcon'

export interface ManageViewEntry { key: string; label: string; icon: IconName; custom?: TaskView }

export default function TaskViewManageDialog({ entries, hidden, onClose, onToggle, onReorder, onEditView, onDeleteView }: {
  entries: ManageViewEntry[]
  hidden: string[]
  onClose: () => void
  onToggle: (key: string) => void
  onReorder: (order: string[]) => void
  onEditView: (view: TaskView) => void
  onDeleteView: (view: TaskView) => void
}) {
  const [order, setOrder] = useState(() => entries.map(entry => entry.key))
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ key: string; after: boolean } | null>(null)
  const rows = order.flatMap(key => { const entry = entries.find(item => item.key === key); return entry ? [entry] : [] })
  const move = (source: string, target: string, after: boolean) => {
    const keys = order.filter(key => key !== source)
    const index = keys.indexOf(target)
    if (source === target || index < 0) return
    keys.splice(index + Number(after), 0, source)
    setOrder(keys)
    onReorder(keys)
  }
  const rowDrag = (entry: ManageViewEntry) => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => { setDragKey(entry.key); event.dataTransfer.setData('application/x-chouyu-manage-view', entry.key); event.dataTransfer.effectAllowed = 'move' },
    onDragEnd: () => { setDragKey(null); setDropTarget(null) },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (dragKey === null || dragKey === entry.key || !event.dataTransfer.types.includes('application/x-chouyu-manage-view')) return
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const after = event.clientY > rect.top + rect.height / 2
      setDropTarget(current => current?.key === entry.key && current.after === after ? current : { key: entry.key, after })
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const id = event.dataTransfer.getData('application/x-chouyu-manage-view')
      if (id) move(id, entry.key, dropTarget?.key === entry.key ? dropTarget.after : true)
      setDragKey(null); setDropTarget(null)
    }
  })
  return <div className="tasks-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="tasks-dialog tasks-view-dialog" role="dialog" aria-modal="true" aria-labelledby="tasks-manage-dialog-title" onMouseDown={event => event.stopPropagation()}>
      <header className="tasks-dialog-header">
        <h2 id="tasks-manage-dialog-title">管理视图</h2>
        <button type="button" aria-label="关闭管理视图" onClick={onClose}>×</button>
      </header>
      <div className="tasks-form" aria-label="管理视图">
        <p className="tasks-composer-hint">拖动调整顺序；勾选「显示在侧栏」，未勾选的视图收进「更多」。</p>
        <ul role="list" className="tasks-manage-list">
          {rows.map(entry => <li key={entry.key} className="tasks-manage-row" data-order-insert={dropTarget?.key === entry.key ? (dropTarget.after ? 'after' : 'before') : undefined} data-dragging={dragKey === entry.key || undefined} {...rowDrag(entry)}>
            <span className="tasks-manage-drag" aria-hidden="true"><TaskIcon name="grip" /></span>
            <label className="tasks-manage-check">
              <input type="checkbox" checked={!hidden.includes(entry.key)} onChange={() => onToggle(entry.key)} aria-label={`显示 ${entry.label} 在侧栏`} />
              <TaskIcon name={entry.icon} /><span className="tasks-nav-label">{entry.label}</span>
            </label>
            {entry.custom && <>
              <button type="button" className="tasks-more-view-action" aria-label={`编辑视图 ${entry.label}`} title="编辑视图" onClick={() => onEditView(entry.custom!)}><TaskIcon name="edit" /></button>
              <button type="button" className="tasks-more-view-action tasks-item-menu-danger" aria-label={`删除视图 ${entry.label}`} title="删除视图" onClick={() => onDeleteView(entry.custom!)}><TaskIcon name="trash" /></button>
            </>}
          </li>)}
        </ul>
        <div className="tasks-form-actions">
          <button type="button" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  </div>
}
```

- [ ] **Step 3: TasksView 渲染与回调**

`TaskViewManageDialog` import 加到 import 区。`TaskBackupDialog` 渲染（line 1022）之后追加：

```tsx
      {manageViewsOpen && <TaskViewManageDialog
        entries={navEntries.map(({ key, label, icon, custom }) => ({ key: key as string, label, icon, custom }))}
        hidden={nav.hidden}
        onClose={() => setManageViewsOpen(false)}
        onToggle={key => setNavConfig(current => {
          const base = normalizeTaskNavConfig(current, views)
          return { ...base, hidden: base.hidden.includes(key) ? base.hidden.filter(item => item !== key) : [...base.hidden, key] }
        })}
        onReorder={next => setNavConfig(current => normalizeTaskNavConfig({ ...current, order: next }, views))}
        onEditView={view => { setManageViewsOpen(false); setViewDraft({ id: view.id, name: view.name, projectIds: [...view.projectIds], priorities: [...view.priorities], dueRange: view.dueRange }) }}
        onDeleteView={view => { void removeView(view) }}
      />}
```

- [ ] **Step 4: 样式**（`Tasks.css` 追加）

```css
.tasks-manage-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 50vh; overflow-y: auto; }
.tasks-manage-row { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 6px; border-radius: 6px; background: var(--bg-secondary); }
.tasks-manage-row[data-dragging] { opacity: .6; }
.tasks-manage-row[data-order-insert='before'] { box-shadow: 0 -2px 0 var(--accent); }
.tasks-manage-row[data-order-insert='after'] { box-shadow: 0 2px 0 var(--accent); }
.tasks-manage-drag { color: var(--text-muted); cursor: grab; display: grid; place-items: center; }
.tasks-manage-check { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; font-size: 13px; color: var(--text-primary); }
```

- [ ] **Step 5: 验证 + Commit**

Run: `npm run typecheck && npx vitest --run src/renderer/src/components/Tasks/Tasks.regression.test.ts`
Expected: PASS

```bash
git add src/renderer/src/components/Tasks/TaskViewManageDialog.tsx src/renderer/src/components/Tasks/TasksView.tsx src/renderer/src/components/Tasks/Tasks.css src/renderer/src/components/Tasks/Tasks.regression.test.ts
git commit -m "feat(tasks): manage-views dialog for sidebar pinning and drag order"
```

---

### Task 10: 收尾验证

**Files:** 无新增改动（验证与总结）

- [ ] **Step 1: 全量类型检查**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 2: 全量单元/回归测试**

Run: `npm test`
Expected: 全部 PASS（test:smoke 不在本批门禁；已知 chat 拖拽与 journal-search 间歇失败不影响本批）

- [ ] **Step 3: 构建产物自检（不发布）**

Run: `npm run build`
Expected: 构建成功。用字符串字面量抽查 `out/` 产物包含 `chouyu:task-view-config:v1` 与 `tasks-checklist-due`，确认新代码进包（仅验证，不重建分发）。

- [ ] **Step 4: 汇报**

向用户汇报完成情况，等待实机手验（视图管理弹层、卡片菜单、子项时间/提醒、分割线拖拽、双击恢复）。用户验收通过后合 master；**合并后必须重建 out/ 构建产物并再次用字符串字面量验证进包**（用户实测走主仓 out/ 产物）。合并 master 后把「任务系统」清单里 4 个待办在应用内标记完成。

---

## Self-Review 结论

- **Spec 覆盖**：spec 四节各对应 Task 4-9（第 1 节→Task 8/9，第 2 节→Task 4，第 3 节→Task 1/2/3/5/6，第 4 节→Task 7）；通用项（storageError、测试、分支流程）落在各任务与 Task 10。
- **占位符**：无 TBD/TODO；所有代码步骤给出完整代码。
- **类型一致性**：`ClaimedReminder` 在 Task 2 定义并被 scheduler 引用；`TaskNavConfig`/`normalizeTaskNavConfig` 在 Task 8 定义、Task 9 复用；`NavEntry`（组件外声明）供 Task 8/9 共用；`parseSidebarSplit` 命名一致。
