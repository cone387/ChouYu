import type { IpcMain, IpcMainEvent } from 'electron'

type Listener = (event: IpcMainEvent, ...args: any[]) => void
export interface IpcRegistrar {
  handle: IpcMain['handle']
  on(channel: string, listener: Listener): void
  cleanup(release: () => void): void
}
interface IpcTransport {
  handle: IpcMain['handle']
  on(channel: string, listener: Listener): unknown
  removeHandler(channel: string): void
  removeListener(channel: string, listener: Listener): unknown
}

/** Each domain releases only registrations it actually acquired. */
export function registerDomain(transport: IpcTransport, setup: (ipc: IpcRegistrar) => void): () => void {
  const releases: (() => void)[] = []
  const dispose = () => { for (const release of releases.splice(0).reverse()) release() }
  const registrar: IpcRegistrar = {
    cleanup(release) { releases.push(release) },
    handle(channel, handler) {
      transport.handle(channel, handler)
      releases.push(() => transport.removeHandler(channel))
    },
    on(channel, handler) {
      transport.on(channel, handler)
      releases.push(() => { transport.removeListener(channel, handler) })
    }
  }
  try { setup(registrar) } catch (error) { dispose(); throw error }
  return dispose
}
