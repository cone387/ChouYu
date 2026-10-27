# Architecture hardening implementation plan

> **For agentic workers:** Use systematic-debugging and test-driven-development for each independent repair, then verification-before-completion and a fresh whole-change review.

**Goal:** Repair the five architecture issues confirmed in the 2026-10-27 audit before adding continuous exploration.

**Architecture:** Retain the modular monolith, shared WorkLoop host, task domains and Harness contracts. Add bounded cancellation and runtime ownership, drain all application producers before storage close, separate consumption from deletable history, and write delivered messages incrementally.

**Tech Stack:** Electron, TypeScript, SQLite, Vitest, existing DSH runtime.

**Spec:** `docs/contact-task-spec.md`; user approved fixing all five audit findings in this conversation.

## Global constraints

- Preserve shared task UI, single-description forms, actual saved deliveries, unread flashing, permissions and budgets.
- Do not time out human confirmation or release execution capacity while real work remains active.
- No user data, real model calls, new dependencies, release or push needed for repair validation.
- Work on `fix/architecture-hardening` in the clean current workspace; no worktree relocation needed. User requested execution, so proceed without another plan approval.

## Review focus

- A live DSH connection whose run and cancel do not finish must not strand shutdown or capacity.
- Shared runtime cleanup must not silently replay operations or misreport peer tasks as successful.
- Shutdown during pending inspection, generation, reminders or database backup must not permit late delivery.
- Deleting task history must retain daily model/search consumption, including after reopening old databases.
- Incremental append and read updates must preserve receipts, projections, protected deliveries, cache coherence and write-failure recovery.

## Tasks

### 1. DSH cancellation and runtime lifetime

Files: `src/main/harness/dsh/runtime.ts`, `background.ts`, their tests, runtime option contracts if necessary.

- [x] Add failing tests for stuck run/cancel and concurrent peer cancellation.
- [x] Bound cancellation cleanup, invalidate an unhealthy runtime and await actual cleanup; allow subsequent acquisition to recover.
- [x] Add failing tests for configuration churn, active leases and idle recovery.
- [x] Bound cached runtime groups and reclaim idle groups without closing leased runtimes.
- [x] Run DSH runtime/background/protocol regression tests.

### 2. Application shutdown barrier

Files: `src/main/assistant-routines/{companion,service,index}.ts`, `src/main/tasks/index.ts`, `src/main/index.ts`, focused lifecycle tests.

- [x] Reproduce shutdown during deferred companion inspection/summary and routine generation.
- [x] Expose idempotent close/drain, reject new work, abort and await in-flight operations, suppress late writes/delivery.
- [x] Stop reminder scheduling before final flush while retaining task services until active tools drain.
- [x] Verify shutdown ordering and retryable final-save recovery.

### 3. Independent daily consumption ledger

Files: `src/main/task-center/contact-store.ts`, `contact/call-budget.ts`, related migration/deletion tests.

- [x] Reproduce model/search count rollback after task deletion and reopening.
- [x] Preserve daily consumption independently of deleted run history with transactional migration.
- [x] Verify limits, metadata, ownership, recovery and restart behavior.

### 4. Incremental conversation delivery

Files: `src/main/storage/conversations.ts`, `conversation-cache.ts`, `src/main/database.ts`, storage/messaging tests.

- [x] Reproduce full-history message writes on one append/read update using real repository behavior.
- [x] Implement atomic single-message append + receipt/projection update and independent read watermark persistence; integrate production delivery paths.
- [x] Keep ordinary edit/replacement semantics, dirty state recovery, attachment handling and immutable delivered content.
- [x] Verify duplicate/restart/failure/clear/history cases and bounded writes at 1k/10k messages.

### 5. Integration and documentation

- [x] Run full tests, typecheck, module boundaries, production build and relevant isolated Electron smoke.
- [x] Fresh independent review; fix material findings and rerun affected checks.
- [x] Update current spec gaps, architecture notes and a dated acceptance record with exact evidence and limits.

## Execution ledger

- Baseline: clean `master` at start; prior audit passed module boundaries, Node/Web types and 37 lifecycle/domain tests. Five issues reproduced or source-traced; no real model calls.
- Ownership: runtime repair and ledger repair can run independently; parent owns shutdown, conversation integration and final verification. Do not run simultaneous full builds/smoke that share generated artifacts.
- Final code: all five audit findings implemented; independent review additionally found and fixed late proactive IPC and untracked DSH round admission during shutdown. Final reviews found no further concrete blocker in these repairs.
- Verification: 287 test files / 2244 tests passed, 16 files / 61 tests skipped by existing conditions; Node/Web types, module boundaries and build passed. Electron companion, assistant-routines, contact-reliability, DSH and standalone agents passed.
- Broader desktop acceptance remains **not green**: three full smoke runs stopped at different startup/window interaction checks. Added geometric failure diagnostics only; no UI or assertion relaxation. Root causes remain unconfirmed. Exact observations and logs are recorded in `docs/architecture-hardening-acceptance-20261027.md`; do not describe this as a completed release acceptance.
- Workspace retained on `fix/architecture-hardening`. User subsequently authorized committing and pushing this repair branch; no release, real provider calls or user profile mutation.
