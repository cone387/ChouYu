import { BrowserWindow, systemPreferences } from 'electron'
import { ActivityHelper } from '../journal/activity-helper'
import { captureJournalWindow, stopJournalCapture } from '../journal/capture'

/** Explicit, permission-dependent acceptance. Capture only this disposable fixture. */
export async function runNativeCaptureSmoke(): Promise<void> {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen')
    console.log(`CHOUYU_CAPTURE_ENV platform=${process.platform} screenPermission=${status}`)
    if (status !== 'granted') throw new Error(`屏幕录制权限未就绪（${status}）。请在系统设置的隐私与安全性中允许当前 Electron/ChouYu 录屏，重启应用后再运行 test:smoke:capture。普通回归不需要此权限。`)
  }
  const fixture = new BrowserWindow({ width: 640, height: 480, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  try {
    await fixture.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body style="background:#6c5ce7;color:white;font:24px sans-serif;padding:40px"><h1>ChouYu capture fixture</h1><p>Synthetic test window only</p></body></html>'))
    fixture.show(); fixture.focus()
    await fixture.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    if (process.platform === 'win32') {
      const helper = new ActivityHelper()
      try {
        const sample = await helper.read()
        if (sample.pid <= 0 || !sample.app.endsWith('.exe') || typeof sample.title !== 'string') throw new Error('Native activity reader returned invalid metadata')
      } finally { helper.stop() }
    }
    const id = fixture.getMediaSourceId().split(':')[1]
    const first = await captureJournalWindow(id)
    if (!first.bytes.length) throw new Error('Native capture returned no image')
    const capturer = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/journal-capture.html'))
    if (!capturer || capturer.isVisible() || !await capturer.webContents.executeJavaScript("document.querySelector('video').srcObject === null")) throw new Error('Capture retained a visible window or media stream')
    if (!(await captureJournalWindow(id)).bytes.length || capturer.isDestroyed()) throw new Error('Repeated capture did not reuse the isolated renderer')
    stopJournalCapture()
    if (!capturer.isDestroyed()) throw new Error('Stopping capture did not release its renderer')
    if (!(await captureJournalWindow(id)).bytes.length) throw new Error('Capture did not resume after stop')
    console.log('CHOUYU_NATIVE_CAPTURE_SMOKE_PASSED target-only, repeated capture, media release and restart')
  } finally { stopJournalCapture(); fixture.destroy() }
}
