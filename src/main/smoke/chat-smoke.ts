import { BrowserWindow, ipcMain } from 'electron'
import { createServer, type ServerResponse } from 'http'
import fs from 'fs'
import path from 'path'
import {
  createChatSession, deleteChatSession, flushDatabase, getActiveSession, getConfig,
  saveConfig, saveSessionMessages, selectChatSession, type Message
} from '../database'
import { waitForRenderer } from './storage-smoke'

async function input(window: BrowserWindow, selector: string, value: string): Promise<void> {
  await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing input ' + ${JSON.stringify(selector)});
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
}

async function click(window: BrowserWindow, selector: string): Promise<void> {
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button || button.disabled) throw new Error('Missing or disabled control ' + ${JSON.stringify(selector)});
    button.click();
  })()`)
}

async function snapshots(window: BrowserWindow, name: string): Promise<void> {
  const directory = process.env['CHOUYU_SMOKE_ARTIFACTS']
  if (!directory) return
  fs.mkdirSync(directory, { recursive: true })
  for (const theme of ['light', 'dark']) {
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'`)
    for (const width of [1024, 375]) {
      window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 768 }, scale: 1 })
      await waitForRenderer(window, `innerWidth === ${width}`)
      await waitForRenderer(window, "Number(getComputedStyle(document.querySelector('.chat-panel')).opacity) > .99")
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const problem = await window.webContents.executeJavaScript(`(() => {
        const panel = document.querySelector('.chat-panel');
        const rect = panel.getBoundingClientRect();
        if (rect.left < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) return 'Panel outside viewport';
        for (const selector of ['.message-area', '.settings-content', '.message-search', '.memory-workspace-content', '.tool-approval-dialog']) {
          const element = document.querySelector(selector);
          if (element && element.scrollWidth > element.clientWidth + 1) return selector + ' overflows';
        }
        return '';
      })()`)
      if (problem) throw new Error(`${name} ${width}: ${problem}`)
      let captured = false
      for (let attempt = 0; attempt < 6; attempt++) {
        const screenshot = await window.webContents.capturePage({ x: 0, y: 0, width, height: 768 }, { stayHidden: true, stayAwake: true })
        const bitmap = screenshot.toBitmap()
        let opaquePixels = 0
        for (let index = 3; index < bitmap.length; index += 4) if (bitmap[index] > 200) opaquePixels++
        if (opaquePixels > 20_000) {
          fs.writeFileSync(path.join(directory, `${name}-${theme}-${width}.png`), screenshot.toPNG())
          captured = true
          break
        }
        await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 100))')
      }
      if (!captured) throw new Error('Captured frame did not contain the visible panel')
    }
  }
  window.webContents.disableDeviceEmulation()
}

/** Real ChatPanel, real IPC and a loopback streaming provider; never touches a real account. */
export async function runChatRuntimeSmoke(window: BrowserWindow): Promise<void> {
  const originalSession = getActiveSession().id
  const originalConfig = getConfig()
  let stream: ServerResponse | undefined
  let providerRequests = 0
  const resolutions: boolean[] = []
  const onResolution = (_event: unknown, id: string, approved: boolean) => { if (id.startsWith('ui-smoke-')) resolutions.push(approved) }
  ipcMain.on('ai:resolve-tool-request', onResolution)
  const server = createServer((request, response) => {
    if (request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'smoke-chat' }] }))
      return
    }
    if (request.url !== '/v1/chat/completions') { response.writeHead(404); response.end(); return }
    providerRequests++
    request.resume()
    request.on('end', () => {
      stream = response
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '开始流式回复。' } }] })}\n\n`)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fake provider did not start')
  const fixture = createChatSession('UI 验收会话').activeSession.id
  try {
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    const reducedMotion = await window.webContents.executeJavaScript("matchMedia('(prefers-reduced-motion: reduce)').matches")
    if (!reducedMotion) throw new Error('Reduced-motion emulation did not apply')
    saveConfig({ provider: 'openai', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'smoke-only', model: 'smoke-chat', memoryEnabled: false, aiToolsEnabled: false, proactiveGreeting: false, proactiveRestReminder: false })
    const messages: Message[] = Array.from({ length: 220 }, (_, index) => ({
      id: `ui-history-${index}`, role: index % 2 ? 'assistant' : 'user', timestamp: Date.now() + index,
      content: index === 16 ? '很久以前记录的唯一关键词：海盐拿铁。' : `历史消息 ${index}\n\n${'用于检查长会话滚动与布局。'.repeat(8)}`
    }))
    messages[219].content = '| 功能 | 状态 |\n| --- | --- |\n| 表格 | 完成 |\n\n~~旧计划~~\n\n- [x] 验证渲染\n\n```typescript\nconst answer = 42;\n```'
    saveSessionMessages(fixture, messages)
    flushDatabase()
    window.webContents.send('config:changed', getConfig())
    await window.webContents.executeJavaScript(`(() => {
      window.__chatOpeningFrames = [];
      window.__watchChatOpening = true;
      const observe = () => {
        const panel = document.querySelector('.chat-panel');
        if (panel && getComputedStyle(panel).display !== 'none') {
          window.__chatOpeningFrames.push({ ready: panel.dataset.ready === 'true', messages: !!panel.querySelector('.message-area'), input: !!panel.querySelector('.input-textarea') });
        }
        if (window.__watchChatOpening) requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    })()`)
    window.webContents.send('open-chat-panel')
    await waitForRenderer(window, "document.querySelector('.chat-panel[data-ready=true]') && document.querySelector('.input-textarea') && document.querySelector('table') && document.querySelector('del')")
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const openingFrames = await window.webContents.executeJavaScript('window.__watchChatOpening = false; window.__chatOpeningFrames')
    if (!openingFrames.length || openingFrames.some((frame: any) => !frame.ready || !frame.messages || !frame.input)) throw new Error('Chat revealed an incomplete opening frame')
    await snapshots(window, 'chat')

    const grip = await window.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('.composer-resize-handle').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, height: document.querySelector('.input-textarea').getBoundingClientRect().height };
    })()`)
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: grip.x, y: grip.y, button: 'left', clickCount: 1 })
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grip.x, y: grip.y - 64, button: 'left', buttons: 1 })
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grip.x, y: grip.y - 64, button: 'left', clickCount: 1 })
    await waitForRenderer(window, `document.querySelector('.input-textarea').getBoundingClientRect().height >= ${grip.height + 60}`)
    await input(window, '.input-textarea', '调整大小后仍保留草稿')
    await waitForRenderer(window, `document.querySelector('.input-textarea').getBoundingClientRect().height >= ${grip.height + 60}`)
    await snapshots(window, 'composer-resized')
    await window.webContents.executeJavaScript("document.querySelector('.composer-resize-handle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
    await input(window, '.input-textarea', '')
    await waitForRenderer(window, "document.querySelector('.input-textarea').getBoundingClientRect().height === 92")

    await window.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))")
    await waitForRenderer(window, "document.activeElement?.getAttribute('aria-label') === '搜索当前对话全文'")
    await input(window, '.message-search input', '海盐拿铁')
    await waitForRenderer(window, "document.querySelector('.message-bubble mark')?.textContent === '海盐拿铁'")
    const count = await window.webContents.executeJavaScript("document.querySelectorAll('.message[data-message-id]').length")
    if (count !== 1) throw new Error('Search did not filter the complete history')
    await snapshots(window, 'chat-search')
    await click(window, '[aria-label="关闭对话内搜索"]')
    await waitForRenderer(window, "document.querySelector('table')")

    await click(window, '[aria-label="显示对话列表"]')
    await input(window, '.conversation-search input', '海盐拿铁')
    await waitForRenderer(window, "document.querySelectorAll('.conversation-item-main').length === 1 && document.querySelector('.conversation-item-preview')?.textContent.includes('海盐拿铁')")
    await click(window, '.conversation-item-main')
    await waitForRenderer(window, "document.querySelector('.message-bubble mark')?.textContent === '海盐拿铁'")
    await click(window, '[aria-label="关闭对话内搜索"]')
    await click(window, '[aria-label="隐藏对话列表"]')

    await input(window, '.input-textarea', '请继续回复，用于验证阅读位置。')
    await click(window, '[aria-label="发送消息"]')
    await waitForRenderer(window, "document.querySelector('.message-area')?.textContent.includes('开始流式回复')")
    await window.webContents.executeJavaScript("(() => { const el = document.querySelector('.message-area'); el.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, bubbles: true })); el.scrollTop = 0 })()")
    await waitForRenderer(window, "document.querySelector('.message-area').scrollTop === 0")
    // Let the browser dispatch the scroll event before sending the next server chunk.
    await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 100))')
    stream!.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '这段新内容不应该把阅读历史的用户拉到底部。' } }] })}\n\n`)
    stream!.end('data: [DONE]\n\n')
    await waitForRenderer(window, "document.querySelector('.message-jump-latest')")
    const top = await window.webContents.executeJavaScript("document.querySelector('.message-area').scrollTop")
    if (top > 2) throw new Error(`Streaming moved the reading position: ${top}`)
    await click(window, '.message-jump-latest')
    await waitForRenderer(window, "document.querySelector('.message-area')?.textContent.includes('这段新内容') && !document.querySelector('.message-jump-latest')")

    const ocrFixture = process.env['CHOUYU_SMOKE_OCR_FIXTURE']
    if (ocrFixture) {
      const beforeOcrRequests = providerRequests
      const data = fs.readFileSync(ocrFixture).toString('base64')
      await input(window, '.input-textarea', '保留草稿：')
      await window.webContents.executeJavaScript(`(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(data)}), c => c.charCodeAt(0))], 'ocr-fixture.png', { type: 'image/png' }));
        document.querySelector('.input-container').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
      })()`)
      await waitForRenderer(window, "document.querySelector('.attachment-thumb')")
      await snapshots(window, 'ocr-attachment')
      await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.attachment-quick-actions button')).find(button => button.textContent === '离线识别首张').click()")
      await waitForRenderer(window, "document.querySelector('.input-textarea').value.includes('ChouYu offline OCR 2026') && !document.querySelector('.attachment-thumb')")
      const draftPreserved = await window.webContents.executeJavaScript("document.querySelector('.input-textarea').value.startsWith('保留草稿：')")
      if (!draftPreserved || providerRequests !== beforeOcrRequests) throw new Error('Offline OCR changed the draft or contacted the provider')
      await snapshots(window, 'ocr-result')
      await input(window, '.input-textarea', '撤销后的草稿')
      await window.webContents.executeJavaScript(`(() => {
        const transfer = new DataTransfer();
        for (const name of ['cancel.png', 'keep.png']) transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(data)}), c => c.charCodeAt(0))], name, { type: 'image/png' }));
        document.querySelector('.input-container').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
      })()`)
      await waitForRenderer(window, "document.querySelectorAll('.attachment-thumb').length === 2")
      await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.attachment-quick-actions button')).find(button => button.textContent === '离线识别首张').click()")
      await waitForRenderer(window, "document.querySelector('.attachment-quick-actions button')?.disabled")
      await click(window, '.attachment-remove')
      await waitForRenderer(window, "document.querySelector('.attachment-quick-actions button')?.disabled === false")
      const canceledDraft = await window.webContents.executeJavaScript("document.querySelector('.input-textarea').value")
      if (canceledDraft !== '撤销后的草稿') throw new Error('Removed image inserted stale OCR text into the draft')
      await click(window, '.attachment-remove')
      await input(window, '.input-textarea', '')
      console.log('CHOUYU_OCR_SMOKE_PASSED local recognition, draft preservation, image removal, no provider request')
    }

    await click(window, '[aria-label="打开设置"]')
    await waitForRenderer(window, "Array.from(document.querySelectorAll('[data-settings-nav]')).some(button => button.textContent.includes('能力中心'))")
    await snapshots(window, 'settings')
    await click(window, '[aria-label="关闭设置"]')

    await click(window, '[aria-label="打开记忆中心"]')
    await waitForRenderer(window, "document.querySelector('.memory-library-view') && document.querySelector('.memory-status-summary')")
    await snapshots(window, 'memory-home')
    await waitForRenderer(window, "document.querySelector('.memory-add-btn')")
    await click(window, '.memory-add-btn')
    await input(window, '[aria-label="新记忆内容"]', '验收记忆：我喜欢无糖咖啡')
    await click(window, '.memory-add-form button')
    await waitForRenderer(window, "document.querySelector('.memory-card')?.textContent.includes('验收记忆')")
    await snapshots(window, 'memory-library')
    await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.memory-card-actions button')).find(button => button.textContent === '编辑').click()")
    await input(window, '[aria-label="编辑记忆"]', '验收记忆：我偏好浅色主题')
    await window.webContents.executeJavaScript("document.querySelector('[aria-label=编辑记忆]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))")
    await waitForRenderer(window, "!document.querySelector('[aria-label=编辑记忆]') && document.querySelector('.memory-card')?.textContent.includes('浅色主题')")
    await input(window, '[aria-label="搜索记忆"]', '浅色主题')
    await waitForRenderer(window, "document.querySelectorAll('.memory-card').length === 1")
    await click(window, '.memory-card-actions .danger')
    await waitForRenderer(window, "document.querySelector('.memory-delete-label')")
    await click(window, '.memory-card-actions .danger.solid')
    await waitForRenderer(window, "!document.querySelector('.memory-card')")
    await click(window, '[aria-label="返回聊天"]')

    await window.webContents.executeJavaScript("document.querySelector('.input-textarea').focus()")
    const approval = { requestId: 'ui-smoke-request', approvalId: 'ui-smoke-deny', callId: 'ui-smoke-call', name: 'smoke_only', displayName: '验证工具授权', description: '仅验证授权界面，不执行真实工具。', risk: 'write', arguments: { text: '合成验收内容' } }
    window.webContents.send('ai:tool-approval-request', approval)
    await waitForRenderer(window, "document.activeElement?.textContent === '拒绝'")
    const animationDuration = await window.webContents.executeJavaScript("parseFloat(getComputedStyle(document.querySelector('.tool-approval-dialog')).animationDuration)")
    if (animationDuration > 0.001) throw new Error('Tool approval ignores reduced-motion preference')
    await snapshots(window, 'tool-approval')
    await window.webContents.executeJavaScript("document.querySelector('.tool-approval-actions .secondary').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))")
    await waitForRenderer(window, "document.activeElement?.textContent === '允许本次操作'")
    await window.webContents.executeJavaScript("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))")
    await waitForRenderer(window, "document.activeElement?.textContent === '拒绝'")
    await window.webContents.executeJavaScript("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))")
    await waitForRenderer(window, "!document.querySelector('.tool-approval-dialog') && document.activeElement?.classList.contains('input-textarea')")
    window.webContents.send('ai:tool-approval-request', { ...approval, approvalId: 'ui-smoke-allow' })
    await waitForRenderer(window, "document.querySelector('.tool-approval-dialog')")
    await click(window, '.tool-approval-actions .primary')
    await waitForRenderer(window, "!document.querySelector('.tool-approval-dialog')")
    if (JSON.stringify(resolutions) !== '[false,true]') throw new Error('Tool approval choices were not delivered correctly')
    await click(window, '[aria-label="显示对话列表"]')
    await waitForRenderer(window, "document.querySelector('[aria-label=隐藏对话列表]')")
    await window.webContents.executeJavaScript("document.querySelector('.conversation-search input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))")
    await waitForRenderer(window, "!document.querySelector('.chat-panel') || getComputedStyle(document.querySelector('.chat-panel')).display === 'none'")
    console.log('CHOUYU_CHAT_SMOKE_PASSED markdown, full-text search, streaming scroll, settings, memory CRUD, approval keyboard')
  } catch (error) {
    console.error('CHOUYU_CHAT_UI_STATE', await window.webContents.executeJavaScript(`JSON.stringify({
      text: document.body.innerText.slice(-1800),
      inputs: document.querySelectorAll('textarea').length,
      scroll: (() => { const el = document.querySelector('.message-area'); return el && [el.scrollTop, el.scrollHeight, el.clientHeight] })(),
      messages: Array.from(document.querySelectorAll('[data-message-id]')).map(el => el.dataset.messageId)
    })`))
    throw error
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach()
    ipcMain.removeListener('ai:resolve-tool-request', onResolution)
    stream?.end()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    selectChatSession(originalSession)
    deleteChatSession(fixture)
    saveConfig(originalConfig)
    flushDatabase()
  }
}
