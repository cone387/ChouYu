# 交付与任务契约 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or the user-selected superpowers:subagent-driven-development. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将所有主动来源接入共同交付服务，补强任务类型契约并拆分联系人 Store 职责。

**Architecture:** 接收端交付服务使用现有数据库持久接口，源端 outbox 仍属于各域事务；任务域用类型映射分派；Store 子模块共享原连接。

**Tech Stack:** TypeScript、Electron、better-sqlite3、Vitest。

**Spec:** [完整设计 B/C/D](../specs/2026-10-22-system-evolution-design.md)，全局约束和 Review Focus 继承[总计划](2026-10-22-system-evolution.md)。

## Global Constraints

任何源域确认均在消息和回执持久成功之后；所有未读同等闪烁；引用已保存正文；保留域原状态语义和单一结果事务。

## Review Focus

总计划第 1/5 项由 Task 1 覆盖；Task 2 覆盖运行时错域/越权/卸载后旧句柄；Task 3 覆盖提交中断及取消期间额度占用。

### Task 1: 共同消息交付及实际接入

**Files:** 新建 `src/main/messaging/contracts.ts`、`service.ts`、`service.test.ts`、`index.ts`；修改 `src/main/database.ts`/`.test.ts`、`src/main/agents/index.ts`、`assistant-routines/index.ts`、`tasks/index.ts`、`reminders/index.ts`、`reminder-events.ts`、计划一拆出的主动消息 IPC 域；新建 `src/main/messaging/integration.test.ts`。

**Interfaces:** `DeliveryRequest` 为 `{ kind: 'assistant'; content; timestamp?; messageKind?; receiptIds; taskReminder?; snoozeKey?; messageId? } | { kind: 'agent'; notice: AgentNotice } | { kind: 'interaction'; card: ContactActionInteraction }`。`MessageDeliveryService.deliver(request: DeliveryRequest): DeliveryReceipt`；回执至少包含稳定交付键与 `persisted: true`。仓储端口仅在持久成功后返回，通知端口故障单独记录并可补发，不撤销已提交消息或重复插入。

- [x] 测试保存失败不确认源域、内存待保存消息重试一次、广播失败仍不重复、清空后重启不复活、错 owner/source 拒绝、已读只覆盖可见消息。对三类 DeliveryRequest 分别覆盖。
- [x] 先运行 `npm test -- src/main/messaging/service.test.ts src/main/messaging/integration.test.ts` 确认新测试失败；抽取原追加校验与通知编排，避免复制原正文。
- [x] 将联系人 outbox、交互卡片、ChouYu 安排/工作检查、待办提醒、稍后提醒与 proactive IPC 全部接入。源域 ack 保持原位置，但只能消费已持久回执；接收端 receipt key 继续兼容旧值。
- [x] 运行新测试与 `src/main/database.test.ts`、`src/main/agents/notices.test.ts`、`src/main/assistant-routines`、`src/main/reminders`、`src/main/tasks/index.test.ts`、tray 测试；构建后 `--agents`、`--assistant-routines`、`--companion`、`--reminders` 验证真实投递与未读。
- [x] 提交 `refactor: unify durable proactive message delivery`，逐来源记录调用链 B1。

### Task 2: 三域及联系人 RPC 命令契约

**Files:** 新建 `src/shared/contact-commands.ts`、`src/main/task-center/command-types.test.ts`、`src/main/task-center/command-validation.test.ts`；修改 `src/main/task-center/{contracts,service,contact-domain,todo-domain,assistant-domain,commands}.ts`、`src/main/agent-space/{service,worker-rpc,worker-commands,workloop-host}.ts`、`src/main/workloop/loop.ts`、`src/main/agents/{index,worker}.ts` 及真实调用者。

**Interfaces:** `ContactCommandMap` 为方法名→`{ args: [...]; result: ... }`；`ContactCommandName = keyof ContactCommandMap`。`request<M extends ContactCommandName>(method: M, owner: string, args: ContactCommandMap[M]['args']): Promise<ContactCommandMap[M]['result']>`。动态外部输入先走 `dispatchUnknown(method: unknown, owner: unknown, args: unknown)` 验证，再调用类型化分派。todo/assistant 复用原方法签名推导参数与返回值；`TaskCenter` 的域名和操作保持泛型关联。

- [x] 编译断言固定 `todo` 不能调用联系人 `assignTopic`、数值版本不能传字符串、delivery 返回值不是 task；用 `@ts-expect-error` 验证错误确实被编译器拒绝。运行时测试拒绝未知命令、非数组参数、错 owner、旧 revision、已卸载旧绑定。
- [x] 先运行新测试与 `npm run typecheck`，确认缺失新契约或错误未被捕获的失败；定义公共类型映射，不从 shared 引用 main 服务实例。
- [x] 对实际 worker 命令逐项迁移签名和返回值，减少调用处强转；TaskCenter、UI、工具、调度都通过真实域绑定。动态桥仅在传输边界保留 unknown，不给普通业务方法加任意字符串兜底重载。
- [x] 运行 `npm test -- src/main/task-center src/main/agent-space src/main/contact-agent`、`npm run typecheck` 和 `npm run check:boundaries`；原错误文案及版本校验保持。
- [x] 提交 `refactor: type task domains and contact command transport`，记录 C1。

### Task 3: 联系人存储分责与事务回归

**Files:** 新建 `src/main/task-center/contact/{queries,call-budget,scheduling,mutations,completion}.ts` 及 `queries.test.ts`、`completion.test.ts`；修改 `contact-store.ts`、`commands.ts`、`src/main/workloop/loop.ts`、`workflow.ts`；复用 `agents/token-budget.ts`、`task-failures.ts`、`topics.ts`、`notices.ts`、`delivery.ts`。

**Interfaces:** 查询接收只读 db/必要 repository；额度模块提供 `reserveRunCalls(runId)`、`releaseRunCalls(runId)`、原预算/计费接口；调度模块提供 `nextScheduledTopic(owner, now, newSources?, excluded?)` 与原恢复/轮次接口；`ContactCompletion.finish(runId, report, memories, progress?, delivery?)` 在原连接单事务中协调保存。各模块只注入需要的窄端口；ContactTaskStore 保留兼容方法并委托，不能把整个自己传回每个子模块。

- [x] 在真实 SQLite 注入结果提交中 reports/delivery/progress/notices 写入失败，断言全部回滚、无对外发送；测试预算预留/取消未退出占位、恢复不重复创建轮次。
- [x] 运行新增失败测试；先抽只读查询，再额度，再调度/命令，最后提交协调。每一步跑对应原测试，避免同时改变查询与状态语义。
- [x] 确保原材资/记忆失效与 cleanup intent 事务、删除后台日志、日程生成及失败退避仍经过原连接；查询模块无写 SQL。
- [x] 运行 `npm test -- src/main/task-center src/main/agents src/main/agent-space src/main/workloop`、`npm run typecheck`、边界检查；构建后 `--agents`，确认真实重启恢复与成果回执。
- [x] 提交 `refactor: separate contact queries budgets scheduling and completion`，记录 D1 各事务故障注入结果。
