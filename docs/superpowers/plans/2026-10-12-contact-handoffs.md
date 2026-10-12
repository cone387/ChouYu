# 联系人版本协作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 把明确成果交给另一联系人评审，并将用户认可的意见交回原作者。
**Architecture:** 在原任务创建/调度上加入幂等交接记录，共用 ContactSources 读取权限；源任务保持独立。
**Tech Stack:** Electron 44、React 18、TypeScript 5.6、SQLite/better-sqlite3、现有 LangGraph、Vitest 5。
**Spec:** [完整设计](../specs/2026-10-12-contact-experience-design.md)；[唯一产品规范](../../contact-task-spec.md)。
**Global Constraints:** 完整继承[总计划](2026-10-12-contact-experience.md)的约束、接口和公共交付步骤。
**Review Focus:** 每项任务列出的失败场景属于必验项；总计划列出跨模块五项重点及归属。

## Task F1：幂等交接和实际接收任务

**Files:** 新增 `src/shared/contact-handoffs.ts`、`src/main/agents/handoffs.ts`、`handoffs.test.ts`；修改 `agents/{service,topics,contact-sources}.ts`、`src/main/assistant-routines/gateway.ts`、API 接入。
**Interfaces:** HandoffRequest={requestId:string;source:DeliveryRef;recipientId:string;description:string}；Handoff={id:string;source:DeliveryRef;recipientId:string;topicId:string;description:string;createdAt:number}；`prepareHandoff(owner,request):Promise<HandoffPreparation>`（包含解析后的既有任务需求或必要补问）；`commitHandoff(owner,preparation):Handoff`；`handoffs(owner,topicId?):Handoff[]`。prepare 不写任务，commit 在一次事务中创建接收任务与交接记录；幂等键按发起者/requestId，重复但 payload 不同拒绝。
- [x] 真实 service 测试：重复提交只建一个任务，接收/共享权限缺失都失败；版本/作者不匹配拒绝；prepare 期间撤权拒绝 commit；事务注入失败无半条任务；重启相同 requestId 返回原任务；源任务状态/预算不变。运行 handoffs.test.ts 确认红。
- [x] 用原自然语言解析建立接收任务，来源作为只读证据约束持久保存，不将手工拼接标题当模型理解；缺信息补问共用原任务描述表单及草稿。
- [x] 当前版本可发起一次性交接；只有明确持续要求才设持续评审。权限检查复用 ContactSources.allowed，用户界面发起不暗开分享或读取。
- [x] 新 API 接入和跨联系人/过期/重启测试通过后提交 `feat(contacts): persist versioned review handoffs`。

## Task F2：评审链路和意见交回

**Files:** 新增 `ContactHandoffDialog.tsx`、`ContactHandoffs.tsx`、`src/main/smoke/contact-handoff-smoke.ts`、`src/main/agents/handoff-review.test.ts`；修改阅读器、`ContactTaskDialog.tsx`、`agents/{runtime,contact-sources,service}.ts`、`assistant-routines/companion.ts`、C 的引用/修订入口。
**Interfaces:** `handoffState(owner,id):{handoff:Handoff;status:string;reviewedVersion?:number;latestVersion:number}` 使用原任务投影；`returnReview(owner,request:{handoffId:string;review:ContentCitation;source:ContentCitation;feedback:string;topicRevision:number}):Promise<AgentOverview>` 复用 C 的 reviseCitation，另保存评审来源，不直接改写正文。
- [ ] 测试一份 v1 评审保留源版本，作者 v2 后显示未评审；持续模式只处理有变化哈希，样式变化不重评；普通交接不自动追新版；同文重复不重发；暂停/删除/撤权不复活；过期意见交回拒绝且草稿保留。运行 handoff-review.test.ts 确认红。
- [ ] UI 接收者选择与任务描述弹窗共享输入组件，来源只读，缺权限跳原工作设置后可回草稿。协作记录可打开原文/评审任务，状态只读实际执行数据。
- [ ] 持续评审沿原资料等待唤醒/预算/并发机制运行，记录实际处理 ref/hash；接收结果正文准确引用被评审原文。用户单次选意见交回作者，版本检查后创建原任务修订；ChouYu 只读引用阻塞，不批准意见。
- [ ] Electron 两联系人全流程、重启/权限撤回/新版冲突场景通过，专项/类型检查通过后提交 `feat(contacts): connect review results to author revisions`。
