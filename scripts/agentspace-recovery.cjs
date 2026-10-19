// Isolated real Electron utilityProcess / SQLite hard-exit recovery exercise.
// Uses only local protocol fixtures; never opens the user's application data.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'artifacts/agentspace-complete/storage-recovery.json')
const roundOption = process.argv.indexOf('--rounds')
const rounds = roundOption < 0 ? 24 : Number(process.argv[roundOption + 1])
if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 1000) throw new Error('Invalid recovery round count')

if (!process.versions.electron) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), ['--disable-gpu', __filename, '--rounds', String(rounds)], { cwd: root, env, windowsHide: true, stdio: 'inherit' })
  const deadline = setTimeout(() => { console.error('Recovery process timed out'); child.kill(); process.exitCode = 1 }, 600000)
  child.on('exit', code => { clearTimeout(deadline); process.exitCode = code ?? 1 })
  child.on('error', error => { clearTimeout(deadline); console.error(error); process.exitCode = 1 })
} else {
  const { app, utilityProcess } = require('electron')
  const { createServer } = require('node:http')
  const Database = require('better-sqlite3')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-recovery-'))
  app.setPath('userData', dir)
  app.disableHardwareAcceleration()
  const report = { startedAt: new Date().toISOString(), directory: dir, requestedRounds: rounds, events: [], completedRounds: 0, providerRequests: 0, integrityChecks: 0, complete: false }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const record = event => { report.events.push({ at: new Date().toISOString(), ...event }); fs.writeFileSync(output, JSON.stringify(report, null, 2)) }
  let current, sequence = 0, server, observer
  const pending = new Map()
  function request(method, id = '', args = []) {
    const process = current
    if (!process) return Promise.reject(new Error('Worker unavailable'))
    return new Promise((resolve, reject) => {
      const requestId = ++sequence
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timeout: ${method}`)) }, 60000)
      pending.set(requestId, { process, resolve, reject, timer })
      process.postMessage({ requestId, method, id, args })
    })
  }
  async function start(identities, directory = path.join(dir, 'contact-agents')) {
    if (current) throw new Error('Previous worker has not exited')
    const child = utilityProcess.fork(path.join(root, 'out/main/agent-worker.js'), [], { serviceName: 'ChouYu storage recovery test', stdio: 'pipe', env: { ...process.env, CHOUYU_SMOKE_TEST: '1', CHOUYU_SMOKE_USER_DATA: dir } })
    current = child
    let pid
    child.once('spawn', () => { pid = child.pid; record({ type: 'spawn', pid }) })
    child.stdout.resume()
    child.stderr.on('data', bytes => {
      const text = String(bytes)
      // Only error classification from this isolated fixture, not arbitrary content.
      for (const code of text.match(/SQLITE_[A-Z_]+/g) || []) record({ type: 'sqlite-error', code })
    })
    child.on('message', message => {
      if (message.started || message.changed) return
      if (message.storageRetry) { record({ type: 'storage-retry', ...message.storageRetry }); return }
      const entry = pending.get(message.requestId)
      if (!entry || entry.process !== child) return
      clearTimeout(entry.timer); pending.delete(message.requestId)
      if (message.error) {
        if (message.storage) record({ type: 'storage-failure', ...message.storage })
        entry.reject(Object.assign(new Error(message.error), { storage: message.storage }))
      } else entry.resolve(message.result)
    })
    child.once('exit', code => {
      record({ type: 'exit', pid, code })
      if (current === child) current = undefined
      for (const [id, entry] of pending) if (entry.process === child) { clearTimeout(entry.timer); pending.delete(id); entry.reject(new Error('Worker exited')) }
    })
    await request('init', '', [directory])
    record({ type: 'ready', pid: child.pid })
    await request('sync', '', [identities])
  }
  async function stop(hard) {
    const child = current
    if (!child) return
    const exited = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker did not exit')), 10000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
    if (!hard) await request('close')
    record({ type: hard ? 'hard-kill' : 'closed', pid: child.pid })
    child.kill()
    await exited
  }
  const until = async (check, label) => {
    const end = Date.now() + 30000
    while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 20)) }
    throw new Error(`Recovery condition timed out: ${label}`)
  }
  app.whenReady().then(async () => {
    const draft = JSON.stringify({ title: 'Recovery result', body: 'Fixture evidence [1].', nextStep: 'Continue', memories: [], question: '', progress: { judgement: 'Saved', openQuestions: '', nextStep: 'Continue', reason: 'Evidence [1].', status: 'researching' } })
    server = createServer(async (req, res) => {
      for await (const _ of req) {} // Fully consume only this test's request.
      report.providerRequests++
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const timer = setTimeout(() => {
        if (res.destroyed) return
        res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: draft }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } })}\n\ndata: [DONE]\n\n`)
      }, 120)
      res.once('close', () => clearTimeout(timer))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const identities = ['recovery-alice', 'recovery-bob'].map(id => ({ id, soul: id, conversation: '', config: { provider: 'openai', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'isolated-fixture', model: 'fixture', thinkingDisabledModels: [] } }))
    let exitCode = 1
    try {
      const failedDirectory = path.join(dir, 'failed-startup')
      fs.mkdirSync(failedDirectory)
      fs.writeFileSync(path.join(failedDirectory, 'checkpoints.db'), 'corrupt fixture'.repeat(100))
      let failure
      try { await start(identities, failedDirectory) } catch (error) { failure = error }
      if (failure?.storage?.phase !== 'wal' || failure.storage.code !== 'SQLITE_NOTADB' || failure.storage.database !== 'checkpoints') throw new Error('Startup failure lost its storage phase')
      // Prove the live failed worker released the first database, not merely
      // that Windows released it when the process was killed.
      fs.renameSync(path.join(failedDirectory, 'agents.db'), path.join(failedDirectory, 'agents.released.db'))
      record({ type: 'failed-startup-released' })
      await stop(true)
      await start(identities)
      for (const { id } of identities) {
        const state = await request('get', id)
        await request('save', id, [{ ...state.settings, enabled: false, goal: 'Recovery fixture', sources: ['https://chouyu-agent-smoke.invalid/research'], permissionLevel: 'sources', dailyCalls: 1000, dailyTokenLimit: 1000000 }])
      }
      // Exercise both the last-connection crash and a retained external reader.
      // Keeping a reader open every round bypasses Windows SHM initialization.
      for (let round = 0; round < rounds; round++) {
        observer = new Database(path.join(dir, 'contact-agents/agents.db'), { readonly: true })
        const before = report.providerRequests
        for (const { id } of identities) await request('run', id)
        await until(() => report.providerRequests >= before + 2, 'both contacts dispatched')
        // Alternate mid-request termination and a finished-transaction boundary.
        if (round % 2) await until(async () => (await Promise.all(identities.map(({ id }) => request('get', id)))).every(state => !state.runs.some(run => ['queued', 'running'].includes(run.status))), 'completed reports')
        const counts = observer.prepare('SELECT character_id, COUNT(*) AS n FROM reports GROUP BY character_id ORDER BY character_id').all()
        const retainedReader = round % 4 >= 2
        if (!retainedReader) { observer.close(); observer = undefined }
        record({ type: 'reader-mode', round, retainedReader, afterCommit: round % 2 === 1 })
        await stop(true)
        await start(identities)
        observer ??= new Database(path.join(dir, 'contact-agents/agents.db'), { readonly: true })
        const after = observer.prepare('SELECT character_id, COUNT(*) AS n FROM reports GROUP BY character_id ORDER BY character_id').all()
        for (const saved of counts) if ((after.find(row => row.character_id === saved.character_id)?.n ?? 0) < saved.n) throw new Error('Committed report lost at restart')
        if (observer.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Contact database integrity failed')
        const checkpoint = new Database(path.join(dir, 'contact-agents/checkpoints.db'), { readonly: true })
        try { if (checkpoint.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Checkpoint integrity failed') }
        finally { checkpoint.close() }
        report.integrityChecks += 2
        await until(async () => (await Promise.all(identities.map(({ id }) => request('get', id)))).every(state => !state.runs.some(run => ['queued', 'running'].includes(run.status))), 'recovered work drained')
        report.completedRounds++
        record({ type: 'round-complete', round, counts: observer.prepare('SELECT character_id, COUNT(*) AS n FROM reports GROUP BY character_id ORDER BY character_id').all() })
        observer.close(); observer = undefined
      }
      await stop(false)
      report.complete = true
      record({ type: 'passed', finishedAt: new Date().toISOString() })
      console.log(`Recovery passed: ${report.completedRounds} hard exits, ${report.integrityChecks} integrity checks; ${output}`)
      exitCode = 0
    } catch (error) {
      record({ type: 'failed', message: error.message })
      console.error(error)
      try { await stop(true) } catch {}
    } finally { observer?.close(); server.closeAllConnections(); server.close(); app.exit(exitCode) }
  }).catch(error => { record({ type: 'failed', message: error.message }); console.error(error); app.exit(1) })
}
