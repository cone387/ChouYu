import type { BrowserWindow } from 'electron'
import { waitForRenderer } from './storage-smoke'

/** Verify retained pages at paint time, including updates received while hidden. */
export async function runNavigationSmoke(window: BrowserWindow): Promise<void> {
  const throttled = window.webContents.getBackgroundThrottling()
  window.webContents.setBackgroundThrottling(false)
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  const run = (source: string) => window.webContents.executeJavaScript(source)
  const click = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const settle = () => run('new Promise(resolve => setTimeout(resolve, 350))')
  const frames = (expression: string) => run(`new Promise(resolve => {
    const values = [];
    const sample = () => { values.push(${expression}); if (values.length < 12) requestAnimationFrame(sample); else resolve(values) };
    requestAnimationFrame(sample);
  })`)

  await waitForRenderer(window, "document.querySelector('.chat-panel').getAnimations().every(animation => animation.playState === 'finished' || animation.playState === 'idle')")
  await settle()
  await run(`(() => {
    document.querySelector('.composer-resize-handle').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  })()`)
  await settle()
  await run(`(() => {
    const area = document.querySelector('.message-area');
    area.dispatchEvent(new WheelEvent('wheel', { deltaY: -180, bubbles: true }));
    area.scrollTop = Math.max(0, area.scrollTop - 180);
  })()`)
  await settle()
  await frames("document.querySelector('.message-area').scrollTop")
  const chat = await run(`(() => {
    window.__navigationComposer = document.querySelector('.input-textarea');
    const area = document.querySelector('.message-area');
    return { top: area.scrollTop, height: window.__navigationComposer.getBoundingClientRect().height };
  })()`)
  const fixture: string = await run("window.electronAPI.tasks.create({ title: 'Navigation cache fixture', dueAt: Date.now() }).then(task => task.id)")
  try {
    await click('[data-workspace-nav=tasks]')
    await waitForRenderer(window, "!!document.querySelector('[data-view-selection=today]')")
    await click('[data-view-selection=today]')
    await click('.tasks-grouping-menu > summary')
    await run("Array.from(document.querySelectorAll('.tasks-grouping-menu button')).find(button => button.textContent === '恢复推荐分组与排序').click()")
    await click('.tasks-tab:nth-child(2)')
    await waitForRenderer(window, `!!document.querySelector('.tasks-board [data-task-id="${fixture}"]') && !document.querySelector('.tasks-loading-status[data-loading]')`)
    await settle()
    await run("window.__navigationBoard = document.querySelector('.tasks-board')")

    for (let iteration = 0; iteration < 3; iteration++) {
      await click('[data-workspace-nav=chat]')
      const chatFrames = await frames(`(() => {
        const area = document.querySelector('.message-area'), input = document.querySelector('.input-textarea');
        return { top: area.scrollTop, height: input.getBoundingClientRect().height,
          retained: input === window.__navigationComposer,
          animated: [...document.querySelectorAll('.message, .conversation-sidebar')].some(el => el.getAnimations().some(a => a.playState === 'running')) };
      })()`)
      if (chatFrames.some((frame: any) => !frame.retained || frame.animated || Math.abs(frame.top - chat.top) > 1 || Math.abs(frame.height - chat.height) > 1)) {
        throw new Error('Chat navigation changed scroll/composer geometry or replayed entry animation: ' + JSON.stringify({ chat, chatFrames }))
      }
      await click('[data-workspace-nav=tasks]')
      const boardFrames = await frames(`(() => {
        const board = document.querySelector('.tasks-board');
        return { retained: board === window.__navigationBoard,
          loading: !!document.querySelector('.tasks-loading-status[data-loading]'),
          animated: [...board.querySelectorAll('[data-motion-key]')].some(el => el.getAnimations().some(a => a.playState === 'running')) };
      })()`)
      if (boardFrames.some((frame: any) => !frame.retained || frame.loading || frame.animated)) {
        throw new Error('Task navigation refetched unchanged data or replayed layout animation: ' + JSON.stringify(boardFrames))
      }
    }
    await click('[data-workspace-nav=contacts]')
    await run(`window.electronAPI.tasks.update('${fixture}', { title: 'Navigation updated while hidden' })`)
    await click('[data-workspace-nav=tasks]')
    await waitForRenderer(window, `document.querySelector('[data-task-id="${fixture}"]')?.textContent.includes('Navigation updated while hidden') && !document.querySelector('.tasks-loading-status[data-loading]')`)
    await click('[data-workspace-nav=journal]')
    await waitForRenderer(window, "!!document.querySelector('.journal-day-summary')")
    await run("window.__navigationOverview = document.querySelector('.journal-day-panel')")
    await click('.journal-view-nav button:nth-child(10)')
    await waitForRenderer(window, "!!document.querySelector('.journal-semantic textarea')")
    await run(`(() => {
      const input = document.querySelector('.journal-semantic textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Navigation draft');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      window.__navigationSearch = input;
    })()`)
    for (let index = 1; index <= 11; index++) {
      await click('.journal-view-nav button:nth-child(' + index + ')')
      await settle()
    }
    await click('[data-workspace-nav=contacts]')
    await click('[data-workspace-nav=journal]')
    await click('.journal-view-nav button:nth-child(10)')
    await waitForRenderer(window, "document.querySelector('.journal-semantic textarea') === window.__navigationSearch && window.__navigationSearch.value === 'Navigation draft'")
    await click('.journal-view-nav button:first-child')
    await waitForRenderer(window, "document.querySelector('.journal-day-panel') === window.__navigationOverview && !!document.querySelector('.journal-day-summary')")
    for (const page of ['settings', 'memory']) {
      await click('[data-workspace-nav=' + page + ']')
      await settle()
      await click('[data-workspace-nav=contacts]')
      await click('[data-workspace-nav=' + page + ']')
      const animated = await frames("[...document.querySelectorAll('.settings-pane, .memory-view')].some(el => el.getAnimations().some(a => a.playState === 'running'))")
      if (animated.some(Boolean)) throw new Error(page + ' replayed entry animation')
    }
    await click('[data-workspace-nav=settings]')
    for (const [label, selector] of [['操作权限', '.tool-settings-pane'], ['能力中心', '.capability-settings-pane']]) {
      const openTab = () => run(`Array.from(document.querySelectorAll('.settings-nav-item')).find(button => button.textContent.includes(${JSON.stringify(label)})).click()`)
      await openTab()
      await waitForRenderer(window, `!!document.querySelector('${selector}')`)
      await settle()
      await run(`window.__navigationSettingsTab = document.querySelector('${selector}')`)
      await run("Array.from(document.querySelectorAll('.settings-nav-item')).find(button => button.textContent.includes('通用')).click()")
      await openTab()
      await waitForRenderer(window, `document.querySelector('${selector}') === window.__navigationSettingsTab && !!window.__navigationSettingsTab.getClientRects().length`)
    }
    console.log('CHOUYU_NAVIGATION_SMOKE_PASSED retained chat geometry, cached board, journal views/drafts, settings and memory animations')
  } finally {
    await run(`window.electronAPI.tasks.remove('${fixture}')`)
    await click('[data-workspace-nav=chat]')
    await run("document.querySelector('.composer-resize-handle').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))")
    await run("document.querySelector('.message-jump-latest')?.click()")
    window.webContents.setBackgroundThrottling(throttled)
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  }
}
