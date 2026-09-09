import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { JournalCapture, JournalSavedItem, JournalSaveInput, JournalSample, JournalActivity, JournalTask, JournalSavedUsage } from '../../shared/journal'
import { validateJournalQuery } from '../../shared/journal'
import { readTaskData } from './tasks'
import { continuationCandidates, matchesContinuation } from './continuation'

// Snapshot images live in SQLite so saving metadata and bytes is atomic and
// ordinary media retention can never leave a half-saved bookmark behind.
export function initializeSaved(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS saved_items (id TEXT PRIMARY KEY, createdAt INTEGER NOT NULL, value TEXT NOT NULL, image BLOB)')
}

export function saveJournalItem(db: Database.Database, media: string, input: JournalSaveInput): JournalSavedItem {
  const { from, to } = validateJournalQuery(input)
  if (!['continuation', 'bookmark'].includes(input.kind) || typeof input.note !== 'string' || input.note.length > 4000 || typeof input.id !== 'string') throw new Error('无效收藏，备注最多 4000 字。')
  const data = readTaskData(db, from, to)
  const task = data.tasks.find(item => item.id === input.id)
  if (!task) throw new Error('事项已删除，请刷新后重试。')
  let capture: JournalCapture | null = null
  let image: Buffer | null = null
  if (input.captureId !== undefined && typeof input.captureId !== 'string') throw new Error('无效画面 ID。')
  if (input.captureId) {
    if (!/^[a-f0-9-]{36}$/.test(input.captureId) || !task.captureIds.includes(input.captureId)) throw new Error('画面不属于此事项。')
    capture = (db.prepare('SELECT * FROM captures WHERE id=?').get(input.captureId) as JournalCapture | undefined) || null
    if (!capture) throw new Error('画面已删除，请刷新。')
    image = readFileSync(join(media, `${capture.id}.jpg`))
    if (!image.length || image.length > 5_000_000) throw new Error('画面为空或过大，未保存。')
  }
  if (input.kind === 'bookmark' && !capture) throw new Error('请先选择一张画面。')
  const item: JournalSavedItem = { id: randomUUID(), kind: input.kind, createdAt: Date.now(), sourceRange: { from, to }, title: task.title, note: input.note.trim(), pinned: false, completed: false,
    task, activities: data.activities.filter(value => task.activityIds.includes(value.id)), capture, imageBytes: image?.length || 0 }
  return insertSaved(db, item, image)
}

const limits = { count: 1000, bytes: 512 * 1024 * 1024, textBytes: 16 * 1024 * 1024, itemBytes: 256 * 1024 }

export function savedUsage(db: Database.Database): JournalSavedUsage {
  const usage = db.prepare('SELECT COUNT(*) count,COALESCE(SUM(length(image)),0) bytes,COALESCE(SUM(length(CAST(value AS BLOB))),0) textBytes FROM saved_items').get() as Omit<JournalSavedUsage, 'limits'>
  return { ...usage, limits: { ...limits } }
}

// Used by both note edits and OCR so all writes obey the same UTF-8 budget.
export function replaceSaved(db: Database.Database, item: JournalSavedItem): void {
  db.transaction(() => {
    const old = db.prepare('SELECT length(CAST(value AS BLOB)) bytes FROM saved_items WHERE id=?').get(item.id) as { bytes: number } | undefined
    if (!old) throw new Error('收藏已删除，请刷新。')
    const serialized = JSON.stringify(item), bytes = Buffer.byteLength(serialized)
    if (bytes > limits.itemBytes && bytes > old.bytes) throw new Error('这份收藏文字已达 256 KB 上限，请缩短备注或减少来源。')
    if (savedUsage(db).textBytes - old.bytes + bytes > limits.textBytes && bytes > old.bytes) throw new Error('收藏文字已达 16 MB 上限，请先清理收藏。')
    db.prepare('UPDATE saved_items SET value=? WHERE id=?').run(serialized, item.id)
  }).immediate()
}

function insertSaved(db: Database.Database, item: JournalSavedItem, image: Buffer | null): JournalSavedItem {
  const serialized = JSON.stringify(item)
  if (Buffer.byteLength(serialized) > limits.itemBytes) throw new Error('事项来源过多，请先选择范围更小的事项。')
  db.transaction(() => {
    const usage = savedUsage(db)
    if (usage.count >= limits.count || usage.bytes + (image?.length || 0) > limits.bytes) throw new Error('收藏已达 1000 项或 512 MB 上限，请先清理收藏。')
    if (usage.textBytes + Buffer.byteLength(serialized) > limits.textBytes) throw new Error('收藏文字已达 16 MB 上限，请先清理收藏。')
    db.prepare('INSERT INTO saved_items VALUES(?,?,?,?)').run(item.id, item.createdAt, serialized, image)
  }).immediate()
  return item
}

export function listSaved(db: Database.Database): JournalSavedItem[] {
  return (db.prepare('SELECT value FROM saved_items ORDER BY createdAt DESC,id').all() as { value: string }[]).map(row => JSON.parse(row.value))
}

export function generateContinuations(db: Database.Database, media: string, input: { from: number; to: number; summaryCreatedAt: number }) {
  const range = validateJournalQuery(input)
  return db.transaction(() => {
    const data = readTaskData(db, range.from, range.to)
    if (!data.summary || data.summary.createdAt !== input.summaryCreatedAt) throw new Error('日志来源或总结已变化，请重新生成接续卡。')
    const candidates = continuationCandidates(data.tasks)
    const saved = listSaved(db)
    let created = 0, skipped = 0
    for (const task of candidates) {
      if (saved.some(item => matchesContinuation(task, item, range))) { skipped++; continue }
      const captureId = task.sourceIds.find(id => id.startsWith('capture:'))?.slice(8)
      const item = saveJournalItem(db, media, { ...range, id: task.id, kind: 'continuation', note: task.note, captureId })
      saved.push(item); created++
    }
    return { created, skipped, considered: candidates.length }
  }).immediate()
}

export function updateSaved(db: Database.Database, input: { id: string; pinned?: boolean; completed?: boolean; note?: string }): void {
  if (!input || typeof input.id !== 'string' || Object.keys(input).some(key => !['id', 'pinned', 'completed', 'note'].includes(key)) ||
    (input.pinned !== undefined && typeof input.pinned !== 'boolean') || (input.completed !== undefined && typeof input.completed !== 'boolean') ||
    (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 4000))) throw new Error('无效收藏修改。')
  db.transaction(() => {
  const row = db.prepare('SELECT value FROM saved_items WHERE id=?').get(input.id) as { value: string } | undefined
  if (!row) throw new Error('收藏已删除，请刷新。')
  const item = JSON.parse(row.value)
  replaceSaved(db, { ...item, ...input })
  }).immediate()
}

export function saveQuickBookmark(db: Database.Database, input: { sample: Omit<JournalSample, 'idleSeconds'>; at: number; width: number; height: number; bytes: Uint8Array }): JournalSavedItem {
  const { sample, at, width, height } = input
  const bytes = Buffer.from(input.bytes)
  if (!sample || typeof sample.app !== 'string' || typeof sample.title !== 'string' || sample.title.length > 512 || sample.app.length > 120 || !Number.isSafeInteger(at) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || !bytes.length || bytes.length > 5_000_000) throw new Error('快捷书签画面无效。')
  const id = randomUUID(), captureId = randomUUID()
  const start = new Date(at); start.setHours(0, 0, 0, 0)
  const end = new Date(start); end.setDate(end.getDate() + 1)
  const range = { from: start.getTime(), to: end.getTime() }
  const data = readTaskData(db, range.from, range.to)
  const activity = data.activities.find(item => item.app === sample.app && item.title === sample.title && item.startedAt <= at && at - item.endedAt <= 10_000)
  const linked = activity && data.tasks.find(task => task.activityIds.includes(activity.id))
  const snapshot: JournalActivity = { id: activity?.id ?? 0, app: sample.app, title: sample.title, startedAt: at, endedAt: at }
  const capture: JournalCapture = { id: captureId, activityId: snapshot.id, app: sample.app, title: sample.title, capturedAt: at, width, height, bytes: bytes.length,
    ocrText: '', ocrStatus: 'pending', ocrError: '' }
  const task: JournalTask = linked ? { ...linked, sourceIds: [...linked.sourceIds, `capture:${captureId}`], captureIds: [...linked.captureIds, captureId] } : {
    id: `bookmark:${id}`, title: sample.title || sample.app, text: '', kind: 'activity', category: '', note: '', edited: false, organized: false,
    sourceIds: [`capture:${captureId}`], activityIds: activity ? [activity.id] : [], captureIds: [captureId], apps: [sample.app], startedAt: at, endedAt: at, durationMs: 0 }
  return insertSaved(db, { id, kind: 'bookmark', createdAt: at, sourceRange: range, title: task.title, note: '', pinned: false, completed: false, task,
    activities: linked ? data.activities.filter(item => linked.activityIds.includes(item.id)) : [snapshot], capture, imageBytes: bytes.length }, bytes)
}
