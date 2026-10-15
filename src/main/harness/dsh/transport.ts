import { createServer, type Server } from 'node:net'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { RpcPeer } from '../../../../runtime/dsh/wire.mjs'
export type RuntimeRole = 'helper' | 'plugin'

export class DshTransport {
  readonly token = randomBytes(32).toString('hex')
  private server?: Server
  private peers = new Map<RuntimeRole, RpcPeer>()
  private sockets = new Set<RpcPeer>()
  private waiters = new Map<RuntimeRole, Array<{resolve:(peer:RpcPeer)=>void; reject:(error:Error)=>void}>>()
  constructor(private handle:(role:RuntimeRole, method:string,value:any)=>unknown|Promise<unknown>, private disconnected:(role:RuntimeRole)=>void) {}
  async listen(): Promise<number> {
    this.server = createServer(socket => {
      let role: RuntimeRole | undefined
      const timer = setTimeout(() => peer.close(), 5000)
      const peer = new RpcPeer(socket, async (method, value) => {
        if (!role) {
          const candidate = typeof value?.token === 'string' ? Buffer.from(value.token) : Buffer.alloc(0)
          if (method !== 'hello' || candidate.length !== this.token.length || !timingSafeEqual(candidate, Buffer.from(this.token)) || !['helper', 'plugin'].includes(value.role) || this.peers.has(value.role)) {
            peer.close(); throw new Error('DSH 通道认证失败。')
          }
          role = value.role; clearTimeout(timer); this.peers.set(role!, peer)
          for (const waiter of this.waiters.get(role!) ?? []) waiter.resolve(peer)
          this.waiters.delete(role!)
          return { accepted: true }
        }
        return this.handle(role, method, value)
      }, () => {
        clearTimeout(timer); this.sockets.delete(peer)
        if (role) { this.peers.delete(role); this.disconnected(role) }
      })
      this.sockets.add(peer)
    })
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', resolve) })
    return (this.server.address() as {port:number}).port
  }
  wait(role: RuntimeRole): Promise<RpcPeer> {
    const existing = this.peers.get(role)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve,reject) => {
      const item = { resolve: (peer:RpcPeer) => { clearTimeout(timer); resolve(peer) }, reject: (error:Error) => { clearTimeout(timer); reject(error) } }
      const timer = setTimeout(() => { this.waiters.set(role, (this.waiters.get(role) ?? []).filter(v => v !== item)); reject(new Error('DSH 启动连接超时。')) }, 35000)
      this.waiters.set(role, [...(this.waiters.get(role) ?? []), item])
    })
  }
  async close():Promise<void> {
    for (const items of this.waiters.values()) for (const item of items) item.reject(new Error('DSH 已关闭。'))
    this.waiters.clear()
    for (const peer of this.sockets) peer.close()
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()))
  }
}
