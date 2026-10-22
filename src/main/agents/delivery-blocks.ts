import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { AgentDelivery, DeliverySection } from '../../shared/agent-delivery'

export type StoredDeliveryManifest = Omit<AgentDelivery, 'sections'> & {
  storage: 'blocks-v1'; sections: (Omit<DeliverySection, 'body'> & { bodyHash: string })[]
}
const hash = (body: string) => createHash('sha256').update(body, 'utf8').digest('hex')

/** Internal only: callers must check owner/topic/version before resolving a manifest. */
export function readStoredDelivery(db: Database.Database, raw: string): AgentDelivery {
  const value = JSON.parse(raw)
  if (value.storage === undefined) return value as AgentDelivery
  if (value.storage !== 'blocks-v1') throw new Error('不支持的成果存储格式。')
  const { storage: _, sections, ...metadata } = value as StoredDeliveryManifest
  const get = db.prepare('SELECT body FROM delivery_blocks WHERE hash=?')
  return { ...metadata, sections: sections.map(section => {
    const { bodyHash } = section
    const row = get.get(bodyHash) as { body: string } | undefined
    if (!row) throw new Error('成果正文块缺失，无法读取此版本。')
    if (hash(row.body) !== bodyHash) throw new Error('成果正文块损坏，无法读取此版本。')
    // Preserve serialized property order too: HTML exports embed section JSON.
    return Object.fromEntries(Object.entries(section).map(([key, value]) => key === 'bodyHash' ? ['body', row.body] : [key, value])) as unknown as DeliverySection
  }) }
}

export class DeliveryBlockStore {
  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS delivery_blocks(hash TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery_block_references(topic_id TEXT NOT NULL,version INTEGER NOT NULL,section_id TEXT NOT NULL,
        body_hash TEXT NOT NULL REFERENCES delivery_blocks(hash),PRIMARY KEY(topic_id,version,section_id),
        FOREIGN KEY(topic_id,version) REFERENCES delivery_versions(topic_id,version) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS delivery_block_hash ON delivery_block_references(body_hash);`)
    db.transaction(() => {
      // Keep only keys in memory; better-sqlite3 disallows writes during iteration.
      const keys = db.prepare("SELECT topic_id,version FROM delivery_versions WHERE json_extract(value,'$.storage') IS NULL").all() as { topic_id: string; version: number }[]
      for (const key of keys) {
        const row = db.prepare('SELECT topic_id,value FROM delivery_versions WHERE topic_id=? AND version=?').get(key.topic_id, key.version) as { topic_id: string; value: string }
        const artifact = JSON.parse(row.value) as AgentDelivery, manifest = this.write(artifact)
        if (!isDeepStrictEqual(this.read(manifest), artifact)) throw new Error('成果迁移内容不一致。')
        db.prepare('UPDATE delivery_versions SET value=? WHERE topic_id=? AND version=?').run(JSON.stringify(manifest), row.topic_id, artifact.version)
        this.link(row.topic_id, manifest)
      }
    })()
  }
  write(artifact: AgentDelivery): StoredDeliveryManifest {
    const put = this.db.prepare('INSERT OR IGNORE INTO delivery_blocks(hash,body) VALUES(?,?)')
    const get = this.db.prepare('SELECT body FROM delivery_blocks WHERE hash=?')
    return { ...artifact, storage: 'blocks-v1', sections: artifact.sections.map(section => {
      const { body } = section
      const bodyHash = hash(body)
      put.run(bodyHash, body)
      if ((get.get(bodyHash) as { body: string }).body !== body) throw new Error('成果正文块损坏，拒绝覆盖。')
      return Object.fromEntries(Object.entries(section).map(([key, value]) => key === 'body' ? ['bodyHash', bodyHash] : [key, value])) as StoredDeliveryManifest['sections'][number]
    }) }
  }
  read(manifest: StoredDeliveryManifest): AgentDelivery { return readStoredDelivery(this.db, JSON.stringify(manifest)) }
  link(topicId: string, manifest: StoredDeliveryManifest): void {
    const put = this.db.prepare('INSERT INTO delivery_block_references VALUES(?,?,?,?)')
    for (const section of manifest.sections) put.run(topicId, manifest.version, section.id, section.bodyHash)
  }
  collectUnreferenced(): void {
    this.db.exec('DELETE FROM delivery_blocks WHERE NOT EXISTS (SELECT 1 FROM delivery_block_references r WHERE r.body_hash=delivery_blocks.hash)')
  }
}
