# Contact Request Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 关联已接纳任务请求的原始消息、任务、实际执行与结果，保证持久幂等并验证恢复边界。

**Architecture:** 扩展现有 ContactTaskStore 与 feedback 命令；原始来源由聊天宿主传入并随确认卡片保存。调度和模型边界记录实际输入，成果事务绑定结果。共用互动视图读取有界请求记录。

**Tech Stack:** TypeScript、Electron、React、better-sqlite3、Vitest；沿用既有依赖。

**Spec:** `docs/contact-task-spec.md` 与 `docs/superpowers/specs/2026-11-05-contact-request-reliability-design.md`

## Global Constraints

- 任务设置仅一个自然语言描述；保留共同任务 UI 与全部主动消息未读闪烁。
- 不自动恢复暂停/结束任务，不自动重发中断普通聊天，不重放不确定外部副作用。
- 权限/归属/版本在写入边界检查；正式成果、进度、通知与结果关联共同提交。
- 原生和 DSH 共用宿主边界；旧数据来源不补造。

## Review Focus

- 同一请求在重启后以新工具调用 ID 出现：只能保存一次。
- 用户确认较早的卡片：保留原请求来源，旧任务版本仍拒绝。
- 新要求取消旧轮次：旧结果不能完成新请求；后续轮次包含全部待处理要求。
- 模型入口失败或只返回计划：不能声称产生实际成果。
- 删除、跨联系人和分页并发：不泄露记录，不重复或跳过游标范围内记录。

### Task 1: 持久请求账本与任务命令

Files: 新增 `src/shared/contact-task-requests.ts`、`src/main/task-center/contact/requests.ts` 及真实数据库测试；修改 `contact-store.ts`、`commands.ts`、`contact-commands.ts`。
Interfaces: `ContactTaskRequests.apply(owner, submission, mutate)` 在同步事务内返回原始接纳回执；`get`/`list` 只读查询；`bindRun`/`supplied`/`complete` 记录实际链路。

- [x] 写重启幂等、冲突负载、失败回滚、归属和分页测试并确认预期失败。
- [x] 实现账本，提取共用同步任务变更命令；副作用保留在事务之后。
- [x] 运行该专项及既有任务命令/反馈测试。

### Task 2: 聊天和确认来源接入

Files: `chat/execution.ts`、`harness/tools.ts`、`tools/registry.ts`、`agents/tools.ts`、`agents/index.ts`、`shared/contact-actions.ts` 及集成测试。
Interfaces: `TaskRequestSource` 仅由宿主提供，持久卡片保存同一来源；通用任务工具通过 feedback 提交请求，重放在过期版本预检前读取已保存回执。

- [x] 测试真实工具的连续补充、稳定身份、确认来源、跨任务冲突及原文保存。
- [x] 实现宿主来源、卡片传递和工具提交；保留现有权限策略。
- [x] 运行聊天路由、工具、动作与命令集成测试。

### Task 3: 执行、成果和查询

Files: `contact/scheduling.ts`、`workloop/model.ts`、`contact/completion.ts`、共享 API/preload、现有 `ContactTaskInteractions.tsx` 及请求记录组件。
Interfaces: 请求快照在轮次建立时绑定，发往模型时记录实际证据；正式成果事务内关联版本；互动视图只读分页并链接现有轮次记录。

- [x] 测试保存后/执行中/提交后重启、旧轮次拒绝、两条要求均入执行、无成果状态和结果回滚。
- [x] 接入共同模型边界与成果事务，补充只读有界查询及共用互动展示。
- [x] 运行原生/DSH相关模型夹具、存储与 UI 专项。

### Task 4: 工具契约与最终验证

Files: 新增模型接口契约测试；更新 `docs/contact-task-spec.md`、`docs/current-status.md`、本轮验收文档。

- [x] 用路由输出夹具走真实注册工具/Schema，覆盖指代歧义、引用不授权、错误工具/参数和成功操作。
- [x] 运行 typecheck、check:boundaries、相关专项与全量 npm test、生产构建。
- [x] 独立代码审查，修正实质问题并复测；记录证据与未覆盖边界。

## 执行记录

- 用户已要求开始实施；采用本会话连续执行，不重复询问既有产品约定。
- 独立工作区：`C:/Users/Administrator/.codex/worktrees/6e48/ChouYu`，分支 `codex/contact-request-reliability`。
- 接口裁决：来源在 `chat/execution.ts` 包装公共工具入口，未额外改写 Harness 工具执行器；持久问题答复增加内部命令，同事务记录原话。用户消息增加持久 `editRevision`，重试复用、编辑重发递增。
- 跨进程串联测试放在 `src/integration/task-request-retry.test.ts`，生产主进程与 renderer 仍由各自 TypeScript 工程检查，不混合编译边界。
- 独立审查提出的重试身份问题已 RED→GREEN；旧页刷新按实际阅读影响提升为必修项，Electron RED→GREEN。最终全量 2341 通过 / 63 跳过，类型、边界和生产构建通过；Task 4 关闭。此前 DSH 测试失败及未覆盖边界保留在验收记录中。
