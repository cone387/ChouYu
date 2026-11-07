import { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCharacter } from '../database'
import { waitForRenderer } from './storage-smoke'

/** Real renderer, themed top-layer picker, keyboard dismissal and persisted selection. */
export async function runContactCardUiSmoke(window: BrowserWindow, characterId: string): Promise<void> {
  const js = (source: string): Promise<any> => window.webContents.executeJavaScript(source)
  const click = (selector: string): Promise<any> => js(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const key = (keyCode: string): void => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode })
  }
  const artifacts = process.env.CHOUYU_SMOKE_ARTIFACTS
  // Exercise a viewport-sized workspace instead of the desktop pet's saved panel position.
  const workspaceCss = await window.webContents.insertCSS('.chat-panel{left:8px!important;top:8px!important;transform:none!important;width:calc(100vw - 16px)!important;height:calc(100vh - 16px)!important;min-width:0!important}')
  const capture = async (name: string): Promise<void> => {
    if (!artifacts) return
    mkdirSync(artifacts, { recursive: true })
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await new Promise(resolve => setTimeout(resolve, 350))
    const viewport = await js('({x:0,y:0,width:innerWidth,height:innerHeight})')
    await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
    writeFileSync(join(artifacts, `${name}.png`), (await window.webContents.capturePage(viewport, { stayHidden: true, stayAwake: true })).toPNG())
  }
  const openPicker = async (): Promise<void> => {
    const point = await js(`(() => {
      const el = document.querySelector('[data-contacts-model-options]');
      el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect();
      return {x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2)};
    })()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    await waitForRenderer(window, "document.querySelector('[data-contacts-model-options]').matches(':open')")
  }
  if (await js(`document.querySelector('[data-contacts-item="${characterId}"]').textContent.includes('冒烟猫人设')`)) {
    throw new Error('Contact card exposes persona prompt')
  }
  await click(`[data-contacts-card-detail="${characterId}"]`)
  await waitForRenderer(window, "Boolean(document.querySelector('.contacts-detail-fields'))")
  if (!await js(`(() => { const el = document.querySelector('.contacts-detail-fields');
    return el.checkVisibility() && !el.closest('details') && el.querySelectorAll('dt').length === 5;
  })()`)) throw new Error('Contact metadata must be expanded without a disclosure card')
  await capture('contact-metadata-expanded')
  await click(`[data-contacts-edit="${characterId}"]`)
  await click('[data-contacts-fetch-models]')
  await waitForRenderer(window, "document.querySelector('[data-contacts-model-options]')?.options.length === 25")
  for (const width of [1024, 375]) {
    window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewSize: { width, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, scale: 1 })
    await waitForRenderer(window, `innerWidth === ${width} && document.querySelector('.contacts-form').getBoundingClientRect().right <= innerWidth`)
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme = '${theme}'`)
      await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      await openPicker()
      await capture(`contact-model-picker-${width}-${theme}`)
      if (!await js(`(() => { const el = document.querySelector('[data-contacts-model-options]');
        const form = document.querySelector('.contacts-form');
        const style = getComputedStyle(el, '::picker(select)');
        const option = el.options[1], r = option.getBoundingClientRect();
        return style.appearance === 'base-select' && form.scrollWidth <= form.clientWidth + 1
          && r.x >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
          && document.elementFromPoint(r.x+r.width/2, r.y+r.height/2) === option;
      })()`)) {
        const geometry = await js(`(() => { const el=document.querySelector('[data-contacts-model-options]'); const r=el.options[1].getBoundingClientRect(); const form=document.querySelector('.contacts-form'); return {option:r.toJSON(), form:form.getBoundingClientRect().toJSON(), scroll:form.scrollWidth, client:form.clientWidth, innerWidth, hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML, appearance:getComputedStyle(el,'::picker(select)').appearance}; })()`)
        throw new Error(`Model picker is clipped or obscured at ${width}/${theme}: ${JSON.stringify(geometry)}`)
      }
      key('Escape')
      await waitForRenderer(window, "!!document.querySelector('[data-contacts-form]') && !document.querySelector('[data-contacts-model-options]').matches(':open')")
      // Hidden windows don't acquire OS focus. Force the real CSS pseudo state
      // through DevTools to check the cascade, independently of keyboard routing.
      window.webContents.debugger.attach('1.3')
      try {
        await window.webContents.debugger.sendCommand('DOM.enable')
        await window.webContents.debugger.sendCommand('CSS.enable')
        const { root } = await window.webContents.debugger.sendCommand('DOM.getDocument')
        const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-contacts-model-options]' })
        await window.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus', 'focus-visible'] })
        await new Promise(resolve => setTimeout(resolve, 200))
        const focusStyle = await js(`(() => { const el=document.querySelector('[data-contacts-model-options]'); const style=getComputedStyle(el);
          const probe=document.createElement('span'); probe.style.border='1px solid var(--input-border)'; el.parentElement.append(probe);
          const border=getComputedStyle(probe).borderColor; probe.remove();
          return { outline:style.outlineStyle, shadow:style.boxShadow, actualBorder:style.borderColor, expectedBorder:border };
        })()`)
        if (focusStyle.outline !== 'none' || focusStyle.shadow !== 'none' || focusStyle.actualBorder !== focusStyle.expectedBorder) throw new Error(`Model selector has a decorated keyboard focus at ${width}/${theme}: ${JSON.stringify(focusStyle)}`)
        await window.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })
      } finally { window.webContents.debugger.detach() }
    }
  }
  await openPicker()
  key('ArrowDown')
  key('Enter')
  await waitForRenderer(window, "document.querySelector('[data-contacts-model]').value.startsWith('contact-model-')")
  const selected = await js("document.querySelector('[data-contacts-model]').value")
  await click('[data-contacts-save]')
  await waitForRenderer(window, "!document.querySelector('[data-contacts-form]')")
  if (getCharacter(characterId)?.model !== selected) throw new Error('Selected model was not persisted')
  window.webContents.disableDeviceEmulation()
  await click(`[data-contacts-menu="${characterId}"]`)
  await click(`[data-contacts-menu-edit="${characterId}"]`)
  await click('[data-contacts-model-default]')
  await click('[data-contacts-save]')
  await waitForRenderer(window, "!document.querySelector('[data-contacts-form]')")
  if (getCharacter(characterId)?.model !== '') throw new Error('Follow default model was not persisted')
  await window.webContents.removeInsertedCSS(workspaceCss)
  await js("document.documentElement.dataset.theme = 'light'")
  console.log('CHOUYU_CONTACT_CARD_UI_SMOKE_PASSED expanded metadata, hidden prompt, themed unclipped picker at 375/1024, Escape, model selection and default persistence')
}
