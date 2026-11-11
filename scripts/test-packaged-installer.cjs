// Run only on an ephemeral Windows GitHub runner, using the actual release EXE.
// Local performance measurements use benchmark-windows-installer.cjs instead.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const { verifyRuntime } = require('./verify-dsh-runtime.cjs')

function run(file, args, timeout = 600000) {
  const result = spawnSync(file, args, { windowsHide: true, timeout, encoding: 'utf8' })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${path.basename(file)} failed: ${result.stderr}`)
  return result.stdout
}

function main() {
  assert.equal(process.platform, 'win32')
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Actual product installation is restricted to disposable GitHub runners')
  const root = path.resolve(__dirname, '..')
  const version = require('../package.json').version
  const setup = path.join(root, 'dist', `ChouYu Setup ${version}.exe`)
  assert.ok(fs.existsSync(setup), 'Build the actual release installer first')
  const installedAlready = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$keys=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'); @(Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'ChouYu*' }).Count"])
  assert.equal(installedAlready.trim(), '0', 'Refusing to replace an existing ChouYu installation')
  const data = path.join(process.env.APPDATA, 'chouyu')
  assert.equal(fs.existsSync(data), false, 'Refusing to touch existing ChouYu user data')
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true })
  const work = fs.mkdtempSync(path.join(root, 'artifacts/packaged-install-'))
  const installed = path.join(work, 'app')
  fs.mkdirSync(data)
  const sentinel = path.join(data, 'installer-test-sentinel.txt')
  fs.writeFileSync(sentinel, 'retain user data')
  const uninstaller = path.join(installed, 'Uninstall ChouYu.exe')
  try {
    const started = performance.now()
    run(setup, ['/S', `/D=${installed}`])
    const seconds = (performance.now() - started) / 1000
    assert.ok(fs.existsSync(path.join(installed, 'ChouYu.exe')))
    const runtime = path.join(installed, 'resources/dsh-runtime')
    verifyRuntime(runtime)
    const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json'), 'utf8'))
    assert.equal(fs.readdirSync(runtime, { recursive: true, withFileTypes: true }).filter(f => f.isFile()).length, manifest.files.length + 1)
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'retain user data')
    console.log(`Actual release installer passed: ${seconds.toFixed(2)}s; ${manifest.files.length} runtime files verified`)
  } finally {
    if (fs.existsSync(uninstaller)) {
      run(uninstaller, ['/S', '/KEEP_APP_DATA', `_?=${installed}`])
      assert.equal(fs.existsSync(path.join(installed, 'ChouYu.exe')), false)
    }
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'retain user data')
    fs.unlinkSync(sentinel)
    // Only remove the empty data directory created by this test.
    fs.rmdirSync(data)
  }
}
try { main() } catch (error) { console.error(error); process.exitCode = 1 }
