import type { WorkLoopHost } from './workloop-host'
import type { ContactIdentity } from '../contact-agent/contracts'
import { ContactCommandQueue } from './command-queue'

/** Roster reconciliation fans out synchronously before later owner commands are queued. */
export function dispatchContactCommand(queue: ContactCommandQueue,
  service: Pick<WorkLoopHost, 'sync' | 'syncContact' | 'request' | 'close'>,
  method: string, id: string, args: unknown[], started: () => void = () => {}) {
  if (method === 'sync') {
    started()
    return service.sync(args[0] as ContactIdentity[], (owner, operation) => queue.submit(owner, false, operation), queue.owners())
  }
  return queue.submit(id, method === 'close', async () => {
    started()
    if (method === 'close') return service.close()
    if (method === 'syncContact') {
      const identity = args[0] as ContactIdentity
      if (identity?.id !== id) throw new Error('联系人身份与请求归属不一致。')
      return service.syncContact(identity)
    }
    return service.request(method, id, args)
  })
}
