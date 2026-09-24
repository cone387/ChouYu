import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { AgentSettings, AgentRun, AgentOverview, AgentMemory, AgentReport, AgentRunDetail, AgentRunStatus, AgentTopicProgress, AgentTopicStatus } from '../../shared/agents'
import { agentUsesPlanner, DEFAULT_AGENT_SETTINGS, validateAgentSettings } from '../../shared/agents'
import { containsSecret } from '../../shared/memory'
import { AgentTopics, canResearch } from './topics'
import { AgentNotices } from './notices'
import type { AgentResearch } from '../../shared/agents'

type Profile = { character_id: string; settings: string; revision: number; next_at: number; failures: number; focus_topic_id: string | null }
type RunRow = { id: string; character_id: string; revision: number; status: AgentRunStatus; created_at: number; updated_at: number; question: string; answer: string; summary: string; error: string; input: string; topic_id: string | null; topic_revision: number | null }
const mapRun = (row: RunRow): AgentRun => ({ id: row.id, characterId: row.character_id, revision: row.revision, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, question: row.question, answer: row.answer, summary: row.summary, error: row.error, topicId: row.topic_id })
const dayStart = (now: number) => { const date = new Date(now); date.setHours(0, 0, 0, 0); return date.getTime() }

export class AgentStore {
  readonly db: Database.Database
  readonly topics: AgentTopics
  readonly notices: AgentNotices
  constructor(filename: string) {
    this.db = new Database(filename)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version > 4) { this.db.close(); throw new Error('Agent 数据版本较新，请升级应用。') }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (character_id TEXT PRIMARY KEY, settings TEXT NOT NULL, revision INTEGER NOT NULL, next_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, revision INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, question TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', input TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS runs_character ON runs(character_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, kind TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS calls_character_time ON calls(character_id, at);
      CREATE TABLE IF NOT EXISTS reports (run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, content TEXT NOT NULL, run_id TEXT, created_at INTEGER NOT NULL, UNIQUE(character_id, content));
    `)
    this.topics = new AgentTopics(this.db)
    if (version < 2) this.db.transaction(() => {
      this.db.exec(`
        ALTER TABLE profiles ADD COLUMN focus_topic_id TEXT;
        ALTER TABLE runs ADD COLUMN topic_id TEXT;
        ALTER TABLE runs ADD COLUMN topic_revision INTEGER;
        CREATE TABLE topics (id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, value TEXT NOT NULL);
        CREATE INDEX topics_character ON topics(character_id);
        CREATE INDEX runs_topic ON runs(topic_id, created_at DESC);
        CREATE TABLE topic_changes (id INTEGER PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE, kind TEXT NOT NULL, before_value TEXT, after_value TEXT NOT NULL, reason TEXT NOT NULL, run_id TEXT REFERENCES runs(id) ON DELETE CASCADE, created_at INTEGER NOT NULL);
        CREATE INDEX changes_topic ON topic_changes(topic_id,id DESC);
        CREATE UNIQUE INDEX changes_run ON topic_changes(run_id) WHERE run_id IS NOT NULL;
      `)
      for (const profile of this.profiles()) {
        const settings = JSON.parse(profile.settings) as AgentSettings
        if (settings.goal.trim()) {
          const topic = this.topics.create(profile.character_id, { title: settings.goal.slice(0, 160), goal: settings.goal, constraints: '' }, '由升级前的工作方向建立；旧报告保留在工作记录中，未推断其事项归属。')
          this.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(topic.id, profile.character_id)
        }
      }
      this.db.pragma('user_version = 2')
    })()
    this.notices = new AgentNotices(this.db)
    this.db.exec(`CREATE TABLE IF NOT EXISTS search_calls (id INTEGER PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS search_calls_character ON search_calls(character_id,at);
      CREATE TABLE IF NOT EXISTS research (run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS research_idle (topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,streak INTEGER NOT NULL);`)
    this.db.pragma('user_version = 4')
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
      if (!this.topics.list(id).length) {
        const topic = this.topics.create(id, { title: settings.goal.slice(0, 160), goal: settings.goal, constraints: '' }, '由首次保存的工作方向建立。', now)
        this.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(topic.id, id)
      }
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
      searchesToday: this.searchCount(id, now),
      topics: this.topics.list(id), focusTopicId: profile?.focus_topic_id ?? null,
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
    return { run: mapRun(run), research: this.research(runId), events: (this.db.prepare('SELECT * FROM events WHERE run_id=? ORDER BY id LIMIT 200').all(runId) as { id: number; run_id: string; kind: string; text: string; at: number }[]).map(r => ({ id: r.id, runId: r.run_id, kind: r.kind, text: r.text, at: r.at })), report: report ? JSON.parse(report.value) : null }
  }
  event(runId: string, kind: string, text: string, now = Date.now()) { this.db.prepare('INSERT INTO events(run_id,kind,text,at) VALUES(?,?,?,?)').run(runId, kind, text.slice(0, 6000), now) }
  createRun(id: string, context: string, now = Date.now(), topicId?: string) {
    return this.db.transaction(() => {
      const profile = this.profile(id)
      if (!profile) throw new Error('请先设置工作方向。')
      const settings = JSON.parse(profile.settings) as AgentSettings
      validateAgentSettings(settings)
      const existing = this.db.prepare("SELECT * FROM runs WHERE character_id=? AND status IN ('queued','running','waiting','interrupted') LIMIT 1").get(id) as RunRow | undefined
      if (existing) {
        if (topicId && topicId !== existing.topic_id) throw new Error('联系人已有一轮工作未完成，请先等待或暂停它。')
        return existing.id
      }
      const selected = topicId ?? profile.focus_topic_id
      if (!selected) throw new Error('请先选择一个要持续推进的事项。')
      const topic = this.topics.get(id, selected)
      if (!canResearch(topic.status)) throw new Error('当前事项已暂停或结束，请继续此事项或选择其他事项。')
      if (this.callCount(id, now) >= settings.dailyCalls) throw new Error('今日模型调用已达上限，明天再试或调整上限。')
      if (agentUsesPlanner(settings) && this.callCount(id, now) + 2 > settings.dailyCalls) throw new Error('自主补证据需预留两次模型调用额度（计划与分析）。')
      const runId = randomUUID()
      const overview = this.overview(id, now)
      const previous = (this.db.prepare('SELECT reports.value FROM reports JOIN runs ON runs.id=reports.run_id WHERE runs.topic_id=? AND runs.character_id=? ORDER BY reports.rowid DESC LIMIT 3').all(topic.id, id) as { value: string }[]).map(row => JSON.parse(row.value) as AgentReport)
      const baselineRun = this.db.prepare('SELECT topic_revision FROM runs WHERE id=?').get(previous[0]?.runId ?? '') as { topic_revision: number } | undefined
      const input = JSON.stringify({ researchVersion: 1, baseline: previous[0] ? { evidence: previous[0].evidence.map(e => ({ url: e.url, hash: e.hash })), topicRevision: (baselineRun?.topic_revision ?? -1) + 1 } : undefined, settings, topic, memories: overview.memories.slice(0, 12).map(m => ({ ...m, content: m.content.slice(0, 600) })), previous: previous.map(r => ({ title: r.title, body: r.body.slice(0, 2000), nextStep: r.nextStep })), conversation: context.slice(0, 4000) })
      this.db.prepare('INSERT INTO runs(id,character_id,revision,status,created_at,updated_at,input,topic_id,topic_revision) VALUES(?,?,?,\'queued\',?,?,?,?,?)').run(runId, id, profile.revision, now, now, input, topic.id, topic.revision)
      this.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=?').run(now + settings.intervalMinutes * 60000, id)
      this.event(runId, 'queued', `已安排事项「${topic.title}」的本轮工作。`, now)
      return runId
    })()
  }
  assertLive(runId: string) {
    const run = this.getRun(runId)
    const profile = run && this.profile(run.character_id)
    if (!run || !profile || run.revision !== profile.revision || !['running', 'queued', 'interrupted', 'waiting'].includes(run.status)) throw new Error('本轮工作已取消或角色已删除。')
    if (run.topic_id) {
      const topic = this.topics.check(run.character_id, run.topic_id, run.topic_revision!)
      if (!canResearch(topic.status)) throw new Error('此事项已暂停或结束。')
    }
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
  searchCount(id: string, now = Date.now()) { return (this.db.prepare('SELECT count(*) AS n FROM search_calls WHERE character_id=? AND at>=?').get(id, dayStart(now)) as { n: number }).n }
  chargeSearch(runId: string, now = Date.now()) {
    this.db.transaction(() => {
      const run = this.assertLive(runId), settings = JSON.parse(this.profile(run.character_id)!.settings) as AgentSettings
      if (!settings.searchEnabled || this.searchCount(run.character_id, now) >= (settings.dailySearches ?? 8)) throw new Error('搜索未开启或今日搜索已达上限。')
      this.db.prepare('INSERT INTO search_calls(character_id,run_id,at) VALUES(?,?,?)').run(run.character_id, runId, now)
    })()
  }
  research(runId: string): AgentResearch | undefined {
    const row = this.db.prepare('SELECT value FROM research WHERE run_id=?').get(runId) as { value: string } | undefined
    return row ? JSON.parse(row.value) : undefined
  }
  saveResearch(runId: string, research: AgentResearch) {
    this.assertLive(runId)
    this.db.prepare('INSERT INTO research(run_id,value) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET value=excluded.value').run(runId, JSON.stringify(research))
  }
  defer(runId: string, reason: string, unchanged = false) {
    this.db.transaction(() => {
      const run = this.assertLive(runId), settings = JSON.parse(this.profile(run.character_id)!.settings) as AgentSettings
      const research = this.research(runId)
      const streak = run.topic_id ? ((this.db.prepare('SELECT streak FROM research_idle WHERE topic_id=?').get(run.topic_id) as { streak: number } | undefined)?.streak ?? 0) : 0
      const delay = Math.min(10080, Math.max(settings.intervalMinutes, research?.plan.checkAfterMinutes ?? 0) * (unchanged ? 2 ** Math.min(streak + 1, 3) : 1))
      const nextAt = Date.now() + delay * 60000
      if (run.topic_id && unchanged) this.db.prepare('INSERT INTO research_idle VALUES(?,?) ON CONFLICT(topic_id) DO UPDATE SET streak=excluded.streak').run(run.topic_id, streak + 1)
      if (research) this.saveResearch(runId, { ...research, unchanged, nextCheckAt: nextAt })
      this.db.prepare('UPDATE profiles SET next_at=?,failures=0 WHERE character_id=?').run(nextAt, run.character_id)
      this.db.prepare("UPDATE runs SET status='completed',summary=?,updated_at=? WHERE id=?").run(reason, Date.now(), runId)
      this.event(runId, 'deferred', `${reason}\n本轮未生成新报告；下次检查：${new Date(nextAt).toISOString()}`)
    })()
  }
  recover() {
    const rows = this.db.prepare("SELECT id FROM runs WHERE status='running'").all() as { id: string }[]
    for (const row of rows) { this.setStatus(row.id, 'interrupted'); this.event(row.id, 'interrupted', '执行进程已重启，将从持久化检查点恢复；未完成的只读步骤可能重试。') }
  }
  runnable() { return this.db.prepare("SELECT * FROM runs WHERE status IN ('queued','interrupted') ORDER BY created_at").all() as RunRow[] }
  wait(id: string, question: string) {
    this.db.transaction(() => {
      const run = this.assertLive(id)
      this.db.prepare("UPDATE runs SET status='waiting',question=?,updated_at=? WHERE id=?").run(question, Date.now(), id)
      this.event(id, 'waiting', question)
      if (run.topic_id) {
        const topic = this.topics.get(run.character_id, run.topic_id)
        this.notices.enqueue({ id: `${id}:question`, characterId: run.character_id, topicId: topic.id, runId: id,
          topicRevision: topic.revision, kind: 'question', createdAt: Date.now(), content: `「${topic.title}」需要你确认：\n\n${question}\n\n你可以在这里回复，确认后我会接着处理。` })
      }
    })()
  }
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
  finish(runId: string, report: AgentReport, memories: string[], progress?: AgentTopicProgress) {
    this.db.transaction(() => {
      if (this.getRun(runId)?.status === 'completed') return
      const run = this.assertLive(runId)
      if (run.topic_id) {
        if (!progress) throw new Error('缺少事项进展，本轮不能提交。')
        const before = this.topics.get(run.character_id, run.topic_id)
        const previous = this.db.prepare('SELECT reports.value FROM reports JOIN runs ON runs.id=reports.run_id WHERE runs.topic_id=? AND runs.character_id=? ORDER BY reports.rowid DESC LIMIT 1').get(run.topic_id, run.character_id) as { value: string } | undefined
        this.topics.advance(run.character_id, run.topic_id, run.topic_revision!, progress, runId)
        this.notices.progress(before, this.topics.get(run.character_id, run.topic_id), report, previous ? JSON.parse(previous.value) : undefined)
      }
      this.db.prepare('INSERT OR IGNORE INTO reports(run_id,character_id,value) VALUES(?,?,?)').run(runId, run.character_id, JSON.stringify(report))
      for (const memory of memories.slice(0, 3)) {
        // A full library must not lose the report; record the reason explicitly.
        try { this.remember(run.character_id, memory, runId) } catch { this.event(runId, 'memory-skipped', '一条记忆未保存：内容含敏感信息或记忆库已满；成果仍保留。') }
      }
      this.db.prepare("UPDATE runs SET status='completed',summary=?,updated_at=? WHERE id=?").run(report.title, Date.now(), runId)
      this.db.prepare('UPDATE profiles SET failures=0 WHERE character_id=?').run(run.character_id)
      if (run.topic_id) this.db.prepare('DELETE FROM research_idle WHERE topic_id=?').run(run.topic_id)
      const research = this.research(runId)
      if (research) {
        const settings = JSON.parse(this.profile(run.character_id)!.settings) as AgentSettings
        const nextAt = Date.now() + Math.max(settings.intervalMinutes, research.plan.checkAfterMinutes) * 60000
        this.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=?').run(nextAt, run.character_id)
        this.db.prepare('UPDATE research SET value=? WHERE run_id=?').run(JSON.stringify({ ...research, nextCheckAt: nextAt }), runId)
      }
      this.event(runId, 'completed', report.nextStep || '本轮工作完成。')
    })()
  }
  createTopic(id: string, input: unknown) {
    this.ensure(id)
    return this.db.transaction(() => {
      const topic = this.topics.create(id, input)
      if (!this.profile(id)!.focus_topic_id) this.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(topic.id, id)
      return this.overview(id)
    })()
  }
  changeTopic(id: string, topicId: string, revision: number, change: { input: unknown; reason: string } | { status: AgentTopicStatus; reason: string }) {
    return this.db.transaction(() => {
      const topic = 'input' in change ? this.topics.edit(id, topicId, revision, change.input, change.reason) : this.topics.status(id, topicId, revision, change.status, change.reason)
      const rows = this.db.prepare("SELECT id FROM runs WHERE character_id=? AND topic_id=? AND status IN ('queued','running','waiting','interrupted')").all(id, topicId) as { id: string }[]
      for (const row of rows) { this.setStatus(row.id, 'cancelled'); this.event(row.id, 'cancelled', `事项已调整：${topic.reason}`) }
      return this.overview(id)
    })()
  }
  focusTopic(id: string, topicId: string) {
    const topic = this.topics.get(id, topicId)
    if (!canResearch(topic.status)) throw new Error('请先恢复此事项，再设为当前事项。')
    this.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(topicId, id)
    return this.overview(id)
  }
  continueTopic(id: string, topicId: string, revision: number, reason: string, conversation: string) {
    return this.db.transaction(() => {
      this.topics.check(id, topicId, revision)
      const active = this.db.prepare("SELECT status FROM runs WHERE character_id=? AND status IN ('queued','running','waiting','interrupted')").get(id) as { status: string } | undefined
      if (active) throw new Error(active.status === 'waiting' ? '请先回答当前待确认的问题。' : '联系人已有一轮工作未完成。')
      this.topics.status(id, topicId, revision, 'planned', reason)
      this.focusTopic(id, topicId)
      return this.createRun(id, conversation, Date.now(), topicId)
    })()
  }
}
