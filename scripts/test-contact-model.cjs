// Manual, paid-provider acceptance. Never changes the real contact or its saved work.
const { spawn } = require('node:child_process')
const { readFileSync, mkdtempSync, rmSync, copyFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [__filename, process.execPath, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true, env })
  child.on('exit', code => process.exit(code ?? 1))
} else {
  const { app, safeStorage } = require('electron')
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-model-acceptance-'))
  const localState = join(process.env.APPDATA, 'chouyu', 'Local State')
  if (existsSync(localState)) copyFileSync(localState, join(directory, 'Local State'))
  app.setPath('userData', directory)
  const finish = code => { try { rmSync(directory, { recursive: true, force: true }) } finally { app.exit(code) } }
  app.whenReady().then(() => {
    const source = JSON.parse(readFileSync(join(process.env.APPDATA, 'chouyu', 'chouyu-data.json'), 'utf8'))
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
    const child = spawn(process.argv[2], ['node_modules/vitest/vitest.mjs', 'run', briefing ? 'src/main/assistant-routines/briefing-model.acceptance.test.ts' : recovery ? 'src/main/agents/recovery-model.acceptance.test.ts' : discovery ? 'src/main/agents/discovery-model.acceptance.test.ts' : calendar ? 'src/main/assistant-routines/calendar-model.acceptance.test.ts' : completion ? 'src/main/agents/completion-model.acceptance.test.ts' : experience ? 'src/main/agents/experience-model.acceptance.test.ts' : chapters ? 'src/main/agents/chapter-model.acceptance.test.ts' : chatChanges ? 'src/main/agents/chat-change-model.acceptance.test.ts' : 'src/main/agents/contact-model.acceptance.test.ts'], {
      stdio: 'inherit', windowsHide: true,
      env: { ...process.env, ...(briefing ? { CHOUYU_BRIEFING_ACCEPTANCE: '1' } : recovery ? { CHOUYU_RECOVERY_ACCEPTANCE: '1' } : discovery ? { CHOUYU_DISCOVERY_ACCEPTANCE: '1' } : calendar ? { CHOUYU_CALENDAR_ACCEPTANCE: '1' } : completion ? { CHOUYU_COMPLETION_ACCEPTANCE: '1' } : experience ? { CHOUYU_EXPERIENCE_ACCEPTANCE: '1' } : chapters ? { CHOUYU_CHAPTER_MODEL_ACCEPTANCE: '1' } : chatChanges ? { CHOUYU_CHAT_CHANGE_ACCEPTANCE: '1', CHOUYU_ACCEPTANCE_CHARACTER: 'preset-copywriter-bi' } : { CHOUYU_CONTACT_MODEL_ACCEPTANCE: '1' }), CHOUYU_ACCEPTANCE_CONFIG: JSON.stringify({ config, characters }) }
    })
    const timer = setTimeout(() => { child.kill(); finish(1) }, 295000)
    child.on('error', () => { clearTimeout(timer); finish(1) })
    child.on('exit', code => { clearTimeout(timer); finish(code ?? 1) })
  }).catch(error => { console.error('Unable to load contact model configuration for isolated acceptance:', error.code || error.name); finish(1) })
}
