import { providerRecoveryDelay, contactReadPermissionRestored } from '../../../shared/contact-failure';
import { ContactCalendars } from '../../agents/calendar';
import { AgentMemories } from '../../agents/memories';
import { cardHighlights } from '../../../shared/contact-home';
import { AgentTaskFailures } from '../../agents/task-failures';
import { AgentTokenBudget } from '../../agents/token-budget';
import type Database from 'better-sqlite3';
import type { AgentSettings, AgentOverview, AgentMemory, AgentRunDetail } from '../../../shared/agents';
import { agentUsesPlanner, DEFAULT_AGENT_SETTINGS } from '../../../shared/agents';
import { AgentTopics, canResearch } from '../../agents/topics';
import type { AgentResearch } from '../../../shared/agents';
import type { AIResponseMetadata } from '../../../shared/ai-usage';
import type { AgentTopicMetrics } from '../../../shared/agents';
import { readAnalytics } from '../../agents/analytics';
import type { AnalyticsQuery } from '../../../shared/agent-analytics';
import { Profile, RunRow, mapRun } from './types';
import type { ContactStoreOperations } from './operations';
interface Ports {
  topics: Pick<AgentTopics, "get" | "list">
  callCount: ContactStoreOperations['callCount']
  calendars: Pick<ContactCalendars, "get">
  taskFailures: Pick<AgentTaskFailures, "get">
  tokens: Pick<AgentTokenBudget, "usage">
  searchCount: ContactStoreOperations['searchCount']
  memoryLibrary: Pick<AgentMemories, "list">
}

export class ContactQueries {
  constructor(private db: { prepare(sql: string): Pick<Database.Statement, 'get' | 'all'> }, private ports: Ports) {}
  pendingCleanup(): { characterId: string; requestId: string; }[] { return this.db.prepare('SELECT character_id AS characterId,request_id AS requestId FROM execution_cleanup ORDER BY rowid').all() as { characterId: string; requestId: string }[] }
  dashboard(characterIds: string[], highlights: Readonly<Record<string, ReturnType<typeof cardHighlights>>> = {}): import('../../../shared/agents').AgentDashboard {
    const contacts: import('../../../shared/agents').AgentDashboard['contacts'] = {}
    for (const id of characterIds) {
      const profile = this.profile(id)
      const row = this.db.prepare("SELECT * FROM runs WHERE character_id=? ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'interrupted' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END,created_at DESC,rowid DESC LIMIT 1").get(id) as RunRow | undefined
      const event = row && this.db.prepare('SELECT * FROM events WHERE run_id=? ORDER BY id DESC LIMIT 1').get(row.id) as { id: number; run_id: string; kind: string; text: string; at: number } | undefined
      const work = this.db.prepare(`SELECT MAX(e.at) AS at FROM events e JOIN runs r ON r.id=e.run_id
        WHERE r.character_id=? AND e.kind NOT IN ('queued','answer','waiting','interrupted','heartbeat')`).get(id) as { at: number | null }
      contacts[id] = {
        ...(highlights[id] ? { highlights: highlights[id] } : {}),
        summary: this.summary(id), settings: profile ? JSON.parse(profile.settings) : { ...DEFAULT_AGENT_SETTINGS },
        focusTopicId: profile?.focus_topic_id ?? null,
        topics: profile?.focus_topic_id ? [this.ports.topics.get(id, profile.focus_topic_id)] : [],
        nextAt: profile?.next_at ?? 0, callsToday: this.ports.callCount(id), run: row ? mapRun(row) : undefined,
        lastWorkedAt: work.at ?? undefined,
        latestActivity: event ? { id: event.id, runId: event.run_id, kind: event.kind, text: event.text, at: event.at } : undefined
      }
    }
    // Only return existing contacts. The bounded window includes every run and topic,
    // rather than just the latest event of each contact.
    const rows = this.db.prepare(`SELECT e.*,r.character_id,r.topic_id,COALESCE(json_extract(t.value,'$.title'),'') AS topic_title
      FROM events e JOIN runs r ON r.id=e.run_id LEFT JOIN topics t ON t.id=r.topic_id
      WHERE r.character_id IN (SELECT value FROM json_each(?)) ORDER BY e.id DESC LIMIT 120`)
      .all(JSON.stringify(characterIds)) as { id: number; run_id: string; character_id: string; topic_id: string | null; topic_title: string; kind: string; text: string; at: number }[]
    return { contacts, events: rows.reverse().map(e => ({ id: e.id, runId: e.run_id, characterId: e.character_id, topicId: e.topic_id, topicTitle: e.topic_title, kind: e.kind, text: e.text, at: e.at })) }
  }
  summary(characterId: string): import('../../../shared/agents').AgentSummary {
    const topics = this.ports.topics.list(characterId)
    const active = new Set((this.db.prepare("SELECT DISTINCT topic_id FROM runs WHERE character_id=? AND status IN ('queued','running','waiting','interrupted')").all(characterId) as { topic_id: string | null }[]).map(r => r.topic_id))
    for (const task of this.scheduled(characterId)) if (task.pending) active.add(task.topic_id)
    const usage = this.db.prepare(`SELECT COUNT(*) AS calls,
      COUNT(CASE WHEN json_type(metadata,'$.usage.totalTokens')='integer' AND json_extract(metadata,'$.usage.totalTokens')>=0 THEN 1 END) AS reported,
      COALESCE(SUM(CASE WHEN json_type(metadata,'$.usage.totalTokens')='integer' AND json_extract(metadata,'$.usage.totalTokens')>=0 THEN json_extract(metadata,'$.usage.totalTokens') ELSE 0 END),0) AS tokens
      FROM calls WHERE character_id=?`).get(characterId) as { calls: number; reported: number; tokens: number }
    const memories = this.memories(characterId).length
    return { tasks: topics.length, activeTasks: topics.filter(t => ['researching', 'needs_evidence'].includes(t.status) || t.status === 'planned' && active.has(t.id)).length, memories, ...usage }
  }
  profile(id: string): Profile | undefined { return this.db.prepare('SELECT * FROM profiles WHERE character_id=?').get(id) as Profile | undefined }
  profiles(): Profile[] { return this.db.prepare('SELECT * FROM profiles ORDER BY next_at').all() as Profile[] }
  overview(id: string, now = Date.now()): AgentOverview {
    const profile = this.profile(id)
    const scheduled = this.scheduled(id)
    const taskSchedule: NonNullable<AgentOverview['taskSchedule']> = Object.fromEntries(scheduled.map(task => [task.topic_id, { nextAt: task.next_at }]))
    const settings: AgentSettings = profile ? JSON.parse(profile.settings) : DEFAULT_AGENT_SETTINGS
    const taskResources: NonNullable<AgentOverview['taskResources']> = {}
    if (profile?.focus_topic_id && !taskSchedule[profile.focus_topic_id]) taskSchedule[profile.focus_topic_id] = { nextAt: profile.next_at }
    for (const topic of this.ports.topics.list(id)) {
      const topicId = topic.id, schedule = taskSchedule[topicId]
      const calendar = topic.calendar && this.ports.calendars.get(topicId)
      if (calendar && schedule) Object.assign(schedule, { nextAt: calendar.next_at, calendar: topic.calendar, finishedAt: calendar.finished_at ?? undefined, lastDueAt: calendar.last_due_at ?? undefined })
      const latest = this.db.prepare('SELECT id,status FROM runs WHERE topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(topicId) as { id: string; status: string } | undefined
      const research = latest && this.research(latest.id)
      if (schedule) schedule.waitingForUpdates = !calendar && latest?.status === 'completed' && Boolean(research?.unchanged || research?.plan.action === 'wait')
      const block = latest && this.db.prepare('SELECT needed FROM token_blocks WHERE run_id=?').get(latest.id) as { needed: number } | undefined
      taskResources[topicId] = {
        callsNeeded: latest && ['queued', 'waiting', 'interrupted', 'running'].includes(latest.status) ? this.callsNeededToResume(latest.id)
          : (agentUsesPlanner(settings) ? 2 : 1) + (scheduled.some(task => task.topic_id === topicId && task.pending) ? 1 : 0),
        ...(block ? { tokensNeeded: block.needed } : {})
      }
    }
    const activity = this.db.prepare('SELECT e.* FROM events e JOIN runs r ON r.id=e.run_id WHERE r.character_id=? ORDER BY e.id DESC LIMIT 1').get(id) as { id: number; run_id: string; kind: string; text: string; at: number } | undefined
    return {
      taskSchedule,
      taskResources,
      topicMetrics: this.topicMetrics(id, now),
      taskFailures: Object.fromEntries(this.ports.topics.list(id).flatMap(topic => {
        const failure = this.ports.taskFailures.get(topic.id)
        if (!failure || !canResearch(topic.status)) return []
        const settings = JSON.parse(profile!.settings) as AgentSettings
        const retryAt = !settings.enabled ? undefined : failure.failures < 3 ? failure.next_at : this.providerRecovery(id, topic.id)?.at
        return [[topic.id, { failures: failure.failures, ...(retryAt !== undefined ? { retryAt } : {}) }]]
      })),
      providerRecovery: this.providerRecovery(id), tokenUsage: this.ports.tokens.usage(id, now), failures: profile?.failures ?? 0,
      latestActivity: activity ? { id: activity.id, runId: activity.run_id, kind: activity.kind, text: activity.text, at: activity.at } : undefined,
      settings: profile ? JSON.parse(profile.settings) : { ...DEFAULT_AGENT_SETTINGS }, revision: profile?.revision ?? 0, nextAt: profile?.next_at ?? 0,
      callsToday: this.ports.callCount(id, now),
      searchesToday: this.ports.searchCount(id, now),
      topics: this.ports.topics.list(id), focusTopicId: profile?.focus_topic_id ?? null,
      queuedTopicIds: this.scheduled(id).filter(task => task.pending && canResearch(this.ports.topics.get(id, task.topic_id).status) && !this.ports.topics.get(id, task.topic_id).calendar).map(task => task.topic_id),
      runs: (this.db.prepare("SELECT * FROM runs WHERE character_id=? AND (status IN ('queued','running','waiting','interrupted') OR id IN (SELECT id FROM runs WHERE character_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30)) ORDER BY created_at DESC,rowid DESC").all(id, id) as RunRow[]).map(mapRun),
      memories: this.memories(id), reports: (this.db.prepare('SELECT value FROM reports WHERE character_id=? ORDER BY rowid DESC LIMIT 20').all(id) as { value: string }[]).map(r => JSON.parse(r.value))
    }
  }
  latestCallId(runId: string): number | undefined {
    return (this.db.prepare('SELECT id FROM calls WHERE run_id=? ORDER BY id DESC LIMIT 1').get(runId) as { id: number } | undefined)?.id
  }
  interactions(characterId: string, topicId: string, cursor?: number): import('../../../shared/agents').AgentInteractionPage {
    this.ports.topics.get(characterId, topicId)
    if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1)) throw new Error('互动记录游标无效。')
    const rows = this.db.prepare(`SELECT e.*, r.status,
      EXISTS(SELECT 1 FROM events later WHERE later.run_id=e.run_id AND later.id>e.id AND later.kind IN ('waiting','answer')) AS superseded
      FROM events e JOIN runs r ON r.id=e.run_id
      WHERE r.character_id=? AND r.topic_id=? AND e.kind IN ('waiting','answer') AND e.id<? ORDER BY e.id DESC LIMIT 51`)
      .all(characterId, topicId, cursor ?? Number.MAX_SAFE_INTEGER) as { id: number; run_id: string; kind: 'waiting' | 'answer'; text: string; at: number; status: string; superseded: number }[]
    const page = rows.slice(0, 50)
    return { items: page.map(row => ({ id: row.id, runId: row.run_id, kind: row.kind, text: row.text, at: row.at, pending: row.kind === 'waiting' && row.status === 'waiting' && !row.superseded })), nextCursor: rows.length > 50 ? page.at(-1)!.id : undefined }
  }
  analytics(characterId: string, query: AnalyticsQuery, now = Date.now()): import("../../../shared/agent-analytics").AgentAnalytics { return readAnalytics(this.db, characterId, query, now) }
  topicMetrics(characterId: string, now = Date.now()): Record<string, AgentTopicMetrics> {
    const result: Record<string, AgentTopicMetrics> = {}
    for (const topic of this.ports.topics.list(characterId)) result[topic.id] = { runs: 0, calls: 0, searches: 0, elapsedMs: 0, activeRuns: 0, measuredAt: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, inputReported: 0, outputReported: 0, totalReported: 0, models: [] }
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
    return this.ports.memoryLibrary.list(id).filter(m => m.status === 'active').map(m => ({ ...m, runId: m.source.kind === 'research' ? m.source.runId : null }))
  }
  getRun(id: string): RunRow | undefined { return this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as RunRow | undefined }
  detail(characterId: string, runId: string): AgentRunDetail {
    const run = this.getRun(runId)
    if (!run || run.character_id !== characterId) throw new Error('找不到此联系人的工作记录。')
    const report = this.db.prepare('SELECT value FROM reports WHERE run_id=? AND character_id=?').get(runId, characterId) as { value: string } | undefined
    return { run: mapRun(run), research: this.research(runId), events: (this.db.prepare('SELECT * FROM events WHERE run_id=? ORDER BY id LIMIT 200').all(runId) as { id: number; run_id: string; kind: string; text: string; at: number }[]).map(r => ({ id: r.id, runId: r.run_id, kind: r.kind, text: r.text, at: r.at })), report: report ? JSON.parse(report.value) : null }
  }
  scheduled(id: string): { topic_id: string; conversation: string; pending: number; next_at: number; }[] {
    return this.db.prepare('SELECT s.* FROM task_schedule s JOIN topics t ON t.id=s.topic_id WHERE t.character_id=? ORDER BY s.rowid').all(id) as { topic_id: string; conversation: string; pending: number; next_at: number }[]
  }
  providerRecovery(id: string, topicId?: string): { runId: string; topicId: string; at: number; } | undefined {
    const profile = this.profile(id)
    if (!profile) return
    const settings = JSON.parse(profile.settings) as AgentSettings
    if (!settings.enabled) return
    const recoveries = this.ports.topics.list(id).filter(topic => (!topicId || topic.id === topicId) && canResearch(topic.status)).flatMap(topic => {
      const failure = this.ports.taskFailures.get(topic.id)
      if (!failure || failure.failures < 3) return []
      const run = this.getRun(failure.run_id)
      const latest = this.db.prepare('SELECT id FROM runs WHERE topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(topic.id) as { id: string } | undefined
      if (!run || latest?.id !== run.id || run.status !== 'failed' || topic.revision !== run.topic_revision || JSON.parse(run.input).revisionScope === 'presentation') return []
      if (!this.scheduled(id).some(task => task.topic_id === topic.id) && profile.focus_topic_id !== topic.id) return []
      const delay = providerRecoveryDelay(run.error, failure.failures, settings.paceWriting ? settings.intervalMinutes : 0)
      const input = JSON.parse(run.input)
      const sourceOwner = input.handoffPin?.source?.characterId as string | undefined
      const source = sourceOwner ? this.profile(sourceOwner) : undefined
      const sharedAgain = Boolean(source && settings.readContactDeliveries && JSON.parse(source.settings).shareDeliveries && /成果未共享或已撤回/.test(run.error))
      const permissionRestored = contactReadPermissionRestored(run.error, input.settings, settings) || sharedAgain
      return delay === undefined && !permissionRestored ? [] : [{ runId: run.id, topicId: topic.id, at: Math.max(failure.next_at, run.updated_at + (delay ?? 0)) }]
    })
    return recoveries.sort((a, b) => a.at - b.at)[0]
  }
  research(runId: string): AgentResearch | undefined {
    const row = this.db.prepare('SELECT value FROM research WHERE run_id=?').get(runId) as { value: string } | undefined
    return row ? JSON.parse(row.value) : undefined
  }
  runnable(): RunRow[] { return this.db.prepare("SELECT * FROM runs WHERE status IN ('queued','interrupted') OR (status='waiting' AND json_extract(input,'$.questionBoundaryRequested')=1) ORDER BY created_at").all() as RunRow[] }
  callsNeededToResume(runId: string): 1 | 3 | 2 {
    const run = this.getRun(runId)!, input = JSON.parse(run.input)
    if (input.revisionScope === 'presentation') return 1
    const planned = agentUsesPlanner(input.settings)
    if (input.assignment && !input.brief) return planned ? 3 : 2
    return planned && !this.research(runId) ? 2 : 1
  }
}
