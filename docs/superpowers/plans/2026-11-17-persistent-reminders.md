# 持续提醒实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 所有主动提醒分别记录阅读与处理；未处理事项持续提醒，告知明确接收、业务实际处理后停止。

**Architecture:** 在现有应用数据库的状态存储中持久化提醒事项，首次投递与事项同事务提交。主进程统一调度，通过现有待办与联系人接口核对来源；聊天复用一组操作组件，原执行引擎不变。

**Tech Stack:** TypeScript、Electron、SQLite、React、Vitest。

**Spec:** `docs/contact-task-spec.md` 第 7 节（2026-11-17），REM-01～REM-06。

## Global Constraints

- 已读不等于已处理；所有主动消息未读闪烁；普通聊天回复不转成催办。
- 问候、晨报、成果通知需明确「知道了／已阅」；正文不重复生成或复制。
- 复用公共任务/交互入口、身份及投递回执；不添加批量操作、多字段任务配置。
- 默认间隔采用30分钟，允许1～1440分钟；单次延后沿用10/30/60分钟。
- 新机制自动接管新投递和已有有效稍后计划；不追溯催办旧告知。清空原消息/删除会话使该来源失效，不复活正文。
- 暂停职责仅停止新触发，既有未处理告知仍需确认；明确删除来源使旧提醒失效。
- 原生退出/休眠不能执行；恢复合并同一会话到期项，每项保留操作。

## Review Focus

- 投递提交后进程退出：原消息与跟进计划不得分离；SQLite事务和重启集成测试覆盖。
- 异步查询期间处理/延后：按版本复查，旧查询不得覆盖新状态或继续发送。
- 催办本身与晨报引用：不递归创建事项，不把接收汇总当作处理所引问题。
- 完成待办后提醒状态落盘失败：恢复依真实业务状态对账，不重复完成操作。
- 存储损坏或查询失败：保留事项和可见错误，不能当成来源已删除。

### Task 1: 持久事项与可靠投递

**Files:** `src/shared/reminder-followups.ts`, `src/main/reminders/enrollment.ts`, `src/main/database.ts`, `src/main/storage/conversations.ts`, shared/renderer message types。
**Interfaces:** `ReminderItem`、`ReminderSource`、`ReminderView`；消息 `reminderIds?: string[]` / `reminderFollowup?: boolean`；`getReminderItems()` / `saveReminderItems(items)`；数据库首次投递自动登记。
- [x] 先写真实数据库投递/重启/去重/旧快照保护测试，观察失败。
- [x] 首次投递在同一事务登记；同源任务或交互统一ID；显式催办只引用事项。
- [x] 测试通过；普通聊天、失败投递及清空后不复活回归。

### Task 2: 调度、来源处理与自然语言工具

**Files:** `src/main/reminders/followups.ts`, `sources.ts`, `tools.ts`, `index.ts`, `src/main/tasks/index.ts`, 联系人只读来源命令。
**Interfaces:** `FollowupService` 通过存储、异步来源核对、投递、完成待办和时间端口提供 `list/acknowledge/postpone/setInterval/markRead/tick`；版本参数防旧页面覆盖。
- [x] 先测试连续重复、延后、合并、重启、来源完成/失效/读取失败、并发与持久失败。
- [x] 实现带版本复核的串行调度，先可靠投递再推进时间，回执防重复；补只读来源状态与完成待办适配。
- [x] 接管已有有效稍后计划，原延后API兼容；提供当前会话范围的查询/单项调整工具。
- [x] 专项测试及类型检查。

### Task 3: 共用提醒操作与集成验收

**Files:** `src/preload/bridges/reminders.ts`, `src/renderer/src/components/ChatPanel/ReminderActions.tsx`, `MessageArea.tsx`, `ChatPanel.css`, `src/main/smoke/reminders-smoke.ts`。
**Interfaces:** `ReminderAPI` 新增 `items(sessionId)`、`act(id,revision,action,minutes?)`；所有消息通过 `reminderIds` 关联同一操作组件。
- [x] 先验证告知确认、任务完成、跳转原消息/交互、明确标读与状态展示。
- [x] 复用现有操作区提供处理、单次延后与持续间隔；失效/失败明确显示，异步刷新不串会话。
- [x] 真实 Electron 走持久保存、页面重载、来源状态更新；375/1024深浅色截图检查。
- [x] `npm test`、`npm run typecheck`、`npm run check:boundaries`、`npm run build`、提醒及任务相关冒烟；独立审查。
- [x] 更新现行规范与使用说明，记录真实测试证据与平台验收边界。

## 执行记录

- 用户已要求实现；直接在当前工作区的新功能分支执行，不另要求确认既有产品约定。
- 本计划兼作进度记录；代码及规范保留为工作区改动，未经要求不发布或重启用户正在使用的应用。
- 完成证据：全量 2425 项通过、62 项跳过；类型、模块边界、构建、提醒/任务日程/助手安排 Electron 专项通过，8 张深浅色及窄屏截图已检查。独立审查发现的重试过早结束、跨会话绑定、来源变化并发与分组失败恢复问题均修正并增加回归；详见 `docs/persistent-reminders-acceptance-20261117.md`。
