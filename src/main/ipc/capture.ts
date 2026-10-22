import { BrowserWindow, desktopCapturer, screen, dialog, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { type CaptureSourceInfo, filterCaptureSources, getCaptureSourceKind, isScrollCaptureRegion, isValidCaptureSourceId, type ScrollCaptureResult } from '../../shared/capture'
import { captureScrollingRegion } from '../scrolling-capture'
import { recognizeOfflineImage } from '../offline-ocr'
import { ipcMain } from 'electron'
import { registerDomain } from './registration'

export function registerCaptureHandlers(mainWindow: BrowserWindow) {
  return registerDomain(ipcMain, ipc => {  
  
    ipc.handle('take-screenshot', async (_event, hideWindow?: boolean) => {
      const shouldHide = hideWindow !== false
      if (shouldHide) mainWindow.hide()
      await new Promise((r) => setTimeout(r, 200))
      try {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
        const { width, height } = display.size
        const scale = display.scaleFactor || 1
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) }
        })
        if (shouldHide) mainWindow.show()
        const source = sources.find((candidate) => candidate.display_id === String(display.id)) || sources[0]
        if (source) {
          return source.thumbnail.toDataURL()
        }
      } catch {
        if (shouldHide) mainWindow.show()
      }
      return null
    })

    ipc.handle('open-file-dialog', async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
          { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
          { name: '文本', extensions: ['txt', 'md', 'json', 'csv', 'log'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const filePath = result.filePaths[0]
      const ext = path.extname(filePath).toLowerCase()
      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
      const stat = await fs.promises.stat(filePath)
      const maxBytes = imageExts.includes(ext) ? 10 * 1024 * 1024 : 2 * 1024 * 1024
      if (stat.size > maxBytes) {
        await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          message: '文件过大',
          detail: imageExts.includes(ext) ? '图片不能超过 10 MB。' : '文本文件不能超过 2 MB。'
        })
        return null
      }
      if (imageExts.includes(ext)) {
        const data = await fs.promises.readFile(filePath)
        const base64 = data.toString('base64')
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/bmp'
        return { type: 'image', data: `data:${mime};base64,${base64}`, name: path.basename(filePath) }
      }
      const text = await fs.promises.readFile(filePath, 'utf-8')
      return { type: 'text', data: text, name: path.basename(filePath) }
    })

    ipc.handle('get-capture-sources', async (): Promise<CaptureSourceInfo[]> => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['window', 'screen'],
          thumbnailSize: { width: 320, height: 180 },
          fetchWindowIcons: true
        })
        return filterCaptureSources(sources, app.getName())
          .slice(0, 40)
          .map((source) => ({
            id: source.id,
            name: source.name.slice(0, 200),
            kind: getCaptureSourceKind(source.id),
            thumbnail: source.thumbnail.toDataURL(),
            appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.resize({ width: 24, height: 24 }).toDataURL() : undefined
          }))
      } catch (error) {
        console.error('Failed to enumerate capture sources:', error)
        return []
      }
    })

    ipc.handle('capture-source', async (_event, sourceId: unknown, hideWindow?: boolean) => {
      if (!isValidCaptureSourceId(sourceId)) throw new Error('Invalid capture source id')
      const shouldHide = hideWindow !== false
      if (shouldHide) mainWindow.hide()
      await new Promise((resolve) => setTimeout(resolve, 160))
      try {
        const kind = getCaptureSourceKind(sourceId)
        const sources = await desktopCapturer.getSources({
          types: [kind],
          thumbnailSize: { width: 2560, height: 1600 }
        })
        const source = sources.find((candidate) => candidate.id === sourceId)
        if (!source || source.thumbnail.isEmpty()) throw new Error('捕获源已关闭或不可用。')
        return source.thumbnail.toDataURL()
      } finally {
        if (shouldHide && !mainWindow.isDestroyed()) mainWindow.show()
      }
    })

    ipc.handle('capture-scroll-region', async (_event, region: unknown): Promise<ScrollCaptureResult> => {
      if (!isScrollCaptureRegion(region)) throw new Error('Invalid scroll capture region')
      const workArea = screen.getPrimaryDisplay().workAreaSize
      const clamped = {
        x: Math.max(0, Math.min(region.x, Math.max(0, workArea.width - 1))),
        y: Math.max(0, Math.min(region.y, Math.max(0, workArea.height - 1))),
        width: Math.min(region.width, workArea.width),
        height: Math.min(region.height, workArea.height)
      }
      mainWindow.hide()
      await new Promise((resolve) => setTimeout(resolve, 200))
      try {
        return await captureScrollingRegion(clamped, {
          onProgress: (info) => {
            if (!mainWindow.isDestroyed()) mainWindow.webContents.send('scroll-capture:progress', info)
          }
        })
      } finally {
        if (!mainWindow.isDestroyed()) mainWindow.show()
      }
    })
  
    ipc.handle('ocr:offline', (_event, dataUrl: unknown) => recognizeOfflineImage(dataUrl))
  })
}
