# 应用与界面边界 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or the user-selected superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 IPC、工作区与业务页面各自拥有明确职责，保持所有现有交互。

**Architecture:** IPC 域注册调用应用服务，preload 提供域桥；Workspace 拥有跨页面状态，ChatPanel 只呈现聊天，TasksView 组合查询、命令、草稿与列表。

**Tech Stack:** 现有 Electron/React/TypeScript/Vitest，无新依赖。

**Spec:** [完整设计 A](../specs/2026-10-22-system-evolution-design.md)。全局约束与 Review Focus 继承[总计划](2026-10-22-system-evolution.md)。

## Global Constraints

保持现有 IPC channel 与 `electronAPI` 兼容；模型执行经 ContactAgent.Chat；面板关闭不等于停止；不改产品布局、焦点装饰和任务编辑契约。

## Review Focus

总计划第 2 项由 Task 2/3 覆盖。额外关注同名 requestId 在不同 renderer 的隔离、工具确认在页面隐藏期间仍有效、配置变更导致旧请求失效、域注册重复或退出残留监听。

### Task 1: IPC 分域与聊天生命周期

**Files:** 新建 `src/main/chat/service.ts`、`src/main/chat/service.test.ts`、`src/main/ipc/{chat,sessions,memory,config,capture,desktop}.ts`、`src/main/ipc/registration.test.ts`、`src/preload/bridges/{chat,sessions,memory,config,capture,desktop,agents,tasks,journal,skills,reminders}.ts`；修改 `src/main/ipc.ts`、`src/main/index.ts`、`src/preload/index.ts`。其他已独立的域入口保持原位置，通过 root 装配。

**Interfaces:** `ChatService.run(sender: ChatSender, request: AIStreamRequest): Promise<AIStreamResult>`、`cancel(senderId: number, requestId: string): void`、`close(): Promise<void>`；`ChatSender` 定义 `id`、`isDestroyed()`、`send(channel, payload)` 和生命周期订阅端口，服务不导入 `ipcMain`。域注册 `registerXHandlers(context): () => void` 返回精确注销函数。preload 各 bridge factory 只构造原域 API。

- [ ] 在 service/registration 测试中固定“两个 sender 同 requestId 取消互不影响”“隐藏面板不取消”“销毁 sender 按原规则取消”“删除联系人/退出等待工具结束”“注册与注销无重复 listener”。断言实际 ContactAgent 入口被调用，不能只断言字符串。
- [ ] 运行 `npm test -- src/main/chat/service.test.ts src/main/ipc/registration.test.ts`，确认新契约测试在实现前失败。
- [ ] 从现有 `ipc.ts` 迁移业务编排到 ChatService，保留请求校验、模型路由、记忆回执、引用复核与工具确认；配置/记忆等注册按域迁出；中央文件仅组装。preload 组装同一个 API，并保留 pending-event 行为。
- [ ] 运行上述测试及 `src/main/ai-request-lifecycle.test.ts`、`src/main/harness`、`src/preload/pending-event.test.ts`；`npm run typecheck`。构建后 `--chat-close`/`--chat-edit` 实际验证，不把源码断言作为生命周期证据。
- [ ] 提交 `refactor: separate IPC domains and chat application lifecycle`，记录 A1 状态。

### Task 2: Workspace 与聊天页面

**Files:** 新建 `src/renderer/src/components/Workspace/Workspace.tsx`、`useWorkspaceNavigation.ts`、`workspaceNavigation.test.ts`、`useWorkspaceOverlays.ts`；修改 `App.tsx`、`components/ChatPanel/ChatPanel.tsx`、`useSessionWorkspace.ts`、`components/Contacts/contactNavigation.ts`、`contactReturnLocation.ts` 及对应回归；新增 `src/main/smoke/workspace-evolution-smoke.ts` 并接入既有 navigation smoke。

**Interfaces:** `Workspace` 接收原 ChatPanel 的窗口位置/显示和宠物状态端口。导航 hook 返回 `navigate(request: WorkspaceNavigationRequest): Promise<void>`、`returnToOrigin(): Promise<void>`、当前 page/return token；请求联合覆盖聊天、任务、日志、联系人、记忆和设置，复用现有 `ContactNavigationRequest`。弹窗 hook 提供顶层 Esc/返回焦点协调，不复制各业务表单。

- [ ] 添加导航测试：跳转到任务后返回原联系人/会话/阅读位置；来源删除明确失败；迟到结果不能改当前导航；隐藏页面仍保留草稿和进行中请求。
- [ ] 先运行 `npm test -- src/renderer/src/components/Workspace/workspaceNavigation.test.ts` 见失败，再迁移状态权威；页面保活仍在 Workspace 生命周期内。ChatPanel 不再导入 TasksView、Journal、Settings 等业务页。
- [ ] 将原来源打开、全局搜索及工具确认渲染接到同一 Workspace；保持同一个会话 hook 实例，避免切页重建生成状态。异步返回使用原 epoch/版本规则。
- [ ] 运行 `npm test -- src/renderer/src/components/Workspace src/renderer/src/components/Contacts/contactReturnLocation.test.ts src/renderer/src/App.layout.test.ts`，更新路径敏感旧测试时保持原产品断言。
- [ ] 构建后运行 `--navigation`、`--chat-close` 和新增 smoke 场景，实际查看宽/窄、明/暗截图；确认 Esc 仅关顶层、返回焦点和鼠标穿透。
- [ ] 提交 `refactor: make workspace own navigation and page lifetime`，记录 A2 的 Workspace 证据。

### Task 3: TasksView 职责与依赖门禁

**Files:** 新建 `src/renderer/src/components/Tasks/useTaskData.ts`、`useTaskCommands.ts`、`useTaskDrafts.ts`、`TaskList.tsx`、`taskData.test.ts`；修改 `TasksView.tsx` 与 `Tasks.regression.test.ts`；新增 `scripts/check-module-boundaries.cjs`、`src/shared/module-boundaries.test.ts`；修改 `package.json` 增加 `check:boundaries`。

**Interfaces:** `useTaskData(query, active)` 返回原任务/清单/分组/计数及 `reload()`；`useTaskCommands({ reload, onError })` 包装原单任务 API；`useTaskDrafts()` 拥有原弹窗草稿/保存/取消状态；TaskList 接收任务及单任务事件，不自行读 IPC。边界脚本解析真实 TypeScript import/export/import type/dynamic import/require，返回非零退出码和实际边。

- [ ] 固定迟到查询、后台 invalidation、跨日刷新、保存失败留稿、筛选排序随视图保存测试；新 hook 行为测试实现前失败，原任务回归保持。
- [ ] 抽取真实职责并接到 TasksView，避免把原整组件换名后仍集中所有状态。保留列表/看板同源与拖动单任务语义，不新增多选。
- [ ] 为边界脚本提供合法/非法 import 夹具：shared→main/renderer、domain→IPC、TaskCenter→renderer、业务页互导均可识别；旧边若必须过渡，使用精确路径及原因的有限 allowlist，不能用目录通配掩盖。
- [ ] 运行 `npm test -- src/renderer/src/components/Tasks src/shared/module-boundaries.test.ts`、`npm run check:boundaries`、`npm run typecheck`；构建后 `--task-views`、`--task-edit`、`--task-scheduling`，查看截图。
- [ ] 提交 `refactor: isolate task view responsibilities and enforce module boundaries`，记录 A2/A3 完成依据。
