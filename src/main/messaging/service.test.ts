import { expect, it, vi } from 'vitest'
import { MessageDeliveryService } from './service'
import type { DeliveryRequest } from './contracts'

const request: DeliveryRequest = { kind: 'assistant', content: '该休息了。', receiptIds: ['rest:1'], messageKind: 'rest' }
it('never notifies or lets a caller acknowledge before persistence succeeds', () => {
  const persist = vi.fn().mockImplementationOnce(() => { throw new Error('disk full') }).mockReturnValue({ workspace: {}, disposition: 'delivered' })
  const notify = vi.fn(), acknowledge = vi.fn()
  const service = new MessageDeliveryService({ persist, notify })
  expect(() => { service.deliver(request); acknowledge() }).toThrow('disk full')
  expect(notify).not.toHaveBeenCalled(); expect(acknowledge).not.toHaveBeenCalled()
  const receipt = service.deliver(request)
  expect(receipt).toMatchObject({ persisted: true, keys: ['reminder-receipt:rest:1'] })
  acknowledge(receipt)
  expect(notify).toHaveBeenCalledOnce()
})

it('retries only the unread notification after a broadcast failure, without rewriting the message', () => {
  const persist = vi.fn().mockReturnValue({ workspace: {}, disposition: 'delivered' })
  const notify = vi.fn().mockImplementationOnce(() => { throw new Error('renderer gone') })
  const service = new MessageDeliveryService({ persist, notify })
  expect(service.deliver(request).persisted).toBe(true)
  expect(service.notificationError).toBe('renderer gone')
  expect(service.retryNotifications()).toBe(true)
  expect(service.notificationError).toBeUndefined()
  expect(persist).toHaveBeenCalledOnce()
  expect(notify).toHaveBeenCalledTimes(2)
})
