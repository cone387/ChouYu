import { runGlobalSearchSmoke } from './global-search-smoke'
import { BrowserWindow } from 'electron'
import { createServer } from 'http'
import { flushDatabase, getCharacter, getConfig, listCharacters, saveConfig } from '../database'
import { waitForRenderer } from './storage-smoke'

async function input(window: BrowserWindow, selector: string, value: string): Promise<void> {
  await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing input ' + ${JSON.stringify(selector)});
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : (element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype);
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  })()`).catch(error => { throw new Error(`Could not fill ${selector}: ${String(error)}`) })
}

async function click(window: BrowserWindow, selector: string): Promise<void> {
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button || button.disabled) throw new Error('Missing or disabled control ' + ${JSON.stringify(selector)});
    button.click();
  })()`).catch(error => { throw new Error(`Could not click ${selector}: ${String(error)}`) })
}

/** 通讯录真实 UI：建角色、进会话、按角色模型走 loopback 流、级联删除。 */
export async function runContactsSmoke(window: BrowserWindow): Promise<void> {
  const originalConfig = getConfig()
  let chatBody: Record<string, unknown> | undefined
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      if (request.url?.endsWith('/chat/completions')) {
        const payload = JSON.parse(body || '{}')
        chatBody = payload
        response.setHeader('Content-Type', 'text/event-stream')
        response.write('data: {"choices":[{"delta":{"content":"喵"}}]}\n\n')
        response.write('data: [DONE]\n\n')
      }
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`
  try {
    saveConfig({ provider: 'openai', baseUrl, apiKey: 'smoke-key', model: 'default-model' })

    // 1) 确保面板可见（本冒烟先于 chat-smoke 运行，不能假设它已铺好状态）。
    window.webContents.send('open-chat-panel')
    await waitForRenderer(window, "Boolean(document.querySelector('.chat-panel')) && getComputedStyle(document.querySelector('.chat-panel')).display !== 'none'")

    // 2) 切到工作区展示模式，让全局导航（含通讯录入口）可见。
    await click(window, '[aria-label="窗口模式"]')
    await click(window, '[data-workspace-mode-option="workspace"]')
    await waitForRenderer(window, "document.querySelector('.chat-panel')?.dataset.windowMode === 'workspace'")

    // 3) 通讯录页可达
    await click(window, '[data-workspace-nav="contacts"]')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-contacts-root]'))")

    // 4) 通过表单新建角色
    await click(window, '[data-contacts-new]')
    await input(window, '[data-contacts-name]', '冒烟猫')
    await input(window, '[data-contacts-model]', 'cat-model')
    await input(window, '[data-contacts-soulmd]', '# 冒烟猫人设，仅测试用。')
    await click(window, '[data-contacts-save]')
    await waitForRenderer(window, "!document.querySelector('[data-contacts-form]')")
    const character = listCharacters().find((item) => item.name === '冒烟猫')
    if (!character) throw new Error('Character was not created')

    // 卡片菜单可查看详情和直接编辑，操作期间保持在通讯录。
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contacts-menu="${character.id}"]'))`)
    await click(window, `[data-contacts-menu="${character.id}"]`)
    await click(window, `[data-contacts-menu-detail="${character.id}"]`)
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contacts-detail="${character.id}"]'))
      && document.querySelector('[data-workspace-page]')?.getAttribute('data-workspace-page') === 'contacts'`)
    await click(window, '[data-contacts-close]')
    await click(window, `[data-contacts-menu="${character.id}"]`)
    await click(window, `[data-contacts-menu-edit="${character.id}"]`)
    await waitForRenderer(window, `document.querySelector('[data-contacts-name]')?.value === '冒烟猫'
      && document.querySelector('[data-workspace-page]')?.getAttribute('data-workspace-page') === 'contacts'`)
    await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await waitForRenderer(window, "!document.querySelector('[data-contacts-form]')")

    // 5) 点击角色卡片直接进入会话页，联系人信息条可见（等列表异步刷新渲染出该角色的卡片再点）
    await waitForRenderer(window, `Boolean(document.querySelector('[data-contacts-item="${character.id}"]'))`)
    await click(window, `[data-contacts-item="${character.id}"]`)
    await waitForRenderer(window, `document.querySelector('[data-workspace-page]')?.getAttribute('data-workspace-page') === 'chat'`)
    await waitForRenderer(window, `Boolean(document.querySelector('[data-character-bar="${character.id}"]'))`)
    await waitForRenderer(window, `!document.querySelector('[data-contacts-detail]')`)

    // 在聊天区查看联系人详情，打开、关闭和再次打开都应保留聊天导航。
    for (const closeWithEscape of [false, true]) {
      await click(window, `[data-character-bar="${character.id}"]`)
      await waitForRenderer(window, `Boolean(document.querySelector('.workspace-chat [data-contacts-detail="${character.id}"]'))`)
      const staysInChat = await window.webContents.executeJavaScript(`
        document.querySelector('[data-workspace-page]')?.getAttribute('data-workspace-page') === 'chat'
        && !document.querySelector('.workspace-chat').hidden
        && document.querySelector('.workspace-contacts').hidden
      `)
      if (!staysInChat) throw new Error('Opening contact details changed the chat navigation')
      if (closeWithEscape) {
        await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      } else {
        await click(window, '.workspace-chat [data-contacts-close]')
      }
      await waitForRenderer(window, `!document.querySelector('.workspace-chat .contacts-view-overlay')
        && document.querySelector('[data-workspace-page]')?.getAttribute('data-workspace-page') === 'chat'
        && getComputedStyle(document.querySelector('.chat-panel')).display !== 'none'`)
    }

    // 6) 角色流解析：请求命中 loopback 且使用角色模型
    const streamResult = await window.webContents.executeJavaScript(`window.electronAPI.ai.startStream({
      requestId: 'contacts-smoke-1',
      messages: [{ role: 'user', content: '你好' }],
      systemPrompt: 'prompt-placeholder',
      characterId: ${JSON.stringify(character.id)}
    }).then((result) => JSON.stringify(result))`)
    const parsed = JSON.parse(streamResult) as { ok?: boolean; error?: string }
    if (!parsed.ok) throw new Error(`Character stream failed: ${streamResult}`)
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (!chatBody || chatBody['model'] !== 'cat-model') throw new Error(`Expected character model on loopback, got ${JSON.stringify(chatBody?.['model'])}`)

    // 7) 从卡片菜单删除角色并确认（级联删除其会话）
    await click(window, '[data-workspace-nav="contacts"]')
    await click(window, `[data-contacts-menu="${character.id}"]`)
    await click(window, `[data-contacts-menu-delete="${character.id}"]`)
    await click(window, '[data-contacts-confirm-delete]')
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (getCharacter(character.id)) throw new Error('Character was not deleted')

    // 8) 回到聊天页：chat-smoke 的首个等待依赖 .input-textarea。
    await click(window, '[data-workspace-nav="chat"]')
    await waitForRenderer(window, "Boolean(document.querySelector('.input-textarea'))")

    await runGlobalSearchSmoke(window)
    console.log('CHOUYU_GLOBAL_SEARCH_SMOKE_PASSED contacts, open/done task navigation, changed and disabled shortcuts')

    // 9) 关闭并卸载面板，交还与 chat-smoke 单独运行时相同的起点：
    // 它在主进程直接创建夹具会话，依赖面板挂载时全新加载工作区。
    await click(window, '[aria-label="关闭面板"]')
    await waitForRenderer(window, "!document.querySelector('.chat-panel')")

    console.log('CHOUYU_CONTACTS_SMOKE_PASSED page navigation, character CRUD, per-character stream, cascade delete')
  } finally {
    saveConfig(originalConfig)
    flushDatabase()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
