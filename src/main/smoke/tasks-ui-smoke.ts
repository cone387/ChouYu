import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { waitForRenderer } from './storage-smoke'

/** 通过真实 IPC 和 React 表单验证任务上下文、字段关联、归档和历史搜索。 */
export async function runTasksUISmoke(window: BrowserWindow): Promise<void> {
  const run = (source: string) => window.webContents.executeJavaScript(source)
  const click = (selector: string) => run(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) throw new Error('Missing control: ' + ${JSON.stringify(selector)});
    element.click();
  })()`)
  const fill = (selector: string, value: string) => run(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing input: ' + ${JSON.stringify(selector)});
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  const assert = async (condition: string) => {
    if (!await run(condition)) throw new Error(`Tasks UI assertion failed: ${condition}`)
  }
  const selectView = async (id: string) => {
    const selector = `[data-view-selection="${id}"]`
    const hidden = await run(`!!document.querySelector(${JSON.stringify(selector)})?.closest('.tasks-more-views')`)
    if (hidden) {
      await click('.tasks-more-views > summary')
      await waitForRenderer(window, "document.querySelector('.tasks-more-views-popover').matches(':popover-open')")
    }
    await click(selector)
    await waitForRenderer(window, "!document.querySelector('.tasks-more-views').open")
    if (hidden) await assert("!!document.querySelector('.tasks-more-views > summary[data-active]')")
  }
  const originalIds: string[] = await run("window.electronAPI.tasks.list({ doneLimit: 10000 }).then(list => [...list.open, ...list.done].map(task => task.id))")
  const projectId: string = await run(`window.electronAPI.tasks.createProject('任务界面测试').then(project => project.id)`)
  const fieldId: string = await run(`window.electronAPI.tasks.createField({ name: '测试阶段', options: ['待办', '进行中'] }).then(field => field.id)`)
  window.webContents.send('open-chat-panel')
  await waitForRenderer(window, "Boolean(document.querySelector('.chat-panel'))")
  if (!await run("Boolean(document.querySelector('[data-workspace-nav=tasks]'))")) {
    await click('[aria-label="窗口模式"]')
    await click('[data-workspace-mode-option="workspace"]')
  }
  await click('[data-workspace-nav="tasks"]')
  await waitForRenderer(window, "Boolean(document.querySelector('[aria-label=\"归档 任务界面测试\"]'))")
  await click('[aria-label="收起任务侧栏"]')
  await assert("document.querySelector('.tasks-sidebar').hidden && !!document.querySelector('[aria-label=\"展开任务侧栏\"]')")
  await click('[aria-label="展开任务侧栏"]')
  await assert("!document.querySelector('.tasks-sidebar').hidden")
  await click('[aria-label="新建分组或清单"]')
  await click('.tasks-add-list-menu .tasks-item-menu-popover button:first-child')
  await assert("document.querySelector('.tasks-collection-dialog')?.getAttribute('aria-modal') === 'true'")
  await fill('.tasks-collection-form input', '工作分组')
  await click('.tasks-collection-form button[type="submit"]')
  await waitForRenderer(window, "Array.from(document.querySelectorAll('.tasks-project-group summary')).some(item => item.textContent === '工作分组')")
  await assert("!document.querySelector('.tasks-sidebar-projects .tasks-count')")
  await click('[aria-label="折叠或展开分组 收集箱"]')
  await assert("!document.querySelector('.tasks-project-group').open && document.querySelectorAll('.tasks-project-group')[1].open")
  await click('[aria-label="折叠或展开分组 收集箱"]')
  await assert("document.querySelector('.tasks-project-group').open")
  await click('[aria-label="管理分组 工作分组"]')
  await click('.tasks-group-actions .tasks-project-menu[open] .tasks-item-menu-popover button:first-child')
  await fill('.tasks-collection-form input', '工作分组改名')
  await click('.tasks-collection-form button[type="submit"]')
  await waitForRenderer(window, "Array.from(document.querySelectorAll('.tasks-project-group summary')).some(item => item.textContent === '工作分组改名')")
  await click('[aria-label="管理分组 工作分组改名"]')
  await click('.tasks-group-actions .tasks-project-menu[open] .tasks-item-menu-popover button:first-child')
  await assert("document.querySelector('.tasks-collection-dialog')?.getAttribute('aria-modal') === 'true'")
  await fill('.tasks-collection-form input', '工作分组')
  await click('.tasks-collection-form button[type="submit"]')
  await waitForRenderer(window, "!!document.querySelector('[aria-label=\"在 工作分组 中新建清单\"]')")
  await click('[aria-label="在 工作分组 中新建清单"]')
  await assert("document.querySelector('.tasks-collection-form select').value !== ''")
  await fill('.tasks-collection-form input', '分组内项目')
  await click('.tasks-collection-form button[type="submit"]')
  await waitForRenderer(window, "Array.from(document.querySelectorAll('.tasks-project-group ul')).some(item => item.textContent.includes('分组内项目'))")
  const groupId: string = await run("window.electronAPI.tasks.groups().then(groups => groups.find(group => group.name === '工作分组').id)")
  await fill('[aria-label="移动清单 任务界面测试 到分组"]', groupId)
  await waitForRenderer(window, "Array.from(document.querySelectorAll('.tasks-project-group ul')).some(item => item.textContent.includes('任务界面测试'))")
  await assert("document.querySelector('.tasks-more-views-popover').textContent.includes('新建自定义视图')")
  await click('.tasks-create')
  await assert("document.querySelector('[aria-label=\"任务截止日期\"]').value === new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0')")
  await click('[aria-label="关闭任务弹窗"]')
  await run("document.querySelector('[aria-label=\"归档 任务界面测试\"]').closest('li').querySelector('button').click()")
  await click('.tasks-create')
  await assert(`document.querySelector('[aria-label="任务清单"]').value === ${JSON.stringify(projectId)}`)
  await fill('[aria-label="任务标题"]', '界面创建任务')
  const optionId: string = await run(`window.electronAPI.tasks.fields().then(fields => fields.find(field => field.id === ${JSON.stringify(fieldId)}).options[1].id)`)
  await fill('[aria-label="任务 测试阶段"]', optionId)
  await click('.tasks-dialog button[type="submit"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-dialog') && document.querySelector('.tasks-list')?.textContent.includes('界面创建任务')")
  // All transient menus dismiss outside / with Escape; structural groups stay open.
  const menuSelector = 'details.tasks-tool-menu, details.tasks-project-menu, details.tasks-item-menu'
  const menuCount: number = await run(`document.querySelectorAll(${JSON.stringify(menuSelector)}).length`)
  for (let index = 0; index < menuCount; index++) {
    await run(`document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].querySelector('summary').scrollIntoView({ block: 'nearest' })`)
    await run("new Promise(resolve => requestAnimationFrame(resolve))")
    const sidebarSize = await run("(() => { const side = document.querySelector('.tasks-sidebar'); return [side.scrollWidth, side.scrollHeight] })()")
    await run(`document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].querySelector('summary').click()`)
    await assert(`document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].open`)
    await waitForRenderer(window, `document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].querySelector('.tasks-item-menu-popover').matches(':popover-open')`)
    await assert(`(() => {
      const menu = document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].querySelector('.tasks-item-menu-popover');
      const rect = menu.getBoundingClientRect();
      const panel = document.querySelector('.tasks-view').getBoundingClientRect();
      const side = document.querySelector('.tasks-sidebar');
      return rect.width > 0 && rect.height > 0 && rect.left >= Math.max(0, panel.left) && rect.top >= Math.max(0, panel.top)
        && rect.right <= Math.min(innerWidth, panel.right) + 1 && rect.bottom <= Math.min(innerHeight, panel.bottom) + 1
        && side.scrollWidth === ${sidebarSize[0]} && side.scrollHeight === ${sidebarSize[1]};
    })()`)

    await run("document.querySelector('.tasks-page-heading h1').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
    await assert(`Array.from(document.querySelectorAll(${JSON.stringify(menuSelector)})).every(menu => !menu.open)`)
    await run(`document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].querySelector('summary').click()`)
    await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
    await assert(`!document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].open && document.activeElement === document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].querySelector('summary')`)
  }
  await assert("document.querySelector('.tasks-project-group').open")
  await click('[aria-label="筛选任务"]')
  await click('[aria-label="筛选优先级"] input')
  await assert("document.querySelector('[aria-label=筛选任务]').parentElement.open")
  await click('[aria-label="筛选优先级"] input')
  await click('[aria-label="排序方式"]')
  await assert("!document.querySelector('[aria-label=筛选任务]').parentElement.open && document.querySelector('[aria-label=排序方式]').parentElement.open")
  await click('[aria-label="排序方式"] + div button')
  await assert("!document.querySelector('[aria-label=排序方式]').parentElement.open")
  await click('[aria-label="筛选任务"]')
  // The smoke window is hidden, so explicitly dispatch the focus transition.
  await run("document.querySelector('.tasks-search input').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))")
  await assert("!document.querySelector('[aria-label=筛选任务]').parentElement.open")
  await waitForRenderer(window, "Boolean(document.querySelector('.tasks-item-menu summary'))")
  await click('.tasks-item-menu summary')
  await click('.tasks-item-menu .tasks-item-menu-popover button:not(.tasks-item-menu-danger)')
  await assert("!document.querySelector('.tasks-item-menu').open")
  await click('[aria-label="关闭任务弹窗"]')
  if (process.env.CHOUYU_TASKS_ARTIFACTS) {
    const directory = process.env.CHOUYU_TASKS_ARTIFACTS
    mkdirSync(directory, { recursive: true })
    const theme = await run('document.documentElement.dataset.theme')
    for (const mode of ['light', 'dark']) {
      await run(`document.documentElement.dataset.theme = ${JSON.stringify(mode)}`)
      for (const width of [1100, 375]) {
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 800 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 800 }, scale: 1 })
        for (const layout of ['list', 'board']) {
          await click(layout === 'list' ? '.tasks-tab:first-child' : '.tasks-tab:nth-child(2)')
          await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          await assert("document.querySelector('.tasks-view').scrollWidth <= document.querySelector('.tasks-view').clientWidth + 1")
          await assert(`(() => {
            const sidebar = document.querySelector('.tasks-sidebar');
            const views = document.querySelector('.tasks-sidebar-view-nav');
            const projects = document.querySelector('.tasks-sidebar-projects');
            const viewTop = views.getBoundingClientRect().top;
            views.scrollTop = views.scrollHeight;
            const viewScroll = views.scrollTop;
            if (viewScroll !== 0 || views.scrollHeight > views.clientHeight + 1) return false;
            projects.scrollTop = projects.scrollHeight;
            const buttons = getComputedStyle(projects, '::-webkit-scrollbar-button');
            return views.scrollTop === viewScroll && sidebar.scrollHeight <= sidebar.clientHeight + 1
              && getComputedStyle(views).overflowY === 'hidden' && views.getBoundingClientRect().top === viewTop && getComputedStyle(projects).overflowY === 'auto'
              && buttons.display === 'none' && (innerWidth > 640 || projects.scrollTop > 0);
          })()`)

          await run("document.querySelectorAll('.tasks-sidebar-view-nav, .tasks-sidebar-projects, .tasks-main').forEach(element => { element.scrollTop = 0; element.scrollLeft = 0 })")
          await assert("document.querySelector('.tasks-main').scrollWidth <= document.querySelector('.tasks-main').clientWidth + 1")
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
          writeFileSync(join(directory, `tasks-${layout}-${mode}-${width}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
        }
      }
    }
    window.webContents.disableDeviceEmulation()
    await run(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
    await click('.tasks-tab:first-child')
  }
  await click('.tasks-fields-toggle')
  await fill('[aria-label="测试阶段 选项 2"]', '处理中')
  await click('.tasks-field-row button[type="submit"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-field-row button[type=submit]').disabled")
  await assert(`window.electronAPI.tasks.list().then(list => list.open.find(task => task.title === '界面创建任务').customFields[${JSON.stringify(fieldId)}] === ${JSON.stringify(optionId)})`)
  await click('[aria-label="关闭字段管理弹窗"]')
  await waitForRenderer(window, "document.querySelector('.tasks-list')?.textContent.includes('处理中')")
  await click('[aria-label="归档 任务界面测试"]')
  await waitForRenderer(window, "!document.querySelector('[aria-label=\"归档 任务界面测试\"]')")
  await click('.tasks-title-button')
  await fill('[aria-label="任务标题"]', '归档后仍可编辑')
  await click('.tasks-dialog button[type="submit"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-dialog') && document.querySelector('.tasks-list')?.textContent.includes('归档后仍可编辑')")
  await click('.tasks-tab:nth-child(2)')
  await fill('[aria-label="看板分组方式"]', 'project')
  await waitForRenderer(window, "document.querySelector('.tasks-board')?.textContent.includes('任务界面测试（已归档）') && document.querySelector('.tasks-board')?.textContent.includes('归档后仍可编辑')")
  await run(`(async () => {
    for (let i = 0; i < 55; i++) {
      const task = await window.electronAPI.tasks.create({ title: i === 0 ? '最早历史目标' : '历史记录 ' + i });
      await window.electronAPI.tasks.complete(task.id);
    }
  })()`)
  await selectView('done')
  await waitForRenderer(window, "document.querySelectorAll('.tasks-list-done > li').length === 50")
  await run("Array.from(document.querySelectorAll('.tasks-main > button')).find(button => button.textContent.includes('加载更多')).click()")
  await waitForRenderer(window, "document.querySelectorAll('.tasks-list-done > li').length === 55")
  await fill('.tasks-search input', '最早历史目标')
  await waitForRenderer(window, "document.querySelectorAll('.tasks-list-done > li').length === 1 && document.querySelector('.tasks-list-done').textContent.includes('最早历史目标')")
  await fill('.tasks-search input', '')
  const unplannedId: string = await run("window.electronAPI.tasks.create({ title: '待规划验收任务' }).then(task => task.id)")
  await selectView('unplanned')
  await click('.tasks-tab:first-child')
  await waitForRenderer(window, "document.querySelector('.tasks-list')?.textContent.includes('待规划验收任务')")
  await assert("!document.querySelector('[aria-label=\"归档 默认清单\"]') && !!document.querySelector('[aria-label=\"重命名 默认清单\"]')")
  await run("Array.from(document.querySelectorAll('.tasks-title-button')).find(button => button.textContent === '待规划验收任务').click()")
  await fill('[aria-label="任务开始日期"]', '2026-10-01')
  await click('.tasks-dialog button[type="submit"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-dialog')")
  await assert(`window.electronAPI.tasks.list().then(list => list.open.find(task => task.id === ${JSON.stringify(unplannedId)}).startAt !== null)`)
  await selectView('unplanned')
  await waitForRenderer(window, "document.querySelector('.tasks-page-heading h1')?.textContent === '待规划' && !document.querySelector('.tasks-list')?.textContent.includes('待规划验收任务')")
  // 不把未完成任务的导航角标带入后续聊天 UI 验收。
  await run(`(async () => {
    const original = new Set(${JSON.stringify(originalIds)});
    const list = await window.electronAPI.tasks.list({ doneLimit: 10000 });
    for (const task of [...list.open, ...list.done]) if (!original.has(task.id)) await window.electronAPI.tasks.remove(task.id);
    await window.electronAPI.tasks.deleteField(${JSON.stringify(fieldId)});
    window.dispatchEvent(new Event('chouyu:tasks-changed'));
  })()`)
  await click('[aria-label="关闭面板"]')
  await waitForRenderer(window, "!document.querySelector('.chat-panel')")
  console.log('CHOUYU_TASKS_UI_SMOKE_PASSED menu dismissal/exclusivity/focus, groups, project membership, context creation, field rename, archive editing/board, history loading/search')
}
