import { app, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AgentStore } from '../agents/store'
import { waitForRenderer } from './storage-smoke'

/** Real modal/IPC/disk failure flow; only run in the isolated smoke profile. */
export async function runContactMemorySmoke(window: BrowserWindow, characterId: string) {
  const run = (script: string) => window.webContents.executeJavaScript(script)
  const click = async (selector: string) => {
    const point = await run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el || el.disabled) throw new Error('Missing or disabled memory control: ' + ${JSON.stringify(selector)});
      el.scrollIntoView({block:'center'});
      const r = el.getBoundingClientRect(), x = Math.round(r.x+r.width/2), y = Math.round(r.y+r.height/2);
      if (!el.contains(document.elementFromPoint(x,y))) throw new Error('Memory control covered');
      return {x,y};
    })()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  const fill = (value: string) => run(`(() => {
    const el = document.querySelector('[data-contact-memory-input]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`)
  const modal = 'dialog[data-contact-memory-dialog][open]'
  await click('[data-agent-tab=memory]')
  await waitForRenderer(window, "Boolean(document.querySelector('.agent-memories'))", 15000).catch(async error => {
    console.error('MEMORY_SMOKE_DIAGNOSTIC', await run("Array.from(document.querySelectorAll('.contact-agent')).map(el=>({text:el.textContent,visible:!!el.getClientRects().length}))"))
    throw error
  })
  if (await run("Array.from(document.querySelectorAll('.contact-agent form textarea')).some(el => el.getClientRects().length > 0)")) throw new Error('Memory creation still uses an inline form')
  await click('[data-contact-memory-new]')
  await waitForRenderer(window, `Boolean(document.querySelector('${modal}'))`)
  if (!await run("document.activeElement?.matches('[data-contact-memory-input]')")) throw new Error('Memory input did not receive focus')
  await fill('取消的内容不应保存')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await waitForRenderer(window, `!document.querySelector('${modal}') && Boolean(document.querySelector('.contacts-detail'))`)
  // The shared Escape contract clears restored button focus after dismissal.
  await waitForRenderer(window, "!document.activeElement?.matches('[data-contact-memory-new]')")
  const before = await run(`window.electronAPI.agents.get(${JSON.stringify(characterId)})`)
  if (before.memories.some((m: { content: string }) => m.content === '取消的内容不应保存')) throw new Error('Cancelled memory persisted')

  await click('[data-contact-memory-new]')
  await waitForRenderer(window, `Boolean(document.querySelector('${modal}'))`)
  await click(`${modal} button[type=button]`)
  await waitForRenderer(window, `!document.querySelector('${modal}') && document.activeElement?.matches('[data-contact-memory-new]')`)
  await click('[data-contact-memory-new]')
  await waitForRenderer(window, `Boolean(document.querySelector('${modal}'))`)
  await fill('用户偏好：请用简洁的中文回答。')
  const directory = join(app.getPath('userData'), 'contact-agents')
  const store = new AgentStore(join(directory, 'agents.db'))
  try {
    store.db.exec("CREATE TRIGGER memory_smoke_failure BEFORE INSERT ON memories BEGIN SELECT RAISE(ABORT,'memory write failure fixture'); END")
    await click('[data-contact-memory-save]')
    await waitForRenderer(window, `document.querySelector('${modal} [role=alert]')?.textContent.includes('memory write failure fixture')`)
    if (await run("document.querySelector('[data-contact-memory-input]').value") !== '用户偏好：请用简洁的中文回答。') throw new Error('Failed memory input was lost')
    if (store.memories(characterId).length !== before.memories.length) throw new Error('Failed memory save persisted')

    const artifacts = process.env.CHOUYU_SMOKE_ARTIFACTS
    if (artifacts) {
      mkdirSync(artifacts, { recursive: true })
      const originalTheme = await run('document.documentElement.dataset.theme')
      for (const theme of ['light', 'dark']) for (const width of [375, 1024]) {
        await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewSize: { width, height: 768 }, deviceScaleFactor: 1, scale: 1, viewPosition: { x: 0, y: 0 } })
        await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        if (!await run(`(() => { const el=document.querySelector('${modal}'), r=el.getBoundingClientRect(); const input=el.querySelector('textarea'); input.blur(); const border=getComputedStyle(input).borderColor; input.focus(); const s=getComputedStyle(input); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && s.outlineStyle==='none' && s.boxShadow==='none' && s.borderColor===border; })()`)) throw new Error('Memory modal overflows or restores form focus decoration')
        writeFileSync(join(artifacts, `memory-dialog-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
      }
      window.webContents.disableDeviceEmulation()
      await run(`document.documentElement.dataset.theme=${JSON.stringify(originalTheme || 'light')}`)
    }
  } finally { store.db.exec('DROP TRIGGER IF EXISTS memory_smoke_failure'); store.close() }
  await click('[data-contact-memory-save]')
  await waitForRenderer(window, `!document.querySelector('${modal}') && document.querySelector('.agent-memories')?.textContent.includes('用户偏好：请用简洁的中文回答。')`)
  const saved = new AgentStore(join(directory, 'agents.db'))
  try {
    const memories = saved.memories(characterId).filter(m => m.content === '用户偏好：请用简洁的中文回答。')
    if (memories.length !== 1) throw new Error('Memory retry did not save exactly once')
    saved.forget(characterId, memories[0].id)
  } finally { saved.close() }
  await click('[data-agent-tab=profile]')
  console.log('CHOUYU_CONTACT_MEMORY_SMOKE_PASSED modal, Escape/focus, failure draft, retry and persisted memory')
}
