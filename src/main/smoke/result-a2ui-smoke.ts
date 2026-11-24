import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { waitForRenderer } from './storage-smoke'

/** Exercises the installed A2UI SDK in the real task reader, using saved fixture content. */
export async function runResultA2uiSmoke(window: BrowserWindow, directory: string): Promise<void> {
  const js = (code: string) => window.webContents.executeJavaScript(code)
  const theme = await js('document.documentElement.dataset.theme')
  const css = await window.webContents.insertCSS('.chat-panel,.contact-work-sheet{left:8px!important;top:8px!important;transform:none!important;width:calc(100vw - 16px)!important;height:calc(100vh - 16px)!important;min-width:0!important}')
  try {
    await js("[...document.querySelectorAll('[data-result-design-view] button')].find(b=>b.textContent==='阅读展示').click()")
    await waitForRenderer(window, "!!document.querySelector('[data-result-a2ui] [data-reading-section]')")
    assert.equal(await js("document.querySelector('[data-result-design-view] iframe')"), null)
    assert.ok(await js("document.querySelector('[data-result-a2ui]').textContent.includes('第36段')"), '完整末尾正文必须出现')
    assert.equal(await js("document.querySelector('[data-result-a2ui] nav')"), null, '单节成果直接进入正文，不重复目录')
    for (const width of [1024, 375]) for (const mode of ['light', 'dark']) {
      window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewSize: { width, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, scale: 1 })
      await waitForRenderer(window, `innerWidth === ${width}`)
      await js(`document.documentElement.dataset.theme=${JSON.stringify(mode)};document.querySelector('[data-result-design-view]').scrollIntoView({block:'start'})`)
      await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      const geometry = await js("(()=>{const r=document.querySelector('[data-result-a2ui]'),box=r.getBoundingClientRect();return {scroll:r.scrollWidth,width:r.clientWidth,text:r.textContent,left:box.left,right:box.right}})()")
      assert.ok(geometry.scroll <= geometry.width + 1, `分节阅读 ${width}/${mode} 横向溢出`)
      assert.ok(geometry.left>=0&&geometry.right<=width+1,`成果正文必须实际处于 ${width}px 视口内`)
      assert.ok(geometry.text.includes('真实工作进程'))
      writeFileSync(join(directory, `a2ui-${width}-${mode}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 768 }, { stayHidden: true, stayAwake: true })).toPNG())
      await js("document.querySelector('[data-result-a2ui] [data-reading-section]').scrollIntoView({block:'start'})")
      await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      writeFileSync(join(directory, `a2ui-body-${width}-${mode}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 768 }, { stayHidden: true, stayAwake: true })).toPNG())
    }
    await js("[...document.querySelectorAll('[data-result-design-view] button')].find(b=>b.textContent==='原文').click()")
    await waitForRenderer(window, "!document.querySelector('[data-result-a2ui]')")
    assert.ok(await js("document.querySelector('.delivery-reader').textContent.includes('第36段')"))
    await js("[...document.querySelectorAll('[data-result-design-view] button')].find(b=>b.textContent==='阅读展示').click()")
    await waitForRenderer(window, "!!document.querySelector('[data-result-a2ui] [data-reading-section]')")
    await js("[...document.querySelectorAll('[data-result-design-view] button')].find(b=>b.textContent==='成果界面').click()")
    await waitForRenderer(window, "!!document.querySelector('[data-result-design-view] iframe')&&!document.querySelector('[data-result-a2ui]')")
  } catch (error) {
    writeFileSync(join(directory, 'a2ui-failure.txt'), await js("document.querySelector('[data-result-design-view]')?.outerHTML || 'Missing result reader'"))
    writeFileSync(join(directory, 'a2ui-failure.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
    throw error
  } finally {
    window.webContents.disableDeviceEmulation()
    await js(`document.documentElement.dataset.theme=${JSON.stringify(theme || 'light')}`)
    await window.webContents.removeInsertedCSS(css)
  }
}
