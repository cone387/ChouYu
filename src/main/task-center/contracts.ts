export type TaskDomainName = 'contact' | 'todo' | 'assistant'
export interface TaskScope<D extends TaskDomainName = TaskDomainName> { domain: D; owner: string }
export interface TaskRef<D extends TaskDomainName = TaskDomainName> extends TaskScope<D> { id: string }

export interface TaskDomains {
  todo: { commands: import('./todo-domain').TodoCommands; query: import('../../shared/tasks').TaskListOptions | undefined; list: ReturnType<import('./todo-domain').TodoCommands['listTasks']>; read: ReturnType<import('./todo-domain').TodoCommands['getTask']> }
  assistant: { commands: import('./assistant-domain').AssistantTaskCommands; query: undefined; list: ReturnType<import('./assistant-domain').AssistantTaskCommands['list']>; read: import('../../shared/assistant-routines').AssistantRoutine | null }
  contact: { commands: import('./contact-domain').ContactCommands; query: undefined; list: Promise<import('../../shared/agents').AgentTopic[]>; read: Promise<import('../../shared/agents').AgentTopicDetail> }
}
export type DomainCommand<D extends TaskDomainName> = Extract<keyof TaskDomains[D]['commands'], string>
export type DomainArgs<D extends TaskDomainName, K extends DomainCommand<D>> = TaskDomains[D]['commands'][K] extends (...args: infer A) => unknown ? A : never
export type DomainResult<D extends TaskDomainName, K extends DomainCommand<D>> = TaskDomains[D]['commands'][K] extends (...args: never[]) => infer R ? R : never

/** Domain stores retain their native result types, revisions and transactions. */
export interface TaskDomain<D extends TaskDomainName> {
  id: D
  operations: readonly DomainCommand<D>[]
  assertOwner(owner: string): void
  commands(owner: string): TaskDomains[D]['commands']
  list(owner: string, query?: TaskDomains[D]['query']): TaskDomains[D]['list']
  read(ref: TaskRef<D>): TaskDomains[D]['read']
}

export function bindOperations<T extends object, K extends keyof T>(target: T, names: readonly K[]): Pick<T, K> {
  return Object.fromEntries(names.map(name => {
    const method = target[name]
    if (typeof method !== 'function') throw new Error(`任务能力不是方法：${String(name)}`)
    return [name, method.bind(target)]
  })) as Pick<T, K>
}
