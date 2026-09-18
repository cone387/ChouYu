// Uses the built worker and Electron's SQLite ABI, in an isolated synthetic directory.
const path = require('path')
const fs = require('fs')
const assert = require('assert/strict')
if (!process.versions.electron) {
  const result = require('child_process').spawnSync(require('electron'), [__filename], {
    stdio: 'inherit', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  process.exit(result.status ?? 1)
}
const { Worker } = require('worker_threads')
const Database = require('better-sqlite3')
const { randomUUID } = require('crypto')

async function main() {
  const root = path.resolve(__dirname, '..')
  fs.mkdirSync(path.join(root, 'temp'), { recursive: true })
  const directory = fs.mkdtempSync(path.join(root, 'temp', 'journal-storage-'))
  let worker, db, sequence = 0
  const start = () => { worker = new Worker(path.join(root, 'out/main/journal-worker.js'), { workerData: { directory, recordingDisabled: true } }) }
  const request = (method, payload) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => finish(new Error(`Timeout: ${method}`)), 10000)
    const onError = error => finish(error)
    const onMessage = reply => { if (reply.id === id) finish(reply.error ? new Error(reply.error) : null, reply.result) }
    const finish = (error, result) => {
      clearTimeout(timer); worker.off('message', onMessage); worker.off('error', onError)
      error ? reject(error) : resolve(result)
    }
    worker.on('message', onMessage); worker.on('error', onError); worker.postMessage({ id, method, payload })
  })
  try {
    start(); await request('config'); await request('close'); await worker.terminate()
    db = new Database(path.join(directory, 'journal.db'))
    const at = Date.now(), ids = Array.from({ length: 10 }, () => randomUUID())
    db.prepare('INSERT INTO activities VALUES(1,?,?,?,?)').run('fixture.exe', 'Synthetic', at, at + 100)
    const insert = db.prepare('INSERT INTO captures(id,activityId,app,title,capturedAt,width,height,bytes,hash) VALUES(?,1,?,?,?,100,100,?,?)')
    ids.forEach((id, index) => {
      insert.run(id, 'fixture.exe', 'Synthetic', at + index, 30 * 1024 ** 2, id)
      fs.writeFileSync(path.join(directory, 'media', `${id}.jpg`), 'synthetic')
    })
    const usage = () => db.prepare('SELECT bytes FROM capture_usage').get().bytes
    assert.equal(usage(), 300 * 1024 ** 2)
    assert.throws(() => db.transaction(() => { db.prepare('DELETE FROM captures').run(); throw new Error('rollback') })())
    assert.equal(usage(), 300 * 1024 ** 2)
    db.prepare('INSERT INTO saved_items VALUES(?,?,?,?)').run('saved-fixture', at, '{}', Buffer.from('independent bookmark'))
    db.prepare('INSERT INTO summaries VALUES(?,?,?)').run(at, at + 100, '{}')
    start()
    await request('configure', { maxStorageMB: 256, autoCleanup: false })
    assert.match(await request('captureCapacity'), /存储已达上限/)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM captures').get().n, 10)
    await request('configure', { autoCleanup: true })
    assert.equal(await request('captureCapacity'), null)
    assert.equal(usage(), 210 * 1024 ** 2)
    ids.forEach((id, index) => assert.equal(fs.existsSync(path.join(directory, 'media', `${id}.jpg`)), index >= 3))
    assert.equal(db.prepare('SELECT COUNT(*) n FROM activities').get().n, 1)
    assert.equal(db.prepare('SELECT image FROM saved_items').get().image.toString(), 'independent bookmark')
    assert.equal(db.prepare('SELECT COUNT(*) n FROM summaries').get().n, 1)
    await request('close'); await worker.terminate(); start()
    assert.equal(await request('captureCapacity'), null)
    assert.equal(usage(), 210 * 1024 ** 2)
    await request('configure', { maxStorageMB: 0 })
    db.prepare('UPDATE captures SET bytes=? WHERE id=?').run(60 * 1024 ** 3, ids[9])
    assert.equal(await request('captureCapacity'), null)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM captures').get().n, 7)
    await request('deleteCapture', ids[9])
    assert.equal(usage(), 180 * 1024 ** 2)
    // The final write must recheck the budget even if preflight succeeded earlier.
    await request('configure', { maxStorageMB: 256, autoCleanup: false })
    db.prepare('UPDATE captures SET bytes=? WHERE id=?').run(256 * 1024 ** 2, ids[8])
    await assert.rejects(request('capture', { activityId: 1, width: 100, height: 100, bytes: Buffer.from('new frame'), at }), /截图已暂停/)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM captures').get().n, 6)
    console.log('PASS: quota preflight, oldest-first cleanup, saved/activity/summary preservation, transactional counters, restart, unlimited quota, write recheck')
    console.log(`Synthetic fixture: ${directory}`)
    await request('close')
  } finally { await worker?.terminate(); db?.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
