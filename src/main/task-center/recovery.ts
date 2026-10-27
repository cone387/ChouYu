import type Database from 'better-sqlite3'
import type { ContactRecoveryIdentity } from '../../shared/contact-recovery'

type Original = { runs: string[]; notices: string[]; interactions: string[]; baseline?: { day: string; calls: number; tokens: number; tasks: Record<string, { calls: number; tokens: number }> } }
/** Immutable restored IDs; authorization always comes from the application identity. */
export class ContactStoreRecovery {
  private identities = new Map<string, ContactRecoveryIdentity>()
  private roster?: Set<string>
  constructor(private db: Database.Database) {
    db.exec('CREATE TABLE IF NOT EXISTS contact_recovery_state(owner TEXT PRIMARY KEY,restore_id TEXT NOT NULL,value TEXT NOT NULL)')
    db.exec('CREATE TABLE IF NOT EXISTS contact_recovery_attempts(restore_id TEXT NOT NULL,request_id TEXT NOT NULL,owner TEXT NOT NULL,topic_id TEXT NOT NULL,run_id TEXT NOT NULL,PRIMARY KEY(restore_id,request_id))')
  }
  sync(owner: string, identity?: ContactRecoveryIdentity) {
    const previous = this.db.prepare('SELECT restore_id,value FROM contact_recovery_state WHERE owner=?').get(owner) as { restore_id: string; value: string } | undefined
    if (!identity) {
      if (previous) throw new Error('缺少应用库中的恢复保护，联系人保持停止。')
      return
    }
    if (previous?.restore_id !== identity.restoreId) this.db.transaction(() => {
      const ids = (table: string, ownerColumn = 'character_id') => (this.db.prepare('SELECT id FROM ' + table + ' WHERE ' + ownerColumn + '=?').all(owner) as { id: string }[]).map(row => row.id)
      const original: Original = { runs: ids('runs'), notices: ids('notices'), interactions: ids('contact_interactions') }
      const date = new Date(), start = new Date(date); start.setHours(0, 0, 0, 0)
      const count = (sql: string, ...args: (string | number)[]) => (this.db.prepare(sql).get(...args) as { n: number }).n
      const topics = ids('topics')
      // A backup cannot prove how many periods completed after its snapshot.
      this.db.prepare("UPDATE topics SET value=json_set(value,'$.ending.historyUnknown',json('true')) WHERE character_id=? AND json_type(value,'$.ending.count')='object'").run(owner)
      original.baseline = { day: [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-'),
        calls: count("SELECT count(*) AS n FROM daily_consumption WHERE kind='model' AND character_id=? AND at>=?", owner, start.getTime()),
        tokens: count('SELECT COALESCE(sum(tokens),0) AS n FROM token_ledger WHERE character_id=? AND at>=?', owner, start.getTime()),
        tasks: Object.fromEntries(topics.map(topicId => [topicId, {
          calls: count('SELECT count(*) AS n FROM calls JOIN runs ON calls.run_id=runs.id WHERE runs.topic_id=?', topicId),
          tokens: count('SELECT COALESCE(sum(tokens),0) AS n FROM token_ledger WHERE topic_id=?', topicId)
        }])) }
      this.db.prepare('INSERT OR REPLACE INTO contact_recovery_state VALUES(?,?,?)').run(owner, identity.restoreId, JSON.stringify(original))
      this.db.prepare("UPDATE runs SET status='failed',error='备份恢复后需要核对；原尝试不会重放，请从已核对的正式成果开始新的尝试。' WHERE character_id=? AND status NOT IN ('completed','failed')").run(owner)
    })()
    this.identities.set(owner, structuredClone(identity))
  }
  identity(owner: string) { return this.identities.get(owner) }
  setRoster(owners: string[]) { this.roster = new Set(owners) }
  present(owner: string) { return !this.roster || this.roster.has(owner) }
  allowed(owner: string, topicId?: string | null) {
    const identity = this.identity(owner)
    return !identity || identity.scopeReviewed && Boolean(topicId && identity.allowedTopics.includes(topicId))
  }
  assertSources(owner: string) {
    if (!this.present(owner)) throw new Error('联系人已删除，资料不再共享。')
    if (this.identity(owner) && !this.identity(owner)!.scopeReviewed) throw new Error('恢复后的资料与共享权限尚待核对。')
  }
  original(owner: string): Original {
    const row = this.db.prepare('SELECT value FROM contact_recovery_state WHERE owner=?').get(owner) as { value: string } | undefined
    return row ? JSON.parse(row.value) : { runs: [], notices: [], interactions: [] }
  }
  oldRun(owner: string, runId: string) { return this.original(owner).runs.includes(runId) }
  assertRun(owner: string, topicId: string | null, runId: string) {
    if (!this.allowed(owner, topicId) || this.oldRun(owner, runId)) throw new Error('恢复后的任务需要核对，不能继续原尝试或未授权工作。')
  }
  limits(owner: string, topicId?: string | null) {
    const recovery = this.identity(owner)
    if (!recovery) return
    const baseline = this.original(owner).baseline, extra = recovery.additional
    return {
      dailyCalls: (baseline?.day === extra?.day ? baseline?.calls ?? 0 : 0) + (extra?.daily.calls ?? 0),
      dailyTokens: (baseline?.day === extra?.day ? baseline?.tokens ?? 0 : 0) + (extra?.daily.tokens ?? 0),
      taskCalls: (baseline?.tasks[topicId ?? '']?.calls ?? 0) + (extra?.tasks[topicId ?? '']?.calls ?? 0),
      taskTokens: (baseline?.tasks[topicId ?? '']?.tokens ?? 0) + (extra?.tasks[topicId ?? '']?.tokens ?? 0)
    }
  }
  start(owner: string, topicId: string, restoreId: string, requestId: string, create: () => string) {
    if (this.identity(owner)?.restoreId !== restoreId || !this.allowed(owner, topicId) || !requestId || requestId.length > 256) throw new Error('任务恢复授权无效。')
    return this.db.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM contact_recovery_attempts WHERE restore_id=? AND request_id=?').get(restoreId, requestId) as { owner: string; topic_id: string; run_id: string } | undefined
      if (previous) {
        if (previous.owner !== owner || previous.topic_id !== topicId) throw new Error('恢复请求归属冲突。')
        return previous.run_id
      }
      const runId = create()
      this.db.prepare('INSERT INTO contact_recovery_attempts VALUES(?,?,?,?,?)').run(restoreId, requestId, owner, topicId, runId)
      return runId
    })()
  }
}
