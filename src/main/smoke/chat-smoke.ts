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
  })()`).catch(error => { throw new Error(`Could not fill ${selector}: ${String(error)}`) })
}

async function click(window: BrowserWindow, selector: string): Promise<void> {
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button || button.disabled) throw new Error('Missing or disabled control ' + ${JSON.stringify(selector)});
    button.click();
  })()`).catch(error => { throw new Error(`Could not click ${selector}: ${String(error)}`) })
}

async function snapshots(window: BrowserWindow, name: string, focus?: string): Promise<void> {
  const directory = process.env['CHOUYU_SMOKE_ARTIFACTS']
  if (!directory) return
  if (process.env.CHOUYU_SMOKE_SNAPSHOT_FILTER && !name.includes(process.env.CHOUYU_SMOKE_SNAPSHOT_FILTER)) return
  const originalViewport = await window.webContents.executeJavaScript('({ width: innerWidth, height: innerHeight })')
  fs.mkdirSync(directory, { recursive: true })
  for (const theme of ['light', 'dark']) {
    saveConfig({ theme: theme as 'light' | 'dark' })
    window.webContents.send('config:changed', getConfig())
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'`)
    for (const width of [1024, 375]) {
      window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 768 }, scale: 1 })
      await waitForRenderer(window, `innerWidth === ${width}`)
      if (focus) await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(focus)})?.scrollIntoView({block:'center',behavior:'instant'})`)
      await waitForRenderer(window, "Number(getComputedStyle(document.querySelector('.chat-panel')).opacity) > .99")
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 120))')
      const problem = await window.webContents.executeJavaScript(`(() => {
        const panel = document.querySelector('.chat-panel');
        const rect = panel.getBoundingClientRect();
        if (rect.left < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) return 'Panel outside viewport';
        const header = panel.querySelector('.workspace-header');
        const bodyTop = panel.querySelector('.workspace-body').getBoundingClientRect().top;
        if (panel.querySelectorAll('.workspace-header').length !== 1 || header.querySelector('strong, h1, h2')) return 'Window header must be global and title-free';
        for (const label of ['隐藏面板', '关闭面板']) {
          const controls = panel.querySelectorAll('[aria-label="' + label + '"]');
          if (controls.length !== 1 || !header.contains(controls[0])) return 'Duplicate or misplaced window control: ' + label;
          if (controls[0].getBoundingClientRect().bottom > bodyTop) return 'Window controls overlap page content';
        }
        if (panel.querySelector('.workspace-memory .memory-heading')) return 'Memory page repeats the navigation title';
        if (panel.querySelector('.chat-topbar-name, .chat-topbar-status')) return 'Chat repeats the global identity';
        const day = panel.querySelector('.journal-day-panel');
        const feed = panel.querySelector('.journal-mode-bar');
        if (day?.getClientRects().length && feed?.getClientRects().length && day.getBoundingClientRect().bottom > feed.getBoundingClientRect().top + 1) return 'Day overview must precede the activity feed';
        const recordSwitch = panel.querySelector('.journal-recording-switch');
        if (recordSwitch?.getClientRects().length && (recordSwitch.getAttribute('role') !== 'switch' || recordSwitch.getAttribute('aria-checked') !== 'false')) return 'Fixture recording switch must remain off';
        const settingsNav = panel.querySelector('.settings-nav');
        if (rect.width < 700 && settingsNav?.getClientRects().length) {
          const settingsBody = panel.querySelector('.settings-body').getBoundingClientRect();
          if (Math.abs(settingsNav.getBoundingClientRect().width - settingsBody.width) > 1) return 'Narrow settings navigation does not fill its row';
        }
        const search = document.querySelector('.global-search-dialog');
        if (search?.open) {
          const bounds = search.getBoundingClientRect();
          if (bounds.left < rect.left || bounds.right > rect.right + 1 || bounds.bottom > rect.bottom + 1) return 'Search panel outside workspace';
        }
        for (const selector of ['.message-area', '.settings-content', '.message-search', '.memory-workspace-content', '.tool-approval-dialog', '.global-search-dialog', '.global-search-body']) {
          const element = document.querySelector(selector);
          if (element?.getClientRects().length && element.scrollWidth > element.clientWidth + 1) return selector + ' overflows';
        }
        return '';
      })()`)
      if (problem) {
        const geometry = await window.webContents.executeJavaScript("JSON.stringify({viewport:[innerWidth,innerHeight],panel:document.querySelector('.chat-panel').getBoundingClientRect().toJSON(),style:document.querySelector('.chat-panel').getAttribute('style')})")
        fs.writeFileSync(path.join(directory, `${name}-${theme}-${width}-failure.png`), (await window.webContents.capturePage()).toPNG())
        throw new Error(`${name} ${width}: ${problem}; ${geometry}`)
      }
      let captured = false
      for (let attempt = 0; attempt < 6; attempt++) {
        const screenshot = await window.webContents.capturePage({ x: 0, y: 0, width, height: 768 }, { stayHidden: true, stayAwake: true })
        const bitmap = screenshot.toBitmap()
        let opaquePixels = 0
        for (let index = 3; index < bitmap.length; index += 4) if (bitmap[index] > 200) opaquePixels++
        // The first capture can contain stale compositor tiles after hidden-window resizing.
        if (attempt > 0 && opaquePixels > 20_000) {
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
  await waitForRenderer(window, `innerWidth === ${originalViewport.width} && innerHeight === ${originalViewport.height}`)
  // Restore viewport-dependent React state before callers record normal window bounds.
  await window.webContents.executeJavaScript('new Promise(resolve => { window.dispatchEvent(new Event("resize")); requestAnimationFrame(() => requestAnimationFrame(resolve)) })')
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
    const chromeProblem = await window.webContents.executeJavaScript(`(() => {
      const mode = document.querySelector('.workspace-mode-control').getBoundingClientRect();
      const minimize = document.querySelector('[aria-label="隐藏面板"]').getBoundingClientRect();
      if (mode.right > minimize.left + 1 || minimize.left - mode.right > 8) return 'Mode control must sit immediately before minimize';
      if (document.querySelector('.chat-panel-main .chat-topbar')) return 'Redundant chat toolbar remains';
      return '';
    })()`)
    if (chromeProblem) throw new Error(chromeProblem)
    await snapshots(window, 'chat')

    await input(window, '.input-textarea', '窗口模式切换保留草稿')
    // Without screenshot work, this point can still be inside the 200 ms scale(.95) opening animation.
    await waitForRenderer(window, "document.querySelector('.chat-panel').getAnimations().every(animation => animation.playState === 'finished' || animation.playState === 'idle')")
    await window.webContents.executeJavaScript("window.__modeComposer = document.querySelector('.input-textarea'); window.__normalBounds = document.querySelector('.chat-panel').getBoundingClientRect().toJSON()")
    await click(window, '[aria-label="最大化窗口"]')
    await waitForRenderer(window, "document.querySelector('.chat-panel[data-maximized=true]') && Math.abs(document.querySelector('.chat-panel').getBoundingClientRect().width - (innerWidth - 8)) < 1")
    await click(window, '[aria-label="还原窗口"]')
    await waitForRenderer(window, "(() => { const a = window.__normalBounds, b = document.querySelector('.chat-panel').getBoundingClientRect(); return ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < 1) })()")
    for (const mode of ['chat', 'sessions', 'workspace']) {
      await click(window, '[aria-label="窗口模式"]')
      await click(window, '[data-workspace-mode-option="' + mode + '"]')
      await waitForRenderer(window, `document.querySelector('.chat-panel').dataset.windowMode === '${mode}'`)
      const problem = await window.webContents.executeJavaScript(`(() => {
        const panel = document.querySelector('.chat-panel');
        if (!!panel.querySelector('.workspace-nav') !== ('${mode}' === 'workspace')) return 'Incorrect global navigation visibility';
        if (document.querySelector('.input-textarea') !== window.__modeComposer || window.__modeComposer.value !== '窗口模式切换保留草稿') return 'Mode switching lost the draft';
        const sidebar = panel.querySelector('.workspace-sessions');
        if ('${mode}' === 'chat' && sidebar.getClientRects().length) return 'Chat-only mode shows sessions';
        if ('${mode}' === 'sessions' && innerWidth > 700 && !sidebar.getClientRects().length) return 'Two-column mode hides sessions';
        return '';
      })()`)
      if (problem) throw new Error(problem)
      if (mode !== 'workspace') await snapshots(window, 'mode-' + mode)
    }
    await input(window, '.input-textarea', '')
    console.log('CHOUYU_WINDOW_MODES_SMOKE_PASSED maximize/restore geometry, mode navigation and draft preservation')

    const grip = await window.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('.composer-resize-handle').getBoundingClientRect();
      const value = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, height: document.querySelector('.input-textarea').getBoundingClientRect().height, maximum: Number(document.querySelector('.composer-resize-handle').getAttribute('aria-valuemax')) };
      window.__composerGrip = value; return value;
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

    await click(window, '[aria-label="全局搜索"]')
    await input(window, '.global-search-heading input', '海盐拿铁')
    await waitForRenderer(window, "document.querySelector('.global-search-result')?.textContent.includes('海盐拿铁')")
    await click(window, '.global-search-result')
    await waitForRenderer(window, "!document.querySelector('.global-search-dialog') && document.querySelector('.message-bubble mark')?.textContent === '海盐拿铁'")
    await click(window, '[aria-label="关闭对话内搜索"]')
    await click(window, '[aria-label="窗口模式"]')
    await click(window, '[data-workspace-mode-option="workspace"]')
    await snapshots(window, 'workspace-sessions')
    if (await window.webContents.executeJavaScript("Boolean(document.querySelector('.conversation-search'))")) throw new Error('Duplicate sidebar search remains')
    await click(window, '[aria-label="全局搜索"]')
    await waitForRenderer(window, "document.querySelector('.global-search-heading input')?.value === '海盐拿铁'")
    await click(window, '[data-search-scope="session"]')
    await waitForRenderer(window, "document.querySelectorAll('.global-search-result').length === 1 && !document.querySelector('.global-search-range')")
    await snapshots(window, 'unified-search')
    await window.webContents.executeJavaScript("document.querySelector('.global-search-heading input').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))")
    await waitForRenderer(window, "document.activeElement?.classList.contains('global-search-result')")
    await click(window, '.global-search-result')
    await waitForRenderer(window, "document.querySelector('.message-bubble mark')?.textContent === '海盐拿铁'")
    await click(window, '[aria-label="关闭对话内搜索"]')

    await input(window, '.input-textarea', '请继续回复，用于验证阅读位置。')
    await click(window, '[aria-label="发送消息"]')
    await waitForRenderer(window, "document.querySelector('.message-area')?.textContent.includes('开始流式回复')")
    await window.webContents.executeJavaScript("(() => { const el = document.querySelector('.message-area'); el.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, bubbles: true })); el.scrollTop = 0 })()")
    await waitForRenderer(window, "document.querySelector('.message-area').scrollTop === 0")
    // Navigation must preserve live requests, the composer, list state and window geometry.
    await input(window, '.input-textarea', '跨页面切换后保留这份草稿')
    await window.webContents.executeJavaScript(`(() => {
      window.__workspaceComposer = document.querySelector('.input-textarea');
      window.__workspaceBounds = document.querySelector('.chat-panel').getBoundingClientRect().toJSON();
      const buttons = Array.from(document.querySelectorAll('[data-workspace-nav]'));
      buttons[0].focus();
      buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      if (document.activeElement !== buttons[1]) throw new Error('Navigation arrow keys did not move focus');
      if (buttons.length !== 4 || buttons.some(button => button.textContent.trim() || !button.title || !button.getAttribute('aria-label'))) throw new Error('Navigation must have four labelled icon-only controls');
      if (buttons.some(button => !['none', 'normal'].includes(getComputedStyle(button, '::before').content))) throw new Error('Navigation must not have a colored edge marker');
    })()`)
    await click(window, '[data-workspace-nav="memory"]')
    await waitForRenderer(window, "document.querySelector('[data-workspace-page=memory]') && document.querySelector('[aria-label=搜索记忆]')")
    await input(window, '[aria-label="搜索记忆"]', '导航保留筛选')
    await click(window, '[data-workspace-nav="journal"]')
    await waitForRenderer(window, "document.querySelector('[data-workspace-page=journal]') && document.querySelector('.journal-date input')")
    await input(window, '.journal-date input', '2001-01-02')
    await input(window, '.journal-search input', '导航保留活动')
    await waitForRenderer(window, "document.querySelector('.journal-status') && document.querySelector('.journal-status').textContent !== '正在加载' && !document.querySelector('.journal-day-panel')?.textContent.includes('正在读取')")
    await window.webContents.executeJavaScript(`(async () => {
      if (document.querySelector('.workspace-brand-status')) throw new Error('Navigation logo status dot remains');
      const shell = document.querySelector('.journal-shell');
      shell.scrollTop = 0;
      const nav = document.querySelector('.journal-view-nav');
      const before = nav.getBoundingClientRect();
      for (const button of [...nav.querySelectorAll('button'), nav.querySelector('button')]) {
        button.click();
        await new Promise(resolve => setTimeout(resolve, 250));
        const after = nav.getBoundingClientRect();
        if (Math.abs(after.top - before.top) > 1 || Math.abs(after.height - before.height) > 1) throw new Error('Journal tabs moved when selecting ' + button.textContent + JSON.stringify({before: before.toJSON(), after: after.toJSON(), scroll: shell.scrollTop}));
      }
    })()`)
    await snapshots(window, 'workspace-activity')
    await click(window, '[data-workspace-nav="settings"]')
    await waitForRenderer(window, "document.querySelector('[data-workspace-page=settings]') && document.querySelector('.settings-content')")
    await click(window, '[data-workspace-nav="memory"]')
    await waitForRenderer(window, "document.querySelector('[data-workspace-page=memory]') && document.querySelector('[aria-label=搜索记忆]').value === '导航保留筛选'")
    await input(window, '[aria-label="搜索记忆"]', '')
    await click(window, '[data-workspace-nav="journal"]')
    await waitForRenderer(window, "document.querySelector('.journal-date input').value === '2001-01-02' && document.querySelector('.journal-search input').value === '导航保留活动'")
    const now = new Date()
    await input(window, '.journal-date input', `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
    await input(window, '.journal-search input', '')
    await click(window, '[data-workspace-nav="chat"]')
    await waitForRenderer(window, "document.querySelector('[data-workspace-page=chat]') && document.activeElement === window.__workspaceComposer")
    const navigationProblem = await window.webContents.executeJavaScript(`(() => {
      if (document.querySelector('.input-textarea') !== window.__workspaceComposer || window.__workspaceComposer.value !== '跨页面切换后保留这份草稿') return 'Composer was reset';
      const bounds = document.querySelector('.chat-panel').getBoundingClientRect();
      // Screenshots exercise narrow viewports; width may clamp, but never depends on the selected module.
      window.__workspaceReturnBounds = bounds.toJSON();
      if (document.querySelector('.message-area').scrollTop > 2) return 'Reading position was reset';
      return '';
    })()`)
    if (navigationProblem) throw new Error(navigationProblem)
    await click(window, '[data-workspace-nav="memory"]')
    await waitForRenderer(window, "document.querySelector('[data-workspace-page=memory]')")
    const stableBounds = await window.webContents.executeJavaScript(`(() => {
      const before = window.__workspaceReturnBounds, after = document.querySelector('.chat-panel').getBoundingClientRect();
      return ['x', 'y', 'width', 'height'].every(key => Math.abs(before[key] - after[key]) < 1);
    })()`)
    if (!stableBounds) throw new Error('Module navigation changed the workspace bounds')
    // Let the browser dispatch the scroll event before sending the next server chunk.
    await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 100))')
    stream!.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '这段新内容不应该把阅读历史的用户拉到底部。' } }] })}\n\n`)
    stream!.end('data: [DONE]\n\n')
    await waitForRenderer(window, "document.querySelector('.message-jump-latest')")
    await click(window, '[data-workspace-nav="chat"]')
    await waitForRenderer(window, "document.querySelector('[data-workspace-page=chat]')")
    const top = await window.webContents.executeJavaScript("document.querySelector('.message-area').scrollTop")
    if (top > 2) throw new Error(`Streaming moved the reading position: ${top}`)
    await click(window, '.message-jump-latest')
    await waitForRenderer(window, "document.querySelector('.message-area')?.textContent.includes('这段新内容') && !document.querySelector('.message-jump-latest')")
    await input(window, '.input-textarea', '')
    console.log('CHOUYU_WORKSPACE_NAV_SMOKE_PASSED icon-only navigation, stable bounds, drafts, memory filters, activity date/search, background streaming and reading position')

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
      // Native OCR allows 30 seconds; include time for its result to reach the UI.
      await waitForRenderer(window, "document.querySelector('.input-textarea').value.includes('ChouYu offline OCR 2026') && !document.querySelector('.attachment-thumb')", 35_000)
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

    await click(window, '[data-workspace-nav="settings"]')
    await waitForRenderer(window, "Array.from(document.querySelectorAll('[data-settings-nav]')).some(button => button.textContent.includes('能力中心'))")
    await snapshots(window, 'settings')
    await click(window, '[data-workspace-nav="chat"]')

    await click(window, '[data-workspace-nav="memory"]')
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
    await window.webContents.executeJavaScript(`(async () => {
      window.__memoryPaginationIds = [];
      for (let index = 0; index < 55; index++) {
        const item = await window.electronAPI.memory.create({ type: 'fact', content: '分页验收条目 ' + index + ' 唯一', importance: .6, confidence: 1, sensitivity: 'normal' });
        window.__memoryPaginationIds.push(item.id);
      }
    })()`)
    await window.webContents.executeJavaScript("(() => { const select = document.querySelector('[aria-label=记忆状态]'); select.value = 'all'; select.dispatchEvent(new Event('change', { bubbles: true })) })()")
    await input(window, '[aria-label="搜索记忆"]', '分页验收条目')
    await waitForRenderer(window, "document.querySelectorAll('.memory-card').length === 50 && document.querySelector('[aria-label=记忆分页]')?.textContent.includes('1 / 2')")
    await window.webContents.executeJavaScript("window.__firstMemoryPage = [...document.querySelectorAll('.memory-card')].map(card=>card.getAttribute('data-memory-id')); document.querySelector('[aria-label=记忆分页] button:last-child').click()")
    await waitForRenderer(window, "document.querySelectorAll('.memory-card').length === 5 && document.querySelector('[aria-label=记忆分页]')?.textContent.includes('2 / 2')")
    const duplicatePage = await window.webContents.executeJavaScript("[...document.querySelectorAll('.memory-card')].some(card=>window.__firstMemoryPage.includes(card.getAttribute('data-memory-id')))")
    if (duplicatePage) throw new Error('Memory UI pagination repeated records')
    await snapshots(window, 'memory-pagination', '[aria-label="记忆分页"]')
    await input(window, '[aria-label="搜索记忆"]', '分页验收条目 0 唯一')
    await waitForRenderer(window, "document.querySelectorAll('.memory-card').length === 1 && document.querySelector('[aria-label=记忆分页]')?.textContent.includes('1 / 1')")
    await window.webContents.executeJavaScript("(async () => { for (const id of window.__memoryPaginationIds) await window.electronAPI.memory.delete(id) })()")
    await click(window, '[data-workspace-nav="chat"]')

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
    await click(window, '[aria-label="窗口模式"]')
    await click(window, '[data-workspace-mode-option="workspace"]')
    await waitForRenderer(window, "document.querySelector('.workspace-sessions:not([hidden])')")
    await window.webContents.executeJavaScript("document.querySelector('.conversation-item-main').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))")
    await waitForRenderer(window, "!document.querySelector('.chat-panel') || getComputedStyle(document.querySelector('.chat-panel')).display === 'none'")
    console.log('CHOUYU_CHAT_SMOKE_PASSED markdown, full-text search, streaming scroll, settings, memory CRUD, approval keyboard')
  } catch (error) {
    console.error('CHOUYU_CHAT_UI_STATE', await window.webContents.executeJavaScript(`JSON.stringify({
      expectedBounds: window.__normalBounds, actualBounds: document.querySelector('.chat-panel')?.getBoundingClientRect().toJSON(),
      composerGrip: window.__composerGrip, composerNow: document.querySelector('.input-textarea')?.getBoundingClientRect().toJSON(), composerMaximum: document.querySelector('.composer-resize-handle')?.getAttribute('aria-valuemax'),
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
