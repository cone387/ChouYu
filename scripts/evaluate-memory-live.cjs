// Explicit opt-in integration evaluation. Reads connection configuration only; never loads chat history into the evaluator.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')

async function launch() {
  const configFile = process.argv[2]
  const reportFile = process.argv[3]
  if (!configFile || !reportFile) throw new Error('Usage: node scripts/evaluate-memory-live.cjs <app-data-json> <report-json>')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-memory-eval-'))
  const bundle = path.join(directory, 'extractor.cjs')
  try {
    // Chromium's Windows key is scoped to userData. Copy only its OS-protected
    // encryption metadata into the isolated profile, never cookies or history.
    const localState = path.join(path.dirname(path.resolve(configFile)), 'Local State')
    if (process.platform === 'win32' && fs.existsSync(localState)) {
      const { os_crypt } = JSON.parse(fs.readFileSync(localState, 'utf8'))
      if (os_crypt) fs.writeFileSync(path.join(directory, 'Local State'), JSON.stringify({ os_crypt }))
    }
    const entry = process.argv.includes('--journal') ? 'src/main/smoke/journal-live.ts' : process.argv.includes('--recall') ? 'src/main/smoke/mem0-recall-live.ts' : process.argv.includes('--mem0') ? 'src/main/smoke/mem0-live.ts' : process.argv.includes('--provider') ? 'src/main/smoke/provider-live.ts' : 'src/main/memory/llm-extractor.ts'
    await require('esbuild').build({ entryPoints: [path.join(root, entry)], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], plugins: [{ name: 'native-sqlite', setup(build) { build.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: require.resolve('better-sqlite3'), external: true })) } }], outfile: bundle, logLevel: 'silent' })
    const env = { ...process.env, CHOUYU_EVAL_USER_DATA: directory, NODE_PATH: path.join(root, 'node_modules') }
    delete env.ELECTRON_RUN_AS_NODE
    const code = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename, path.resolve(configFile), path.resolve(reportFile), bundle, ...process.argv.slice(4)], { env, windowsHide: true, stdio: 'inherit' })
      child.on('error', reject)
      child.on('exit', code => resolve(code ?? 1))
    })
    process.exitCode = code
  } finally {
    // This exact temporary directory was created above, never obtained from configuration.
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('chouyu-memory-eval-')) throw new Error('Unexpected evaluation cleanup path')
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

async function evaluate() {
  const { app, safeStorage } = require('electron')
  app.setPath('userData', process.env.CHOUYU_EVAL_USER_DATA)
  await app.whenReady()
  let stage = 'read-config'
  try {
    const [configFile, reportFile, bundle] = process.argv.slice(2)
    const { config } = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    stage = 'decrypt-credential'
    if (config.apiKey.startsWith('safe:v1:')) config.apiKey = safeStorage.decryptString(Buffer.from(config.apiKey.slice(8), 'base64'))
    if (!config.apiKey || !config.baseUrl || !config.model) throw new Error('Incomplete provider configuration')
    stage = 'load-extractor'
    if (process.argv.includes('--journal')) {
      const { runJournalAcceptance } = require(bundle)
      const originalLog = console.log
      let result
      try { console.log = () => {}; result = await runJournalAcceptance(config) } finally { console.log = originalLog }
      fs.mkdirSync(path.dirname(reportFile), { recursive: true })
      fs.writeFileSync(reportFile, JSON.stringify({ timestamp: new Date().toISOString(), ...result }, null, 2) + '\n')
      console.log(`Journal model check: ${result.passed ? 'PASS' : 'FAIL'}, model=${result.model}`)
      app.exit(result.passed ? 0 : 1)
      return
    }
    if (process.argv.includes('--mem0') || process.argv.includes('--recall')) {
      if (config.memorySyncApiKey?.startsWith('safe:v1:')) config.memorySyncApiKey = safeStorage.decryptString(Buffer.from(config.memorySyncApiKey.slice(8), 'base64'))
      if (process.argv.includes('--recall')) {
        const corpus = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/mem0-recall-evaluation.json'), 'utf8'))
        const report = await require(bundle).runMem0Recall(config, corpus, process.argv.includes('--answer-evidence'))
        fs.mkdirSync(path.dirname(reportFile), { recursive: true })
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
        console.log(`Recall@3=${report.meanRecallAt3}, MRR=${report.meanReciprocalRank}, negative abstentions=${report.negativeAbstentions}/${report.negativeQueries}, cleanup=${report.cleanupPassed}`)
        app.exit(report.passed ? 0 : 1)
        return
      }
      if (process.argv.includes('--schema')) {
        const response = await fetch(new URL('/openapi.json', config.memorySyncBaseUrl), { headers: { 'X-API-Key': config.memorySyncApiKey }, signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw new Error('Schema unavailable')
        const schema = await response.json()
        const operations = Object.entries(schema.paths || {}).filter(([name]) => name.includes('memories')).map(([name, value]) => ({ path: name, put: value.put?.requestBody, delete: Boolean(value.delete) }))
        const referenced = operations.map(item => item.put?.content?.['application/json']?.schema?.$ref?.split('/').at(-1)).filter(Boolean)
        const definitions = Object.fromEntries(referenced.map(name => [name, schema.components?.schemas?.[name]]))
        fs.writeFileSync(reportFile, JSON.stringify({ operations, definitions }, null, 2))
        app.exit(0)
        return
      }
      const { runMem0Acceptance } = require(bundle)
      const cleanupIndex = process.argv.indexOf('--cleanup-report')
      const cleanupTarget = cleanupIndex >= 0 ? JSON.parse(fs.readFileSync(process.argv[cleanupIndex + 1], 'utf8')) : undefined
      const report = { timestamp: new Date().toISOString(), ...await runMem0Acceptance(config, cleanupTarget) }
      fs.mkdirSync(path.dirname(reportFile), { recursive: true })
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
      console.log(`Mem0 acceptance: ${report.passed ? 'PASS' : 'FAIL'}, cleanup=${report.cleanupPassed}`)
      app.exit(report.passed ? 0 : 1)
      return
    }
    if (process.argv.includes('--provider')) {
      const { runProviderAcceptance } = require(bundle)
      const result = await runProviderAcceptance(config)
      const report = { timestamp: new Date().toISOString(), provider: config.provider, host: new URL(config.baseUrl).hostname, model: config.model, ...result }
      fs.mkdirSync(path.dirname(reportFile), { recursive: true })
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
      app.exit(result.passed ? 0 : 1)
      return
    }
    const { extractMemoriesWithLLM } = require(bundle)
    stage = 'read-corpus'
    const corpus = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/memory-live-evaluation.json'), 'utf8'))
    const results = []
    let cursor = 0
    const worker = async () => {
      for (;;) {
        const index = cursor++
        if (index >= corpus.length) return
        const sample = corpus[index]
        try {
          const actual = await extractMemoriesWithLLM(sample.text, config)
          const passed = sample.type === null ? actual.length === 0 : actual.length === 1 && actual[0].type === sample.type && actual[0].content.toLowerCase().includes(sample.contains.toLowerCase())
          results.push({ id: sample.id, expected: sample, actual, passed })
          console.log(`${sample.id}: ${passed ? 'PASS' : 'FAIL'}`)
        } catch (error) {
          // Do not include transport URLs, request headers or credentials in error output.
          results.push({ id: sample.id, expected: sample, passed: false, error: error?.name === 'TimeoutError' ? 'timeout' : 'provider-request-failed' })
          console.log(`${sample.id}: ERROR`)
        }
      }
    }
    stage = 'evaluate'
    await Promise.all([worker(), worker()])
    results.sort((a, b) => corpus.findIndex(item => item.id === a.id) - corpus.findIndex(item => item.id === b.id))
    const report = { timestamp: new Date().toISOString(), extractorSha256: createHash('sha256').update(fs.readFileSync(bundle)).digest('hex'), provider: config.provider, host: new URL(config.baseUrl).hostname, model: config.model, temperature: 0, sampleCount: results.length, passed: results.filter(item => item.passed).length, errors: results.filter(item => item.error).length, results }
    fs.mkdirSync(path.dirname(reportFile), { recursive: true })
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
    console.log(`Evaluation: ${report.passed}/${report.sampleCount}, errors=${report.errors}`)
    app.exit(report.passed === report.sampleCount ? 0 : 1)
  } catch (error) {
    console.error(`Live evaluation failed at ${stage}: ${error.name}, code=${error.code || 'none'}`)
    app.exit(1)
  }
}

if (process.versions.electron) void evaluate()
else void launch().catch(error => { console.error(error.message); process.exitCode = 1 })
