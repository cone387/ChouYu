const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const READY_MARKER = 'CHOUYU_SMOKE_READY'
const FAILED_MARKER = 'CHOUYU_SMOKE_FAILED'
const TIMEOUT_MS = 30_000
const packagedArgIndex = process.argv.indexOf('--packaged')
const packagedExecutable = packagedArgIndex >= 0 ? process.argv[packagedArgIndex + 1] : ''
const executable = packagedExecutable || require('electron')
const args = packagedExecutable ? ['--disable-gpu'] : ['--disable-gpu', '.']
const smokeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-smoke-'))
const legacyStorePath = path.join(smokeUserData, 'chouyu-data.json')
const memoryDatabasePath = path.join(smokeUserData, 'chouyu-memory.db')
fs.writeFileSync(legacyStorePath, JSON.stringify({
  version: 2,
  config: { model: 'smoke-model' },
  messages: [
    { id: 'legacy-user', role: 'user', content: '迁移测试对话', timestamp: 1 },
    { id: 'legacy-assistant', role: 'assistant', content: '迁移成功', timestamp: 2 }
  ],
  state: {}
}), 'utf8')
const env = {
  ...process.env,
  CHOUYU_SMOKE_TEST: '1',
  CHOUYU_SMOKE_USER_DATA: smokeUserData
}
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
  const migrated = JSON.parse(fs.readFileSync(legacyStorePath, 'utf8'))
  if (migrated.version !== 3) throw new Error(`Expected store version 3, received ${migrated.version}`)
  if (!Array.isArray(migrated.sessions) || migrated.sessions.length === 0) throw new Error('Migrated session list is empty')
  const active = migrated.sessions.find((session) => session.id === migrated.activeSessionId)
  if (!active) throw new Error('Migrated active session is missing')
  if (active.messages?.length !== 2) throw new Error(`Expected 2 migrated messages, received ${active.messages?.length}`)
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
  if (message) console.error(message)
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
