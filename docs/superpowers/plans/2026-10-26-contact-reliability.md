# 联系人可靠性优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在保留共享worker的前提下交付已确认的六项可靠性与持续运行优化。

**Architecture:** 主进程管理宿主状态和恢复授权，worker保持原任务/成果事务与图检查点。数据通过类型化IPC与共同UI呈现；新增调度终点不改写目标完成语义。

**Tech Stack:** Electron、TypeScript、React、better-sqlite3、LangGraph、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-26-contact-reliability-design.md`

## Global Constraints

- 共享worker、默认8全局名额、同任务串行和取消等待真实退出不变。
- 单描述弹窗、共同任务UI、独立身份、固定成果正文、未读闪烁保持。
- 联系人备份每5分钟合并、3个有效组、安全边界等待最多30秒；不以杀进程取得快照。
- 恢复不重放未知副作用、不复活撤回资料、不把未知消耗记零。
- 截止后不发起新模型/工具步骤；成功期次区分产出和送达。
- 所有新行为先失败回归再实现，保存/权限/版本错误必须真实暴露。
- 使用隔离数据进行模型与Electron验收；不重新引入24小时门槛。

## Review Focus

1. 旧进程退出/迟到RPC不能回退新代际状态（Task 1）。
2. 快照中的在途工具、后来撤回资料、缺失消费不能通过新任务绕过恢复保护（Task 4）。
3. 保存失败时缓存逐出/分页不得丢唯一内存修改（Task 7）。
4. 第N期已保存未送达、到期期间返回结果不能多开一期或假报完成（Task 9）。
5. 用户只改名称、日历或额度不得移动既有限期/重置累计（Task 9）。

## 文件职责与执行顺序

按下列独立可验证任务实施。1–4负责宿主/备份/恢复，5–7负责身份/会话/备份成本，8–10负责助手状态/终点/模型回归，11收拢架构与最终证据。每任务的接口由消费者测试核对，保留兼容出口；实现中必要调整记录到本计划ledger，不重复请求已授权工作。

### Task 1: 宿主状态与有界诊断

**Files:** Create `src/shared/contact-runtime.ts`, `src/main/agent-space/runtime-status.ts`, `src/main/agent-space/runtime-status.test.ts`, `src/renderer/src/components/Contacts/ContactRuntimeStatus.tsx`; modify `src/main/agents/index.ts`, `src/main/agent-space/worker-rpc.ts`, `src/main/agent-space/workloop-host.ts`, `src/shared/agents.ts`, `src/shared/contact-commands.ts`, `src/preload/bridges/agents.ts`, `src/renderer/src/components/Contacts/ContactAgentPanel.tsx`.

**Interfaces:** `ContactRuntimeSnapshot` carries phase/generation/revision/timestamps/optional observed metrics; `ContactRuntimeState.start(): number`, `update(generation, patch): void`, `read(): ContactRuntimeSnapshot`; public `runtimeStatus(): Promise<ContactRuntimeSnapshot>`, `retryRuntime(): Promise<ContactRuntimeSnapshot>`, `onRuntimeChanged(callback): () => void` are main-process-only API excluded from worker command map.

- [x] Write runtime-status tests for old generation rejection, no stale live metrics after exit, recent sync/failure preservation and structured diagnostic redaction.
- [x] Run `npm test -- src/main/agent-space/runtime-status.test.ts`; expect missing behavior failure.
- [x] Implement state/metrics and wire actual init/exit/sync/delivery/close paths; add UI read/retry with visibility and stale-response guards. Keep existing RPC timeouts.
- [x] Run targeted agent-space/preload tests and Node/Web typecheck; expect pass. Verify cold unavailable UI can show status without waiting for worker.
- [x] Commit `feat: expose truthful contact worker health` and ledger evidence.

### Task 2: 成组快照发布与保留

**Files:** Create `src/main/storage/contact-backups.ts`, `src/main/storage/contact-backups.test.ts`, `src/shared/contact-backups.ts`; modify `src/main/agent-space/workloop-host.ts`, `src/main/workloop/workflow.ts`.

**Interfaces:** `ContactBackupManifest` records id/createdAt/schema/hash/files; `ContactBackups.create(): Promise<ContactBackupManifest>`, `list(): ContactBackupManifest[]`; snapshots use paired task/checkpoint handles and an exclusive safe-boundary callback, return status to Task1.

- [x] Write real SQLite tests for committed WAL pages, partial publication, corrupt/hash mismatch, retained previous valid group and bounded rotation.
- [x] Run `npm test -- src/main/storage/contact-backups.test.ts`; expect missing paired snapshot support.
- [x] Implement staging, validation, hashes, complete-manifest publication and three-group retention with scoped paths; failures never overwrite sources.
- [x] Run tests; expect all passing and source databases still writable after injected failures.
- [x] Commit `feat: publish verified contact backup groups`.

### Task 3: 全写入边界与自动备份生命周期

**Files:** Create `src/main/agent-space/storage-barrier.ts`, `storage-barrier.test.ts`; modify `workloop-host.ts`, `worker-commands.ts`, `src/main/workloop/loop.ts`, `workflow.ts`, checkpoint adapter, and cleanup entrypoints.

**Interfaces:** `ContactStorageBarrier.operation<T>(fn:()=>Promise<T>):Promise<T>` and `snapshot<T>(fn:()=>Promise<T>,timeoutMs=30000):Promise<T>` coordinate graph-step/checkpoint safe boundaries and synchronous mutation admission; timer tracks dirty generation and reports status.

- [x] Write tests holding model/tool/checkpoint boundaries during requested backup, delayed return preservation, command write blocking and 30000ms timeout release without cancellation.
- [x] Run barrier/host tests; expect missing coordination failures.
- [x] Integrate every writer, first backup, 300000ms dirty coalescing and final stopped-writer backup. Avoid readonly queries mutating outside barrier.
- [x] Run host/runtime/cleanup/storage tests; expect correct paired state and no duplicate model/tool execution.
- [x] Commit `feat: coordinate live contact snapshots at durable boundaries`.

### Task 4: 恢复组与核对保护

**Files:** Create `src/main/storage/contact-restore.ts`, `contact-restore.test.ts`, `src/main/agent-space/recovery-guard.ts`, `recovery-guard.test.ts`, `src/shared/contact-recovery.ts`; modify main runtime endpoints, identity contract, worker command/context/scheduling/notice gates, original failure/action card adapters.

**Interfaces:** application-state-backed `ContactRecoveryGuard` records group/owner/scope/review/allowance with stable request IDs; `restoreContactGroup(groupId)` runs only after explicit user action and closed handles; runtime API provides candidates and protection, typed review/allowance submission.

- [x] Write real filesystem tests for staged restore interruption at each replace, mixed-group rejection, permission/newer-schema errors not triggering restore.
- [x] Write guard tests for new-task bypass, recalled memory/shared delivery, replayed checkpoint/outbox, unknown daily/cumulative spend, repeated allowance and already-deleted contact.
- [x] Run restore/guard tests; expect current absent protection failures.
- [x] Implement durable restore journal/original preservation and application-backed scope protection. Resume only new attempts from reviewed outcomes; unknown writes remain blocked; extra budgets are explicit additional authorization.
- [x] Test read-only recovered history, confirmation failure retention, no cached model-context leak and protection across worker/application restart; expect pass.
- [x] Commit `feat: protect restored contact work and unknown usage`.

### Task 5: 身份增量同步

**Files:** Create `src/main/agent-space/identity-sync.ts`, `identity-sync.test.ts`; modify `src/main/agents/index.ts`, `src/main/database.ts`, `src/main/skills/index.ts`, `src/main/contact-agent/contracts.ts` as needed.

**Interfaces:** `ContactIdentitySync` caches by per-owner revision, confirms only sent revision, resets acknowledgements on generation; source read produces original `ContactIdentity`; config/session/skill changes invalidate affected owners.

- [x] Test unchanged sync no message scan, failed sync remains dirty, concurrent change not acknowledged, default config affects followers, deleted owner/module state and permission withdrawal.
- [x] Run identity tests RED, implement identity source/change notifications and bounded periodic compensation, then run identity/agent-space/chat context tests GREEN.
- [x] Record 1/8/24 owner baseline and changed/unchanged transmitted bytes and reads.
- [x] Commit `perf: synchronize changed contact identities only`.

### Task 6: 异步应用库备份

**Files:** Modify `src/main/storage/conversation-recovery.ts`, `application-database.ts`, `src/main/database.ts`, shutdown consumers in `src/main/application/`; tests in `application-database.test.ts`, storage/quit tests.

**Interfaces:** `ApplicationDatabase.backup(): Promise<void>`, `backupDatabase(): Promise<void>`, asynchronous close/wait boundary; dirty generation captured before snapshot, never clear later changes.

- [x] Test live write during backup, failed publication retains prior backup, close waits, second dirty generation remains pending, event loop gets turns.
- [x] Run RED; implement driver async paged backup, validation/publish and lifecycle waiting; run storage/quit/application tests GREEN.
- [x] Measure consistent baseline against synchronous backup on same fixture.
- [x] Commit `perf: back up application storage without full synchronous snapshots`.

### Task 7: 会话按需加载与搜索

**Files:** Modify `src/main/storage/conversations.ts`, `legacy-migration.ts`, `application-database.ts`, `src/main/database.ts`, `src/main/ipc/sessions.ts`, preload session bridge and shared conversations; create query/cache tests; adjust chat workspace/history consumers only where paging requires.

**Interfaces:** repository metadata list, bounded `readMessages(id,before?,limit)` with stable cursor; bounded cache protects dirty sessions. Database searches preserve `findTextMatch` Unicode/substring semantics and original ordering.

- [x] Test startup avoids full message read, stable pagination under append/edit, delete/read/edit-replay, attachments and delivery receipts, failed-save eviction safety, Unicode and cross-fragment substring parity.
- [x] Run RED; migrate indexed search data transactionally/version guard, implement metadata loading/lazy hydration/cache and adapt consumers without changing recent model context.
- [x] Run database/storage/session/search/chat tests GREEN; compare short/long history memory and query measurements.
- [x] Commit `perf: load and search conversation history on demand`.

### Task 8: 助手实际运行状态

**Files:** Modify `src/main/assistant-routines/service.ts`, `companion.ts`, `index.ts`, assistant-domain/shared/bridge; `useAssistantTasks.ts`, `contactTaskPresentation.ts`, shared toolbar adapters; tests beside these modules.

**Interfaces:** read-only execution snapshot keyed by routine/duty with real execution ID/phase/start time, event invalidation; adapt to same task presentation, not WorkLoop.

- [x] Test state during generate/deliver/failure/cancel, restart interrupted history, unrelated routine isolation and read failure clears spinner.
- [x] Run RED; implement truthful snapshots and common UI projection with capabilities; run assistant/UI tests GREEN.
- [x] Commit `feat: surface assistant task execution through shared task UI`.

### Task 9: 期限与成功次数

**Files:** Create `src/shared/task-ending.ts`, `task-ending.test.ts`; modify gateway/calendar/assistant service/task-store scheduling/completion/model/tool entrypoints, command contracts, topic state/projection and UI; add integration tests in `src/main/agents/task-ending.test.ts` and assistant service tests.

**Interfaces:** persisted `TaskEnding` with exclusive deadline/source/timezone/acceptedAt and optional count mode `produced|delivered`, target/cumulative/occurrence receipt; `endingState(now,ending)` pure projection; programmatic before-request guard independent of model completion judgment.

- [x] RED tests: explicit deadline relative anchor, date-only/local midnight, ongoing24h not finite, expired pause/restart, late safe result no new correction calls, count idempotence, Nth saved-but-unsent blocks next period, editing preserves total/anchor, old unknown count requires clarification.
- [x] Implement typed validators/parser output and same-domain transaction for targets/periods; extend assistant transaction port and delivered receipt reconciliation. Retain original goals, paused state and completion review.
- [x] Run deadline/calendar/gateway/assistant/workflow/completion tests GREEN; verify tool/model guards native and DSH.
- [x] Commit `feat: enforce explicit task deadlines and successful occurrence limits`.

### Task 10: 模型矩阵与故障注入验收

**Files:** Modify `scripts/test-contact-model.cjs`, `src/main/smoke/contact-live-smoke.ts`, relevant model acceptance tests; add report contract tests and contact reliability smoke.

**Interfaces:** per-engine report includes source commit/model/scenario/first-pass/corrected/failure/calls/tokens/elapsed/redacted category; no credentials or user source text.

- [x] Test report unknown usage and engine identity, safe evidence output, end-to-end persistence assertions and bounded scenario attempts.
- [x] Implement shared native/DSH scenario coverage from design, run protocol matrix and actual Electron fault/recovery flows; run configured provider bounded samples if available, report unavailable explicitly.
- [x] Commit `test: cover contact recovery and semantic behavior across engines`.

### Task 11: 职责整理、文档与最终验证

**Files:** `src/main/agents/index.ts` composition extraction, `src/main/workloop/workflow.ts` step modules as required by changed features; `scripts/check-module-boundaries.cjs` and tests; contact spec/architecture/storage docs, acceptance log and architecture atlas.

- [x] Add boundary violation tests for contact-agent/workloop/messaging/storage and concrete runner imports; run RED then enforce permitted ports and run GREEN.
- [x] Preserve graph node/checkpoint names; run old-checkpoint recovery and default concurrency regression after extraction.
- [x] Update current architecture and evidence; remove already-done dependency wake/body dedup from future backlog. Report real measurements and unresolved Windows cause.
- [x] Run full npm test, typecheck, check:boundaries, build; affected full Electron and 375/1024 dark/light/Esc flows, native/DSH, archive evidence.
- [x] Fresh whole-branch review against approved spec; fix important findings with RED→GREEN; commit verified work. No merge/push/publish unless separately authorized.

## Self-review and execution record

All design sections map to Tasks1–11; dependencies 1→2/3/4, 4→5/7/9, 5→7, 6→7, 8→9, 9→10, all→11. Existing user authorization covers implementation; use native inline execution in the managed worktree, no second plan-approval pause. Ledger records concrete interface changes and completion evidence. First baseline and exact commands go under `artifacts/contact-reliability/`.
