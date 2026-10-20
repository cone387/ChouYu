import type { BrowserWindow } from 'electron'
import { waitForRenderer } from './storage-smoke'

/** Real Chromium thumb input exercises measurement changes during a held drag. */
export async function runChatScrollSmoke(window: BrowserWindow): Promise<void> {
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const settle = () => run('new Promise(resolve => setTimeout(resolve, 200))')
  const wasMaximized = await run(`document.querySelector('.chat-panel').dataset.maximized === 'true'`)
  await run(`document.querySelector('[aria-label="最大化窗口"]')?.click()`)
  await settle()
  await run(`(() => {
    window.__scrollProbe = { pointerDown: 0, mouseDown: 0, samples: [] };
    const area = document.querySelector('.message-area');
    area.addEventListener('pointerdown', e => { window.__scrollProbe.pointerDown++; window.__scrollProbe.pointer = { x: e.clientX, y: e.clientY, target: e.target.className }; });
    area.addEventListener('mousedown', () => window.__scrollProbe.mouseDown++);
    area.addEventListener('scroll', () => window.__scrollProbe.samples.push({ top: area.scrollTop, max: area.scrollHeight - area.clientHeight }));
  })()`)
  await waitForRenderer(window, `(() => { const a = document.querySelector('.message-area'); return a.scrollHeight - a.clientHeight - a.scrollTop < 3 })()`)
  const geometry = await run(`(() => {
    const a = document.querySelector('.message-area'), r = a.getBoundingClientRect();
    return { x: r.right - 3, y: r.bottom - 12, target: r.top + r.height * .5, top: a.scrollTop, max: a.scrollHeight - a.clientHeight, width: a.clientWidth, outerWidth: a.offsetWidth, zoom: devicePixelRatio };
  })()`)
  const mouse = (type: string, y: number, buttons: number) => window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type, x: geometry.x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1
  })
  await mouse('mouseMoved', geometry.y, 0)
  await settle()
  await mouse('mousePressed', geometry.y, 1)
  try {
    for (let step = 1; step <= 8; step++) {
      await mouse('mouseMoved', geometry.y + (geometry.target - geometry.y) * step / 8, 1)
      await settle()
    }
  } finally {
    await mouse('mouseReleased', geometry.target, 0)
  }
  await settle()
  const after = await run(`(() => {
    const a = document.querySelector('.message-area');
    return { top: a.scrollTop, max: a.scrollHeight - a.clientHeight, ...window.__scrollProbe };
  })()`)
  console.log('CHOUYU_SCROLL_DRAG_PROBE', JSON.stringify({ before: geometry, after }))
  if (after.max - after.top < 100 || after.samples.length < 2) throw new Error('Native scrollbar drag did not retain the requested history position')
  if (after.samples.some((sample: { top: number }, index: number) => index > 0 && sample.top > after.samples[index - 1].top + 2)) {
    throw new Error('Upward native scrollbar drag jumped back down during row measurements')
  }
  if (await run(`document.querySelector('.message-list').style.height !== ''`)) throw new Error('Scrollbar release left the list height frozen')
  // A content resize must not turn a manual scrollbar drag back into live-follow.
  await run(`document.querySelector('.message-list').style.paddingBottom = '120px'`)
  await settle()
  const resized = await run(`(() => { const a = document.querySelector('.message-area'); return { top: a.scrollTop, max: a.scrollHeight - a.clientHeight } })()`)
  if (Math.abs(resized.top - after.top) > 2) throw new Error('Content resize overrode manual scrollbar position: ' + JSON.stringify({ after: after.top, resized }))
  await run(`document.querySelector('.message-list').style.paddingBottom = ''`)
  await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: geometry.x - 100, y: geometry.target, deltaX: 0, deltaY: 100_000
  })
  await waitForRenderer(window, `(() => { const a = document.querySelector('.message-area'); return a.scrollHeight - a.clientHeight - a.scrollTop < 3 })()`)
  await settle()
  await run(`document.querySelector('.message-list').style.paddingBottom = '120px'`)
  await waitForRenderer(window, `(() => { const a = document.querySelector('.message-area'); return a.scrollHeight - a.clientHeight - a.scrollTop < 3 })()`)
  await run(`document.querySelector('.message-list').style.paddingBottom = ''`)
  await settle()
  if (!wasMaximized) {
    await run(`document.querySelector('[aria-label="还原窗口"]').click()`)
    await settle()
  }
  console.log('CHOUYU_CHAT_SCROLL_SMOKE_PASSED native scrollbar direction, release, detached reading and resumed live-follow')
}
