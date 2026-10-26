import type { WorkLoopHost } from './workloop-host'
import type { ContactIdentity } from '../contact-agent/contracts'
import { ContactCommandQueue } from './command-queue'
import { validateContactCommand } from '../../shared/contact-commands'

/** Roster reconciliation fans out synchronously before later owner commands are queued. */
export async function dispatchContactCommand(queue: ContactCommandQueue,
  service: Pick<WorkLoopHost, 'sync' | 'syncContact' | 'dispatchUnknown' | 'close'> & Partial<Pick<WorkLoopHost, 'admitCommand' | 'syncChanged'>>,
  method: unknown, owner: unknown, input: unknown, started: () => void = () => {}) {
  if (typeof method !== 'string' || typeof owner !== 'string' || !Array.isArray(input)) throw new Error('联系人操作参数无效。')
  const id = owner, args = input
  if (method === 'syncChanged') {
    if (args.length !== 2 || !Array.isArray(args[0]) || !args[0].every(value => typeof value === 'string' && value.trim())
      || !Array.isArray(args[1]) || args[1].some(identity => !identity || typeof identity.id !== 'string') || !service.syncChanged) throw new Error('联系人增量列表无效。')
    const reconcile = async () => { started(); return service.syncChanged!(args[0], args[1], (owner, operation) => queue.submit(owner, false, operation), queue.owners()) }
    return service.admitCommand ? service.admitCommand(method, reconcile) : reconcile()
  }
  if (method === 'sync') {
    if (args.length !== 1 || !Array.isArray(args[0]) || args[0].some(identity => !identity || typeof identity.id !== 'string' || !identity.id.trim())) throw new Error('联系人列表无效。')
    const reconcile = async () => { started(); return service.sync(args[0] as ContactIdentity[], (owner, operation) => queue.submit(owner, false, operation), queue.owners()) }
    return service.admitCommand ? service.admitCommand(method, reconcile) : reconcile()
  }
  if (method === 'close') {
    if (args.length) throw new Error('联系人关闭参数无效。')
  } else if (method !== 'syncContact') validateContactCommand(method, id, args)
  const execute = async () => {
    started()
    if (method === 'close') return service.close()
    if (method === 'syncContact') {
      const identity = args[0] as ContactIdentity
      if (args.length !== 1 || !id.trim() || identity?.id !== id) throw new Error('联系人身份与请求归属不一致。')
      return service.syncContact(identity)
    }
    return service.dispatchUnknown(method, id, args)
  }
  return queue.submit(id, method === 'close', () => method !== 'close' && service.admitCommand ? service.admitCommand(method, execute) : execute())
}
