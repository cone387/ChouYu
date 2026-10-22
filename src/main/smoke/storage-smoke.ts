import { app, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { getStorageStatus, setState } from '../database'

export async function waitForRenderer(window: BrowserWindow, condition: string, timeoutMs = 5000): Promise<void> {
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + ${timeoutMs};
    const check = async () => {
      try {
      if (await (${condition})) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('Storage UI timed out: ' + ${JSON.stringify(condition)} + (window.__taskMenuTrace ? '\\nMenu trace: ' + JSON.stringify(window.__taskMenuTrace) : '')));
      setTimeout(check, 25);
      } catch (error) { reject(error); }
    };
    check();
  })`)
}

/** Exercise the actual disk failure -> IPC event -> visible retry -> successful commit path. */
export async function runStorageRuntimeSmoke(window: BrowserWindow): Promise<void> {
  const filename = path.join(app.getPath('userData'), 'chouyu-application.db')
  const database = new Database(filename)
  database.exec("CREATE TRIGGER storage_smoke_failure BEFORE INSERT ON state BEGIN SELECT RAISE(ABORT,'disk full'); END")
  try {
    try { setState('storage-smoke-retry', 'pending') } catch { /* expected disk failure */ }
    if (!getStorageStatus().error) throw new Error('Storage failure was not reported')
    await waitForRenderer(window, "document.querySelector('.storage-notice')?.textContent.includes('重试保存')")
    const directory = process.env['CHOUYU_SMOKE_ARTIFACTS']
    if (directory) {
      fs.mkdirSync(directory, { recursive: true })
      for (const theme of ['light', 'dark']) {
        await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'`)
        for (const width of [1024, 375]) {
          window.webContents.enableDeviceEmulation({
            screenPosition: 'desktop', screenSize: { width, height: 768 },
            viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1,
            viewSize: { width, height: 768 }, scale: 1
          })
          await waitForRenderer(window, `innerWidth === ${width}`)
          await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          const overflow = await window.webContents.executeJavaScript(`(() => {
            const notice = document.querySelector('.storage-notice');
            const rect = notice.getBoundingClientRect();
            return rect.left < 0 || rect.right > innerWidth || notice.scrollWidth > notice.clientWidth;
          })()`)
          if (overflow) throw new Error('Storage notice overflows viewport')
          fs.writeFileSync(path.join(directory, `storage-${theme}-${width}.png`), (await window.webContents.capturePage({ x: 0, y: 0, width, height: 768 }, { stayHidden: true, stayAwake: true })).toPNG())
        }
      }
      window.webContents.disableDeviceEmulation()
    }
  } finally {
    database.exec('DROP TRIGGER storage_smoke_failure')
    database.close()
  }
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.storage-notice button')).find(button => button.textContent === '重试保存').click()`)
  await waitForRenderer(window, "!document.querySelector('.storage-notice')")
  const reader = new Database(filename, { readonly: true })
  try {
    const persisted = reader.prepare("SELECT value FROM state WHERE key='storage-smoke-retry'").get() as { value: string } | undefined
    if (getStorageStatus().error || persisted?.value !== 'pending') throw new Error('Storage UI retry did not commit the pending state')
  } finally { reader.close() }
}
