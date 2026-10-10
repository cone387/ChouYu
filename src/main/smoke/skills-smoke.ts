import { app, ipcMain, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { contactSkillLibrary } from '../skills'
import { waitForRenderer } from './storage-smoke'
import type { SkillCatalogQuery } from '../../shared/skills'

/** Isolated library, actual preload/IPC and React controls; no remote dependencies. */
export async function runSkillsSmoke(window: BrowserWindow, characterId: string) {
  const root = join(app.getPath('userData'), 'skill-fixture')
  mkdirSync(join(root, 'references'), { recursive: true })
  writeFileSync(join(root, 'SKILL.md'), '---\nname: 评审方法\ndescription: 先给结论，再用可核实的依据解释。\nversion: 1.0\n---\n技能验收标记：保持独立判断。')
  writeFileSync(join(root, 'references', 'criteria.md'), '技能参考标记：标明仍待核实的判断。')
  mkdirSync(join(root, 'scripts')); writeFileSync(join(root, 'scripts', 'review.js'), 'console.log("optional review script")')
  const library = contactSkillLibrary()
  library.publish('smoke-review', root)
  // Deterministic official-directory fixture, real renderer/preload/IPC interaction.
  const requests: SkillCatalogQuery[] = []
  let failCatalog = false
  let runtimeReady = false
  ipcMain.removeHandler('skills:runtime-status')
  ipcMain.handle('skills:runtime-status', () => ({ ready: runtimeReady, engineReady: runtimeReady, message: runtimeReady ? '隔离环境验收：已就绪' : '隔离环境验收：Docker 未启动' }))
  let finishSetup: (() => void) | undefined, installCalls = 0
  ipcMain.removeHandler('skills:setup'); ipcMain.removeHandler('skills:install')
  ipcMain.handle('skills:setup', () => new Promise(resolve => { finishSetup = () => resolve({ ready: true, version: 'fixture' }) }))
  ipcMain.handle('skills:install', () => { installCalls++; throw new Error('Unexpected fixture install') })
  ipcMain.removeHandler('skills:browse'); ipcMain.removeHandler('skills:categories')
  ipcMain.handle('skills:categories', () => [{ key: 'writing', name: '内容创作' }])
  ipcMain.handle('skills:browse', (_event, query: SkillCatalogQuery) => {
    requests.push(query)
    if (failCatalog) throw new Error('目录验收：服务暂不可用')
    return { total: 48, skills: Array.from({ length: 6 }, (_, index) => ({ id: `@fixture/skill-${query.page}-${index}`, name: ['写作与表达', '研究资料整理', '代码评审', '会议纪要', '阅读助手', '创意构思'][index], description: '根据目标整理思路，检查关键信息，让每次交付都有清晰的结论和依据。', category: 'writing', source: 'community', downloads: 12500 + index * 200, stars: 82 + index, iconUrl: index === 0 ? 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="8" fill="%23438cd8"/></svg>'.replace('%23', '#')) : index === 1 ? 'data:image/png;base64,broken' : undefined })) }
  })
  const js = (code: string) => window.webContents.executeJavaScript(code)
  const click = (selector: string) => js(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el || el.disabled) throw new Error('Skill control unavailable: '+${JSON.stringify(selector)}); el.click() })()`)
  const checkPointerRouting = async (selector: string) => {
    await js("window.__skillMouseIgnored=null;window.__stopSkillMouse=window.electronAPI.onMouseEventsState(value=>{window.__skillMouseIgnored=value});window.electronAPI.setIgnoreMouseEvents(false);window.electronAPI.setIgnoreMouseEvents(true)")
    await waitForRenderer(window, 'window.__skillMouseIgnored === true')
    try {
      const hit = await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);if(!document.elementFromPoint(x,y)?.closest('[data-interactive]'))throw new Error('Skill dialog is not interactive');return {x,y}})()`)
      window.webContents.send('cursor-position', hit)
      await waitForRenderer(window, 'window.__skillMouseIgnored === false')
      window.webContents.send('cursor-position', { x: 3, y: 3 })
      await waitForRenderer(window, 'window.__skillMouseIgnored === true')
      window.webContents.send('cursor-position', hit)
      await waitForRenderer(window, 'window.__skillMouseIgnored === false')
    } finally { await js('window.__stopSkillMouse();delete window.__stopSkillMouse') }
  }
  const nativeClick = async (selector: string) => {
    await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'});new Promise(resolve=>requestAnimationFrame(resolve))`)
    const point = await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    window.webContents.send('cursor-position', point)
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  await click('[data-agent-tab=skills]')
  await waitForRenderer(window, "Boolean(document.querySelector('[data-catalog-skill]'))")
  await waitForRenderer(window, "document.querySelector('[data-catalog-skill] img')?.naturalWidth > 0")
  await waitForRenderer(window, "!document.querySelector('[data-catalog-skill=\"@fixture/skill-1-1\"] img') && document.querySelector('[data-catalog-skill=\"@fixture/skill-1-1\"] .skill-catalog-icon')?.textContent.trim().length > 0")
  if (requests[0]?.keyword || requests[0]?.sortBy !== 'score') throw new Error('Catalog did not auto-load score order without search')
  await click('[data-skill-sort=downloads]')
  await waitForRenderer(window, "Boolean(document.querySelector('[data-catalog-skill]'))")
  if (requests.at(-1)?.sortBy !== 'downloads') throw new Error('Catalog sort was not requested')
  await click('[data-skill-page=next]')
  await waitForRenderer(window, "Boolean(document.querySelector('[data-catalog-skill=\"@fixture/skill-2-0\"]'))")
  failCatalog = true
  await click('[data-skill-sort=score]')
  await waitForRenderer(window, "document.querySelector('[data-skill-catalog] [role=alert]')?.textContent.includes('服务暂不可用')")
  failCatalog = false
  await click('[data-skill-retry]')
  await waitForRenderer(window, "Boolean(document.querySelector('[data-catalog-skill=\"@fixture/skill-1-0\"]'))")
  await click('[data-skill-preview]')
  await waitForRenderer(window, "Boolean(document.querySelector('[data-skill-dialog]'))")
  await click('[data-skill-confirm]')
  await waitForRenderer(window, "document.querySelector('[data-skill-dialog] footer button')?.textContent === '取消操作'")
  if (!finishSetup) throw new Error('Setup did not start')
  await click('[data-skill-dialog] footer button')
  finishSetup()
  await waitForRenderer(window, "document.querySelector('[data-skill-dialog] [role=alert]')?.textContent.includes('取消')")
  if (installCalls) throw new Error('Cancelled setup still started skill installation')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await waitForRenderer(window, "!document.querySelector('[data-skill-dialog]')")
  await click('[data-skill-library]')
  await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-skills] [data-skill-toggle]'))")
  await click('[data-skill-toggle]')
  await waitForRenderer(window, "document.querySelector('[data-skill-toggle]')?.textContent === '停用'")
  if (!library.snapshot(characterId).instruction.includes('技能参考标记')) throw new Error('Skill reference was not saved for owner')
  if (library.snapshot('chouyu').entries.length) throw new Error('Skill leaked to another contact')
  await click('[data-skill-runtime]')
  await waitForRenderer(window, "document.querySelector('[data-skill-runtime-dialog]')?.textContent.includes('Docker 未启动')")
  await checkPointerRouting('[data-skill-runtime-dialog] footer button')
  if (!await js("document.querySelector('[data-skill-scripts]').disabled")) throw new Error('Unavailable runtime allowed enabling scripts')
  if (!await js("document.querySelector('[data-skill-runtime-dialog]').textContent.includes('scripts/review.js')")) throw new Error('Optional script was not listed')
  runtimeReady = true
  await js("Array.from(document.querySelectorAll('[data-skill-runtime-dialog] button')).find(button=>button.textContent==='刷新记录').click()")
  await waitForRenderer(window, "!document.querySelector('[data-skill-scripts]')?.disabled")
  await click('[data-skill-scripts]')
  await waitForRenderer(window, "document.querySelector('[data-skill-scripts]')?.textContent==='停用脚本' && !document.querySelector('[data-skill-scripts]').disabled")
  if (!library.snapshot(characterId).entries[0]?.scriptsEnabled) throw new Error('Script permission did not persist')
  if (process.env.CHOUYU_SMOKE_ARTIFACTS) {
    mkdirSync(process.env.CHOUYU_SMOKE_ARTIFACTS, { recursive: true })
    await waitForRenderer(window, "document.querySelector('[data-skill-runtime-dialog] footer button')?.textContent==='关闭'")
    const previousTheme = await js('document.documentElement.dataset.theme')
    for (const width of [375, 560]) for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme='${theme}';document.querySelector('[data-skill-runtime-dialog]').style.width='${width}px';new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      if (!await js("(()=>{const el=document.querySelector('.skill-runtime-details');return el.scrollWidth<=el.clientWidth+1})()")) throw new Error('Skill capability dialog has horizontal overflow')
      writeFileSync(join(process.env.CHOUYU_SMOKE_ARTIFACTS, `skill-runtime-${width}-${theme}.png`), (await window.webContents.capturePage()).toPNG())
    }
    await js(`document.documentElement.dataset.theme=${JSON.stringify(previousTheme)};document.querySelector('[data-skill-runtime-dialog]').style.width=''`)
  }
  await click('[data-skill-scripts]')
  await waitForRenderer(window, "document.querySelector('[data-skill-scripts]')?.textContent==='允许隔离运行脚本'")
  if (library.snapshot(characterId).entries[0]?.scriptsEnabled) throw new Error('Script permission was not revoked')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await waitForRenderer(window, "!document.querySelector('[data-skill-runtime-dialog]') && Boolean(document.querySelector('[data-contact-skills]'))")
  await click('[data-skill-runtime]')
  await waitForRenderer(window, "Boolean(document.querySelector('[data-skill-runtime-dialog][open]'))")
  await nativeClick('[data-skill-runtime-dialog] footer button')
  await waitForRenderer(window, "!document.querySelector('[data-skill-runtime-dialog]') && Boolean(document.querySelector('[data-contact-skills]'))")
  await click('[data-skill-id] .skill-actions button')
  await waitForRenderer(window, "document.querySelector('[data-skill-dialog] pre')?.textContent.includes('技能验收标记')")
  await checkPointerRouting('[data-skill-dialog] footer button')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  try { await waitForRenderer(window, "!document.querySelector('[data-skill-dialog]') && Boolean(document.querySelector('[data-contact-skills]'))") }
  catch (error) {
    console.error('SKILL_ESCAPE_DIAGNOSTIC', await js("JSON.stringify({dialogs:Array.from(document.querySelectorAll('dialog')).map(el=>({class:el.className,open:el.open})),detail:!!document.querySelector('[data-contacts-detail]'),skills:!!document.querySelector('[data-contact-skills]'),focus:document.activeElement?.outerHTML.slice(0,200)})"))
    throw error
  }
  // The expanded presentation must share the same skill page and title.
  const secondary = join(app.getPath('userData'), 'skill-secondary-fixture')
  mkdirSync(secondary, { recursive: true })
  writeFileSync(join(secondary, 'SKILL.md'), '---\nname: 写作与表达\ndescription: 梳理文章结构，保留作者的语气，让想法清楚地传达。\nversion: 1.0\n---\n直接交付正文。')
  library.publish('smoke-writing', secondary)
  await click('[data-agent-expand]')
  await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet[open][data-view=skills] [data-contact-skills]'))")
  await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet [data-catalog-skill]'))")
  const artifacts = process.env.CHOUYU_SMOKE_ARTIFACTS
  if (artifacts) {
    mkdirSync(artifacts, { recursive: true })
    const oldTheme = await js('document.documentElement.dataset.theme'), oldStyle = await js("document.querySelector('.contact-work-sheet').getAttribute('style')")
    await js("(() => { const style=document.createElement('style'); style.id='skill-layout-fixture'; document.head.appendChild(style) })()")
    for (const width of [375, 1024]) for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme='${theme}'; document.querySelector('#skill-layout-fixture').textContent='.contact-work-sheet[data-view="skills"] { width: ${width}px !important; }'; new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      const actualWidth = await js("document.querySelector('.contact-work-sheet').getBoundingClientRect().width")
      if (Math.abs(actualWidth - width) > 2) throw new Error(`Expected skill window width ${width}, got ${actualWidth}`)
      const fits = await js("(() => { const el=document.querySelector('.contact-work-sheet [data-contact-skills]'); return el.scrollWidth <= el.clientWidth+2 })()")
      if (!fits) throw new Error(`Skill page overflows at ${width}/${theme}`)
      writeFileSync(join(artifacts, `contact-skills-${width}-${theme}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
      await click('.contact-work-sheet [data-skill-layout=grid]')
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      writeFileSync(join(artifacts, `contact-skills-grid-${width}-${theme}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
      await click('.contact-work-sheet [data-skill-layout=list]')
      await click('.contact-work-sheet [data-skill-library]')
      await js("document.querySelector('.contact-work-sheet .skill-list').scrollIntoView({block:'nearest'})")
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      if (!await js("(()=>{const el=document.querySelector('.contact-work-sheet .skill-list');return el.scrollWidth<=el.clientWidth+1})()")) throw new Error('Installed skill cards overflow')
      writeFileSync(join(artifacts, `contact-skills-library-${width}-${theme}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
      await click('.contact-work-sheet [data-skill-market]')
    }
    await js(`document.querySelector('#skill-layout-fixture').remove(); document.documentElement.dataset.theme=${JSON.stringify(oldTheme)}; document.querySelector('.contact-work-sheet').setAttribute('style',${JSON.stringify(oldStyle || '')})`)
  }
  await click('.contact-work-sheet [data-skill-library]')
  await nativeClick('.contact-work-sheet [data-skill-id="smoke-review"] summary')
  await waitForRenderer(window, "Boolean(document.querySelector('.contact-work-sheet [data-skill-id=\"smoke-review\"] details[open]'))")
  await nativeClick('.contact-work-sheet [data-skill-remove]')
  await waitForRenderer(window, "document.querySelector('.contact-work-sheet [data-skill-id=\"smoke-review\"] .skill-card-status')?.textContent.includes('未配置')")
  await nativeClick('.contact-work-sheet [data-skill-id="smoke-review"] [data-skill-toggle]')
  await waitForRenderer(window, "document.querySelector('.contact-work-sheet [data-skill-id=\"smoke-review\"] [data-skill-toggle]')?.textContent === '停用'")
  await click('.contact-work-sheet-heading > button')
  await waitForRenderer(window, "!document.querySelector('.contact-work-sheet[open]')")
  // Parent view was mounted before the expanded view; verify stale-write failure is recoverable.
  library.configure(characterId, 'smoke-review', 'disable', library.list(characterId).revision)
  await click('[data-skill-toggle]')
  await waitForRenderer(window, "document.querySelector('[data-contact-skills] [role=alert]')?.textContent.includes('已变化')")
  await click('[data-contact-skills] .skill-heading > button')
  await waitForRenderer(window, "document.querySelector('[data-skill-toggle]')?.textContent.includes('启用') && !document.querySelector('[data-contact-skills] [role=alert]')")
  await click('[data-skill-toggle]')
  await waitForRenderer(window, "document.querySelector('[data-skill-toggle]')?.textContent === '停用'")
  console.log('CHOUYU_SKILLS_SMOKE_PASSED catalog auto-load, sort, pagination, failure/retry, preview, owner isolation, references, enable, stale write, dialog pointer routing/native close/Escape, card more/remove/enable, expanded navigation, theme/layout')
}
