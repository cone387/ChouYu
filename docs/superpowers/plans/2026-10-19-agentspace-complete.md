# AgentSpace 完整模块化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成联系人模块组合、系统任务中心、DSH 后台能力及真实 24 小时可靠性验收。
**Architecture:** 应用 AgentSpace 持有 ContactAgent 与 Chat/远程 WorkLoop 模块；worker 的 WorkLoopHost 承载执行。系统 TaskCenter 分派三个任务域的业务操作，Harness 以逐轮预算契约执行。
**Tech Stack:** Electron / TypeScript / SQLite / DeepSeek Harness SDK / Vitest。
**Spec:** `docs/superpowers/specs/2026-10-19-agentspace-complete.md` 与 `docs/contact-task-spec.md`。

## Global Constraints

- 完整目标含真实模型至少 24 小时验收；不能仅完成模块骨架即结束目标。
- 新项目不加旧类名兼容转发；现有消费者全部迁入实际模块路径。
- 公共交流约定、独立身份、单任务描述弹窗、同一任务 UI、未读托盘闪烁保持不变。
- 不新增快速新建、批量操作或环境变量形式的用户设置。
- 各任务域保留原事务与调度语义；跨域入口不能伪称跨库原子操作。
- 隔离测试数据，有界真实模型调用，不记录凭据或改动用户真实任务。

## Review Focus

- 删除与卸载时的聊天工具等待、后台请求未退出、跨联系人并行及模块重挂载。
- TaskCenter 任务引用的域/归属/版本错配，任务不存在与暂时不可读取的区分。
- DSH 同一会话多轮预算、工具循环、失败/断流/缺失用量及输出上限。
- worker 硬退出后 WAL 重开、启动部分失败资源回收、旧进程迟到消息。
- 24h 验收的真实进程存活、时间跨度、调用/Token 记录、暂停与失败恢复证据。

## Task 1: 应用空间与聊天模块

**Files:** `src/main/agent-space/service.ts`, `workloop-host.ts`, `src/main/contact-agent/{agent,contracts,chat,workloop}.ts`, `src/main/agents/{index,worker}.ts`, `src/main/ipc.ts`。
**Interfaces:** 应用 AgentSpace `syncContact(identity)`, `runChat(input, sink, engine)`, `request(method,id,args)`, `detachModule(id,moduleId)`, `remove(id)`, `close()`；WorkLoopHost 保留后台 `sync/request/tick/close` 协议。模块通过明确依赖端口调用 Harness/RPC，不直接依赖 Electron 窗口。
- [x] 先写失败测试：聊天实际运行、归属拒绝、独立取消、卸载等待工具退出、同联系人 Chat/WorkLoop 组合、删除不能重建已删除身份。
- [x] 将 worker 空间改名为 WorkLoopHost，建立应用 AgentSpace，接入真实 IPC 与联系人生命周期；更新所有消费者。
- [x] 相邻生命周期/Harness/联系人任务测试、类型检查通过后提交。

## Task 2: 系统任务中心与三个任务域

**Files:** `src/main/task-center/{contracts,service,contact-domain,todo-domain,assistant-domain}.ts`，原 `store.ts` 改为 `contact-store.ts`；`src/main/tasks/index.ts`, `src/main/assistant-routines/index.ts`, `src/main/agents/index.ts` 及真实调用者。
**Interfaces:** `TaskRef { domain, owner, id }`；注册域暴露 `list/read/execute/capabilities`，中央入口校验域与归属再委派。现有各域命令保持具体参数类型，持久化仍由原事务实现。
- [x] 写失败测试覆盖域隔离、过期版本、删除、持久恢复以及实际服务入口分派。
- [x] 实现中心和三域模块，将 UI/工具/调度业务调用接入，保留用户待办按日期独立生成、联系人版本和助手自然语言契约。
- [x] 运行任务、日历、助手安排、联系人任务回归，提交。

## Task 3: DSH 后台预算与用户设置

**Files:** `runtime/dsh/plugin.mjs`, `src/main/harness/dsh/{runtime,background,module}.ts`, `harness/{background,contracts}.ts`, `workloop/model.ts`，联系人配置及编辑界面。
**Interfaces:** BackgroundHarness 每轮 `beforeRound(round, serializedInput) -> maxOutputTokens`，`onMetadata` 后 `afterRound`；额度不足不发请求。联系人保存独立后台引擎选择，worker 身份与本轮快照包含选择。
- [x] 查验已安装 SDK 的实际 hook、不可变请求与持久头契约；先写真实 SDK + 本地 HTTP 服务器失败用例。
- [x] 实现多轮预留/结算、Token 限额、总超时、取消、工具与失败回传；不得修改冻结请求或绕过 SDK 正式执行链。
- [x] 接入后台注册和联系人持久设置/自然语言配置，验证选择、重启保存、下一轮生效与跨联系人隔离；提交。

## Task 4: 进程与存储恢复

**Files:** `agent-space/worker-rpc.ts`, 进程承载入口、存储启动辅助及针对性压力测试。
- [x] 用隔离目录连续强制终止、启动和写入收集失败证据，区分 SQLite 打开、WAL、退出和清理阶段。
- [x] 根据证据修复，先复现后验证，不用无界重试或删库；验证同时运行联系人和成果持久性。
- [x] 记录故障次数、恢复次数、进程退出与完整性检查。最终回归再次出现 IOERR_TRUNCATE，已用真实 Windows SHM 映射复现一种触发条件并补精确错误的有界恢复；四种连接/终止组合 24 轮、48 次完整性检查通过。原冒烟句柄来源仍未知，继续纳入 Task 5；不声称永久消除所有 I/O 错误。

## Task 5: 真实 24 小时验收

来源范围修复最终检查（14:23）：全量 1971 项通过、53 项跳过，类型检查、构建、Electron 联系人回归通过（`source-count-scope-{tests,types,build,agents}.log`）。原生与实际 DSH SDK 的本地协议链均保存正确引用字数的成果，仍只有接单/规划/正文三次请求。接下来直接启动修复后新的完整 24 小时样本；此前短测已验证基础链，当前精确故障由失败回归覆盖，不另用短测替代长测或合并已停止样本的时间。

最新状态（14:20）：首个完整样本 `full24h-2026-10-19T05-06-18-214Z` 已因确认的来源字数范围误判主动停止，监控会话 `95752` 退出 2；运行约 66.7 分钟，不能计作通过。第二轮原生交付 408 汉字新段；DSH 读取后被“作者全文”误归为评审累计字数拦截。范围修复已通过针对性与实际 SDK 本地协议回归，完整回归、新冻结提交及重新启动完整 24 小时仍待完成。以下已勾选项记录已完成的准备与首次启动，不代表当前还有长测进程。

**Files:** `scripts/agentspace-soak.cjs` 及隔离 runner、验证器和测试配置。
- [x] 验收程序覆盖真实模块链与 SDK，固定隔离数据、限定调用/Token、脱敏日志、可恢复检查点；先跑短时真实预检。30 分钟真实预检 `preflight-20261019-122852` 正常退出，原生与 DSH 各交付一次，实际读取成果、暂停和两类重启验证通过；它不计作 24 小时验收。
- [x] 启动可监控的 24 小时进程，记录句柄、开始时间、代码提交、模型标识、任务/成果/用量和故障事件；后续始终核验真实句柄，不因观测超时重启。正式开始于 2026-10-19 13:12:40 +08:00，冻结提交 `541927d51b95c635117cce744d8dd30869cfb509`，模型 `as-glm-5.2`；输出 `artifacts/agentspace-complete/full24h-2026-10-19T05-06-18-214Z`，监控会话 `95752`。首轮原生进度 JSON 校验失败后保留草稿，应用重启后自动重试并原样交付；DSH 从预定 HTTP 503 自动恢复，读取该成果并保存评审。至 13:35 暂停与恢复、两类重启检查通过；后续周期、跨日和完整时长尚待验收，不据此提前标完成。
- [ ] 满 24 小时后审计时间跨度、两种引擎实际调用、独立任务、消息去重、暂停和重启恢复；失败继续修复并运行相应验收，不提前标完成。

## Task 6: 完整审查与交付

- [x] `npm test`、`npm run typecheck`、`npm run build`，真实 Electron 聊天/联系人/助手安排/主动检查冒烟。五类 Electron 场景（含 DSH）通过（`task6-recovery-*`）；接单/规划工具边界修复已有原生与实际 DSH SDK 协议证据（`planning-tools-*`）。后续删除失败/worker 重建隔离修复后 1969 项通过、53 项跳过，类型检查、构建和联系人 Electron 再次通过（`removal-restart-{tests,types,build,agents}.log`）。原生和 DSH 规划不暴露工具、宿主实际读取共享正文、正文阶段工具保留；删除待重试的联系人不阻止其他联系人恢复。后续源代码改动需按影响更新验证。
- [x] 一次独立整分支审查，重要缺陷按失败测试修复并回归。审查范围 `9a4e0e8..6aab747`，无 Critical、两项 Important：worker 重启恢复已卸载 WorkLoop、上下文修改与清理意图未原子提交；均有实际服务/SQLite 失败测试与修复。真实 24h 尚未完成，不据此批准最终交付。
- [ ] 逐条审计 spec 1–6 的权威证据，更新架构/产品状态/验收文档；所有项目实现且验证前保持目标 active。
- [ ] 提交完整功能分支；合并、推送按会话中实际授权处理。
