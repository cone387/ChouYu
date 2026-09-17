import type { BrowserWindow } from 'electron'
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
  await click('.tasks-create')
  await assert("document.querySelector('[aria-label=\"任务截止日期\"]').value === new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0')")
  await click('[aria-label="关闭任务弹窗"]')
  await run("document.querySelector('[aria-label=\"归档 任务界面测试\"]').closest('li').querySelector('button').click()")
  await click('.tasks-create')
  await assert(`document.querySelector('[aria-label="任务项目"]').value === ${JSON.stringify(projectId)}`)
  await fill('[aria-label="任务标题"]', '界面创建任务')
  const optionId: string = await run(`window.electronAPI.tasks.fields().then(fields => fields.find(field => field.id === ${JSON.stringify(fieldId)}).options[1].id)`)
  await fill('[aria-label="任务 测试阶段"]', optionId)
  await click('.tasks-dialog button[type="submit"]')
  await waitForRenderer(window, "!document.querySelector('.tasks-dialog') && document.querySelector('.tasks-list')?.textContent.includes('界面创建任务')")
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
  await click('.tasks-sidebar > ul li:nth-child(5) button')
  await waitForRenderer(window, "document.querySelectorAll('.tasks-list-done > li').length === 50")
  await run("Array.from(document.querySelectorAll('.tasks-main > button')).find(button => button.textContent.includes('加载更多')).click()")
  await waitForRenderer(window, "document.querySelectorAll('.tasks-list-done > li').length === 55")
  await fill('.tasks-search input', '最早历史目标')
  await waitForRenderer(window, "document.querySelectorAll('.tasks-list-done > li').length === 1 && document.querySelector('.tasks-list-done').textContent.includes('最早历史目标')")
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
  console.log('CHOUYU_TASKS_UI_SMOKE_PASSED context creation, field rename, archive editing/board, history loading/search')
}
