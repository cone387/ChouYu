# 联系人正文引用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将精确引文带入聊天和修订，保留来源版本及返回阅读位置。
**Architecture:** 复用 B 的正式成果定位，结构化引用独立于聊天正文保存；修订沿用原任务。
**Tech Stack:** Electron 44、React 18、TypeScript 5.6、SQLite/better-sqlite3、现有 LangGraph、Vitest 5。
**Spec:** [完整设计](../specs/2026-10-12-contact-experience-design.md)；[唯一产品规范](../../contact-task-spec.md)。
**Global Constraints:** 完整继承[总计划](2026-10-12-contact-experience.md)的约束、接口和公共交付步骤。
**Review Focus:** 每项任务列出的失败场景属于必验项；总计划列出跨模块五项重点及归属。

## Task C1：校验与持久引用

**Files:** 新增 `src/main/agents/citations.ts`、`citations.test.ts`、`src/shared/contact-citations.ts`；修改 `src/main/database.ts`、`database.test.ts`、`src/renderer/src/shared/types.ts`、`src/main/ipc.ts`。
**Interfaces:** `validateCitation(owner: string, input: ContentCitation, portfolio: AgentPortfolio): ContentCitation`；`citationContext(owner: string, refs: ContentCitation[], portfolio: AgentPortfolio): string`；消息新增 `contactCitations?: ContentCitation[]`，每条消息最多 4 条，每条 quote 最多 2000 字。消费 B1 的 `deliveryText(body: string): string`，不另写文本投影；TextAnchor 偏移按 JS UTF-16。
- [ ] 单测用真实版本：篡改 quote/hash、另一联系人、重复段落错误 offset、负偏移/越界、source 已删均拒绝；同文重复的精确区间仍有效；旧消息无字段可加载，保存/备份恢复不丢 ref。断言 `expect(restored.contactCitations[0].ref.version).toBe(1)`，即使已有 v2。
- [ ] 跑 `npx vitest run src/main/agents/citations.test.ts src/main/database.test.ts` 确认红。
- [ ] 主进程核对会话 owner，正式引用由数据库 resolve；持久层校验长度/枚举，提供版本来源可用/已移除状态；发送时引用转换为数据上下文，内部 ID 不拼进用户消息文本。
- [ ] 跑专项/类型检查并提交 `feat(contacts): persist validated delivery citations`。

## Task C2：选择讨论与原版本修订

**Files:** 修改 B 的阅读器、`agentDiscussion.ts`、`src/renderer/src/components/ChatPanel/{ChatPanel,InputArea,MessageArea}.tsx`、`src/main/agents/{service,tools,chat-changes}.ts`；新增 `ContactRevisionDialog.tsx`、`src/main/smoke/contact-citation-smoke.ts`、`src/main/agents/citation-revision.test.ts`。
**Interfaces:** `reviseCitation(owner: string, topicRevision: number, citation: ContentCitation, feedback: string): Promise<AgentOverview>`，意见上限沿用 2000 字；AgentDiscussion 扩展可选 citation，不影响原工作记录讨论。UI 通过 B 的 delivery 导航返回精确位置。
- [ ] 写集成测试：讨论不增加 runs；修订把引文/原版本/「保留本段」写入实际运行输入；v1 引文在 v2 后提交失败且不改任务；只改样式保持正文哈希；模型迟到回复不能越过取消。运行专项确认红。
- [ ] 实现文本选择工具和键盘入口、可移除引用草稿、气泡原文链接；取消不发消息。改写模态单意见输入和只读引用；明确过期版本、打开差异、重新基于新版提交；不自动替用户确认新版。
- [ ] 修订服务在创建轮次和提交成果前校验原版本/任务 revision，复用预算/并发/权限。记录反馈和引用，更新后回执可以打开本轮保存版本及修改前后。
- [ ] Electron 验证选择/取消/发送/重启引用/过期草稿保留/返回原位置；运行 `npx vitest run src/main/agents/citation-revision.test.ts src/main/agents/chat-changes.test.ts`、类型检查，通过后提交 `feat(contacts): discuss and revise cited passages`。
