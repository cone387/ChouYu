import { createHash } from 'node:crypto'
import type { ContactTaskStore } from '../task-center/contact-store'
import type { AgentDelivery } from '../../shared/agent-delivery'
import type { DeliveryRef } from '../../shared/contact-content'
import type { Handoff } from '../../shared/contact-handoffs'
import { ContactSources } from './contact-sources'

type Follow = { reader: string; topicId: string; sourceOwner: string; sourceTopicId: string; sectionId?: string }
type Row = { reader: string; topic_id: string; source_owner: string; source_topic: string; section_id: string; acknowledged: string; fingerprint: string; source_version: number }
export type DependencyUpdate = Follow & { sourceVersion: number; fingerprint: string }

/** One durable latest update per explicitly authorized relationship, in the task database. */
export class DeliveryDependencies {
  constructor(private store: ContactTaskStore) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS delivery_dependencies (
      reader TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,
      topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      source_owner TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,
      source_topic TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      section_id TEXT NOT NULL, acknowledged TEXT NOT NULL, fingerprint TEXT NOT NULL, source_version INTEGER NOT NULL,
      PRIMARY KEY(reader,topic_id,source_owner,source_topic,section_id));
      CREATE INDEX IF NOT EXISTS dependency_source ON delivery_dependencies(source_topic);
      CREATE TRIGGER IF NOT EXISTS dependency_task_ended AFTER UPDATE OF value ON topics
        WHEN json_extract(NEW.value,'$.status') IN ('abandoned','completed')
        BEGIN DELETE FROM delivery_dependencies WHERE topic_id=NEW.id; END;`)
  }
  private hash(artifact: AgentDelivery, sectionId?: string) {
    const sections = artifact.sections.filter(s => !sectionId || s.id === sectionId)
    if (!sections.length) return undefined
    return createHash('sha256').update(JSON.stringify(sections.map(s => [s.id, s.title, s.body]))).digest('hex')
  }
  follow(input: Follow): void {
    new ContactSources(this.store).allowed(input.reader, input.sourceOwner)
    this.store.topics.get(input.reader, input.topicId)
    this.store.topics.get(input.sourceOwner, input.sourceTopicId)
    const handoff = this.store.handoffs.forTopic(input.reader, input.topicId)
    if (!handoff?.continuous || handoff.source.characterId !== input.sourceOwner || handoff.source.topicId !== input.sourceTopicId || handoff.source.sectionId !== input.sectionId) throw new Error('此任务尚未授权持续跟随该成果。')
    this.register(handoff)
  }
  private register(handoff: Handoff) {
    const source = handoff.source
    if (!this.store.db.prepare('SELECT 1 FROM topics WHERE id=? AND character_id=?').get(handoff.topicId, handoff.recipientId) ||
        !this.store.db.prepare('SELECT 1 FROM topics WHERE id=? AND character_id=?').get(source.topicId, source.characterId)) return
    if (['abandoned', 'completed'].includes(this.store.topics.get(handoff.recipientId, handoff.topicId).status)) return
    const original = this.store.deliveries.get(source.topicId, source.version)
    const latest = this.store.deliveries.get(source.topicId)
    if (!original || !latest) return
    const last = this.store.db.prepare('SELECT hash FROM contact_handoff_reviews WHERE handoff_id=? ORDER BY rowid DESC LIMIT 1').get(handoff.id) as { hash: string } | undefined
    const acknowledged = last?.hash ?? this.hash(original, source.sectionId), fingerprint = this.hash(latest, source.sectionId)
    if (!acknowledged || !fingerprint) return
    this.store.db.prepare('INSERT OR IGNORE INTO delivery_dependencies VALUES(?,?,?,?,?,?,?,?)')
      .run(handoff.recipientId, handoff.topicId, source.characterId, source.topicId, source.sectionId ?? '', acknowledged, fingerprint, latest.version)
  }
  /** Existing confirmed handoffs carry their actual review watermark; never infer a read from prose. */
  backfill(): void {
    for (const row of this.store.db.prepare('SELECT value FROM contact_handoffs').all() as { value: string }[]) {
      const handoff = JSON.parse(row.value) as Handoff
      if (handoff.continuous) this.register(handoff)
    }
  }
  published(owner: string, artifact: AgentDelivery): void {
    const run = this.store.getRun(artifact.runId)
    if (!run?.topic_id || run.character_id !== owner) throw new Error('成果发布来源不匹配。')
    for (const row of this.store.db.prepare('SELECT * FROM delivery_dependencies WHERE source_owner=? AND source_topic=?').all(owner, run.topic_id) as Row[]) {
      const fingerprint = this.hash(artifact, row.section_id || undefined)
      if (!fingerprint || artifact.version < row.source_version) continue
      this.store.db.prepare('UPDATE delivery_dependencies SET fingerprint=?,source_version=? WHERE reader=? AND topic_id=? AND source_topic=? AND section_id=?')
        .run(fingerprint, artifact.version, row.reader, row.topic_id, row.source_topic, row.section_id)
    }
  }
  pending(reader: string): DependencyUpdate[] {
    return (this.store.db.prepare('SELECT * FROM delivery_dependencies WHERE reader=? AND fingerprint<>acknowledged').all(reader) as Row[]).flatMap(row => {
      try {
        new ContactSources(this.store).allowed(reader, row.source_owner)
        const source = this.store.deliveries.get(row.source_topic)
        if (!source || this.hash(source, row.section_id || undefined) !== row.fingerprint) return []
        return [{ reader, topicId: row.topic_id, sourceOwner: row.source_owner, sourceTopicId: row.source_topic,
          ...(row.section_id ? { sectionId: row.section_id } : {}), sourceVersion: row.source_version, fingerprint: row.fingerprint }]
      } catch { return [] }
    })
  }
  acknowledge(reader: string, topicId: string, fingerprint: string, source: DeliveryRef): void {
    new ContactSources(this.store).allowed(reader, source.characterId)
    this.store.topics.get(reader, topicId)
    const artifact = this.store.deliveries.get(source.topicId, source.version)
    if (!artifact || this.hash(artifact, source.sectionId) !== fingerprint) throw new Error('尚无匹配的固定成果版本，不能确认已处理。')
    this.store.db.prepare('UPDATE delivery_dependencies SET acknowledged=? WHERE reader=? AND topic_id=? AND source_owner=? AND source_topic=? AND section_id=?')
      .run(fingerprint, reader, topicId, source.characterId, source.topicId, source.sectionId ?? '')
  }
}
