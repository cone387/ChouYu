# AgentSpace 模块重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有联系人后台分解成实际参与运行的 AgentSpace、ContactAgent、WorkLoop 和系统级联系人任务存储入口，保持现有产品行为，并隔离单个请求超时。

**Architecture:** AgentSpace 装配联系人模块、路由唤醒和分配执行名额；ContactAgent 持有独立身份与模块实例；WorkLoop 选择本人的可运行任务并驱动现有工作策略。任务、成果和待投递消息继续使用原 SQLite 事务；不新建第二套任务池。

**Tech Stack:** TypeScript / Electron utilityProcess / SQLite / LangGraph / Vitest。

**Spec:** `docs/contact-task-spec.md`，本轮会话确认的三层架构及六项边界；实施边界见下。

## Global Constraints

- 新项目，不保留旧类名或转发兼容入口；更新全部实际消费者和测试。
- 任务 UI、单描述设置、各联系人额度、结果原子提交、迟到结果校验、主动未读闪烁保持产品规范。
- 本次是现有联系人后台的模块重构；用户待办及 ChouYu 定时引擎不为目录统一重写，普通聊天仍由主进程承载。
- TaskCenter 首先接管现有联系人任务持久化实现；其他任务域可以独立适配，禁止复制数据或伪称已统一所有执行引擎。
- WorkLoop 通过 Harness 模块能力入口执行；原生支持逐轮预算钩子。DSH 未提供此契约时拒绝后台调用，不把聊天选择偷换成后台引擎选择，不伪称支持。
- 常驻仅限应用存活期间，不增加系统服务、远程节点、抢单池或新的设置 UI。

## Review Focus

- 一个请求慢或超时，不应停止其他联系人的执行；只有探活失败才重启共享进程。
- 同一任务取消后旧请求未退出时，新轮次不得抢占其名额或保存旧结果。
- 关闭/卸载 WorkLoop 后保留任务、成果及可恢复轮次，且不能被定时器复活。
- 联系人身份更新和删除不得串用权限、技能快照或模型配置。
- 资源名额释放、重启恢复、结果事务和逐轮预算不能因模块边界改变而失效。

## Task 1: 独立执行资源与联系人模块生命周期

**Files:** Create `src/main/agent-space/scheduler.ts`, `events.ts`; `src/main/contact-agent/contracts.ts`, `registry.ts`, `agent.ts` and adjacent tests.

**Interfaces:**
- `RunScheduler.launch(key: { id; characterId; topicId }, limit: number, execute: (signal: AbortSignal) => Promise<void>): boolean`；`activeFor(characterId, topicId?)`, `abort(characterId, topicId?)`, `drain(characterId?)`。
- `ContactModule { id: string; prepare?(): void; advance?(): boolean; close(): Promise<void> }`。
- `ContactAgent` 持有 `ContactIdentity`，装配模块，分别驱动准备/推进；关闭模块时释放订阅并等待实际退出。
- `ModuleRegistry` 验证重复 ID 与未知模块；模块依赖通过显式 factory 参数注入。

- [ ] 写并运行失败测试：全局/联系人限额、同任务串行、取消不提前释放、关闭幂等、模块独立装配、重复注册拒绝。
- [ ] 实现上述接口；调度器总并发默认 8，可在构造配置调整，不增加环境变量。
- [ ] 运行相邻测试，确认异常回收和资源释放。

## Task 2: 将现有后台接入三层模块

**Files:** Move `agents/store.ts` → `task-center/store.ts` (`TaskCenter`), `agents/runtime.ts` → `workloop/workflow.ts` (`WorkStrategyRuntime`), `agents/worker-rpc.ts` → `agent-space/worker-rpc.ts`；replace `agents/service.ts` with `agent-space/service.ts` (`AgentSpace`), extract `task-center/commands.ts`, `workloop/loop.ts`, `workloop/model.ts`; update all imports and worker construction.

**Interfaces:** 保留现有 IPC 数据协议；`AgentSpace.sync/request/tick/close` 是组合根接口，任务命令由 `ContactTaskCommands` 实现，WorkLoop 获得联系人绑定的依赖。

- [ ] 添加集成失败测试：两联系人公平获得全局名额、关闭一个 WorkLoop 不停另一个、关闭后不复活、任务历史保留。
- [ ] 搬迁实现并更新真实调用方；现有结果事务和工作策略保留，不增加旧入口别名。
- [ ] 执行联系人并发、取消、删除、任务状态、成果投递、设置、预算和恢复测试；运行 typecheck。

## Task 3: 后台 Harness 契约与 RPC 健康检查

**Files:** Modify `harness/contracts.ts`, `harness/registry.ts`, `harness/native/index.ts`; create `harness/background.ts` and tests; modify `agent-space/worker-rpc.ts`, `agents/worker.ts`, `agents/index.ts` and RPC tests。

**Interfaces:** `HarnessModule.background` 提供与工具调用轮次绑定的 `beforeRound/afterRound`、超时、用量及取消；`HarnessRegistry.background(engine)` 对未实现能力的模块拒绝调用。worker 通过独立于命令队列的 ping/pong 接受探活。

- [ ] 先验证拒绝不支持模块、预算钩子和取消透传的失败测试。
- [ ] 原生执行通过模块注册入口接入 WorkLoop，不再由 WorkLoop 直接导入原生 runner。
- [ ] RPC 测试先证实慢请求会杀共享进程；改为超时拒绝该请求并探活，ping 超时才 kill；隔离旧 generation、迟到结果与心跳。
- [ ] 对健康但慢的 worker、卡死 worker、启动超时、等待队列超时分别验证。

## Task 4: 回归、独立审查与验收记录

- [ ] 执行 `npm test`、`npm run typecheck`、`npm run build`。
- [ ] 运行 Electron `--agents`、`--assistant-routines`、`--companion` 隔离冒烟，记录真实命令与结果。
- [ ] 对整分支进行一次独立审查，修复影响正确性的缺陷并回归。
- [ ] 更新架构文档、任务规范中的实现状态和验收记录，明确 DSH 后台能力与长期真实运行的剩余边界。
- [ ] 提交到功能分支，保留可审查改动；未收到本轮合入指令时不合入主分支。
