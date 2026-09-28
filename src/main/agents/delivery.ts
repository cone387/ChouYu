import type Database from 'better-sqlite3'
import { validateDeliveryUpdate, type AgentDelivery, type DeliveryUpdate } from '../../shared/agent-delivery'
import type { AgentReport, AgentTopicProgress } from '../../shared/agents'

/** All writes share the report transaction. Each version is an immutable full snapshot. */
export class AgentDeliveries {
  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS delivery_versions (
      topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
      value TEXT NOT NULL, PRIMARY KEY(topic_id, version));`)
  }
  get(topicId: string, version?: number): AgentDelivery | null {
    if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) throw new Error('成果版本无效。')
    const row = (version === undefined
      ? this.db.prepare('SELECT value FROM delivery_versions WHERE topic_id=? ORDER BY version DESC LIMIT 1').get(topicId)
      : this.db.prepare('SELECT value FROM delivery_versions WHERE topic_id=? AND version=?').get(topicId, version)) as { value: string } | undefined
    if (version !== undefined && !row) throw new Error('找不到该成果版本。')
    return row ? JSON.parse(row.value) : null
  }
  commit(topicId: string, report: AgentReport, progress: AgentTopicProgress, update?: DeliveryUpdate) {
    const previous = this.get(topicId)
    const value = update ? validateDeliveryUpdate(update) : {
      completionCriteria: previous?.completionCriteria || '尚未明确完成条件，请在聊天中补充。',
      stages: previous?.stages || [{ id: 'delivery', title: '推进并检查交付成果', status: 'active' as const }],
      summary: progress.judgement,
      section: { id: report.runId, title: report.title, body: report.body }
    }
    if (update && progress.status === 'completed' && value.stages.some(s => s.status !== 'done')) throw new Error('阶段尚未完成，不能结束整个事项。')
    const sections = [...(previous?.sections || [])]
    const index = sections.findIndex(s => s.id === value.section.id)
    const section = { ...value.section, runId: report.runId, sources: report.evidence.map(({ url, title, capturedAt }) => ({ url, title, capturedAt })) }
    if (index < 0) sections.push(section); else sections[index] = section
    if (sections.length > 300 || sections.reduce((n, s) => n + s.body.length, 0) > 1000000) throw new Error('单个成果已达到容量上限，请结束此事项并分卷继续。')
    const artifact: AgentDelivery = { version: (previous?.version ?? 0) + 1, runId: report.runId, createdAt: report.createdAt, completionCriteria: value.completionCriteria, stages: value.stages, summary: value.summary, sections }
    this.db.prepare('INSERT INTO delivery_versions VALUES(?,?,?,?)').run(topicId, artifact.version, report.runId, JSON.stringify(artifact))
  }
  context(topicId: string) {
    const value = this.get(topicId)
    if (!value) return null
    // Stable directory and cumulative summary survive beyond the recent-three-report window.
    return { version: value.version, completionCriteria: value.completionCriteria, stages: value.stages, summary: value.summary,
      directory: value.sections.map(s => ({ id: s.id, title: s.title })),
      sections: value.sections.slice(-3) }
  }
}
