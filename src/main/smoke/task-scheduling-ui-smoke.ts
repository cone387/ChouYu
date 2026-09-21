import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { waitForRenderer } from './storage-smoke'

export async function runTaskSchedulingUISmoke(window: BrowserWindow): Promise<void> {
  const run = (source: string) => window.webContents.executeJavaScript(source)
  const click = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const fill = (selector: string, value: string) => run(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  if (!await run("!!document.querySelector('.chat-panel')")) {
    window.webContents.send('open-chat-panel')
    await waitForRenderer(window, "!!document.querySelector('.chat-panel')")
  }
  if (!await run("!!document.querySelector('[data-workspace-nav=tasks]')")) {
    await click('[aria-label="窗口模式"]'); await click('[data-workspace-mode-option=workspace]')
  }
  await click('[data-workspace-nav=tasks]')
  await waitForRenderer(window, "!!document.querySelector('.tasks-view')")
  const restoreWindow = Boolean(process.env.CHOUYU_TASK_GROUP_ARTIFACTS) && await run("!!document.querySelector('[aria-label=最大化窗口]')")
  if (restoreWindow) {
    await click('[aria-label="最大化窗口"]')
    await waitForRenderer(window, "document.querySelector('.chat-panel')?.dataset.maximized==='true'")
  }
  const id: string = await run(`window.electronAPI.tasks.create({title:'重复提醒界面验收',dueAt:new Date(2030,0,31,9).getTime(),reminderTimes:[new Date(2030,0,31,8,43).getTime()]}).then(t=>t.id)`)
  await run(`window.dispatchEvent(new CustomEvent('chouyu:task-navigation',{detail:{taskId:${JSON.stringify(id)}}}))`)
  await waitForRenderer(window, `document.querySelector('[aria-label="任务标题"]')?.value==='重复提醒界面验收'`)
  await click('.tasks-composer-dates > summary')
  await waitForRenderer(window, `!!document.querySelector('.tasks-date-popover:popover-open')`)
  await fill('[aria-label="添加提醒"]', '3600000')
  await fill('[aria-label="任务重复规则"]', 'custom')
  await fill('[aria-label="重复频率"]', 'monthly')
  await fill('[aria-label="每月重复日期"]', '10,11,-1')
  await fill('[aria-label="重复结束方式"]', 'count')
  await fill('[aria-label="重复总次数"]', '3')
  await waitForRenderer(window, `document.querySelector('.tasks-repeat-preview')?.textContent.includes('共 3 次') && document.querySelectorAll('.tasks-reminder-list li').length===2`)
  const sizes = await run(`(() => { const popup=document.querySelector('.tasks-date-popover'), r=popup.getBoundingClientRect(); return { overflow:popup.scrollWidth>popup.clientWidth+1, top:r.top,bottom:r.bottom,height:innerHeight }; })()`)
  if (sizes.overflow || sizes.top < 0 || sizes.bottom > sizes.height) throw new Error(`Repeat settings outside viewport: ${JSON.stringify(sizes)}`)
  const artifacts = process.env.CHOUYU_TASK_GROUP_ARTIFACTS
  if (artifacts) {
    mkdirSync(artifacts, { recursive: true })
    const theme = await run('document.documentElement.dataset.theme')
    try {
      for (const mode of ['light', 'dark']) for (const width of [1100, 375]) {
        await run(`document.documentElement.dataset.theme=${JSON.stringify(mode)}`)
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 800 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 800 }, scale: 1 })
        await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
        if (!await run("document.querySelector('.tasks-composer-dates').open")) await click('.tasks-composer-dates > summary')
        await run(`document.querySelector('.tasks-repeat-custom').scrollIntoView({block:'nearest'})`)
        await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
        const fits = await run(`(() => { const p=document.querySelector('.tasks-date-popover'); const r=p.getBoundingClientRect(); return p.matches(':popover-open') && p.scrollWidth<=p.clientWidth+1 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight })()`)
        if (!fits) {
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
          writeFileSync(join(artifacts, `tasks-repeat-failed-${mode}-${width}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
          const detail = await run(`(() => {const p=document.querySelector('.tasks-date-popover');return {rect:p.getBoundingClientRect().toJSON(),scroll:p.scrollWidth,client:p.clientWidth,viewport:[innerWidth,innerHeight],open:p.matches(':popover-open'),wide:Array.from(p.querySelectorAll('*')).filter(e=>e.getBoundingClientRect().width>p.clientWidth).map(e=>[e.tagName,e.className,e.getBoundingClientRect().width])}})()`)
          throw new Error(`Schedule panel overflows ${mode}/${width}: ${JSON.stringify(detail)}`)
        }
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        writeFileSync(join(artifacts, `tasks-repeat-${mode}-${width}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
      }
    } finally {
      window.webContents.disableDeviceEmulation()
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
      await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
    }
    if (!await run("document.querySelector('.tasks-composer-dates').open")) await click('.tasks-composer-dates > summary')
  }
  await click('.tasks-calendar-footer button:last-child')
  await click('.tasks-composer button[type=submit]')
  await waitForRenderer(window, `!document.querySelector('.tasks-composer')`)
  const saved = await run(`window.electronAPI.tasks.get(${JSON.stringify(id)})`)
  if (saved.reminders.length !== 2 || saved.repeatRule.count !== 3 || saved.repeatRule.monthDays.join(',') !== '-1,10,11') throw new Error('Repeat/reminder editor did not persist all choices')
  await run(`window.dispatchEvent(new CustomEvent('chouyu:task-navigation',{detail:{taskId:${JSON.stringify(id)}}}))`)
  await waitForRenderer(window, `document.querySelector('[aria-label="任务标题"]')?.value==='重复提醒界面验收'`)
  await fill('[aria-label="任务标题"]', '只改标题仍保留提醒')
  await click('.tasks-composer button[type=submit]')
  await waitForRenderer(window, `!document.querySelector('.tasks-composer')`)
  const edited = await run(`window.electronAPI.tasks.get(${JSON.stringify(id)})`)
  if (JSON.stringify(saved.reminders) !== JSON.stringify(edited.reminders) || JSON.stringify(saved.repeatRule) !== JSON.stringify(edited.repeatRule)) throw new Error('Title edit changed scheduling')
  await run(`window.electronAPI.tasks.remove(${JSON.stringify(id)})`)
  if (restoreWindow) await click('[aria-label="还原窗口"]')
  console.log('CHOUYU_TASK_SCHEDULING_UI_SMOKE_PASSED')
}
