import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'
import { randomUUID, createHash } from 'crypto'
import { DEFAULT_JOURNAL_CONFIG, validateJournalConfig, validateJournalQuery } from '../../shared/journal'
import type { JournalActivity, JournalConfig, JournalCapture, JournalEvidence } from '../../shared/journal'

mkdirSync(workerData.directory, { recursive: true })
const db = new Database(join(workerData.directory, 'journal.db'))
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 3000')
db.pragma('secure_delete = ON')
if (Number(db.pragma('user_version', { simple: true })) > 2) throw new Error('工作日志由更新版本创建，请升级应用。')
db.exec(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY, app TEXT NOT NULL, title TEXT NOT NULL, startedAt INTEGER NOT NULL, endedAt INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS activities_time ON activities(endedAt, startedAt);
  CREATE TABLE IF NOT EXISTS captures (id TEXT PRIMARY KEY, activityId INTEGER NOT NULL, app TEXT NOT NULL, title TEXT NOT NULL, capturedAt INTEGER NOT NULL,
    width INTEGER NOT NULL, height INTEGER NOT NULL, bytes INTEGER NOT NULL, hash TEXT NOT NULL, ocrText TEXT NOT NULL DEFAULT '', ocrStatus TEXT NOT NULL DEFAULT 'pending', ocrError TEXT NOT NULL DEFAULT '', UNIQUE(activityId,hash));
  CREATE INDEX IF NOT EXISTS captures_time ON captures(capturedAt);
  CREATE INDEX IF NOT EXISTS captures_ocr ON captures(ocrStatus,capturedAt);
  CREATE TABLE IF NOT EXISTS media_gc (name TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS summaries (fromTs INTEGER NOT NULL, toTs INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(fromTs,toTs));
  PRAGMA user_version = 2;`)
const media = join(workerData.directory, 'media')
mkdirSync(media, { recursive: true })
const mediaName = (id: unknown) => {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效画面 ID。')
  return `${id}.jpg`
}
let generation = 0
const invalidate = () => { generation++; db.prepare('DELETE FROM summaries').run() }
const garbageCollect = () => {
  for (const { name } of db.prepare('SELECT name FROM media_gc').all() as { name: string }[]) {
    if (!/^[a-f0-9-]{36}\.(?:jpg|part)$/.test(name)) continue
    try { unlinkSync(join(media, name)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue }
    db.prepare('DELETE FROM media_gc WHERE name=?').run(name)
  }
}
// Recover interrupted writes and unfinished deletions; only generated media filenames qualify.
for (const name of readdirSync(media)) {
  if (/^[a-f0-9-]{36}\.(?:jpg|part)$/.test(name) && (name.endsWith('.part') || !db.prepare('SELECT 1 FROM captures WHERE id=?').get(name.slice(0, -4)))) db.prepare('INSERT OR IGNORE INTO media_gc VALUES(?)').run(name)
}
garbageCollect()
const storageBytes = () => {
  let total = (db.prepare('SELECT COALESCE(SUM(bytes),0) total FROM captures').get() as { total: number }).total
  for (const row of db.prepare('SELECT name FROM media_gc').all() as { name: string }[]) { try { total += statSync(join(media, row.name)).size } catch {} }
  return total
}
const queueMediaDeletion = (where: string, args: unknown[]) => {
  db.prepare(`INSERT OR IGNORE INTO media_gc SELECT id || '.jpg' FROM captures WHERE ${where}`).run(...args)
  return db.prepare(`DELETE FROM captures WHERE ${where}`).run(...args).changes
}
let activeId: number | null = null
let last: JournalActivity | null = null
const cut = () => { activeId = null; last = null }
const settings = (): JournalConfig => {
  const row = db.prepare('SELECT value FROM settings WHERE id=1').get() as { value: string } | undefined
  return row ? validateJournalConfig(JSON.parse(row.value), DEFAULT_JOURNAL_CONFIG) : { ...DEFAULT_JOURNAL_CONFIG }
}
const prune = (days: number) => {
  const before = Date.now() - days * 86400_000
  db.transaction(() => {
    const removed = queueMediaDeletion('capturedAt < ? OR activityId IN (SELECT id FROM activities WHERE endedAt < ?)', [before, before])
    const changed = db.prepare('DELETE FROM activities WHERE endedAt < ?').run(before).changes
    db.prepare('UPDATE activities SET startedAt=? WHERE startedAt < ? AND endedAt >= ?').run(before, before, before)
    if (removed || changed) invalidate()
  })()
  garbageCollect()
}
let lastPrune = 0
parentPort!.on('message', ({ id, method, payload }) => {
  try {
    let result: unknown
    switch (method) {
      case 'config': result = settings(); prune((result as JournalConfig).retentionDays); break
      case 'configure': {
        const next = validateJournalConfig(payload, settings())
        db.transaction(() => { db.prepare('INSERT OR REPLACE INTO settings(id,value) VALUES(1,?)').run(JSON.stringify(next)); prune(next.retentionDays) })()
        cut(); result = next; break
      }
      case 'cut': cut(); break
      case 'sample': {
        const { app, title, at } = payload as { app: string; title: string; at: number }
        if (last && activeId && last.app === app && last.title === title && at >= last.endedAt && at - last.endedAt <= 12_000) {
          db.prepare('UPDATE activities SET endedAt=? WHERE id=?').run(at, activeId)
          last.endedAt = at
        } else {
          activeId = Number(db.prepare('INSERT INTO activities(app,title,startedAt,endedAt) VALUES(?,?,?,?)').run(app, title, at, at).lastInsertRowid)
          last = { id: activeId, app, title, startedAt: at, endedAt: at }
        }
        if (at - lastPrune > 3600_000) { prune(settings().retentionDays); lastPrune = at }
        result = activeId
        break
      }
      case 'list': {
        prune(settings().retentionDays)
        const { from, to, query, offset } = validateJournalQuery(payload)
        const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`
        const where = "endedAt >= ? AND startedAt < ? AND (app LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')"
        const args = [from, to, pattern, pattern]
        const items = db.prepare(`SELECT id,app,title,MAX(startedAt,?) startedAt,MIN(endedAt,?) endedAt FROM activities WHERE ${where} ORDER BY startedAt DESC,id DESC LIMIT 100 OFFSET ?`).all(from, to, ...args, offset)
        const totals = db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(MIN(endedAt,?)-MAX(startedAt,?)),0) durationMs FROM activities WHERE ${where}`).get(to, from, ...args) as object
        result = { items, ...totals }; break
      }
      case 'deleteRange': {
        const { from, to } = validateJournalQuery(payload)
        // Delete whole overlapping fragments so no title from the requested period remains.
        cut(); db.transaction(() => {
          queueMediaDeletion('(capturedAt >= ? AND capturedAt < ?) OR activityId IN (SELECT id FROM activities WHERE endedAt >= ? AND startedAt < ?)', [from, to, from, to])
          db.prepare('DELETE FROM activities WHERE endedAt >= ? AND startedAt < ?').run(from, to)
          invalidate()
        })()
        garbageCollect()
        if ((db.prepare('SELECT COUNT(*) total FROM media_gc').get() as { total: number }).total) throw new Error('记录索引已删除，但部分图片文件被占用；请稍后再次删除以完成清理。')
        db.pragma('wal_checkpoint(TRUNCATE)'); break
      }
      case 'capture': {
        const { activityId, width, height, at } = payload
        const activity = db.prepare('SELECT * FROM activities WHERE id=?').get(activityId) as JournalActivity | undefined
        if (!activity) throw new Error('活动已删除，跳过画面。')
        const bytes = Buffer.from(payload.bytes)
        if (!bytes.length || bytes.length > 5_000_000 || !Number.isSafeInteger(at) || width < 1 || height < 1) throw new Error('无效画面。')
        const hash = createHash('sha256').update(bytes).digest('hex')
        const existing = db.prepare('SELECT id FROM captures WHERE activityId=? AND hash=?').get(activityId, hash)
        if (existing) { result = existing; break }
        garbageCollect()
        if (storageBytes() + bytes.length > settings().maxStorageMB * 1024 * 1024) throw new Error('画面存储已达上限，请删除旧记录或调整上限；活动记录仍会继续。')
        const captureId = randomUUID(); const name = mediaName(captureId); const temporary = join(media, `${captureId}.part`)
        try {
          writeFileSync(temporary, bytes, { flag: 'wx' }); renameSync(temporary, join(media, name))
          db.prepare('INSERT INTO captures(id,activityId,app,title,capturedAt,width,height,bytes,hash) VALUES(?,?,?,?,?,?,?,?,?)').run(captureId, activityId, activity.app, activity.title, at, width, height, bytes.length, hash)
        } catch (error) {
          db.prepare('INSERT OR IGNORE INTO media_gc VALUES(?)').run(name)
          db.prepare('INSERT OR IGNORE INTO media_gc VALUES(?)').run(`${captureId}.part`)
          garbageCollect(); throw error
        }
        result = { id: captureId }; break
      }
      case 'captures': {
        prune(settings().retentionDays)
        const { from, to, query, offset } = validateJournalQuery(payload)
        const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`
        const where = "capturedAt >= ? AND capturedAt < ? AND (app LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR ocrText LIKE ? ESCAPE '\\')"
        const args = [from, to, pattern, pattern, pattern]
        const items = db.prepare(`SELECT * FROM captures WHERE ${where} ORDER BY capturedAt DESC,id DESC LIMIT 30 OFFSET ?`).all(...args, offset)
        const total = (db.prepare(`SELECT COUNT(*) total FROM captures WHERE ${where}`).get(...args) as { total: number }).total
        result = { items, total, storageBytes: storageBytes(), pendingOcr: (db.prepare("SELECT COUNT(*) total FROM captures WHERE ocrStatus='pending'").get() as { total: number }).total }; break
      }
      case 'image': {
        const filename = mediaName(payload)
        if (!db.prepare('SELECT 1 FROM captures WHERE id=?').get(payload)) throw new Error('画面已删除或不存在。')
        result = `data:image/jpeg;base64,${readFileSync(join(media, filename)).toString('base64')}`; break
      }
      case 'ocrNext': {
        const row = db.prepare("SELECT id FROM captures WHERE ocrStatus='pending' ORDER BY capturedAt ASC LIMIT 1").get() as { id: string } | undefined
        result = row ? { id: row.id, path: join(media, mediaName(row.id)) } : null; break
      }
      case 'ocrJob': {
        const filename = mediaName(payload)
        if (!db.prepare('SELECT 1 FROM captures WHERE id=?').get(payload)) throw new Error('画面已删除。')
        result = { id: payload, path: join(media, filename) }; break
      }
      case 'ocrDone': {
        mediaName(payload.id)
        db.prepare('UPDATE captures SET ocrText=?,ocrStatus=?,ocrError=? WHERE id=?').run(String(payload.text || '').slice(0, 30000), payload.error ? 'failed' : 'ready', String(payload.error || '').slice(0, 300), payload.id); break
      }
      case 'retryOcr': {
        mediaName(payload); db.prepare("UPDATE captures SET ocrStatus='pending',ocrError='' WHERE id=? AND ocrStatus='failed'").run(payload); break
      }
      case 'summaryInput': {
        prune(settings().retentionDays)
        const { from, to } = validateJournalQuery(payload)
        const activities = db.prepare('SELECT * FROM activities WHERE endedAt >= ? AND startedAt < ? ORDER BY startedAt DESC LIMIT 201').all(from, to) as JournalActivity[]
        const captures = db.prepare('SELECT * FROM captures WHERE capturedAt >= ? AND capturedAt < ? ORDER BY capturedAt DESC LIMIT 101').all(from, to) as JournalCapture[]
        const sources: JournalEvidence[] = [
          ...activities.slice(0, 200).map(item => ({ id: `activity:${item.id}`, at: Math.max(from, item.startedAt), app: item.app, title: item.title, text: `观察时段 ${new Date(Math.max(from, item.startedAt)).toISOString()} 至 ${new Date(Math.min(to, item.endedAt)).toISOString()}` })),
          ...captures.slice(0, 100).map(item => ({ id: `capture:${item.id}`, at: item.capturedAt, app: item.app, title: item.title, text: item.ocrText.slice(0, 3000) }))
        ].sort((a, b) => a.at - b.at)
        result = { sources, truncated: activities.length > 200 || captures.length > 100 || captures.some(item => item.ocrText.length > 3000), generation }; break
      }
      case 'summarySave': {
        if (payload.generation !== generation) throw new Error('来源已删除或过期，请重新生成总结。')
        const summary = payload.summary
        db.prepare('INSERT OR REPLACE INTO summaries VALUES(?,?,?)').run(summary.from, summary.to, JSON.stringify(summary)); result = summary; break
      }
      case 'summary': {
        prune(settings().retentionDays)
        const { from, to } = validateJournalQuery(payload)
        const row = db.prepare('SELECT value FROM summaries WHERE fromTs=? AND toTs=?').get(from, to) as { value: string } | undefined
        result = row ? JSON.parse(row.value) : null; break
      }
      case 'close': db.close(); parentPort!.postMessage({ id, result: null }); parentPort!.close(); return
      default: throw new Error('未知日志存储操作。')
    }
    parentPort!.postMessage({ id, result: result ?? null })
  } catch (error) { parentPort!.postMessage({ id, error: error instanceof Error ? error.message : '日志存储失败。' }) }
})
