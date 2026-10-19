export type TaskDomainName = 'contact' | 'todo' | 'assistant'
export interface TaskScope { domain: TaskDomainName; owner: string }
export interface TaskRef extends TaskScope { id: string }

/** Domain stores retain their native result types, revisions and transactions. */
export interface TaskDomain<Commands extends object> {
  id: TaskDomainName
  operations: readonly Extract<keyof Commands, string>[]
  assertOwner(owner: string): void
  commands(owner: string): Commands
  list(owner: string, query?: unknown): unknown
  read(ref: TaskRef): unknown
}

export function bindOperations<T extends object, K extends keyof T>(target: T, names: readonly K[]): Pick<T, K> {
  return Object.fromEntries(names.map(name => {
    const method = target[name]
    if (typeof method !== 'function') throw new Error(`任务能力不是方法：${String(name)}`)
    return [name, method.bind(target)]
  })) as Pick<T, K>
}
