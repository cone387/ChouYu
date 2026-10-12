# Chapter Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop long fiction tasks indefinitely extending one chapter, and prevent change summaries being saved as prose when structured delivery is missing.

**Architecture:** Derive chapter size from saved section bodies. A bounded, charged, durable semantic review decides continuation, closing, or advancement near the default chapter length; committed closing prose advances the following run. Validate generation, recovery, and commit against that decision without rewriting saved prose or task scope.

**Tech Stack:** TypeScript, SQLite, LangGraph, Vitest.

**Spec:** `docs/contact-task-spec.md`, especially original scope, durable delivery, failure and lifecycle requirements.

## Global Constraints

- Preserve original goals, existing prose and user permissions; no live database migration.
- Chapters and output chunks are different; default 3000–5000 non-whitespace characters is guidance, explicit user requirements take precedence.
- No task UI or form changes. Keep original task budget and cancellation/version checks.
- Legacy runs retain compatibility; modern creative writing must provide actual `delivery.section.body`.

## Review Focus

- Chapter numbers restarting in another volume must not mix counts.
- Revising an earlier chapter must not accidentally start a new chapter.
- Failed or cancelled closing drafts must not count as a closed chapter.
- Persisted recovery must not reuse prose generated under an older chapter decision.
- Reply revision and resumed checkpoints must not bypass delivery validation.

### Task 1: Chapter continuation

**Files:** create `src/main/agents/chapter-continuation.ts`, `src/main/agents/chapter-continuation.test.ts`; modify `src/main/agents/runtime.ts`.

**Interfaces:** `planChapterContinuation(store, runId, topic, model, signal, live)` returns an optional persisted chapter decision. `validateChapterContinuation(draft, decision)` validates the chapter and derives the closing next step.

- [x] Write regression tests for an oversized first chapter, close then advance across restart, wrong chapter rejection, volume separation, and revision bypass.
- [x] Run targeted tests and observe failures.
- [x] Implement bounded review with saved-body counts, explicit user override, durable decision and commit-time validation; include decision in writing/recovery prompts and recovery identity.
- [x] Run targeted tests and typecheck.

### Task 2: Real prose contract and acceptance

**Files:** modify `src/main/agents/runtime.ts`, `src/main/agents/store.ts`, tests and `docs/contact-task-spec.md`; add acceptance record.

- [x] Write regression for missing modern delivery falling back to a summary; preserve legacy and metadata-only updates.
- [x] Observe failure, then reject missing structured delivery before storage and route creative generation through existing recovery.
- [x] Run affected tests, full tests, typecheck and build. Review complete change.
- [x] Record evidence and limits, including no live-model acceptance unless actually run and required app restart.

## Execution ledger

- 2026-10-12: Read-only live diagnosis: chapter 1 has 16 saved sections / 15491 characters; sections 4 and 7 contain summaries. No original prose for these two was found in historical reports.
- Ruling: use a dedicated branch in the existing checkout so the user's development entry point receives the fix; no live data writes, master commits, merge or push in this task.
- Ruling: execute inline under executing-plans; optional chapter length question defaults to 3000–5000 characters as stated to the user.
- Completed: 14 chapter regressions, 1394 total tests passed / 19 skipped, typecheck/build and Electron agents smoke passed. Isolated real configured-model acceptance saved chapter two while preserving six original sections. See `docs/contact-chapter-continuation-20261012.md`.
- Review fixes: permit question-only waiting, preserve finite scope and completion-review corrections, reuse exact failed-run decisions and actual scratch prose, require explicit next-volume labels. Final fresh review has no important findings.
- Live user database remained read-only. Existing old application process still needs a full restart. No commit, push or live task resume performed for this request.
