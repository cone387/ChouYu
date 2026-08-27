const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const READY_MARKER = 'CHOUYU_SMOKE_READY'
const TIMEOUT_MS = 20_000
const packagedArgIndex = process.argv.indexOf('--packaged')
const packagedExecutable = packagedArgIndex >= 0 ? process.argv[packagedArgIndex + 1] : ''
const executable = packagedExecutable || require('electron')
const args = packagedExecutable ? ['--disable-gpu'] : ['--disable-gpu', '.']
const smokeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-smoke-'))
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
    finish(1, `Electron exited before renderer readiness (code ${code}).\n${output}`)
    return
  }
  if (code !== 0) {
    finish(1, `Electron smoke test exited with code ${code}.\n${output}`)
    return
  }
  finish(0, packagedExecutable ? 'Packaged Electron smoke test passed.' : 'Electron smoke test passed.')
})
