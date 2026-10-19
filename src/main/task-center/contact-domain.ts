import type { AgentSpace } from '../agent-space/service'
import type { TaskDomain } from './contracts'

const operations = [
  'get', 'summary', 'analytics', 'topicDetail', 'interactions', 'createTopic', 'deleteTopic',
  'assignTopic', 'assignCalendarTopic', 'editCalendarTopic', 'editTaskFromChat', 'editTaskFromDescription',
  'editTopic', 'topicStatus', 'focusTopic', 'continueTopic', 'answerChecked', 'answer', 'run', 'pause',
  'setTaskBudget', 'setTaskTokenLimit', 'feedback', 'reviseTopic', 'inspectDelivery', 'delivery',
  'checkHandoff', 'stageHandoff', 'commitHandoff', 'handoffs', 'handoffState', 'returnReview'
] as const
export type ContactTaskMethod = typeof operations[number]
type ContactCommands = Record<ContactTaskMethod, (...args: unknown[]) => Promise<unknown>>
export const isContactTaskMethod = (method: string): method is ContactTaskMethod => (operations as readonly string[]).includes(method)
export function createContactDomain(space: AgentSpace): TaskDomain<ContactCommands> {
  return { id: 'contact', operations,
    // AgentSpace resolves the authoritative identity before every operation.
    assertOwner: owner => { if (!owner.trim()) throw new Error('联系人任务归属无效。') },
    commands: owner => Object.fromEntries(operations.map(method => [method, (...args: unknown[]) => space.request(method, owner, args)])) as ContactCommands,
    list: async owner => (await space.request('get', owner)).topics,
    read: ref => space.request('topicDetail', ref.owner, [ref.id]) }
}
