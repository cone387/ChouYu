import { expect, it, vi } from 'vitest'
import { createPendingEvent } from './pending-event'

it('delivers early startup clicks once when the renderer subscribes', () => {
  const event = createPendingEvent()
  event.emit()
  event.emit()
  const listener = vi.fn()
  const unsubscribe = event.subscribe(listener)
  expect(listener).toHaveBeenCalledOnce()
  event.emit()
  expect(listener).toHaveBeenCalledTimes(2)
  unsubscribe()
  const replacement = vi.fn()
  event.subscribe(replacement)
  expect(replacement).not.toHaveBeenCalled()
  event.emit()
  expect(replacement).toHaveBeenCalledOnce()
  expect(listener).toHaveBeenCalledTimes(2)
})

it('retains a click while the React subscription is being replaced', () => {
  const event = createPendingEvent()
  event.subscribe(vi.fn())()
  event.emit()
  const listener = vi.fn()
  event.subscribe(listener)
  expect(listener).toHaveBeenCalledOnce()
})
