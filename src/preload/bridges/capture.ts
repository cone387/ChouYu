import type { CaptureSourceInfo, ScrollCaptureRegion, ScrollCaptureResult } from '../../shared/capture'
import type { IpcRenderer } from 'electron'

export function createCaptureBridge(ipcRenderer: IpcRenderer) {

return {
  recognizeOfflineImage: (dataUrl: string) => ipcRenderer.invoke('ocr:offline', dataUrl) as Promise<import('../../shared/ocr').OfflineOcrResult>,

  takeScreenshot: (hideWindow?: boolean) => ipcRenderer.invoke('take-screenshot', hideWindow),

  getCaptureSources: () => ipcRenderer.invoke('get-capture-sources') as Promise<CaptureSourceInfo[]>,

  captureSource: (sourceId: string, hideWindow?: boolean) => ipcRenderer.invoke('capture-source', sourceId, hideWindow) as Promise<string>,

  captureScrollRegion: (region: ScrollCaptureRegion) =>
    ipcRenderer.invoke('capture-scroll-region', region) as Promise<ScrollCaptureResult>,

  onScrollCaptureProgress: (callback: (info: { frames: number }) => void) => {
    const handler = (_event: unknown, info: { frames: number }) => callback(info)
    ipcRenderer.on('scroll-capture:progress', handler)
    return () => { ipcRenderer.removeListener('scroll-capture:progress', handler) }
  },

  openFileDialog: () => ipcRenderer.invoke('open-file-dialog')
}
}
