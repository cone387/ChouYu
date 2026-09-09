import Database from 'better-sqlite3'
import type { JournalSavedItem } from '../../shared/journal'
import { initializeSaved, listSaved, replaceSaved, savedUsage, updateSaved } from '../journal/saved'

/** Boundary tests in an in-memory database; no changes to the user's records. */
export function runSavedCapacitySmoke(seed: JournalSavedItem): void {
  const db = new Database(':memory:')
  initializeSaved(db)
  const limits = savedUsage(db).limits
  const fixture = (id: string, size: number) => {
    const item: JournalSavedItem = { ...seed, id, note: '', task: { ...seed.task, text: '' } }
    item.task.text = 'x'.repeat(size - Buffer.byteLength(JSON.stringify(item)))
    return item
  }
  const insert = (item: JournalSavedItem) => db.prepare('INSERT INTO saved_items VALUES(?,?,?,?)').run(item.id, item.createdAt, JSON.stringify(item), Buffer.from([1, 2, 3]))
  const rejectsUnchanged = (operation: () => void, id: string) => {
    const before = db.prepare('SELECT value FROM saved_items WHERE id=?').get(id)
    let rejected = false
    try { operation() } catch { rejected = true }
    const after = db.prepare('SELECT value FROM saved_items WHERE id=?').get(id)
    if (!rejected || JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Capacity failure changed the saved snapshot')
  }
  try {
    insert(fixture('single', limits.itemBytes))
    rejectsUnchanged(() => updateSaved(db, { id: 'single', note: '中文' }), 'single')
    const imageItem = listSaved(db)[0]
    if (!imageItem.capture) throw new Error('Capacity fixture needs a captured image')
    imageItem.capture.ocrText = '中文'.repeat(100)
    rejectsUnchanged(() => replaceSaved(db, imageItem), 'single')
    db.prepare('DELETE FROM saved_items').run()
    const base = Math.floor(limits.textBytes / 65)
    db.transaction(() => { for (let index = 0; index < 65; index++) insert(fixture(String(index), base + (index === 64 ? limits.textBytes - base * 65 : 0))) })()
    const full = savedUsage(db)
    if (full.textBytes !== limits.textBytes || full.bytes !== 65 * 3 || full.count !== 65) throw new Error('Saved usage does not match actual UTF-8 and BLOB bytes')
    rejectsUnchanged(() => updateSaved(db, { id: '0', note: '中文' }), '0')
    const reduced = listSaved(db).find(item => item.id === '0')!
    reduced.task.text = reduced.task.text.slice(0, -100)
    replaceSaved(db, reduced)
    updateSaved(db, { id: '0', note: '中文' })
    if (savedUsage(db).textBytes !== limits.textBytes - 100 + 6) throw new Error('Saved note budget does not count UTF-8 bytes')
    db.prepare('DELETE FROM saved_items').run()
    const empty = savedUsage(db)
    if (empty.count || empty.bytes || empty.textBytes) throw new Error('Deleting saved items did not release logical capacity')
  } finally { db.close() }
}
