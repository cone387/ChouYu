import type Database from 'better-sqlite3'
import { assertTaskEnding, recordOccurrence, type TaskEnding } from '../../../shared/task-ending'
import type { AgentTopic, AgentNotice } from '../../../shared/agents'
import type { RunRow } from './types'
/** Ending receipts share the formal-result/outbox transaction; acks share the notice transaction. */
export class ContactEndings {
  constructor(private db: Database.Database) {}
  retainCandidate(runId: string, raw: string): void {
    this.db.prepare("UPDATE runs SET input=json_set(input,'$.endingCandidate',json(?)) WHERE id=?")
      .run(JSON.stringify({ raw: raw.slice(0, 24000), retainedAt: Date.now(), reason: '到期后保留的未正式交付候选，不追加模型修复请求。' }), runId)
  }
  assertRun(runId: string, now = Date.now()): void {
    const row = this.db.prepare('SELECT t.value FROM topics t JOIN runs r ON r.topic_id=t.id WHERE r.id=?').get(runId) as { value: string } | undefined
    if (row) assertTaskEnding((JSON.parse(row.value) as AgentTopic).ending, now)
  }
  private write(topicId: string, ending: TaskEnding) { this.db.prepare("UPDATE topics SET value=json_set(value,'$.ending',json(?)) WHERE id=?").run(JSON.stringify(ending), topicId) }
  produced(run: RunRow): void {
    if (!run.topic_id) return
    const occurrence = JSON.parse(run.input).calendar
    if (!occurrence) return
    const topic = JSON.parse((this.db.prepare('SELECT value FROM topics WHERE id=?').get(run.topic_id) as { value: string }).value) as AgentTopic
    if (!topic.ending) return
    const notices = this.db.prepare("SELECT id FROM notices WHERE character_id=? AND json_extract(value,'$.runId')=? AND json_extract(value,'$.kind')='progress' AND json_extract(value,'$.purpose') IS NULL").all(run.character_id, run.id) as { id: string }[]
    if (!notices.length) return
    const id = `${occurrence.revision}:${occurrence.dueAt}`, next = recordOccurrence(topic.ending, id, 'produced')
    next.occurrences[id].noticeIds = notices.map(notice => notice.id)
    this.write(topic.id, next)
  }
  acknowledge(owner: string, noticeId: string): void {
    const row = this.db.prepare('SELECT value,state FROM notices WHERE character_id=? AND id=?').get(owner, noticeId) as { value: string; state: string } | undefined
    if (!row || row.state !== 'sent') return
    const notice = JSON.parse(row.value) as AgentNotice
    const topicRow = this.db.prepare('SELECT value FROM topics WHERE id=? AND character_id=?').get(notice.topicId, owner) as { value: string } | undefined
    const topic = topicRow && JSON.parse(topicRow.value) as AgentTopic | undefined
    if (!topic?.ending) return
    for (const [id, receipt] of Object.entries(topic.ending.occurrences)) {
      if (receipt.deliveredAt !== undefined || !receipt.noticeIds?.includes(noticeId)) continue
      if (receipt.noticeIds.every(id => (this.db.prepare('SELECT state FROM notices WHERE character_id=? AND id=?').get(owner, id) as { state: string } | undefined)?.state === 'sent'))
        this.write(topic.id, recordOccurrence(topic.ending, id, 'delivered'))
    }
  }
}
