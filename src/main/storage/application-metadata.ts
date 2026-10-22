import type Database from 'better-sqlite3'

export function isDeliveryReceipt(key: string) {
  return /^(reminder-receipt:|agent-notice:|contact-action:)/.test(key)
}
export class ApplicationMetadataRepository {
  constructor(private db: Database.Database) {}
  get<T = unknown>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key) as { value: string } | undefined
    return row ? JSON.parse(row.value) : null
  }
  set(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value').run(key, JSON.stringify(value))
  }
  getState(key: string): string | null {
    return (this.db.prepare(`SELECT value FROM ${isDeliveryReceipt(key) ? 'delivery_receipts' : 'state'} WHERE key=?`).get(key) as { value: string } | undefined)?.value ?? null
  }
  setState(key: string, value: string): void {
    this.db.prepare(`INSERT INTO ${isDeliveryReceipt(key) ? 'delivery_receipts' : 'state'} VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value`).run(key, value)
  }
  readState(): Record<string, string> {
    return Object.fromEntries((this.db.prepare('SELECT key,value FROM state UNION ALL SELECT key,value FROM delivery_receipts').all() as { key: string; value: string }[]).map(row => [row.key, row.value]))
  }
  saveState(state: Record<string, string>): void {
    for (const [key, value] of Object.entries(state)) this.setState(key, value)
    const existing = this.readState()
    for (const key of Object.keys(existing)) if (!(key in state)) this.db.prepare(`DELETE FROM ${isDeliveryReceipt(key) ? 'delivery_receipts' : 'state'} WHERE key=?`).run(key)
  }
}
