const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const root = path.resolve(__dirname, '..'), output = path.join(root, 'temp/progress-card-review')
if (!process.versions.electron) {
  fs.mkdirSync(output, { recursive: true })
  require('esbuild').buildSync({ entryPoints: [path.join(root, 'tests/fixtures/progress-card-ui.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(output, 'ui.js') })
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  require('node:child_process').spawn(require('electron'), [__filename], { cwd: root, env, stdio: 'inherit', windowsHide: true }).on('exit', code => process.exit(code ?? 1))
} else {
  const { app, BrowserWindow } = require('electron')
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-progress-ui-')))
  app.whenReady().then(async () => {
    fs.writeFileSync(path.join(output, 'index.html'), `<html data-theme="light"><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><style>body{margin:0;font:14px 'Segoe UI',sans-serif;background:var(--bg-primary);color:var(--text-primary)}*{box-sizing:border-box}</style><div id="root"></div><script src="ui.js"></script></html>`)
    const window = new BrowserWindow({ show: false, width: 1024, height: 1100, webPreferences: { offscreen: true } })
    await window.loadFile(path.join(output, 'index.html'))
    for (const theme of ['light', 'dark']) for (const width of [375, 1024]) {
      window.setContentSize(width, 1100)
      await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='${theme}'`)
      await new Promise(resolve => setTimeout(resolve, 150))
      const valid = await window.webContents.executeJavaScript("document.querySelectorAll('.agent-progress-card').length===2 && document.documentElement.scrollWidth<=innerWidth && !document.body.innerText.includes('变化原因') && document.querySelectorAll('.agent-progress-next').length===2")
      if (!valid) throw Error('Progress card layout/content invalid')
      fs.writeFileSync(path.join(output, `${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
    }
    window.destroy(); console.log('PROGRESS_CARD_SMOKE_PASSED'); app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
