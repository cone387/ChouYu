import type { BrowserWindow } from 'electron'
import { waitForRenderer } from './storage-smoke'

export async function runGlobalSearchSmoke(window: BrowserWindow): Promise<void> {
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const click = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const search = async (scope: string, query: string) => {
    await click('[aria-label="全局搜索"]')
    await waitForRenderer(window, 'document.querySelector(".global-search-heading input")')
    await click(`[data-search-scope="${scope}"]`)
    await run(`(() => { const input = document.querySelector('.global-search-heading input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(query)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await waitForRenderer(window, "document.querySelector('.global-search-result') && document.querySelector('.global-search-results').getAttribute('aria-busy') === 'false'")
  }
  const original = await run('window.electronAPI.db.getConfig()')
  const task = await run("window.electronAPI.tasks.create({ title: '全局检索验收任务', note: '唯一备注命中词' })")
  try {
    await search('task', '唯一备注命中词')
    await click('.global-search-result')
    await waitForRenderer(window, "document.querySelector('.tasks-item-focused')?.textContent.includes('全局检索验收任务')")
    await run(`window.electronAPI.tasks.complete(${JSON.stringify(task.id)})`)
    await search('task', '唯一备注命中词')
    await waitForRenderer(window, "document.querySelector('.global-search-result')?.textContent.includes('已完成')")
    await click('.global-search-result')
    await waitForRenderer(window, "document.querySelector('.tasks-list-done .tasks-item-focused')?.textContent.includes('全局检索验收任务')")

    const contacts = await run('window.electronAPI.characters.list()')
    await search('contact', contacts[0].name)
    await click('.global-search-result')
    await waitForRenderer(window, `document.querySelector('[data-contacts-detail=${JSON.stringify(contacts[0].id)}]')`)
    await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
    await waitForRenderer(window, "!document.querySelector('[data-contacts-detail]')")

    await run("window.electronAPI.db.saveConfig({ searchHotkey: 'Alt+K' })")
    await waitForRenderer(window, "document.querySelector('.workspace-search-trigger kbd')?.textContent === 'Alt+K'")
    await run("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))")
    if (await run("Boolean(document.querySelector('.global-search-dialog'))")) throw new Error('Old search shortcut remained active')
    await run("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', altKey: true, bubbles: true, cancelable: true }))")
    await waitForRenderer(window, "document.querySelector('.global-search-dialog[open]')")
    await click('[aria-label="关闭全局搜索"]')
    await run("window.electronAPI.db.saveConfig({ searchHotkey: '' })")
    await waitForRenderer(window, "!document.querySelector('.workspace-search-trigger kbd')")
    await run("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', altKey: true, bubbles: true, cancelable: true }))")
    if (await run("Boolean(document.querySelector('.global-search-dialog'))")) throw new Error('Disabled search shortcut remained active')
  } finally {
    await run(`window.electronAPI.tasks.remove(${JSON.stringify(task.id)})`)
    await run(`window.electronAPI.db.saveConfig({ searchHotkey: ${JSON.stringify(original.searchHotkey)} })`)
  }
  await click('[data-workspace-nav="chat"]')
}
