import { deliveryKeys, type DeliveryPorts, type DeliveryReceipt, type DeliveryRequest } from './contracts'

/** Receiver persistence is the acknowledgement boundary; notification is independently retryable. */
export class MessageDeliveryService {
  private pending = false
  private error?: string
  constructor(private ports: DeliveryPorts) {}
  get notificationError(): string | undefined { return this.error }
  deliver(request: DeliveryRequest): DeliveryReceipt {
    const keys = deliveryKeys(request)
    const result = this.ports.persist(request)
    this.pending = true
    this.retryNotifications()
    return { ...result, keys, persisted: true }
  }
  retryNotifications(): boolean {
    if (!this.pending) return true
    try {
      this.ports.notify()
      this.pending = false; this.error = undefined
      return true
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      return false
    }
  }
}
