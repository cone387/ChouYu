import type { TaskDomain, TaskDomainName, TaskRef, TaskScope, TaskDomains, DomainCommand, DomainArgs, DomainResult } from './contracts'

type RegisteredDomain = {
  id: TaskDomainName
  assertOwner(owner: string): void
  list(owner: string, query?: unknown): unknown
  read(ref: TaskRef): unknown
  operations: readonly string[]
  commands(owner: string): object
}

/** System-level routing. It does not combine states or transactions across domains. */
export class TaskCenter {
  private domains = new Map<TaskDomainName, RegisteredDomain>()

  register<D extends TaskDomainName>(domain: TaskDomain<D>) {
    if (this.domains.has(domain.id)) throw new Error(`任务域已注册：${domain.id}`)
    if (new Set(domain.operations).size !== domain.operations.length) throw new Error('任务能力重复。')
    const registered = domain as RegisteredDomain
    this.domains.set(domain.id, registered)
    return {
      bind: (owner: string): TaskDomains[D]['commands'] => {
        this.resolve({ domain: domain.id, owner })
        return Object.fromEntries(domain.operations.map(command => [command, (...args: unknown[]) => {
          if (this.domains.get(domain.id) !== registered) throw new Error('任务域已卸载，请重新获取入口。')
          return this.dispatchUnknown({ domain: domain.id, owner }, command, args)
        }])) as TaskDomains[D]['commands']
      },
      dispose: () => { if (this.domains.get(domain.id) === registered) this.domains.delete(domain.id) }
    }
  }

  private resolve(scope: TaskScope) {
    if (!scope || typeof scope.owner !== 'string' || !scope.owner.trim()) throw new Error('任务归属无效。')
    const domain = this.domains.get(scope.domain)
    if (!domain) throw new Error('任务域未就绪或已卸载。')
    domain.assertOwner(scope.owner)
    return domain
  }
  capabilities(scope: TaskScope): readonly string[] { return [...this.resolve(scope).operations] }
  list<D extends TaskDomainName>(scope: TaskScope<D>, query?: TaskDomains[NoInfer<D>]['query']): TaskDomains[D]['list'] { return this.resolve(scope).list(scope.owner, query) as TaskDomains[D]['list'] }
  read<D extends TaskDomainName>(ref: TaskRef<D>): TaskDomains[D]['read'] {
    const domain = this.resolve(ref)
    if (typeof ref.id !== 'string' || !ref.id.trim()) throw new Error('任务引用无效。')
    return domain.read(ref) as TaskDomains[D]['read']
  }
  execute<D extends TaskDomainName, K extends DomainCommand<NoInfer<D>>>(scope: TaskScope<D>, command: K, args: DomainArgs<NoInfer<D>, NoInfer<K>>): DomainResult<D, K> {
    return this.dispatchUnknown(scope, command, args) as DomainResult<D, K>
  }
  dispatchUnknown(rawScope: unknown, command: unknown, args: unknown): unknown {
    const scope = rawScope as TaskScope
    const domain = this.resolve(scope)
    if (typeof command !== 'string' || !domain.operations.includes(command)) throw new Error('任务域不支持此能力。')
    const commands = domain.commands(scope.owner)
    const fn = Object.prototype.hasOwnProperty.call(commands, command) ? (commands as Record<string, unknown>)[command] : undefined
    if (typeof fn !== 'function' || !Array.isArray(args)) throw new Error('任务能力或参数无效。')
    return Reflect.apply(fn, undefined, args)
  }
}

export const taskCenter = new TaskCenter()
