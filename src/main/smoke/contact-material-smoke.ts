import { app, dialog, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { AgentStore } from '../agents/store'
import { restartAgentsForSmoke } from '../agents'
import { getActiveSession, getConfig, saveConfig, selectChatSession, flushDatabase } from '../database'
import { waitForRenderer } from './storage-smoke'
export async function runContactMaterialSmoke(window: BrowserWindow, owner: string, setReference: (ref: { id: string; version: number } | undefined) => void, request: () => unknown) {
  const run = (s: string) => window.webContents.executeJavaScript(s), ownerJson = JSON.stringify(owner)
  const click = (selector: string) => run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing material control');e.click()})()`)
  const fill = (selector: string, value: string) => run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  const store = new AgentStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
  const active = getActiveSession().id, config = getConfig()
  try {
    await click('[data-agent-tab=materials]'); await waitForRenderer(window, "Boolean(document.querySelector('[data-material-new]'))")
    await click('[data-material-new]'); await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-material-dialog][open]'))")
    await fill('[data-material-name]', '项目资料'); await fill('[data-material-content]', '原版本：项目采用蓝色主题。')
    store.db.exec("CREATE TRIGGER material_smoke_failure BEFORE INSERT ON contact_material_versions BEGIN SELECT RAISE(ABORT,'material write failure'); END")
    await click('[data-material-save]'); await waitForRenderer(window, "document.querySelector('[data-contact-material-dialog] [role=alert]')?.textContent.includes('material write failure')")
    if (await run("document.querySelector('[data-material-content]').value") !== '原版本：项目采用蓝色主题。') throw new Error('Failed material import lost draft')
    if (process.env.CHOUYU_SMOKE_ARTIFACTS) {
      mkdirSync(process.env.CHOUYU_SMOKE_ARTIFACTS, { recursive: true })
      const oldTheme = await run('document.documentElement.dataset.theme')
      for (const theme of ['light', 'dark']) for (const width of [375, 1024]) {
        await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 900 }, viewSize: { width, height: 900 }, deviceScaleFactor: 1, scale: 1, viewPosition: { x: 0, y: 0 } })
        await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        if (!await run("(()=>{const r=document.querySelector('[data-contact-material-dialog]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()")) throw new Error('Material modal overflows viewport')
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        writeFileSync(join(process.env.CHOUYU_SMOKE_ARTIFACTS, `material-dialog-${theme}-${width}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 900 }, { stayHidden: true, stayAwake: true })).toPNG())
      }
      window.webContents.disableDeviceEmulation(); await run(`document.documentElement.dataset.theme=${JSON.stringify(oldTheme || 'light')}`)
    }
    store.db.exec('DROP TRIGGER material_smoke_failure')
    await click('[data-material-save]'); await waitForRenderer(window, "!document.querySelector('[data-contact-material-dialog]') && document.querySelector('.contact-materials')?.textContent.includes('项目资料')")
    const original = store.materials.list({ characterId: owner, query: '' })[0], row = `[data-material-id="${original.id}"]`
    await click(`${row} [data-material-edit]`); await waitForRenderer(window, "document.querySelector('[data-material-content]')?.value.includes('原版本') && !document.querySelector('[data-material-save]').disabled")
    await fill('[data-material-content]', '第二版：项目采用绿色主题。'); await click('[data-material-save]')
    await waitForRenderer(window, `!document.querySelector('[data-contact-material-dialog]') && document.querySelector('${row}')?.textContent.includes('第 2 版')`)
    const old = await run(`window.electronAPI.agents.readMaterial(${ownerJson},{query:''},${JSON.stringify(original)})`)
    if (!old.text.includes('蓝色')) throw new Error('Material update overwrote old version')
    const file = join(app.getPath('userData'), 'reference.md'); writeFileSync(file, '文件资料：持续保留独立版本。', 'utf8')
    const show = dialog.showOpenDialog
    try {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof show
      const imported = await run(`window.electronAPI.agents.importMaterial(${ownerJson},{name:'文件',scope:{kind:'contact'},source:{kind:'file',label:'file'}})`)
      if (imported.source.label !== 'reference.md' || !imported.content.includes('独立版本')) throw new Error('File import did not copy text or stripped source name')
    } finally { dialog.showOpenDialog = show }
    await restartAgentsForSmoke()
    const session = (await run(`window.electronAPI.db.createSession('Material reference smoke',${ownerJson})`)).activeSession.id
    setReference({ id: original.id, version: 1 }); saveConfig({ aiToolsEnabled: true })
    const reply = await run(`window.electronAPI.ai.startStream(${JSON.stringify({ requestId: 'material-context-smoke', characterId: owner, sessionId: session, messages: [{ role: 'user', content: 'MATERIAL_TOOL_SMOKE 请读取指定资料' }], systemPrompt: 'Use the requested material.' })})`)
    if (!reply.ok || reply.contactContext?.materials?.[0]?.version !== 1) throw new Error('Material tool did not produce actual version receipt')
    if (!JSON.stringify(request()).includes('原版本：项目采用蓝色主题。')) throw new Error('Read text was not sent back to provider')
    await click(`${row} [data-material-withdraw]`); await waitForRenderer(window, `!document.querySelector('${row}')`)
    const rejected = await run(`window.electronAPI.agents.readMaterial(${ownerJson},{query:''},${JSON.stringify(original)}).then(()=>false,()=>true)`)
    if (!rejected) throw new Error('Withdrawn old material remains readable')
    await click('.contact-material-cleanup summary')
    await waitForRenderer(window, `Boolean(document.querySelector('[data-material-cleanup="${original.id}"]'))`)
    await click(`[data-material-cleanup="${original.id}"]`)
    await waitForRenderer(window, "Boolean(document.querySelector('[data-material-cleanup-dialog][open]'))")
    if (process.env.CHOUYU_SMOKE_ARTIFACTS) {
      const themeBefore = await run('document.documentElement.dataset.theme')
      for (const theme of ['light', 'dark']) for (const width of [375, 1024]) {
        await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 900 }, viewSize: { width, height: 900 }, deviceScaleFactor: 1, scale: 1, viewPosition: { x: 0, y: 0 } })
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        if (!await run("(()=>{const d=document.querySelector('[data-material-cleanup-dialog]'),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&d.scrollWidth<=d.clientWidth+1})()")) throw Error('Material cleanup dialog overflows')
        writeFileSync(join(process.env.CHOUYU_SMOKE_ARTIFACTS, `material-cleanup-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
      }
      window.webContents.disableDeviceEmulation(); await run(`document.documentElement.dataset.theme=${JSON.stringify(themeBefore || 'light')}`)
    }
    store.db.exec("CREATE TRIGGER material_purge_failure BEFORE UPDATE ON contact_material_versions BEGIN SELECT RAISE(ABORT,'material purge failure'); END")
    try {
      await click('[data-material-purge]'); await waitForRenderer(window, "document.querySelector('[data-material-cleanup-dialog] [role=alert]')?.textContent.includes('material purge failure')")
    } finally { store.db.exec('DROP TRIGGER material_purge_failure') }
    await click('[data-material-purge]'); await waitForRenderer(window, "!document.querySelector('[data-material-cleanup-dialog]')")
    if (store.materials.history(owner, original.id).some(v => v.status !== 'removed')) throw Error('Cleanup did not retain removed source versions')
    if (await run(`window.electronAPI.agents.readMaterial(${ownerJson},{query:''},${JSON.stringify(original)}).then(()=>false,e=>String(e).includes('正文已移除'))`) !== true) throw Error('Removed source does not explain missing body')
    console.log('CHOUYU_CONTACT_MATERIAL_SMOKE_PASSED import failure/retry, update/history, file copy, restart, actual tool reference and withdrawal')
  } finally { setReference(undefined); store.db.exec('DROP TRIGGER IF EXISTS material_smoke_failure'); store.close(); saveConfig(config); selectChatSession(active); await flushDatabase() }
}
