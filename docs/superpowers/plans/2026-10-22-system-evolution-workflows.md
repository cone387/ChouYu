# 协作与恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or the user-selected superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让反馈能追踪实际修订结果、成果变化唤醒相关任务、失败在原任务中接续，并完成整体验收。

**Architecture:** 反馈与依赖关系持久保存在原联系人任务库；完成事务关联结果与生成依赖事件；WorkLoop 在原权限、时间及预算规则下消费。界面复用现有成果/互动/任务组件。

**Tech Stack:** 现有 TypeScript/SQLite/React/WorkLoop/Harness，无新依赖。

**Spec:** [完整设计 F/G/H](../specs/2026-10-22-system-evolution-design.md)，全局约束和 Review Focus 继承[总计划](2026-10-22-system-evolution.md)。

## Global Constraints

accept 不结束任务，revise 不增加权限/预算；未保存不得显示已完成；固定版引用不跟随新版；事件不解除用户暂停或跳过固定时间；未知外部结果不自动重放。

## Review Focus

总计划第 4 项由 Task 2/3 覆盖；Task 1 覆盖重复/过期反馈与旧反馈无因果证据；Task 2 覆盖无关章节/展示更新、来源撤回及联系人删除；Task 3 覆盖恢复期间读者停留位置及在途副作用不确定性。

### Task 1: 反馈到修订结果的持久关联

**Files:** 新建 `src/shared/delivery-feedback.ts`、`src/main/agents/feedback-ledger.ts`、`feedback-ledger.test.ts`、`src/renderer/src/components/Contacts/ContactDeliveryFeedback.tsx`；修改 `agents/delivery-feedback.ts`/`.test.ts`、`task-center/commands.ts`、计划二 `contact/mutations.ts`、`completion.ts`、`src/shared/contact-commands.ts`、`ContactDeliveryReader.tsx`、`ContactTaskInteractions.tsx` 及 preload agents bridge。

**Interfaces:** `DeliveryFeedbackRecord` 包含 id、owner/topicId、requestId、baseVersion、action/reason、runId?、resultVersion?、createdAt；状态由已关联轮次读取，旧记录无关联明确标为历史未关联。`FeedbackLedger.submit(owner, input): FeedbackReceipt`、`list(owner, topicId): DeliveryFeedbackRecord[]`、`complete(runId, resultVersion): void`。input 复用原 revision/version/action/reason，增加稳定 requestId。

- [ ] 新测试断言同 requestId/同内容只入队一次、同 ID 改内容拒绝；旧 version 拒绝；修订排队/等待/失败/取消不显示新成果；真正完成事务才关联 resultVersion；完成回滚无假关联；旧反馈不推测 run。
- [ ] 先运行新测试见失败；将 feedback 记录与原修订请求/轮次创建同事务，稳定 requestId 从现有 action/工具调用身份传入；重启读取真实关联。
- [ ] 接入统一成果阅读和互动记录，显示原版→实际结果版与真实状态，打开各自固定版本；复用原反馈入口和单描述弹窗，不新增复杂任务表单。
- [ ] 运行 `npm test -- src/main/agents/delivery-feedback.test.ts src/main/agents/feedback-ledger.test.ts src/main/agents/contact-delivery-flow.test.ts`、类型检查；扩展 contact-experience smoke 验证实际反馈、失败恢复、版本打开并查看截图。
- [ ] 提交 `feat: trace delivery feedback to actual revision results`，记录 F1。

### Task 2: 持久成果依赖与唤醒

**Files:** 新建 `src/main/agents/delivery-dependencies.ts`、`delivery-dependencies.test.ts`；修改 `agents/handoffs.ts`、`contact-sources.ts`、计划二 `contact/completion.ts`、`contact/scheduling.ts`、`agent-space/workloop-host.ts`、`workloop/loop.ts`、`agents/worker.ts`。

**Interfaces:** `DeliveryDependencies.follow({ reader, topicId, sourceOwner, sourceTopicId, sectionId? })`、`published(owner, artifact): void`、`pending(reader): DependencyUpdate[]`、`acknowledge(reader, topicId, fingerprint): void`。`DependencyUpdate` 保存固定 sourceVersion 和正文 fingerprint；每个依赖只保留未处理最新相关版本，原轮次执行快照仍固定。

- [ ] 用真实 SQLite 两联系人测试：持续交接实际来源更新后唤醒；一次性交接和固定版引用不跟随；未授权看不到目录/事件；样式或无关章节变化不执行；重复事件只安排一轮；硬重启恢复待处理事件。
- [ ] 在暂停/待回复、按需模式、预算不足、工作时段之外及明确日历任务场景验证不抢跑；权限恢复后仍校验当前来源和原状态。上述测试在新实现前失败。
- [ ] 仅在已确认持续交接或允许跟随的实际读取关系中注册依赖，不能从模型文字猜测。结果保存事务写更新事件，事务外发唤醒信号；任务选择再查当前能力和时间，不能只靠消息中旧快照授权。
- [ ] 成功消费以固定正文指纹为依据；失败保留事件并遵守原退避，取消/删除清理关系。保留 15 秒补偿检查，事件合并不重复恢复已经完成的一次性任务。
- [ ] 运行依赖新测试及 `src/main/agents/handoffs.test.ts`、`handoff-review.test.ts`、`contact-sources.test.ts`、`src/main/workloop/background-selection.test.ts`、`src/main/agent-space`；构建后双联系人 smoke 验证真实 worker 交付→评审。
- [ ] 提交 `feat: wake dependent work from durable delivery updates`，记录 G1。

### Task 3: 同任务恢复信息与实际接续

**Files:** 新建 `src/shared/task-recovery.ts`、`task-recovery.test.ts`、`src/main/agents/recovery-flow.test.ts`；修改 `shared/task-state.ts`、`contact-failure.ts`、`contact-interactions.ts`、计划二 `contact/scheduling.ts`/`mutations.ts`、`agents/task-failures.ts`、`agent-space/workloop-host.ts`、`ContactTaskRunButton.tsx`、`ContactTaskOverview.tsx`、`ChatPanel/ContactInteractionCard.tsx`。

**Interfaces:** `TaskRecoveryInfo` 为原因、可继续条件、retryAt?、来源 revision/runId、允许操作和未知外部结果标记的投影；`taskRecovery(input): TaskRecoveryInfo | undefined` 只读原状态。执行沿用原 `continueTopic`/回答/重试命令，通过当前版本与稳定请求 ID 校验，不另建任务。

- [ ] 测试四类恢复：网络暂时失败→有界重试；权限关闭→恢复后复核；预算等待→恢复后继续原任务；worker/应用重启→原检查点接续。都断言任务 ID/反馈来源保留、交付不重复、用户暂停不解除。
- [ ] 额外断言外部操作超时结果未知时只提示核对不自动重放；显式重复重试只入队一次；取消未退出不能释放名额开始替代轮次。
- [ ] 先运行新测试失败，然后把现有分散错误说明收敛到共同投影并接入现有任务按钮/卡片。保留原域状态转换，不用通用枚举覆盖所有执行状态。
- [ ] 类型检查及相关单测后，扩展 `src/main/smoke/agents-smoke.ts`/contact-experience：当前阅读不被恢复切走，原任务继续、正文来源准确。
- [ ] 提交 `feat: reconnect task recovery with preserved provenance`，记录 G2。

### Task 4: 文档、图册、全量回归与审查

**Files:** 更新 `docs/contact-task-spec.md`、`contact-agents-architecture.md`、`storage-recovery.md`、`current-status.md`、`roadmap.md`、`system-evolution-acceptance-20261022.md`；更新 `docs/architecture-atlas/build_atlas.py`、`source_snapshot.py`、相关图页、manifest 与 README 的实际入口。

- [ ] 逐项查设计 A1–H1 和各子计划勾选项，检查真实调用链、测试断言与迁移结果；缺一项继续实现，不将目录或测试文件存在视为完成。
- [ ] 运行总计划完整命令和必要 Electron 专项，核对退出码与真实截图。保留初次失败及诊断，修复引入的回归；DSH 间歇失败若重现须调查，不能用单独复测声称全量通过。
- [ ] 使用 diagram-design 技能维护图册时先读其规范；以实际源码关系更新图页，运行现有 `verify_atlas.py`，核对生成物和入口。文档明确源码、验证、发布各自状态，不声称已发布安装包。
- [ ] 按 requesting-code-review 技能进行独立整分支审查，修复 Important/Critical 发现并验证；审查不能只读计划或通过数。
- [ ] 提交最终文档与验收记录，确认 `git diff --check` 与工作区状态，给出分支和验证证据；仅全部完成后更新目标完成状态。
