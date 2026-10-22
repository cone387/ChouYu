import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { ApplicationMetadataRepository } from './application-metadata'
import { ConversationRepository } from './conversations'
import { backupApplicationFile, recoverApplicationFile } from './conversation-recovery'

export const APPLICATION_FILENAME = 'chouyu-application.db'
export interface ApplicationDatabase {
  db: Database.Database; metadata: ApplicationMetadataRepository; conversations: ConversationRepository
  notice: string | null; filename: string
  transaction<T>(fn: () => T): T
  flush(): void
  backup(): void
  close(): void
}
export function openApplicationDatabase(directory: string): ApplicationDatabase {
  fs.mkdirSync(directory, { recursive: true })
  const filename = path.join(directory, APPLICATION_FILENAME), notice = recoverApplicationFile(filename)
  const db = new Database(filename)
  try {
    db.pragma('foreign_keys = ON'); db.pragma('journal_mode = WAL'); db.pragma('synchronous = FULL')
    db.exec(`CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,position INTEGER NOT NULL,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,id TEXT NOT NULL,position INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(session_id,id));
      CREATE INDEX IF NOT EXISTS message_order ON messages(session_id,position);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery_receipts(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      PRAGMA user_version = 1;`)
    const metadata = new ApplicationMetadataRepository(db), conversations = new ConversationRepository(db, metadata)
    return { db, metadata, conversations, notice, filename,
      transaction<T>(fn: () => T): T { return db.transaction(fn)() },
      flush(): void { db.pragma('wal_checkpoint(PASSIVE)') },
      backup(): void { backupApplicationFile(db, filename) },
      close(): void { if (db.open) db.close() }
    }
  } catch (error) { db.close(); throw error }
}
