import Database from 'better-sqlite3'
import { Worker } from 'worker_threads'
import { app } from 'electron'
import { join } from 'path'
import type { JournalSavedItem } from '../../shared/journal'
import { initializeSaved, updateSaved } from '../journal/saved'

/** A second connection holds a WAL write transaction while the first updates a flag. */
export async function runSavedConcurrencySmoke(seed: JournalSavedItem): Promise<void> {
  const file = join(app.getPath('userData'), 'saved-concurrency.db')
  const db = new Database(file)
  db.pragma('journal_mode = WAL'); initializeSaved(db)
  db.prepare('INSERT OR REPLACE INTO saved_items VALUES(?,?,?,NULL)').run(seed.id, seed.createdAt, JSON.stringify({ ...seed, note: 'before', pinned: false }))
  const shared = new SharedArrayBuffer(4), ready = new Int32Array(shared)
  const worker = new Worker(`
    const { workerData, parentPort } = require('worker_threads');
    const Database = require(workerData.modulePath);
    const db = new Database(workerData.file);
    const ready = new Int32Array(workerData.shared);
    try {
      db.transaction(() => {
        const row = JSON.parse(db.prepare('SELECT value FROM saved_items WHERE id=?').get(workerData.id).value);
        row.note = 'committed by second connection';
        db.prepare('UPDATE saved_items SET value=? WHERE id=?').run(JSON.stringify(row), workerData.id);
        Atomics.store(ready, 0, 1); Atomics.notify(ready, 0);
        Atomics.wait(ready, 0, 1, 150);
      }).immediate();
      parentPort.postMessage('committed');
    } finally { db.close(); }
  `, { eval: true, workerData: { modulePath: require.resolve('better-sqlite3'), file, id: seed.id, shared } })
  const done = new Promise<void>((resolve, reject) => { worker.once('message', () => resolve()); worker.once('error', reject) })
  // Install a handler even if startup fails while the main thread waits for the flag.
  void done.catch(() => {})
  try {
    Atomics.wait(ready, 0, 0, 5000)
    if (Atomics.load(ready, 0) !== 1) throw new Error('Concurrent saved fixture did not acquire write lock')
    updateSaved(db, { id: seed.id, pinned: true })
    await done
    const saved = JSON.parse((db.prepare('SELECT value FROM saved_items WHERE id=?').get(seed.id) as { value: string }).value)
    if (!saved.pinned || saved.note !== 'committed by second connection') throw new Error('Concurrent saved edit lost committed fields')
    console.log('CHOUYU_SAVED_CONCURRENCY_SMOKE_PASSED waits for writer and merges latest committed fields')
  } finally { await worker.terminate(); db.close() }
}
