import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { AgentSettings, AgentRun, AgentOverview, AgentMemory, AgentReport, AgentRunDetail, AgentRunStatus } from '../../shared/agents'
import { DEFAULT_AGENT_SETTINGS, validateAgentSettings } from '../../shared/agents'
import { containsSecret } from '../../shared/memory'

type Profile = { character_id: string; settings: string; revision: number; next_at: number; failures: number }
type RunRow = { id: string; character_id: string; revision: number; status: AgentRunStatus; created_at: number; updated_at: number; question: string; answer: string; summary: string; error: string; input: string }
const mapRun = (row: RunRow): AgentRun => ({ id: row.id, characterId: row.character_id, revision: row.revision, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, question: row.question, answer: row.answer, summary: row.summary, error: row.error })
const dayStart = (now: number) => { const date = new Date(now); date.setHours(0, 0, 0, 0); return date.getTime() }

export class AgentStore {
  readonly db: Database.Database
  constructor(filename: string) {
    this.db = new Database(filename)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version > 1) { this.db.close(); throw new Error('Agent 数据版本较新，请升级应用。') }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (character_id TEXT PRIMARY KEY, settings TEXT NOT NULL, revision INTEGER NOT NULL, next_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, revision INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, question TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', input TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS runs_character ON runs(character_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, kind TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS calls_character_time ON calls(character_id, at);
      CREATE TABLE IF NOT EXISTS reports (run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, content TEXT NOT NULL, run_id TEXT, created_at INTEGER NOT NULL, UNIQUE(character_id, content));
      PRAGMA user_version=1;
    `)
  }
  close() { this.db.close() }
  profile(id: string) { return this.db.prepare('SELECT * FROM profiles WHERE character_id=?').get(id) as Profile | undefined }
  profiles() { return this.db.prepare('SELECT * FROM profiles ORDER BY next_at').all() as Profile[] }
  ensure(id: string) { this.db.prepare('INSERT OR IGNORE INTO profiles(character_id,settings,revision,next_at) VALUES(?,?,1,0)').run(id, JSON.stringify(DEFAULT_AGENT_SETTINGS)) }
  save(id: string, raw: unknown, now = Date.now()) {
    const settings = validateAgentSettings(raw)
    this.ensure(id)
    this.db.transaction(() => {
      this.cancel(id, '工作方向或设置已更改。', now)
      this.db.prepare('UPDATE profiles SET settings=?,revision=revision+1,next_at=?,failures=0 WHERE character_id=?').run(JSON.stringify(settings), now, id)
    })()
    return this.overview(id, now)
  }
  pause(id: string) {
    this.ensure(id)
    const settings = { ...JSON.parse(this.profile(id)!.settings), enabled: false }
    this.db.transaction(() => {
      this.cancel(id, '用户暂停了持续工作。')
      this.db.prepare('UPDATE profiles SET settings=?,revision=revision+1 WHERE character_id=?').run(JSON.stringify(settings), id)
    })()
    return this.overview(id)
  }
  cancel(id: string, reason: string, now = Date.now()) {
    const rows = this.db.prepare("SELECT * FROM runs WHERE character_id=? AND status IN ('queued','running','waiting','interrupted')").all(id) as RunRow[]
    for (const row of rows) { this.setStatus(row.id, 'cancelled', now); this.event(row.id, 'cancelled', reason, now) }
  }
  remove(id: string) { const runs = (this.db.prepare('SELECT id FROM runs WHERE character_id=?').all(id) as { id: string }[]).map(r => r.id); this.db.prepare('DELETE FROM profiles WHERE character_id=?').run(id); return runs }
  overview(id: string, now = Date.now()): AgentOverview {
    const profile = this.profile(id)
    return {
      settings: profile ? JSON.parse(profile.settings) : { ...DEFAULT_AGENT_SETTINGS }, revision: profile?.revision ?? 0, nextAt: profile?.next_at ?? 0,
      callsToday: this.callCount(id, now),
      runs: (this.db.prepare('SELECT * FROM runs WHERE character_id=? ORDER BY created_at DESC, rowid DESC LIMIT 30').all(id) as RunRow[]).map(mapRun),
      memories: this.memories(id), reports: (this.db.prepare('SELECT value FROM reports WHERE character_id=? ORDER BY rowid DESC LIMIT 20').all(id) as { value: string }[]).map(r => JSON.parse(r.value))
    }
  }
  memories(id: string): AgentMemory[] {
    return (this.db.prepare('SELECT * FROM memories WHERE character_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(id) as { id: string; content: string; run_id: string | null; created_at: number }[]).map(r => ({ id: r.id, content: r.content, runId: r.run_id, createdAt: r.created_at }))
  }
  remember(id: string, text: string, runId: string | null = null) {
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('记忆内容应为 1–2000 字。')
    if (containsSecret(text)) throw new Error('请勿将密码、密钥等敏感凭据写入记忆。')
    this.ensure(id)
    const count = (this.db.prepare('SELECT count(*) AS n FROM memories WHERE character_id=?').get(id) as { n: number }).n
    if (count >= 100 && !this.db.prepare('SELECT id FROM memories WHERE character_id=? AND content=?').get(id, text.trim())) throw new Error('独立记忆已达 100 条，请先整理。')
    this.db.prepare('INSERT OR IGNORE INTO memories(id,character_id,content,run_id,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), id, text.trim(), runId, Date.now())
  }
  forget(id: string, memoryId: string) { this.db.prepare('DELETE FROM memories WHERE character_id=? AND id=?').run(id, memoryId) }
  callCount(id: string, now = Date.now()) { return (this.db.prepare('SELECT count(*) AS n FROM calls WHERE character_id=? AND at>=?').get(id, dayStart(now)) as { n: number }).n }
  getRun(id: string) { return this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as RunRow | undefined }
  detail(characterId: string, runId: string): AgentRunDetail {
    const run = this.getRun(runId)
    if (!run || run.character_id !== characterId) throw new Error('找不到此联系人的工作记录。')
    const report = this.db.prepare('SELECT value FROM reports WHERE run_id=? AND character_id=?').get(runId, characterId) as { value: string } | undefined
    return { run: mapRun(run), events: (this.db.prepare('SELECT * FROM events WHERE run_id=? ORDER BY id LIMIT 200').all(runId) as { id: number; run_id: string; kind: string; text: string; at: number }[]).map(r => ({ id: r.id, runId: r.run_id, kind: r.kind, text: r.text, at: r.at })), report: report ? JSON.parse(report.value) : null }
  }
  event(runId: string, kind: string, text: string, now = Date.now()) { this.db.prepare('INSERT INTO events(run_id,kind,text,at) VALUES(?,?,?,?)').run(runId, kind, text.slice(0, 6000), now) }
  createRun(id: string, context: string, now = Date.now()) {
    return this.db.transaction(() => {
      const profile = this.profile(id)
      if (!profile) throw new Error('请先设置工作方向与资料来源。')
      const settings = JSON.parse(profile.settings) as AgentSettings
      validateAgentSettings(settings)
      const existing = this.db.prepare("SELECT * FROM runs WHERE character_id=? AND status IN ('queued','running','waiting','interrupted') LIMIT 1").get(id) as RunRow | undefined
      if (existing) return existing.id
      if (this.callCount(id, now) >= settings.dailyCalls) throw new Error('今日模型调用已达上限，明天再试或调整上限。')
      const runId = randomUUID()
      const overview = this.overview(id, now)
      const input = JSON.stringify({ settings, memories: overview.memories.slice(0, 12).map(m => ({ ...m, content: m.content.slice(0, 600) })), previous: overview.reports.slice(0, 3).map(r => ({ title: r.title, body: r.body.slice(0, 2000), nextStep: r.nextStep })), conversation: context.slice(0, 4000) })
      this.db.prepare('INSERT INTO runs(id,character_id,revision,status,created_at,updated_at,input) VALUES(?,?,?,\'queued\',?,?,?)').run(runId, id, profile.revision, now, now, input)
      this.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=?').run(now + settings.intervalMinutes * 60000, id)
      this.event(runId, 'queued', '已安排本轮工作。', now)
      return runId
    })()
  }
  assertLive(runId: string) {
    const run = this.getRun(runId)
    const profile = run && this.profile(run.character_id)
    if (!run || !profile || run.revision !== profile.revision || !['running', 'queued', 'interrupted', 'waiting'].includes(run.status)) throw new Error('本轮工作已取消或角色已删除。')
    return run
  }
  charge(runId: string, now = Date.now()) {
    this.db.transaction(() => {
      const run = this.assertLive(runId), settings = JSON.parse(this.profile(run.character_id)!.settings) as AgentSettings
      if (this.callCount(run.character_id, now) >= settings.dailyCalls) throw new Error('今日模型调用已达上限。')
      this.db.prepare('INSERT INTO calls(character_id,run_id,at) VALUES(?,?,?)').run(run.character_id, runId, now)
    })()
  }
  setStatus(id: string, status: AgentRunStatus, now = Date.now()) { this.db.prepare('UPDATE runs SET status=?,updated_at=? WHERE id=?').run(status, now, id) }
  recover() {
    const rows = this.db.prepare("SELECT id FROM runs WHERE status='running'").all() as { id: string }[]
    for (const row of rows) { this.setStatus(row.id, 'interrupted'); this.event(row.id, 'interrupted', '执行进程已重启，将从持久化检查点恢复；未完成的只读步骤可能重试。') }
  }
  runnable() { return this.db.prepare("SELECT * FROM runs WHERE status IN ('queued','interrupted') ORDER BY created_at").all() as RunRow[] }
  wait(id: string, question: string) { this.db.prepare("UPDATE runs SET status='waiting',question=?,updated_at=? WHERE id=?").run(question, Date.now(), id); this.event(id, 'waiting', question) }
  answer(characterId: string, id: string, text: string) {
    const { run } = this.detail(characterId, id)
    if (run.status !== 'waiting') throw new Error('这项工作已不在等待回复。')
    if (typeof text !== 'string' || !text.trim() || text.length > 2000 || containsSecret(text)) throw new Error('请填写 1–2000 字的回复，不要包含密钥。')
    this.assertLive(id)
    this.db.prepare("UPDATE runs SET status='queued',answer=?,updated_at=? WHERE id=?").run(text.trim(), Date.now(), id)
    this.event(id, 'answer', text.trim())
  }
  fail(id: string, error: string) {
    const run = this.getRun(id)
    if (!run || ['cancelled', 'completed'].includes(run.status)) return
    this.db.prepare("UPDATE runs SET status='failed',error=?,updated_at=? WHERE id=?").run(error.slice(0, 600), Date.now(), id)
    this.event(id, 'failed', error)
    const profile = this.profile(run.character_id)!
    const settings = JSON.parse(profile.settings) as AgentSettings
    if (profile.failures >= 2) settings.enabled = false
    this.db.prepare('UPDATE profiles SET failures=failures+1,settings=?,next_at=? WHERE character_id=?').run(JSON.stringify(settings), Date.now() + Math.max(settings.intervalMinutes * 60000, 15 * 60000), run.character_id)
  }
  finish(runId: string, report: AgentReport, memories: string[]) {
    this.db.transaction(() => {
      if (this.getRun(runId)?.status === 'completed') return
      const run = this.assertLive(runId)
      this.db.prepare('INSERT OR IGNORE INTO reports(run_id,character_id,value) VALUES(?,?,?)').run(runId, run.character_id, JSON.stringify(report))
      for (const memory of memories.slice(0, 3)) {
        // A full library must not lose the report; record the reason explicitly.
        try { this.remember(run.character_id, memory, runId) } catch { this.event(runId, 'memory-skipped', '一条记忆未保存：内容含敏感信息或记忆库已满；成果仍保留。') }
      }
      this.db.prepare("UPDATE runs SET status='completed',summary=?,updated_at=? WHERE id=?").run(report.title, Date.now(), runId)
      this.db.prepare('UPDATE profiles SET failures=0 WHERE character_id=?').run(run.character_id)
      this.event(runId, 'completed', report.nextStep || '本轮工作完成。')
    })()
  }
}
