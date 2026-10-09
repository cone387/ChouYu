import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { waitForRenderer } from './storage-smoke'

export async function runTaskViewsUISmoke(window: BrowserWindow): Promise<void> {
  const run = (source: string) => window.webContents.executeJavaScript(source)
  const click = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const fill = (selector: string, value: string) => run(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  const wait = (condition: string) => waitForRenderer(window, condition)
  const assert = async (condition: string) => { if (!await run(condition)) throw new Error(`Task views assertion: ${condition}`) }
  window.webContents.send('open-chat-panel')
  await wait("!!document.querySelector('.chat-panel')")
  if (!await run("!!document.querySelector('[data-workspace-nav=tasks]')")) {
    await click('[aria-label="窗口模式"]'); await click('[data-workspace-mode-option=workspace]')
  }
  await click('[data-workspace-nav=tasks]')
  await wait("!!document.querySelector('.tasks-view')")
  if (await run("!!document.querySelector('[aria-label=最大化窗口]')")) {
    await click('[aria-label="最大化窗口"]')
    await wait("document.querySelector('.chat-panel')?.dataset.maximized==='true'")
  }
  const fixture = await run(`(async () => {
    const api = window.electronAPI.tasks;
    const a = await api.createGroup('工作分组'), b = await api.createGroup('个人分组');
    const p = await api.createProject('工作清单', a.id), q = await api.createProject('个人清单', b.id);
    const t = await api.create({title:'工作分组中的任务',projectId:p.id,priority:'high'});
    const u = await api.create({title:'个人分组中的任务',projectId:q.id});
    return {a:a.id,b:b.id,p:p.id,q:q.id,t:t.id,u:u.id};
  })()`)
  await wait(`!!document.querySelector('[data-project-id="${fixture.p}"]')`)
  await assert("!document.querySelector('.tasks-favorites')")
  await click(`[data-project-id="${fixture.p}"] .tasks-project-menu > summary`)
  await click(`[data-project-id="${fixture.p}"] [aria-label="标记为喜欢 工作清单"]`)
  await wait(`!!document.querySelector('[data-favorite-project-id="${fixture.p}"]')`)
  await assert("document.querySelector('.tasks-favorites-label')?.textContent==='我喜欢' && !document.querySelector('.tasks-favorites > summary')")
  await click(`[data-favorite-project-id="${fixture.p}"] .tasks-project-select`)
  await wait("document.querySelector('.tasks-page-heading h1')?.textContent==='工作清单'")
  await assert(`!!document.querySelector('[data-project-id="${fixture.p}"]')`)
  await run(`window.electronAPI.tasks.archiveProject(${JSON.stringify(fixture.p)},true)`)
  await wait(`!document.querySelector('[data-favorite-project-id="${fixture.p}"]')`)
  await run(`window.electronAPI.tasks.archiveProject(${JSON.stringify(fixture.p)},false)`)
  await wait(`!!document.querySelector('[data-favorite-project-id="${fixture.p}"]')`)
  await click('.tasks-more-views > summary')
  await wait("document.querySelector('.tasks-more-views-popover')?.matches(':popover-open')")
  await run("Array.from(document.querySelectorAll('.tasks-more-view-create')).find(button=>button.textContent.includes('新建自定义视图')).click()")
  await wait("!!document.querySelector('[aria-label=视图名称]')")
  await assert("document.querySelector('[aria-label=视图分组]').value==='' && document.querySelector('[aria-label=视图清单]').value===''")
  await fill('[aria-label="视图名称"]', '工作事项')
  await fill('[aria-label="视图清单"]', fixture.q)
  await fill('[aria-label="视图分组"]', fixture.a)
  await assert(`document.querySelector('[aria-label=视图清单]').value==='' && !Array.from(document.querySelector('[aria-label=视图清单]').options).some(o=>o.value===${JSON.stringify(fixture.q)})`)
  await fill('[aria-label="视图清单"]', fixture.p)
  const artifacts = process.env.CHOUYU_TASK_GROUP_ARTIFACTS
  if (artifacts) {
    mkdirSync(artifacts, { recursive: true })
    const theme = await run('document.documentElement.dataset.theme')
    try {
      for (const mode of ['light', 'dark']) for (const width of [1100, 375]) {
        await run(`document.documentElement.dataset.theme=${JSON.stringify(mode)}`)
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 800 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 800 }, scale: 1 })
        await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        writeFileSync(join(artifacts, `task-view-${mode}-${width}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
        await assert("(() => {const d=document.querySelector('.tasks-view-dialog'),r=d.getBoundingClientRect();return d.scrollWidth<=d.clientWidth+1 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight})()")
      }
    } finally {
      window.webContents.disableDeviceEmulation()
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
    }
  }
  await click('.tasks-view-dialog button[type=submit]')
  await wait("!document.querySelector('.tasks-view-dialog')")
  const saved = await run("window.electronAPI.tasks.views().then(v=>v.find(v=>v.name==='工作事项'))")
  if (saved.groupId !== fixture.a || saved.projectIds.join() !== fixture.p) throw new Error('View filters did not persist')
  await click('[aria-label="编辑视图 工作事项"]')
  await wait("!!document.querySelector('[aria-label=视图分组]')")
  await assert(`document.querySelector('[aria-label=视图分组]').value===${JSON.stringify(fixture.a)} && document.querySelector('[aria-label=视图清单]').value===${JSON.stringify(fixture.p)}`)
  await fill('[aria-label="视图清单"]', '')
  await click('.tasks-view-dialog button[type=submit]')
  await wait("!document.querySelector('.tasks-view-dialog')")
  await click(`[data-view-selection="view:${saved.id}"]`)
  await wait("document.querySelector('.tasks-page-heading h1')?.textContent==='工作事项'")
  await assert(`!!document.querySelector('[data-task-id="${fixture.t}"]') && !document.querySelector('[data-task-id="${fixture.u}"]')`)
  // New projects are included by group identity, not a saved snapshot of project IDs.
  await run(`(async()=>{const p=await window.electronAPI.tasks.createProject('新增工作清单',${JSON.stringify(fixture.a)});await window.electronAPI.tasks.create({title:'自动纳入分组的新任务',projectId:p.id})})()`)
  await wait("document.querySelector('.tasks-view').textContent.includes('自动纳入分组的新任务')")
  await click('.tasks-more-views > summary')
  await click('[aria-label="编辑视图 工作事项"]')
  await fill('[aria-label="视图分组"]', '')
  await click('.tasks-view-dialog button[type=submit]')
  await wait(`!!document.querySelector('[data-task-id="${fixture.u}"]')`)
  await click('[aria-label="编辑视图 工作事项"]')
  await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
  await wait("!document.querySelector('.tasks-view-dialog')")
  // Configure this view using the existing toolbar, then switch away and return.
  await click('[aria-label="筛选任务"]')
  await click('[aria-label="筛选优先级"] input[type=checkbox]')
  await wait(`window.electronAPI.tasks.views().then(views=>views.find(v=>v.id===${JSON.stringify(saved.id)}).priorities.includes('high'))`)
  await wait(`!document.querySelector('[data-task-id="${fixture.u}"]')`)
  await fill('[aria-label="筛选截止范围"]', 'tomorrow')
  await wait(`window.electronAPI.tasks.views().then(views=>views.find(v=>v.id===${JSON.stringify(saved.id)}).dueRange==='tomorrow')`)
  await fill('[aria-label="筛选截止范围"]', 'any')
  await wait(`window.electronAPI.tasks.views().then(views=>views.find(v=>v.id===${JSON.stringify(saved.id)}).dueRange==='any')`)
  await click('[aria-label="排序方式"]')
  await run("Array.from(document.querySelectorAll('[role=group][aria-label=排序方式] button')).find(b=>b.textContent==='按标题').click()")
  await click('[data-view-selection="all"]')
  await wait("document.querySelector('.tasks-page-heading h1')?.textContent==='全部'")
  await click('.tasks-more-views > summary')
  await click(`[data-view-selection="view:${saved.id}"]`)
  await wait("document.querySelector('.tasks-page-heading h1')?.textContent==='工作事项'")
  await assert("document.querySelector('[aria-label=排序方式]').textContent.includes('按标题')")
  await click('[aria-label="筛选任务"]')
  await assert("document.querySelector('[aria-label=筛选优先级] input[type=checkbox]').checked")
  // Saving as a new view carries the toolbar filters and sort, without exposing a second filter form.
  await run("Array.from(document.querySelectorAll('[aria-label=筛选优先级] button')).find(b=>b.textContent==='保存为新视图').click()")
  await wait("!!document.querySelector('.tasks-view-dialog')")
  await assert("document.querySelectorAll('.tasks-view-dialog input').length===1 && document.querySelectorAll('.tasks-view-dialog select').length===2")
  await fill('[aria-label="视图名称"]', '工作事项副本')
  await click('.tasks-view-dialog button[type=submit]')
  await wait("document.querySelector('.tasks-page-heading h1')?.textContent==='工作事项副本'")
  await assert("document.querySelector('[aria-label=排序方式]').textContent.includes('按标题')")
  await wait("window.electronAPI.tasks.views().then(views=>views.some(v=>v.name==='工作事项副本' && v.priorities.includes('high')))")
  // Remount the renderer to verify durable view settings, not component state.
  window.webContents.reload()
  await wait("!!document.querySelector('.desktop') || !!document.querySelector('.pet-container') || !!document.querySelector('#root')")
  window.webContents.send('open-chat-panel')
  await wait("!!document.querySelector('.chat-panel')")
  if (!await run("!!document.querySelector('[data-workspace-nav=tasks]')")) {
    await click('[aria-label="窗口模式"]'); await click('[data-workspace-mode-option=workspace]')
  }
  await click('[data-workspace-nav=tasks]')
  await wait("document.querySelector('.tasks-page-heading h1')?.textContent==='工作事项副本'")
  await assert("document.querySelector('[aria-label=排序方式]').textContent.includes('按标题')")
  await click('[aria-label="筛选任务"]')
  await assert("document.querySelector('[aria-label=筛选优先级] input[type=checkbox]').checked")
  await assert(`!!document.querySelector('[data-favorite-project-id="${fixture.p}"]')`)
  await click('[aria-label="筛选任务"]')
  if (artifacts) {
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    writeFileSync(join(artifacts, 'favorite-lists.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
  }
  await assert(`document.querySelector('[data-favorite-project-id="${fixture.p}"] .tasks-project-select path').getAttribute('d')===document.querySelector('[data-project-id="${fixture.p}"] .tasks-project-select path').getAttribute('d')`)
  await click(`[data-favorite-project-id="${fixture.p}"] .tasks-project-menu > summary`)
  await click(`[data-favorite-project-id="${fixture.p}"] [aria-label="取消喜欢 工作清单"]`)
  await wait(`!document.querySelector('[data-favorite-project-id="${fixture.p}"]')`)
  await assert(`!!document.querySelector('[data-project-id="${fixture.p}"]')`)
  await assert("!document.querySelector('.tasks-favorites')")
  await assert(`window.electronAPI.tasks.projects().then(items=>items.find(p=>p.id===${JSON.stringify(fixture.p)}).isFavorite===false)`)
  console.log('CHOUYU_TASK_VIEWS_UI_SMOKE_PASSED simple creation, toolbar filter persistence, per-view sorting, copy and renderer reload')
}
