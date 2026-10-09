import type Database from 'better-sqlite3'
import type { AIResponseMetadata } from '../../shared/ai-usage'
import type { AgentSettings } from '../../shared/agents'

export class TokenBudgetError extends Error {}
const dayStart = (now: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() }
const reported = (metadata: AIResponseMetadata) => {
  const u = metadata.usage
  if (!u) return undefined
  const n = u.totalTokens ?? (u.inputTokens !== undefined && u.outputTokens !== undefined ? u.inputTokens + u.outputTokens : undefined)
  return Number.isSafeInteger(n) && n! >= 0 ? n : undefined
}

/** Independent ledger: deleting a task must not refund today's consumption. */
export class AgentTokenBudget {
  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS token_ledger (
      id TEXT PRIMARY KEY, character_id TEXT NOT NULL, topic_id TEXT, at INTEGER NOT NULL,
      tokens INTEGER NOT NULL, estimated INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS token_ledger_contact ON token_ledger(character_id,at);
      CREATE INDEX IF NOT EXISTS token_ledger_topic ON token_ledger(character_id,topic_id);
      CREATE TABLE IF NOT EXISTS token_blocks (run_id TEXT PRIMARY KEY, needed INTEGER NOT NULL, message TEXT NOT NULL DEFAULT '');`)
    if (!(db.pragma('table_info(token_blocks)') as { name: string }[]).some(c => c.name === 'message')) db.exec("ALTER TABLE token_blocks ADD COLUMN message TEXT NOT NULL DEFAULT ''")
  }
  importHistory() {
    const rows = this.db.prepare('SELECT c.*,r.topic_id FROM calls c JOIN runs r ON r.id=c.run_id').all() as { id: number; run_id: string; character_id: string; topic_id: string | null; at: number; metadata: string | null }[]
    const insert = this.db.prepare('INSERT OR IGNORE INTO token_ledger VALUES(?,?,?,?,?,?)')
    for (const row of rows) {
      const amount = reported(row.metadata ? JSON.parse(row.metadata) : {})
      // Unknown legacy requests have no recoverable prompt. Use an explicit conservative estimate.
      insert.run(`${row.run_id}:${row.id}`, row.character_id, row.topic_id, row.at, amount ?? 32768, amount === undefined ? 1 : 0)
    }
  }
  usage(id: string, now = Date.now()) {
    const tomorrow = new Date(now); tomorrow.setHours(24, 0, 0, 0)
    const today = this.db.prepare('SELECT COALESCE(SUM(tokens),0) AS today,COALESCE(SUM(estimated),0) AS estimated FROM token_ledger WHERE character_id=? AND at>=? AND at<?').get(id, dayStart(now), tomorrow.getTime()) as { today: number; estimated: number }
    const rows = this.db.prepare('SELECT topic_id,SUM(tokens) AS tokens FROM token_ledger WHERE character_id=? AND topic_id IS NOT NULL GROUP BY topic_id').all(id) as { topic_id: string; tokens: number }[]
    return { ...today, tasks: Object.fromEntries(rows.map(r => [r.topic_id, r.tokens])) }
  }
  private remaining(id: string, topicId: string | null, now: number) {
    const profile = this.db.prepare('SELECT settings FROM profiles WHERE character_id=?').get(id) as { settings: string }
    const settings = JSON.parse(profile.settings) as AgentSettings
    const row = topicId && this.db.prepare('SELECT value FROM topics WHERE character_id=? AND id=?').get(id, topicId) as { value: string } | undefined
    const taskLimit = row ? JSON.parse(row.value).tokenLimit as number | undefined : undefined
    const usage = this.usage(id, now)
    return { dailyLimit: settings.dailyTokenLimit ?? Infinity, daily: settings.dailyTokenLimit === undefined ? Infinity : settings.dailyTokenLimit - usage.today,
      task: taskLimit === undefined ? Infinity : taskLimit - (usage.tasks[topicId!] ?? 0) }
  }
  canResume(runId: string, id: string, topicId: string | null, now = Date.now()) {
    const block = this.db.prepare('SELECT needed FROM token_blocks WHERE run_id=?').get(runId) as { needed: number } | undefined
    if (!block) return true
    const left = this.remaining(id, topicId, now)
    return Math.min(left.daily, left.task) >= block.needed
  }
  reserve(runId: string, callId: number, id: string, topicId: string | null, input: string, outputLimit: number, now = Date.now()) {
    return this.db.transaction(() => {
      // UTF-8 bytes plus protocol overhead deliberately overestimate ordinary text tokenization.
      const inputEstimate = Buffer.byteLength(input, 'utf8') + 512
      const needed = inputEstimate + Math.min(512, outputLimit)
      const left = this.remaining(id, topicId, now)
      if (left.daily < needed || left.task < needed) {
        const error = left.task < needed ? '本任务累计 Token 额度不足，请在任务描述中调整上限后继续。' : left.dailyLimit < needed ? `每日工作 Token 上限不足本次请求（保守预估至少 ${needed.toLocaleString()}），次日也无法执行，请提高联系人上限。` : `今日工作 Token 剩余额度不足本次请求（保守预估至少 ${needed.toLocaleString()}），请调整联系人上限或等待次日恢复。`
        this.db.prepare('INSERT OR REPLACE INTO token_blocks VALUES(?,?,?)').run(runId, needed, error)
        return { error }
      }
      const maxOutputTokens = Math.floor(Math.min(outputLimit, left.daily - inputEstimate, left.task - inputEstimate))
      const key = `${runId}:${callId}`
      this.db.prepare('INSERT INTO token_ledger VALUES(?,?,?,?,?,1)').run(key, id, topicId, now, inputEstimate + maxOutputTokens)
      this.db.prepare('DELETE FROM token_blocks WHERE run_id=?').run(runId)
      this.db.prepare("UPDATE runs SET error='' WHERE id=?").run(runId)
      return { key, maxOutputTokens }
    })()
  }
  settle(key: string, metadata: AIResponseMetadata) {
    const actual = reported(metadata)
    if (actual !== undefined && metadata.finishReason) this.db.prepare('UPDATE token_ledger SET tokens=?,estimated=0 WHERE id=?').run(actual, key)
    else if (actual !== undefined) this.db.prepare('UPDATE token_ledger SET tokens=MAX(tokens,?),estimated=1 WHERE id=?').run(actual, key)
    // No usage/failed stream: retain the reservation, including across process restarts.
  }
}
