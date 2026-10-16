# ChouYu 内置 Harness 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将原生执行流程正式模块化，与 DSH 共用接入契约，迁移全部调用方并删除旧接口。

**Architecture:** 公共宿主管业务，静态注册及协调器管执行生命周期，native 与 dsh 模块负责各自执行实现。原生供应商协议各自编码、请求和解析，只有一份工具循环；后台任务直接使用该执行基础，保留业务调度与预算。

**Tech Stack:** TypeScript、Electron、React、Vitest；使用仓库现有 Node 24 和 DSH 依赖，不新增依赖。

**Spec:** [已确认设计](../specs/2026-10-16-native-harness-design.md)

状态：用户已确认计划及本会话顺序实施、最后独立审查的方式；实施中。任务勾选表示实际完成，不能以写好计划替代实现或验收。

## Global Constraints

- 源码及当前测试中的原生引擎 ID 统一改为 `native`，默认值、联系人校验、自然语言设置 schema、UI 选项和 smoke 夹具一并迁移。
- 不为 `legacy` 加别名、特殊读分支或专用数据迁移器；不得为了清理名称删除真实用户数据、会话或 DSH 运行记录。
- 删除 `legacy.ts` 和 `createLegacyAdapter`。从 `ai.ts` 移除 `streamAIChat` 及其执行实现；`ai.ts` 只保留供应商模型列表和诊断能力。
- 原生最多 6 轮；保留逐轮预算检查、输出上限、用量回调、流中断与取消，以及现有供应商协议适配。
- DSH 仅 Windows 普通文本聊天，工具范围是 `read_contact_material`、`get_contact_output_preferences`、`set_contact_output_preference` 与宿主当前授权工具的交集。
- 失败不自动切换引擎，不自动重放可能已产生副作用的调用；原生不声明崩溃恢复能力。
- 入口仍为“联系人 → 详情 → 编辑 → 聊天执行引擎”；不新增环境变量选择方式。
- 后台任务、日记与主动消息迁移模型调用，不改变任务调度、预算、成果写入、身份、单描述 UI 和未读闪烁约定。
- 不用新增兼容层解决测试失败；更新所有实际调用与测试 mock 的目标路径。不修改无关业务中其他含义的 `legacy` 字段。

## Review Focus

1. 停止发生在一轮模型响应后、工具执行前：不得调用业务工具或下一轮模型（任务 1、2）。
2. DSH 模型调用未暴露的工具：不能仅靠过滤定义，实际执行也必须拒绝（任务 2）。
3. 任务模型在第二轮预算不足：不得再请求供应商，不重复释放未取得的轮次占用（任务 1）。
4. 引擎切换与意图路由并发：已开始请求继续原模块，路由不进入 DSH 回执等待（任务 3）。
5. 清理异常与窗口关闭并发：原执行错误可见，活动请求释放，已取消结果不在恢复时复活（任务 2、3）。

## 文件与接口布局

| 文件 | 职责 |
| --- | --- |
| `src/main/harness/tool-runtime.ts` | 不依赖 Electron 的工具执行类型 |
| `src/main/harness/native/types.ts` | 原生流选项、回调、单轮结果及供应商会话接口 |
| `src/main/harness/native/runner.ts` | 唯一原生多轮循环，直接供业务模型调用 |
| `src/main/harness/native/providers/{openai,claude,request}.ts` | 协议编码与单轮请求、请求守卫与流读取 |
| `src/main/harness/native/index.ts` | 原生执行适配器与模块工厂 |
| `src/main/harness/contracts.ts` | 输入、统一事件、模块能力、确认及生命周期类型 |
| `src/main/harness/registry.ts` | 模块注册、能力校验与工具范围约束 |
| `src/main/harness/coordinator.ts` | 请求序号、终态、取消与异常收尾 |
| `src/main/harness/dsh/module.ts`、`dsh/service.ts` | DSH 模块与原服务实现，封装持久化和 SDK |
| `src/main/harness/service.ts` | 静态模块组合及应用调用入口，不含 DSH 表结构操作 |
| `src/main/ipc.ts`、`src/main/index.ts` | 通过公共入口执行、确认消息保存、恢复和关闭 |

## Task 1：抽出唯一原生执行模块并迁移调用方

**Files:** 新建上述 `tool-runtime.ts`、`native/` 文件及 `native/runner.test.ts`、`native/index.test.ts`；删除 `harness/legacy.ts`、`legacy.test.ts`。修改 `ai.ts`、`ai.test.ts`、`harness/{contracts,prepare,coordinator}.ts` 及相关测试。

同时迁移 `agents/service.ts`、`assistant-routines/{index,companion-summary}.ts`、`journal/summary.ts`、`ipc.ts`、`smoke/{provider-live,mem0-recall-live,dsh-harness-smoke}.ts`；直接依赖旧函数的验收测试和 mock 一并更新。引擎名修改覆盖 `shared/{harness,characters,contact-profile-settings}.ts`、`main/{database,agents/chat-changes}.ts`、`renderer/src/components/Contacts/ContactsView.tsx` 及其测试。

**Interfaces:**

- `HarnessToolRuntime`：`definitions: AIToolDefinition[]`，`execute(call: AIToolCall): Promise<string>`，位于 `tool-runtime.ts`，取代 `AIToolRuntime`。任务 2 增加可选 `subscribe(listener: (event: ToolExecutionEvent) => void): () => void`，状态类型使用已有 shared 工具事件。
- `NativeStreamOptions`：`timeoutMs?`、`maxOutputTokens?`、`onMetadata?`、`beforeRound?(round: number, input: string): number | undefined | Promise<number | undefined>`、`afterRound?(): void`。
- `NativeStreamCallback = (chunk: string, done: boolean) => void`；`NativeRoundResult = {text: string; toolCalls: AIToolCall[]}`。
- `NativeConversation`：`serialize(): string`、`request(config: AppConfig, onChunk: NativeStreamCallback, signal: AbortSignal | undefined, options: NativeStreamOptions): Promise<NativeRoundResult>`、`append(result: NativeRoundResult, results: string[]): void`；工具结果与调用按索引对应。
- `createOpenAIConversation` / `createClaudeConversation(messages: AIChatMessage[], systemPrompt: string, definitions?: AIToolDefinition[]): NativeConversation`。
- `streamNativeChat(messages: AIChatMessage[], systemPrompt: string, config: AppConfig, onChunk: NativeStreamCallback, signal?: AbortSignal, tools?: HarnessToolRuntime, options?: NativeStreamOptions): Promise<void>`。
- `createNativeAdapter(model = streamNativeChat): HarnessAdapter`：模块内部使用的新原生适配器；没有旧名称导出。

- [x] **1. 写协议级测试。** 将现有 AI 执行测试迁入 `native/runner.test.ts`，供应商诊断测试留在 `ai.test.ts`。给两种协议补“响应完成后取消”“第二轮预算不足”“工具间取消”测试，断言真实 fetch 次数、工具调用次数和钩子次数，而非只检查导出名称。例如第二轮预算拒绝：

  ```ts
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(beforeRound).toHaveBeenCalledTimes(2)
  expect(afterRound).toHaveBeenCalledTimes(1)
  ```

- [x] **2. 验证新增测试失败。** 运行 `npx vitest run src/main/harness/native/runner.test.ts`，确认缺少新入口或缺少取消检查导致预期失败，不接受无关夹具错误。
- [x] **3. 提取协议请求与执行循环。** 按上列接口搬移协议编码、请求守卫、流终止处理和用量解析；`runner.ts` 负责唯一循环及每个副作用边界的取消检查。原生适配器输出公共文本和用量事件，每轮使用稳定请求标识更新累计用量。
- [x] **4. 一次迁移全部调用方与引擎 ID。** 删除旧导出和包装；正常设置及默认值使用 `native`。修改业务调用的 import 和 mock，不改变其超时、预算及输出限制。`accumulateOpenAIToolCalls` / `accumulateClaudeToolCalls` 的测试直接导入新 provider 文件，不从 `ai.ts` 转导出。
- [x] **5. 验证原生与调用方回归。** 运行 `npx vitest run src/main/ai.test.ts src/main/harness/native src/main/agents/service-tool-boundary.test.ts src/main/assistant-routines src/main/journal/summary.test.ts src/shared/characters.test.ts src/shared/contact-profile-settings.test.ts src/main/database.test.ts`，并运行 `npm run typecheck`。确认 `rg -n 'streamAIChat|createLegacyAdapter|AIToolRuntime|AIStreamOptions|AIStreamCallback' src scripts` 无旧执行入口命中；检查 Harness 相关 ID 无 `legacy` 分支。
- [x] **6. 提交。** `refactor: extract native harness and migrate execution callers`。覆盖 NH-01、NH-02、NH-08，以及 NH-07 的设置类型部分。

## Task 2：模块注册、能力约束与协调契约

**Files:** 新建 `harness/registry.ts`、`registry.test.ts`、`contract.test.ts`；修改 `contracts.ts`、`coordinator.ts`、`coordinator.test.ts`、`native/index.ts`、`tools.ts`、`tools.test.ts` 和 DSH 工具事件发送处。

**Interfaces:**

- `HarnessCapabilities`：`platforms: 'all' | readonly NodeJS.Platform[]`、`scenarios: readonly ('chat')[]`、`images: boolean`、`systemHistory: boolean`、`tools: 'host' | readonly string[]`、`confirmation: 'return-card' | 'await-receipt'`、`recovery: 'none' | 'committed-result'`。
- `HarnessConfirmation` 使用判别联合：`{mode: 'return-card'}` 或 `{mode: 'await-receipt'; beforeOffer(call: AIToolCall): Promise<void>; waitForReceipt(call: AIToolCall, card: ContactActionInteraction): Promise<string>}`。
- `HarnessPurgeScope = {characterId: string; sessionId?: string; sourceIds?: string[]}`。
- `HarnessLifecycle`：可选 `recover(): Promise<void>`、`purge(scope: HarnessPurgeScope): Promise<void>`、`acknowledgeSaved(sessionId: string): Promise<void>`、`close(): Promise<void>`。
- `HarnessModule`：`id: HarnessEngine`、`label: string`、`capabilities: HarnessCapabilities`、`adapter: HarnessAdapter`、`confirmation(input: HarnessInput): HarnessConfirmation`、可选 `lifecycle: HarnessLifecycle`。
- `HarnessRegistry(modules: HarnessModule[])`：重复 ID 拒绝注册；`get(engine: HarnessEngine): HarnessModule`；`prepare(engine: HarnessEngine, input: HarnessInput, platform: NodeJS.Platform): HarnessInput` 检查平台/场景/图片/system 历史，限制工具定义及 execute，返回新输入对象。
- `HarnessCoordinator` 改为接收注册表；`run` 保留冻结的 engine 参数，不再接收裸适配器表。`HarnessUpdate` 的工具状态增加 `failed`；`createChatTools` 提供上述 `subscribe` 接口，将真实 `ToolExecutionEvent` 同时送给原 UI 与执行期订阅者，协调器映射为 Harness 工具事件，不从错误字符串猜测成功与否。

- [ ] **1. 写注册表与双引擎契约测试。** 原生/DSH 模块用同一套断言验证能力、序号与终态。覆盖禁用平台、图片、额外 system 历史、工具定义交集、直接调用白名单外工具、调用期间撤权、重复注册及缺少模块。越权调用断言：

  ```ts
  await expect(prepared.tools!.execute(forbiddenCall)).rejects.toThrow()
  expect(hostExecute).not.toHaveBeenCalled()
  expect(adapterRun).not.toHaveBeenCalled() // 输入能力校验失败场景
  ```

  协调测试另覆盖执行抛错且 invalidate 也抛错、取消后迟到文本、取消中 close、重复活动请求：仅一个失败/取消终态，保留原错误，之后同请求 ID 可重新显式提交。
- [ ] **2. 验证失败。** `npx vitest run src/main/harness/registry.test.ts src/main/harness/contract.test.ts src/main/harness/coordinator.test.ts`，确认失败对应新接口及行为。
- [ ] **3. 实现注册及统一事件。** 注册表校验不初始化引擎资源；协调器只依赖契约与能力，不知道 DSH 工具名。工具服务以实际事件报告执行、等待和失败；不重复发送 DSH runtime 与宿主的同一个工具状态。卡片发送完成与业务完成的含义必须分开，不增加第二套 UI。
- [ ] **4. 验证契约及工具回归。** 运行上列测试加 `src/main/harness/tools.test.ts src/main/harness/native/index.test.ts`；检查原生启动、取消和失败不触发 DSH factory/进程；共同序号严格递增且终态后无输出。
- [ ] **5. 提交。** `refactor: unify harness registry capabilities and run lifecycle`。覆盖 NH-04、NH-05 及 NH-06 的事件语义。

## Task 3：DSH 模块化与公共宿主接入

**Files:** 新建 `harness/dsh/module.ts`、`module.test.ts`、`harness/service.test.ts`。原 `harness/service.ts` 的 DSH 具体实现移入 `harness/dsh/service.ts`，原路径改为公共组合入口。修改 `ipc.ts`、`index.ts`、`harness/tools.ts`、`harness/prepare.ts`、`harness/dsh/{runtime,adapter}.ts` 以及 `smoke/dsh-harness-smoke.ts` 的必要 import。

**Interfaces:**

- `createNativeModule(): HarnessModule` 与 `createDshModule(host: {cancelRun(requestId: string): Promise<void>}): HarnessModule`，工厂不启动 DSH 运行时。宿主取消函数同时取消原 sender 控制器和协调器，生命周期 purge 沿用这一取消入口，避免模块反向导入公共组合服务。
- 公共 `service.ts` 导出 `chatHarness`、`harnessRegistry`、`recoverHarnessModules(): Promise<void>`、`purgeHarnessData(scope: HarnessPurgeScope): Promise<void>`、`acknowledgeHarnessMessages(sessionId: string): Promise<void>`、`closeHarnessModules(): Promise<void>`，以及 `setHarnessCancellation(cancel: (requestId: string) => Promise<void>): void` 绑定原 sender 控制器取消入口。生命周期分发访问注册模块，具体存储访问只在 DSH 实现。
- `createChatTools` 接收一个完整 `HarnessConfirmation`，路由阶段固定 `return-card`；正式执行输入准备好后，根据冻结模块绑定确认对象，再创建执行阶段工具。不再使用 `receiptMode` 可变闭包和 `harnessInput!`。
- 公共工具事件订阅绑定具体执行请求，终态/取消时解除订阅；工具结果继续供模型和原业务路由消费，不重写业务保存逻辑。

- [ ] **1. 写模块生命周期与宿主测试。** 使用可控 DSH service 替身证明原生请求不启动 DSH、生命周期分发正确、保存确认仅认可同会话同来源且已落盘的助手消息、清理失败保留状态。借用现有 DSH 真实存储测试验证停止后的记录不会恢复投递。路由延迟期间改变引擎，断言开始时选中的模块仍执行；路由返回已处理结果时两个模块均不运行。
- [ ] **2. 验证失败。** `npx vitest run src/main/harness/service.test.ts src/main/harness/dsh/module.test.ts`，确认缺失公共接入行为导致失败。
- [ ] **3. 实现 DSH 模块。** 能力声明使用设计中的三工具列表；执行前 recovery guard、确认前 flush、等待回执、invalidate、恢复/删除/保存确认/关闭均封装到模块。保留原 DSH SDK、日志去重和已提交记录恢复逻辑，不增加业务 writer。
- [ ] **4. 迁移 IPC 和启动关闭接入。** 请求第一次 await 前冻结模块；自然语言路由使用原公共工具服务，只有普通聊天进入模块。IPC 的文本发送始终使用 operation/attemptId/sequence；最终回复根据公共结果字段处理，不按引擎名称判断。保存确认通过公共生命周期入口且必须在数据库真正落盘后进行。
- [ ] **5. 验证接入回归。** `npx vitest run src/main/harness`，并检查 `ipc.ts`、`index.ts` 不导入 DSH service/adapter、无 DSH 工具白名单及 engine 等于 dsh 的执行分支。运行 `npm run typecheck`。保留原 stop、权限/引用失效、卡片拒绝/重复提交和删除清理测试。
- [ ] **6. 提交。** `refactor: route chat and persistence through harness modules`。覆盖 NH-03、NH-06、NH-09。

## Task 4：整体回归、实际界面、独立审查和交付

**Files:** 更新 `smoke/dsh-harness-smoke.ts`、必要的原生聊天 smoke 断言、`docs/contact-agents-architecture.md`、`docs/contact-task-spec.md` 第 10 节；新建 `docs/native-harness-acceptance-20261016.md`；更新本计划状态。

**Interfaces:** 使用前三项产出的实际应用接口；不新增专为通过测试的执行分支。验收记录按 NH-01～NH-10 逐项链接证据。

- [ ] **1. 补实际 UI 验收断言。** 已有 DSH smoke 使用新 `native` ID；确认原生和 DSH 均经过公共事件路径，文字不重复追加，切回原生不增加 DSH 运行记录。保留联系人独立选择、进行中切换、资料读取、确认/拒绝/重复点击、等待中停止、隐藏后未读保存的断言。
- [ ] **2. 执行整体检查。** 顺序运行 `npm run typecheck`、`npm test`、`npm run build`，各自保存日志与退出码。全量测试不与 Electron smoke 并发。新失败先按 systematic-debugging 定位，不通过改超时或删断言取得通过。
- [ ] **3. 实际运行界面与关键业务回归。** 使用现有本地 runtime 和隔离用户数据，顺序运行 `node scripts/smoke-electron.js --dsh-harness`、`--agents`、`--assistant-routines`、`--companion`；参数分别单独执行。`CHOUYU_SMOKE_ARTIFACTS` 仅指定验收输出目录，不用于选择用户引擎。检查退出码及具体场景报告，查看原生/DSH切换截图；有截图不等于行为通过。日记用原有单元/集成测试验证总时限和证据引用链路。
- [ ] **4. 独立代码审查。** 按 requesting-code-review 技能对整条变更分支审查；重点 NH-01～NH-10、上述五项风险及公共业务权限/消息来源。修复发现的问题并运行与修改匹配的回归，不将未处理的重要问题写成完成。
- [ ] **5. 逐项完成审计及文档。** 用实际代码、测试结果、运行报告和审查结论填写验收表。记录仍存在的 DSH 发布门槛，不声称真实供应商或完整崩溃矩阵通过。架构及产品实现状态说明新的调用边界；对已删除函数、旧 ID、残留 DSH IPC 分支做定向搜索，不靠搜索结果替代行为验证。
- [ ] **6. 提交并交付。** `docs: record native harness implementation and verification`。提供实际分支、提交、验证结果及限制；推送/发布不在本轮要求内。若用户要求合入，按已有授权和当前分支状态完成本地集成及必要复核。

## 完成对应关系与执行建议

任务 1 对应 NH-01/02/08；任务 2 对应 NH-04/05；任务 3 对应 NH-03/06/09；任务 4 补 NH-07 的实际 UI 并完成 NH-10，统一审计所有要求。

推荐在本会话由主执行者按顺序实施，最后一位独立审查者检查整个分支。四项任务共享接口和迁移边界，逐任务更换实现者会增加交接成本。本计划确认后先按 using-git-worktrees 技能建立隔离工作区，再执行；不会把本计划的提交当作实现完成。
