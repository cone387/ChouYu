// Paid real-model endurance run. Synthetic contacts only; credentials stay encrypted on disk.
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { createServer } = require('node:http')
const { Readable } = require('node:stream')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')

async function main() {
  if (process.versions.electron) {
    const { app, safeStorage } = require('electron')
    const output = process.argv[2], userData = path.join(output, 'user-data')
    app.setPath('userData', userData)
    await app.whenReady()
    try {
      const source = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'chouyu', 'chouyu-data.json'), 'utf8'))
      const writer = source.characters.find(c => c.id === 'preset-copywriter-bi')
      const selected = source.config.providerProfiles?.find(p => p.id === writer?.providerProfileId)
      const profile = selected || source.config
      const raw = profile.apiKey?.startsWith('safe:v1:') ? safeStorage.decryptString(Buffer.from(profile.apiKey.slice(8), 'base64')) : profile.apiKey
      if (!raw || !safeStorage.isEncryptionAvailable()) throw Error('Provider credentials unavailable for isolated endurance run')
      const now = Date.now(), model = writer?.model || profile.model || source.config.model
      const config = { provider: profile.provider, baseUrl: profile.baseUrl, model, apiKey: `safe:v1:${safeStorage.encryptString(raw).toString('base64')}`, thinkingDisabledModels: source.config.thinkingDisabledModels,
        aiToolsEnabled: true, proactiveGreeting: false, proactiveRestReminder: false, proactiveReturn: false, clipboardWatch: false,
        soulMd: '你是 ChouYu，用户的专属助手。只根据已保存的真实联系人状态汇报，不把聊天承诺当作进展。' }
      const characters = [
        { id: 'chouyu', name: 'ChouYu', soulMd: '', builtIn: true },
        { id: 'soak-writer', name: '验收作者', soulMd: '你是独立的验收作者，只创作和保存自己的正文，不能借用ChouYu身份。', builtIn: false },
        { id: 'soak-reviewer', name: '验收评审', soulMd: '你是独立的验收评审，只读取真实正文给出结论和依据，不替作者写作。', builtIn: false }
      ].map(c => ({ ...c, avatar: '', model, providerProfileId: 'default', createdAt: now, updatedAt: now }))
      fs.writeFileSync(path.join(userData, 'chouyu-data.json'), JSON.stringify({ version: 4, config, characters, sessions: [], activeSessionId: '', state: { presetCharactersSeeded: String(now) } }))
      app.exit(0)
    } catch (error) { console.error('Contact soak preparation failed:', error.code || error.name); app.exit(1) }
    return
  }
  const args = process.argv.slice(2), value = (key, fallback) => { const n = args.indexOf(key); return n < 0 ? fallback : args[n + 1] }
  if (args.includes('--help')) { console.log('node scripts/contact-soak.cjs --hours 24 [--output new-directory] [--restart-seconds 900]\nUses configured writer model, encrypted isolated data, real wall clock, one controlled HTTP 503, worker/app restart. Create stop.request in output to stop. No host sleep or native-tray claim.'); return }
  const hours = Number(value('--hours', '24')), restartMs = Number(value('--restart-seconds', '900')) * 1000
  if (!Number.isFinite(hours) || hours < .02 || hours > 48 || !Number.isFinite(restartMs) || restartMs < 60000) throw Error('Invalid duration or restart interval')
  const output = path.resolve(root, value('--output', `artifacts/contact-next/soak-${new Date().toISOString().replace(/[:.]/g, '-')}`))
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.mkdirSync(output)
  const userData = path.join(output, 'user-data'); fs.mkdirSync(userData)
  const localState = path.join(process.env.APPDATA, 'chouyu', 'Local State')
  if (fs.existsSync(localState)) fs.copyFileSync(localState, path.join(userData, 'Local State'))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  await new Promise((resolve, reject) => {
    const prepare = spawn(require('electron'), [__filename, output], { cwd: root, env, windowsHide: true, stdio: 'inherit' })
    prepare.once('error', reject); prepare.once('exit', code => code === 0 ? resolve() : reject(Error('Provider preparation failed')))
  })
  const filename = path.join(userData, 'chouyu-data.json'), data = JSON.parse(fs.readFileSync(filename, 'utf8'))
  const upstream = new URL(data.config.baseUrl), proxyEvents = path.join(output, 'provider-events.jsonl')
  let injected = false, serial = 0
  const proxy = createServer((request, response) => {
    let body = ''; request.setEncoding('utf8'); request.on('data', part => { body += part })
    request.on('end', async () => {
      const id = ++serial, began = Date.now()
      if (!injected && body.includes('验收评审')) {
        injected = true; response.writeHead(503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'Controlled contact endurance HTTP 503', type: 'server_error' } }))
        fs.appendFileSync(proxyEvents, JSON.stringify({ id, at: new Date().toISOString(), injected: true, status: 503 }) + '\n'); return
      }
      const controller = new AbortController(); response.on('close', () => { if (!response.writableEnded) controller.abort() })
      try {
        const headers = Object.fromEntries(Object.entries(request.headers).filter(([key]) => !['host', 'connection', 'content-length', 'transfer-encoding'].includes(key)))
        const result = await fetch(`${upstream.origin}${request.url}`, { method: request.method, headers, ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body }), signal: controller.signal })
        response.writeHead(result.status, Object.fromEntries([...result.headers].filter(([key]) => !['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key))))
        if (result.body) await new Promise((resolve, reject) => {
          const stream = Readable.fromWeb(result.body)
          // Synthetic responses only, no request headers or credentials; bounded diagnostics for invalid model output.
          let captured = 0
          stream.on('data', part => { if (captured < 1048576) fs.appendFileSync(path.join(output, `response-${id}.sse`), part.subarray(0, 1048576 - captured)); captured += part.length })
          stream.on('error', reject); response.on('error', reject); response.on('finish', resolve); response.on('close', resolve); stream.pipe(response)
        })
        else response.end()
        fs.appendFileSync(proxyEvents, JSON.stringify({ id, at: new Date().toISOString(), status: result.status, elapsedMs: Date.now() - began, cancelled: controller.signal.aborted }) + '\n')
      } catch (error) {
        if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json' })
        if (!response.destroyed) response.end(JSON.stringify({ error: { message: 'Acceptance forwarding connection interrupted' } }))
        fs.appendFileSync(proxyEvents, JSON.stringify({ id, at: new Date().toISOString(), error: error.name, elapsedMs: Date.now() - began }) + '\n')
      }
    })
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  data.config.baseUrl = `http://127.0.0.1:${proxy.address().port}${upstream.pathname}`
  fs.writeFileSync(filename, JSON.stringify(data))
  const bundle = path.join(output, 'bundle'); fs.cpSync(path.join(root, 'out'), bundle, { recursive: true })
  fs.writeFileSync(path.join(bundle, 'package.json'), JSON.stringify({ name: 'chouyu-contact-endurance', version: '1.0.0', main: 'main/index.js' }))
  const hash = createHash('sha256')
  const hashTree = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const file = path.join(directory, entry.name); if (entry.isDirectory()) hashTree(file); else { hash.update(path.relative(bundle, file)); hash.update(fs.readFileSync(file)) } } }
  hashTree(bundle)
  const options = { output, durationMs: hours * 3600000, restartMs, sourceHash: hash.digest('hex'), gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(), model: data.config.model, provider: data.config.provider, providerHost: upstream.host, beganAt: Date.now() }
  const optionsPath = path.join(output, 'options.json'); fs.writeFileSync(optionsPath, JSON.stringify(options, null, 2))
  const log = fs.createWriteStream(path.join(output, 'console.log'), { flags: 'a' })
  fs.writeFileSync(path.join(output, 'launcher.json'), JSON.stringify({ pid: process.pid, output, beganAt: options.beganAt }))
  const stop = () => fs.writeFileSync(path.join(output, 'stop.request'), 'User stop\n')
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
  let code = 75
  while (code === 75) {
    code = await new Promise(resolve => {
      const child = spawn(require('electron'), ['--disable-gpu', bundle], { cwd: root, windowsHide: true, env: { ...env, CHOUYU_SMOKE_TEST: '1', CHOUYU_SMOKE_USER_DATA: userData, CHOUYU_CONTACT_SOAK_OPTIONS: optionsPath }, stdio: ['ignore', 'pipe', 'pipe'] })
      fs.writeFileSync(path.join(output, 'process.json'), JSON.stringify({ launcherPid: process.pid, appPid: child.pid, startedAt: Date.now() }))
      child.stdout.on('data', part => log.write(part)); child.stderr.on('data', part => log.write(part))
      child.once('error', () => resolve(1)); child.once('exit', status => resolve(status ?? 1))
    })
  }
  proxy.close(); log.end(); process.exitCode = code
}
main().catch(error => { console.error('Contact endurance failed:', error.message); process.exitCode = 1 })
