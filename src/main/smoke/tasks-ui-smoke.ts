import { dialog, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { waitForRenderer } from './storage-smoke'
import type { TaskBackup } from '../tasks/backup'

/** 通过真实 IPC 和 React 表单验证任务上下文、字段关联、归档和历史搜索。 */
export async function runTasksUISmoke(window: BrowserWindow): Promise<void> {
  const run = (source: string) => window.webContents.executeJavaScript(source).catch(error => { throw new Error(`Tasks UI script failed: ${source.slice(0, 500)} — ${String(error)}`) })
  const click = (selector: string) => run(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) throw new Error('Missing control: ' + ${JSON.stringify(selector)});
    element.click();
  })()`)
  const clickPointer = async (selector: string, padding = false, waitForPaint = true) => {
    const point = await run(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      const rect = button.getBoundingClientRect();
      const x = Math.round(rect.x + (${padding} ? 6 : rect.width / 2)), y = Math.round(rect.y + (${padding} ? 6 : rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      if (!button.contains(hit) || !hit.closest('[data-interactive]')) throw new Error('Pointer target is blocked or enables desktop click-through: ' + ${JSON.stringify(selector)});
      return { x, y };
    })()`)
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    if (waitForPaint) await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  }
  const fill = (selector: string, value: string) => run(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing input: ' + ${JSON.stringify(selector)});
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  const assert = async (condition: string) => {
    if (!await run(condition)) {
      const layout = await run(`JSON.stringify({
        viewport: [innerWidth, innerHeight],
        panel: document.querySelector('.tasks-view')?.getBoundingClientRect().toJSON(),
        sidebar: (() => { const side = document.querySelector('.tasks-sidebar'); return side && [side.scrollWidth, side.scrollHeight] })(),
        menus: Array.from(document.querySelectorAll('details[open] > .tasks-item-menu-popover')).map(menu => ({
          name: menu.parentElement.querySelector('summary')?.textContent,
          rect: menu.getBoundingClientRect().toJSON(), style: menu.getAttribute('style'), open: menu.matches(':popover-open')
        }))
      })`)
      throw new Error(`Tasks UI assertion failed: ${condition}\nLayout: ${layout}`)
    }
  }
  const captureGrouping = async (name: string) => {
    const directory = process.env.CHOUYU_TASK_GROUP_ARTIFACTS
    if (!directory) return
    mkdirSync(directory, { recursive: true })
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    writeFileSync(join(directory, `${name}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
  }
  const chooseGrouping = async (value: string) => {
    if (!await run("document.querySelector('.tasks-grouping-menu').open")) await click('.tasks-grouping-menu > summary')
    await waitForRenderer(window, "document.querySelector('.tasks-grouping-menu .tasks-item-menu-popover').matches(':popover-open')")
    await click(`[data-grouping-value="${value}"]`)
    await waitForRenderer(window, "!document.querySelector('.tasks-grouping-menu').open")
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
  const choose = async (label: string, value: string) => {
    await click(`[role="combobox"][aria-label="${label}"]`)
    await waitForRenderer(window, "!!document.querySelector('.tasks-select-options:popover-open')")
    await assert(`(() => {
      const trigger = document.querySelector('[role="combobox"][aria-label="${label}"]');
      const popup = document.querySelector('.tasks-select-options:popover-open');
      return getComputedStyle(trigger).borderWidth === '0px' && getComputedStyle(trigger).boxShadow === 'none'
        && getComputedStyle(popup).borderWidth === '0px';
    })()`)
    await run(`(() => {
      const popup = document.querySelector('.tasks-select-options:popover-open');
      const option = Array.from(popup.querySelectorAll('[role="option"]')).find(item => item.dataset.value === ${JSON.stringify(value)});
      if (!option) throw new Error('Missing themed option');
      option.click();
    })()`)
    await waitForRenderer(window, "!document.querySelector('.tasks-select-options:popover-open')")
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
  // Today's badge excludes unscheduled, past, future and completed tasks.
  const badgeFixture = await run(`(async () => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const tomorrow = new Date(start); tomorrow.setDate(tomorrow.getDate() + 1);
    const list = await window.electronAPI.tasks.list();
    const baseline = list.open.filter(task => task.dueAt !== null && task.dueAt >= +start && task.dueAt < +tomorrow).length;
    const tasks = [];
    for (const dueAt of [+start, +tomorrow - 1, +start - 1, +tomorrow, null, +start]) tasks.push(await window.electronAPI.tasks.create({ title: 'Badge fixture', dueAt }));
    await window.electronAPI.tasks.complete(tasks[5].id);
    window.dispatchEvent(new Event('chouyu:tasks-changed'));
    return { baseline, ids: tasks.map(task => task.id) };
  })()`)
  await waitForRenderer(window, `document.querySelector('.workspace-nav-badge')?.textContent === '${badgeFixture.baseline + 2}'`)
  await run(`window.electronAPI.tasks.complete('${badgeFixture.ids[0]}').then(() => window.dispatchEvent(new Event('chouyu:tasks-changed')))`)
  await waitForRenderer(window, `document.querySelector('.workspace-nav-badge')?.textContent === '${badgeFixture.baseline + 1}'`)
  await run(`Promise.all(${JSON.stringify(badgeFixture.ids)}.map(id => window.electronAPI.tasks.remove(id))).then(() => window.dispatchEvent(new Event('chouyu:tasks-changed')))`)
  await waitForRenderer(window, `Number(document.querySelector('.workspace-nav-badge')?.textContent ?? 0) === ${badgeFixture.baseline}`)
  const originalTheme = await run('document.documentElement.dataset.theme')
  for (const theme of ['light', 'dark']) {
    await run(`document.documentElement.dataset.theme = '${theme}'`)
    await assert(`(() => {
      const scrollers = [...document.querySelectorAll('*')].filter(element => /auto|scroll/.test(getComputedStyle(element).overflow));
      const reference = getComputedStyle(document.querySelector('.tasks-main'), '::-webkit-scrollbar-thumb').backgroundColor;
      return scrollers.length > 0 && scrollers.every(element => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor === reference
        && getComputedStyle(element, '::-webkit-scrollbar-button').display === 'none');
    })()`)
  }
  await run(`document.documentElement.dataset.theme = ${JSON.stringify(originalTheme)}`)
  // Escape closes the editor whether focus is in its title or on the document.
  for (const target of ['document', 'document.querySelector(\'[aria-label="任务标题"]\')']) {
    await click('.tasks-create')
    await waitForRenderer(window, "!!document.querySelector('.tasks-composer')")
    await run(`${target}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
    await waitForRenderer(window, "!document.querySelector('.tasks-composer')")
    await assert("!!document.querySelector('.chat-panel') && !document.querySelector('.workspace-tasks').hidden")
    await waitForRenderer(window, "!document.querySelector('.tasks-create').matches(':focus')")
  }
  window.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 })
  await waitForRenderer(window, "getComputedStyle(document.querySelector('.tasks-sidebar-title .tasks-sidebar-toggle')).opacity === '0'")
  const sidebarHeader = await run(`(() => {
    const title = document.querySelector('.tasks-sidebar-title > span').getBoundingClientRect();
    const button = document.querySelector('.tasks-sidebar-title > button').getBoundingClientRect();
    return { x: Math.round(title.x + title.width / 2), y: Math.round(title.y + title.height / 2), rightOfTitle: button.left > title.right };
  })()`)
  await assert(`${sidebarHeader.rightOfTitle}`)
  window.webContents.sendInputEvent({ type: 'mouseMove', x: sidebarHeader.x, y: sidebarHeader.y })
  await waitForRenderer(window, "getComputedStyle(document.querySelector('.tasks-sidebar-title .tasks-sidebar-toggle')).opacity === '1'")
  await assert("document.querySelector('.tasks-sidebar-title button svg').getAttribute('viewBox') === '0 0 1024 1024'")
  await captureGrouping('sidebar-toggle-hover')
  await clickPointer('[aria-label="收起任务侧栏"]')
  await waitForRenderer(window, "document.querySelector('.tasks-sidebar').hidden && !!document.querySelector('[aria-label=\"展开任务侧栏\"]')")
  await click('[aria-label="展开任务侧栏"]')
  await assert("!document.querySelector('.tasks-sidebar').hidden")
  await click('[aria-label="新建分组或清单"]')
  await click('.tasks-add-list-menu .tasks-item-menu-popover button:first-child')
  await assert("document.querySelector('.tasks-collection-dialog')?.getAttribute('aria-modal') === 'true'")
  await fill('.tasks-collection-form input', '工作分组')
  await clickPointer('.tasks-collection-form button[type="submit"]')
  await waitForRenderer(window, "Array.from(document.querySelectorAll('.tasks-project-group summary')).some(item => item.textContent === '工作分组')")
  await assert("!document.querySelector('.tasks-sidebar-projects .tasks-count')")
  await click('[aria-label="折叠或展开分组 收集箱"]')
  await assert("!document.querySelector('.tasks-project-group').open && document.querySelectorAll('.tasks-project-group')[1].open")
  await click('[aria-label="折叠或展开分组 收集箱"]')
  await assert("document.querySelector('.tasks-project-group').open")
  await assert(`(() => {
    const icon = document.querySelector('.tasks-project-group > summary > .tasks-disclosure-icon');
    return icon.getBoundingClientRect().width > 0 && getComputedStyle(icon).width === '16px' && getComputedStyle(icon).transform === 'matrix(0, 1, -1, 0, 0, 0)'
      && icon.querySelector('path').getAttribute('fill') === 'currentColor';
  })()`)
  await click('[aria-label="折叠或展开分组 收集箱"]')
  await assert("getComputedStyle(document.querySelector('.tasks-project-group > summary > .tasks-disclosure-icon')).transform === 'none'")
  await captureGrouping('sidebar-disclosure-collapsed')
  await click('[aria-label="折叠或展开分组 收集箱"]')
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
  await assert("!document.querySelector('.tasks-search')")
  await run("document.querySelector('[aria-label=\"归档 任务界面测试\"]').closest('li').querySelector('button').click()")
  await waitForRenderer(window, "document.querySelector('.tasks-page-heading h1')?.textContent === '任务界面测试'")
  const collectionGroupsBefore: string = await run("window.electronAPI.tasks.groups().then(groups => JSON.stringify(groups))")
  await clickPointer('[aria-label="新建任务选项"]')
  await waitForRenderer(window, "document.querySelector('.tasks-create-options .tasks-item-menu-popover').matches(':popover-open')")
  await assert("Array.from(document.querySelectorAll('.tasks-create-options .tasks-item-menu-popover button')).map(button => button.textContent).join(',') === '新建任务,新建分组'")
  await clickPointer('.tasks-create-options .tasks-item-menu-popover button:last-child')
  await waitForRenderer(window, "!!document.querySelector('.tasks-display-group-form')")
  await assert(`(() => {
    const form = document.querySelector('.tasks-display-group-form');
    const dialog = form.closest('[role="dialog"][aria-modal="true"]');
    if (!dialog || dialog.querySelector('h2').textContent !== '新建任务分组' || document.activeElement !== form.querySelector('input')) return false;
    const rect = dialog.getBoundingClientRect(), backdrop = dialog.parentElement.getBoundingClientRect();
    return Math.abs(rect.x + rect.width / 2 - backdrop.x - backdrop.width / 2) < 2
      && Math.abs(rect.y + rect.height / 2 - backdrop.y - backdrop.height / 2) < 2;
  })()`)
  for (const theme of ['light', 'dark']) {
    await run(`document.documentElement.dataset.theme = '${theme}'`)
    await assert(`(() => {
      const input = document.querySelector('[aria-label="任务分组名称"]');
      input.blur(); const border = getComputedStyle(input).borderColor;
      input.focus(); const style = getComputedStyle(input);
      return style.outlineStyle === 'none' && style.boxShadow === 'none' && style.borderColor === border;
    })()`)
  }
  await run(`document.documentElement.dataset.theme = ${JSON.stringify(originalTheme)}`)
  await fill('[aria-label="任务分组名称"]', '手动任务组')
  await clickPointer('.tasks-display-group-form button[type=submit]')
  await waitForRenderer(window, "!document.querySelector('.tasks-display-group-form') && document.querySelector('.tasks-grouped-list')?.textContent.includes('手动任务组')")
  await assert("!document.querySelector('.tasks-notice')")
  await assert("!document.querySelector('.tasks-grouped-list .tasks-group-create-task') && !document.querySelector('.tasks-grouped-list').textContent.includes('中新建任务')")
  const manualGroupId: string = await run("Array.from(document.querySelectorAll('.tasks-content-group')).find(group => group.querySelector('summary').textContent.includes('手动任务组')).dataset.groupKey")
  await click('.tasks-grouping-menu > summary')
  await chooseGrouping('priority')
  await assert("document.querySelectorAll('.tasks-content-group').length === 3")
  await assert(`window.electronAPI.tasks.groups().then(groups => JSON.stringify(groups) === ${JSON.stringify(collectionGroupsBefore)})`)
  await chooseGrouping('none')
  await click('.tasks-page-heading h1')

  await selectView('today')
  await click('.tasks-create')
  await assert("document.querySelector('[aria-label=\"任务截止日期\"]').value === new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0')")
  await click('[aria-label="关闭任务弹窗"]')
  await run("document.querySelector('[aria-label=\"归档 任务界面测试\"]').closest('li').querySelector('button').click()")
  await click('.tasks-create')
  await assert(`document.querySelector('[aria-label="任务清单"]').dataset.value === ${JSON.stringify(projectId)}`)
  await fill('[aria-label="任务标题"]', '界面创建任务')
  const optionId: string = await run(`window.electronAPI.tasks.fields().then(fields => fields.find(field => field.id === ${JSON.stringify(fieldId)}).options[1].id)`)
  await choose('任务 测试阶段', optionId)
  await click('.tasks-dialog button[type="submit"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-dialog') && document.querySelector('.tasks-list')?.textContent.includes('界面创建任务')")
  // Collection groups remain available only from the sidebar.
  await click('[aria-label="新建分组或清单"]')
  await waitForRenderer(window, "document.querySelector('.tasks-add-list-menu .tasks-item-menu-popover').matches(':popover-open')")
  await click('.tasks-add-list-menu .tasks-item-menu-popover button:first-child')
  await waitForRenderer(window, "!!document.querySelector('.tasks-collection-dialog')")
  await fill('.tasks-collection-form input', '联动空分组')
  await clickPointer('.tasks-collection-form button[type="submit"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-collection-dialog') && [...document.querySelectorAll('.tasks-empty-group-add')].some(button => button.closest('[data-group-id]').textContent.includes('联动空分组'))")
  await assert("!document.querySelector('.tasks-notice')")
  const emptyGroupId: string = await run("window.electronAPI.tasks.groups().then(groups => groups.find(group => group.name === '联动空分组').id)")
  await assert(`!!document.querySelector('[data-group-id="${emptyGroupId}"] .tasks-empty-group-add')`)
  await run("document.querySelector('.tasks-item').scrollIntoView({ block: 'nearest' })")
  await clickPointer('.tasks-item', true)
  await waitForRenderer(window, "document.querySelector('.tasks-composer h2')?.textContent === '编辑任务'")
  await assert(`document.querySelector('[role="combobox"][aria-label="任务分组"]').dataset.value === '${groupId}'`)
  const siblingProjectId: string = await run("window.electronAPI.tasks.projects().then(projects => projects.find(project => project.name === '分组内项目').id)")
  await choose('任务清单', siblingProjectId)
  await choose('任务分组', groupId)
  await assert(`document.querySelector('[aria-label="任务清单"]').dataset.value === '${siblingProjectId}'`)
  await choose('任务分组', emptyGroupId)
  await assert("document.querySelector('[aria-label=\"任务清单\"]').dataset.value === '' && document.querySelector('.tasks-composer button[type=submit]').disabled")
  await fill('[aria-label="新清单名称"]', '联动新清单')
  await clickPointer('.tasks-composer-new-project button')
  await waitForRenderer(window, "!document.querySelector('.tasks-composer-new-project') && !document.querySelector('.tasks-composer button[type=submit]').disabled")
  const linkedProjectId: string = await run("document.querySelector('[aria-label=\"任务清单\"]').dataset.value")
  await assert(`window.electronAPI.tasks.projects().then(projects => projects.some(project => project.id === '${linkedProjectId}' && project.groupId === '${emptyGroupId}'))`)
  await click('.tasks-composer button[type="submit"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-composer')")
  await assert(`window.electronAPI.tasks.list().then(list => list.open.find(task => task.title === '界面创建任务').projectId === '${linkedProjectId}')`)
  await assert("document.querySelector('.tasks-page-heading h1').textContent === '任务界面测试' && document.querySelector('.tasks-notice').textContent.includes('不符合当前视图')")
  await run("document.querySelector('[aria-label=\"归档 联动新清单\"]').closest('li').querySelector('button').click()")
  await waitForRenderer(window, "!!document.querySelector('.tasks-item')")
  await click('.tasks-item')
  await waitForRenderer(window, "!!document.querySelector('.tasks-composer')")
  await choose('任务分组', groupId)
  await choose('任务清单', projectId)
  await click('.tasks-composer button[type="submit"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-composer')")
  await run(`window.electronAPI.tasks.archiveProject('${linkedProjectId}', true).then(() => window.electronAPI.tasks.deleteGroup('${emptyGroupId}'))`)
  await run("document.querySelector('[aria-label=\"归档 任务界面测试\"]').closest('li').querySelector('button').click()")
  await waitForRenderer(window, `document.querySelector('.tasks-page-heading h1')?.textContent === '任务界面测试' && !document.querySelector('[data-group-id="${emptyGroupId}"]')`)
  await run("document.querySelector('.tasks-item').focus(); document.querySelector('.tasks-item').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))")
  await waitForRenderer(window, "!!document.querySelector('.tasks-composer')")
  await click('[aria-label="关闭任务弹窗"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-composer')")
  // Manual task groups are named sections, independent from sidebar groups and automatic grouping.
  await click('.tasks-grouping-menu > summary')
  await chooseGrouping('custom')
  await click('.tasks-page-heading h1')
  await click('.tasks-create-options > summary')
  await click('.tasks-create-options .tasks-item-menu-popover button:last-child')
  await fill('[aria-label="任务分组名称"]', '取消分组')
  await run("document.querySelector('[aria-label=\"任务分组名称\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))")
  await assert("!document.querySelector('.tasks-display-group-form') && !document.querySelector('.tasks-grouped-list').textContent.includes('取消分组')")
  await click('.tasks-create-options > summary')
  await click('.tasks-create-options .tasks-item-menu-popover button:last-child')
  await fill('[aria-label="任务分组名称"]', '手动任务组')
  await click('.tasks-display-group-form button[type=submit]')
  await assert("document.querySelector('.tasks-display-group-form [role=alert]')?.textContent.includes('同名')")
  await fill('[aria-label="任务分组名称"]', '执行中')
  await click('.tasks-display-group-form button[type=submit]')
  await waitForRenderer(window, "!document.querySelector('.tasks-display-group-form')")
  const secondManualGroupId: string = await run("Array.from(document.querySelectorAll('.tasks-content-group')).find(group => group.querySelector('summary').textContent.includes('执行中')).dataset.groupKey")
  await click('.tasks-item')
  await choose('任务展示分组', manualGroupId)
  await click('.tasks-composer button[type=submit]')
  await waitForRenderer(window, `!!document.querySelector('[data-group-key="${manualGroupId}"] .tasks-item')`)
  await captureGrouping('custom-groups-list')
  const manualTaskId: string = await run(`document.querySelector('[data-group-key="${manualGroupId}"] .tasks-item').dataset.taskId`)
  const manualTaskSnapshot: string = await run(`window.electronAPI.tasks.list().then(list => JSON.stringify(list.open.find(task => task.id === '${manualTaskId}')))`)
  await run(`(() => {
    const transfer = new DataTransfer(); transfer.setData('application/x-chouyu-list-task', '${manualTaskId}');
    document.querySelector('[data-group-key="${secondManualGroupId}"]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  })()`)
  await assert(`!!document.querySelector('[data-group-key="${secondManualGroupId}"] .tasks-item') && !document.querySelector('[data-group-key="${manualGroupId}"] .tasks-item')`)
  await assert("!document.querySelector('.tasks-notice')?.textContent.includes('任务已移到')")
  await click('.tasks-tab:nth-child(2)')
  await assert(`!!document.querySelector('[data-column-key="${secondManualGroupId}"] [data-task-id="${manualTaskId}"]')`)
  await run(`(() => {
    const transfer = new DataTransfer(); transfer.setData('text/plain', '${manualTaskId}');
    document.querySelector('[data-column-key="${manualGroupId}"]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  })()`)
  await waitForRenderer(window, `!!document.querySelector('[data-column-key="${manualGroupId}"] [data-task-id="${manualTaskId}"]')`)
  await assert("!document.querySelector('.tasks-notice')?.textContent.includes('任务位置已保存')")
  await assert(`window.electronAPI.tasks.list().then(list => JSON.stringify(list.open.find(task => task.id === '${manualTaskId}')) === ${JSON.stringify(manualTaskSnapshot)})`)
  await click(`[data-column-key="${secondManualGroupId}"] .tasks-column-add`)
  await assert(`document.querySelector('[aria-label="任务展示分组"]').dataset.value === '${secondManualGroupId}'`)
  await fill('[aria-label="任务标题"]', '分组内创建验收')
  await click('.tasks-composer button[type=submit]')
  await waitForRenderer(window, `document.querySelector('[data-column-key="${secondManualGroupId}"]')?.textContent.includes('分组内创建验收')`)
  await captureGrouping('custom-groups-board')
  const groupedCreatedId: string = await run(`document.querySelector('[data-column-key="${secondManualGroupId}"] [data-task-id]').dataset.taskId`)
  await click(`[aria-label="管理任务分组 执行中"]`)
  await click('.tasks-display-group-menu[open] button:first-child')
  await fill('[aria-label="任务分组名称"]', '进行中')
  await click('.tasks-display-group-form button[type=submit]')
  await waitForRenderer(window, "!!document.querySelector('[aria-label=\"管理任务分组 进行中\"]')")
  await click('[aria-label="管理任务分组 进行中"]')
  await click('.tasks-display-group-menu[open] .tasks-item-menu-danger')
  await waitForRenderer(window, "!!document.querySelector('.app-confirm-dialog:modal')")
  await clickPointer('.app-confirm-dialog .app-button-danger')
  await waitForRenderer(window, `!document.querySelector('.app-confirm-dialog:modal') && !!document.querySelector('[data-column-key=""] [data-task-id="${groupedCreatedId}"]')`)
  await assert(`window.electronAPI.tasks.list().then(list => list.open.some(task => task.id === '${groupedCreatedId}'))`)
  await run(`window.electronAPI.tasks.remove('${groupedCreatedId}')`)
  await click('.tasks-tab:first-child')
  await selectView('all')
  await run("document.querySelector('[aria-label=\"归档 任务界面测试\"]').closest('li').querySelector('button').click()")
  await waitForRenderer(window, `!!document.querySelector('[data-group-key="${manualGroupId}"] .tasks-item')`)
  await assert(`JSON.parse(localStorage.getItem('chouyu:task-view-preferences:v1'))['project:${projectId}'].customGroups.some(group => group.id === '${manualGroupId}' && group.taskIds.includes('${manualTaskId}'))`)
  // Display grouping is shared by list and board and restored per view.
  await click('.tasks-grouping-menu > summary')
  await waitForRenderer(window, "document.querySelector('.tasks-grouping-menu .tasks-item-menu-popover').matches(':popover-open')")
  await chooseGrouping('due')
  await click('.tasks-page-heading h1')
  await assert("document.querySelector('[data-group-key=none]')?.textContent.includes('界面创建任务') && document.querySelectorAll('.tasks-content-group').length === 5")
  await selectView('all')
  await run("document.querySelector('[aria-label=\"归档 任务界面测试\"]').closest('li').querySelector('button').click()")
  await waitForRenderer(window, "document.querySelector('.tasks-grouping-menu summary')?.textContent.includes('截止时间') && !!document.querySelector('[data-group-key=none] .tasks-item')")
  await click('.tasks-tab:nth-child(2)')
  await assert("!!document.querySelector('[data-column-key=none] [data-task-id]') && !document.querySelector('.tasks-column-add')")
  const dueGroupedTaskId: string = await run("document.querySelector('[data-column-key=none] [data-task-id]').dataset.taskId")
  await run(`(() => {
    const card = document.querySelector('[data-task-id="${dueGroupedTaskId}"]');
    const target = document.querySelector('[data-column-key=today]');
    const dataTransfer = new DataTransfer(); dataTransfer.setData('text/plain', '${dueGroupedTaskId}');
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
  })()`)
  await assert(`window.electronAPI.tasks.list().then(list => list.open.find(task => task.id === '${dueGroupedTaskId}').dueAt === null)`)
  await click('.tasks-tab:first-child')
  await click('.tasks-grouping-menu > summary')
  await chooseGrouping('field:' + fieldId)
  await assert(`document.querySelector('[data-group-key="${optionId}"]')?.textContent.includes('界面创建任务')`)
  await chooseGrouping('priority')
  await chooseGrouping('none')
  await click('.tasks-page-heading h1')
  // All transient menus dismiss outside / with Escape; structural groups stay open.
  await waitForRenderer(window, "!document.querySelector('.tasks-grouped-list') && document.querySelectorAll('.tasks-item').length === 1")
  const menuSelector = 'details.tasks-tool-menu, details.tasks-project-menu, details.tasks-item-menu'
  const menuCount: number = await run(`document.querySelectorAll(${JSON.stringify(menuSelector)}).length`)
  for (let index = 0; index < menuCount; index++) {
    // Archived-row menus are tested separately after expanding their section.
    if (await run(`!!document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].closest('.tasks-archived:not([open]), .tasks-project-group:not([open])')`)) continue
    await run(`document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].querySelector('summary').scrollIntoView({ block: 'nearest' })`)
    await run("new Promise(resolve => requestAnimationFrame(resolve))")
    const sidebarSize = await run("(() => { const side = document.querySelector('.tasks-sidebar'); return [side.scrollWidth, side.scrollHeight] })()")
    await run(`document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].querySelector(':scope > summary').click()`)
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
    await run(`document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].querySelector(':scope > summary').click()`)
    await waitForRenderer(window, `document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].querySelector('.tasks-item-menu-popover').matches(':popover-open')`)
    await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
    await waitForRenderer(window, `!document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].open && !document.querySelectorAll(${JSON.stringify(menuSelector)})[${index}].querySelector('summary').matches(':focus')`)
  }
  await assert("document.querySelector('.tasks-project-group').open")
  await assert(`(() => {
    const icon = document.querySelector('.tasks-project-group > summary > .tasks-disclosure-icon');
    return icon.getBoundingClientRect().width > 0 && getComputedStyle(icon).width === '16px' && getComputedStyle(icon).transform === 'matrix(0, 1, -1, 0, 0, 0)'
      && icon.querySelector('path').getAttribute('fill') === 'currentColor';
  })()`)
  await click('[aria-label="折叠或展开分组 收集箱"]')
  await assert("getComputedStyle(document.querySelector('.tasks-project-group > summary > .tasks-disclosure-icon')).transform === 'none'")
  await captureGrouping('sidebar-disclosure-collapsed')
  await click('[aria-label="折叠或展开分组 收集箱"]')
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
  await run("document.querySelector('.tasks-create').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))")
  await assert("!document.querySelector('[aria-label=筛选任务]').parentElement.open")
  await waitForRenderer(window, "Boolean(document.querySelector('.tasks-item-menu summary'))")
  await click('.tasks-item-menu summary')
  await click('.tasks-item-menu .tasks-item-menu-popover button:not(.tasks-item-menu-danger)')
  await assert("!document.querySelector('.tasks-item-menu').open")
  await click('[aria-label="关闭任务弹窗"]')
  // Creation inherits the current project and the board column.
  await click('.tasks-tab:nth-child(2)')
  const taskSnapshot = await run("window.electronAPI.tasks.list().then(list => JSON.stringify(list.open))")
  const dragColumn = async (source: string, target: string, after: boolean) => {
    await run(`(() => {
      const from = document.querySelector('[data-column-key="' + ${JSON.stringify(source)} + '"] .tasks-column-drag-handle');
      const to = document.querySelector('[data-column-key="' + ${JSON.stringify(target)} + '"]');
      const dataTransfer = new DataTransfer();
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      const rect = to.getBoundingClientRect();
      const clientX = ${after} ? rect.right - 4 : rect.left + 4;
      to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX }));
      to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX }));
      from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    })()`)
  }
  await dragColumn('high', 'low', true)
  await assert("Array.from(document.querySelectorAll('.tasks-board-column')).map(item => item.dataset.columnKey).join(',') === 'medium,low,high'")
  await assert(`window.electronAPI.tasks.list().then(list => JSON.stringify(list.open) === ${JSON.stringify(taskSnapshot)})`)
  await click('.tasks-tab:first-child')
  await click('.tasks-tab:nth-child(2)')
  await assert("Array.from(document.querySelectorAll('.tasks-board-column')).map(item => item.dataset.columnKey).join(',') === 'medium,low,high'")
  await run("document.querySelector('[data-column-key=high] .tasks-column-drag-handle').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }))")
  await assert("Array.from(document.querySelectorAll('.tasks-board-column')).map(item => item.dataset.columnKey).join(',') === 'medium,high,low'")
  await dragColumn('high', 'medium', false)
  await assert("Array.from(document.querySelectorAll('.tasks-board-column')).map(item => item.dataset.columnKey).join(',') === 'high,medium,low'")
  await run("document.querySelector('.tasks-board').scrollLeft = 0")
  // Preview reorders before drop; cancelling restores the saved order.
  await run("window.__columnSmokeDrag = new DataTransfer(); document.querySelector('[data-column-key=high] .tasks-column-drag-handle').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__columnSmokeDrag }))")
  await run("(() => { const target = document.querySelector('[data-column-key=low]'); const rect = target.getBoundingClientRect(); target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: rect.right - 4, dataTransfer: window.__columnSmokeDrag })) })()")
  await assert("Array.from(document.querySelectorAll('.tasks-board > .tasks-board-column:not(.tasks-drag-preview)')).map(item => item.dataset.columnKey).join(',') === 'medium,low,high'")
  await run("document.querySelector('[data-column-key=high] .tasks-column-drag-handle').dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__columnSmokeDrag })); delete window.__columnSmokeDrag")
  await assert("Array.from(document.querySelectorAll('.tasks-board-column')).map(item => item.dataset.columnKey).join(',') === 'high,medium,low'")


  await click('.tasks-board-column:first-child .tasks-column-add')
  await assert("document.querySelector('.tasks-composer')?.getAttribute('aria-modal') === 'true'")
  await fill('[aria-label="任务标题"]', '看板快速创建')
  await click('.tasks-composer button[type="submit"]')
  await waitForRenderer(window, "document.querySelector('.tasks-board-column:first-child')?.textContent.includes('看板快速创建') && !document.querySelector('.tasks-composer')")
  const quickId: string = await run("window.electronAPI.tasks.list().then(list => list.open.find(task => task.title === '看板快速创建').id)")
  await assert(`window.electronAPI.tasks.list().then(list => list.open.some(task => task.id === ${JSON.stringify(quickId)} && task.priority === 'high' && task.projectId === ${JSON.stringify(projectId)}))`)
  await click('[aria-label="完成 看板快速创建"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-board')?.textContent.includes('看板快速创建')")
  await click('[aria-label="任务完成状态"]')
  await click('[aria-label="任务完成状态"] + div button:nth-child(2)')
  await waitForRenderer(window, "!!document.querySelector('[aria-label=\"恢复 看板快速创建\"]')")
  await assert("document.querySelector('.tasks-page-heading h1').textContent === '任务界面测试'")
  await click('[aria-label="恢复 看板快速创建"]')
  await waitForRenderer(window, "!document.querySelector('[aria-label=\"恢复 看板快速创建\"]')")
  await click('[aria-label="任务完成状态"]')
  await click('[aria-label="任务完成状态"] + div button:first-child')
  await waitForRenderer(window, "!!document.querySelector('[aria-label=\"完成 看板快速创建\"]')")
  await click('[aria-label="在 高优先级 中新建任务"]')
  await assert("document.querySelector('[aria-label=\"任务优先级\"] button[aria-pressed=true]').dataset.priority === 'high'")
  await click('.tasks-date-shortcuts > button:nth-child(2)')
  await assert("(() => { const day = new Date(); day.setDate(day.getDate() + 1); return document.querySelector('[aria-label=\"任务截止日期\"]').value === day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0') })()")
  await click('[aria-label="关闭任务弹窗"]')
  await click('.tasks-tab:first-child')
  await click('[aria-label="任务分组"]')
  await chooseGrouping('priority')
  await click('.tasks-page-heading h1')
  await assert("document.querySelectorAll('.tasks-content-group').length === 3 && document.querySelector('.tasks-content-group').textContent.includes('看板快速创建')")
  await click('.tasks-content-group .tasks-item-body')
  await waitForRenderer(window, "!!document.querySelector('.tasks-composer')")
  await click('[aria-label="关闭任务弹窗"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-composer')")
  await click('[aria-label="任务分组"]')
  await chooseGrouping('none')
  await click('.tasks-page-heading h1')
  await click('[aria-label="筛选任务"]')
  await fill('[aria-label="筛选截止范围"]', 'today')
  await click('.tasks-page-heading h1')
  await waitForRenderer(window, "!document.querySelector('.tasks-list')?.textContent.includes('界面创建任务')")
  await click('[aria-label="筛选任务"]')
  await fill('[aria-label="筛选截止范围"]', 'any')
  await click('.tasks-page-heading h1')
  await click('[aria-label="字段配置"]')
  await click('[role="switch"][aria-label="显示测试阶段"]')
  await click('.tasks-page-heading h1')
  await assert("!document.querySelector('.tasks-list')?.textContent.includes('测试阶段：进行中')")
  await click('[aria-label="字段配置"]')
  await click('[role="switch"][aria-label="显示测试阶段"]')
  await click('.tasks-page-heading h1')
  // Per-project preferences survive navigation; another view keeps its defaults.
  await click('[aria-label="字段配置"]')
  await click('[role="switch"][aria-label="显示截止时间"]')
  await click('.tasks-page-heading h1')
  await click('.tasks-tab:nth-child(2)')
  await selectView('all')
  await assert("!!document.querySelector('.tasks-list') && !document.querySelector('.tasks-main[data-hide-due]')")
  await run("document.querySelector('[aria-label=\"归档 任务界面测试\"]').closest('li').querySelector('button').click()")
  await assert("!!document.querySelector('.tasks-board') && !!document.querySelector('.tasks-main[data-hide-due]')")
  // Drag cards within one column, preview the insertion point, then commit.
  const manualIds: string[] = await run(`Promise.all(['手动排序甲', '手动排序乙'].map(title => window.electronAPI.tasks.create({ title, priority: 'high', projectId: ${JSON.stringify(projectId)} }))).then(tasks => tasks.map(task => task.id))`)
  await selectView('all')
  await run("document.querySelector('[aria-label=\"归档 任务界面测试\"]').closest('li').querySelector('button').click()")
  await waitForRenderer(window, `!!document.querySelector('[data-task-id="${manualIds[1]}"]')`)
  await run(`(() => {
    window.__taskSmokeDrag = new DataTransfer();
    document.querySelector('[data-task-id="${manualIds[1]}"]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__taskSmokeDrag }));
  })()`)
  await run(`(() => {
    const target = document.querySelector('[data-task-id="${manualIds[0]}"]');
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__taskSmokeDrag, clientY: rect.top + 1 }));
  })()`)
  await assert(`document.querySelector('[data-task-id="${manualIds[0]}"]').dataset.cardInsert === 'before'`)
  await run(`document.querySelector('[data-task-id="${manualIds[0]}"]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__taskSmokeDrag })); delete window.__taskSmokeDrag`)
  await waitForRenderer(window, "document.querySelector('[aria-label=排序方式]').textContent.includes('手动排序')")
  await assert(`(() => { const ids = Array.from(document.querySelectorAll('[data-column-key="high"] [data-task-id]')).map(item => item.dataset.taskId); return ids.indexOf('${manualIds[1]}') < ids.indexOf('${manualIds[0]}') })()`)
  await assert(`JSON.parse(localStorage.getItem('chouyu:task-view-preferences:v1'))['project:${projectId}'].taskOrder.indexOf('${manualIds[1]}') < JSON.parse(localStorage.getItem('chouyu:task-view-preferences:v1'))['project:${projectId}'].taskOrder.indexOf('${manualIds[0]}')`)
  // Moving to another column updates the grouping field and the insertion order.
  await run(`window.__taskSmokeDrag = new DataTransfer(); document.querySelector('[data-task-id="${manualIds[1]}"]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__taskSmokeDrag }))`)
  const mediumTarget: string = await run("document.querySelector('[data-column-key=medium] [data-task-id]').dataset.taskId")
  await run(`(() => { const target = document.querySelector('[data-task-id="${mediumTarget}"]'); const rect = target.getBoundingClientRect(); target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientY: rect.top + 1, dataTransfer: window.__taskSmokeDrag })) })()`)
  await run(`document.querySelector('[data-task-id="${mediumTarget}"]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__taskSmokeDrag })); delete window.__taskSmokeDrag`)
  await waitForRenderer(window, `document.querySelector('[data-column-key=medium] [data-task-id]')?.dataset.taskId === '${manualIds[1]}'`)
  await assert(`window.electronAPI.tasks.list().then(list => list.open.find(task => task.id === '${manualIds[1]}').priority === 'medium')`)
  await click('.tasks-tab:first-child')
  await run(`Array.from(document.querySelectorAll('.tasks-item')).find(item => item.textContent.includes('手动排序甲')).querySelector('.tasks-item-menu > summary').click()`)
  await click('.tasks-item-menu[open] .tasks-item-menu-danger')
  await waitForRenderer(window, "!!document.querySelector('.app-confirm-dialog:modal')")
  await assert("document.activeElement.textContent === '取消'")
  await click('.app-confirm-dialog button:first-child')
  await assert(`window.electronAPI.tasks.list().then(list => list.open.some(task => task.id === '${manualIds[0]}'))`)
  await run(`Array.from(document.querySelectorAll('.tasks-item')).find(item => item.textContent.includes('手动排序甲')).querySelector('.tasks-item-menu > summary').click()`)
  await click('.tasks-item-menu[open] .tasks-item-menu-danger')
  await waitForRenderer(window, "!!document.querySelector('.app-confirm-dialog:modal')")
  await click('.app-confirm-dialog .app-button-danger')
  await waitForRenderer(window, "!document.querySelector('.tasks-list').textContent.includes('手动排序甲')")
  await run(`window.electronAPI.tasks.remove('${manualIds[1]}')`)
  await click('[aria-label="字段配置"]')
  await click('[role="switch"][aria-label="显示截止时间"]')
  await click('.tasks-page-heading h1')
  await run(`window.electronAPI.tasks.remove(${JSON.stringify(quickId)})`)
  await run(`(async () => {
    const task = (await window.electronAPI.tasks.list()).open.find(task => task.title === '界面创建任务');
    const start = new Date(); start.setHours(9, 0, 0, 0);
    const due = new Date(); due.setHours(18, 0, 0, 0);
    await window.electronAPI.tasks.update(task.id, { startAt: start.getTime(), dueAt: due.getTime(), note: '核对任务安排，整理本次交付的验收结果。' });
  })()`)
  // Trigger a reload after fixture cleanup.
  await selectView('all')
  await run("document.querySelector('[aria-label=\"归档 任务界面测试\"]').closest('li').querySelector('button').click()")
  await waitForRenderer(window, "!document.querySelector('.tasks-list')?.textContent.includes('看板快速创建')")
  await assert(`(() => {
    const card = Array.from(document.querySelectorAll('.tasks-item')).find(item => item.textContent.includes('界面创建任务'));
    return !document.querySelector('.tasks-list-heading') && card?.querySelector('.tasks-card-schedule')?.textContent.includes('开始')
      && card.querySelector('.tasks-card-schedule').textContent.includes('截止') && card.querySelector('.task-card-project')?.textContent === '任务界面测试'
      && card.textContent.includes('优先级') && card.querySelector('.tasks-item-note')
      && parseFloat(getComputedStyle(card).borderRadius) > 0 && getComputedStyle(card).borderBottomStyle !== 'none';
  })()`)
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
          if (layout === 'list') await run("document.querySelector('.tasks-item')?.scrollIntoView({ block: 'nearest' })")
          await assert("document.querySelector('.tasks-main').scrollWidth <= document.querySelector('.tasks-main').clientWidth + 1")
          await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
          writeFileSync(join(directory, `tasks-${layout}-${mode}-${width}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
          if (layout === 'list') {
            await click('.tasks-create')
            await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
            await assert("document.querySelector('.tasks-composer').scrollWidth <= document.querySelector('.tasks-composer').clientWidth + 1")
            await assert(`(() => {
              const button = document.querySelector('.tasks-composer button[type=submit]');
              const rect = button.getBoundingClientRect();
              return [[rect.left + 8, rect.top + 8], [rect.right - 8, rect.top + 8], [rect.right - 8, rect.bottom - 8]]
                .every(([x, y]) => button.contains(document.elementFromPoint(x, y)));
            })()`)
            await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
            writeFileSync(join(directory, `tasks-composer-${mode}-${width}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
            await click('[role="combobox"][aria-label="任务清单"]')
            await waitForRenderer(window, "!!document.querySelector('.tasks-select-options:popover-open')")
            await assert("getComputedStyle(document.querySelector('.tasks-select-options:popover-open')).backgroundColor === getComputedStyle(document.querySelector('.tasks-composer')).backgroundColor")
            await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
            await assert("!!document.querySelector('.tasks-composer') && !document.querySelector('.tasks-select-options:popover-open')")
            await run("document.querySelector('[aria-label=\"任务标题\"]').focus()")
            await assert("getComputedStyle(document.querySelector('[aria-label=\"任务标题\"]')).outlineStyle === 'none' && getComputedStyle(document.querySelector('[aria-label=\"任务标题\"]')).boxShadow === 'none'")
            await click('.tasks-composer-dates > summary')
            await waitForRenderer(window, "!!document.querySelector('.tasks-date-popover:popover-open')")
            await click('.tasks-calendar-days button:nth-child(15)')
            await assert("!!document.querySelector('.tasks-date-popover:popover-open')")
            await assert("innerWidth <= 640 || document.querySelector('.tasks-date-popover').scrollHeight <= document.querySelector('.tasks-date-popover').clientHeight + 1")
            await click('[role="combobox"][aria-label="任务提醒"]')
            await waitForRenderer(window, "!!document.querySelector('.tasks-select-options:popover-open')")
            await assert("!!document.querySelector('.tasks-date-popover:popover-open')")
            await run("document.querySelector('[aria-label=\"任务提醒\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
            await assert("!!document.querySelector('.tasks-date-popover:popover-open') && !document.querySelector('.tasks-select-options:popover-open')")
            await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
            await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
            writeFileSync(join(directory, `tasks-calendar-${mode}-${width}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
            await assert("Array.from(document.querySelectorAll('.tasks-composer input, .tasks-composer textarea')).every(element => getComputedStyle(element).borderTopWidth === '0px')")

            await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
            await assert("document.querySelector('.tasks-composer').scrollWidth <= document.querySelector('.tasks-composer').clientWidth + 1")
            await click('[aria-label="关闭任务弹窗"]')
          }
        }
      }
    }
    window.webContents.disableDeviceEmulation()
    await run(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
    await click('.tasks-tab:first-child')
  }
  await click('[aria-label="字段配置"]')
  await click('.tasks-fields-toggle')
  await fill('[aria-label="测试阶段 选项 2"]', '处理中')
  await click('.tasks-field-row button[type="submit"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-field-row button[type=submit]').disabled")
  await assert(`window.electronAPI.tasks.list().then(list => list.open.find(task => task.title === '界面创建任务').customFields[${JSON.stringify(fieldId)}] === ${JSON.stringify(optionId)})`)
  await click('[aria-label="关闭字段管理弹窗"]')
  await waitForRenderer(window, "document.querySelector('.tasks-list')?.textContent.includes('处理中')")
  await click('[aria-label="归档 任务界面测试"]')
  await waitForRenderer(window, "!document.querySelector('[aria-label=\"归档 任务界面测试\"]')")
  await assert(`window.electronAPI.tasks.list().then(list => !list.open.some(task => task.projectId === '${projectId}'))`)
  if (!await run("document.querySelector('.tasks-archived').open")) await click('.tasks-archived > summary')
  await run("Array.from(document.querySelectorAll('.tasks-archived .tasks-project-select')).find(button => button.textContent === '任务界面测试').click()")
  await click('.tasks-tabs .tasks-tab:first-child')
  await waitForRenderer(window, "!!document.querySelector('.tasks-title-button')")
  await click('.tasks-title-button')
  await fill('[aria-label="任务标题"]', '归档后仍可编辑')
  await click('.tasks-dialog button[type="submit"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-dialog') && document.querySelector('.tasks-list')?.textContent.includes('归档后仍可编辑')")
  await click('.tasks-tab:nth-child(2)')
  await click('[aria-label="任务分组"]')
  await chooseGrouping('project')
  await click('.tasks-page-heading h1')
  await waitForRenderer(window, "document.querySelector('.tasks-board')?.textContent.includes('任务界面测试（已归档）') && document.querySelector('.tasks-board')?.textContent.includes('归档后仍可编辑')")
  await click('.tasks-tabs .tasks-tab:first-child')
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
  await assert("window.electronAPI.tasks.list({ doneQuery: '最早历史目标' }).then(list => list.matchedDone === 1 && list.done[0].title === '最早历史目标')")
  const unplannedId: string = await run("window.electronAPI.tasks.create({ title: '待规划验收任务' }).then(task => task.id)")
  // Use the same title to verify task identity, not just matching text.
  const dueTodayId: string = await run("window.electronAPI.tasks.create({ title: '待规划验收任务', dueAt: Date.now() }).then(task => task.id)")
  await selectView('today')
  await click('.tasks-tab:first-child')
  await waitForRenderer(window, `!!document.querySelector('.tasks-item[data-task-id="${dueTodayId}"]')`)
  await assert(`!document.querySelector('.tasks-item[data-task-id="${unplannedId}"]')`)
  await selectView('unplanned')
  await click('.tasks-tab:first-child')
  await waitForRenderer(window, `!!document.querySelector('.tasks-item[data-task-id="${unplannedId}"]')`)
  await assert(`!document.querySelector('.tasks-item[data-task-id="${dueTodayId}"]') && document.querySelector('.tasks-item[data-task-id="${unplannedId}"]').textContent.includes('未安排时间')`)
  await run(`window.electronAPI.tasks.remove('${dueTodayId}')`)
  await assert("!document.querySelector('[aria-label=\"归档 默认清单\"]') && !!document.querySelector('[aria-label=\"重命名 默认清单\"]')")
  await run("Array.from(document.querySelectorAll('.tasks-title-button')).find(button => button.textContent === '待规划验收任务').click()")
  await click('.tasks-composer-dates > summary')
  await fill('[aria-label="任务开始日期"]', '2026-10-01')
  await click('.tasks-dialog button[type="submit"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-dialog')")
  await assert(`window.electronAPI.tasks.list().then(list => list.open.find(task => task.id === ${JSON.stringify(unplannedId)}).startAt !== null)`)
  await assert("document.querySelector('.tasks-page-heading h1').textContent === '待规划' && document.querySelector('.tasks-notice').textContent.includes('不符合当前视图')")
  await waitForRenderer(window, "document.querySelector('.tasks-page-heading h1')?.textContent === '待规划' && !document.querySelector('.tasks-list')?.textContent.includes('待规划验收任务')")
  // Group deletion must remain centered and reachable through real pointer input.
  await click('[aria-label="管理分组 工作分组"]')
  await click('.tasks-group-actions .tasks-project-menu[open] .tasks-item-menu-danger')
  await waitForRenderer(window, "!!document.querySelector('.app-confirm-dialog:modal')")
  await assert(`(() => {
    const rect = document.querySelector('.app-confirm-dialog').getBoundingClientRect();
    return Math.abs(rect.x + rect.width / 2 - innerWidth / 2) < 2
      && Math.abs(rect.y + rect.height / 2 - innerHeight / 2) < 2
      && rect.top >= 0 && rect.bottom <= innerHeight;
  })()`)
  await clickPointer('.app-confirm-dialog button:first-child')
  await waitForRenderer(window, "!document.querySelector('.app-confirm-dialog')")
  await assert(`window.electronAPI.tasks.groups().then(groups => groups.some(group => group.id === ${JSON.stringify(groupId)}))`)
  await click('[aria-label="管理分组 工作分组"]')
  await click('.tasks-group-actions .tasks-project-menu[open] .tasks-item-menu-danger')
  await waitForRenderer(window, "!!document.querySelector('.app-confirm-dialog:modal')")
  await assert("document.querySelector('.app-confirm-checkbox input').checked")
  await clickPointer('.app-confirm-checkbox input')
  await clickPointer('.app-confirm-dialog .app-button-danger')
  await waitForRenderer(window, "!document.querySelector('.app-confirm-dialog') && !document.querySelector('[aria-label=\"管理分组 工作分组\"]')")
  await assert(`window.electronAPI.tasks.projects().then(projects => projects.some(project => project.id === ${JSON.stringify(projectId)} && project.groupId !== ${JSON.stringify(groupId)}))`)
  await assert(`window.electronAPI.tasks.list().then(list => list.open.some(task => task.id === ${JSON.stringify(unplannedId)}))`)
  // 不把未完成任务的导航角标带入后续聊天 UI 验收。
  await run(`(async () => {
    const original = new Set(${JSON.stringify(originalIds)});
    const list = await window.electronAPI.tasks.list({ doneLimit: 10000 });
    for (const task of [...list.open, ...list.done]) if (!original.has(task.id)) await window.electronAPI.tasks.remove(task.id);
    await window.electronAPI.tasks.deleteField(${JSON.stringify(fieldId)});
    window.dispatchEvent(new Event('chouyu:tasks-changed'));
  })()`)
  // A renderer restart restores the selected workspace and per-view preferences.
  await run(`window.electronAPI.tasks.archiveProject(${JSON.stringify(projectId)}, false)`)
  window.webContents.reload()
  await waitForRenderer(window, "!!window.electronAPI")
  window.webContents.send('open-chat-panel')
  await waitForRenderer(window, "!!document.querySelector('[data-workspace-nav=tasks]')")
  await click('[data-workspace-nav="tasks"]')
  await waitForRenderer(window, "document.querySelector('.tasks-page-heading h1')?.textContent === '待规划' && !!document.querySelector('[aria-label=\"归档 任务界面测试\"]')")
  await run("document.querySelector('[aria-label=\"归档 任务界面测试\"]').closest('li').querySelector('button').click()")
  await assert("!!document.querySelector('.tasks-list') && document.querySelector('[aria-label=排序方式]').textContent.includes('手动排序')")
  await click('.tasks-grouping-menu > summary')
  await chooseGrouping('custom')
  await click('.tasks-page-heading h1')
  await assert(`!!document.querySelector('[data-group-key="${manualGroupId}"]') && !document.querySelector('[data-group-key="${secondManualGroupId}"]')`)
  // Reorder sidebar groups/projects and display groups through actual drag handlers.
  const orderFixture = await run(`(async () => {
    const a = await window.electronAPI.tasks.createGroup('排序分组甲');
    const b = await window.electronAPI.tasks.createGroup('排序分组乙');
    const p = await window.electronAPI.tasks.createProject('排序清单甲', a.id);
    const q = await window.electronAPI.tasks.createProject('排序清单乙', a.id);
    window.dispatchEvent(new Event('chouyu:tasks-changed'));
    return { a: a.id, b: b.id, p: p.id, q: q.id };
  })()`)
  await waitForRenderer(window, `!!document.querySelector('[data-project-id="${orderFixture.q}"]')`)
  const dragBefore = async (source: string, target: string) => {
    await run(`(() => {
      window.__layoutDrag = new DataTransfer();
      document.querySelector(${JSON.stringify(source)}).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__layoutDrag }));
    })()`)
    await run(`(() => {
      const target = document.querySelector(${JSON.stringify(target)});
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__layoutDrag, clientY: rect.top + 1 }));
    })()`)
    await assert(`document.querySelector(${JSON.stringify(target)}).dataset.orderInsert === 'before'`)
    await run(`(() => {
      const target = document.querySelector(${JSON.stringify(target)});
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__layoutDrag, clientY: target.getBoundingClientRect().top + 1 }));
      delete window.__layoutDrag;
    })()`)
  }
  await dragBefore(`[data-group-id="${orderFixture.b}"] .tasks-project-group > summary`, `[data-group-id="${orderFixture.a}"]`)
  await dragBefore(`[data-project-id="${orderFixture.q}"] .tasks-project-select`, `[data-project-id="${orderFixture.p}"]`)
  const sidebarOrder = `(() => {
    const groups = Array.from(document.querySelectorAll('.tasks-group-shell')).map(item => item.dataset.groupId);
    const projects = Array.from(document.querySelectorAll('[data-group-id="${orderFixture.a}"] [data-project-id]')).map(item => item.dataset.projectId);
    return groups.indexOf('${orderFixture.b}') < groups.indexOf('${orderFixture.a}') && projects.join() === '${orderFixture.q},${orderFixture.p}';
  })()`
  await assert(sidebarOrder)
  await chooseGrouping('priority')
  await dragBefore('[data-group-key="low"] > summary', '[data-group-key="high"] > summary')
  await assert("document.querySelector('.tasks-content-group').dataset.groupKey === 'low'")
  await click('.tasks-tab:nth-child(2)')
  await assert("document.querySelector('.tasks-board-column').dataset.columnKey === 'low'")
  await chooseGrouping('custom')
  await assert("!!document.querySelector('.tasks-board .tasks-display-group-add')")
  await assert(`(() => {
    const menu = document.querySelector('.tasks-board-column-title .tasks-display-group-menu');
    const add = menu.previousElementSibling;
    return add.classList.contains('tasks-column-add') && menu.getBoundingClientRect().left - add.getBoundingClientRect().right <= 8;
  })()`)
  window.webContents.reload()
  await waitForRenderer(window, "!!window.electronAPI")
  window.webContents.send('open-chat-panel')
  await waitForRenderer(window, "!!document.querySelector('[data-workspace-nav=tasks]')")
  await click('[data-workspace-nav="tasks"]')
  await waitForRenderer(window, `!!document.querySelector('[data-project-id="${orderFixture.q}"]')`)
  await assert(sidebarOrder)
  await chooseGrouping('priority')
  await assert("document.querySelector('.tasks-board-column').dataset.columnKey === 'low'")
  const listOrderIds: string[] = await run(`Promise.all(['列表排序甲', '列表排序乙'].map(title => window.electronAPI.tasks.create({ title, priority: 'high', projectId: ${JSON.stringify(projectId)} }))).then(tasks => { window.dispatchEvent(new Event('chouyu:tasks-changed')); return tasks.map(task => task.id) })`)
  await selectView('all')
  await click(`[data-project-id="${projectId}"] .tasks-project-select`)
  await click('.tasks-tab:first-child')
  await waitForRenderer(window, `!!document.querySelector('.tasks-item[data-task-id="${listOrderIds[1]}"]')`)
  const dragTaskBefore = async (id: string, targetId: string) => {
    await run(`(() => {
      window.__listDrag = new DataTransfer();
      document.querySelector('.tasks-item[data-task-id="${id}"]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__listDrag }));
    })()`)
    await run(`(() => {
      const target = document.querySelector('.tasks-item[data-task-id="${targetId}"]');
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__listDrag, clientY: target.getBoundingClientRect().top + 1 }));
    })()`)
    await assert(`document.querySelector('.tasks-item[data-task-id="${targetId}"]').dataset.cardInsert === 'before'`)
    await run(`(() => {
      const target = document.querySelector('.tasks-item[data-task-id="${targetId}"]');
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__listDrag, clientY: target.getBoundingClientRect().top + 1 }));
      delete window.__listDrag;
    })()`)
  }
  const listOrderIs = (ids: string[]) => `Array.from(document.querySelectorAll('.tasks-item')).map(item => item.dataset.taskId).filter(id => ${JSON.stringify(listOrderIds)}.includes(id)).join() === '${ids.join()}'`
  await dragTaskBefore(listOrderIds[1], listOrderIds[0])
  await assert(listOrderIs([listOrderIds[1], listOrderIds[0]]))
  await chooseGrouping('none')
  await dragTaskBefore(listOrderIds[0], listOrderIds[1])
  await assert(listOrderIs(listOrderIds))
  await chooseGrouping('custom')
  await assert("!document.querySelector('.tasks-grouped-list .tasks-display-group-add')")
  await run(`(() => {
    const transfer = new DataTransfer(); transfer.setData('application/x-chouyu-list-task', '${listOrderIds[0]}');
    document.querySelector('[data-group-key="${manualGroupId}"]').parentElement.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  })()`)
  await waitForRenderer(window, `!!document.querySelector('[data-group-key="${manualGroupId}"] [data-task-id="${listOrderIds[0]}"]')`)
  await dragTaskBefore(listOrderIds[1], listOrderIds[0])
  const groupedListOrder = `Array.from(document.querySelectorAll('[data-group-key="${manualGroupId}"] .tasks-item')).map(item => item.dataset.taskId).filter(id => ${JSON.stringify(listOrderIds)}.includes(id)).join() === '${listOrderIds[1]},${listOrderIds[0]}'`
  await assert(groupedListOrder)
  window.webContents.reload()
  await waitForRenderer(window, "!!window.electronAPI")
  window.webContents.send('open-chat-panel')
  await waitForRenderer(window, "!!document.querySelector('[data-workspace-nav=tasks]')")
  await click('[data-workspace-nav="tasks"]')
  await waitForRenderer(window, `!!document.querySelector('.tasks-item[data-task-id="${listOrderIds[1]}"]')`)
  await assert(groupedListOrder)
  await run(`Promise.all(${JSON.stringify(listOrderIds)}.map(id => window.electronAPI.tasks.remove(id))).then(() => window.dispatchEvent(new Event('chouyu:tasks-changed')))`)
  // Both list and board offer direct custom-group renaming.
  await run(`document.querySelector('[data-group-key="${manualGroupId}"] > summary > span').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await waitForRenderer(window, "!!document.querySelector('.tasks-display-group-form')")
  await fill('[aria-label="任务分组名称"]', '双击修改分组')
  await click('.tasks-display-group-form button[type=submit]')
  await assert(`document.querySelector('[data-group-key="${manualGroupId}"] > summary').textContent.includes('双击修改分组')`)
  await click('.tasks-tab:nth-child(2)')
  await run(`document.querySelector('[data-column-key="${manualGroupId}"] .tasks-column-drag-handle > span').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await waitForRenderer(window, "!!document.querySelector('.tasks-display-group-form')")
  await fill('[aria-label="任务分组名称"]', '手动任务组')
  await click('.tasks-display-group-form button[type=submit]')
  await assert(`document.querySelector('[data-column-key="${manualGroupId}"] .tasks-column-drag-handle').textContent.includes('手动任务组')`)
  const deletionIds: string[] = await run(`(async () => {
    const open = await window.electronAPI.tasks.create({ title: '删除清单未完成任务', projectId: '${orderFixture.p}' });
    const done = await window.electronAPI.tasks.create({ title: '删除清单已完成任务', projectId: '${orderFixture.p}' });
    await window.electronAPI.tasks.complete(done.id);
    const archived = await window.electronAPI.tasks.create({ title: '删除分组归档任务', projectId: '${orderFixture.q}' });
    await window.electronAPI.tasks.complete(archived.id);
    await window.electronAPI.tasks.archiveProject('${orderFixture.q}', true);
    return [open.id, done.id, archived.id];
  })()`)
  await click(`[data-project-id="${orderFixture.p}"] .tasks-project-select`)
  await waitForRenderer(window, "document.querySelector('.tasks-page-heading h1').textContent === '排序清单甲' && !!document.querySelector('.tasks-archived')")
  await waitForRenderer(window, "!!document.querySelector('[aria-label=\"管理已归档清单 排序清单乙\"]')")
  await click('.tasks-archived > summary')
  await assert(`(() => {
    const icon = document.querySelector('.tasks-archived > summary > .tasks-disclosure-icon');
    return icon.getBoundingClientRect().width > 0 && getComputedStyle(icon).width === '16px' && getComputedStyle(icon).transform === 'matrix(0, 1, -1, 0, 0, 0)';
  })()`)
  await run("document.querySelector('[aria-label=\"管理已归档清单 排序清单乙\"]').focus()")
  await click('[aria-label="管理已归档清单 排序清单乙"]')
  await waitForRenderer(window, "!!document.querySelector('.tasks-archived .tasks-item-menu-popover:popover-open')")
  await captureGrouping('sidebar-archived-menu')
  await assert(`(() => {
    const row = document.querySelector('[aria-label="管理已归档清单 排序清单乙"]').closest('.tasks-archived-row');
    const name = row.querySelector('.tasks-nav-label').getBoundingClientRect();
    const menu = row.querySelector('.tasks-project-menu > summary').getBoundingClientRect();
    return name.right <= menu.left && menu.right <= row.getBoundingClientRect().right
      && !!row.querySelector('[aria-label="恢复清单 排序清单乙"]') && !!row.querySelector('[aria-label="删除清单 排序清单乙"]');
  })()`)
  await click('.tasks-page-heading h1')
  await click('[aria-label="管理清单 排序清单甲"]')
  await assert("getComputedStyle(document.querySelector('[aria-label=\"移动清单 排序清单甲 到分组\"]')).borderWidth === '0px'")
  await click('[aria-label="删除清单 排序清单甲"]')
  await waitForRenderer(window, "!!document.querySelector('.app-confirm-dialog:modal')")
  await clickPointer('.app-confirm-dialog button:first-child')
  await assert(`window.electronAPI.tasks.projects().then(projects => projects.some(project => project.id === '${orderFixture.p}'))`)
  await click('[aria-label="管理清单 排序清单甲"]')
  await click('[aria-label="删除清单 排序清单甲"]')
  await waitForRenderer(window, "!!document.querySelector('.app-confirm-dialog:modal')")
  await clickPointer('.app-confirm-dialog .app-button-danger')
  await waitForRenderer(window, `!document.querySelector('[data-project-id="${orderFixture.p}"]') && document.querySelector('.tasks-page-heading h1').textContent === '全部'`)
  await assert(`window.electronAPI.tasks.list({ doneLimit: 10000 }).then(list => ![...list.open, ...list.done].some(task => ${JSON.stringify(deletionIds.slice(0, 2))}.includes(task.id)))`)
  await click('[aria-label="管理分组 排序分组甲"]')
  await click('.tasks-group-actions .tasks-project-menu[open] .tasks-item-menu-danger')
  await waitForRenderer(window, "!!document.querySelector('.app-confirm-dialog:modal')")
  await assert("document.querySelector('.app-confirm-checkbox input').checked")
  await clickPointer('.app-confirm-dialog .app-button-danger')
  await waitForRenderer(window, `!document.querySelector('[data-group-id="${orderFixture.a}"]')`)
  await assert(`window.electronAPI.tasks.projects().then(projects => !projects.some(project => project.id === '${orderFixture.q}'))`)
  await assert(`window.electronAPI.tasks.list({ doneLimit: 10000 }).then(list => ![...list.open, ...list.done].some(task => task.id === '${deletionIds[2]}'))`)
  // Preset defaults and real status/date moves use the same rules in both layouts.
  const presetFixture = await run(`(async () => {
    const today = new Date(); today.setHours(0,0,0,0);
    const monday = new Date(today); monday.setDate(monday.getDate() - (monday.getDay()+6)%7);
    const first = new Date(monday); first.setHours(18);
    const second = new Date(monday); second.setDate(second.getDate()+1);
    const start = new Date(monday); start.setHours(9);
    const ongoing = await window.electronAPI.tasks.create({ title: '默认分组执行任务', startAt: today.getTime() });
    const dated = await window.electronAPI.tasks.create({ title: '默认分组单日任务', startAt: start.getTime(), dueAt: first.getTime() });
    const done = await window.electronAPI.tasks.create({ title: '默认分组完成任务' }); await window.electronAPI.tasks.complete(done.id);
    return { ongoing: ongoing.id, dated: dated.id, done: done.id, target: second.getFullYear()+'-'+(second.getMonth()+1)+'-'+second.getDate(), targetDay: second.getDate() };
  })()`)
  const restoreGrouping = async () => {
    await click('.tasks-grouping-menu > summary')
    await run("Array.from(document.querySelectorAll('.tasks-grouping-menu button')).find(button => button.textContent === '恢复推荐分组与排序').click()")
    await waitForRenderer(window, "!document.querySelector('.tasks-grouping-menu').open")
  }
  for (const [view, grouping] of [['today', 'status'], ['week', 'week'], ['unplanned', 'priority'], ['all', 'project'], ['overdue', 'overdue'], ['done', 'completed']]) {
    await selectView(view)
    await restoreGrouping()
    await assert(`document.querySelector('[data-grouping-value="${grouping}"]').getAttribute('aria-pressed') === 'true'`)
  }
  await selectView('today')
  await click('.tasks-tab:first-child')
  await waitForRenderer(window, `!!document.querySelector('[data-group-key="open"] [data-task-id="${presetFixture.ongoing}"]')`)
  await assert(`!!document.querySelector('[data-group-key="done"] [data-task-id="${presetFixture.done}"]') && !document.querySelector('[data-group-key="done"]').open`)
  await click('.tasks-tab:nth-child(2)')
  await captureGrouping('preset-today-status')
  const dropPresetCard = async (id: string, key: string) => {
    await run(`window.__presetDrag = new DataTransfer(); document.querySelector('.tasks-board [data-task-id="${id}"]').dispatchEvent(new DragEvent('dragstart', { bubbles:true, dataTransfer:window.__presetDrag }))`)
    await run(`document.querySelector('[data-column-key="${key}"]').dispatchEvent(new DragEvent('drop', { bubbles:true, cancelable:true, dataTransfer:window.__presetDrag })); delete window.__presetDrag`)
  }
  await dropPresetCard(presetFixture.ongoing, 'done')
  await waitForRenderer(window, `!!document.querySelector('[data-column-key="done"] [data-task-id="${presetFixture.ongoing}"]')`)
  await assert(`window.electronAPI.tasks.list({doneSelection:'today'}).then(list => list.done.some(task => task.id === '${presetFixture.ongoing}' && task.completedAt !== null))`)
  await dropPresetCard(presetFixture.ongoing, 'open')
  await waitForRenderer(window, `!!document.querySelector('[data-column-key="open"] [data-task-id="${presetFixture.ongoing}"]')`)
  await assert(`window.electronAPI.tasks.list().then(list => list.open.some(task => task.id === '${presetFixture.ongoing}' && task.completedAt === null))`)
  await selectView('week')
  await click('.tasks-tab:nth-child(2)')
  await waitForRenderer(window, `!!document.querySelector('.tasks-board [data-task-id="${presetFixture.dated}"]')`)
  await assert(`document.querySelectorAll('.tasks-board-column').length >= 7 && !!document.querySelector('[data-column-key="spanning"] [data-task-id="${presetFixture.ongoing}"]')`)
  await dropPresetCard(presetFixture.dated, presetFixture.target)
  await waitForRenderer(window, `!!document.querySelector('[data-column-key="${presetFixture.target}"] [data-task-id="${presetFixture.dated}"]')`)
  await assert(`window.electronAPI.tasks.list().then(list => { const task = list.open.find(task => task.id === '${presetFixture.dated}'); return new Date(task.dueAt).getDate() === ${presetFixture.targetDay} && new Date(task.dueAt).getHours() === 18 && new Date(task.startAt).getHours() === 9 })`)
  await captureGrouping('preset-week-dates')
  await run(`Promise.all(${JSON.stringify([presetFixture.ongoing, presetFixture.dated, presetFixture.done])}.map(id => window.electronAPI.tasks.remove(id)))`)
  // The iteration's primary paths use the same IPC and controls as a real task workspace.
  await selectView('tomorrow')
  await restoreGrouping()
  await assert("document.querySelector('[data-grouping-value=priority]').getAttribute('aria-pressed') === 'true'")
  await click('.tasks-tabs .tasks-tab:first-child')
  const clickNamed = (name: string) => run(`(() => { const button = Array.from(document.querySelectorAll('.tasks-view button')).find(button => button.textContent.trim() === ${JSON.stringify(name)}); if (!button || button.disabled) throw new Error('Missing button: ' + ${JSON.stringify(name)}); button.click() })()`)
  await click('.tasks-create-options > summary')
  await clickNamed('新建任务')
  await waitForRenderer(window, "!!document.querySelector('.tasks-composer')")
  await fill('[aria-label="任务标题"]', '迭代快速任务')
  await click('.tasks-composer button[type=submit]')
  await waitForRenderer(window, "!!Array.from(document.querySelectorAll('.tasks-title-button')).find(button => button.textContent === '迭代快速任务')")
  const iterationId: string = await run("window.electronAPI.tasks.list().then(list => list.open.find(task => task.title === '迭代快速任务').id)")
  await assert(`window.electronAPI.tasks.get('${iterationId}').then(task => new Date(task.dueAt).toDateString() === new Date(new Date().setDate(new Date().getDate()+1)).toDateString())`)
  await click(`[data-task-id="${iterationId}"] .tasks-quick-edit > summary`)
  await fill(`[aria-label="修改优先级 迭代快速任务"]`, 'high')
  await waitForRenderer(window, `document.querySelector('[data-task-id="${iterationId}"]').dataset.priority === 'high'`)
  await click('.tasks-page-heading h1')
  await click('[aria-label="完成 迭代快速任务"]')
  await waitForRenderer(window, `window.electronAPI.tasks.get('${iterationId}').then(task => task.status === 'done')`)
  await run(`window.dispatchEvent(new CustomEvent('chouyu:task-navigation', { detail: { taskId: '${iterationId}' } }))`)
  await waitForRenderer(window, "document.querySelector('[aria-label=任务标题]')?.value === '迭代快速任务'")
  await fill('[aria-label="新子项名称"]', '验收步骤')
  await clickNamed('添加子项')
  await click('[aria-label="完成子项 验收步骤"]')
  await click('.tasks-composer button[type=submit]')
  await waitForRenderer(window, "!document.querySelector('.tasks-composer')")
  await assert(`window.electronAPI.tasks.get('${iterationId}').then(task => task.checklist.length === 1 && task.checklist[0].done && task.status === 'done')`)
  await run(`window.electronAPI.tasks.remove('${iterationId}')`)
  await click('.tasks-heading-menu > summary')
  await clickNamed('回收站')
  await waitForRenderer(window, "!!document.querySelector('[aria-label=任务回收站]:modal') && !document.querySelector('[aria-label=任务回收站] [role=status]')")
  await run("Array.from(document.querySelectorAll('.tasks-recovery-list li')).find(row => row.querySelector('strong').textContent === '迭代快速任务').querySelector('button').click()")
  await waitForRenderer(window, `window.electronAPI.tasks.get('${iterationId}').then(Boolean)`)
  await waitForRenderer(window, "document.querySelector('[aria-label=关闭任务回收站]')?.disabled === false")
  await click('[aria-label="关闭任务回收站"]')
  await click('.tasks-heading-menu > summary')
  await clickNamed('备份与恢复')
  await waitForRenderer(window, "!!document.querySelector('[aria-label=任务备份与恢复]:modal')")
  await assert("document.querySelector('[aria-label=任务备份与恢复]').textContent.includes('导出完整备份')")
  const backupPath = join(process.env.CHOUYU_SMOKE_USER_DATA!, 'task-iteration-export.json')
  const originalSaveDialog = dialog.showSaveDialog, originalOpenDialog = dialog.showOpenDialog
  try {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: backupPath })) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [backupPath] })) as typeof dialog.showOpenDialog
    await clickNamed('导出完整备份')
    await waitForRenderer(window, "document.querySelector('[aria-label=任务备份与恢复] [role=status]')?.textContent.includes('已保存')")
    const exported = JSON.parse(readFileSync(backupPath, 'utf8')) as TaskBackup
    if (!exported.tables.tasks.some(task => task.id === iterationId && JSON.parse(String(task.checklist))[0]?.done) || !exported.settings.preferences) throw new Error('Task backup omitted data or view settings')
    await run(`window.electronAPI.tasks.update('${iterationId}', { title: '备份之后的改动' })`)
    await clickNamed('选择备份文件')
    await waitForRenderer(window, "!!document.querySelector('.tasks-backup-preview')")
    await clickNamed('恢复这份备份')
    await waitForRenderer(window, "!!document.querySelector('.app-confirm-dialog:modal')")
    const reloaded = new Promise<void>(resolve => window.webContents.once('did-finish-load', () => resolve()))
    await clickPointer('.app-confirm-dialog .app-button-danger', false, false)
    await reloaded
    await waitForRenderer(window, '!!window.electronAPI')
    window.webContents.send('open-chat-panel')
    await waitForRenderer(window, "!!document.querySelector('[data-workspace-nav=tasks]')")
    await click('[data-workspace-nav="tasks"]')
    await waitForRenderer(window, "!!document.querySelector('.tasks-page-heading')")
    await assert(`window.electronAPI.tasks.get('${iterationId}').then(task => task.title === '迭代快速任务' && task.checklist[0].done)`)
  } finally { dialog.showSaveDialog = originalSaveDialog; dialog.showOpenDialog = originalOpenDialog }
  await run(`window.dispatchEvent(new CustomEvent('chouyu:task-navigation', { detail: { draft: { title: '来源转换验收', note: '需要用户确认', source: { kind: 'continuation', id: 'missing-source', label: '已删除接续卡' } } } }))`)
  await waitForRenderer(window, "document.querySelector('[aria-label=任务标题]')?.value === '来源转换验收'")
  await assert("window.electronAPI.tasks.list().then(list => !list.open.some(task => task.title === '来源转换验收'))")
  await click('.tasks-composer button[type=submit]')
  await waitForRenderer(window, "!document.querySelector('.tasks-composer')")
  await selectView('all')
  await click('.tasks-tabs .tasks-tab:first-child')
  await waitForRenderer(window, "!!Array.from(document.querySelectorAll('.tasks-title-button')).find(button => button.textContent === '来源转换验收')")
  const sourceTaskId: string = await run("window.electronAPI.tasks.list().then(list => list.open.find(task => task.title === '来源转换验收').id)")
  await run(`Array.from(document.querySelectorAll('[data-task-id="${sourceTaskId}"] button')).find(button => button.textContent === '回看来源').click()`)
  await waitForRenderer(window, "document.querySelector('[aria-label=任务来源] [role=alert]')?.textContent.includes('任务本身仍然保留')")
  await assert("(() => { const rect = document.querySelector('[aria-label=任务来源]').getBoundingClientRect(); return Math.abs(rect.left + rect.width / 2 - innerWidth / 2) < 2 && Math.abs(rect.top + rect.height / 2 - innerHeight / 2) < 2 })()")
  await captureGrouping('iteration-source-missing')
  await click('[aria-label="关闭任务来源"]')
  await run(`Promise.all(['${iterationId}', '${sourceTaskId}'].map(id => window.electronAPI.tasks.remove(id)))`)
  await run(`(async () => {
    const original = new Set(${JSON.stringify(originalIds)});
    const list = await window.electronAPI.tasks.list({ doneLimit: 10000 });
    for (const task of [...list.open, ...list.done]) if (!original.has(task.id)) await window.electronAPI.tasks.remove(task.id);
    window.dispatchEvent(new Event('chouyu:tasks-changed'));
  })()`)
  await click('[aria-label="关闭面板"]')
  await waitForRenderer(window, "!document.querySelector('.chat-panel')")
  console.log('CHOUYU_TASKS_UI_SMOKE_PASSED menus, confirmations, per-view preference restoration, column preview/cancel, manual card order and cross-column moves, groups, fields and history')
}
