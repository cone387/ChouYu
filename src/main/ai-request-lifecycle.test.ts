import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { bindAIRequestLifecycle } from './ai-request-lifecycle'
import { waitForToolApproval } from './tool-approval'

describe('AI requests waiting for their renderer', () => {
  it.each(['destroyed', 'render-process-gone', 'reload'])('cancels and releases pending approval on %s', async event => {
    const sender = new EventEmitter(), controller = new AbortController(), unsubscribe = vi.fn()
    const cleanup = bindAIRequestLifecycle(sender, controller)
    const pending = waitForToolApproval(controller.signal, () => unsubscribe)
    if (event === 'reload') sender.emit('did-start-navigation', {}, 'file:///app', false, true)
    else sender.emit(event, {}, {})
    expect(controller.signal.aborted).toBe(true)
    expect(await pending).toBe('cancelled')
    expect(unsubscribe).toHaveBeenCalledOnce()
    cleanup()
    expect(sender.eventNames()).toEqual([])
  })

  it('keeps hidden, same-document and subframe requests alive and removes listeners when done', () => {
    const sender = new EventEmitter(), controller = new AbortController()
    const cleanup = bindAIRequestLifecycle(sender, controller)
    sender.emit('hide')
    sender.emit('did-start-navigation', {}, 'file:///app#chat', true, true)
    sender.emit('did-start-navigation', {}, 'https://frame.example', false, false)
    expect(controller.signal.aborted).toBe(false)
    cleanup()
    sender.emit('render-process-gone', {}, {})
    expect(controller.signal.aborted).toBe(false)
    expect(sender.eventNames()).toEqual([])
  })
})
