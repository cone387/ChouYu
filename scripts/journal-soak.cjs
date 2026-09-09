const fs = require('fs')
const path = require('path')
const { builtinModules } = require('module')
const { spawn, execFileSync } = require('child_process')
const { createHash, randomUUID } = require('crypto')

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('node scripts/journal-soak.cjs [--minutes 2 | --hours 24] [--interval-seconds 5] [--restart-seconds 3600] [--native] [--no-ocr] [--output temp/new-directory]\nWrites isolated data and report.json. Create stop.request in the output directory to stop cleanly. Native mode displays and captures only its own test window; default mode uses hidden synthetic rendering.')
    return
  }
  const value = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] }
  const allowed = new Set(['--minutes', '--hours', '--interval-seconds', '--restart-seconds', '--native', '--no-ocr', '--output'])
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`)
    if (!['--native', '--no-ocr'].includes(args[i])) { if (!args[++i] || args[i].startsWith('--')) throw new Error('Missing argument value') }
  }
  if (args.includes('--minutes') && args.includes('--hours')) throw new Error('Choose minutes or hours, not both')
  const durationMs = Number(value('--hours', Number(value('--minutes', '2')) / 60)) * 3600000
  const intervalMs = Number(value('--interval-seconds', '5')) * 1000
  const restartMs = Number(value('--restart-seconds', '3600')) * 1000
  if (![durationMs, intervalMs, restartMs].every(Number.isFinite) || durationMs < 10000 || durationMs > 48 * 3600000 || intervalMs < 1000 || intervalMs > 60000 || restartMs < 10000) throw new Error('Duration must be 10 seconds–48 hours, interval 1–60 seconds, restart interval at least 10 seconds')
  const root = path.resolve(__dirname, '..')
  const output = path.resolve(root, value('--output', `temp/journal-soak/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`))
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.mkdirSync(output) // Never overwrite another run.
  const bundle = path.join(output, 'bundle')
  fs.mkdirSync(bundle)
  const hash = createHash('sha256')
  const hashTree = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const file = path.join(directory, entry.name); if (entry.isDirectory()) hashTree(file); else { hash.update(path.relative(root, file)); hash.update(fs.readFileSync(file)) } } }
  for (const directory of ['src/main/journal', 'src/main/evaluation', 'src/shared']) hashTree(path.join(root, directory))
  for (const name of ['scripts/journal-soak.cjs', 'package.json', 'package-lock.json', 'resources/journal-capture.html', 'resources/journal-ocr.ps1', 'resources/journal-ocr-mac.js']) { hash.update(name); hash.update(fs.readFileSync(path.join(root, name))) }
  let head = ''
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim() } catch {}
  const options = { durationMs, intervalMs, restartMs, native: args.includes('--native'), ocr: !args.includes('--no-ocr'), output, sourceHash: hash.digest('hex'), gitHead: head }
  fs.writeFileSync(path.join(output, 'options.json'), JSON.stringify(options, null, 2))
  const { build } = await import('vite')
  await build({ configFile: false, root, logLevel: 'warn', build: { ssr: true, outDir: bundle, emptyOutDir: false, target: 'node24',
    rollupOptions: { input: { runner: path.join(root, 'src/main/evaluation/journal-soak.ts'), 'journal-worker': path.join(root, 'src/main/journal/journal-worker.ts') },
      external: id => id === 'electron' || id === 'better-sqlite3' || id.startsWith('node:') || builtinModules.includes(id),
      output: { format: 'cjs', entryFileNames: '[name].cjs', chunkFileNames: 'chunks/[name]-[hash].cjs' } } } })
  fs.mkdirSync(path.join(bundle, 'resources'))
  for (const name of ['journal-capture.html', 'journal-ocr.ps1', 'journal-ocr-mac.js']) fs.copyFileSync(path.join(root, 'resources', name), path.join(bundle, 'resources', name))
  fs.writeFileSync(path.join(bundle, 'package.json'), JSON.stringify({ name: 'chouyu-journal-soak', version: '1.0.0', main: 'runner.cjs' }))
  const env = { ...process.env, CHOUYU_SOAK_OPTIONS: path.join(output, 'options.json') }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), ['--disable-gpu', bundle], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const log = fs.createWriteStream(path.join(output, 'console.log'), { flags: 'a' })
  child.stdout.on('data', data => { process.stdout.write(data); log.write(data) })
  child.stderr.on('data', data => { process.stderr.write(data); log.write(data) })
  const stop = () => { fs.writeFileSync(path.join(output, 'stop.request'), 'requested\n'); console.log('Stop requested; waiting for current cycle cleanup.') }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
  child.once('error', error => { log.end(); console.error(error); process.exitCode = 1 })
  child.once('exit', code => { log.end(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); process.exitCode = code ?? 1 })
  console.log(`SOAK_LAUNCHED pid=${child.pid} output=${output}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
