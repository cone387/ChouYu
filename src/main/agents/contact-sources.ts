import { createHash } from 'node:crypto'
import type { AgentEvidence, ContactDeliveryRef } from '../../shared/agents'
import type { AgentStore } from './store'

/** Only published deliverables cross contact boundaries; never chats, memories or credentials. */
export class ContactSources {
  names = new Map<string, string>()
  constructor(private store: AgentStore) {}
  allowed(reader: string, owner: string) {
    if (!this.store.overview(reader).settings.readContactDeliveries) throw new Error('未授权读取联系人的共享成果。')
    if (reader === owner || !this.store.profile(owner) || !this.store.overview(owner).settings.shareDeliveries) throw new Error('该联系人的成果未共享或已撤回。')
  }
  private evidence(ref: ContactDeliveryRef): AgentEvidence {
    const topic = this.store.topics.get(ref.characterId, ref.topicId)
    const delivery = this.store.deliveries.get(ref.topicId, ref.version)
    const section = delivery?.sections.find(s => s.id === ref.sectionId)
    if (!section) throw new Error('找不到指定版本的成果分节。')
    return { url: `contact-delivery://${ref.characterId}/${ref.topicId}/${ref.sectionId}?version=${ref.version}`,
      title: `${this.names.get(ref.characterId) || ref.characterId} · ${topic.title} · ${section.title}`,
      text: section.body, capturedAt: Date.now(), hash: createHash('sha256').update(section.title + '\n' + section.body).digest('hex') }
  }
  private consumed(reader: string, topicId: string) {
    this.store.topics.get(reader, topicId)
    const rows = this.store.db.prepare('SELECT reports.value FROM reports JOIN runs ON runs.id=reports.run_id WHERE runs.character_id=? AND runs.topic_id=?').all(reader, topicId) as { value: string }[]
    return new Set(rows.flatMap(row => (JSON.parse(row.value).evidence as AgentEvidence[]).filter(e => e.url.startsWith('contact-delivery://')).map(e => `${e.url.split('?')[0]}:${e.hash}`)))
  }
  discover(reader: string, topicId: string, query: string) {
    if (!this.store.overview(reader).settings.readContactDeliveries) throw new Error('未授权读取联系人的共享成果。')
    const consumed = this.consumed(reader, topicId)
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
    const results: { ref: ContactDeliveryRef; contact: string; task: string; title: string; processed: boolean }[] = []
    for (const profile of this.store.profiles()) {
      if (profile.character_id === reader || !JSON.parse(profile.settings).shareDeliveries) continue
      for (const topic of this.store.topics.list(profile.character_id)) {
        const delivery = this.store.deliveries.get(topic.id)
        if (!delivery) continue
        for (const section of delivery.sections) {
          const contact = this.names.get(profile.character_id) || profile.character_id
          if (!terms.every(term => `${contact} ${topic.title} ${section.title}`.toLocaleLowerCase().includes(term))) continue
          const ref = { characterId: profile.character_id, topicId: topic.id, sectionId: section.id, version: delivery.version }
          const evidence = this.evidence(ref)
          results.push({ ref, contact, task: topic.title, title: section.title, processed: consumed.has(`${evidence.url.split('?')[0]}:${evidence.hash}`) })
        }
      }
    }
    results.sort((a, b) => Number(a.processed) - Number(b.processed))
    return { total: results.length, items: results.slice(0, 30), truncated: results.length > 30 }
  }
  read(reader: string, topicId: string, refs: ContactDeliveryRef[]) {
    const consumed = this.consumed(reader, topicId)
    return refs.flatMap(ref => {
      this.allowed(reader, ref.characterId)
      const evidence = this.evidence(ref), key = `${evidence.url.split('?')[0]}:${evidence.hash}`
      if (consumed.has(key)) return []
      consumed.add(key)
      return [evidence]
    })
  }
}
