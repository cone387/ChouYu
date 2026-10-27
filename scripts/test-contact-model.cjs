// Manual, paid-provider acceptance. Never changes the real contact or its saved work.
const { spawn } = require('node:child_process')
const { readFileSync, mkdtempSync, rmSync, copyFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-model-acceptance-'))
  const finish = code => {
    // Delete only the directory this parent created, after Electron has released it.
    try { rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
    catch (error) { console.error('Temporary acceptance profile cleanup failed:', error.code || error.name) }
    process.exit(code)
  }
  const child = spawn(require('electron'), [__filename, process.execPath, `--acceptance-profile=${directory}`, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true, env })
  child.on('error', () => finish(1))
  child.on('exit', code => finish(code ?? 1))
} else {
  const { app, safeStorage } = require('electron')
  const directory = process.argv.find(value => value.startsWith('--acceptance-profile='))?.slice('--acceptance-profile='.length)
  if (!directory) throw new Error('Run this acceptance through the Node launcher')
  const localState = join(process.env.APPDATA, 'chouyu', 'Local State')
  if (existsSync(localState)) copyFileSync(localState, join(directory, 'Local State'))
  app.setPath('userData', directory)
  const finish = code => app.exit(code)
  app.whenReady().then(() => {
    const realHome = join(process.env.APPDATA, 'chouyu')
    let source = JSON.parse(readFileSync(join(realHome, 'chouyu-data.json'), 'utf8'))
    if (source.version >= 5) {
      const { DatabaseSync } = require('node:sqlite')
      const db = new DatabaseSync(join(realHome, 'chouyu-application.db'), { readOnly: true })
      try {
        const read = key => JSON.parse(db.prepare('SELECT value FROM metadata WHERE key=?').get(key).value)
        source = { config: read('config'), characters: read('characters') }
      } finally { db.close() }
    }
    const prefix = 'safe:v1:'
    const unprotect = value => { try { return typeof value === 'string' && value.startsWith(prefix) ? safeStorage.decryptString(Buffer.from(value.slice(prefix.length), 'base64')) : value } catch { return '' } }
    const config = { ...source.config, apiKey: unprotect(source.config.apiKey), providerProfiles: source.config.providerProfiles?.map(profile => ({ ...profile, apiKey: unprotect(profile.apiKey) })) }
    const characters = source.characters.filter(character => character.id === 'preset-copywriter-bi')
    const chatChanges = process.argv.includes('--chat-changes')
    const chapters = process.argv.includes('--chapter-continuation')
    const experience = process.argv.includes('--experience')
    const completion = process.argv.includes('--completion')
    const calendar = process.argv.includes('--calendar')
    const discovery = process.argv.includes('--discovery')
    const recovery = process.argv.includes('--recovery')
    const briefing = process.argv.includes('--briefing')
    const length = process.argv.includes('--length')
    const counts = process.argv.includes('--counts')
    const conversation = process.argv.includes('--conversation')
    const matrix = process.argv.includes('--matrix')
    if (process.argv.includes('--autonomy')) {
      const engine = process.argv.find(value => value.startsWith('--engine='))?.slice('--engine='.length)
      if (engine && !['native', 'dsh'].includes(engine)) throw new Error('Invalid autonomy acceptance engine')
      const child = spawn(process.argv[2], ['node_modules/vitest/vitest.mjs', 'run', 'src/main/agents/autonomy-model.acceptance.test.ts', '--maxWorkers=1'], {
        stdio: 'inherit', windowsHide: true,
        env: { ...process.env, CHOUYU_AUTONOMY_ACCEPTANCE: '1', ...(engine ? { CHOUYU_AUTONOMY_ENGINE: engine } : {}), CHOUYU_ACCEPTANCE_CONFIG: JSON.stringify({ config, characters }) }
      })
      const timer = setTimeout(() => { child.kill(); finish(1) }, 570000)
      child.on('error', () => { clearTimeout(timer); finish(1) })
      child.on('exit', code => { clearTimeout(timer); finish(code ?? 1) })
      return
    }
    if (process.argv.includes('--reliability')) {
      const child = spawn(process.argv[2], ['node_modules/vitest/vitest.mjs', 'run', 'src/main/assistant-routines/reliability-model.acceptance.test.ts'], {
        stdio: 'inherit', windowsHide: true, env: { ...process.env, CHOUYU_RELIABILITY_ACCEPTANCE: '1', CHOUYU_ACCEPTANCE_CONFIG: JSON.stringify({ config, characters }) }
      })
      const timer = setTimeout(() => { child.kill(); finish(1) }, 295000)
      child.on('error', () => { clearTimeout(timer); finish(1) })
      child.on('exit', code => { clearTimeout(timer); finish(code ?? 1) })
      return
    }
    if (matrix) {
      const child = spawn(process.argv[2], ['scripts/smoke-electron.js', '--contact-live'], {
        stdio: 'inherit', windowsHide: true,
        env: { ...process.env, CHOUYU_ACCEPTANCE_CONFIG: JSON.stringify({ config, characters }) }
      })
      child.on('error', () => finish(1))
      child.on('exit', code => finish(code ?? 1))
      return
    }
    const child = spawn(process.argv[2], ['node_modules/vitest/vitest.mjs', 'run', conversation ? 'src/main/agents/conversation-model.acceptance.test.ts' : counts ? 'src/main/agents/counts-model.acceptance.test.ts' : length ? 'src/main/agents/length-model.acceptance.test.ts' : briefing ? 'src/main/assistant-routines/briefing-model.acceptance.test.ts' : recovery ? 'src/main/agents/recovery-model.acceptance.test.ts' : discovery ? 'src/main/agents/discovery-model.acceptance.test.ts' : calendar ? 'src/main/assistant-routines/calendar-model.acceptance.test.ts' : completion ? 'src/main/agents/completion-model.acceptance.test.ts' : experience ? 'src/main/agents/experience-model.acceptance.test.ts' : chapters ? 'src/main/agents/chapter-model.acceptance.test.ts' : chatChanges ? 'src/main/agents/chat-change-model.acceptance.test.ts' : 'src/main/agents/contact-model.acceptance.test.ts'], {
      stdio: 'inherit', windowsHide: true,
      env: { ...process.env, ...(conversation ? { CHOUYU_CONVERSATION_ACCEPTANCE: '1' } : counts ? { CHOUYU_COUNTS_ACCEPTANCE: '1' } : length ? { CHOUYU_LENGTH_ACCEPTANCE: '1' } : briefing ? { CHOUYU_BRIEFING_ACCEPTANCE: '1' } : recovery ? { CHOUYU_RECOVERY_ACCEPTANCE: '1' } : discovery ? { CHOUYU_DISCOVERY_ACCEPTANCE: '1' } : calendar ? { CHOUYU_CALENDAR_ACCEPTANCE: '1' } : completion ? { CHOUYU_COMPLETION_ACCEPTANCE: '1' } : experience ? { CHOUYU_EXPERIENCE_ACCEPTANCE: '1' } : chapters ? { CHOUYU_CHAPTER_MODEL_ACCEPTANCE: '1' } : chatChanges ? { CHOUYU_CHAT_CHANGE_ACCEPTANCE: '1', CHOUYU_ACCEPTANCE_CHARACTER: 'preset-copywriter-bi' } : { CHOUYU_CONTACT_MODEL_ACCEPTANCE: '1' }), CHOUYU_ACCEPTANCE_CONFIG: JSON.stringify({ config, characters }) }
    })
    const timer = setTimeout(() => { child.kill(); finish(1) }, 295000)
    child.on('error', () => { clearTimeout(timer); finish(1) })
    child.on('exit', code => { clearTimeout(timer); finish(code ?? 1) })
  }).catch(error => { console.error('Unable to load contact model configuration for isolated acceptance:', error.code || error.name); finish(1) })
}
