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
fs.writeFileSync(legacyStorePath, JSON.stringify({
  version: 2,
  // Proactive messages share ChouYu's conversation now. Individual reminder tests
  // inject their own events; unrelated wall-clock greetings must not alter migration fixtures.
  config: { model: 'smoke-model', proactiveGreeting: false, proactiveRestReminder: false, proactiveReturn: false },
  messages: [
    { id: 'legacy-user', role: 'user', content: '迁移测试对话', timestamp: 1 },
    { id: 'legacy-assistant', role: 'assistant', content: '迁移成功', timestamp: 2 }
  ],
  state: {}
}), 'utf8')
const nativeCapture = process.argv.includes('--native-capture')
const env = {
  ...process.env,
  CHOUYU_SMOKE_TEST: '1',
  CHOUYU_SMOKE_STORAGE_SCALE: process.argv.includes('--storage-scale') ? '1' : '0',
  CHOUYU_SMOKE_MIGRATION_FIXTURE: path.resolve(__dirname, '../tests/fixtures/ocr-sample.png'),
  CHOUYU_SMOKE_DSH: process.argv.includes('--dsh-harness') ? '1' : '0',
  CHOUYU_SMOKE_CONTACT_LIVE: process.argv.includes('--contact-live') ? '1' : '0',
  CHOUYU_SMOKE_CAPTURE_ONLY: nativeCapture ? '1' : '0',
  CHOUYU_SMOKE_NAVIGATION_ONLY: process.argv.includes('--navigation') ? '1' : '0',
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
  CHOUYU_SMOKE_PRESENTATION_ONLY: process.argv.includes('--presentation') ? '1' : '0',
  CHOUYU_SMOKE_AGENTS_ONLY: process.argv.includes('--agents') || process.argv.includes('--contact-conversation') ? '1' : '0',
  CHOUYU_SMOKE_CONTACT_CONVERSATION_ONLY: process.argv.includes('--contact-conversation') ? '1' : '0',
  CHOUYU_SMOKE_CONTACTS_ONLY: process.argv.includes('--contacts') ? '1' : '0',
  CHOUYU_SMOKE_CONTACT_EXPERIENCE_ONLY: process.argv.includes('--contact-experience') ? '1' : '0',
  CHOUYU_SMOKE_USER_DATA: smokeUserData
}
console.log(nativeCapture ? 'Smoke mode: native capture (requires interactive desktop and recording permission).' : 'Smoke mode: UI/data regression with synthetic capture; native capture is tested separately.')
if (process.argv.includes('--ocr')) env.CHOUYU_SMOKE_OCR_FIXTURE = path.resolve(__dirname, '../tests/fixtures/ocr-sample.png')
delete env.ELECTRON_RUN_AS_NODE

let ready = false
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
  if (output.includes(READY_MARKER)) ready = true
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
  const migrated = JSON.parse(fs.readFileSync(legacyStorePath, 'utf8'))
  if (migrated.version !== 4) throw new Error(`Expected store version 4, received ${migrated.version}`)
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

const timer = setTimeout(() => {
  child.kill()
  finish(1, `Electron smoke test timed out after ${TIMEOUT_MS}ms.\n${output}`)
}, TIMEOUT_MS)

child.on('error', (error) => finish(1, `Failed to launch Electron: ${error.message}`))
child.on('exit', (code) => {
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
  try {
    verifyMigration()
  } catch (error) {
    finish(1, `Session migration smoke test failed: ${error.message}\n${output}`)
    return
  }
  finish(0, packagedExecutable ? 'Packaged Electron smoke test passed.' : 'Electron smoke test passed.')
})
