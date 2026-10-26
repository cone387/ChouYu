import { app, type BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, mkdirSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { createCharacter, flushDatabase } from '../database'
import { contactAgentsCall, restartAgentsForSmoke } from '../agents'
import { ContactBackups } from '../storage/contact-backups'
import { waitForRenderer } from './storage-smoke'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import type { ContactRuntimeSnapshot } from '../../shared/contact-runtime'

/** Real worker, paired files, application guard and restore IPC. Never touches the user's profile. */
export async function runContactReliabilitySmoke(window: BrowserWindow) {
  assert.equal(process.env.CHOUYU_SMOKE_TEST, '1')
  const home = realpathSync(app.getPath('userData'))
  assert.equal(dirname(home), realpathSync(tmpdir())); assert.ok(basename(home).startsWith('chouyu-smoke-'))
  const directory = join(home, 'contact-agents'), artifacts = process.env.CHOUYU_SMOKE_ARTIFACTS || 'artifacts/contact-reliability/electron'
  mkdirSync(artifacts, { recursive: true })
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const status = () => run('window.electronAPI.agents.runtimeStatus()') as Promise<ContactRuntimeSnapshot>
  const owner = createCharacter({ name: '可靠性验收', avatar: '🧪', category: 'other', soulMd: '独立验收联系人' })
  await contactAgentsCall(owner.id, 'save', [{ ...DEFAULT_AGENT_SETTINGS, enabled: false, goal: '保存的验收任务' }])
  const before = await contactAgentsCall(owner.id, 'get'), first = await status()
  await restartAgentsForSmoke()
  const restarted = await status()
  assert.equal(restarted.phase, 'ready'); assert.ok(restarted.generation > first.generation)
  assert.equal((await contactAgentsCall(owner.id, 'get')).topics[0].id, before.topics[0].id)
  await assert.rejects(restartAgentsForSmoke(() => {
    // Worker.close has drained requests, persisted a final pair and closed handles.
    assert.ok(new ContactBackups(directory).list().length)
    for (const suffix of ['-wal', '-shm']) { const file = join(directory, 'agents.db' + suffix); if (existsSync(file)) unlinkSync(file) }
    writeFileSync(join(directory, 'agents.db'), 'isolated intentional corruption')
  }))
  const damaged = await status()
  assert.equal(damaged.phase, 'unavailable'); assert.equal(damaged.storageRecovery?.kind, 'damaged')
  assert.ok(damaged.storageRecovery.candidates.length)
  await run("window.electronAPI.db.setState('workspace-active-page','contacts')")
  window.webContents.send('open-chat-panel')
  await waitForRenderer(window, `Boolean(document.querySelector('[data-contacts-card-detail="${owner.id}"]'))`, 15000)
  await run(`document.querySelector('[data-contacts-card-detail="${owner.id}"]').click()`)
  await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-runtime=unavailable]'))", 15000)
  await run("Array.from(document.querySelectorAll('[data-contact-runtime] button')).find(b=>b.textContent.includes('恢复备份')).click()")
  await waitForRenderer(window, "Boolean(document.querySelector('dialog[open]'))")
  for (const theme of ['light', 'dark']) for (const width of [375, 1024]) {
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
    window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 768 }, scale: 1 })
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert.equal(await run("(()=>{const d=document.querySelector('dialog[open]'),r=d.getBoundingClientRect();return r.left<0||r.right>innerWidth||d.scrollWidth>d.clientWidth})()"), false)
    writeFileSync(join(artifacts, `restore-${theme}-${width}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
  }
  window.webContents.disableDeviceEmulation()
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await waitForRenderer(window, "!document.querySelector('dialog[open]')")
  assert.equal((await status()).storageRecovery?.kind, 'damaged')
  await run("Array.from(document.querySelectorAll('[data-contact-runtime] button')).find(b=>b.textContent.includes('恢复备份')).click()")
  await waitForRenderer(window, "Boolean(document.querySelector('dialog[open] button[type=submit]'))")
  await run("document.querySelector('dialog[open] button[type=submit]').click()")
  await waitForRenderer(window, "!document.querySelector('dialog[open]')", 30000)
  const restored = await status()
  assert.equal(restored.phase, 'ready')
  const after = await run(`window.electronAPI.agents.get(${JSON.stringify(owner.id)})`)
  assert.equal(after.topics[0].id, before.topics[0].id)
  await assert.rejects(contactAgentsCall(owner.id, 'assignTopic', ['cannot bypass recovery']))
  assert.ok(readdirSync(join(directory, 'recovery')).some(id => existsSync(join(directory, 'recovery', id, 'original', 'agents.db'))))
  assert.ok(!flushDatabase().error)
  await restartAgentsForSmoke()
  await assert.rejects(contactAgentsCall(owner.id, 'assignTopic', ['still protected after restart']))
  writeFileSync(join(artifacts, 'summary.json'), JSON.stringify({ workerCrash: true, preservedTask: true, pairedBackup: true, explicitRestore: true, originalRetained: true,
    protectionAcrossRestart: true, escCancelled: true, viewports: [375, 1024], themes: ['light', 'dark'], generations: [first.generation, restarted.generation, restored.generation] }, null, 2))
}
