import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ sources: vi.fn(), windows: [] as any[], permission: {} as any, execute: vi.fn() }))
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/test' },
  desktopCapturer: { getSources: mock.sources },
  session: { fromPartition: () => ({
    setPermissionCheckHandler: (handler: any) => { mock.permission.check = handler },
    setPermissionRequestHandler: (handler: any) => { mock.permission.request = handler },
    setDisplayMediaRequestHandler: (handler: any) => { mock.permission.display = handler }
  }) },
  BrowserWindow: class {
    destroyed = false
    webContents = { mainFrame: {}, setWindowOpenHandler: vi.fn(), on: vi.fn(), executeJavaScript: mock.execute }
    constructor(public options: any) { mock.windows.push(this) }
    loadFile = vi.fn(async () => {})
    isDestroyed = () => this.destroyed
    destroy = () => { this.destroyed = true }
  }
}))
import { captureJournalWindow, stopJournalCapture } from './capture'

describe('single-window journal capture', () => {
  beforeEach(() => {
    vi.useFakeTimers(); mock.windows = []; mock.sources.mockReset(); mock.execute.mockReset()
    mock.sources.mockResolvedValue([{ id: 'window:123:0' }, { id: 'window:456:0' }])
    mock.execute.mockResolvedValue({ data: 'data:image/jpeg;base64,YWJj', width: 640, height: 480 })
  })
  afterEach(() => { stopJournalCapture(); vi.useRealTimers() })
  it('requests zero thumbnails and grants only the selected window once, with no audio', async () => {
    mock.execute.mockImplementation(async () => {
      const callback = vi.fn(), frame = mock.windows[0].webContents.mainFrame
      mock.permission.display({ frame, videoRequested: true, audioRequested: false }, callback)
      expect(callback).toHaveBeenLastCalledWith({ video: { id: 'window:123:0' } })
      mock.permission.display({ frame, videoRequested: true, audioRequested: false }, callback)
      expect(callback).toHaveBeenLastCalledWith({})
      return { data: 'data:image/jpeg;base64,YWJj', width: 640, height: 480 }
    })
    expect((await captureJournalWindow('123')).bytes.length).toBe(3)
    expect(mock.sources).toHaveBeenCalledWith({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
    expect(mock.windows[0].options).toMatchObject({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } })
  })
  it('does not capture a different window when the requested HWND is missing', async () => {
    await expect(captureJournalWindow('999')).rejects.toThrow('无法采集')
    expect(mock.windows).toHaveLength(0)
    expect(mock.execute).not.toHaveBeenCalled()
  })
  it('keeps single-flight protection for a late enumeration after timeout', async () => {
    let finish!: (value: any) => void
    mock.sources.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = captureJournalWindow('123').catch(error => error)
    await vi.advanceTimersByTimeAsync(8000)
    expect((await pending).message).toContain('超时')
    await expect(captureJournalWindow('123')).rejects.toThrow('上一轮')
    finish([{ id: 'window:123:0' }]); await vi.advanceTimersByTimeAsync(0)
    expect(mock.windows).toHaveLength(0)
    await expect(captureJournalWindow('123')).resolves.toHaveProperty('width', 640)
  })
  it('destroys the renderer on cancellation and ignores a late frame', async () => {
    let finish!: (value: any) => void
    mock.execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = captureJournalWindow('123').catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    stopJournalCapture()
    expect((await pending).message).toContain('取消')
    expect(mock.windows[0].destroyed).toBe(true)
    finish({ data: 'data:image/jpeg;base64,YWJj', width: 640, height: 480 }); await vi.advanceTimersByTimeAsync(0)
  })
})
