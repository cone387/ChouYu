import type Database from 'better-sqlite3'
import { emptyUsage, type AgentAnalytics, type AnalyticsQuery, type ActivitySpan, type UsageTotals } from '../../shared/agent-analytics'
import type { AIResponseMetadata } from '../../shared/ai-usage'

/** Local calendar boundaries, including DST. End date is inclusive in the UI. */
export function analyticsRange(query: AnalyticsQuery) {
  if (!query || ![1, 7, 30].includes(query.days) || !/^\d{4}-\d{2}-\d{2}$/.test(query.date)) throw new Error('统计日期无效。')
  const end = new Date(`${query.date}T00:00:00`)
  if (!Number.isFinite(+end) || `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}` !== query.date) throw new Error('统计日期无效。')
  end.setDate(end.getDate() + 1)
  const start = new Date(end); start.setDate(start.getDate() - query.days)
  const boundaries = [+start]
  while (boundaries.at(-1)! < +end) {
    const next = new Date(boundaries.at(-1)!)
    if (query.days === 1) next.setTime(+next + 3600000)
    else next.setDate(next.getDate() + 1)
    boundaries.push(Math.min(+end, +next))
  }
  return { start: +start, end: +end, boundaries }
}

export function readAnalytics(db: Database.Database, characterId: string, query: AnalyticsQuery, now = Date.now()): AgentAnalytics {
  const { start, end, boundaries } = analyticsRange(query)
  if (query.topicId !== undefined && (typeof query.topicId !== 'string' || !db.prepare('SELECT 1 FROM topics WHERE character_id=? AND id=?').get(characterId, query.topicId))) throw new Error('统计任务不存在。')
  const tasks = (db.prepare('SELECT id,value FROM topics WHERE character_id=?').all(characterId) as { id: string; value: string }[])
    .filter(t => !query.topicId || t.id === query.topicId).map(t => ({ id: t.id as string | null, title: JSON.parse(t.value).title as string, ...emptyUsage() }))
  const result: AgentAnalytics = { start, end, measuredAt: now, totals: emptyUsage(), buckets: boundaries.slice(0, -1).map((at, i) => ({ start: at, end: boundaries[i + 1], ...emptyUsage() })), spans: [], activity: [], tasks, legacyCalls: 0 }
  const task = (id: string | null) => {
    let row = tasks.find(t => t.id === id)
    if (!row) { row = { id, title: '未归属任务', ...emptyUsage() }; tasks.push(row) }
    return row
  }
  const add = (at: number, topic: string | null, values: Partial<UsageTotals>) => {
    if (at < start || at >= end || at > now) return
    const bucket = result.buckets.find(b => at >= b.start && at < b.end)!
    for (const key of Object.keys(values) as (keyof UsageTotals)[]) {
      const value = values[key]!
      bucket[key] += value; result.totals[key] += value; task(topic)[key] += value
    }
  }
  const runs = db.prepare(`SELECT id,topic_id,status,created_at,updated_at,substr(summary,1,240) AS summary FROM runs WHERE character_id=? AND created_at<? AND (updated_at>=? OR status IN ('queued','running','waiting','interrupted')) ${query.topicId ? 'AND topic_id=?' : ''}`)
    .all(characterId, Math.min(end, now + 1), start, ...(query.topicId ? [query.topicId] : [])) as { id: string; topic_id: string | null; status: string; created_at: number; updated_at: number; summary: string }[]
  if (query.timeline) result.runSummaries = runs.filter(run => run.summary.trim()).map(run => ({ runId: run.id, title: run.summary }))
  for (const run of runs) {
    const events = db.prepare('SELECT kind,at FROM events WHERE run_id=? ORDER BY at,id').all(run.id) as { kind: string; at: number }[]
    const precise = events.some(e => e.kind === 'execution-start')
    const finish = Math.min(end, now, ['queued', 'running', 'waiting', 'interrupted'].includes(run.status) ? now : run.updated_at)
    let cursor = run.created_at, state: ActivitySpan['state'] = 'queued'
    const append = (until: number) => {
      const from = Math.max(cursor, start), to = Math.min(until, finish)
      if (to > from) {
        result.spans.push({ runId: run.id, topicId: run.topic_id, start: from, end: to, state, approximate: !precise })
        for (const bucket of result.buckets) {
          const ms = Math.max(0, Math.min(to, bucket.end) - Math.max(from, bucket.start))
          if (ms) add(Math.max(from, bucket.start), run.topic_id, { [state === 'running' ? 'executionMs' : 'waitingMs']: ms })
        }
      }
      cursor = until
    }
    for (const event of events) {
      if (event.at > finish) break
      let next: ActivitySpan['state'] | undefined
      if (event.kind === 'execution-start') next = 'running'
      else if (event.kind === 'waiting') next = 'waiting'
      else if (event.kind === 'queued' || event.kind === 'answer') next = 'queued'
      else if (event.kind === 'interrupted') next = 'interrupted'
      else if (!precise && ['briefing', 'planning', 'plan', 'analysis', 'drafting', 'revising', 'checking'].includes(event.kind)) next = 'running'
      if (next && next !== state) { append(event.at); state = next }
    }
    append(finish)
    if (run.status === 'failed' && run.updated_at >= start && run.updated_at < end && run.updated_at <= now) {
      add(run.updated_at, run.topic_id, { failures: 1 }); result.activity.push({ runId: run.id, topicId: run.topic_id, at: run.updated_at, kind: 'failed' })
    }
  }
  const calls = db.prepare(`SELECT c.at,c.metadata,r.topic_id FROM calls c JOIN runs r ON r.id=c.run_id WHERE c.character_id=? AND c.at<? ${query.topicId ? 'AND r.topic_id=?' : ''} AND (c.at>=? OR json_extract(c.metadata,'$.recordedAt')>=?)`)
    .all(characterId, end, ...(query.topicId ? [query.topicId] : []), start, start) as { at: number; metadata: string | null; topic_id: string | null }[]
  for (const call of calls) {
    const meta = (call.metadata ? JSON.parse(call.metadata) : {}) as AIResponseMetadata & { recordedAt?: number }
    const at = meta.recordedAt ?? call.at
    // Calls count at request start; usage belongs to response completion.
    add(call.at, call.topic_id, { calls: 1 })
    if (at < start || at >= end || at > now) continue
    if (!meta.recordedAt) result.legacyCalls++
    const valid = (v: number | undefined) => Number.isSafeInteger(v) && v! >= 0
    add(at, call.topic_id, { samples: 1, reported: Number(valid(meta.usage?.totalTokens)), tokens: valid(meta.usage?.totalTokens) ? meta.usage!.totalTokens : 0, inputReported: Number(valid(meta.usage?.inputTokens)), outputReported: Number(valid(meta.usage?.outputTokens)), input: valid(meta.usage?.inputTokens) ? meta.usage!.inputTokens : 0, output: valid(meta.usage?.outputTokens) ? meta.usage!.outputTokens : 0 })
  }
  const reports = db.prepare(`SELECT p.run_id,r.topic_id,json_extract(p.value,'$.createdAt') AS at FROM reports p JOIN runs r ON r.id=p.run_id WHERE p.character_id=? ${query.topicId ? 'AND r.topic_id=?' : ''} AND json_extract(p.value,'$.createdAt')>=? AND json_extract(p.value,'$.createdAt')<?`)
    .all(characterId, ...(query.topicId ? [query.topicId] : []), start, Math.min(end, now + 1)) as { run_id: string; topic_id: string | null; at: number }[]
  for (const report of reports) { add(report.at, report.topic_id, { reports: 1 }); result.activity.push({ runId: report.run_id, topicId: report.topic_id, at: report.at, kind: 'report' }) }
  if (query.timeline) {
    result.heartbeats = (db.prepare(`SELECT h.id,h.topic_id AS topicId,h.started_at AS start,h.ended_at AS end FROM activity_heartbeats h
      JOIN topics t ON t.id=h.topic_id WHERE t.character_id=? AND h.started_at<? AND h.ended_at>?
      ${query.topicId ? 'AND h.topic_id=?' : ''} ORDER BY h.started_at`)
      .all(characterId, Math.min(end, now), start, ...(query.topicId ? [query.topicId] : [])) as NonNullable<AgentAnalytics['heartbeats']>)
      .map(heartbeat => ({ ...heartbeat, start: Math.max(start, heartbeat.start), end: Math.min(end, now, heartbeat.end) }))
    const logs = db.prepare(`SELECT e.id,e.run_id AS runId,r.topic_id AS topicId,e.at,e.kind,substr(e.text,1,600) AS text
      FROM events e JOIN runs r ON r.id=e.run_id WHERE r.character_id=? AND e.at>=? AND e.at<?
      ${query.topicId ? 'AND r.topic_id=?' : ''} ORDER BY e.at DESC,e.id DESC LIMIT 1001`)
      .all(characterId, start, Math.min(end, now + 1), ...(query.topicId ? [query.topicId] : [])) as NonNullable<AgentAnalytics['logs']>
    result.logs = logs.slice(0, 1000)
    result.logsTruncated = logs.length > 1000
  }
  return result
}
