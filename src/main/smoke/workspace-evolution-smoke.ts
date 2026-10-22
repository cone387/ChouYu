import { ipcMain, type BrowserWindow } from 'electron'
import { getActiveSession, getSessions, selectChatSession, getAssistantUnreadCount, getAssistantUnreadPreview } from '../database'
import { setTrayUnread } from '../tray'
import { waitForRenderer } from './storage-smoke'

/** Delay a real IPC response, then exercise the retained renderer and its Escape handling. */
export async function runWorkspaceEvolutionSmoke(window: BrowserWindow): Promise<void> {
  const run = (source: string) => window.webContents.executeJavaScript(source)
  const origin = getActiveSession().id
  const alternate = getSessions().find(session => session.id !== origin)
  if (!alternate) throw new Error('Missing persisted alternate conversation')
  let release: (() => void) | undefined
  let received = false
  const select = (_event: unknown, id: string) => {
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid session id')
    const workspace = selectChatSession(id)
    const count = getAssistantUnreadCount()
    setTrayUnread(count, getAssistantUnreadPreview())
    window.webContents.send('assistant-unread-changed', count)
    return workspace
  }
  ipcMain.removeHandler('db:select-session')
  ipcMain.handle('db:select-session', (event, id) => {
    const workspace = select(event, id)
    received = true
    return new Promise(resolve => { release = () => resolve(workspace) })
  })
  try {
    await run(`(() => {
      const input = document.querySelector('.input-textarea');
      window.__evolutionComposer = input;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '工作区保留草稿');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const card = [...document.querySelectorAll('.conversation-item-main[aria-selected=false]')].find(button => button.title === ${JSON.stringify(alternate.title)});
      if (!card) throw new Error('Missing alternate conversation');
      card.click();
    })()`)
    const deadline = Date.now() + 10000
    while (!received && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    if (!received) throw new Error('Session selection did not reach IPC')
    await run("document.querySelector('[data-workspace-nav=tasks]').click()")
    await waitForRenderer(window, "document.querySelector('.app-workspace').dataset.workspacePage === 'tasks'")
    release!()
    await waitForRenderer(window, "!document.querySelector('.conversation-item-main[aria-busy=true]')")
    const retained = await run(`document.querySelector('.app-workspace').dataset.workspacePage === 'tasks'
      && document.querySelector('.input-textarea') === window.__evolutionComposer
      && window.__evolutionComposer.value === '工作区保留草稿'`)
    if (!retained) throw new Error('Late session response changed navigation or discarded the composer')
    await run("document.querySelector('[data-workspace-nav=chat]').click(); document.querySelector('.workspace-search-trigger').click()")
    await waitForRenderer(window, "!!document.querySelector('dialog[open]')")
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await waitForRenderer(window, "!document.querySelector('dialog[open]') && getComputedStyle(document.querySelector('.app-workspace')).display !== 'none'")
    console.log('CHOUYU_WORKSPACE_EVOLUTION_SMOKE_PASSED late IPC response, retained composer, topmost Escape')
  } finally {
    release?.()
    ipcMain.removeHandler('db:select-session')
    ipcMain.handle('db:select-session', select)
    selectChatSession(origin)
  }
}
