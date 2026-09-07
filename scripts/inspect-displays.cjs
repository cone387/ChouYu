// Read-only Electron display inventory. Creates no window and reads no app data.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
if (process.versions.electron) {
  const { app, screen } = require('electron')
  app.setPath('userData', process.env.CHOUYU_DISPLAY_PROBE_DATA)
  app.whenReady().then(() => {
    const report = { timestamp: new Date().toISOString(), displays: screen.getAllDisplays().map(display => ({
      id: display.id, bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor,
      rotation: display.rotation, internal: display.internal
    })) }
    fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n')
    app.exit(0)
  }).catch(() => app.exit(1))
} else {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-display-probe-'))
  const env = { ...process.env, CHOUYU_DISPLAY_PROBE_DATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const child = require('node:child_process').spawn(require('electron'), [__filename, path.resolve(process.argv[2] || 'temp/display-inventory.json')], { env, windowsHide: true, stdio: 'inherit' })
  let finished = false
  const deadline = setTimeout(() => { child.kill(); finish(1) }, 15000)
  function finish(code) {
    if (finished) return
    finished = true
    clearTimeout(deadline)
    if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('chouyu-display-probe-')) fs.rmSync(directory, { recursive: true, force: true })
    process.exitCode = code ?? 1
  }
  child.once('error', () => finish(1))
  child.once('exit', finish)
}
