import type { ContactModule, ContactModuleOwner, ContactWorkPort } from './contracts'

export interface WorkLoopTransport {
  request(method: string, owner: string, args: unknown[]): Promise<unknown>
  detach(owner: string): Promise<void>
  remove(owner: string): Promise<void>
}

/** The application-owned module delegates execution to the shared worker. */
export class ContactWorkLoop implements ContactModule, ContactWorkPort {
  readonly id = 'workloop'
  readonly work = this
  private closed = false
  private closing?: Promise<void>
  constructor(private owner: ContactModuleOwner, private transport: WorkLoopTransport) {}
  async request(method: string, args: unknown[]) {
    if (this.closed) throw new Error('联系人工作模块已关闭。')
    return this.transport.request(method, this.owner.id, args)
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    return this.closing = this.transport.detach(this.owner.id).catch(error => { this.closing = undefined; throw error })
  }
}
