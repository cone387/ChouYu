// Manual full-payload benchmark. Separate identity, executable and user data;
// never launches or uninstalls the user's ChouYu installation.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const { build, Platform, Arch } = require('electron-builder')
const { verifyRuntime } = require('./verify-dsh-runtime.cjs')

async function main() {
  assert.equal(process.platform, 'win32')
  const root = path.resolve(__dirname, '..')
  const source = path.resolve(process.argv[2] || path.join(root, 'dist/install-speed/win-unpacked'))
  verifyRuntime(path.join(source, 'resources/dsh-runtime'))
  const sourceRuntime = path.join(source, 'resources/dsh-runtime')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sourceRuntime, 'package-lock.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(root, 'runtime/dsh/package-lock.json'), 'utf8')), 'Benchmark requires matching dependency locks')
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(sourceRuntime, 'manifest.json'), 'utf8'))
  for (const file of sourceManifest.files.filter(f => f.path.startsWith('node_modules/'))) {
    assert.ok(fs.readFileSync(path.join(sourceRuntime, file.path)).equals(fs.readFileSync(path.join(root, 'runtime/dsh', file.path))),
      `Benchmark dependency differs: ${file.path}`)
  }
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true })
  const resume = process.argv[3] === '--resume'
  const work = resume ? path.resolve(process.argv[4]) : fs.mkdtempSync(path.join(root, 'artifacts/install-speed-'))
  assert.equal(path.dirname(work), path.join(root, 'artifacts'))
  assert.match(path.basename(work), /^install-speed-[a-zA-Z0-9]+$/)
  const suffix = path.basename(work).split('-').at(-1)
  const product = `ChouYuSpeedTest${suffix}`
  const packageName = product.toLowerCase()
  const installed = path.join(root, 'temp', `is-${suffix}`)
  const payload = path.join(work, 'payload')
  const project = path.join(work, 'project')
  const dataRoot = path.join(process.env.APPDATA, packageName)
  if (resume) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8')).name, packageName)
    assert.ok(fs.existsSync(path.join(installed, `${product}.exe`)), 'Resume requires the previous isolated baseline installation')
    // This is the validated, generated payload within the owned benchmark work.
    assert.equal(path.dirname(path.resolve(payload)), work)
    fs.rmSync(payload, { recursive: true, force: true })
  }
  fs.mkdirSync(project, { recursive: true })
  fs.mkdirSync(dataRoot, { recursive: true })
  const sentinel = path.join(dataRoot, 'sentinel.txt')
  if (resume) assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep existing data')
  else fs.writeFileSync(sentinel, 'keep existing data')
  console.log(`Benchmark workspace: ${work}`)
  fs.cpSync(source, payload, { recursive: true })
  fs.renameSync(path.join(payload, 'ChouYu.exe'), path.join(payload, `${product}.exe`))
  const rows = []
  function record(label, seconds, extra = {}) {
    const row = { label, seconds: Math.round(seconds * 1000) / 1000, ...extra }
    rows.push(row)
    fs.writeFileSync(path.join(work, 'results.json'), JSON.stringify({ source, installed, rows }, null, 2))
    console.log(JSON.stringify(row))
  }
  async function pack(version) {
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: packageName, version, description: 'Full payload installation benchmark', author: 'ChouYu' }))
    const output = path.join(work, version)
    await build({ projectDir: project, prepackaged: payload, publish: 'never', targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), config: {
      appId: `com.chouyu.install-speed.${suffix}`, productName: product,
      electronVersion: require('electron/package.json').version,
      directories: { output, buildResources: path.join(root, 'resources') },
      win: { signAndEditExecutable: false },
      nsis: { include: path.join(root, 'resources/installer.nsh'), oneClick: false,
        allowToChangeInstallationDirectory: true, runAfterFinish: false,
        createDesktopShortcut: false, createStartMenuShortcut: false, artifactName: 'benchmark.exe' }
    } })
    return path.join(output, 'benchmark.exe')
  }
  // The old x64 package includes four ARM64-codec PE entries that its NSIS
  // decoder does not install. This known baseline defect must not exempt the
  // optimized package from complete inventory verification.
  const baselineMissing = [
    'node_modules/node-pty/prebuilds/win32-arm64/conpty/conpty.dll',
    'node_modules/node-pty/prebuilds/win32-arm64/conpty/OpenConsole.exe',
    'node_modules/node-pty/third_party/conpty/1.25.260303002/win10-arm64/conpty.dll',
    'node_modules/node-pty/third_party/conpty/1.25.260303002/win10-arm64/OpenConsole.exe'
  ].sort()
  function run(label, file, args, expectedFiles, baseline = false) {
    const started = performance.now()
    const result = spawnSync(file, args, { windowsHide: true, timeout: 15 * 60 * 1000 })
    const seconds = (performance.now() - started) / 1000
    if (result.error) throw result.error
    record(label, seconds, { expectedFiles, exitCode: result.status, verified: false })
    assert.equal(result.status, 0, `${label} exit code`)
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep existing data')
    if (expectedFiles) {
      const runtime = path.join(installed, 'resources/dsh-runtime')
      const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json'), 'utf8'))
      if (baseline) {
        const missing = []
        for (const entry of manifest.files) {
          const file = path.resolve(runtime, entry.path)
          assert.ok(file.startsWith(path.resolve(runtime) + path.sep))
          if (!fs.existsSync(file)) missing.push(entry.path)
          else assert.equal(fs.statSync(file).size, entry.bytes, entry.path)
        }
        assert.deepEqual(missing.sort(), baselineMissing, 'Only the documented original ARM64 decoder omissions are allowed in the baseline')
      } else verifyRuntime(runtime)
      assert.equal(manifest.files.length, expectedFiles)
      const actualFiles = fs.readdirSync(runtime, { recursive: true, withFileTypes: true }).filter(f => f.isFile()).length
      assert.equal(actualFiles, expectedFiles + 1 - (baseline ? baselineMissing.length : 0), 'No stale files after upgrade')
    } else {
      assert.equal(fs.existsSync(path.join(installed, `${product}.exe`)), false)
    }
    rows.at(-1).verified = true
    fs.writeFileSync(path.join(work, 'results.json'), JSON.stringify({ source, installed, rows }, null, 2))
  }
  const trimmedManifest = JSON.parse(fs.readFileSync(path.join(payload, 'resources/dsh-runtime/manifest.json'), 'utf8'))
  const trimmed = await pack('1.4.5')
  // Reconstruct the previous packaging policy with the exact same dependency
  // lockfile and application bytes: copy all production dependencies.
  const runtime = path.join(payload, 'resources/dsh-runtime')
  if (!resume) fs.cpSync(path.join(root, 'runtime/dsh/node_modules'), path.join(runtime, 'node_modules'), { recursive: true, dereference: true })
  const fullFiles = []
  for (const entry of resume ? [] : fs.readdirSync(runtime, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = path.join(entry.parentPath, entry.name)
    const relative = path.relative(runtime, file).replaceAll('\\', '/')
    if (relative !== 'manifest.json') fullFiles.push({ path: relative, bytes: fs.statSync(file).size })
  }
  if (resume) fullFiles.push(...JSON.parse(fs.readFileSync(path.join(installed, 'resources/dsh-runtime/manifest.json'), 'utf8')).files)
  else fs.writeFileSync(path.join(runtime, 'manifest.json'), JSON.stringify({ ...trimmedManifest, files: fullFiles }, null, 2))
  const baseline = resume ? path.join(work, '1.4.4/benchmark.exe') : await pack('1.4.4')
  record('payload', 0, { beforeFiles: fullFiles.length, afterFiles: trimmedManifest.files.length,
    baselineInstallerBytes: fs.statSync(baseline).size, trimmedInstallerBytes: fs.statSync(trimmed).size })
  if (!resume) run('baseline-fresh', baseline, ['/S', `/D=${installed}`], fullFiles.length, true)
  run('trimmed-upgrade', trimmed, ['/S', `/D=${installed}`], trimmedManifest.files.length)
  const uninstall = () => run('uninstall', path.join(installed, `Uninstall ${product}.exe`), ['/S', '/KEEP_APP_DATA', `_?=${installed}`])
  uninstall()
  if (resume) {
    run('baseline-fresh', baseline, ['/S', `/D=${installed}`], fullFiles.length, true)
    uninstall()
  }
  run('trimmed-fresh', trimmed, ['/S', `/D=${installed}`], trimmedManifest.files.length)
  uninstall()
  fs.unlinkSync(sentinel)
  fs.rmdirSync(dataRoot)
  console.log(`Full-payload benchmark passed: ${path.join(work, 'results.json')}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
