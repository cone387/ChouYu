const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '..'), output = path.join(root, 'temp/result-preview-smoke')
fs.mkdirSync(output, { recursive: true })
require('esbuild').buildSync({
  stdin: { contents: `const { app } = require('electron');
    app.on('window-all-closed', () => {});
    const { runResultPreviewSmoke } = require('./src/main/smoke/result-preview-smoke');
    require('./src/main/result-designer/protocol');
    app.setPath('userData', ${JSON.stringify(path.join(output, 'user-data'))});
    app.whenReady().then(() => runResultPreviewSmoke(${JSON.stringify(output)}))
      .then(() => { console.log('RESULT_PREVIEW_SMOKE_PASSED'); app.exit(0) })
      .catch(error => { console.error(String(error).slice(0, 300)); app.exit(1) });`, resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(output, 'main.cjs')
})
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
require('node:child_process').spawn(require('electron'), [path.join(output, 'main.cjs')], { cwd: root, env, stdio: 'inherit', windowsHide: true })
  .on('error', error => { console.error(error); process.exitCode = 1 })
  .on('exit', code => process.exit(code ?? 1))
