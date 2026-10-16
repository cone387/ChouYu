# ChouYu DSH Harness Integration Implementation Plan

> 2026-10-16 用户明确纠正：执行器改为每位联系人在现有资料编辑弹窗独立设置；下文首阶段内部绑定/无用户入口的约定已被取代。保存后下一次普通聊天生效，不再读取启动环境变量。实现与验证见 `docs/dsh-harness-acceptance-20261015.md`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让指定测试联系人通过 DSH 完成普通聊天、资料读取及原确认卡片驱动的偏好修改，并验证 Windows 安装包。

**Architecture:** ChouYu 保存身份、上下文、权限、业务写入与消息；仓库内 harness 模块选择原执行器或 DSH。独立 Node helper 承载官方 SDK，自有运行时插件通过认证回环通道桥接工具和实时事件，每个聊天请求使用新的 DSH 会话。

**Tech Stack:** Electron 44、TypeScript、React 18、SQLite、Vitest、Node 24、DSH 0.2.1-alpha.3。

**Spec:** [已确认接入设计](../specs/2026-10-15-dsh-harness-integration-design.md)；[权威产品规范](../../contact-task-spec.md)。

状态：用户已批准在当前会话逐项实施并进行最终独立审查；2026-10-16 按用户明确要求已从 `feat/dsh-harness` 合入本地 `master`。任务 2–6 的核心链路已实现；任务 1 的真实供应商门槛、任务 7 的完整 kill 矩阵、任务 8–9 的最终打包验收尚未全部关闭。以下原始步骤保留作核对清单；当前实现与实际验证以[验收记录](../../dsh-harness-acceptance-20261015.md)为准，不能把未验证项视为通过。

## Global Constraints

- 初始版本固定为原型验证的 DSH `0.2.1-alpha.3`，升级须单独验证。
- SDK 的启动逻辑依赖 Node 执行环境。正式方案在独立 Node 24 helper 中运行 SDK。
- 首阶段内部配置固定一个联系人 ID。未指定联系人使用原执行器；选中 DSH 后启动失败明确报错，不自动回落并重发。
- 每个 ChouYu 请求分配独立 DSH 执行会话，并保存关联；下一条输入从 ChouYu 当前快照重建。
- 不迁移 LangGraph 长期任务，不新增执行器设置 UI；保持原意图路由和任务预算语义。
- 不在 DSH 子进程中打开 ChouYu 业务数据库；不加载 shell、任意文件写入或桌面工具。
- 不得在卡片执行后再次调用 `prepared.execute()`，也不得把卡片点击变成 DSH 再发起同一工具的指令。
- 未知用量不是零；工具副作用不因停止或模型失败而被声明撤销。
- 首阶段 Windows 开发与无全局 Node 的安装包验证；macOS 未同等验证前关闭 DSH。
- 保持公共交流规则、独立人设、单描述任务弹窗、共同任务 UI、真实消息来源和全部主动未读闪烁。

## Review Focus

1. 编辑历史、撤回资料后旧 DSH 日志再次进入模型：任务 4、7 验证新快照及关联删除。
2. 同组两联系人等待确认时修改其中一人的模型或权限：任务 4、5 验证只取消受影响请求、旧卡不能越权。
3. 实际写入成功，但回执落盘或模型回复失败：任务 3、5、7 故障注入，禁止重放并保留待核对事实。
4. 模型重试、同名 callId、乱序/重复片段及迟到完成：任务 3、6 验证复合身份、正文替换和完成去重。
5. 安装包运行路径含空格、无全局 Node、离线首次启动：任务 1、8 验证依赖闭包、资源路径及退出清理。

## File Map

以下新模块的同目录 `*.test.ts` 为对应单测；原模块测试在原文件旁补充。

| 文件 | 职责 |
| --- | --- |
| `runtime/dsh/package.json`、`package-lock.json`、`helper.mjs`、`profile.yml`、`plugin.mjs`、`provider.mjs` | 独立依赖闭包、SDK 启动、最小 profile、自有插件与供应商映射 |
| `runtime/dsh/provider.d.mts` | 为主进程测试/类型检查声明 provider 纯映射接口；不导入 helper 副作用 |
| `scripts/build-dsh-runtime.cjs`、`resources/dsh-runtime-manifest.json` | 构建物理资源、固定 Node 版本/来源/校验摘要；不提交运行时二进制 |
| `src/main/harness/contracts.ts`、`coordinator.ts`、`legacy.ts` | 执行契约、内部绑定/取消、原执行器适配 |
| `src/main/harness/prepare.ts`、`tools.ts`、`action-results.ts` | 提取现有准备与工具执行，订阅原卡片持久回执 |
| `src/main/harness/store.ts`、`recovery.ts` | 最小 SQLite 关联账本、重启核对和日志清理 |
| `src/main/harness/dsh/transport.ts`、`runtime.ts`、`adapter.ts`、`stream.ts` | 有序认证通信、分组进程、DSH 执行器、流式归并 |
| `src/shared/harness.ts` | 跨进程命令/事件的可序列化契约；不含 SDK 类型或密钥 |
| `src/main/ipc.ts`、`src/main/index.ts`、`src/main/agents/service.ts` | 接入普通聊天、卡片完成通知、应用关闭、相关删除边界 |
| `src/shared/ai.ts`、`src/renderer/src/core/ai-engine.ts`、`src/renderer/src/components/ChatPanel/useSessionWorkspace.ts` | 原聊天协议增加必要正文替换/执行来源，保持原保存与未读路径 |
| `src/main/smoke/dsh-harness-smoke.ts`、`scripts/smoke-electron.js` | 隔离 UI、真实供应商和打包验收入口 |
| `src/main/harness/dsh/fixtures/mock-provider.mjs` | 受版本控制的双协议模拟供应商及故障夹具 |
| `package.json`、`electron-builder.yml`、`.gitignore` | 构建脚本、物理资源收集和构建产物排除 |
| `docs/dsh-harness-acceptance-20261015.md`、`docs/contact-agents-architecture.md`、`docs/contact-task-spec.md` | 分层证据、架构及缺口同步 |

## Task 1: 固定运行时与供应商兼容验证（H-03、H-13）

**Files:** 新建 `runtime/dsh/*`、`scripts/build-dsh-runtime.cjs`、`resources/dsh-runtime-manifest.json`、`src/main/harness/dsh/provider.test.ts`、`fixtures/mock-provider.mjs`；修改 `.gitignore`、根 `package.json`。

**Interfaces:** `provider.mjs` 导出 `mapProvider(config: Pick<AppConfig, 'provider' | 'baseUrl' | 'apiKey' | 'model'>, needs: {tools:boolean; images:boolean})`；AppConfig 来自 `src/shared/config.ts`，provider 判别为 `openai | claude`。返回 `{ profile: object, env: Record<string,string>, capability: { text:boolean; tools:boolean; images:boolean } }`，不支持时抛可识别错误，不创建第二份配置源。helper 首先仅提供 `--probe`，退出码 0 表示 SDK 真实流式和工具循环完成。

- [ ] 写 `provider.test.ts`：`maps_existing_provider_without_substitution` 断言双协议捕获的 `model/baseURL/auth` 等于传入配置，`missing_key_or_unsupported_image_never_dispatches` 断言 `expect(requests).toHaveLength(0)`；模拟工具请求后断言 `expect(toolResults).toEqual(['fixture-result'])`。
- [ ] 执行 `npx vitest run src/main/harness/dsh/provider.test.ts`，确认失败来自缺少映射/运行时，而非测试夹具错误。
- [ ] 实现固定依赖独立安装和 `mapProvider`；以本地 0.2.1-alpha.3 类型核对 pi-ai provider profile 的 `api/baseURL/apiKeyEnv/models`、端点拼接和图片能力。使用官方可重现来源与锁文件；若该版本无法获取，登记具体包并停止扩大实现，不使用邻仓绝对路径或自动升级。
- [ ] 实现最小 `profile.yml` 与 Node helper 探针；禁用默认身份、shell、额外模型总结/压缩及未授予工具。固定 Node 24 的具体补丁版与官方分发校验摘要写入 manifest；密钥仅通过受控进程环境传递、不写 profile/日志。把原型依赖与测试夹具迁入正式目录，保留上游许可证。
- [ ] 重跑单测及 `node runtime/dsh/helper.mjs --probe`；断言实时片段先于完成、两种协议工具结果可见、程序退出无子进程。为当前实际有效供应商另跑隔离合成探针，记录是否通过；没有配置时明确未验证，不启用绑定。
- [ ] 提交本任务文件：`git commit -m "feat: add pinned DSH runtime and provider probes"`。

## Task 2: 提取契约与原执行器，默认行为不变（H-01、H-04、H-14）

**Files:** 新建 `contracts.ts`、`prepare.ts`、`tools.ts`、`legacy.ts`、`coordinator.ts`、`src/shared/harness.ts` 及对应测试；修改 `src/main/ipc.ts`。

**Interfaces:** `HarnessInput` 包含 requestId/attemptId/characterId/sessionId、引擎版本、当前消息快照、systemPrompt、引用和配置版本、已解析 AppConfig、`AIToolRuntime`、signal、`assertContext():Promise<void>`。`HarnessAdapter.run(input: HarnessInput, emit: (event: HarnessEvent)=>void): Promise<HarnessResult>`；`HarnessResult` 为 completed(正式正文/来源)或 failed/cancelled/interrupted 判别联合。`prepareHarnessInput(request: AIStreamRequest, context: PreparationContext): Promise<HarnessInput>`；PreparationContext 显式注入原窗口、配置/联系人解析与上下文服务。`createChatTools(context: ChatToolContext): AIToolRuntime` 提取现有闭包。`HarnessCoordinator.run(input, emit)` 与 `cancel(requestId):Promise<void>` 统一选择和停止；默认只注册 legacy。

- [x] 写 `legacy.test.ts` 与 `prepare.test.ts`：`preserves_order_roles_citations_and_empty_persona` 断言 `expect(captured.messages).toEqual(expectedSnapshot)`、`expect(captured.systemPrompt).not.toContain(defaultDshPersona)`；`keeps_route_and_tool_permissions` 断言原路由结果、单请求变更限制、最多 5 个配置步骤与原返回一致。
- [x] 执行 `npx vitest run src/main/harness/legacy.test.ts src/main/harness/prepare.test.ts`，确认新增入口尚不存在造成失败。
- [x] 原样提取 ipc 准备与工具闭包，保留 `assertContext`、技能快照、资料实际读取登记、自身记忆修改后的真实回执、归属校验；legacy 内调用 `streamAIChat`。routeContactChange 仍使用原模型解析及同一 `createChatTools`，不得复制权限流程。
- [x] 实现契约事件开始/片段/工具/用量/终态与序号；终态只能一次，配置不可变。内部绑定读取 `CHOUYU_DSH_PILOT_CHARACTER_ID`，此时 DSH 未注册时选中请求明确未执行，不回落；macOS 一律拒绝该绑定。
- [x] 重跑新增测试与 `npx vitest run src/main/agents/chat-changes.test.ts src/main/ai-request-lifecycle.test.ts src/main/tool-approval.test.ts`，预期全部通过；确认未改后台 AgentModel。
- [x] 提交：`git commit -m "refactor: extract chat harness while preserving legacy execution"`。

## Task 3: 持久关联与一次执行边界（H-09、H-10）

**Files:** 新建 `store.ts`、`store.test.ts`；完善 `contracts.ts`。

**Interfaces:** `HarnessStore` 在 `userData/harness/runs.db` 提供 `begin(input: HarnessInput): RunRecord`、`transition(key: RunKey, expected: RunState, next: RunState):boolean`、`linkTool(key: ToolKey, interactionId:string):void`、`recordReceipt(key: ToolKey, receiptRef:string):void`、`listUnsettled():RunRecord[]`、`close():void`。`RunKey={requestId,attemptId}`；`ToolKey=RunKey & {callId:string}`；RunRecord 含联系人/会话、引擎、快照指纹、配置版本、DSH 会话、状态及消息/回执引用，无正文/密钥。RunState 为设计第 5 节八种状态。

- [x] 写 `store.test.ts`：`scopes_reused_call_ids` 断言两请求同 callId 产生不同关联；`does_not_reopen_terminal_execution` 断言 `expect(store.transition(completedKey,'running','completed')).toBe(false)`；`persists_receipt_without_credentials` 断言重开账本可读 receiptRef 且序列化记录不含 key/正文。
- [x] 执行 `npx vitest run src/main/harness/store.test.ts`，确认新增存储缺失造成失败。
- [x] 实现 SQLite 迁移、唯一索引、条件更新及关联查询；正式消息预分配稳定 messageId。状态更新不代表 DSH 日志已落盘，flush 回执须单独保存；已开始但结果未知的写入不得重新开放 claim。
- [x] 重跑存储测试；在事务提交前后故障注入并重新打开数据库，断言最多一份关联、已保存回执未丢失、没有第二次工具执行。
- [x] 提交：`git commit -m "feat: persist harness execution and receipt identities"`。

## Task 4: 正式桥接、请求上下文与隔离（H-02、H-03、H-04、H-05）

**Files:** 新建 `dsh/transport.ts`、`dsh/runtime.ts`、`dsh/adapter.ts`、`dsh/runtime.test.ts`；修改 helper/plugin、`src/shared/harness.ts`。

**Interfaces:** `DshRuntimePool.acquire(input: HarnessInput):Promise<DshRuntimeLease>`、`close():Promise<void>`；lease 提供 `run(input,emit):Promise<HarnessResult>`、`cancel(key:RunKey):Promise<void>`、`flush(key:RunKey):Promise<boolean>`、`release():Promise<void>`。`DshAdapter` 实现 Task 2 HarnessAdapter。协议为带版本、RunKey、seq 的 discriminated union，命令含 prepare/start/cancel/flush/tool-result，事件含 ready/text/tool-request/usage/committed/error；运行时不接收可覆盖主进程归属的模型字段。

- [x] 写 `runtime.test.ts`：`separates_provider_groups_and_contact_scopes` 断言不同配置组不同初始化，同组两联系人 prompt/tools 不交叉；`fresh_session_uses_edited_snapshot` 断言新 sessionId、请求最后输入等于编辑后的用户消息、旧后续正文不存在；`cancel_one_keeps_sibling` 断言 B 仍能完成。
- [x] 执行 `npx vitest run src/main/harness/dsh/runtime.test.ts`，确认正式 adapter 缺失导致失败。
- [x] 实现仅监听 `127.0.0.1` 的随机端口、每次启动随机令牌、全双工 TCP NDJSON 命令与有序事件流（实现裁定见验收记录）。限定每帧 1 MiB、待发送总量 8 MiB；超限、缺口或断线明确终止受影响执行，不无限缓存。SDK stdio 保持官方 JSON-RPC，禁止日志污染 stdout。
- [x] 在插件使用公开 scoped prompt/history 构造能力注入原始角色顺序，不能把历史全部拼成一条 user 输入；以实际出站模型请求测试该行为。每请求新建 DSH 会话，禁用额外默认身份、压缩/总结请求和默认工具；对应正式 assistant 事件与输入收据绑定，不只使用 finalResponse/idle。
- [x] 实现按有效供应商/端点/模型/配置版本分组；调用公开 `Agent.cancel`、`whenIdle`、`ctx.sessions.flush`。配置失效只取消相关 RunKey；启动/退出有界回收 helper 子树，单请求取消不能杀共享进程。
- [x] 重跑 runtime/provider 测试，增加未授权 token、超限帧、错误归属测试，断言 `expect(businessCalls).toHaveLength(0)`；真实 SDK 证据落隔离测试目录。
- [x] 提交：`git commit -m "feat: bridge isolated DSH execution into the chat harness"`。

## Task 5: 原确认卡片回执交回 DSH（H-07、H-08、H-09）

**Files:** 新建 `action-results.ts`、`action-results.test.ts`；修改 `tools.ts`、`agents/service.ts`、`agents/action-executor.ts` 的必要通知接缝和对应测试、`dsh/adapter.ts`。

**Interfaces:** `waitForActionReceipt(key: ToolKey, interactionId:string, signal:AbortSignal):Promise<string>` 在 action-results 读取/订阅原服务持久状态；先订阅再读取，避免保存与等待之间丢事件。`cancelPendingActions(key: RunKey):Promise<void>` 仅失效本请求未执行事项。ChatToolContext 新增 `confirmationMode:'legacy-return-card'|'await-receipt'` 及 `beforePersistentOffer(key:ToolKey):Promise<void>`；DSH 模式该钩子先保存账本并等待 lease.flush。

- [x] 写 `action-results.test.ts`：`returns_saved_receipt_without_second_execute` 断言 `expect(actualWrite).toHaveBeenCalledTimes(1)`、`expect(dshToolResult).toBe(savedReceipt)`；`waits_65000ms_without_inference` 断言等待 65 秒卡片仍 pending、模型请求计数未增加；`rejects_changed_owner_or_version` 断言写入次数为 0。
- [x] 执行 `npx vitest run src/main/harness/action-results.test.ts`，确认等待与桥接能力缺失导致失败。
- [x] 复用原 `offerAction`、`executeContactAction` 和读取接口，通知只在回执实际保存后发布；恢复/并发通过重新读取持久状态裁决。持久卡点击由原服务执行，DSH bridge 只返回保存结果；非持久确认复用 waitForToolApproval。读资料登记原上下文；DSH 工具白名单暂只开放 read_contact_material/set_contact_output_preference。
- [x] 补测拒绝、重复点击、同 callId 异请求、显式停止、过期/迟到答复、flush/卡片保存失败；`write_succeeds_receipt_fails` 断言状态待核对、重试写入次数仍 1。真实 SDK 集成至少实际等待 65 秒一次，不能只以假时钟代替。
- [x] 重跑上述测试及原 action-executor/tool-approval 测试，读回原偏好服务确认值；没有新增批准 UI 或第二轮点击。
- [x] 提交：`git commit -m "feat: return durable contact action receipts to DSH tools"`。

## Task 6: 接入原聊天、流式修正与用量（H-01、H-06、H-11、H-12）

**Files:** 新建 `dsh/stream.ts`、`dsh/stream.test.ts`、`coordinator.test.ts`；修改 ipc、index、shared/ai、renderer/core/ai-engine、ChatPanel/useSessionWorkspace 及原测试。

**Interfaces:** `DshStreamReducer.accept(frame: HarnessWireEvent): HarnessEvent[]`，维护 request/attempt/revision/index。AIStreamEvent 保留原字段，新增可选 `operation:'append'|'replace'` 和 `attemptId/sequence`；`StreamCallback(chunk:string, done:boolean, operation?:'append'|'replace')` 兼容原调用。完成结果携带稳定 messageId/执行来源，原保存路径幂等保存并回写账本消息引用。用量事件以真实 provider requestId 标识，缺失 token 为 null。

- [x] 写 `stream.test.ts`：`replaces_failed_attempt_and_deduplicates_commit` 喂入旧正文、重试、新正文及重复 committed，断言 `expect(rendered).toBe(committedText)`、`expect(savedMessages).toHaveLength(1)`；`gap_fails_without_successful_partial` 断言终态不是 completed；`counts_actual_calls_unknown_is_null` 断言每次实际调用一条记录。
- [x] 执行 `npx vitest run src/main/harness/dsh/stream.test.ts src/main/harness/coordinator.test.ts`，确认缺失归并/绑定路径导致失败。
- [x] 实现片段去重、版本切换整体替换、终态核对与部分输出标记；更新原 ai-engine 不再将完整 reply 重复追加。取消禁止迟到追加/保存成功消息；上下文和来源先附着再完成保存，不增加模型重写。
- [x] 注册 DSH adapter，保持路由优先与内部联系人绑定；保留 bindAIRequestLifecycle：隐藏/关闭聊天继续，renderer 崩溃/导航/应用退出取消。未读与托盘仍走原保存逻辑，界面不出现执行阶段 ID。
- [x] 重跑新增和原 `ai-engine.test.ts`、`ChatPanel/stream-render.test.ts`、`ai-request-lifecycle.test.ts`；断言首字前/中途停止、隐藏完成未读、非试点走 legacy、DSH 故障 legacy 调用数为 0。
- [x] 提交：`git commit -m "feat: connect DSH streaming and cancellation to existing chat"`。

## Task 7: 故障核对与敏感日志删除（H-05、H-10、H-13）

**Files:** 新建 `recovery.ts`、`recovery.test.ts`；修改 store、index、ipc、agents/service、dsh/runtime 相关数据失效接缝。

**Interfaces:** `recoverHarnessRuns(store:HarnessStore, services:RecoveryServices):Promise<void>`；RecoveryServices 注入原卡片/回执/消息查询及幂等保存，不能 dispatch 模型或 execute 工具。`purgeHarnessData(scope: {characterId:string; sessionId?:string; sourceIds?:string[]}):Promise<{ok:boolean; pendingRunIds:string[]}>` 按原删除范围先取消再清理敏感日志、附件和临时副本，保留必要 ID/状态/回执引用。

- [ ] 写 `recovery.test.ts`：以设计第 8 节七行恢复表为参数化用例，逐一断言 `expect(modelDispatches).toBe(0)`、`expect(toolReplays).toBe(0)` 及目标状态；`committed_reply_saved_once` 重跑恢复两次，断言同 messageId 仅一条。
- [ ] 执行 `npx vitest run src/main/harness/recovery.test.ts`，确认恢复/删除入口缺失导致失败。
- [ ] 实现启动核对；意外进程中断保留原有效持久卡片，显式停止使未执行事项失效。已执行/未知结果保留真实回执或待核对；非持久等待失效；不 resume 后重发输入。
- [ ] 接入聊天清空/会话删除/联系人删除和资料正文清理、记忆撤回边界；按存储关联定位而非扫描任意目录，验证绝对目标在 harness 数据根内。新请求不重用旧上下文；删除失败保留可见未清理状态及可重试清理，不谎报删除成功。
- [ ] 在首次 flush 前后、创建确认前后、业务写入前后、消息保存前后强制退出并重启；`purge_failure_is_visible_and_old_context_not_reused` 断言旧正文不出站、pendingRunIds 非空。请求结束按所需核对范围清理临时敏感副本，保留仍待处理卡片必需的引用。
- [ ] 重跑 recovery/store/action-results 测试，核对跨库间隙均有明确状态；提交 `git commit -m "feat: reconcile interrupted harness runs without replay"`。

## Task 8: Windows 打包闭包与进程清理（H-13）

**Files:** 修改 build-dsh-runtime、manifest、electron-builder.yml、根 package.json、runtime/helper；新增 `src/main/harness/dsh/packaging.test.ts`。

**Interfaces:** 构建命令 `npm run build:dsh-runtime` 输出 `out/dsh-runtime/`，含 manifest、Node、helper/plugin/profile 和运行依赖；electron-builder 复制到 `resources/dsh-runtime/`。`resolveDshRuntimePaths(resourcesPath:string, packaged:boolean): {node:string; helper:string; profile:string}` 在 dsh/runtime.ts 返回物理路径，不将 Electron process.execPath 当 Node。

- [ ] 写 `packaging.test.ts`：`resolves_physical_resources_with_spaces` 断言路径在资源目录、无 app.asar 内模块和邻仓路径；`launch_failure_reaps_children` 断言超时后子树均退出；`mac_binding_remains_disabled` 断言没有启动 helper。
- [ ] 执行 `npx vitest run src/main/harness/dsh/packaging.test.ts`，确认当前资源解析与闭包缺失导致失败。
- [ ] 完成固定 Node 下载/校验（仅构建时）、锁文件安装、必要原生模块/资源/许可证收集及资源清单；构建入口显式调用 build:dsh-runtime。Windows 资源收集按平台隔离，不使现有 macOS 构建要求 Windows Node；没有平台资源时仍能启动 legacy。
- [ ] 执行 `npm run package:win`，在移除全局 Node PATH、离线、包含空格安装路径的隔离环境启动成品，执行 SDK 合成对话、工具回执、停止及退出；核对 manifest 和无残留进程。不能把开发启动代替此验收。
- [ ] 重跑 packaging 测试和现有构建配置检查；macOS 实机构建未运行则在记录中明确，不宣称已验证。
- [ ] 提交：`git commit -m "build: bundle a standalone Node runtime for DSH on Windows"`。

## Task 9: 分层验收与内部试点交付（H-01 至 H-14）

**Files:** 新建 smoke/dsh-harness-smoke.ts、docs/dsh-harness-acceptance-20261015.md；修改 scripts/smoke-electron.js、docs/contact-agents-architecture.md、docs/contact-task-spec.md 和本计划状态。

**Interfaces:** `node scripts/smoke-electron.js --dsh-harness` 使用临时 userData 和合成联系人；`--dsh-harness-live` 复用现有安全配置读取方式但不复制真实历史；`--dsh-harness --packaged dist/win-unpacked/ChouYu.exe` 指向成品。输出脱敏验收 JSON、截图和日志路径，失败退出非零；配置不可用记未验证，不伪造成功。

- [ ] 先写端到端断言：`dsh_reads_material_and_saves_preference_via_original_card` 核对运行来源为 DSH、真实资料正文、原卡 ID、原偏好读回和一次副作用；`hidden_chat_completes_unread` 核对隐藏时保存/未读，重开不重复 dispatch。运行新 smoke 命令确认缺少验收入口时失败。
- [ ] 实现隔离验收驱动，复用已有 smoke 启动/截图能力；通过实际 UI 打开卡片、等待至少 65 秒、关闭/重开/批准/拒绝/停止。真实有效供应商至少覆盖普通聊天、读资料、带确认写入三项，轨迹证明绕过原意图路由的直接完成分支后进入 DSH。
- [ ] 执行新 smoke 三层命令、`npm run typecheck`、`npm test`、`npm run build` 以及现有联系人/助手 smoke；记录每项命令退出码和 H-01 至 H-14 证据，不重复无变化的完整检查。
- [ ] 按设计验收矩阵和本文 Review Focus 自查；完成代码审查并解决实质问题。检查原任务 UI、公共规则、引用来源、未读闪烁和禁项无回归；没有真实供应商或成品证据的条目保持未通过。
- [ ] 同步产品规范第 10 节、架构和验收文档：写明两项工具覆盖、原路由/后台任务仍旧引擎、平台状态、失败回滚步骤及未覆盖项。仅所有首阶段必要门槛通过后在隔离试点启用内部绑定；日常联系人默认仍 legacy。
- [ ] 提交：`git commit -m "test: verify and document initial DSH harness integration"`；交付实际完成范围、测试结果和风险，不称全部功能迁移。

## Coverage and Handoff

依赖顺序：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9。Task 1 若供应商或固定依赖不成立，先解决该证据缺口，避免完成其余重构后才发现无法运行。Task 2 的默认路径可单独验收；所有后续能力在显式内部绑定之外保持关闭。

| 设计要求 | 实施/验收任务 |
| --- | --- |
| 边界与业务归属，路由保留，原引擎回滚 | 2、5、6、9 |
| 身份/快照/配置隔离、能力与真实供应商 | 1、2、4、9 |
| 工具确认、一次写入、65 秒等待 | 3、5、9 |
| 推送、取消、用量、保存/来源、隐藏/退出 | 4、6、8、9 |
| 落盘、七种中断恢复、敏感副本清理 | 3、5、7 |
| Windows 离线闭包、平台边界 | 1、8、9 |

回滚：撤去内部绑定仅影响新请求；正在执行的请求先按显式停止规则收敛。保留账本/实际回执供核对，不自动重发 DSH 失败输入，不删除已有聊天和后台检查点。

计划自查：设计各节已映射；Review Focus 五项均有指定测试；跨任务统一使用 RunKey/ToolKey 和既有服务；供应商字段已核对现有 AppConfig/EffectiveChatConfig。SDK 具体 API 以固定版本安装包类型为准，不能为绕过测试改写协议/供应商行为或创建新的用户配置。

执行方式建议：Native，在当前会话按上述顺序实施，最后独立审查。九步共享上下文、卡片和持久化接口，顺序实现可以减少重复传递上下文；也可选择逐任务子代理实现与审查，增加独立检查及上下文成本。待用户审阅本计划并选择后进入实施，执行前使用 using-git-worktrees 技能落实隔离。
