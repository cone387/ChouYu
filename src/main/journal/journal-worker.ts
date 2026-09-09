import { initializeSemanticCache, readSemanticCache, writeSemanticCache, clearSemanticCache } from './semantic-cache'
import { initializeJournalWeekly, weeklySources, listWeekly, createWeekly, editWeekly, deleteWeekly } from './weekly'
import { initializeSaved, saveJournalItem, listSaved, updateSaved, generateContinuations, saveQuickBookmark, savedUsage, replaceSaved } from './saved'
import { initializeJournalProjects, readJournalProjects, saveJournalProject, assignJournalProject, deleteJournalProject } from './projects'
import { initializeJournalPlaybook, listJournalPlaybook, saveJournalPlaybook, deleteJournalPlaybook } from './playbook'
import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'
import { randomUUID, createHash } from 'crypto'
import { DEFAULT_JOURNAL_CONFIG, migrateJournalConfig, validateJournalConfig, validateJournalQuery } from '../../shared/journal'
import type { JournalActivity, JournalConfig } from '../../shared/journal'
import { readJournalDay, readJournalEvidence } from './evidence'
import { pruneTaskOverrides, readTaskData, readCorrectedSummary, reconcileTaskIds } from './tasks'

mkdirSync(workerData.directory, { recursive: true })
const db = new Database(join(workerData.directory, 'journal.db'))
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 3000')
db.pragma('secure_delete = ON')
const previousVersion = Number(db.pragma('user_version', { simple: true }))
if (previousVersion > 11) throw new Error('工作日志由更新版本创建，请升级应用。')
db.exec(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY, app TEXT NOT NULL, title TEXT NOT NULL, startedAt INTEGER NOT NULL, endedAt INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS activities_time ON activities(endedAt, startedAt);
  CREATE TABLE IF NOT EXISTS captures (id TEXT PRIMARY KEY, activityId INTEGER NOT NULL, app TEXT NOT NULL, title TEXT NOT NULL, capturedAt INTEGER NOT NULL,
    width INTEGER NOT NULL, height INTEGER NOT NULL, bytes INTEGER NOT NULL, hash TEXT NOT NULL, ocrText TEXT NOT NULL DEFAULT '', ocrStatus TEXT NOT NULL DEFAULT 'pending', ocrError TEXT NOT NULL DEFAULT '', UNIQUE(activityId,hash));
  CREATE INDEX IF NOT EXISTS captures_time ON captures(capturedAt);
  CREATE INDEX IF NOT EXISTS captures_ocr ON captures(ocrStatus,capturedAt);
  CREATE TABLE IF NOT EXISTS media_gc (name TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS summaries (fromTs INTEGER NOT NULL, toTs INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(fromTs,toTs));
  CREATE TABLE IF NOT EXISTS task_overrides (id TEXT PRIMARY KEY, fromTs INTEGER NOT NULL, toTs INTEGER NOT NULL, value TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS task_overrides_range ON task_overrides(fromTs,toTs);
  CREATE TABLE IF NOT EXISTS analysis_records (id TEXT PRIMARY KEY, fromTs INTEGER NOT NULL, toTs INTEGER NOT NULL, createdAt INTEGER NOT NULL, value TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS analysis_records_range ON analysis_records(fromTs,toTs,createdAt);
  `)
db.transaction(() => {
  const row = db.prepare('SELECT value FROM settings WHERE id=1').get() as { value: string } | undefined
  const config = migrateJournalConfig(row ? JSON.parse(row.value) : {}, previousVersion)
  // Smoke fixtures explicitly opt out before the service can start its first sample.
  if (workerData.recordingDisabled) { config.enabled = false; config.captureEnabled = false; config.quickBookmarkEnabled = false }
  db.prepare('INSERT OR REPLACE INTO settings(id,value) VALUES(1,?)').run(JSON.stringify(config))
  initializeSaved(db)
  initializeJournalProjects(db)
  initializeJournalPlaybook(db)
  initializeJournalWeekly(db)
  initializeSemanticCache(db)
  db.pragma('user_version = 11')
})()
const media = join(workerData.directory, 'media')
mkdirSync(media, { recursive: true })
const mediaName = (id: unknown) => {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效画面 ID。')
  return `${id}.jpg`
}
let generation = 0
const invalidate = () => { generation++; db.prepare('DELETE FROM summaries').run(); pruneTaskOverrides(db) }
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
    db.prepare('DELETE FROM analysis_records WHERE toTs <= ?').run(before)
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
      case 'generateContinuations': result = generateContinuations(db, media, payload); break
      case 'quickBookmark': result = saveQuickBookmark(db, payload); break
      case 'saveItem': result = saveJournalItem(db, media, payload); break
      case 'savedItems': result = listSaved(db); break
      case 'projects': result = readJournalProjects(db); break
      case 'weeklySources': result = weeklySources(db, payload); break
      case 'weekly': result = listWeekly(db); break
      case 'createWeekly': result = createWeekly(db, payload); break
      case 'editWeekly': result = editWeekly(db, payload); break
      case 'deleteWeekly': result = deleteWeekly(db, payload); break
      case 'playbook': result = listJournalPlaybook(db); break
      case 'savePlaybook': result = saveJournalPlaybook(db, payload); break
      case 'deletePlaybook': deleteJournalPlaybook(db, payload); break
      case 'saveProject': result = saveJournalProject(db, payload); break
      case 'assignProject': assignJournalProject(db, payload); break
      case 'deleteProject': deleteJournalProject(db, payload); break
      case 'readSemanticCache': result = readSemanticCache(db, payload); break
      case 'writeSemanticCache': writeSemanticCache(db, payload); break
      case 'clearSemanticCache': clearSemanticCache(db); break
      case 'semanticInput': {
        prune(settings().retentionDays)
        const { from, to, app } = validateJournalQuery(payload)
        const pattern = `%${app.replace(/[\\%_]/g, '\\$&')}%`
        const sql = `SELECT 'activity:'||id id,MAX(startedAt,?) at,app,title,'' text FROM activities WHERE endedAt>=? AND startedAt<? AND app LIKE ? ESCAPE '\\'
          UNION ALL SELECT 'capture:'||id id,capturedAt at,app,title,ocrText text FROM captures WHERE capturedAt>=? AND capturedAt<? AND app LIKE ? ESCAPE '\\'`
        const args = [from, from, to, pattern, from, to, pattern]
        const count = db.prepare(`SELECT COUNT(*) total,COALESCE(SUM(length(app)+length(title)+length(text)),0) characters FROM (${sql})`).get(...args) as { total: number; characters: number }
        if (count.total > 600 || count.characters > 2_000_000) throw new Error('所选范围超过 600 条来源或 200 万字符，请缩小日期或应用范围。')
        result = db.prepare(`SELECT * FROM (${sql}) ORDER BY at,id`).all(...args); break
      }
      case 'savedUsage': result = savedUsage(db); break
      case 'updateSaved': updateSaved(db, payload); break
      case 'deleteSaved': {
        mediaName(payload)
        db.prepare('DELETE FROM saved_items WHERE id=?').run(payload)
        db.pragma('wal_checkpoint(TRUNCATE)'); break
      }
      case 'savedOcrDone': {
        mediaName(payload.id)
        const row = db.prepare('SELECT value FROM saved_items WHERE id=?').get(payload.id) as { value: string } | undefined
        if (!row) throw new Error('收藏已删除，识别结果已丢弃。')
        const item = JSON.parse(row.value)
        if (!item.capture) throw new Error('这份收藏没有画面。')
        item.capture.ocrText = String(payload.text || '').slice(0, 30000)
        item.capture.ocrStatus = 'ready'; item.capture.ocrError = ''
        replaceSaved(db, item)
        result = item.capture; break
      }
      case 'savedImage': {
        mediaName(payload)
        const row = db.prepare('SELECT image FROM saved_items WHERE id=?').get(payload) as { image: Buffer | null } | undefined
        if (!row?.image) throw new Error('收藏画面不存在或已删除。')
        result = `data:image/jpeg;base64,${row.image.toString('base64')}`; break
      }
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
        const { from, to, query, offset, app } = validateJournalQuery(payload)
        const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`
        const appPattern = `%${app.replace(/[\\%_]/g, '\\$&')}%`
        const where = "endedAt >= ? AND startedAt < ? AND (app LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')"
        const args = [from, to, pattern, pattern, appPattern]
        const filtered = `${where} AND app LIKE ? ESCAPE '\\'`
        const items = db.prepare(`SELECT id,app,title,MAX(startedAt,?) startedAt,MIN(endedAt,?) endedAt FROM activities WHERE ${filtered} ORDER BY startedAt DESC,id DESC LIMIT 100 OFFSET ?`).all(from, to, ...args, offset)
        const totals = db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(MIN(endedAt,?)-MAX(startedAt,?)),0) durationMs FROM activities WHERE ${filtered}`).get(to, from, ...args) as object
        result = { items, ...totals }; break
      }
      case 'deleteRange': {
        const { from, to } = validateJournalQuery(payload)
        // Delete whole overlapping fragments so no title from the requested period remains.
        cut(); db.transaction(() => {
          queueMediaDeletion('(capturedAt >= ? AND capturedAt < ?) OR activityId IN (SELECT id FROM activities WHERE endedAt >= ? AND startedAt < ?)', [from, to, from, to])
          db.prepare('DELETE FROM activities WHERE endedAt >= ? AND startedAt < ?').run(from, to)
          db.prepare('DELETE FROM analysis_records WHERE toTs > ? AND fromTs < ?').run(from, to)
          invalidate()
        })()
        garbageCollect()
        if ((db.prepare('SELECT COUNT(*) total FROM media_gc').get() as { total: number }).total) throw new Error('记录索引已删除，但部分图片文件被占用；请稍后再次删除以完成清理。')
        db.pragma('wal_checkpoint(TRUNCATE)'); break
      }
      case 'tasks':
      case 'detail': {
        prune(settings().retentionDays)
        const { from, to, query, offset } = validateJournalQuery(payload)
        const data = readTaskData(db, from, to)
        if (method === 'tasks') {
          const needle = query.toLocaleLowerCase()
          const items = data.tasks.filter(item => [item.title, item.text, item.note, item.category, ...item.apps].join('\n').toLocaleLowerCase().includes(needle))
          result = { items: items.slice(offset, offset + 100), total: items.length, organized: data.tasks.filter(item => item.organized).length }
        } else {
          if (typeof payload.id !== 'string') throw new Error('无效事项。')
          let task = data.tasks.find(item => item.id === payload.id)
          if (!task && payload.id.startsWith('activity:')) {
            const activityId = Number(payload.id.slice(9))
            task = data.tasks.find(item => item.activityIds.includes(activityId))
          }
          if (!task && payload.id.startsWith('capture:')) task = data.tasks.find(item => item.captureIds.includes(payload.id.slice(8)))
          if (!task) throw new Error('事项已删除或不在所选日期。')
          result = { task, activities: data.activities.filter(item => task!.activityIds.includes(item.id)), captures: data.captures.filter(item => task!.captureIds.includes(item.id)) }
        }
        break
      }
      case 'editTask': {
        const { from, to } = validateJournalQuery(payload)
        if (typeof payload.id !== 'string' || typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 200 || typeof payload.category !== 'string' || payload.category.length > 40 || typeof payload.note !== 'string' || payload.note.length > 4000) throw new Error('标题须为 1–200 字，分类最多 40 字，备注最多 4000 字。')
        const task = readTaskData(db, from, to).tasks.find(item => item.id === payload.id)
        if (!task) throw new Error('事项已删除，请刷新。')
        const value = { id: task.id, from, to, title: payload.title.trim(), category: payload.category.trim(), note: payload.note.trim(), item: { id: task.id, title: task.title, text: task.text, kind: task.kind, nextStep: task.nextStep, sourceIds: task.sourceIds } }
        db.prepare('INSERT OR REPLACE INTO task_overrides VALUES(?,?,?,?)').run(`${from}:${to}:${task.id}`, from, to, JSON.stringify(value))
        generation++; break
      }
      case 'deleteActivity':
      case 'deleteCapture': {
        if (method === 'deleteActivity' && (!Number.isSafeInteger(payload) || payload <= 0)) throw new Error('无效活动 ID。')
        if (method === 'deleteCapture') mediaName(payload)
        cut(); db.transaction(() => {
          queueMediaDeletion(method === 'deleteActivity' ? 'activityId=?' : 'id=?', [payload])
          if (method === 'deleteActivity') db.prepare('DELETE FROM activities WHERE id=?').run(payload)
          invalidate()
        })()
        garbageCollect()
        if ((db.prepare('SELECT COUNT(*) total FROM media_gc').get() as { total: number }).total) throw new Error('记录已删除，但图片文件被占用；请稍后重试清理。')
        db.pragma('wal_checkpoint(TRUNCATE)'); break
      }
      case 'captureInfo': {
        mediaName(payload)
        result = db.prepare('SELECT * FROM captures WHERE id=?').get(payload)
        if (!result) throw new Error('画面已删除或不存在。')
        break
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
        const { from, to, query, offset, app } = validateJournalQuery(payload)
        const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`
        const appPattern = `%${app.replace(/[\\%_]/g, '\\$&')}%`
        const where = "capturedAt >= ? AND capturedAt < ? AND (app LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR ocrText LIKE ? ESCAPE '\\')"
        const args = [from, to, pattern, pattern, pattern, appPattern]
        const filtered = `${where} AND app LIKE ? ESCAPE '\\'`
        const items = db.prepare(`SELECT * FROM captures WHERE ${filtered} ORDER BY capturedAt DESC,id DESC LIMIT 30 OFFSET ?`).all(...args, offset)
        const total = (db.prepare(`SELECT COUNT(*) total FROM captures WHERE ${filtered}`).get(...args) as { total: number }).total
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
      case 'overview': {
        prune(settings().retentionDays)
        const { from, to } = validateJournalQuery(payload)
        result = readJournalDay(db, from, to); break
      }
      case 'analysisRecover': {
        db.prepare("UPDATE analysis_records SET value=json_set(value,'$.state','cancelled') WHERE json_extract(value,'$.state')='running'").run()
        break
      }
      case 'analysisStart': {
        const record = { ...payload, id: randomUUID(), createdAt: Date.now(), state: 'running' }
        db.prepare('INSERT INTO analysis_records VALUES(?,?,?,?,?)').run(record.id, record.from, record.to, record.createdAt, JSON.stringify(record))
        result = record.id; break
      }
      case 'analysisFinish': {
        const row = db.prepare('SELECT value FROM analysis_records WHERE id=?').get(payload.id) as { value: string } | undefined
        // A late result must never recreate a deleted day's metadata.
        if (row) db.prepare('UPDATE analysis_records SET value=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(row.value), ...payload, finishedAt: Date.now() }), payload.id)
        break
      }
      case 'analysisRecords': {
        prune(settings().retentionDays)
        const { from, to } = validateJournalQuery(payload)
        result = (db.prepare('SELECT value FROM analysis_records WHERE toTs > ? AND fromTs < ? ORDER BY createdAt DESC, id DESC').all(from, to) as { value: string }[]).map(row => JSON.parse(row.value))
        break
      }
      case 'summaryInput': {
        prune(settings().retentionDays)
        const { from, to } = validateJournalQuery(payload)
        result = { ...readJournalEvidence(db, from, to, payload.query || ''), generation }; break
      }
      case 'summarySave': {
        if (payload.generation !== generation) throw new Error('来源已删除或过期，请重新生成总结。')
        const summary = payload.summary
        const old = readTaskData(db, summary.from, summary.to)
        summary.items = reconcileTaskIds(summary.items, [...old.overrides.map(edit => ({ ...edit.item, id: edit.id })), ...(old.summary?.items || []).filter(item => !old.overrides.some(edit => edit.id === item.id))])
        db.prepare('INSERT OR REPLACE INTO summaries VALUES(?,?,?)').run(summary.from, summary.to, JSON.stringify(summary)); result = readCorrectedSummary(db, summary.from, summary.to); break
      }
      case 'summary': {
        prune(settings().retentionDays)
        const { from, to } = validateJournalQuery(payload)
        result = readCorrectedSummary(db, from, to); break
      }
      case 'close': db.close(); parentPort!.postMessage({ id, result: null }); parentPort!.close(); return
      default: throw new Error('未知日志存储操作。')
    }
    parentPort!.postMessage({ id, result: result ?? null })
  } catch (error) { parentPort!.postMessage({ id, error: error instanceof Error ? error.message : '日志存储失败。' }) }
})
