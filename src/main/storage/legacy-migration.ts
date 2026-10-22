import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { ChatSession } from '../../shared/conversations'
import type { ApplicationDatabase } from './application-database'
import { writeStoreFile } from '../store-file'

export interface ApplicationSnapshot { sessions: ChatSession[]; config: unknown; characters: unknown; activeSessionId: string; state: Record<string, string> }
interface Migration { id: string; sourceDigest: string | null }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export function readApplicationSnapshot(app: ApplicationDatabase): ApplicationSnapshot {
  return { sessions: app.conversations.listSessions(), config: app.metadata.get('config'), characters: app.metadata.get('characters'),
    activeSessionId: app.metadata.get<string>('activeSessionId') ?? '', state: app.metadata.readState() }
}
export function saveApplicationSnapshot(app: ApplicationDatabase, value: ApplicationSnapshot): void {
  for (const session of value.sessions) app.conversations.saveSession(session)
  app.conversations.orderSessions(value.sessions.map(s => s.id))
  for (const key of ['config', 'characters', 'activeSessionId'] as const) app.metadata.set(key, value[key])
  app.metadata.saveState(value.state)
}
export function migrateLegacyStore(directory: string, app: ApplicationDatabase, snapshot?: ApplicationSnapshot): void {
  const filename = path.join(directory, 'chouyu-data.json')
  let text: string | undefined
  try { text = fs.readFileSync(filename, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const original = text === undefined ? null : JSON.parse(text)
  if (original?.version > 5) throw new Error('NEWER_STORE_VERSION')
  let migration = app.metadata.get<Migration>('migration')
  if (original?.version === 5) {
    if (!migration || original.storage !== 'sqlite' || original.migrationId !== migration.id) throw new Error('Migration identity mismatch')
    return
  }
  if (migration) {
    if (text !== undefined && digest(text) !== migration.sourceDigest) throw new Error('Legacy source changed after migration')
  } else {
    if (!snapshot) throw new Error('Migration snapshot required')
    if (text !== undefined) {
      if (!Array.isArray(original?.sessions) && !Array.isArray(original?.messages)) throw new Error('Invalid conversations')
      const backup = filename + '.legacy'
      if (fs.existsSync(backup)) {
        if (fs.readFileSync(backup, 'utf8') !== text) throw new Error('Legacy recovery snapshot differs')
      } else writeStoreFile(backup, text, JSON.parse)
    }
    migration = { id: randomUUID(), sourceDigest: text === undefined ? null : digest(text) }
    app.transaction(() => {
      saveApplicationSnapshot(app, snapshot)
      const expected = { sessions: snapshot.sessions, config: snapshot.config, characters: snapshot.characters, activeSessionId: snapshot.activeSessionId, state: snapshot.state }
      if (!isDeepStrictEqual(readApplicationSnapshot(app), JSON.parse(JSON.stringify(expected)))) throw new Error('Migration verification failed')
      app.metadata.set('migration', migration)
    })
  }
  // This barrier must succeed before any new product writes are allowed.
  writeStoreFile(filename, JSON.stringify({ version: 5, storage: 'sqlite', database: 'chouyu-application.db', migrationId: migration.id }), raw => {
    const current = JSON.parse(raw)
    if (current.version > 5) throw new Error('NEWER_STORE_VERSION')
  })
}
