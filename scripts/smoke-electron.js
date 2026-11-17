const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const READY_MARKER = 'CHOUYU_SMOKE_READY'
const FAILED_MARKER = 'CHOUYU_SMOKE_FAILED'
// Include task recovery, backup/reload and source flows before chat/journal checks.
// Capturing every workspace in both themes takes longer than the headless assertions.
const TIMEOUT_MS = process.argv.includes('--contact-live') ? 1_800_000 : process.env.CHOUYU_SMOKE_ARTIFACTS ? 300_000 : 240_000
const packagedArgIndex = process.argv.indexOf('--packaged')
const packagedExecutable = packagedArgIndex >= 0 ? process.argv[packagedArgIndex + 1] : ''
if (process.argv.includes('--dsh-harness-live')) {
  throw new Error('DSH live UI acceptance is not implemented; run the opt-in provider-live.acceptance.test.ts probe. This flag cannot report acceptance success.')
}
const executable = packagedExecutable ? path.resolve(packagedExecutable) : require('electron')
const args = packagedExecutable ? ['--disable-gpu'] : ['--disable-gpu', '.']
const smokeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-smoke-'))
const legacyStorePath = path.join(smokeUserData, 'chouyu-data.json')
const memoryDatabasePath = path.join(smokeUserData, 'chouyu-memory.db')
// An explicit offline copy can exercise shutdown at real database scale. The
// original snapshot is never opened by the app; executions are disabled below.
if (process.argv.includes('--shutdown') && process.env.CHOUYU_SHUTDOWN_SNAPSHOT) {
  const source = path.resolve(process.env.CHOUYU_SHUTDOWN_SNAPSHOT)
  const target = path.join(smokeUserData, 'contact-agents')
  fs.mkdirSync(target, { recursive: true })
  for (const file of ['agents.db', 'checkpoints.db']) fs.copyFileSync(path.join(source, file), path.join(target, file))
  if (fs.existsSync(path.join(source, 'backups'))) fs.cpSync(path.join(source, 'backups'), path.join(target, 'backups'), { recursive: true })
  const { DatabaseSync } = require('node:sqlite')
  const database = new DatabaseSync(path.join(target, 'agents.db'))
  try {
    for (const row of database.prepare('SELECT character_id,settings FROM profiles').all()) database.prepare('UPDATE profiles SET settings=? WHERE character_id=?').run(JSON.stringify({ ...JSON.parse(row.settings), enabled: false }), row.character_id)
    database.exec("UPDATE runs SET status='cancelled' WHERE status IN ('running','queued','interrupted'); DELETE FROM notices;")
  } finally { database.close() }
}
// Optional offline snapshot for the read-only workbench visual audit. Never open
// the user's live database in the application under test.
if (process.argv.includes('--contact-workbench') && process.env.CHOUYU_WORKBENCH_SNAPSHOT) {
  fs.mkdirSync(path.join(smokeUserData, 'contact-agents'), { recursive: true })
  fs.copyFileSync(process.env.CHOUYU_WORKBENCH_SNAPSHOT, path.join(smokeUserData, 'contact-agents', 'agents.db'))
  fs.copyFileSync(path.join(path.dirname(process.env.CHOUYU_WORKBENCH_SNAPSHOT), 'checkpoints.db'), path.join(smokeUserData, 'contact-agents', 'checkpoints.db'))
  // Disable execution in the disposable copy before Electron initializes agents.
  // Keep the supplied snapshot and the user's live data untouched.
  const { DatabaseSync } = require('node:sqlite')
  const auditDatabase = new DatabaseSync(path.join(smokeUserData, 'contact-agents', 'agents.db'))
  try {
    for (const row of auditDatabase.prepare('SELECT character_id, settings FROM profiles').all()) {
      const settings = { ...JSON.parse(row.settings), enabled: false }
      auditDatabase.prepare('UPDATE profiles SET settings=? WHERE character_id=?').run(JSON.stringify(settings), row.character_id)
    }
    auditDatabase.exec("UPDATE runs SET status='cancelled' WHERE status IN ('running','queued','interrupted'); DELETE FROM notices;")
  } finally { auditDatabase.close() }
}
fs.writeFileSync(legacyStorePath, JSON.stringify({
  version: 2,
  // Proactive messages share ChouYu's conversation now. Individual reminder tests
  // inject their own events; unrelated wall-clock greetings must not alter migration fixtures.
  config: { model: 'smoke-model', proactiveGreeting: false, proactiveRestReminder: false, proactiveReturn: false },
  messages: [
    { id: 'legacy-user', role: 'user', content: '迁移测试对话', timestamp: 1 },
    { id: 'legacy-assistant', role: 'assistant', content: '迁移成功', timestamp: 2 }
  ],
  // Exercise constrained composer geometry on every display, including large
  // developer monitors. The full suite keeps its normal window defaults.
  state: process.argv.includes('--navigation') ? { 'chat-panel-height': '418' } : {}
}), 'utf8')
if (process.argv.includes('--upgrade-v134')) {
  require('./release-upgrade-fixture.cjs').seed(smokeUserData, JSON.parse(fs.readFileSync(legacyStorePath, 'utf8')))
}
const nativeCapture = process.argv.includes('--native-capture')
const env = {
  ...process.env,
  CHOUYU_SMOKE_UPDATES_ONLY: process.argv.includes('--updates') || process.argv.includes('--shutdown') ? '1' : '0',
  CHOUYU_SMOKE_TEST: '1',
  CHOUYU_SMOKE_SHUTDOWN: process.argv.includes('--shutdown') ? '1' : '0',
  CHOUYU_SMOKE_CONTACT_WORKBENCH: process.argv.includes('--contact-workbench') ? '1' : '0',
  CHOUYU_SMOKE_STORAGE_SCALE: process.argv.includes('--storage-scale') ? '1' : '0',
  CHOUYU_SMOKE_MIGRATION_FIXTURE: path.resolve(__dirname, '../tests/fixtures/ocr-sample.png'),
  CHOUYU_SMOKE_DSH: process.argv.includes('--dsh-harness') ? '1' : '0',
  CHOUYU_SMOKE_CONTACT_RELIABILITY: process.argv.includes('--contact-reliability') ? '1' : '0',
  CHOUYU_SMOKE_TASK_REQUESTS: process.argv.includes('--task-requests') ? '1' : '0',
  CHOUYU_SMOKE_CONTACT_LIVE: process.argv.includes('--contact-live') ? '1' : '0',
  CHOUYU_SMOKE_CAPTURE_ONLY: nativeCapture ? '1' : '0',
  CHOUYU_SMOKE_NAVIGATION_ONLY: process.argv.includes('--navigation') ? '1' : '0',
  CHOUYU_SMOKE_DASHBOARD_ONLY: process.argv.includes('--dashboard') ? '1' : '0',
  CHOUYU_SMOKE_CHAT_ONLY: process.argv.includes('--chat') || process.argv.includes('--chat-close') || process.argv.includes('--chat-edit') || process.argv.includes('--chat-scroll') ? '1' : '0',
  CHOUYU_SMOKE_CHAT_SCROLL_ONLY: process.argv.includes('--chat-scroll') ? '1' : '0',
  CHOUYU_SMOKE_CHAT_CLOSE_ONLY: process.argv.includes('--chat-close') ? '1' : '0',
  CHOUYU_SMOKE_CHAT_EDIT_ONLY: process.argv.includes('--chat-edit') ? '1' : '0',
  CHOUYU_SMOKE_TASK_SCHEDULING_ONLY: process.argv.includes('--task-scheduling') ? '1' : '0',
  CHOUYU_SMOKE_TASK_VIEWS_ONLY: process.argv.includes('--task-views') ? '1' : '0',
  CHOUYU_SMOKE_TASK_EDIT_ONLY: process.argv.includes('--task-edit') ? '1' : '0',
  CHOUYU_SMOKE_TASK_ASSISTANT_ONLY: process.argv.includes('--task-assistant') ? '1' : '0',
  CHOUYU_SMOKE_REMINDERS_ONLY: process.argv.includes('--reminders') ? '1' : '0',
  CHOUYU_SMOKE_ASSISTANT_ROUTINES_ONLY: process.argv.includes('--assistant-routines') ? '1' : '0',
  CHOUYU_SMOKE_COMPANION_ONLY: process.argv.includes('--companion') ? '1' : '0',
  CHOUYU_SMOKE_RESULT_DESIGNER_ONLY: process.argv.includes('--result-designer') ? '1' : '0',
  CHOUYU_SMOKE_AGENTS_ONLY: process.argv.includes('--agents') || process.argv.includes('--contact-conversation') ? '1' : '0',
  CHOUYU_SMOKE_CONTACT_CONVERSATION_ONLY: process.argv.includes('--contact-conversation') ? '1' : '0',
  CHOUYU_SMOKE_CONTACTS_ONLY: process.argv.includes('--contacts') || process.argv.includes('--contact-card-ui') ? '1' : '0',
  CHOUYU_SMOKE_CONTACT_CARD_UI_ONLY: process.argv.includes('--contact-card-ui') ? '1' : '0',
  CHOUYU_SMOKE_CONTACT_EXPERIENCE_ONLY: process.argv.includes('--contact-experience') ? '1' : '0',
  CHOUYU_SMOKE_USER_DATA: smokeUserData
}
console.log(nativeCapture ? 'Smoke mode: native capture (requires interactive desktop and recording permission).' : 'Smoke mode: UI/data regression with synthetic capture; native capture is tested separately.')
if (process.argv.includes('--ocr')) env.CHOUYU_SMOKE_OCR_FIXTURE = path.resolve(__dirname, '../tests/fixtures/ocr-sample.png')
delete env.ELECTRON_RUN_AS_NODE

let ready = false
let readyAt = 0
let output = ''
let finished = false

const child = spawn(executable, args, {
  cwd: path.resolve(__dirname, '..'),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
})

const capture = (chunk) => {
  const text = chunk.toString()
  output += text
  if (!ready && output.includes(READY_MARKER)) { ready = true; readyAt = Date.now() }
  process.stdout.write(text)
}

child.stdout.on('data', capture)
child.stderr.on('data', capture)

const cleanup = () => {
  try {
    fs.rmSync(smokeUserData, { recursive: true, force: true })
  } catch {}
}

const verifyMigration = () => {
  if (process.argv.includes('--storage-scale')) {
    const line = output.split(/\r?\n/).find(s => s.startsWith('CHOUYU_STORAGE_REPORT '))
    if (!line || JSON.parse(line.slice('CHOUYU_STORAGE_REPORT '.length)).errors.length) throw new Error('Invalid storage benchmark report')
    return
  }
  const marker = JSON.parse(fs.readFileSync(legacyStorePath, 'utf8'))
  if (marker.version !== 5 || marker.storage !== 'sqlite') throw new Error(`Expected SQLite migration barrier, received ${marker.version}`)
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(path.join(smokeUserData, 'chouyu-application.db'), { readOnly: true })
  let migrated
  try {
    const sessions = db.prepare('SELECT id,value FROM sessions ORDER BY position').all().map(row => ({ ...JSON.parse(row.value), messages: db.prepare('SELECT value FROM messages WHERE session_id=? ORDER BY position').all(row.id).map(m => JSON.parse(m.value)) }))
    migrated = { sessions, activeSessionId: JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='activeSessionId'").get().value) }
  } finally { db.close() }
  if (!Array.isArray(migrated.sessions) || migrated.sessions.length === 0) throw new Error('Migrated session list is empty')
  const active = migrated.sessions.find((session) => session.id === migrated.activeSessionId)
  if (!active) throw new Error('Migrated active session is missing')
  if (active.messages?.length !== 2) throw new Error(`Expected 2 migrated messages, received ${active.messages?.length}: ${JSON.stringify(active.messages?.map(({ id, role, content }) => ({ id, role, content: content.slice(0, 160) })))}`)
  if (active.title !== '迁移测试对话') throw new Error(`Unexpected migrated title: ${active.title}`)
  if (!fs.existsSync(memoryDatabasePath) || fs.statSync(memoryDatabasePath).size === 0) {
    throw new Error('SQLite memory database was not created')
  }
}

const finish = (code, message) => {
  if (finished) return
  finished = true
  clearTimeout(timer)
  cleanup()
  if (message) (code === 0 ? console.log : console.error)(message)
  if (code !== 0 && process.env.GITHUB_ACTIONS) {
    const failure = output.includes(FAILED_MARKER)
      ? output.slice(output.lastIndexOf(FAILED_MARKER)).trim()
      : message?.split('\n')[0] || 'Electron smoke test failed'
    const escaped = failure.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
    console.error(`::error title=Electron smoke test::${escaped}`)
  }
  process.exitCode = code
}

function verifyShutdown() {
  const assert = require('node:assert/strict'), { createHash } = require('node:crypto'), { DatabaseSync } = require('node:sqlite')
  const id = /CHOUYU_SHUTDOWN_EVIDENCE topicId=([a-zA-Z0-9_-]+)/.exec(output)?.[1]
  assert.ok(id, 'Missing final shutdown write receipt')
  const directory = path.join(smokeUserData, 'contact-agents')
  const groups = fs.readdirSync(path.join(directory, 'backups')).filter(name => /^\d{13}-[a-f0-9-]{36}$/.test(name)).sort().reverse()
  assert.ok(groups.length, 'Final contact backup missing')
  const backup = path.join(directory, 'backups', groups[0]), manifest = JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8'))
  assert.equal(manifest.id, groups[0])
  for (const role of ['tasks', 'checkpoints']) {
    const filename = path.join(backup, role + '.db'), fd = fs.openSync(filename, 'r'), hash = createHash('sha256'), buffer = Buffer.allocUnsafe(65536)
    try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)) } finally { fs.closeSync(fd) }
    assert.equal(hash.digest('hex'), manifest.files[role].sha256, 'Final backup digest differs')
    assert.equal(fs.statSync(filename).size, manifest.files[role].bytes)
    const db = new DatabaseSync(filename, { readOnly: true })
    try {
      assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok')
      assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, manifest.files[role].schema)
    } finally { db.close() }
  }
  const live = new DatabaseSync(path.join(directory, 'agents.db'), { readOnly: true }), saved = new DatabaseSync(path.join(backup, 'tasks.db'), { readOnly: true })
  const checkpoints = new DatabaseSync(path.join(backup, 'checkpoints.db'), { readOnly: true })
  try {
    const lastWrite = live.prepare('SELECT value FROM topics WHERE id=?').get(id)
    assert.ok(lastWrite, 'Final task mutation lost from the primary database')
    assert.deepEqual(saved.prepare('SELECT value FROM topics WHERE id=?').get(id), lastWrite, 'Final mutation missing from the backup')
    if (checkpoints.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='checkpoints'").get()) {
      for (const row of checkpoints.prepare('SELECT DISTINCT thread_id FROM checkpoints').all()) assert.ok(saved.prepare('SELECT 1 FROM runs WHERE id=?').get(row.thread_id) || saved.prepare('SELECT 1 FROM execution_cleanup WHERE request_id=?').get(row.thread_id), 'Backup checkpoint lost its owner')
    }
  } finally { live.close(); saved.close(); checkpoints.close() }
  console.log('CHOUYU_SHUTDOWN_DURABLE_PASSED final mutation, both backup hashes and checkpoint ownership')
}

const timer = setTimeout(() => {
  child.kill()
  finish(1, `Electron smoke test timed out after ${TIMEOUT_MS}ms.\n${output}`)
}, TIMEOUT_MS)

child.on('error', (error) => finish(1, `Failed to launch Electron: ${error.message}`))
child.on('exit', (code) => {
  const shutdownMs = readyAt ? Date.now() - readyAt : 0
  if (process.argv.includes('--shutdown') && readyAt) console.log(`CHOUYU_SHUTDOWN_EXIT elapsedAfterReadyMs=${shutdownMs} scheduledQuitDelayMs=300`)
  if (!ready) {
    if (output.includes(FAILED_MARKER)) {
      finish(1, `Main-process smoke assertions failed.\n${output}`)
      return
    }
    finish(1, `Electron exited before renderer readiness (code ${code}).\n${output}`)
    return
  }
  if (code !== 0) {
    finish(1, `Electron smoke test exited with code ${code}.\n${output}`)
    return
  }
  if (process.argv.includes('--shutdown') && shutdownMs > 15_000) {
    finish(1, `Graceful shutdown exceeded the 15s acceptance budget: ${shutdownMs}ms`)
    return
  }
  try {
    verifyMigration()
    if (process.argv.includes('--shutdown')) verifyShutdown()
    if (process.argv.includes('--upgrade-v134')) require('./release-upgrade-fixture.cjs').verify(smokeUserData)
  } catch (error) {
    finish(1, `Session migration smoke test failed: ${error.message}\n${output}`)
    return
  }
  finish(0, packagedExecutable ? 'Packaged Electron smoke test passed.' : 'Electron smoke test passed.')
})
