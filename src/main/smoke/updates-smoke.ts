import { ipcMain, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppUpdateState } from '../../shared/updates'
import { initAutoUpdater } from '../updater'
import { waitForRenderer } from './storage-smoke'

/** Exercise real preload/React UI with isolated update IPC fixtures; never downloads or quits. */
export async function runUpdatesSmoke(window: BrowserWindow): Promise<void> {
  const run = (source: string) => window.webContents.executeJavaScript(source)
  const click = async (selector: string) => {
    await waitForRenderer(window, `!!document.querySelector(${JSON.stringify(selector)})`)
    await run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  }
  let state: AppUpdateState = { revision: 100, phase: 'checking' }
  let installs = 0, downloads = 0
  const publish = (next: Omit<AppUpdateState, 'revision'>) => {
    state = { ...next, revision: state.revision + 1 }
    window.webContents.send('update:state', state)
  }
  const channels = ['update:get-state', 'check-for-updates', 'update:download', 'update:install']
  for (const channel of channels) ipcMain.removeHandler(channel)
  ipcMain.handle('update:get-state', () => state)
  ipcMain.handle('check-for-updates', () => { publish({ phase: 'upToDate' }); return state })
  ipcMain.handle('update:download', () => { downloads++; publish({ phase: 'downloading', version: '9.9.9', percent: 0 }); return state })
  ipcMain.handle('update:install', () => { installs++; publish({ phase: 'installing', version: '9.9.9' }); return state })
  const phase = (value: string, selector = '.update-status-compact') => waitForRenderer(window, `document.querySelector('${selector}')?.dataset.updatePhase === '${value}'`)
  try {
    window.webContents.send('open-chat-panel')
    await waitForRenderer(window, "!!document.querySelector('.workspace-header')")
    publish({ phase: 'checking' })
    await waitForRenderer(window, "!document.querySelector('.update-status-compact')")
    publish({ phase: 'downloading', version: '9.9.9', percent: 42 })
    await phase('downloading')
    if (!await run("document.querySelector('.update-status-compact button').disabled && document.querySelector('.update-status-compact').textContent.includes('42%')")) throw new Error('Download progress is not visible or allows repeated download')
    publish({ phase: 'error', version: '9.9.9', errorStage: 'download', error: '无法连接更新服务器，请重试' })
    await phase('error')
    await click('.update-status-compact button')
    await phase('downloading')
    if (downloads !== 1) throw new Error('Download retry did not reach IPC exactly once')
    publish({ phase: 'ready', version: '9.9.9' })
    await phase('ready')
    await click('[data-workspace-nav="settings"]')
    await waitForRenderer(window, "[...document.querySelectorAll('[data-settings-nav]')].some(button => button.textContent.includes('关于'))")
    await run("[...document.querySelectorAll('[data-settings-nav]')].find(button => button.textContent.includes('关于')).click()")
    await phase('ready', '.update-status-about')
    if (installs) throw new Error('Update installed without user action')
    const directory = process.env.CHOUYU_SMOKE_ARTIFACTS
    if (directory) fs.mkdirSync(directory, { recursive: true })
    for (const width of [1024, 600, 375]) {
      window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 768 }, scale: 1 })
      await run("document.querySelector('.app-workspace').style.cssText += ';width:100%;height:100%;max-width:100%;left:0;top:0;transform:none'")
      for (const theme of ['light', 'dark']) {
        await run(`document.documentElement.dataset.theme = '${theme}'`)
        await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        const collision = await run(`(() => {
          const update = document.querySelector('.update-status-compact button').getBoundingClientRect();
          const search = document.querySelector('.workspace-search-trigger').getBoundingClientRect();
          return update.left < 0 || update.right > search.left || update.height < 24;
        })()`)
        if (collision) throw new Error(`Update button overlaps search at ${width}px`)
        if (directory) fs.writeFileSync(path.join(directory, `updates-${theme}-${width}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
      }
    }
    window.webContents.disableDeviceEmulation()
    await click('[data-workspace-nav="chat"]')
    for (const mode of ['chat', 'sessions', 'workspace']) {
      await click('[aria-label="窗口模式"]')
      await click(`[data-workspace-mode-option="${mode}"]`)
      await phase('ready')
    }
    const attached = window.webContents.debugger.isAttached()
    if (!attached) window.webContents.debugger.attach('1.3')
    try {
      await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
      await run("document.querySelector('.update-status-compact button').focus()")
      await waitForRenderer(window, "document.activeElement === document.querySelector('.update-status-compact button')")
      await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
      await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await phase('installing')
    } finally {
      await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false })
      if (!attached) window.webContents.debugger.detach()
    }
    if (installs !== 1) throw new Error('Restart action did not reach IPC exactly once')
    console.log('CHOUYU_UPDATES_SMOKE_PASSED quiet checks, progress, retry, late About snapshot, all modes, layouts, explicit restart')
  } finally {
    window.webContents.disableDeviceEmulation()
    for (const channel of channels) ipcMain.removeHandler(channel)
    const service = initAutoUpdater(window)
    ipcMain.handle('update:get-state', () => service.snapshot())
    ipcMain.handle('check-for-updates', async () => { await service.check(); return service.snapshot() })
    ipcMain.handle('update:download', async () => { await service.download(); return service.snapshot() })
    ipcMain.handle('update:install', () => { service.requestInstall(); return service.snapshot() })
  }
}
