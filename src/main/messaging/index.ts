import { notifyReminderChanges } from '../reminder-events'
import { MessageDeliveryService } from './service'
import { persistDelivery } from './repository'
import type { DeliveryRequest } from './contracts'

const service = new MessageDeliveryService({ persist: persistDelivery, notify: notifyReminderChanges })
let retryTimer: ReturnType<typeof setTimeout> | undefined
function scheduleNotificationRetry() {
  if (retryTimer || !service.notificationError) return
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    if (!service.retryNotifications()) scheduleNotificationRetry()
  }, 1000)
  retryTimer.unref()
}
export function deliverMessage(request: DeliveryRequest) {
  const receipt = service.deliver(request)
  scheduleNotificationRetry()
  return receipt
}
