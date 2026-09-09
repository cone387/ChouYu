import { app, nativeImage } from 'electron'
import Database from 'better-sqlite3'
import { Worker } from 'worker_threads'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { initializeSaved } from '../journal/saved'
import { initializeJournalProjects, saveJournalProject, assignJournalProject } from '../journal/projects'
import { initializeJournalPlaybook, saveJournalPlaybook } from '../journal/playbook'
import { DEFAULT_JOURNAL_CONFIG, type JournalSavedItem } from '../../shared/journal'

function workerClient(directory: string) {
  const worker = new Worker(join(__dirname, 'journal-worker.js'), { workerData: { directory, recordingDisabled: true } })
  let sequence = 0
  const request = <T = any>(method: string, payload?: unknown): Promise<T> => new Promise((resolve, reject) => {
    const id = ++sequence
    const cleanup = () => { clearTimeout(timer); worker.off('message', message); worker.off('error', fail); worker.off('exit', exit) }
    const fail = (error: Error) => { cleanup(); reject(error) }
    const exit = (code: number) => fail(new Error(`Migration worker exited: ${code}`))
    const message = (reply: { id: number; error?: string; result: T }) => { if (reply.id !== id) return; cleanup(); reply.error ? reject(new Error(reply.error)) : resolve(reply.result) }
    const timer = setTimeout(() => fail(new Error('Migration worker timed out')), 10_000)
    worker.on('message', message); worker.once('error', fail); worker.once('exit', exit)
    worker.postMessage({ id, method, payload })
  })
  return { worker, request }
}

export async function runJournalMigrationSmoke(): Promise<void> {
  const image = nativeImage.createFromBuffer(readFileSync(join(app.getAppPath(), 'tests/fixtures/ocr-sample.png'))).toJPEG(85)
  const at = Date.now() - 8 * 86400_000
  for (const version of [7, 8, 9]) {
    const directory = join(app.getPath('userData'), `journal-upgrade-v${version}`)
    mkdirSync(directory, { recursive: true })
    const file = join(directory, 'journal.db'), db = new Database(file)
    const savedId = '11111111-2222-3333-4444-555555555555'
    const saved: JournalSavedItem = { id: savedId, kind: 'bookmark', createdAt: at, title: '升级前收藏', note: '升级前已核对的备注', pinned: true, completed: true, imageBytes: image.length, capture: null, activities: [{ id: 1, app: 'fixture.exe', title: '升级前来源', startedAt: at, endedAt: at + 1000 }], task: { id: 'old-task', title: '升级前收藏', text: '旧事项正文', kind: 'progress', category: '', note: '', edited: true, organized: true, sourceIds: ['activity:1'], activityIds: [1], captureIds: [], apps: ['fixture.exe'], startedAt: at, endedAt: at + 1000, durationMs: 1000 } }
    const captureId = '22222222-2222-3333-4444-555555555555'
    saved.capture = { id: captureId, activityId: 1, app: 'fixture.exe', title: '升级前来源', capturedAt: at, width: 640, height: 400, bytes: image.length, ocrText: '升级前已识别正文', ocrStatus: 'ready', ocrError: '' }
    saved.task.captureIds = [captureId]; saved.task.sourceIds.push(`capture:${captureId}`)
    const media = join(directory, 'media'); mkdirSync(media, { recursive: true })
    writeFileSync(join(media, `${captureId}.jpg`), image)
    let projectId: string | undefined, playbookId: string | undefined
    try {
      db.exec('CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL); CREATE TABLE activities(id INTEGER PRIMARY KEY,app TEXT NOT NULL,title TEXT NOT NULL,startedAt INTEGER NOT NULL,endedAt INTEGER NOT NULL)')
      db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify({ ...DEFAULT_JOURNAL_CONFIG, enabled: false, captureEnabled: false, retentionDays: 30, excludedApps: ['fixture-private.exe'] }))
      db.prepare('INSERT INTO activities VALUES(1,?,?,?,?)').run('fixture.exe', '升级前来源', at, at + 1000)
      db.exec(`CREATE TABLE captures (id TEXT PRIMARY KEY,activityId INTEGER NOT NULL,app TEXT NOT NULL,title TEXT NOT NULL,capturedAt INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,bytes INTEGER NOT NULL,hash TEXT NOT NULL,ocrText TEXT NOT NULL DEFAULT '',ocrStatus TEXT NOT NULL DEFAULT 'pending',ocrError TEXT NOT NULL DEFAULT '',UNIQUE(activityId,hash))`)
      db.prepare('INSERT INTO captures VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(captureId, 1, 'fixture.exe', '升级前来源', at, 640, 400, image.length, 'fixture-hash', saved.capture.ocrText, 'ready', '')
      initializeSaved(db)
      db.prepare('INSERT INTO saved_items VALUES(?,?,?,?)').run(saved.id, saved.createdAt, JSON.stringify(saved), image)
      if (version >= 8) {
        initializeJournalProjects(db)
        const project = saveJournalProject(db, { name: '升级前项目', description: '保留项目说明', archived: false, rules: [{ app: 'fixture.exe', title: '' }] })
        projectId = project.id; assignJournalProject(db, { savedId, projectId })
      }
      if (version >= 9) {
        initializeJournalPlaybook(db)
        playbookId = saveJournalPlaybook(db, { title: '升级前手册', problem: '连接失败', attempts: '检查日志', resolution: '修正地址', status: 'resolved', projectId: projectId!, sourceIds: [savedId] }).id
      }
      db.pragma(`user_version = ${version}`)
    } finally { db.close() }
    for (let pass = 0; pass < 2; pass++) {
      const { worker, request } = workerClient(directory)
      try {
        const items = await request<JournalSavedItem[]>('savedItems')
        if (JSON.stringify(items) !== JSON.stringify([saved])) throw new Error(`v${version} migration/reopen changed saved metadata`)
        if (await request('savedImage', savedId) !== `data:image/jpeg;base64,${image.toString('base64')}`) throw new Error(`v${version} migration changed saved image bytes`)
        const projects = await request('projects'), playbook = await request('playbook')
        if (projectId && (projects.projects[0]?.id !== projectId || projects.assignments[0]?.projectId !== projectId)) throw new Error('Migration lost project or manual assignment')
        if (playbookId && (playbook[0]?.id !== playbookId || playbook[0]?.resolution !== '修正地址' || playbook[0]?.revision !== 1)) throw new Error('Migration changed playbook content/version')
        if ((await request('weekly')).length) throw new Error('Migration invented weekly reports')
        const config = await request('config')
        if (config.enabled || config.captureEnabled || config.retentionDays !== (pass ? 7 : 30) || config.excludedApps[0] !== 'fixture-private.exe') throw new Error('Migration changed recording opt-out or retention settings')
        const captures = await request('captures', { from: at - 1000, to: at + 2000 })
        if (captures.total !== (pass ? 0 : 1) || !pass && captures.items[0]?.ocrText !== saved.capture!.ocrText) throw new Error('Migration changed original capture/OCR or retention did not remove it')
        await request('clearSemanticCache')
        await request('configure', { retentionDays: 7 })
        if ((await request('savedItems'))[0]?.id !== savedId || (await request('playbook')).some((entry: { missingSourceIds: string[] }) => entry.missingSourceIds.length)) throw new Error('Retention pruning damaged independent sources')
        if (existsSync(join(media, `${captureId}.jpg`))) throw new Error('Retention did not collect original image file')
        if (await request('savedImage', savedId) !== `data:image/jpeg;base64,${image.toString('base64')}`) throw new Error('Retention removed independent image bytes')
        await request('close')
      } finally { await worker.terminate() }
    }
    const reopened = new Database(file)
    try {
      if (reopened.pragma('user_version', { simple: true }) !== 11 || (reopened.prepare('SELECT COUNT(*) count FROM activities').get() as { count: number }).count) throw new Error('Migration version or retention pruning did not persist')
    } finally { reopened.close() }
  }
  const futureDirectory = join(app.getPath('userData'), 'journal-future-schema')
  mkdirSync(futureDirectory, { recursive: true })
  const futureFile = join(futureDirectory, 'journal.db'), future = new Database(futureFile)
  future.exec("CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES('preserve-future-record'); PRAGMA user_version=12")
  future.close()
  const client = workerClient(futureDirectory)
  let rejected = false
  try { await client.request('config') } catch (error) { rejected = String(error).includes('更新版本') } finally { await client.worker.terminate() }
  const check = new Database(futureFile)
  try { if (!rejected || check.pragma('user_version', { simple: true }) !== 12 || (check.prepare('SELECT value FROM future_data').get() as { value: string }).value !== 'preserve-future-record') throw new Error('Future schema was accepted or rewritten') } finally { check.close() }
  console.log('CHOUYU_JOURNAL_MIGRATION_SMOKE_PASSED v7/v8/v9 to v11, two worker opens, saved image bytes, project/playbook preservation, retention and future-schema refusal')
}
