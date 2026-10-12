import type { EventEmitter } from 'node:events'

/** A renderer restart loses its confirmation queue; hiding the panel does not. */
export function bindAIRequestLifecycle(sender: Pick<EventEmitter, 'on' | 'removeListener'>, controller: AbortController): () => void {
  const abort = () => controller.abort()
  const navigation = (_event: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
    if (isMainFrame && !isInPlace) abort()
  }
  sender.on('destroyed', abort)
  sender.on('render-process-gone', abort)
  sender.on('did-start-navigation', navigation)
  return () => {
    sender.removeListener('destroyed', abort)
    sender.removeListener('render-process-gone', abort)
    sender.removeListener('did-start-navigation', navigation)
  }
}
