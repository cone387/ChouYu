# 存储与迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or the user-selected superpowers:subagent-driven-development. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 使单条消息保存不再重写所有历史，并消除成果各版本中重复正文的增长。

**Architecture:** 使用现有 SQLite 依赖，独立会话/元数据仓储共享应用存储事务；旧 JSON 一次迁移并保留备份和旧版阻写标记。成果库内部保存不可变正文块，对外保留原版本模型。

**Tech Stack:** better-sqlite3、现有附件存储、Electron safeStorage、Node、Vitest，无新依赖。

**Spec:** [完整设计 E](../specs/2026-10-22-system-evolution-design.md)，全局约束和 Review Focus 继承[总计划](2026-10-22-system-evolution.md)。

## Global Constraints

不得双写两份实时聊天事实，不删除旧库来通过测试，不丢正文/已读/回执/密钥保护，不增加用户操作负担。JSON v4 及更早的合法数据仍可迁移；新格式拒绝旧应用覆写。

## Review Focus

总计划第 1/3/5 项分别由 Task 2/3 覆盖。额外验证磁盘满、权限失败、部分初始化句柄泄漏、坏备份与较新格式、跨联系人引用和附件缺失。

### Task 1: 可复现完整产品保存基准

**Files:** 新建 `scripts/benchmark-system-storage.cjs`、`src/main/smoke/storage-scale-smoke.ts`；修改 `scripts/smoke-electron.js`、`src/main/index.ts` 以接入仅显式测试运行的 `--storage-scale`；修改 `docs/system-evolution-acceptance-20261022.md`。

**Interfaces:** 报告 JSON 包含 baseline commit、平台/Node、数据集大小、操作、样本耗时、事件循环延迟、文件字节、验证计数和错误。只接收脚本创建的隔离数据目录；基准不能接受或推断用户实际 userData。

- [x] 构造 1,000/10,000/50,000 消息夹具（正文、来源、已读、附件引用、回执均有样例），测实际 database 保存/启动读取/搜索与单条变更；以真实 Electron 路径测主进程延迟，输出合法报告后才退出 0。
- [x] 成果夹具为 10/100/300 个逐章增长版本，每章 2,000 字符，满足当前百万字符/300 节容量；核对固定版正文与导出，并记录存储量。
- [x] 运行 `npm run build` 后 `node scripts/benchmark-system-storage.cjs`，冻结旧实现结果到 `artifacts/system-evolution/storage-before.json`，明确与已有纯文件预检不同。
- [x] 提交 `test: add isolated application storage scale benchmarks`。基准不作为 UI 质量或全天性能证明。

### Task 2: 增量聊天仓储及安全迁移

**Files:** 新建 `src/shared/conversations.ts`（迁出 Message/ChatSession 等纯类型）、`src/main/storage/application-database.ts`、`conversations.ts`、`application-metadata.ts`、`legacy-migration.ts`、`conversation-recovery.ts` 及各 `.test.ts`；修改 `src/main/database.ts`/`.test.ts`、`store-file.ts`、`src/main/index.ts`、`src/main/messaging/index.ts` 与 storage smoke。

**Interfaces:** `ConversationRepository` 提供 `readSession(id)`、`listSessions()`、`saveSession(session)`、`deleteSession(id)`、`appendDelivered(input)`、`markRead(id, messageId?)`，沿用现有模型及失败语义；实现仅写变化消息和必要会话元数据。`ApplicationMetadataRepository` 拥有 config/characters/state；两者共享同一应用 SQLite 连接，用于角色删除与回执原子提交。`openApplicationDatabase(directory)` 返回两个 repository、`transaction(fn)`、`flush()`、`close()`；`migrateLegacyStore(directory)` 为幂等迁移入口。

- [x] 添加真实库失败测试：插入部分消息抛错、完成库事务后旧 JSON 阻写标记写入失败、目标库损坏/原文件不可读/较新格式均不能产生半成品权威；重新启动恢复，逐 ID/正文/顺序/引用/已读/回执等价。
- [x] 测试内存待保存消息及 receipt 在写入失败后可重试一次，落盘前不给交付成功；测试仅改消息或配置时无关消息行不执行 UPDATE（使用真实 SQL 观测或触发器计数）。先运行新测试见失败。
- [x] 建立 `sessions`、`messages`、`metadata/state`、`delivery_receipts` 和迁移元数据表；正文与回执同一事务。元数据独立仓储不重新序列化会话；配置凭据保持 safeStorage 加密，附件仍由 AttachmentStore 存储。
- [x] 迁移时先保留已验证的旧快照，再事务写入并校验内容及来源摘要，持久保存迁移身份；提交成功后将旧入口置为 v5 SQLite 指向标记，使旧 v4 代码拒绝写入。启动优先识别有效目标和迁移身份，不重复导入；标记失败须在放行产品写入前重试处理，旧文件保留恢复用途。
- [x] 将现有 database API 接入仓储，显式跟踪脏会话/消息及待保存元数据，保留全局保存失败提示/手动重试/退出拦截。关闭时 flush 后释放 SQLite 句柄；初始化失败逐项释放。
- [x] 使用 SQLite 一致性快照 API 维护可验证备份，避免直接复制未 checkpoint 的主库；备份失败保留旧备份并记录，不通过每条消息全量同步备份抵消增量收益。坏库恢复遵守隔离原件、拒绝较新格式和保留用户选择的既有原则。断言恢复后最近已承诺持久的数据边界，不能把未知结果报成功。
- [x] 运行 `npm test -- src/main/storage src/main/database.test.ts src/main/messaging`、`npm run typecheck`、构建后完整 storage/chat/提醒相关 smoke；附件恢复与缺失场景复用 `database.test.ts` 现有测试。更新原文件写入故障测试为对应存储故障注入，保留原断言目的。
- [x] 重跑存储基准，证明编辑未变化历史不增加写入行数，报告完整链路耗时和仍存在的启动/检索成本。查看保存失败 UI、重启恢复及旧数据来源定位。
- [x] 提交 `feat: persist conversations incrementally with recoverable legacy migration`，记录 E1。

### Task 3: 不可变成果正文块

**Files:** 新建 `src/main/agents/delivery-blocks.ts`、`delivery-blocks.test.ts`、`delivery-migration.test.ts`；修改 `agents/delivery.ts`、`portfolio.ts`、计划二 `task-center/contact/completion.ts`/任务删除、`agents/delivery.test.ts` 和 benchmark 场景。

**Interfaces:** `DeliveryBlockStore.write(artifact: AgentDelivery): StoredDeliveryManifest`、`read(manifest): AgentDelivery`、`collectUnreferenced(): void`。manifest 含版本原元数据以及每章 bodyHash、title、runId、sources；bodyHash 为 UTF-8 正文 SHA-256，读时验证。权限始终由 owner/topic/version 外层校验，不暴露按 hash 任意读取的 IPC。

- [ ] 固定旧快照测试：300 版重建与旧 `AgentDelivery` 深度相等，Markdown/HTML 导出逐字一致；缺块/错误 hash 明确失败；删除一任务不删除其他版本仍引用块；只有样式更新时正文块数不增加。
- [ ] 先运行新测试失败；在原 agents.db 创建正文块及版本引用表，迁移旧 `delivery_versions.value` 为格式标记+清单，在同一事务中核对重建后替换，不创建第二事实库。
- [ ] `AgentDeliveries.get/commit/context/inspect/summary` 继续返回相同外部结构；结果提交外层事务仍包住正文块、版本、进度和通知。删除通过引用检查收集孤立块，事务失败完整回滚。
- [ ] 运行 `npm test -- src/main/agents/delivery src/main/agents/portfolio src/main/agents/citations src/main/agents/handoffs src/main/task-center/contact/completion.test.ts`；构建后 `--agents`、`--presentation` 验证阅读、固定版本与导出。
- [ ] 重跑 10/100/300 版基准，报告唯一正文块字节和清单开销，证明正文量按唯一内容增长；不得只报告库文件大小而忽略正文重复。
- [ ] 提交 `feat: deduplicate immutable delivery bodies across versions`，记录 E2。
