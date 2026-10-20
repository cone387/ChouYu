# AgentSpace 完整模块化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成联系人模块组合、系统任务中心、DSH 后台能力及更新后范围内的验证与交付。
**Architecture:** 应用 AgentSpace 持有 ContactAgent 与 Chat/远程 WorkLoop 模块；worker 的 WorkLoopHost 承载执行。系统 TaskCenter 分派三个任务域的业务操作，Harness 以逐轮预算契约执行。
**Tech Stack:** Electron / TypeScript / SQLite / DeepSeek Harness SDK / Vitest。
**Spec:** `docs/superpowers/specs/2026-10-19-agentspace-complete.md` 与 `docs/contact-task-spec.md`。

## Global Constraints

- 用户于 2026-10-20 明确取消 24 小时长测及其跨日等待门槛；保留已有真实模型与专项验证证据，不将取消写成验收通过。其余模块实现与交付要求不变。
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

## Task 5: 真实模型运行验收（24 小时长测已取消）

**当前状态（2026-10-20 11:37）：** 用户明确要求停止 24 小时测试，已通过样本的 `stop.request` 正常停止第四实例；应用 9152、启动器 23284、监督进程 15768 均已不存在，报告为 stopped/complete=false。最终有效观测 6675509ms、1321 次采样，原生与 DSH 各交付两轮，实际成果及引用已核验；工作进程重启、应用重启、暂停恢复与两次失败后的自动恢复证据保留，存储与重复消息错误为零。监督记录 status=exited、exitCode=null，不臆造退出码。取消剩余时长和跨日等待，不继续启动样本，不将任何历史样本标记为 24 小时通过。以下长测要求、待办与运行描述为历史记录，以本段和更新后的 spec 为当前范围；剩余工作为 Task 6 的最终审计、文档定稿和合入推送。
第四样本第二周期与自动恢复（2026-10-20 11:09）：原生作者第二轮保存《灯塔的方向》443 汉字，成果 v2 保留首篇正文。DSH 第二轮 `1bb5dcba-3c99-479f-80c0-67d185cb280e` 返回含未转义引号的无效 JSON，格式修正又被应用记录为输出截断，10:51:15 失败；正式评审仍为 v1，未发布半成品，失败通知明确原正文保留和 11:06:15 起自动重试。恢复运行 `d4c5fb7d-78f2-42a4-91a2-3d5b464673d8` 于 11:06:16 自动启动，沿用原任务及 10:48 到期记录，11:07:41 完成。已直接阅读正式评审及作者全文：新评审引用 `lighthouse_direction?version=2`，证据正文与作者保存正文逐字一致，四维加权评分为 75/100，聊天交付等于保存的标题与正文；双方旧分节 SHA256 保持不变。失败尝试中的未保存评分不作为正式成果。证据为同目录 `second-writer-audit.json`、`second-review-failure-audit.json`、`second-review-audit.json`。11:08 检查三个进程存活，有效观测约 83 分钟，原生/DSH 各完成两轮，存储与重复消息错误为零。第二周期及此次自动恢复已验证，跨日、完整 24 小时与最终交付仍未完成。

第四完整样本启动核验（2026-10-20 09:46）：`full24h-2026-10-20T01-37-07-159Z` 使用独立隐藏监督进程启动；supervisor 15768、launcher 23284、应用 30388 均核实存活。正式 beganAt=1792460711382，即 09:45:11.382 +08:00，09:37 起的准备时间不计入验收。启动 HEAD 为 `caddcb35958afaee9c48342595e1d845d6ab1345`，冻结构建 SHA256 仍为 `853e99dc977d49e7f33d37bbfb60ea5fae9a2e2cd82f18ed28ed1076b55e7705`，与第三样本一致。模型仍为 `as-glm-5.2`，24 小时、调用/Token 上限、故障注入与验收门槛不变。首次报告 running/complete=false，7 次采样、observedMs=30231，无观察/存储/重复消息错误；原生与 DSH 尚未到首轮计划时间，不能据启动成功标验收通过。监督状态与 stdout/stderr 在样本目录同级，以 `.supervisor.json` 等后缀保存；后续必须同时检查真实进程和报告新鲜度。

第三完整样本中断核验（2026-10-20 09:29）：原 launcher 18880、应用 36444 均已不存在，工具会话 96927 也已失效。最后报告写于 09:23:48.525 +08:00，observedMs=43791180、samples=8707，约 12 小时 10 分钟；complete=false，原始 running 状态已过时，不能据此判断仍在运行或验收通过。保留全部原始报告，另存 interruption-audit.json。应用日志没有同期退出异常，近 40 分钟 Windows 事件没有 Node/Electron 应用崩溃或系统重启；有一条较早的 LiveKernelEvent，尚无证据与退出相关。退出原因未确定，不归因于产品崩溃或用户暂停。新完整样本必须独立满足 24 小时门槛，不拼接本次时长。
第三完整样本历史状态（2026-10-19 22:19；已于次日中断，见上文）：`full24h-2026-10-19T13-07-51-916Z` 正式开始于 21:13:55.576 +08:00，冻结提交 `6f6c80356974a810edf8d3c4d70094cfc56ff0c4`，构建 SHA256 `853e99dc977d49e7f33d37bbfb60ea5fae9a2e2cd82f18ed28ed1076b55e7705`，模型 `as-glm-5.2`；21:07:51 起的复制准备不计入时长。监控会话 96927、launcher PID 18880、应用 PID 36444 核实存活。报告 running/complete=false；有效观测 3896977ms、776 次采样，原生完成 2 轮/8 次调用/24145 reported tokens，DSH 完成 2 轮/6 次调用/34237 reported tokens，SDK 会话 6，真实引用评审 2。worker 硬重启、应用重启、暂停恢复和预定 HTTP 503 后恢复通过；观察、存储及重复消息错误为零。助手安排完成一次，未读 7；跨日和完整 24 小时仍待验证。

第三样本正文核验：原生首轮 `b1855abd-e310-4345-b162-c81afd7151f8` 保存 `sec_01_arrival`（384 汉字），第二轮 `328b5a7b-5ecc-482d-b502-0336b2d9b105` 保存 `sec_02_signal`（450 汉字），v2 保留原分节并续写调查线。DSH 第二轮 `8973fd69-eec1-4ebc-a6c1-a86a1eef3267` 保存含结论、评分依据及具体建议的 `ch01-review-signal`，引用 `contact-delivery://soak-writer/cbfe5e49-1261-4102-abcb-29c2230901b9/sec_02_signal?version=2`。已直接核对正式保存正文及引用版本；不把执行阶段字段当作聊天成果。

第二完整样本最终状态（2026-10-19 20:58）：`full24h-2026-10-19T06-24-12-025Z` 已停止，监控会话 `90171` 退出 2。有效观测 23113488ms、4588 次采样，约 6.42 小时；原生和 DSH 各两次交付、重复消息及产品存储错误为零，但 20:56:44 验收程序替换 `module-evidence.json` 时记录一次 `EPERM`。后续采样恢复，不代表本样本通过；原错误保留，不能计入下一完整样本。以下首轮和第二周期描述均为这个已停止样本的历史证据。

报告写入冲突调查：隔离复现中无读取者的 8735 次原子替换均成功；并发 PowerShell 读取可重复触发同类 `EPERM`，共享删除读取也未消除冲突。新增真实 Windows 持有/释放读句柄回归，原实现因临时锁失败；报告写入改为等待完成的异步原子替换，仅在 Windows 的 EPERM/EACCES/EBUSY 上进行 25/50/100/250ms 有限重试。持续锁定仍报错，保留旧报告和候选临时文件；缺失目录错误不吞掉。验收门槛和历史错误不修改。修复验证已完成，新完整样本待启动。

来源范围修复最终检查（14:23）：全量 1971 项通过、53 项跳过，类型检查、构建、Electron 联系人回归通过（`source-count-scope-{tests,types,build,agents}.log`）。原生与实际 DSH SDK 的本地协议链均保存正确引用字数的成果，仍只有接单/规划/正文三次请求。修复已提交为 `6cf4d8e7d515c37c1cbaf937ba0218560cc9202b`，随后启动独立的新完整样本；此前短测已验证基础链，当前精确故障由失败回归覆盖，不另用短测替代长测或合并已停止样本的时间。

历史失败样本：`full24h-2026-10-19T05-06-18-214Z` 因确认的来源字数范围误判主动停止，监控会话 `95752` 退出 2；运行约 66.7 分钟，不能计作通过。第二轮原生交付 408 汉字新段；DSH 读取后被“作者全文”误归为评审累计字数拦截。上述修复与回归针对这一真实故障。

第二样本历史记录（2026-10-19 15:10 核验）：`full24h-2026-10-19T06-24-12-025Z` 正式开始于 14:33:14 +08:00，冻结提交 `6cf4d8e`，模型 `as-glm-5.2`，监控会话 `90171`。启动准备与旧样本均不计入时长。实际 launcher PID 29652、应用 PID 27560 均存活；报告状态 `running`、`complete: false`。约 37 分钟、443 次采样，原生与 DSH 各完成一次正式交付；原生 7 次调用、12202 reported tokens，DSH 4 次调用、18789 reported tokens。已验证 worker 硬重启、应用重启、暂停恢复，以及预定 HTTP 503 后 DSH 自动重试、实际读取作者正文并保存引用评审；观察、存储与重复消息错误均为零。第二周期、跨日和完整有效观测时长仍待验收，不能据首轮成功标完成。

第二周期证据（2026-10-19 15:40）：原生第二轮 `0e8835cf-ea96-4ee0-8d3a-c8e7ae4b4958` 保存 v2 新分节 `ch1_s2_lighthouse_entry`，实际正文 455 汉字，旧分节仍保留。DSH 第二轮 `e40f9d8f-6b40-4a32-ae0e-81dfa3cb32e2` 保存 `review-ch1-s2`，正式评审包含结论、依据和建议，引用 `contact-delivery://soak-writer/af6328da-48cb-4645-8b95-a9676c7dac71/ch1_s2_lighthouse_entry?version=2`。两种引擎各完成两次交付；原生 11 次调用、27390 reported tokens，DSH 7 次调用、44534 reported tokens；795 次采样，约 66.8 分钟，观察、存储和重复消息错误均为零。监控会话 `90171` 与上述两个进程仍存活，`complete` 仍为 false。此证据证明第二周期交付与新成果引用，不替代跨日和完整 24 小时验收。

**Files:** `scripts/agentspace-soak.cjs` 及隔离 runner、验证器和测试配置。
- [x] 验收程序覆盖真实模块链与 SDK，固定隔离数据、限定调用/Token、脱敏日志、可恢复检查点；先跑短时真实预检。30 分钟真实预检 `preflight-20261019-122852` 正常退出，原生与 DSH 各交付一次，实际读取成果、暂停和两类重启验证通过；它不计作 24 小时验收。
- [x] 启动可监控的 24 小时进程，记录句柄、开始时间、代码提交、模型标识、任务/成果/用量和故障事件；后续始终核验真实句柄，不因观测超时重启。已停止的第二实例见上段；其原始证据位于 `artifacts/agentspace-complete/full24h-2026-10-19T06-24-12-025Z/{options,report,module-evidence}.json` 及同目录事件记录。只有新样本自身满足全部门槛才能通过。
- [x] 按用户 2026-10-20 的要求停止长测并取消剩余 24 小时/跨日等待，保留真实运行证据；此勾选表示取消操作完成，不表示 24 小时验收通过。


报告文件修复验证（2026-10-19 21:07）：真实 Windows 临时读锁/持续读锁、完整 JSON 与缺失目录共 4 项测试，以及验收门槛的 4 项测试通过。全量首次回归出现 DSH 工具启动等待和打包复制两项超时/等待失败；未改代码、超时或测试配置，单独复测 6 项通过（1 项跳过），全量复测 1975 项通过、53 项跳过。具体首次延迟来源未确定，保留失败日志，不将一次复测解释为根因已消除。随后类型检查、构建、Electron 联系人冒烟通过，命令会话 26471 正常退出 0。证据：`report-lock-{red,green,tests,dsh-recheck,tests-recheck,types,build,agents}.log`。新完整样本必须使用包含报告文件修复的冻结构建。

## Task 6: 完整审查与交付

- [x] `npm test`、`npm run typecheck`、`npm run build`，真实 Electron 聊天/联系人/助手安排/主动检查冒烟。五类 Electron 场景（含 DSH）通过（`task6-recovery-*`）；接单/规划工具边界修复已有原生与实际 DSH SDK 协议证据（`planning-tools-*`）。后续删除失败/worker 重建隔离修复后 1969 项通过、53 项跳过，类型检查、构建和联系人 Electron 再次通过（`removal-restart-{tests,types,build,agents}.log`）。原生和 DSH 规划不暴露工具、宿主实际读取共享正文、正文阶段工具保留；删除待重试的联系人不阻止其他联系人恢复。后续源代码改动需按影响更新验证。
- [x] 一次独立整分支审查，重要缺陷按失败测试修复并回归。审查范围 `9a4e0e8..6aab747`，无 Critical、两项 Important：worker 重启恢复已卸载 WorkLoop、上下文修改与清理意图未原子提交；均有实际服务/SQLite 失败测试与修复。真实 24h 尚未完成，不据此批准最终交付。
- [x] 按用户取消长测后的 spec 1–6 逐条审计实际入口、测试与运行证据，更新架构、产品状态及验收文档。最终检查与边界见文末。
- [ ] 提交完整功能分支；合并、推送按会话中实际授权处理。

## 最终审计证据索引（2026-10-20，按用户更新后的范围）

本表逐条核对更新后的 spec 六项要求。2026-10-20 再次读取实际业务入口、模块组合、三域分派、后台配置与预算链，核对真实模型成果审计、存储压力报告及五类 Electron 日志。连续 24 小时与跨日门槛由用户取消，保留所有失败和未验证边界；代码交付与远端结果见文末交付记录。

| 要求 | 已核对的权威入口与证据 | 当前结论与待办 |
| --- | --- | --- |
| 1. 同一联系人组合 Chat/WorkLoop 与生命周期 | `ipc.ts` 的聊天入口调用 `runContactChat`，`agents/index.ts` 将聊天与后台请求交给同一 `contactSpace`；`agent-space/application.test.ts` 覆盖真实持久 WorkLoop、独立退出等待、删除/卸载、worker 更换及同伴恢复，`contact-agent/agent.test.ts` 覆盖装卸与失败重试。最新全量和 Electron agents 均通过。 | 实现与覆盖范围已核验；没有仅建目录而未接入业务的模块。 |
| 2. TaskCenter 三任务域与原语义 | `agents/index.ts`、`tasks/index.ts`、`assistant-routines/index.ts` 实际注册/绑定域；`task-center/service.test.ts` 使用实际 TasksStore、AssistantRoutineService、AgentSpace/WorkLoopHost 验证归属、版本、独立日期期次、删除持久性与卸载旧绑定失效。助手安排 Electron 日志包含共同 UI、单描述弹窗与真实定时投递通过标记。 | 已接入真实业务入口；未以通用任务状态覆盖各域语义。 |
| 3. 后台 DSH 与设置、预算、工具 | `workloop/model.ts` 调用 `context.harnesses.background(input.backgroundHarnessEngine)`；`background-rounds.test.ts` 使用实际 SDK 与本地 HTTP 验证逐轮预留/结算、六次上限、发送前拒绝、取消及未知用量；详见 `agentspace-dsh-background-acceptance-20261019.md` 与 `task3-dsh-ui`。 | SDK/界面/持久化及两周期真实供应商交付证据已核验。 |
| 4. 启动、退出与存储恢复 | 四条部分启动失败有真实 SQLite 文件句柄 RED/GREEN；真实 Windows SHM 映射复现、精确错误有限恢复、不重试损坏库；`storage-recovery.json` 显示 complete=true、48 次完整性检查，四种组合与轮次详见存储验收文档。 | 针对性验证通过；原间歇 WAL 错误具体句柄来源仍未知，不宣称永久消除全部 I/O 错误。 |
| 5. 隔离真实模型交付与恢复证据 | 第四样本有效观测 6675509ms、1321 次采样，原生/DSH 各完成两轮，真实来源正文及版本、旧正文保留、聊天投递、助手汇报和自动恢复已核验；`first-review-audit.json`、`second-writer-audit.json`、`second-review-failure-audit.json`、`second-review-audit.json` 均保留。 | 更新后范围已满足。用户取消连续 24 小时及跨日等待，第四样本正常按要求停止；所有历史失败保留，不宣称长测通过。 |
| 6. 回归、独立审查与最终交付 | 既有全量 1975 通过、53 跳过，类型/构建/Electron agents 通过；其余四类 Electron 原始通过日志为 `task6-recovery-{chat,assistant-routines,companion,dsh-harness}.log`。整分支与尾部独立审查已完成，重要缺陷有失败回归修复；交付前新检查见文末。 | 已逐项核对实现和证据，文档同步当前范围；最终提交、合入及推送记录见文末。间歇等待/超时失败日志保留，不声称根因已消除。 |

文档一致性检查修正：旧 Harness 章节不再把所有联系人后台任务描述为直接调用原生；当前独立后台选择与普通聊天能力范围已对齐实际实现。此处为文档修正，不改变第三样本运行代码。

## 补充独立代码审查（2026-10-20）

reviewer `/root/agentspace_tail_review` 只读补查 `6aab747565b8209c4f6d6de7cd026f6273118e38..a2858aff605fb94debba28dd2356fc3ed1adfa2a` 的全部 28 个变更文件及相邻调用链，覆盖前次整分支审查后的修复。未运行测试/构建/模型，未触碰正在运行的样本；确认 `6f6c803..a2858af` 只有文档变化。没有发现新增 Critical、Important 或 Minor；前次两项 Important 的实现与真实 SQLite/宿主失败回归支撑已核对。补查涉及模块装卸权威、上下文与清理事务、WAL 精确恢复、RPC 启动判定、规划工具边界及等待报告写入。证据摘要为 `artifacts/agentspace-complete/tail-review-20261020.json`。

审查明确保留的范围：既有交付类型判断、章节规划、成果格式修复和字数校正仍可使用原任务已授权技能工具，工作文件写入不会随后续格式失败回滚；这些路径在本次基线已存在，本轮明确修复的是接单与 choose 规划及其纠正，未发现本尾部改动引入越权或交付损坏。执行者接受该范围判断，不宣称所有纯判断请求均禁止工具，也不因此禁止实际正文修订工具。来源字数校验仍不是通用自然语言理解器；原 WAL 句柄来源、首次全量等待/超时和第三样本退出原因仍未知。

**上述为 10:44 的历史审查结论。** 第四样本第二周期及其正文/引用核验已于 11:09 完成；用户随后取消 24 小时长测及跨日等待。当前范围和最终交付以 Task 5 的取消记录及文末交付记录为准。

## 交付收尾核验（2026-10-20）

- 用户明确取消 24 小时长测，随后要求完成交付收尾；本次不再启动长测。第四样本及所有历史失败记录保留，未把取消要求写成验收通过。
- 运行代码最后变更为 `6f6c803`，此后仅文档变化。核对普通聊天 IPC、应用联系人组合、WorkLoopHost、三个实际任务域、联系人后台设置与逐轮预算调用链，未发现未接入业务的占位模块。现行任务 UI、独立身份、消息来源、自然语言描述和未读提醒约定保持原实现。
- 交付前全量首次运行 1972 通过、3 失败、53 跳过：DSH 工具启动等待及清理钩子超时、打包资源复制超时、强杀 helper 后新请求 `ECONNRESET`。保留 `delivery-final-tests.log`；未修改代码、测试、并发或超时。三个相关文件单独复测 10 通过、1 跳过（`delivery-final-dsh-recheck.log`），随后完整复测 1975 通过、53 跳过、242 文件通过，耗时 80.99 秒（`delivery-final-tests-recheck.log`）。这证明本次复测通过，不证明首次间歇失败根因已消除。
- Node/Web 类型检查、应用构建通过，构建仅保留已有 chunk 大小提示，证据 `delivery-final-types.log`、`delivery-final-build.log`，执行会话 73067 退出 0。五类 Electron 通过日志、SDK/界面验收、存储 24 轮/48 次完整性检查及两次独立审查已逐一核对；无需为文档改动重复所有真实模型场景。
- 6 份相关文档的 98 个相对链接均存在，`git diff --check` 通过。架构文档旧 `AgentStore.finish` 名称修正为实际 `ContactTaskStore.finish`。原 WAL 占用者、第三样本退出原因及间歇测试延迟仍保留为已知边界，不扩展宣称第三方插件沙箱、系统服务、断网/休眠工作或安装包发布验收。
- 主仓库 `master` 与 `origin/master` 均为 `9a4e0e8`，工作区干净；功能分支可快进合入。验收原始文件保留在现有工作树 `artifacts/agentspace-complete/`，不清理持有唯一证据的工作树。最终合入与远端核验结果在实际推送后补记。
