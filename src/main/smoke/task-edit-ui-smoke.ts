import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { waitForRenderer } from './storage-smoke'

export async function runTaskEditUISmoke(window: BrowserWindow): Promise<void> {
  const run = (source: string) => window.webContents.executeJavaScript(source)
  const click = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const fill = (selector: string, value: string) => run(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  const wait = (condition: string) => waitForRenderer(window, condition)
  const assert = async (condition: string) => { if (!await run(condition)) throw new Error(`Task edit assertion: ${condition}`) }
  window.webContents.send('open-chat-panel')
  await wait("!!document.querySelector('.chat-panel')")
  if (!await run("!!document.querySelector('[data-workspace-nav=tasks]')")) {
    await click('[aria-label="窗口模式"]'); await click('[data-workspace-mode-option=workspace]')
  }
  await click('[data-workspace-nav=tasks]')
  await wait("!!document.querySelector('.tasks-create')")
  const task = await run(`window.electronAPI.tasks.create({title:'编辑体验验收',note:'保留备注',priority:'medium',dueAt:new Date(2030,0,31,9).getTime(),recurrence:'monthly',reminderTimes:[new Date(2030,0,31,8).getTime()],checklist:[{id:'step',title:'保留子项',done:false}]})`)
  const openEditor = async () => {
    await run(`window.dispatchEvent(new CustomEvent('chouyu:task-navigation',{detail:{taskId:${JSON.stringify(task.id)}}}))`)
    await wait("document.querySelector('[aria-label=任务标题]')?.value==='编辑体验验收'")
  }
  await openEditor()
  // A pristine editor closes directly; edited content survives cancelled discard.
  await click('[aria-label="关闭任务弹窗"]')
  await wait("!document.querySelector('.tasks-composer')")
  await openEditor()
  await fill('[aria-label="任务标题"]', '尚未保存')
  await run("document.querySelector('[aria-label=任务标题]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))")
  await wait("!!document.querySelector('.app-confirm-dialog[open]')")
  await click('.app-confirm-dialog button:first-child')
  await assert("document.querySelector('[aria-label=任务标题]').value==='尚未保存'")
  await click('[aria-label="关闭任务弹窗"]')
  await wait("!!document.querySelector('.app-confirm-dialog[open]')")
  await click('.app-confirm-dialog .app-button-danger')
  await wait("!document.querySelector('.tasks-composer')")
  await assert(`window.electronAPI.tasks.get('${task.id}').then(t=>t.title==='编辑体验验收')`)
  await click('[data-view-selection=all]')
  await click('.tasks-tabs button:first-child')
  const card = `[data-task-id="${task.id}"]`
  await wait(`!!document.querySelector('${card} .task-card-priority')`)
  await click(`${card} .task-card-checklist-toggle`)
  await wait(`!!document.querySelector('${card} .task-card-checklist-row input')`)
  await assert("!document.querySelector('.tasks-composer')")
  await click(`${card} .task-card-checklist-row`)
  await wait(`document.querySelector('${card} .task-card-checklist-row input')?.checked===true`)
  await assert(`window.electronAPI.tasks.get('${task.id}').then(t=>t.status==='open'&&t.checklist[0].done&&t.note==='保留备注'&&t.reminders[0].at===${task.reminders[0].at})`)
  await assert(`document.querySelector('${card} .task-card-checklist-toggle').getAttribute('aria-expanded')==='true'`)
  await click(`${card} .task-card-checklist-toggle`)
  await assert(`!document.querySelector('${card} .task-card-checklist-row')`)
  await click(`${card} .task-card-priority`)
  await wait("!!document.querySelector('.tasks-field-editor[open]')")
  await assert("!document.querySelector('.tasks-composer')")
  await fill('[aria-label="卡片优先级"]', 'high')
  await click('.tasks-field-editor button[type=submit]')
  await wait("!document.querySelector('.tasks-field-editor')")
  await assert(`window.electronAPI.tasks.get('${task.id}').then(t=>t.priority==='high'&&t.note==='保留备注'&&t.checklist[0].title==='保留子项'&&t.reminders[0].at===${task.reminders[0].at})`)
  // Board uses the same field editor and preserves recurrence/reminder offsets.
  await click('.tasks-tabs button:nth-child(2)')
  await wait(`!!document.querySelector('.tasks-board-card${card} .task-card-due')`)
  await click(`${card} .task-card-checklist-toggle`)
  await wait(`!!document.querySelector('${card} .task-card-checklist-row input')`)
  await assert(`document.querySelector('${card} .task-card-checklist-row input').checked===true`)
  await run(`(() => { const input=document.querySelector('${card} .task-card-checklist-row input'); input.focus(); })()`)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
  await wait(`document.querySelector('${card} .task-card-checklist-row input')?.checked===false`)
  await assert("!document.querySelector('.tasks-composer')")
  // A rejected write keeps the checkbox unchanged and offers retry.
  await run(`(async () => { const t=await window.electronAPI.tasks.get('${task.id}'); await window.electronAPI.tasks.update(t.id,{checklist:[...t.checklist,{id:'failure',title:'失败重试',done:false}]}); })()`)
  await wait(`document.querySelectorAll('${card} .task-card-checklist-row').length===2`)
  await run(`(async () => { const t=await window.electronAPI.tasks.get('${task.id}'); const writing=window.electronAPI.tasks.update(t.id,{checklist:t.checklist.filter(i=>i.id!=='failure')}); document.querySelectorAll('${card} .task-card-checklist-row input')[1].click(); await writing; })()`)
  await wait(`document.querySelector('${card} .task-card-checklist [role=alert]')?.textContent.includes('保存失败')`)
  await click(`${card} .task-card-checklist-row input`)
  await wait(`document.querySelector('${card} .task-card-checklist-row input')?.checked===true`)
  await assert(`!document.querySelector('${card} .task-card-checklist [role=alert]')`)
  if (process.env.CHOUYU_TASK_GROUP_ARTIFACTS) {
    const directory = process.env.CHOUYU_TASK_GROUP_ARTIFACTS
    mkdirSync(directory, { recursive: true })
    for (const mode of ['list', 'board']) {
      await click(`.tasks-tabs button:nth-child(${mode === 'list' ? 1 : 2})`)
      await wait(`!!document.querySelector('${card} .task-card-checklist-toggle')`)
      if (!await run(`document.querySelector('${card} .task-card-checklist-toggle').getAttribute('aria-expanded')==='true'`)) await click(`${card} .task-card-checklist-toggle`)
      for (const theme of ['light', 'dark']) {
        await run(`document.documentElement.dataset.theme='${theme}'; document.querySelector('${card} .task-card-checklist').scrollIntoView({block:'center'})`)
        await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        writeFileSync(join(directory, `task-checklist-${mode}-${theme}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
      }
    }
  }
  await click(`.tasks-board-card${card} .task-card-due`)
  await fill('[aria-label="卡片截止时间"]', '2030-02-28T09:00')
  const directory = process.env.CHOUYU_TASK_GROUP_ARTIFACTS
  if (directory) {
    mkdirSync(directory, { recursive: true })
    for (const theme of ['light', 'dark']) {
      await run(`document.documentElement.dataset.theme='${theme}'`)
      await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      writeFileSync(join(directory, `task-field-${theme}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
    }
  }
  await click('.tasks-field-editor button[type=submit]')
  await wait("!document.querySelector('.tasks-field-editor')")
  await assert(`window.electronAPI.tasks.get('${task.id}').then(t=>t.dueAt===new Date(2030,1,28,9).getTime()&&t.reminders[0].at===t.dueAt-3600000&&t.recurrence==='monthly')`)
  // A storage/validation failure leaves the edited value available for retry.
  await click(`${card} .task-card-due`)
  await fill('[aria-label="卡片截止时间"]', '2030-03-28T09:00')
  await run(`window.electronAPI.tasks.update('${task.id}',{note:'外部更新'})`)
  await click('.tasks-field-editor button[type=submit]')
  await wait("document.querySelector('.tasks-field-editor [role=alert]')?.textContent.includes('任务已发生变化')")
  await assert("document.querySelector('[aria-label=卡片截止时间]').value==='2030-03-28T09:00'")
  await click('.tasks-field-editor .tasks-form-actions button:first-child')
  await run("Array.from(document.querySelectorAll('.tasks-field-editor button')).find(b=>b.textContent==='放弃修改').click()")
  await wait("!document.querySelector('.tasks-field-editor')")
  await run(`window.electronAPI.tasks.remove('${task.id}')`)
  console.log('CHOUYU_TASK_EDIT_UI_SMOKE_PASSED')
}
