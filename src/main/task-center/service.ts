import type { TaskDomain, TaskDomainName, TaskRef, TaskScope } from './contracts'

type RegisteredDomain = Omit<TaskDomain<object>, 'operations' | 'commands'> & {
  operations: readonly string[]
  commands(owner: string): object
}

/** System-level routing. It does not combine states or transactions across domains. */
export class TaskCenter {
  private domains = new Map<TaskDomainName, RegisteredDomain>()

  register<C extends object>(domain: TaskDomain<C>) {
    if (this.domains.has(domain.id)) throw new Error(`任务域已注册：${domain.id}`)
    if (new Set(domain.operations).size !== domain.operations.length) throw new Error('任务能力重复。')
    const registered: RegisteredDomain = domain
    this.domains.set(domain.id, registered)
    return {
      bind: (owner: string): C => {
        this.resolve({ domain: domain.id, owner })
        return Object.fromEntries(domain.operations.map(command => [command, (...args: unknown[]) => {
          if (this.domains.get(domain.id) !== registered) throw new Error('任务域已卸载，请重新获取入口。')
          return this.execute({ domain: domain.id, owner }, command, args)
        }])) as C
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
  list(scope: TaskScope, query?: unknown) { return this.resolve(scope).list(scope.owner, query) }
  read(ref: TaskRef) {
    const domain = this.resolve(ref)
    if (typeof ref.id !== 'string' || !ref.id.trim()) throw new Error('任务引用无效。')
    return domain.read(ref)
  }
  execute(scope: TaskScope, command: string, args: unknown[] = []): unknown {
    const domain = this.resolve(scope)
    if (!domain.operations.includes(command)) throw new Error('任务域不支持此能力。')
    const commands = domain.commands(scope.owner)
    const fn = Object.prototype.hasOwnProperty.call(commands, command) ? (commands as Record<string, unknown>)[command] : undefined
    if (typeof fn !== 'function' || !Array.isArray(args)) throw new Error('任务能力或参数无效。')
    return Reflect.apply(fn, undefined, args)
  }
}

export const taskCenter = new TaskCenter()
