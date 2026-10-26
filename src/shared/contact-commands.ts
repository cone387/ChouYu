import type { AgentAPI, AgentOverview, AgentNotice, AgentDashboard, AgentSettings } from './agents'
import type { AgentDelivery, DeliverySection } from './agent-delivery'
import type { ContactActionInteraction, ContactActionRequest, ContactActionResponse, ContactActionOutcome } from './contact-actions'
import type { ContactInteraction } from './contact-interactions'
import type { ContactReadContext, ContentCitation, ContextReferences } from './contact-content'
import type { ContactTaskEdit } from './contact-task-edit'
import type { ContactOutputPreferenceRecord, ContactOutputScope, ContactOutputPreference } from './contact-output'
import type { Handoff, HandoffRequest, HandoffWork, HandoffPreparation } from './contact-handoffs'
import type { ContactFile, WorkFileContext, ValidatedWorkFile } from './contact-files'
import type { ContactWorkSettingsPatch } from './contact-work-settings'

type Command<A extends unknown[], R> = { args: A; result: R }
type FromAPI<T> = { [K in keyof T]: T[K] extends (owner: string, ...args: infer A) => Promise<infer R> ? Command<A, R> : never }
type PublicCommands = Omit<FromAPI<AgentAPI>,
  'onChanged' | 'runtimeStatus' | 'retryRuntime' | 'restoreRuntime' | 'onRuntimeChanged' | 'dashboard' | 'profile' | 'searchCredential' | 'exportDelivery' | 'exportContactFile' |
  'prepareHandoff' | 'importMaterial' | 'cancelMaterialImport' | 'assignTopic' | 'save' | 'editTopic' | 'setOutputPreference' | 'pendingInteractions'>

export type DeliveryInspection = {
  version: number | null; savedSectionCount: number; directory: { id: string; title: string; characters: number }[]
  message?: string; latestVersion?: number; createdAt?: number; savedTextLength?: number
  completionCriteria?: string; stages?: AgentDelivery['stages']; inputs?: AgentDelivery['inputs']
  presentation?: AgentDelivery['presentation'] | null; section?: DeliverySection
}

/** Wire contract. Shared types never import service instances or Electron. */
export type ContactCommandMap = PublicCommands & {
  dashboard: Command<[owners: string[]], AgentDashboard>
  remove: Command<[], null>
  resumeRecovered: Command<[topicId: string, restoreId: string, requestId: string], AgentOverview>
  attachModule: Command<[module: string], null>
  detachModule: Command<[module: string], null>
  spaceDiagnostics: Command<[], { activeRuns: number; capacity: number; metrics: import('./contact-runtime').ContactRuntimeMetrics; faults: { characterId: string; error: string }[] }>
  enableContinuous: Command<[], AgentOverview>
  save: Command<[settings: AgentSettings, revision?: number], AgentOverview>
  assignTopic: Command<[description: string, requestLog?: string, tokens?: number, endingRequest?: import('./task-ending').TaskEndingRequest], AgentOverview>
  assignCalendarTopic: Command<[input: unknown, requestLog?: string], AgentOverview>
  editCalendarTopic: Command<[topicId: string, revision: number, input: unknown, reason: string], AgentOverview>
  editTaskFromChat: Command<[topicId: string, revision: number, patch: ContactTaskEdit, reason: string], AgentOverview>
  editTaskFromDescription: Command<[topicId: string, revision: number, patch: ContactTaskEdit, status: 'paused' | 'planned' | 'completed' | 'abandoned' | undefined, requestLog: string], AgentOverview>
  editTopic: Command<[topicId: string, revision: number, input: import('./agents').AgentTopicInput, reason: string, requestLog?: string], AgentOverview>
  editWorkSettingsFromChat: Command<[revision: number, patch: ContactWorkSettingsPatch, reason: string], AgentOverview>
  answerChecked: Command<[topicId: string, revision: number, runId: string, answer: string], AgentOverview>
  setTaskTokenLimit: Command<[topicId: string, revision: number, limit: number], AgentOverview>
  feedback: Command<FeedbackArguments, AgentOverview>
  inspectDelivery: Command<[topicId: string, version?: number, sectionId?: string], DeliveryInspection>
  citationContext: Command<[citations: ContentCitation[]], string>
  context: Command<[context?: ContactReadContext], string>
  contextSnapshot: Command<[context: ContactReadContext], { text: string; memories: { id: string; revision: number }[]; truncated: boolean }>
  assertContextCurrent: Command<[references: ContextReferences], void>
  outputPreferenceCatalogue: Command<[], ContactOutputPreferenceRecord[]>
  setOutputPreference: Command<[scope: ContactOutputScope, revision: number, patch: ContactOutputPreference, reason?: string], ContactOutputPreferenceRecord>
  pendingInteractions: Command<[], ContactInteraction[]>
  offerAction: Command<[sourceKey: string, request: ContactActionRequest], ContactActionInteraction>
  claimAction: Command<[id: string, version: string, response: ContactActionResponse], ContactActionInteraction>
  finishAction: Command<[id: string, version: string, outcome: ContactActionOutcome], ContactActionInteraction>
  failAction: Command<[id: string, version: string, error: string], ContactActionInteraction>
  rejectAction: Command<[id: string, version: string], ContactActionInteraction>
  cancelPendingAction: Command<[id: string, version: string], ContactActionInteraction>
  acknowledgeAction: Command<[id: string, version: string], ContactActionInteraction>
  startActionExecution: Command<[id: string, version: string], null>
  actionNotices: Command<[], ContactActionInteraction[]>
  ackActionNotice: Command<[id: string], null>
  notices: Command<[], AgentNotice[]>
  ackNotice: Command<[id: string], null>
  checkHandoff: Command<[request: HandoffRequest], Handoff | null>
  stageHandoff: Command<[request: HandoffRequest, work: HandoffWork], HandoffPreparation>
  archiveFiles: Command<[context: WorkFileContext, files: ValidatedWorkFile[]], ContactFile[]>
}
export type FeedbackMethod = 'editTaskFromChat' | 'editCalendarTopic' | 'assignCalendarTopic' | 'topicStatus' | 'deleteTopic' | 'editTopic' | 'continueTopic' | 'answerChecked' | 'assignTopic' | 'reviseTopic'
export type FeedbackArguments = { [M in FeedbackMethod]: [revision: number, method: M, args: ContactCommandMap[M]['args']] }[FeedbackMethod]
export type ContactCommandName = keyof ContactCommandMap
export type ContactArgs<M extends ContactCommandName> = ContactCommandMap[M]['args']
export type ContactResult<M extends ContactCommandName> = ContactCommandMap[M]['result']
export type EmptyContactCommand = { [M in ContactCommandName]: [] extends ContactArgs<M> ? M : never }[ContactCommandName]
export interface ContactRequest {
  <M extends ContactCommandName>(method: M, owner: string, args: ContactArgs<M>): Promise<ContactResult<M>>
}

// Arity is checked at the transport boundary. Object/business rules remain in
// the domain repositories, including ownership and optimistic concurrency.
const arities: Record<ContactCommandName, readonly [number, number]> = {
  resumeRecovered: [3, 3],
  contactHome: [0, 0], pendingInteractions: [0, 0], getInteraction: [1, 1], outputPreferences: [0, 2], setOutputPreference: [3, 4], submitInteraction: [2, 2],
  dashboard: [1, 1], summary: [0, 0], continueTopic: [3, 4], setTaskBudget: [3, 3], delivery: [1, 2], reviseTopic: [3, 6], savePreferences: [1, 2], get: [0, 0], save: [1, 2], run: [0, 2],
  createTopic: [1, 1], assignTopic: [1, 4], deleteTopic: [2, 2], editTopic: [4, 5], topicStatus: [4, 4], focusTopic: [1, 1], topicDetail: [1, 2], interactions: [1, 2], analytics: [1, 1], pause: [0, 0], detail: [1, 1], answer: [2, 3], remember: [1, 1], forget: [1, 1],
  validateCitation: [1, 1], reviseCitation: [3, 3], portfolio: [1, 1], setDeliveryFavorite: [2, 2], saveDeliveryReading: [1, 1], deliveryReading: [1, 1],
  memoryList: [0, 0], createMemory: [1, 1], updateMemory: [3, 3], memoryHistory: [1, 1], forgetMemory: [2, 2],
  materialList: [1, 1], saveMaterial: [1, 3], readMaterial: [2, 3], materialHistory: [1, 1], withdrawMaterial: [2, 2], materialInventory: [0, 0], purgeMaterial: [2, 2],
  commitHandoff: [1, 1], handoffs: [0, 1], handoffState: [1, 1], returnReview: [1, 1], fileList: [0, 1], readContactFile: [1, 1],
  remove: [0, 0], attachModule: [1, 1], detachModule: [1, 1], spaceDiagnostics: [0, 0], enableContinuous: [0, 0], assignCalendarTopic: [1, 2], editCalendarTopic: [4, 4], editTaskFromChat: [4, 4], editTaskFromDescription: [5, 5], editWorkSettingsFromChat: [3, 3], answerChecked: [4, 4], setTaskTokenLimit: [3, 3], feedback: [3, 3], inspectDelivery: [1, 3], citationContext: [1, 1], context: [0, 1], contextSnapshot: [1, 1], assertContextCurrent: [1, 1], outputPreferenceCatalogue: [0, 0],
  offerAction: [2, 2], claimAction: [3, 3], finishAction: [3, 3], failAction: [3, 3], rejectAction: [2, 2], cancelPendingAction: [2, 2], acknowledgeAction: [2, 2], startActionExecution: [2, 2], actionNotices: [0, 0], ackActionNotice: [1, 1], notices: [0, 0], ackNotice: [1, 1], checkHandoff: [1, 1], stageHandoff: [2, 2], archiveFiles: [2, 2], deliveryFeedback: [6, 8], deliveryFeedbackList: [1, 1]
}
export const isContactCommand = (method: unknown): method is ContactCommandName => typeof method === 'string' && Object.hasOwn(arities, method)
const revisions: Partial<Record<ContactCommandName, number[]>> = {
  deleteTopic: [1], editTopic: [1], topicStatus: [1], continueTopic: [1], reviseTopic: [1], editCalendarTopic: [1], editTaskFromChat: [1], editTaskFromDescription: [1], answerChecked: [1], setTaskBudget: [1], setTaskTokenLimit: [1], feedback: [0], editWorkSettingsFromChat: [0], reviseCitation: [0], setOutputPreference: [1], updateMemory: [1], forgetMemory: [1], withdrawMaterial: [1], purgeMaterial: [1], deliveryFeedback: [1, 2]
}
export function validateContactCommand(method: unknown, owner: unknown, args: unknown): asserts method is ContactCommandName {
  if (!isContactCommand(method)) throw new Error('未知 Agent 操作。')
  if (typeof owner !== 'string' || !owner.trim() && !['dashboard', 'spaceDiagnostics'].includes(method)) throw new Error('联系人归属无效。')
  const [min, max] = arities[method]
  if (!Array.isArray(args) || args.length < min || args.length > max) throw new Error('联系人操作参数无效。')
  if (revisions[method]?.some(index => !Number.isSafeInteger(args[index]))) throw new Error('版本参数无效，请重新读取。')
}
