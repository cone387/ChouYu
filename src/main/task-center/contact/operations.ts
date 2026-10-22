import type { ContentCitation } from '../../../shared/contact-content';
import type { AgentOverview, AgentMemory, AgentReport, AgentRunDetail, AgentRunStatus, AgentTopicProgress, AgentTopicStatus } from '../../../shared/agents';
import type { ContextReferences } from '../../../shared/contact-content';
import { type TaskResourceBudget } from '../../../shared/agent-resources';
import type { AgentResearch } from '../../../shared/agents';
import { type DeliveryPlan, type DeliveryUpdate } from '../../../shared/agent-delivery';
import type { AIResponseMetadata } from '../../../shared/ai-usage';
import type { AgentTopicMetrics } from '../../../shared/agents';
import type { AnalyticsQuery } from '../../../shared/agent-analytics';
import { Profile, RunRow } from './types';
/** Stable internal signatures; modules receive only the operations they use. */
export interface ContactStoreOperations {
  restoreFailureSchedules(): void
  recordHeartbeats(now?: number): void
  close(): void
  pendingCleanup(): { characterId: string; requestId: string; }[]
  finishCleanup(characterId: string, requestId: string): void
  dashboard(characterIds: string[]): import("../../../shared/agents").AgentDashboard
  summary(characterId: string): import("../../../shared/agents").AgentSummary
  profile(id: string): Profile | undefined
  profiles(): Profile[]
  ensure(id: string): void
  save(id: string, raw: unknown, now?: number, createDefaultTopic?: boolean, expectedRevision?: number, requestReason?: string): AgentOverview
  pause(id: string, reason?: string): AgentOverview
  cancel(id: string, reason: string, now?: number): void
  assertContextCurrent(owner: string, refs: ContextReferences): void
  invalidateMemory(owner: string, memoryId: string): string[]
  recordMaterialRead(runId: string, ref: import("../../../shared/contact-materials").MaterialReadRef): void
  recordMemoryContext(runId: string): void
  invalidateMaterial(owner: string, materialId: string): string[]
  remove(id: string): string[]
  overview(id: string, now?: number): AgentOverview
  latestCallId(runId: string): number | undefined
  interactions(characterId: string, topicId: string, cursor?: number): import("../../../shared/agents").AgentInteractionPage
  analytics(characterId: string, query: AnalyticsQuery, now?: number): import("../../../shared/agent-analytics").AgentAnalytics
  recordCallMetadata(callId: number, metadata: AIResponseMetadata, now?: number): void
  topicMetrics(characterId: string, now?: number): Record<string, AgentTopicMetrics>
  memories(id: string): AgentMemory[]
  remember(id: string, text: string, runId?: string | null): void
  forget(id: string, memoryId: string): void
  callCount(id: string, now?: number): number
  runCalls(runId: string): number
  reservedCalls(owner: string, exceptTopicId?: string | null): number
  reserveRunCalls(runId: string): boolean
  releaseRunCalls(runId: string): void
  getRun(id: string): RunRow | undefined
  detail(characterId: string, runId: string): AgentRunDetail
  event(runId: string, kind: string, text: string, now?: number): void
  taskCallCount(id: string, topicId: string): number
  resourceContext(id: string, topicId: string, now?: number): { contactDailyLimit: number; dailyRemaining: number; taskUsed: number; taskBudget: TaskResourceBudget | undefined; allocatableCalls: number; otherTasks: { title: string; remaining: number; }[]; }
  assertTaskBudget(id: string, topicId: string, needed: number): void
  setTaskBudget(id: string, topicId: string, revision: number, raw: unknown): { resourceBudget: TaskResourceBudget; revision: number; updatedAt: number; reason: string; calendar?: import("../../../shared/calendar-schedule").CalendarSchedule; separateEvaluations?: boolean; tokenLimit?: number; initialPlan?: import("../../../shared/agent-delivery").DeliveryPlan; requestLog?: string; id: string; characterId: string; status: AgentTopicStatus; judgement: string; openQuestions: string; nextStep: string; createdAt: number; title: string; goal: string; constraints: string; }
  allocateTaskBudget(runId: string, raw?: TaskResourceBudget): import("../../../shared/agents").AgentTopic
  createRun(id: string, context: string, now?: number, topicId?: string, revisionScope?: "presentation"): string
  assignTopic(id: string, description: unknown, conversation: string, requestLog?: string, tokenLimit?: number): import("../../../shared/agents").AgentTopic
  assignCalendarTopic(id: string, raw: unknown, conversation: string, requestLog?: string): import("../../../shared/agents").AgentTopic
  editCalendarTopic(id: string, topicId: string, revision: number, raw: unknown, reason: string): AgentOverview
  scheduled(id: string): { topic_id: string; conversation: string; pending: number; next_at: number; }[]
  providerRecovery(id: string, topicId?: string): { runId: string; topicId: string; at: number; } | undefined
  nextScheduledTopic(id: string, now?: number, newSources?: (topicId: string) => boolean, excluded?: ReadonlySet<string>): string | undefined
  startScheduledTopic(id: string, topicId: string, conversation: string): string
  saveBrief(runId: string, brief: { title: string; nextStep: string; question: string; plan: DeliveryPlan; resourceBudget?: TaskResourceBudget; }): void
  saveBriefAnswer(runId: string, answer: string): void
  assertLive(runId: string): RunRow
  charge(runId: string, now?: number): void
  setStatus(id: string, status: AgentRunStatus, now?: number): void
  searchCount(id: string, now?: number): number
  chargeSearch(runId: string, now?: number): void
  research(runId: string): AgentResearch | undefined
  saveResearch(runId: string, research: AgentResearch): void
  defer(runId: string, reason: string, unchanged?: boolean): void
  recoverOutOfScopeQuestion(runId: string, error: string): void
  recover(): void
  runnable(): RunRow[]
  callsNeededToResume(runId: string): 1 | 3 | 2
  wait(id: string, question: string, inputs?: import("../../../shared/agent-delivery").TaskInputField[]): void
  answer(characterId: string, id: string, text: string, answers?: unknown): void
  fail(id: string, error: string): void
  failRun(id: string, error: string): void
  finish(runId: string, report: AgentReport, memories: string[], progress?: AgentTopicProgress, delivery?: DeliveryUpdate): void
  createTopic(id: string, input: unknown): AgentOverview
  completeCalendar(run: RunRow): number | undefined
  pauseForTaskBudget(runId: string): boolean
  deleteTopic(id: string, topicId: string, revision: number): string[]
  revisePresentation(id: string, topicId: string, revision: number, feedback: unknown, conversation: string, baseVersion: number): string
  reviseCitation(id: string, revision: number, raw: ContentCitation, feedback: string, conversation: string): string
  reviseTopic(id: string, topicId: string, revision: number, feedback: unknown, conversation: string, sectionId?: string): string
  editTaskFromChat(id: string, topicId: string, revision: number, patch: import("../../../shared/contact-task-edit").ContactTaskEdit, reason: string, archivedLog?: string): AgentOverview
  changeTopic(id: string, topicId: string, revision: number, change: { input: unknown; reason: string; requestLog?: string; } | { status: AgentTopicStatus; reason: string; }): AgentOverview
  focusTopic(id: string, topicId: string): AgentOverview
  continueTopic(id: string, topicId: string, revision: number, reason: string, conversation: string): string | undefined
}
