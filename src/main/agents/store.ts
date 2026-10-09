import { AgentTokenBudget } from './token-budget'
import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import type { AgentSettings, AgentRun, AgentOverview, AgentMemory, AgentReport, AgentRunDetail, AgentRunStatus, AgentTopicProgress, AgentTopicStatus } from '../../shared/agents'
import { agentUsesPlanner, DEFAULT_AGENT_SETTINGS, validateAgentSettings } from '../../shared/agents'
import { containsSecret } from '../../shared/memory'
import { validateTaskResourceBudget, type TaskResourceBudget } from '../../shared/agent-resources'
import { AgentTopics, canResearch } from './topics'
import { AgentNotices } from './notices'
import type { AgentResearch } from '../../shared/agents'
import { AgentDeliveries } from './delivery'
import { validateDeliveryPlan, type DeliveryPlan, type DeliveryUpdate } from '../../shared/agent-delivery'
import type { AIResponseMetadata } from '../../shared/ai-usage'
import type { AgentTopicMetrics } from '../../shared/agents'
import { readAnalytics } from './analytics'
import { workSettingsRequireRestart, withinWorkHours } from '../../shared/work-settings'
import type { AnalyticsQuery } from '../../shared/agent-analytics'

type Profile = { character_id: string; settings: string; revision: number; next_at: number; failures: number; focus_topic_id: string | null }
type RunRow = { id: string; character_id: string; revision: number; status: AgentRunStatus; created_at: number; updated_at: number; question: string; answer: string; summary: string; error: string; input: string; topic_id: string | null; topic_revision: number | null }
const mapRun = (row: RunRow): AgentRun => ({ id: row.id, characterId: row.character_id, revision: row.revision, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, question: row.question, answer: row.answer, summary: row.summary, error: row.error, topicId: row.topic_id, ...(JSON.parse(row.input).revisionScope === 'presentation' ? { revisionScope: 'presentation' as const } : {}), ...(row.status === 'waiting' && JSON.parse(row.input).questionInputs ? { inputFields: JSON.parse(row.input).questionInputs } : {}) })
const dayStart = (now: number) => { const date = new Date(now); date.setHours(0, 0, 0, 0); return date.getTime() }

const failureDelay = (settings: AgentSettings, failures: number) => settings.paceWriting
  ? Math.max(settings.intervalMinutes * 60000, 15 * 60000) : (failures === 1 ? 60000 : 180000)

export class AgentStore {
  readonly db: Database.Database
  readonly topics: AgentTopics
  readonly notices: AgentNotices
  readonly tokens: AgentTokenBudget
  readonly deliveries: AgentDeliveries
  constructor(filename: string) {
    this.db = new Database(filename)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version > 8) { this.db.close(); throw new Error('Agent 数据版本较新，请升级应用。') }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (character_id TEXT PRIMARY KEY, settings TEXT NOT NULL, revision INTEGER NOT NULL, next_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, revision INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, question TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', input TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS runs_character ON runs(character_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, kind TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS events_run_time ON events(run_id,at);
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
    if (version < 5) this.db.transaction(() => {
      this.db.exec('DROP INDEX IF EXISTS changes_run; CREATE UNIQUE INDEX changes_run ON topic_changes(run_id,kind) WHERE run_id IS NOT NULL;')
      this.db.pragma('user_version = 5')
    })()
    this.deliveries = new AgentDeliveries(this.db)
    if (version < 7) this.db.transaction(() => {
      if (!(this.db.pragma('table_info(calls)') as { name: string }[]).some(column => column.name === 'metadata')) this.db.exec('ALTER TABLE calls ADD COLUMN metadata TEXT;')
      this.db.pragma('user_version = 7')
    })()
    // Retire legacy contact deadlines without changing modes, revisions or live checkpoints.
    this.db.prepare("UPDATE profiles SET settings=json_remove(settings, '$.workUntil') WHERE json_type(settings, '$.workUntil') IS NOT NULL").run()
    this.tokens = new AgentTokenBudget(this.db)
    if (version < 8) this.db.transaction(() => { this.tokens.importHistory(); this.db.pragma('user_version = 8') })()
    this.db.exec(`CREATE TABLE IF NOT EXISTS activity_heartbeats (id INTEGER PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS activity_heartbeats_topic ON activity_heartbeats(topic_id,ended_at);`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS task_schedule (
      topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
      conversation TEXT NOT NULL DEFAULT '', pending INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0);`)
    this.restoreFailureSchedules()
  }
  private restoreFailureSchedules() {
    this.db.transaction(() => {
      for (const profile of this.profiles()) {
        const settings = JSON.parse(profile.settings) as AgentSettings
        if (!settings.enabled || settings.paceWriting || profile.failures < 1 || profile.failures >= 3 || !profile.focus_topic_id) continue
        const topic = this.topics.get(profile.character_id, profile.focus_topic_id)
        if (!canResearch(topic.status)) continue
        const last = this.db.prepare('SELECT * FROM runs WHERE character_id=? ORDER BY rowid DESC LIMIT 1').get(profile.character_id) as RunRow | undefined
        if (!last || last.status !== 'failed' || last.topic_id !== topic.id || JSON.parse(last.input).revisionScope === 'presentation') continue
        const nextAt = last.updated_at + failureDelay(settings, profile.failures)
        this.db.prepare('UPDATE profiles SET next_at=min(next_at,?) WHERE character_id=?').run(nextAt, profile.character_id)
        this.db.prepare('UPDATE task_schedule SET next_at=min(next_at,?) WHERE topic_id=?').run(nextAt, topic.id)
      }
    })()
  }
  private heartbeatRows = new Map<string, { id: number; topicId: string; at: number }>()
  recordHeartbeats(now = Date.now()) {
    const seen = new Set<string>()
    for (const profile of this.profiles()) {
      const settings = JSON.parse(profile.settings) as AgentSettings
      if (!settings.enabled || !profile.focus_topic_id) continue
      const topic = this.topics.get(profile.character_id, profile.focus_topic_id)
      if (!canResearch(topic.status)) continue
      if (this.db.prepare("SELECT 1 FROM runs WHERE character_id=? AND status IN ('running','waiting','queued','interrupted')").get(profile.character_id)) continue
      seen.add(profile.character_id)
      const previous = this.heartbeatRows.get(profile.character_id)
      const interveningRun = previous && this.db.prepare('SELECT 1 FROM runs WHERE character_id=? AND created_at>=? AND created_at<=?').get(profile.character_id, previous.at, now)
      if (previous && !interveningRun && previous.topicId === topic.id && now >= previous.at && now - previous.at <= 45000) {
        const updated = this.db.prepare('UPDATE activity_heartbeats SET ended_at=? WHERE id=?').run(now, previous.id)
        if (updated.changes) { previous.at = now; continue }
      }
      const row = this.db.prepare('INSERT INTO activity_heartbeats(topic_id,started_at,ended_at) VALUES(?,?,?)').run(topic.id, now, now)
      this.heartbeatRows.set(profile.character_id, { id: Number(row.lastInsertRowid), topicId: topic.id, at: now })
    }
    for (const id of this.heartbeatRows.keys()) if (!seen.has(id)) this.heartbeatRows.delete(id)
  }
  close() { this.db.close() }
  dashboard(characterIds: string[]): import('../../shared/agents').AgentDashboard {
    const contacts: import('../../shared/agents').AgentDashboard['contacts'] = {}
    for (const id of characterIds) {
      const profile = this.profile(id)
      const row = this.db.prepare("SELECT * FROM runs WHERE character_id=? ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'interrupted' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END,created_at DESC,rowid DESC LIMIT 1").get(id) as RunRow | undefined
      const event = row && this.db.prepare('SELECT * FROM events WHERE run_id=? ORDER BY id DESC LIMIT 1').get(row.id) as { id: number; run_id: string; kind: string; text: string; at: number } | undefined
      const work = this.db.prepare(`SELECT MAX(e.at) AS at FROM events e JOIN runs r ON r.id=e.run_id
        WHERE r.character_id=? AND e.kind NOT IN ('queued','answer','waiting','interrupted','heartbeat')`).get(id) as { at: number | null }
      contacts[id] = {
        summary: this.summary(id), settings: profile ? JSON.parse(profile.settings) : { ...DEFAULT_AGENT_SETTINGS },
        focusTopicId: profile?.focus_topic_id ?? null,
        topics: profile?.focus_topic_id ? [this.topics.get(id, profile.focus_topic_id)] : [],
        nextAt: profile?.next_at ?? 0, callsToday: this.callCount(id), run: row ? mapRun(row) : undefined,
        lastWorkedAt: work.at ?? undefined,
        latestActivity: event ? { id: event.id, runId: event.run_id, kind: event.kind, text: event.text, at: event.at } : undefined
      }
    }
    // Only return existing contacts. The bounded window includes every run and topic,
    // rather than just the latest event of each contact.
    const rows = this.db.prepare(`SELECT e.*,r.character_id,COALESCE(json_extract(t.value,'$.title'),'') AS topic_title
      FROM events e JOIN runs r ON r.id=e.run_id LEFT JOIN topics t ON t.id=r.topic_id
      WHERE r.character_id IN (SELECT value FROM json_each(?)) ORDER BY e.id DESC LIMIT 120`)
      .all(JSON.stringify(characterIds)) as { id: number; run_id: string; character_id: string; topic_title: string; kind: string; text: string; at: number }[]
    return { contacts, events: rows.reverse().map(e => ({ id: e.id, runId: e.run_id, characterId: e.character_id, topicTitle: e.topic_title, kind: e.kind, text: e.text, at: e.at })) }
  }
  summary(characterId: string): import('../../shared/agents').AgentSummary {
    const topics = this.topics.list(characterId)
    const active = new Set((this.db.prepare("SELECT DISTINCT topic_id FROM runs WHERE character_id=? AND status IN ('queued','running','waiting','interrupted')").all(characterId) as { topic_id: string | null }[]).map(r => r.topic_id))
    for (const task of this.scheduled(characterId)) if (task.pending) active.add(task.topic_id)
    const usage = this.db.prepare(`SELECT COUNT(*) AS calls,
      COUNT(CASE WHEN json_type(metadata,'$.usage.totalTokens')='integer' AND json_extract(metadata,'$.usage.totalTokens')>=0 THEN 1 END) AS reported,
      COALESCE(SUM(CASE WHEN json_type(metadata,'$.usage.totalTokens')='integer' AND json_extract(metadata,'$.usage.totalTokens')>=0 THEN json_extract(metadata,'$.usage.totalTokens') ELSE 0 END),0) AS tokens
      FROM calls WHERE character_id=?`).get(characterId) as { calls: number; reported: number; tokens: number }
    const memories = (this.db.prepare('SELECT COUNT(*) AS n FROM memories WHERE character_id=?').get(characterId) as { n: number }).n
    return { tasks: topics.length, activeTasks: topics.filter(t => ['researching', 'needs_evidence'].includes(t.status) || t.status === 'planned' && active.has(t.id)).length, memories, ...usage }
  }
  profile(id: string) { return this.db.prepare('SELECT * FROM profiles WHERE character_id=?').get(id) as Profile | undefined }
  profiles() { return this.db.prepare('SELECT * FROM profiles ORDER BY next_at').all() as Profile[] }
  ensure(id: string) { this.db.prepare('INSERT OR IGNORE INTO profiles(character_id,settings,revision,next_at) VALUES(?,?,1,0)').run(id, JSON.stringify(DEFAULT_AGENT_SETTINGS)) }
  save(id: string, raw: unknown, now = Date.now(), createDefaultTopic = true, expectedRevision?: number) {
    const settings = validateAgentSettings(raw)
    this.heartbeatRows.delete(id)
    const wasMissing = !this.profile(id)
    this.ensure(id)
    this.db.transaction(() => {
      const profile = this.profile(id)!
      if (expectedRevision !== undefined && profile.revision !== expectedRevision && !(wasMissing && expectedRevision === 0)) throw new Error('工作设置已变化，请重试以应用到最新设置。')
      const previous = JSON.parse(profile.settings) as AgentSettings
      if (settings.dailyTokenLimit !== previous.dailyTokenLimit && settings.dailyTokenLimit !== undefined && settings.dailyTokenLimit < this.tokens.usage(id, now).today) throw new Error('每日上限不能低于今日已消耗或预留的 Token 额度。')
      const restart = createDefaultTopic || workSettingsRequireRestart(previous, settings)
      if (restart) this.cancel(id, '工作权限或运行方式已更改，本轮停止，已有成果保留。', now)
      const nextAt = !previous.enabled && settings.enabled ? now : restart ? now : profile.next_at
      this.db.prepare('UPDATE profiles SET settings=?,revision=revision+1,next_at=? WHERE character_id=?').run(JSON.stringify(settings), nextAt, id)
      // Keep checkpointed rounds live while invalidating stale settings confirmations.
      if (!restart) this.db.prepare("UPDATE runs SET revision=? WHERE character_id=? AND revision=? AND status IN ('queued','running','waiting','interrupted')").run(profile.revision + 1, id, profile.revision)
      if (settings.enabled && (settings.enabled !== previous.enabled || settings.paceWriting !== previous.paceWriting || settings.intervalMinutes !== previous.intervalMinutes)) {
        for (const task of [...this.scheduled(id), ...(profile.focus_topic_id && !this.scheduled(id).some(t => t.topic_id === profile.focus_topic_id) ? [{ topic_id: profile.focus_topic_id }] : [])]) {
          const last = this.db.prepare('SELECT * FROM runs WHERE topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(task.topic_id) as RunRow | undefined
          if (!last || last.status !== 'completed' || !canResearch(this.topics.get(id, task.topic_id).status)) continue
          const research = this.research(last.id)
          // A continuous-mode switch checks immediately; interval mode preserves explicit idle waits.
          if (research?.nextCheckAt && settings.paceWriting && !this.db.prepare('SELECT 1 FROM reports WHERE run_id=?').get(last.id)) continue
          const delay = !settings.paceWriting ? 0 : settings.intervalMinutes * 60000
          const nextAt = Math.max(now, last.updated_at + delay)
          this.db.prepare('UPDATE task_schedule SET next_at=? WHERE topic_id=?').run(nextAt, task.topic_id)
          if (profile.focus_topic_id === task.topic_id) this.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=?').run(nextAt, id)
        }
      }
      if (createDefaultTopic && !this.topics.list(id).length) {
        const topic = this.topics.create(id, { title: settings.goal.slice(0, 160), goal: settings.goal, constraints: '' }, '由首次保存的工作方向建立。', now)
        this.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(topic.id, id)
      }
    })()
    return this.overview(id, now)
  }
  pause(id: string, reason = '用户暂停了持续工作。') {
    this.heartbeatRows.delete(id)
    this.ensure(id)
    const settings = { ...JSON.parse(this.profile(id)!.settings), enabled: false }
    this.db.transaction(() => {
      for (const task of this.scheduled(id)) {
        const topic = this.topics.get(id, task.topic_id)
        if (canResearch(topic.status)) this.topics.status(id, topic.id, topic.revision, 'paused', reason)
      }
      this.cancel(id, reason)
      this.db.prepare('UPDATE profiles SET settings=?,revision=revision+1 WHERE character_id=?').run(JSON.stringify(settings), id)
    })()
    return this.overview(id)
  }
  cancel(id: string, reason: string, now = Date.now()) {
    const rows = this.db.prepare("SELECT * FROM runs WHERE character_id=? AND status IN ('queued','running','waiting','interrupted')").all(id) as RunRow[]
    for (const row of rows) { this.setStatus(row.id, 'cancelled', now); this.event(row.id, 'cancelled', reason, now) }
  }
  remove(id: string) { const runs = (this.db.prepare('SELECT id FROM runs WHERE character_id=?').all(id) as { id: string }[]).map(r => r.id); this.db.prepare('DELETE FROM profiles WHERE character_id=?').run(id); this.db.prepare('DELETE FROM token_ledger WHERE character_id=?').run(id); for (const runId of runs) this.db.prepare('DELETE FROM token_blocks WHERE run_id=?').run(runId); return runs }
  overview(id: string, now = Date.now()): AgentOverview {
    const profile = this.profile(id)
    const activity = this.db.prepare('SELECT e.* FROM events e JOIN runs r ON r.id=e.run_id WHERE r.character_id=? ORDER BY e.id DESC LIMIT 1').get(id) as { id: number; run_id: string; kind: string; text: string; at: number } | undefined
    return {
      topicMetrics: this.topicMetrics(id, now),
      tokenUsage: this.tokens.usage(id, now), failures: profile?.failures ?? 0,
      latestActivity: activity ? { id: activity.id, runId: activity.run_id, kind: activity.kind, text: activity.text, at: activity.at } : undefined,
      settings: profile ? JSON.parse(profile.settings) : { ...DEFAULT_AGENT_SETTINGS }, revision: profile?.revision ?? 0, nextAt: profile?.next_at ?? 0,
      callsToday: this.callCount(id, now),
      searchesToday: this.searchCount(id, now),
      topics: this.topics.list(id), focusTopicId: profile?.focus_topic_id ?? null,
      queuedTopicIds: this.scheduled(id).filter(task => task.pending && canResearch(this.topics.get(id, task.topic_id).status)).map(task => task.topic_id),
      runs: (this.db.prepare("SELECT * FROM runs WHERE character_id=? AND (status IN ('queued','running','waiting','interrupted') OR id IN (SELECT id FROM runs WHERE character_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30)) ORDER BY created_at DESC,rowid DESC").all(id, id) as RunRow[]).map(mapRun),
      memories: this.memories(id), reports: (this.db.prepare('SELECT value FROM reports WHERE character_id=? ORDER BY rowid DESC LIMIT 20').all(id) as { value: string }[]).map(r => JSON.parse(r.value))
    }
  }
  latestCallId(runId: string) {
    return (this.db.prepare('SELECT id FROM calls WHERE run_id=? ORDER BY id DESC LIMIT 1').get(runId) as { id: number } | undefined)?.id
  }
  interactions(characterId: string, topicId: string, cursor?: number): import('../../shared/agents').AgentInteractionPage {
    this.topics.get(characterId, topicId)
    if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1)) throw new Error('互动记录游标无效。')
    const rows = this.db.prepare(`SELECT e.*, r.status,
      EXISTS(SELECT 1 FROM events later WHERE later.run_id=e.run_id AND later.id>e.id AND later.kind IN ('waiting','answer')) AS superseded
      FROM events e JOIN runs r ON r.id=e.run_id
      WHERE r.character_id=? AND r.topic_id=? AND e.kind IN ('waiting','answer') AND e.id<? ORDER BY e.id DESC LIMIT 51`)
      .all(characterId, topicId, cursor ?? Number.MAX_SAFE_INTEGER) as { id: number; run_id: string; kind: 'waiting' | 'answer'; text: string; at: number; status: string; superseded: number }[]
    const page = rows.slice(0, 50)
    return { items: page.map(row => ({ id: row.id, runId: row.run_id, kind: row.kind, text: row.text, at: row.at, pending: row.kind === 'waiting' && row.status === 'waiting' && !row.superseded })), nextCursor: rows.length > 50 ? page.at(-1)!.id : undefined }
  }
  analytics(characterId: string, query: AnalyticsQuery, now = Date.now()) { return readAnalytics(this.db, characterId, query, now) }
  recordCallMetadata(callId: number, metadata: AIResponseMetadata, now = Date.now()) {
    this.db.prepare('UPDATE calls SET metadata=? WHERE id=?').run(JSON.stringify({ ...metadata, recordedAt: now }), callId)
  }
  topicMetrics(characterId: string, now = Date.now()): Record<string, AgentTopicMetrics> {
    const result: Record<string, AgentTopicMetrics> = {}
    for (const topic of this.topics.list(characterId)) result[topic.id] = { runs: 0, calls: 0, searches: 0, elapsedMs: 0, activeRuns: 0, measuredAt: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, inputReported: 0, outputReported: 0, totalReported: 0, models: [] }
    const runs = this.db.prepare('SELECT topic_id,status,created_at,updated_at FROM runs WHERE character_id=? AND topic_id IS NOT NULL ORDER BY created_at,rowid').all(characterId) as Pick<RunRow, 'topic_id' | 'status' | 'created_at' | 'updated_at'>[]
    for (const run of runs) {
      const metric = result[run.topic_id!]
      if (!metric) continue
      if (!metric.latestRun || run.created_at >= metric.latestRun.createdAt) metric.latestRun = { createdAt: run.created_at, status: run.status }
      const active = ['queued', 'running', 'waiting'].includes(run.status)
      if (active) metric.measuredAt = now
      metric.runs++; metric.activeRuns += Number(active)
      metric.elapsedMs += Math.max(0, (active ? now : run.updated_at) - run.created_at)
    }
    const calls = this.db.prepare('SELECT r.topic_id,c.metadata FROM calls c JOIN runs r ON r.id=c.run_id WHERE c.character_id=?').all(characterId) as { topic_id: string; metadata: string | null }[]
    for (const call of calls) {
      const metric = result[call.topic_id]
      if (!metric) continue
      metric.calls++
      const metadata: AIResponseMetadata = call.metadata ? JSON.parse(call.metadata) : {}
      if (metadata.model && !metric.models.includes(metadata.model)) metric.models.push(metadata.model)
      for (const [key, reported] of [['inputTokens', 'inputReported'], ['outputTokens', 'outputReported'], ['totalTokens', 'totalReported']] as const) {
        const value = metadata.usage?.[key]
        if (value !== undefined && Number.isSafeInteger(value) && value >= 0) { metric[key] += value; metric[reported]++ }
      }
    }
    const searches = this.db.prepare('SELECT r.topic_id,COUNT(*) AS n FROM search_calls c JOIN runs r ON r.id=c.run_id WHERE c.character_id=? GROUP BY r.topic_id').all(characterId) as { topic_id: string; n: number }[]
    for (const search of searches) if (result[search.topic_id]) result[search.topic_id].searches = search.n
    return result
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
  taskCallCount(id: string, topicId: string) {
    return (this.db.prepare('SELECT count(*) AS n FROM calls c JOIN runs r ON r.id=c.run_id WHERE c.character_id=? AND r.topic_id=?').get(id, topicId) as { n: number }).n
  }
  resourceContext(id: string, topicId: string, now = Date.now()) {
    const settings = JSON.parse(this.profile(id)!.settings) as AgentSettings
    const topics = this.topics.list(id)
    const allocations = topics.filter(t => t.id !== topicId && t.resourceBudget && !['completed', 'abandoned'].includes(t.status))
      .map(t => ({ title: t.title, remaining: Math.max(0, t.resourceBudget!.modelCalls - this.taskCallCount(id, t.id)) }))
    const dailyRemaining = Math.max(0, settings.dailyCalls - this.callCount(id, now))
    return { contactDailyLimit: settings.dailyCalls, dailyRemaining, taskUsed: this.taskCallCount(id, topicId),
      taskBudget: topics.find(t => t.id === topicId)?.resourceBudget,
      // Automatic initial budgets stay within one configured day's allowance;
      // lifetime budgets never reserve today's execution capacity.
      allocatableCalls: Math.max(0, Math.min(10000, settings.dailyCalls) - this.taskCallCount(id, topicId)), otherTasks: allocations }
  }
  assertTaskBudget(id: string, topicId: string, needed: number) {
    const topic = this.topics.get(id, topicId)
    if (!topic.resourceBudget) return
    const used = this.taskCallCount(id, topicId)
    if (used + needed > topic.resourceBudget.modelCalls) throw new Error(`本任务调用预算不足：已用 ${used}/${topic.resourceBudget.modelCalls} 次，本轮需预留 ${needed} 次。已有成果保留，请在本任务设置中调整资源预算。`)
  }
  setTaskBudget(id: string, topicId: string, revision: number, raw: unknown) {
    return this.db.transaction(() => {
      this.topics.check(id, topicId, revision)
      if (this.db.prepare("SELECT 1 FROM runs WHERE topic_id=? AND status IN ('queued','running','waiting','interrupted')").get(topicId)) throw new Error('请先暂停本任务，再调整资源预算。')
      const budget = validateTaskResourceBudget({ modelCalls: (raw as Partial<TaskResourceBudget> | null)?.modelCalls, reason: '用户手动调整任务预算。' }), resources = this.resourceContext(id, topicId)
      if (budget.modelCalls < resources.taskUsed) throw new Error(`预算不能低于已使用的 ${resources.taskUsed} 次调用。`)
      return this.topics.budget(id, topicId, revision, budget)
    })()
  }
  allocateTaskBudget(runId: string, raw?: TaskResourceBudget) {
    return this.db.transaction(() => {
      const run = this.assertLive(runId), topic = this.topics.get(run.character_id, run.topic_id!)
      if (topic.resourceBudget) return topic
      if (!raw) return topic
      const resources = this.resourceContext(run.character_id, topic.id)
      const requested = validateTaskResourceBudget(raw)
      const modelCalls = Math.max(resources.taskUsed, Math.min(requested.modelCalls, resources.taskUsed + resources.allocatableCalls))
      const budget = { modelCalls: Math.max(1, modelCalls), reason: requested.reason.slice(0, 950) + (modelCalls < requested.modelCalls ? '（已按联系人可分配额度收紧。）' : '') }
      const next = this.topics.budget(run.character_id, topic.id, topic.revision, budget, runId)
      const input = JSON.parse(run.input)
      this.db.prepare('UPDATE runs SET input=?,topic_revision=? WHERE id=?').run(JSON.stringify({ ...input, topic: next }), next.revision, runId)
      this.event(runId, 'resources', `任务累计调用预算：${budget.modelCalls} 次；已用 ${resources.taskUsed} 次。${budget.reason}`)
      return next
    })()
  }
  createRun(id: string, context: string, now = Date.now(), topicId?: string, revisionScope?: 'presentation') {
    return this.db.transaction(() => {
      const profile = this.profile(id)
      if (!profile) throw new Error('请先在聊天中交付任务。')
      const selected = topicId ?? profile.focus_topic_id
      const existing = this.db.prepare("SELECT * FROM runs WHERE character_id=? AND status IN ('queued','running','waiting','interrupted') AND (topic_id=? OR status!='waiting') ORDER BY CASE WHEN topic_id=? THEN 0 ELSE 1 END LIMIT 1").get(id, selected, selected) as RunRow | undefined
      if (existing) {
        if (topicId && topicId !== existing.topic_id) throw new Error('联系人已有一轮工作未完成，请先等待或暂停它。')
        return existing.id
      }
      if (!selected) throw new Error('请先选择一个要持续推进的事项。')
      const topic = this.topics.get(id, selected)
      if (!canResearch(topic.status) && revisionScope !== 'presentation') throw new Error('当前事项已暂停或结束，请继续此事项或选择其他事项。')
      // Task goals replace the removed work-direction field, including legacy profiles.
      const settings = validateAgentSettings({ ...JSON.parse(profile.settings), goal: topic.goal })
      if (this.callCount(id, now) >= settings.dailyCalls) throw new Error('今日模型调用已达上限，明天再试或调整上限。')
      const scheduled = this.scheduled(id).find(task => task.topic_id === topic.id)
      const assignment = Boolean(scheduled?.pending && revisionScope !== 'presentation')
      const needed = (revisionScope === 'presentation' ? 1 : agentUsesPlanner(settings) ? 2 : 1) + (assignment ? 1 : 0)
      if (this.callCount(id, now) + needed > settings.dailyCalls) throw new Error(`联系人今日资源不足：已用 ${this.callCount(id, now)}/${settings.dailyCalls} 次，本轮需预留 ${needed} 次（规划与执行）。可等明日恢复或调整联系人资源上限。`)
      this.assertTaskBudget(id, topic.id, needed)
      const runId = randomUUID()
      const overview = this.overview(id, now)
      const previous = (this.db.prepare('SELECT reports.value FROM reports JOIN runs ON runs.id=reports.run_id WHERE runs.topic_id=? AND runs.character_id=? ORDER BY reports.rowid DESC LIMIT 3').all(topic.id, id) as { value: string }[]).map(row => JSON.parse(row.value) as AgentReport)
      const baselineRun = this.db.prepare('SELECT topic_revision FROM runs WHERE id=?').get(previous[0]?.runId ?? '') as { topic_revision: number } | undefined
      const last = this.db.prepare('SELECT * FROM runs WHERE character_id=? AND topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(id, topic.id) as RunRow | undefined
      const feedback = last?.status === 'failed' && JSON.parse(last.input).revisionScope !== 'presentation' ? [JSON.parse(last.input).feedback, last.answer ? `对问题「${last.question}」的回复：${last.answer}` : ''].filter(Boolean).join('\n').slice(0, 4000) : undefined
      const input = JSON.stringify({ revisionScope, revisionSectionId: last?.status === 'failed' ? JSON.parse(last.input).revisionSectionId : undefined, deliveryVersion: 1, delivery: this.deliveries.context(topic.id), feedback, researchVersion: 1, baseline: previous[0] && !feedback ? { evidence: previous[0].evidence.map(e => ({ url: e.url, hash: e.hash })), topicRevision: (baselineRun?.topic_revision ?? -1) + 1 } : undefined, settings, topic, memories: overview.memories.filter(m => !m.runId || this.getRun(m.runId)?.topic_id === topic.id).slice(0, 12).map(m => ({ ...m, content: m.content.slice(0, 600) })), previous: previous.map(r => ({ title: r.title, body: r.body.slice(0, 2000), nextStep: r.nextStep })), conversation: context.slice(0, 4000) })
      const runInput = assignment ? JSON.stringify({ ...JSON.parse(input), assignment: true, conversation: scheduled!.conversation || context.slice(0, 4000) }) : input
      this.db.prepare('INSERT INTO runs(id,character_id,revision,status,created_at,updated_at,input,topic_id,topic_revision) VALUES(?,?,?,\'queued\',?,?,?,?,?)').run(runId, id, profile.revision, now, now, runInput, topic.id, topic.revision)
      if (assignment) this.db.prepare("UPDATE task_schedule SET pending=0,conversation='' WHERE topic_id=?").run(topic.id)
      this.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=?').run(now + settings.intervalMinutes * 60000, id)
      this.db.prepare('UPDATE task_schedule SET next_at=? WHERE topic_id=?').run(now + settings.intervalMinutes * 60000, topic.id)
      this.event(runId, 'queued', `已安排事项「${topic.title}」的本轮工作。`, now)
      return runId
    })()
  }
  assignTopic(id: string, description: unknown, conversation: string, requestLog?: string, tokenLimit?: number) {
    if (typeof description !== 'string' || !description.trim() || description.length > 2000 || containsSecret(description)) throw new Error('请描述需要联系人完成的任务（1–2000 字），不要包含密钥。')
    return this.db.transaction(() => {
      this.ensure(id)
      let settings = JSON.parse(this.profile(id)!.settings) as AgentSettings
      if (!settings.goal) {
        settings = { ...settings, goal: '根据用户交付的任务整理方向、研究验证并反馈进展。', enabled: true }
        this.db.prepare('UPDATE profiles SET settings=?,revision=revision+1 WHERE character_id=?').run(JSON.stringify(settings), id)
      }
      validateAgentSettings(settings)
      const profile = this.profile(id)!
      const hasCurrentWork = profile.focus_topic_id && this.db.prepare("SELECT 1 FROM runs WHERE topic_id=? AND status!='cancelled' LIMIT 1").get(profile.focus_topic_id)
      if (settings.enabled && hasCurrentWork && profile.focus_topic_id && canResearch(this.topics.get(id, profile.focus_topic_id).status)) {
        this.db.prepare('INSERT OR IGNORE INTO task_schedule(topic_id,next_at) VALUES(?,?)').run(profile.focus_topic_id, profile.next_at)
      }
      let topic = this.topics.create(id, { title: description.trim().slice(0, 80), goal: description.trim(), constraints: '' }, '用户交付任务，等待联系人整理方向。', Date.now(), requestLog)
      if (tokenLimit !== undefined) topic = this.topics.tokenBudget(id, topic.id, topic.revision, tokenLimit)
      this.db.prepare('INSERT INTO task_schedule(topic_id,conversation,pending) VALUES(?,?,1)').run(topic.id, conversation.slice(0, 4000))
      if (!profile.focus_topic_id || !hasCurrentWork && !this.scheduled(id).some(task => task.topic_id === profile.focus_topic_id)) this.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(topic.id, id)
      // Accepting work is independent from being able to execute it today.
      if (this.nextScheduledTopic(id) === topic.id) this.startScheduledTopic(id, topic.id, conversation)
      return topic
    })()
  }
  scheduled(id: string) {
    return this.db.prepare('SELECT s.* FROM task_schedule s JOIN topics t ON t.id=s.topic_id WHERE t.character_id=? ORDER BY s.rowid').all(id) as { topic_id: string; conversation: string; pending: number; next_at: number }[]
  }
  nextScheduledTopic(id: string, now = Date.now(), newSources?: (topicId: string) => boolean): string | undefined {
    const profile = this.profile(id)
    if (!profile) return
    const settings = JSON.parse(profile.settings) as AgentSettings
    if (settings.enabled && !withinWorkHours(settings, now) || profile.failures >= 3) return
    const unfinished = this.db.prepare("SELECT * FROM runs WHERE character_id=? AND status IN ('queued','running','waiting','interrupted')").all(id) as RunRow[]
    if (unfinished.some(run => run.status !== 'waiting')) return
    const waiting = new Set(unfinished.map(run => run.topic_id))
    const tasks = this.scheduled(id).filter(task => canResearch(this.topics.get(id, task.topic_id).status) && !waiting.has(task.topic_id) && (task.pending || settings.enabled))
    const focus = profile.focus_topic_id && this.topics.get(id, profile.focus_topic_id)
    // Preserve the current work until completion, pause or a blocking question.
    const focused = tasks.find(task => task.topic_id === profile.focus_topic_id)
    const candidate = focused ?? (settings.enabled && focus && canResearch(focus.status) && !waiting.has(focus.id)
      ? { topic_id: focus.id, pending: 0, next_at: profile.next_at } : tasks[0])
    if (!candidate) return
    if (candidate.next_at > now && !(settings.enabled && !settings.paceWriting && profile.failures === 0 && newSources?.(candidate.topic_id))) return
    const needed = (agentUsesPlanner(settings) ? 2 : 1) + (candidate.pending ? 1 : 0)
    if (this.callCount(id, now) + needed > settings.dailyCalls) return
    const topic = this.topics.get(id, candidate.topic_id)
    if (topic.resourceBudget && this.taskCallCount(id, topic.id) + needed > topic.resourceBudget.modelCalls) return
    return candidate.topic_id
  }
  startScheduledTopic(id: string, topicId: string, conversation: string) {
    return this.db.transaction(() => {
      const runId = this.createRun(id, conversation, Date.now(), topicId)
      this.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(topicId, id)
      return runId
    })()
  }
  saveBrief(runId: string, brief: { title: string; nextStep: string; question: string; plan: DeliveryPlan; resourceBudget?: TaskResourceBudget }) {
    this.db.transaction(() => {
      const run = this.assertLive(runId), input = JSON.parse(run.input)
      if (input.brief) return
      const plan = validateDeliveryPlan(brief.plan)
      let topic: import('../../shared/agents').AgentTopic = this.topics.plan(run.character_id, run.topic_id!, run.topic_revision!, brief.title, brief.nextStep, runId, plan)
      this.db.prepare('UPDATE runs SET input=?,topic_revision=? WHERE id=?').run(JSON.stringify({ ...input, brief, topic, delivery: this.deliveries.context(topic.id) }), topic.revision, runId)
      topic = this.allocateTaskBudget(runId, brief.resourceBudget)
      this.event(runId, 'direction', `我准备先这样推进：${brief.nextStep}`)
      if (!brief.question) this.notices.enqueue({ id: `${runId}:direction`, characterId: run.character_id, topicId: topic.id, runId,
        topicRevision: topic.revision, kind: 'progress', purpose: 'direction', createdAt: Date.now(), content: `收到「${topic.title}」。\n\n我准备先这样推进：${brief.nextStep}\n\n已经开始处理，你可以随时补充或调整方向。` })
    })()
  }
  saveBriefAnswer(runId: string, answer: string) {
    this.db.transaction(() => {
      const run = this.assertLive(runId), input = JSON.parse(run.input)
      if (input.briefAnswer) return
      const before = this.topics.get(run.character_id, run.topic_id!)
      const topic = this.topics.edit(run.character_id, before.id, before.revision, { title: before.title, goal: before.goal, constraints: answer }, '用户补充任务方向。')
      this.db.prepare('UPDATE runs SET input=?,topic_revision=? WHERE id=?').run(JSON.stringify({ ...input, briefAnswer: answer, topic }), topic.revision, runId)
    })()
  }
  assertLive(runId: string) {
    const run = this.getRun(runId)
    const profile = run && this.profile(run.character_id)
    if (!run || !profile || run.revision !== profile.revision || !['running', 'queued', 'interrupted', 'waiting'].includes(run.status)) throw new Error('本轮工作已取消或角色已删除。')
    if (run.topic_id) {
      const topic = this.topics.check(run.character_id, run.topic_id, run.topic_revision!)
      if (!canResearch(topic.status) && JSON.parse(run.input).revisionScope !== 'presentation') throw new Error('此事项已暂停或结束。')
    }
    return run
  }
  charge(runId: string, now = Date.now()) {
    this.db.transaction(() => {
      const run = this.assertLive(runId), settings = JSON.parse(this.profile(run.character_id)!.settings) as AgentSettings
      if (this.callCount(run.character_id, now) >= settings.dailyCalls) throw new Error('今日模型调用已达上限。')
      if (run.topic_id) this.assertTaskBudget(run.character_id, run.topic_id, 1)
      this.db.prepare('INSERT INTO calls(character_id,run_id,at) VALUES(?,?,?)').run(run.character_id, runId, now)
    })()
  }
  setStatus(id: string, status: AgentRunStatus, now = Date.now()) {
    const previous = this.getRun(id)?.status
    this.db.prepare('UPDATE runs SET status=?,updated_at=? WHERE id=?').run(status, now, id)
    if (status === 'running' && previous !== 'running') this.event(id, 'execution-start', '开始执行本轮工作。', now)
  }
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
      this.db.prepare('UPDATE task_schedule SET next_at=? WHERE topic_id=?').run(nextAt, run.topic_id)
      this.db.prepare("UPDATE runs SET status='completed',summary=?,updated_at=? WHERE id=?").run(reason, Date.now(), runId)
      this.event(runId, 'deferred', `${reason}\n本轮未生成新报告；下次检查：${new Date(nextAt).toISOString()}`)
      this.pauseForTaskBudget(runId)
    })()
  }
  recoverOutOfScopeQuestion(runId: string, error: string) {
    this.db.transaction(() => {
      const run = this.assertLive(runId)
      const input = JSON.parse(run.input)
      if (input.questionBoundary?.decision?.blocking !== false || !run.topic_id) throw new Error('尚未确认追问偏离任务，不能自动撤回。')
      const topic = this.topics.get(run.character_id, run.topic_id)
      this.fail(runId, `非必要追问已撤回，但本轮纠正未完成：${error.slice(0, 300)}。将按原任务重试，不需要批准额外行动。`)
      this.topics.returnToGoal(run.character_id, topic.id, this.topics.get(run.character_id, topic.id).revision, runId)
      this.db.prepare("UPDATE runs SET input=json_set(input,'$.questionBoundaryRequested',0,'$.questionBoundaryVersion',2) WHERE id=?").run(runId)
      this.event(runId, 'question-replan', '已撤回非必要追问，保留失败与原始成果，下一轮重新执行原任务；未填写用户答复。')
    })()
  }
  recover() {
    // Recheck legacy continuous-task interruptions once, without fabricating a user reply.
    for (const run of this.db.prepare("SELECT * FROM runs WHERE status='waiting'").all() as RunRow[]) {
      const input = JSON.parse(run.input), settings = JSON.parse(this.profile(run.character_id)!.settings) as AgentSettings
      if (!settings.enabled || settings.paceWriting || (input.questionBoundaryVersion >= 2 || input.questionBoundary?.decision?.blocking === true) || input.assignment || !this.research(run.id) || input.deliveryVersion !== 1) continue
      this.db.prepare("UPDATE runs SET input=json_set(input,'$.questionBoundaryRequested',1,'$.questionBoundaryVersion',2) WHERE id=?").run(run.id)
    }
    const rows = this.db.prepare("SELECT id FROM runs WHERE status='running'").all() as { id: string }[]
    for (const row of rows) { this.setStatus(row.id, 'interrupted'); this.event(row.id, 'interrupted', '执行进程已重启，将从持久化检查点恢复；未完成的只读步骤可能重试。') }
  }
  runnable() { return this.db.prepare("SELECT * FROM runs WHERE status IN ('queued','interrupted') OR (status='waiting' AND json_extract(input,'$.questionBoundaryRequested')=1) ORDER BY created_at").all() as RunRow[] }
  callsNeededToResume(runId: string) {
    const run = this.getRun(runId)!, input = JSON.parse(run.input)
    if (input.revisionScope === 'presentation') return 1
    const planned = agentUsesPlanner(input.settings)
    if (input.assignment && !input.brief) return planned ? 3 : 2
    return planned && !this.research(runId) ? 2 : 1
  }
  wait(id: string, question: string, inputs?: import('../../shared/agent-delivery').TaskInputField[]) {
    this.db.transaction(() => {
      const run = this.assertLive(id)
      this.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(run.input), questionInputs: inputs }), id)
      this.db.prepare("UPDATE runs SET status='waiting',question=?,updated_at=? WHERE id=?").run(question, Date.now(), id)
      this.event(id, 'waiting', question)
      if (run.topic_id) {
        const topic = this.topics.get(run.character_id, run.topic_id)
        this.notices.enqueue({ id: `${id}:question:${createHash('sha256').update(question).digest('hex').slice(0, 16)}`, characterId: run.character_id, topicId: topic.id, runId: id,
          topicRevision: topic.revision, kind: 'question', createdAt: Date.now(), content: `「${topic.title}」需要你确认：\n\n${question}\n\n你可以在这里回复，确认后我会接着处理。` })
      }
    })()
  }
  answer(characterId: string, id: string, text: string, answers?: unknown) {
    const { run } = this.detail(characterId, id)
    if (run.status !== 'waiting') throw new Error('这项工作已不在等待回复。')
    if (typeof text !== 'string' || !text.trim() || text.length > 2000 || containsSecret(text)) throw new Error('请填写 1–2000 字的回复，不要包含密钥。')
    this.assertLive(id)
    const input = JSON.parse(this.getRun(id)!.input)
    if (answers !== undefined) {
      const fields = input.questionInputs as import('../../shared/agent-delivery').TaskInputField[] | undefined
      if (!fields?.length || !answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('任务需求回复无效。')
      const values = answers as Record<string, unknown>
      if (Object.keys(values).some(key => !fields.some(field => field.id === key))) throw new Error('回复包含未知的需求项。')
      const supplied = fields.map(field => {
        const value = values[field.id]
        if (typeof value !== 'string' || value.length > 1000 || field.required && !value.trim() || containsSecret(value)) throw new Error('请填写有效的任务需求。')
        return { ...field, value: value.trim() }
      })
      const previous = (input.answeredInputs ?? []) as import('../../shared/agent-delivery').TaskInputField[]
      input.answeredInputs = [...previous.filter(field => !supplied.some(answer => answer.id === field.id)), ...supplied]
    } else delete input.answeredInputs // A later free-text reply may supersede earlier form values.
    const needed = input.assignment && input.brief?.question && !input.briefAnswer && agentUsesPlanner(input.settings) ? 2 : 1
    if (run.topicId) this.assertTaskBudget(characterId, run.topicId, needed)
    if (input.deliveryVersion === 1 && this.callCount(characterId) + needed > JSON.parse(this.profile(characterId)!.settings).dailyCalls) throw new Error('今日模型额度不足以处理回复，请明日再试或调整额度。')
    this.db.prepare("UPDATE runs SET status='queued',answer=?,updated_at=?,input=? WHERE id=?").run(text.trim(), Date.now(), JSON.stringify(input), id)
    this.event(id, 'answer', text.trim())
  }
  fail(id: string, error: string) {
    this.db.transaction(() => this.failRun(id, error))()
  }
  private failRun(id: string, error: string) {
    const run = this.getRun(id)
    if (!run || ['cancelled', 'completed', 'failed'].includes(run.status)) return
    const tokenBlock = this.db.prepare('SELECT message FROM token_blocks WHERE run_id=?').get(id) as { message: string } | undefined
    if (tokenBlock) {
      const message = tokenBlock.message || '工作 Token 额度不足，调整对应上限后继续。'
      const taskLimited = message.startsWith('本任务累计')
      let topicRevision = run.topic_revision!
      if (taskLimited && run.topic_id) {
        const topic = this.topics.get(run.character_id, run.topic_id)
        topicRevision = this.topics.status(run.character_id, topic.id, topic.revision, 'paused', message).revision
      }
      this.db.prepare('UPDATE runs SET status=?,error=?,updated_at=? WHERE id=?').run(taskLimited ? 'cancelled' : 'interrupted', message, Date.now(), id)
      this.event(id, 'token-limit', message)
      if (run.topic_id) this.notices.enqueue({ id: `${id}:token-limit`, characterId: run.character_id, topicId: run.topic_id, runId: id,
        topicRevision, kind: 'progress', purpose: 'resources', createdAt: Date.now(), content: message })
      return
    }
    this.db.prepare("UPDATE runs SET status='failed',error=?,updated_at=? WHERE id=?").run(error.slice(0, 600), Date.now(), id)
    this.event(id, 'failed', error)
    if (JSON.parse(run.input).revisionScope === 'presentation') {
      if (run.topic_id) {
        const topic = this.topics.get(run.character_id, run.topic_id)
        this.notices.enqueue({ id: `${id}:presentation-failed`, purpose: 'presentation', characterId: run.character_id, topicId: topic.id, runId: id, topicRevision: topic.revision, kind: 'progress', createdAt: Date.now(), content: `「${topic.title}」的阅读样式修改未完成，原成果与正文已保留。原因：${error.slice(0, 300)}\n可在工作记录中重试本次样式修改。` })
      }
      return
    }
    if (this.pauseForTaskBudget(id)) return
    const profile = this.profile(run.character_id)!
    const settings = JSON.parse(profile.settings) as AgentSettings
    // Failure is a runtime block; preserve the selected work mode.
    this.db.prepare('UPDATE profiles SET failures=failures+1,settings=?,next_at=? WHERE character_id=?').run(JSON.stringify(settings), Date.now() + failureDelay(settings, profile.failures + 1), run.character_id)
    this.db.prepare('UPDATE task_schedule SET next_at=? WHERE topic_id=?').run(this.profile(run.character_id)!.next_at, run.topic_id)
    if (run.topic_id) {
      const topic = this.topics.get(run.character_id, run.topic_id)
      const recovery = profile.failures + 1 >= 3 ? '已连续失败 3 次，自动推进已停止，请查看工作记录后重试。'
        : settings.enabled ? `将在 ${failureDelay(settings, profile.failures + 1) / 60000} 分钟后尝试继续；仍受工作时间和额度限制。` : '可在工作记录中重试。'
      this.notices.enqueue({ id: `${id}:failure`, characterId: run.character_id, topicId: topic.id, runId: id, topicRevision: topic.revision,
        kind: 'progress', purpose: 'failure', createdAt: Date.now(), content: `「${topic.title}」本轮未完成，已有成果保留。\n原因：${error.slice(0, 300)}\n${recovery}` })
    }
  }
  finish(runId: string, report: AgentReport, memories: string[], progress?: AgentTopicProgress, delivery?: DeliveryUpdate) {
    this.db.transaction(() => {
      if (this.getRun(runId)?.status === 'completed') return
      const run = this.assertLive(runId)
      const deliveryInput = JSON.parse(run.input)
      const previousDelivery = run.topic_id ? this.deliveries.get(run.topic_id) : null
      const presentationOnly = deliveryInput.revisionScope === 'presentation'
      if (presentationOnly && (!previousDelivery || previousDelivery.version !== deliveryInput.revisionBaseVersion || !delivery || delivery.presentation === undefined || delivery.section || delivery.inputs || memories.length || delivery.summary !== previousDelivery.summary || delivery.completionCriteria !== previousDelivery.completionCriteria || JSON.stringify(delivery.stages) !== JSON.stringify(previousDelivery.stages))) throw new Error('样式修订版本已变化或试图修改正文与进度，本轮未保存。')
      if (deliveryInput.answeredInputs?.length) {
        const supplied = deliveryInput.answeredInputs as import('../../shared/agent-delivery').TaskInputField[]
        const existing = delivery?.inputs ?? previousDelivery?.inputs ?? supplied
        const inputs = [...existing.filter(field => !supplied.some(answer => answer.id === field.id)), ...supplied]
        if (delivery) delivery = { ...delivery, inputs }
      }
      if (!presentationOnly && run.topic_id && progress?.status === 'completed' && this.topics.get(run.character_id, run.topic_id).initialPlan) {
        if (!delivery) throw new Error('尚未提交实际成果和阶段验收，不能完成任务。')
        const requiredStages = [...this.topics.get(run.character_id, run.topic_id).initialPlan!.stages, ...(previousDelivery?.stages ?? [])]
        if (requiredStages.some(stage => !delivery!.stages.some(next => next.id === stage.id && next.status === 'done'))) throw new Error('仍有计划阶段未交付或被遗漏，不能完成任务。')
      }
      if (deliveryInput.revisionSectionId && delivery?.section?.id !== deliveryInput.revisionSectionId) throw new Error('成果没有更新指定分节，本轮未提交。')
      if (run.topic_id) {
        if (!progress) throw new Error('缺少事项进展，本轮不能提交。')
        const before = this.topics.get(run.character_id, run.topic_id)
        const previous = this.db.prepare('SELECT reports.value FROM reports JOIN runs ON runs.id=reports.run_id WHERE runs.topic_id=? AND runs.character_id=? ORDER BY reports.rowid DESC LIMIT 1').get(run.topic_id, run.character_id) as { value: string } | undefined
        if (presentationOnly) {
          this.topics.presentation(run.character_id, run.topic_id, run.topic_revision!, runId)
          this.notices.enqueue({ id: `${runId}:presentation`, purpose: 'presentation', characterId: run.character_id, topicId: run.topic_id, runId, topicRevision: before.revision + 1, kind: 'progress', createdAt: Date.now(), content: `「${before.title}」的阅读样式已保存为版本 ${previousDelivery!.version + 1}，正文与任务进度保持不变。可在任务成果中查看。` })
        } else {
          this.topics.advance(run.character_id, run.topic_id, run.topic_revision!, progress, runId)
          const section = delivery?.section
          const deliveryChanged = Boolean(section && !previousDelivery?.sections.some(old => old.id === section.id && old.title === section.title && old.body === section.body))
          this.notices.progress(before, this.topics.get(run.character_id, run.topic_id), report, previous ? JSON.parse(previous.value) : undefined, this.research(runId)?.plan.action === 'write', deliveryChanged)
        }
      }
      this.db.prepare('INSERT OR IGNORE INTO reports(run_id,character_id,value) VALUES(?,?,?)').run(runId, run.character_id, JSON.stringify(report))
      if (run.topic_id && progress && JSON.parse(run.input).deliveryVersion === 1) this.deliveries.commit(run.topic_id, report, progress, delivery)
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
        const changedSection = delivery?.section && !previousDelivery?.sections.some(section => section.body.trim() === delivery!.section!.body.trim())
        const previousReport = this.db.prepare('SELECT reports.value FROM reports JOIN runs ON runs.id=reports.run_id WHERE runs.topic_id=? AND runs.id<>? ORDER BY reports.rowid DESC LIMIT 1').get(run.topic_id, runId) as { value: string } | undefined
        const previousEvidence = new Set<string>(previousReport ? (JSON.parse(previousReport.value) as AgentReport).evidence.map(e => `${e.url}:${e.hash}`) : [])
        const newEvidence = report.evidence.some(e => !previousEvidence.has(`${e.url}:${e.hash}`))
        const continueImmediately = !settings.paceWriting && progress && canResearch(progress.status) && (changedSection || newEvidence) && !deliveryInput.feedback
        const nextAt = Date.now() + (continueImmediately ? 0 : Math.max(settings.intervalMinutes, research.plan.checkAfterMinutes) * 60000)
        this.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=?').run(nextAt, run.character_id)
        this.db.prepare('UPDATE task_schedule SET next_at=? WHERE topic_id=?').run(nextAt, run.topic_id)
        this.db.prepare('UPDATE research SET value=? WHERE run_id=?').run(JSON.stringify({ ...research, nextCheckAt: nextAt }), runId)
        if (continueImmediately && settings.enabled) this.event(runId, 'continuing', '本轮成果已保存，额度允许时将继续推进下一轮。')
        else if (research.plan.action === 'write' && !changedSection) this.event(runId, 'deferred', '本轮没有新增或修改正文，按工作间隔再检查，避免重复消耗额度。')
      }
      this.event(runId, 'completed', report.nextStep || '本轮工作完成。')
      if (!presentationOnly) this.pauseForTaskBudget(runId)
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
  private pauseForTaskBudget(runId: string) {
    const run = this.getRun(runId)
    if (!run?.topic_id) return false
    const topic = this.topics.get(run.character_id, run.topic_id)
    if (!topic.resourceBudget || !canResearch(topic.status)) return false
    const settings = JSON.parse(this.profile(run.character_id)!.settings) as AgentSettings
    const used = this.taskCallCount(run.character_id, topic.id), needed = agentUsesPlanner(settings) ? 2 : 1
    if (used + needed <= topic.resourceBudget.modelCalls) return false
    const reason = `任务资源预算不足以继续下一轮：已用 ${used}/${topic.resourceBudget.modelCalls} 次，下一轮需 ${needed} 次。已有成果保留，请在本任务设置中调整预算后继续。`
    const next = this.topics.status(run.character_id, topic.id, topic.revision, 'paused', reason)
    this.event(runId, 'resources-paused', reason)
    this.notices.enqueue({ id: `${runId}:resources`, characterId: run.character_id, topicId: topic.id, runId, topicRevision: next.revision, kind: 'progress', purpose: 'resources', createdAt: Date.now(), content: `「${topic.title}」已暂停。${reason}` })
    return true
  }
  deleteTopic(id: string, topicId: string, revision: number) {
    return this.db.transaction(() => {
      this.topics.check(id, topicId, revision)
      const runs = this.db.prepare('SELECT id FROM runs WHERE character_id=? AND topic_id=?').all(id, topicId) as { id: string }[]
      for (const run of runs) this.db.prepare('DELETE FROM token_blocks WHERE run_id=?').run(run.id)
      this.db.prepare("DELETE FROM notices WHERE character_id=? AND json_extract(value,'$.topicId')=?").run(id, topicId)
      this.db.prepare('DELETE FROM memories WHERE character_id=? AND run_id IN (SELECT id FROM runs WHERE character_id=? AND topic_id=?)').run(id, id, topicId)
      this.db.prepare('DELETE FROM runs WHERE character_id=? AND topic_id=?').run(id, topicId)
      this.db.prepare('DELETE FROM topics WHERE character_id=? AND id=?').run(id, topicId)
      this.db.prepare('UPDATE profiles SET focus_topic_id=NULL WHERE character_id=? AND focus_topic_id=?').run(id, topicId)
      return runs.map(run => run.id)
    })()
  }
  revisePresentation(id: string, topicId: string, revision: number, feedback: unknown, conversation: string, baseVersion: number) {
    if (typeof feedback !== 'string' || !feedback.trim() || feedback.length > 2000 || containsSecret(feedback)) throw new Error('请填写有效的样式修改意见。')
    return this.db.transaction(() => {
      this.topics.check(id, topicId, revision)
      const artifact = this.deliveries.get(topicId)
      if (!artifact || !Number.isSafeInteger(baseVersion) || artifact.version !== baseVersion) throw new Error('成果版本已变化或尚无正文，请重新读取。')
      if (this.overview(id).runs.some(r => ['queued', 'running', 'waiting', 'interrupted'].includes(r.status) && (r.topicId === topicId || r.status !== 'waiting'))) throw new Error('请先完成、回复或暂停当前工作，再修改样式。')
      const runId = this.createRun(id, conversation, Date.now(), topicId, 'presentation')
      const input = JSON.parse(this.getRun(runId)!.input)
      this.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify({ ...input, revisionSectionId: undefined, revisionBaseVersion: baseVersion, feedback: feedback.trim() }), runId)
      this.event(runId, 'feedback', `仅修改阅读样式：${feedback.trim()}`)
      return runId
    })()
  }
  reviseTopic(id: string, topicId: string, revision: number, feedback: unknown, conversation: string, sectionId?: string) {
    if (typeof feedback !== 'string' || !feedback.trim() || feedback.length > 2000 || containsSecret(feedback)) throw new Error('请填写 1–2000 字的修改意见，不要包含密钥。')
    return this.db.transaction(() => {
      const topic = this.topics.check(id, topicId, revision)
      if (sectionId !== undefined && !this.deliveries.get(topicId)?.sections.some(s => s.id === sectionId)) throw new Error('找不到要修订的成果分节，请重新选择。')
      if (this.overview(id).runs.some(r => ['queued', 'running', 'waiting', 'interrupted'].includes(r.status) && (r.topicId === topicId || r.status !== 'waiting'))) throw new Error('请先完成、回复或暂停当前工作，再提交修改意见。')
      this.topics.status(id, topicId, revision, 'planned', feedback.trim())
      const runId = this.createRun(id, conversation, Date.now(), topicId)
      const input = JSON.parse(this.getRun(runId)!.input)
      // Include earlier sections when explicitly revising; never replace the full artifact with a truncated copy.
      input.feedback = feedback.trim()
      input.revisionSectionId = sectionId
      input.topic = { ...input.topic, nextStep: `根据用户修改意见修订：${feedback.trim()}` }
      this.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify(input), runId)
      this.event(runId, 'feedback', `用户对「${topic.title}」的修改意见：${feedback.trim()}`)
      return runId
    })()
  }
  changeTopic(id: string, topicId: string, revision: number, change: { input: unknown; reason: string; requestLog?: string } | { status: AgentTopicStatus; reason: string }) {
    return this.db.transaction(() => {
      const topic = 'input' in change ? this.topics.edit(id, topicId, revision, change.input, change.reason, change.requestLog) : this.topics.status(id, topicId, revision, change.status, change.reason)
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
      this.db.prepare('UPDATE profiles SET failures=0 WHERE character_id=?').run(id)
      const active = this.db.prepare("SELECT status FROM runs WHERE character_id=? AND status IN ('queued','running','waiting','interrupted') AND (topic_id=? OR status!='waiting')").get(id, topicId) as { status: string } | undefined
      if (active) throw new Error(active.status === 'waiting' ? '请先回答当前待确认的问题。' : '联系人已有一轮工作未完成。')
      this.topics.status(id, topicId, revision, 'planned', reason)
      this.focusTopic(id, topicId)
      return this.startScheduledTopic(id, topicId, conversation)
    })()
  }
}
