# 任务成果设计师 Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 正式任务成果自动交给专职设计师，经编程、真实预览和视觉检查后展示，直接替换作者自定义展示机制。

**Architecture:** 在既有 AgentSpace/WorkLoopHost 中增加设计模块，沿用 Harness、共享调度和计费；设计工作与正文任务分别存储。联系人提交同事务登记设计输入，助手安排通过持久事件跨库接收。主进程提供隔离预览，任务成果与成果集共用新展示组件。

**Tech Stack:** Electron、TypeScript、React、SQLite、现有 Native/DSH Harness；生成页面使用 HTML/CSS/原生 JavaScript，不新增运行时外部依赖。

**Spec:** `docs/superpowers/specs/2026-11-06-result-designer-agent-design.md`

## 执行记录（2026-11-06）

用户选择隔离 worktree 内连续实施、末尾独立审查。Task 1–7 的产品链路已接入，Task 8 的本地测试、真实 Electron 与独立复审已执行；具体证据和在线模型未测范围见 [验收记录](../../result-designer-acceptance-20261106.md)。未自动发布或启动真实任务。

实现按现有模块契约使用 `prepare/advance/close`，设计接口放在既有强类型 worker 命令边界；测试位于 `src/main/result-designer/`，UI 通过实际 Electron 验收。新请求额外携带阅读时的固定来源，防止弹窗静默提交到新版正文。下面保留制定计划时的细项作为核对基准，不通过批量打勾冒称所有枚举故障或在线质量均已实测。

## Global Constraints

- 正式成果自动交给设计师，不要求用户逐项点击。
- 不兼容旧作者展示：不读取、执行、导出或转移旧 `presentation`；旧样式工作停止失效，不转交重放。正式正文、正文版本、文件与来源保留。
- 不改 App 全局导航、任务编辑表单、聊天布局或执行引擎；所有任务复用公共成果组件。
- 设计师并发为 1，并计入现有全局执行名额；每次工作最多 3 轮代码候选。
- 普通聊天输出不等待设计师完成，也不逐条调用设计师重写消息。
- 已确认的正式成果读取范围由宿主绑定；模型和生成页面不能自行扩大跨联系人权限。
- 页面不能访问网络、文件系统、Electron/Node 或父页面；自动发布必须有真实预览与视觉检查记录。
- 当前阅读不热替换；保留原文回退、固定来源、正文引用与阅读位置；主动通知保留未读闪烁。
- 不能把 Native 的图片支持推断为 DSH 支持，不能静默切换引擎。缺少视觉能力时明确阻塞设计，正文继续可读。
- 主动配置/权限/预算仍适用，任务暂停不被设计师恢复，任务已完成不妨碍其最终成果设计。

## Review Focus

- 作者高频提交时不能让设计任务永久饥饿，也不能把过时页面作为最新结果启用；Task 2/5 覆盖。
- 模型代码能运行但隐藏/截断正文，或目录只到部分章节：不能冒充正文完整；Task 4/7 覆盖。
- 完成的作者任务仍要设计最终成果，暂停任务则只允许明确的一次展示修改；Task 2/3 覆盖。
- 视觉模型不支持图片、供应商忽略图片或截图未实际进入请求：不能声称视觉验收通过；Task 5/8 覆盖。
- 旧样式任务、旧卡片与迟到结果跨升级复活作者展示：必须失效，正文仍可读；Task 6/8 覆盖。

## 文件与接口边界

新模块置于 `src/main/result-designer/`：`store.ts` 管独立持久化，`sources.ts` 管固定来源，`module.ts` 管生命周期，`workflow.ts` 管设计循环，`preview.ts` 管 Electron 预览，`preview-port.ts` 管进程间受限请求，`index.ts` 管应用组合。不得由业务域导入 renderer 或 Harness 内部执行器。

公共契约置于 `src/shared/result-design.ts`，页面文档生成置于 `src/shared/result-design-document.ts`，UI 环境说明置于 `src/shared/result-design-environment.ts`。共享模块不导入 Electron。

先定义并在后续任务严格复用：

```ts
type ResultTaskRef = { domain: 'contact' | 'assistant'; ownerId: string; taskId: string }
type ResultSourceRef = ResultTaskRef & { sourceId: string; contentHash: string }
// contact sourceId = String(正式成果版本)，assistant sourceId = 实际执行 ID。
type ResultSection = { id: string; title: string; body: string; sources: { title: string; url: string }[] }
type ResultSourceSnapshot = { ref: ResultSourceRef; title: string; sections: ResultSection[]; fileIds: string[] }
type ResultDesignCode = { title: string; html: string; css: string; script: string }
type DesignState = 'queued' | 'running' | 'validating' | 'ready' | 'blocked' | 'failed' | 'superseded' | 'cancelled'
type DesignReceipt = { requestId: string; task: ResultTaskRef; requestRevision: number; state: DesignState }
type DesignView = { receipt?: DesignReceipt; active?: ResultDesignRecord; error?: string; hasUpdate: boolean }
```

`ResultDesignRecord` 包含独立 ID/版本、固定来源、请求修订号、环境版本、代码哈希、检查记录、实际运行关联和时间；没有正文任务状态或写作阶段字段。`DesignEnvironment` 包含版本、允许的 token/字体/组件说明和视口；`DesignEvidence` 包含各视口/主题的截图引用、结构与交互结果及真实视觉请求/响应关联。运行错误与截图存储不包含密钥。

实施期间每任务先记录 RED，再实现 GREEN，提交前检查该任务测试和相关回归；完整单测在整体验证阶段统一运行。执行进度写入本计划对应的 `.superpowers/sdd/2026-11-06-result-designer-agent/progress.md`，不使用其他任务的日志目录。

## Task 1：新契约与独立设计存储

**Files:** 新建 `src/shared/result-design.ts`、`src/main/result-designer/store.ts` 及对应 `.test.ts`；修改 `src/main/task-center/contact-store.ts`、`src/shared/contact-backups.ts`。

**Interfaces:**
- `ResultDesignStore(db: Database.Database)`；`accept(snapshot: ResultSourceSnapshot, environmentVersion: string): DesignReceipt`。
- `request(task: ResultTaskRef, text: string, sourceKey: string): DesignReceipt`；相同来源重试去重，不同正文拒绝复用同一 sourceKey。
- `view(source: ResultSourceRef): DesignView`；`claim(requestId: string, runId: string): DesignJob`；`saveCandidate(jobId: string, code: ResultDesignCode): ResultDesignRecord`。
- `publish(jobId: string, designId: string, evidence: DesignEvidence): void`；`fail(jobId: string, state: 'blocked'|'failed'|'cancelled', reason: string): void`；`invalidate(task: ResultTaskRef): void`；`recover(): void`。

- [ ] 写真实 SQLite 测试：事务回滚无待办；相同来源只登记一次；源版本与设计版本独立；请求修订后旧候选无法发布；关闭重开保留源快照、队列及当前已启用指针。
- [ ] 运行 `npx vitest run src/main/result-designer/store.test.ts src/shared/result-design.test.ts`，确认缺失行为导致失败。
- [ ] 实现四类独立记录：源快照、每任务最新请求/待处理目标、执行尝试、不可变设计及证据。设计状态与源任务身份分离；只允许满足当前源/请求/环境的已验证候选切换指针。
- [ ] 将存储初始化纳入 `ContactTaskStore` 同一 schema 事务，并将当前 schema version 从 22 升为 23；沿用较旧应用拒绝新库的保护。
- [ ] 加入新契约上限校验：沿用现有代码上限 title 120、HTML 12000、CSS 12000、script 16000 字符；正文沿原成果容量规则，不复制缩减为摘要。
- [ ] 运行上述测试及 `src/main/task-center/contact/requests.test.ts`，确认通过后提交独立存储变更。

## Task 2：正式成果自动接收与固定来源

**Files:** 新建 `src/main/result-designer/sources.ts`、`source-events.ts` 及测试；修改 `src/main/task-center/contact/completion.ts`、`src/main/task-center/contact-store.ts`、`src/main/assistant-routines/service.ts`、`src/main/assistant-routines/index.ts`、`src/main/result-designer/store.ts`。

**Interfaces:**
- `ResultSourcePort.read(ref: ResultSourceRef, signal: AbortSignal): Promise<ResultSourceSnapshot>`。
- `ResultSourcePort.assertCurrent(ref: ResultSourceRef, intent: 'automatic'|'explicit', signal: AbortSignal): Promise<void>`。
- `ResultSourcePort.latest(task: ResultTaskRef, signal: AbortSignal): Promise<ResultSourceSnapshot|null>`。
- `ResultSourceEvents.drain(): Promise<void>`，从已提交事件接收成功后确认水位；只读失败不得被当作删除。

- [ ] 写测试 `formalResultCommitEnqueuesAtomically`：联系人正文提交成功才登记；`finish()` 后续事务失败时正文与设计待办一起回滚；没有新正文/文件、只有进度变化不重复设计。
- [ ] 写测试 `routineOutboxSurvivesProcessExit`：助手正式执行历史与源事件同次应用事务保存，worker 断开后可重放，接收幂等；错误、取消和空结果无设计事件。
- [ ] 写测试 `coalescesPendingWithoutStarvingActive`：同任务一个运行＋一个最新目标；运行中源更新不反复取消，过时结果仅历史保存，不能启用；设计发布不产生新正文事件。
- [ ] 写测试 `respectsSourceLifecycle`：完成任务允许最终设计，暂停阻止自动设计但明确修改可以处理固定版本；删除/撤权使在途提交失效；来源读取异常保留错误。
- [ ] 运行 `npx vitest run src/main/result-designer/sources.test.ts src/main/result-designer/source-events.test.ts` 确认 RED。
- [ ] 实现联系人同事务接收。助手使用其 `deps.commit` 的实际应用事务写持久 outbox，主进程重放到 worker；只在 worker 确认接收后标已处理。快照来源为真实 execution ID，不构造假历史版本。
- [ ] 在首次打开已有任务成果时按 `latest()` 惰性登记正文，不加载旧展示。文件仅提供元数据/宿主受限预览，不赋予任意文件读取权限。
- [ ] 运行上述测试和 `src/main/assistant-routines/service.test.ts`、联系人 completion 相关测试，GREEN 后提交。

## Task 3：设计师身份、生命周期与资源核算

**Files:** 新建 `src/main/result-designer/module.ts`、`budget.ts` 及测试；修改 `src/shared/characters.ts`、`src/main/database.ts`、`src/main/contact-agent/contracts.ts`、`src/main/agent-space/service.ts`、`src/main/agent-space/workloop-host.ts`、`src/main/agent-space/scheduler.ts`、`src/main/task-center/contact/call-budget.ts`、`src/main/agents/token-budget.ts`。

**Interfaces:**
- `RESULT_DESIGNER_CHARACTER_ID = 'result-designer'`；专属能力由宿主固定 ID/模块绑定，不能由人设修改取得。
- `ResultDesignerModule` 暴露 `tick(): Promise<void>`、`cancel(task?: ResultTaskRef): Promise<void>`、`close(): Promise<void>`；通过注入的 `RunScheduler` 执行，不自行建立并发池。
- `DesignBudgetPort.beforeRound(jobId: string, serializedInput: string): Promise<number|undefined>`、`onMetadata(jobId: string, metadata: AIResponseMetadata): void`、`afterRound(jobId: string): Promise<void>`；复用原计费服务，不另算一套每日余额。

- [ ] 写身份测试：首次创建唯一内置“界面设计师”、重启不重复、模型和用户设置不重置；普通角色同名不会获得能力；达到普通角色数量上限也不删除用户角色。
- [ ] 写调度测试：设计并发 1 且全局满额时排队；取消后真实退出前不释放名额；关闭拒绝新生产者并等待设计、预览和模型排空。
- [ ] 写预算测试：每日调用与 Token、每次任务累计额度、未知用量预留、取消前真实用量均遵守原账本；删除来源任务不抹去消耗；缺配置/额度只阻塞设计。
- [ ] 运行 `npx vitest run src/main/result-designer/module.test.ts src/main/result-designer/budget.test.ts src/shared/characters.test.ts` 确认 RED。
- [ ] 在现有运行记录中明确区分设计执行种类，作者 topic 状态不参与设计运行的推进；来源任务引用保存在设计表，不能调用作者 `finish()`。运行归属设计师，计入其已有工作设置、调用记录和全 App 用量。
- [ ] 安装/卸载与身份同步接入 AgentSpace/WorkLoopHost。默认 Native；用户明确配置的执行器保持不变，缺能力不静默切换。设计师暂停只停止自己的生产者。
- [ ] 运行上述测试及 scheduler、identity-sync、退出相关回归，GREEN 后提交。

## Task 4：生产共用的文档沙箱与真实预览

**Files:** 新建 `src/shared/result-design-document.ts`、`result-design-environment.ts`、`src/main/result-designer/preview.ts`、`preview-port.ts`、`protocol.ts` 及测试；修改 `src/main/agents/worker.ts`、`src/main/agents/index.ts`、`src/main/index.ts`。

**Interfaces:**
- `resultDesignDocument(snapshot: ResultSourceSnapshot, code: ResultDesignCode, environment: DesignEnvironment, nonce: string): string`；生产与预览使用同一生成函数。
- `DesignPreviewPort.open(input: {jobId: string; snapshot: ResultSourceSnapshot; code: ResultDesignCode; environment: DesignEnvironment}, signal: AbortSignal): Promise<PreviewSession>`。
- `PreviewSession.inspect(): Promise<PreviewObservation>`、`act(action: PreviewAction): Promise<PreviewObservation>`、`close(): Promise<void>`；action 仅当前会话的 click/scroll/key，不接收外部窗口或任意脚本。
- `PreviewObservation` 含截图宿主引用、视口/主题、受限可交互元素引用、分节覆盖和运行错误；模型不能伪造 screenshotId 或验证成功。

- [ ] 写文档测试：真实正文以安全文本投影/Markdown 渲染进入固定分节容器，不能复制模型虚构正文；主题 token 生效且不再强制抹除全部设计背景；旧 `presentation` 字段完全不参与生成。
- [ ] 写预览测试：超时/脚本错误/取消/worker 断连/应用退出清理会话；无任意 executeJavaScript、网络、宿主 IPC、父窗口与文件系统权限；请求必须匹配当前 job、nonce、worker generation。
- [ ] 运行 `npx vitest run src/shared/result-design-document.test.ts src/main/result-designer/preview-port.test.ts` 确认 RED。
- [ ] 实现主进程受控预览会话，独立非持久 session、无 Node/preload、沙箱化、禁止导航和弹窗，不抢焦点。预览每步超时 15 秒、每候选预览累计上限 120 秒；到期销毁隔离内容并确认退出，不能在共享 renderer 上直接运行生成代码。
- [ ] 预览先由宿主注入原文槽，再运行设计代码；持续检查正文投影哈希及可达性。允许目录/分页但要求明确导航映射；透明、零高、裁剪隐藏、无法展开的正文不得通过。所有内容仍可用独立可信原文入口读取。
- [ ] 在 375×700、1024×768 两个视口及亮暗主题采集真实截图、滚动尺寸、控制可达性；逐个分节检查可导航到其内容。保留图表与表格合法的局部横向滚动。
- [ ] Worker 与主进程的预览 RPC 使用独立请求关联，关闭/取消拒绝晚到回执并清理截图；生产协议只解析新设计 ID 与固定绑定，不提供旧 URL 兼容。
- [ ] 用隔离 Electron 专项验证图片输出、真实点击/滚动、故障清理和全部正文可达，再提交。

## Task 5：有视觉反馈的设计循环

**Files:** 新建 `src/main/result-designer/workflow.ts`、`tools.ts`、`model.ts` 及测试；修改 `src/main/harness/contracts.ts`、`src/main/harness/registry.ts`，按实际支持修改 `src/main/harness/dsh/background.ts` 与 DSH provider/protocol/runtime 的图片传输路径。

**Interfaces:**
- `runResultDesign(job: DesignJob, ports: DesignWorkflowPorts, signal: AbortSignal): Promise<void>`。
- `DesignWorkflowPorts` 注入 source/store/budget/preview/harness/identity/changed；代码候选最多 3 轮、整个工作上限 10 分钟，不因等待用户确认延长后台设计。
- 设计工具仅包含当前来源目录与分页正文读取、UI 环境读取、候选保存、预览观测与操作；不能调用作者任务写工具。

- [ ] 写真实本地协议模型测试：读取早期及末尾分节，提交代码，接收实际截图图片消息与诊断，再提出修正并保存；不能仅返回“已检查”就发布。
- [ ] 写失败测试：遗漏正文、截图没交给模型、拒绝图片、错误工具引用、三轮均失败、到时/预算不足、源版本已变、视觉复核响应迟到。无有效检查记录均不能发布。
- [ ] 运行 `npx vitest run src/main/result-designer/workflow.test.ts src/main/result-designer/model.test.ts` 确认 RED。
- [ ] 按现有 `AIChatMessage.imageUrl` 和 Harness 输入传递真实截图；截图必须绑定候选哈希及环境。Native 和 DSH 逐路径验证，不能只修改 `images: true`。供应商拒绝/不支持图片时明确 blocked 并保留正文，不换模型或引擎。
- [ ] 从现有模型封装抽取通用逐轮预算保护供设计使用；图片、工具、重试均进入真实用量，退出/权限取消信号传到底层。只读来源长文分页、固定版本和实际已读范围加入工作记录。
- [ ] 先对新正文尝试已有新设计的宿主兼容验证；结构不变且全部检查通过可以重绑，若内容/交互需要设计判断则进入视觉循环；不以旧视觉结论证明新内容质量。
- [ ] 发布在源、请求、权限和环境最后复核后原子切换；作者任务与正文版本保持原值。通知只报告真实设计结果并关联任务，不发送原文副本。
- [ ] 运行上述测试及 Native/DSH background、用量/取消回归，GREEN 后提交。

## Task 6：新路由与旧作者展示彻底移除

**Files:** 新建 `src/main/result-designer/index.ts`、`src/main/ipc/result-design.ts`、`src/preload/bridges/result-design.ts`；修改 `src/shared/contact-commands.ts`、`src/main/agent-space/worker-commands.ts`、`src/main/ipc/registration.ts`、`src/preload/index.ts`、`src/renderer/src/shared/types.ts`。修改作者契约/工作流/聊天路由，删除旧专用展示执行文件与相应旧协议。

**Interfaces:**
- Renderer bridge `resultDesign.get(task: ResultTaskRef, sourceId?: string): Promise<DesignView>`、`request(task: ResultTaskRef, text: string, sourceKey: string): Promise<DesignReceipt>`、`retry(requestId: string): Promise<DesignReceipt>`、`restore(designId: string): Promise<DesignView>`、`onChanged(callback): () => void`。
- 新模型工具 `request_result_design` 由宿主从真实当前任务/引用和消息来源建立身份；设计师独立来源读取与编程工具仅在设计工作中开放。它不能直接提交 ready 或替换作者正文。

- [ ] 写路由集成测试：作者聊天中的页面要求持久转交设计师；正文要求仍由作者处理；混合请求分别留痕；歧义任务不猜；重试不重复，保存失败不假报成功。
- [ ] 写退役测试：旧 presentation 队列/运行中/待确认卡失效，迟到提交拒绝；旧字段存在的正文完整可读但页面代码不执行、不返回模型、不导出；旧工具名不作为新工具别名。
- [ ] 运行 `npx vitest run src/integration/result-design-routing.test.ts src/main/result-designer/retirement.test.ts` 确认 RED。
- [ ] 删除 `presentationInstruction` 的作者注入、`revise_contact_presentation` 作者工具、`revisePresentation` 路径、revisionScope presentation 特例及作者 `finish()` 中的 presentationOnly 分支。`agent-delivery.ts`/`delivery.ts` 新读写契约不再包含 presentation。
- [ ] 删除旧 `presentation-protocol.ts` 入口、旧 HTML 导出路由和强制主题兼容逻辑。可复用的通用安全/文本函数移入新模块，禁止保留旧字段适配。
- [ ] 存储启动仅将未完成旧展示请求标为失效并取消实际执行，不将旧内容迁移成新设计；旧请求记录可以作为非可执行历史事实存在。正文/schema 读取不能因无关旧字段而丢失原稿。
- [ ] 将 IPC 参数、来源、角色身份与版本复核放在宿主，不接受 renderer 伪造设计师权限；注册/关闭遵守应用 IPC 生命周期。
- [ ] 更新旧测试为新业务断言，删除仅证明已移除能力的测试；保留正文保护、隔离、幂等和失败回归。运行聊天/任务工具相关测试，GREEN 后提交。

## Task 7：共同成果阅读区与设计修改体验

**Files:** 新建 `src/renderer/src/components/Contacts/ResultDesignView.tsx`、`ResultDesignDialog.tsx`、`ResultDesignView.css` 及测试；修改 `ContactDeliveryReader.tsx`、`ContactTopics.tsx`、`ContactPortfolio.tsx`、`ContactRevisionDialog.tsx`、`ContactPresentation.tsx`、`ContactOutputDialog.tsx`。

**Interfaces:**
- `ResultDesignView({task, sourceId, active, onCite, children})`：children 为当前固定来源的可信正文；无 ready 设计时直接显示，不空转等设计。
- `ResultDesignDialog({task, onClose, onSaved})`：单一自然语言描述、保存/取消、Esc；保存失败保留输入。

- [ ] 写组件测试：联系人任务、助手安排与成果集都使用同组件；初次读取自动登记；页面隐藏暂停查询；新版到达不替换正在阅读的版本；旧响应不能覆盖切换后的任务。
- [ ] 写引用/交互测试：正文和设计页的选文对应固定来源，无法映射时明确切回正文；渲染失败显示原文和设计错误，不把作者任务标失败；设计修改不进入作者的修订队列。
- [ ] 运行 `npx vitest run src/renderer/src/components/Contacts/ResultDesignView.test.tsx` 确认 RED。
- [ ] 接入新视图与描述弹窗，清除旧展示切换、原配色兼容按钮和作者样式修改入口；系统保留可信原文、来源和新设计历史操作。阅读偏好中的确定性间距仍即时生效，作者表达要求仍用于内容。
- [ ] 共用组件接入现有成果导航、阅读位置与来源定位；助手结果通过同一数据适配，不另写助手展示组件。后台通知沿既有未读规则，不把查看预览当已读。
- [ ] 实际检查 375/1024 宽及亮暗主题、Esc、失败输入保留、长目录和多次更新；验证没有新任务字段、彩色表单焦点或无关布局变化后提交。

## Task 8：端到端验收、完整审查与文档

**Files:** 新建 `src/main/smoke/result-designer-smoke.ts`、`src/integration/result-designer.test.ts`、`docs/result-designer-acceptance-20261106.md`；修改 `scripts/smoke-electron.js`、`src/main/index.ts`、`scripts/test-contact-model.cjs`、`docs/contact-task-spec.md`、`docs/contact-custom-deliveries.md`、`docs/current-status.md`、`docs/roadmap.md`。

- [ ] 以隔离数据库及本地模型协议夹具串联作者正式提交→持久接收→设计师→真实预览→截图进模型→修正→新设计发布→共同阅读器；核对作者正文哈希/版本/状态不变，设计消耗账本增加，重启不重复通知。
- [ ] 覆盖长小说、研究数据、多个想法、评审结论四类；逐场景保留输入、实际工具结果、截图和断言。添加助手结果跨库重放、持续更新合并和旧展示完全退役专项。
- [ ] 运行 `npm run typecheck`、`npm run check:boundaries`、`npm test -- --maxWorkers=2 --reporter=dot`、`npm run build`；保留失败诊断，定位根因，不放宽业务断言取得通过。
- [ ] 运行 `node scripts/smoke-electron.js --result-designer`、`--agents`、`--assistant-routines`、`--task-requests`，并核对完整主流程受影响部分。实际检查截图，不能仅凭生成文件存在声称视觉通过。
- [ ] 真实模型样例显式使用用户已授权连接，在隔离任务中验证看图修正；按凭据技能核查授权，不输出密钥。没有实际运行时明确登记未覆盖，不能用协议夹具替代在线视觉质量验收。
- [ ] 新能力条款写入现行 spec，旧作者展示文档明确替换；区分已实现、已验证与未覆盖项。引用真实日志和截图路径，不填写预期成功数字。
- [ ] 进行完整分支独立代码审查，覆盖删除/权限/超时/退出、快照与旧结果、运行预算、预览隔离及 UI 来源；修复重要问题并定向复验，再检查最终差异。
- [ ] 本地实现与验证完成后按用户选择集成；不自动发布安装包或启动用户真实任务。

## 自查结果与执行建议

设计稿 1–12 节均已对应任务：身份/资源 Task 3；权限与来源 Task 1/2/6；自动接收 Task 2；UI 环境/预览 Task 4；看图编程 Task 5；独立版本 Task 1；共同阅读 Task 7；旧逻辑移除 Task 6；验收与文档 Task 8。

任务依赖顺序为 1→2→3→4→5→6→7→8。Task 4 的纯文档生成和 Task 7 的组件可在接口固定后独立推进，但整条链的集成由同一执行者负责。推荐本会话连续实施、末尾独立审查，避免多人同时修改 worker 命令、正文契约与共享阅读器；使用独立 worktree 隔离当前 master。方案与工作区选择待计划交接确认。
