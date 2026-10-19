import { DEFAULT_CHARACTER_ID } from '../../shared/characters'
import type { AssistantRoutineService } from '../assistant-routines/service'
import { bindOperations, type TaskDomain } from './contracts'

const operations = ['list', 'history', 'save', 'remove', 'tick'] as const
export type AssistantTaskCommands = Pick<AssistantRoutineService, typeof operations[number]>
export function createAssistantDomain(service: AssistantRoutineService): TaskDomain<AssistantTaskCommands> {
  const commands = bindOperations(service, operations)
  return { id: 'assistant', operations,
    assertOwner: owner => { if (owner !== DEFAULT_CHARACTER_ID) throw new Error('助手安排归属不匹配。') },
    commands: () => commands, list: () => service.list(), read: ref => service.list().find(item => item.id === ref.id) ?? null }
}
