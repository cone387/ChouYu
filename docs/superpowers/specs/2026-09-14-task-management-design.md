# 内置任务模块（2026-09-14）

## 背景与决策

让 ChouYu 成为统一任务入口并具备主动提醒能力。与用户确认的关键决策：

1. **内置模块**，与接续卡**完全独立并行**：不迁移接续卡数据、不共享状态，接续卡保持纯按日召回定位。
2. **任务来源**：手动创建；聊天中 AI 建任务（逐次确认，遵循「模型建议不自动成为已确认待办」）；日志产物（接续卡待确认问题、周报未完成项等）**手动**转任务。不做任何自动转任务。
3. **提醒触达**：系统通知 + 主动消息中心留档（用户已选，不做独立提醒弹窗）。
4. **V1 字段**：标题、备注、截止日、提醒、优先级、重复任务、**独立项目概念**（不绑日志项目）。
5. **架构**：主进程独立 SQLite + 主进程到期调度；**交付分两期**，插入哪一轮待实施计划评审后决定。

现状可复用先例：`src/main/journal/index.ts:29` 的 Electron `Notification`；`src/main/tools/registry.ts` 的 `requiresConfirmation` 工具授权框架；`src/renderer/src/core/proactive.ts` 消息中心引擎；`src/main/memory/sqlite-provider.ts` 的主进程 SQLite 模式；`WorkspaceNav.tsx` 的 `WorkspacePage` 页面注册与 `App.tsx` 的 `workspaceRequest` 切换。

## 数据模型与存储

新模块 `src/main/tasks/`，独立数据库文件（`userData/tasks.db`），与聊天库、日志库、记忆库零共享，**不进任何保留期清理**。迁移沿用 `user_version` 版本链，拒绝高于当前支持的版本（照日志库惯例）。

```sql
task_projects(id TEXT PK, name TEXT UNIQUE NOT NULL, archivedAt INTEGER, createdAt INTEGER NOT NULL)
tasks(
  id TEXT PK, title TEXT NOT NULL, note TEXT,
  projectId TEXT,                 -- 可空；引用 task_projects.id
  priority TEXT NOT NULL,         -- 'high' | 'medium' | 'low'，默认 'medium'
  status TEXT NOT NULL,           -- 'open' | 'done'
  dueAt INTEGER,                  -- 截止时刻（ms），可空
  remindAt INTEGER,               -- 提醒时刻（ms），可空
  remindFiredAt INTEGER,          -- 已触发标记；写入后才允许发通知，保证只发一次
  recurrence TEXT NOT NULL,       -- 'none' | 'daily' | 'weekly' | 'monthly'
  recurrenceAnchorAt INTEGER,     -- 重复锚点（首次截止时刻）
  sourceType TEXT, sourceId TEXT, -- 二期日志转任务的来源回链（journal task / continuation / weekly）
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, completedAt INTEGER
)
```

- `recurrence` 列一期建好但逻辑二期实现，避免二次迁移。
- **重复任务语义**：完成时按锚点生成下一期**新任务实例**（继承标题/备注/项目/优先级/重复设置），已完成的保留为历史，不改写原记录。
- 损坏处理：打开/校验失败时重命名隔离原文件、空库重建、消息中心告知（沿用聊天库隔离思路）。

## 调度与提醒

主进程 `TaskScheduler`：启动时与每 30 秒 tick。**启动时**先处理积压：`remindAt <= now AND remindFiredAt IS NULL` 的全部视为「错过」，只标记 `remindFiredAt` 并合并发一条「错过了 N 条任务提醒」（N 为 0 时不发），不逐条通知。**运行中 tick** 同条件查询，此时命中即为刚到期任务，逐条走：

1. 先写 `remindFiredAt`（先写后发：写库失败则本次不发，下个 tick 重试）。
2. Electron `Notification`（`isSupported()` 为假或显示失败时跳过，不阻塞后续步骤）。
3. `webContents.send('tasks:reminder', task)` → 渲染端 ProactiveEngine 记 `kind: 'task'` 消息。
- **通知点击**：显示主窗口并切到任务页；消息中心 `task` 条目点击行为一致（复用 `workspaceRequest`）。
- **设置开关**：任务系统通知可独立关闭；关闭后仅走消息中心。
- 系统休眠/时钟回拨：tick 以 `Date.now()` 比较，唤醒后自然补发（走错过合并路径）。

## IPC 与渲染端

`electronAPI.tasks.*`：`list / create / update / complete / delete`，`projects.list / create / rename / archive`；事件通道 `tasks:reminder`。

**UI（工作区新增「任务」页，`WorkspacePage` 增加 `'tasks'`）**

- 左栏：智能视图（今天 / 本周 / 过期 / 全部）+ 项目列表（含归档分组）；右栏：任务列表 + 新建/编辑表单。
- 列表排序：过期 > 今日截止 > 优先级（高→低）> 截止时刻 > 创建时间倒序；已完成默认折叠。
- 任务卡片：勾选完成、优先级色条、项目名、截止时间；表单：标题必填，项目可就地新建，提醒快捷项（截止时 / 提前 30 分钟 / 提前 1 小时 / 提前 1 天 / 不提醒，默认截止时），无截止日时仅剩「不提醒」可选，不做任意自定义提前量。
- 空状态、错误提示与日志页现有模式一致；键盘全程可操作（Enter 新建/保存、Space 完成、Esc 取消、列表方向键）。
- 按迭代规则覆盖 375px 窄屏、暗色、焦点可见与减少动画。

**二期入口**

- 聊天工具 `create_task`（`requiresConfirmation: true`，复用现有工具授权 UI；入参：标题/备注/截止/优先级/项目名）。
- 接续卡待确认问题、周报未完成项处加「转为任务」按钮：预填新建表单并写 `sourceType/sourceId`，不自动创建。

## 边界与非目标（YAGNI）

- 不做：子任务、标签、外部任务工具同步/导入、与日志项目打通、接续卡自动引用任务、重复提醒/贪睡（消息中心自身 snooze 够用）、任务统计报表、全局搜索集成（后续按需要另起）。
- 提醒每任务只触发一次；完成后未触发的提醒作废；删除即取消。
- 项目仅一层，无嵌套；项目名唯一，删除项目前需先移走或随项目归档（一期只做归档不做硬删除）。

## 测试与验收

- **单测**：调度器（到期触发、只发一次、写库失败不发、错过合并、时钟边界）；CRUD 与项目名唯一；重复任务下一期锚点（日/周/月跨月）；迁移版本链与拒绝未来版本；损坏隔离重建。
- **Electron 冒烟**：建任务设 1 秒后提醒 → 收到系统通知 + 消息中心记录；完成/删除后不再提醒；重启后任务与项目数据仍在；通知不可用时消息中心仍可达。
- **UI**：375px、暗色、键盘流、减少动画各有断言或截图。
- **门禁**：`typecheck:node` / `typecheck:web`、vitest 全量、生产构建、Electron 冒烟。

## 分期与待定项

- **一期**：存储与迁移、任务/项目 CRUD、优先级、截止与提醒、调度器、系统通知 + 消息中心、任务页 UI。
- **二期**：重复任务生成逻辑、`create_task` 聊天工具、日志产物转任务入口。
- 待实施时决定：插入哪一轮迭代；导航图标 path 与优先级色 token 具体取值。
