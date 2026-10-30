import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { dashboardDays, type DashboardRange } from '../../shared/dashboard'
import type { AIResponseMetadata } from '../../shared/ai-usage'
import type { AppUsageStatistics } from '../../shared/usage'

const valid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
function total(metadata: AIResponseMetadata): number | null {
  const usage = metadata.usage
  if (valid(usage?.totalTokens)) return usage.totalTokens
  if (valid(usage?.inputTokens) && valid(usage?.outputTokens) && valid(usage.inputTokens + usage.outputTokens)) return usage.inputTokens + usage.outputTokens
  return null
}
type Aggregate = { calls: number; reported: number; tokens: number | null }
const aggregateSQL = 'COUNT(*) AS calls, COUNT(tokens) AS reported, SUM(tokens) AS tokens'
const normalize = (row: Aggregate): Aggregate => ({ ...row, tokens: row.calls === 0 ? 0 : row.tokens })

/** One row per provider dispatch. No prompts, responses, endpoints or credentials. */
export class UsageStore {
  private db: Database.Database
  private incomplete = false
  constructor(directory: string, now = Date.now()) {
    mkdirSync(directory, { recursive: true })
    this.db = new Database(join(directory, 'app-usage.sqlite'))
    try {
      this.db.pragma('busy_timeout = 5000')
      this.db.pragma('journal_mode = WAL')
      this.db.exec(`CREATE TABLE IF NOT EXISTS usage_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS usage_calls (id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, model TEXT NOT NULL, tokens INTEGER);
        CREATE INDEX IF NOT EXISTS usage_calls_started ON usage_calls(started_at);`)
      this.db.prepare("INSERT OR IGNORE INTO usage_meta(key,value) VALUES('tracking_since',?)").run(now)
    } catch (error) { this.db.close(); throw error }
  }
  begin(id: string, model: string, now = Date.now()): void {
    this.db.prepare('INSERT OR IGNORE INTO usage_calls(id,started_at,model,tokens) VALUES(?,?,?,NULL)').run(id, now, model || 'unknown')
  }
  update(id: string, metadata: AIResponseMetadata): void {
    this.db.prepare('UPDATE usage_calls SET model=COALESCE(?,model),tokens=COALESCE(?,tokens) WHERE id=?')
      .run(metadata.model?.trim() || null, total(metadata), id)
  }
  markCollectionIssue(): void {
    this.incomplete = true
    this.db.prepare("INSERT OR IGNORE INTO usage_meta(key,value) VALUES('collection_gap',?)").run(Date.now())
  }
  statistics(range: DashboardRange, now = Date.now()): AppUsageStatistics {
    const days = dashboardDays(range, now)
    return this.db.transaction(() => {
      const query = this.db.prepare(`SELECT ${aggregateSQL} FROM usage_calls WHERE started_at >= ? AND started_at < ?`)
      const from = days[0].from, to = Math.min(days.at(-1)!.to, now + 1)
      const summary = normalize(query.get(from, to) as Aggregate)
      const models = (this.db.prepare(`SELECT model, ${aggregateSQL} FROM usage_calls WHERE started_at >= ? AND started_at < ? GROUP BY model ORDER BY tokens DESC,model`).all(from, to) as (Aggregate & { model: string })[])
      const trackingSince = (this.db.prepare("SELECT value FROM usage_meta WHERE key='tracking_since'").get() as { value: number }).value
      const incomplete = this.incomplete || Boolean(this.db.prepare("SELECT 1 FROM usage_meta WHERE key='collection_gap'").get())
      return { trackingSince, ...(incomplete ? { collectionIssue: '部分调用用量未能保存，统计可能不完整。' } : {}), ...summary, days: days.map(day => ({ date: day.date, ...normalize(query.get(day.from, Math.min(day.to, now + 1)) as Aggregate) })), models }
    })()
  }
  close(): void { if (this.db.open) this.db.close() }
}
