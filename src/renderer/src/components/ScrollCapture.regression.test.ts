import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { isScrollCaptureRegion } from '../../../shared/capture'

const read = (relative: string): string => readFileSync(resolve(process.cwd(), relative), 'utf8')

const captureShared = read('src/shared/capture.ts')
const ipcSource = read('src/main/ipc.ts')
const preloadSource = read('src/preload/index.ts')
const scrollingSource = read('src/main/scrolling-capture.ts')
const overlaySource = read('src/renderer/src/components/ScreenCapture/ScreenCapture.tsx')
const inputSource = read('src/renderer/src/components/ChatPanel/InputArea.tsx')
const appSource = read('src/renderer/src/App.tsx')

describe('isScrollCaptureRegion', () => {
  it('accepts a well-formed region', () => {
    expect(isScrollCaptureRegion({ x: 0, y: 12.5, width: 300, height: 200 })).toBe(true)
  })

  it('rejects malformed input', () => {
    expect(isScrollCaptureRegion(null)).toBe(false)
    expect(isScrollCaptureRegion({})).toBe(false)
    expect(isScrollCaptureRegion({ x: 0, y: 0, width: 0, height: 10 })).toBe(false)
    expect(isScrollCaptureRegion({ x: 0, y: 0, width: 10, height: Number.NaN })).toBe(false)
    expect(isScrollCaptureRegion('nope')).toBe(false)
  })
})

describe('scrolling capture contract', () => {
  it('exposes the region and result types from shared code', () => {
    expect(captureShared).toContain('export interface ScrollCaptureRegion')
    expect(captureShared).toContain('export interface ScrollCaptureResult')
  })

  it('registers the IPC handler and hides the window while capturing', () => {
    expect(ipcSource).toContain("ipcMain.handle('capture-scroll-region'")
    expect(ipcSource).toContain('isScrollCaptureRegion(region)')
    expect(ipcSource).toContain('mainWindow.hide()')
    expect(ipcSource).toContain("mainWindow.webContents.send('scroll-capture:progress'")
    expect(ipcSource).toContain('captureScrollingRegion(clamped')
  })

  it('exposes the capture API through the preload bridge', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('capture-scroll-region', region)")
    expect(preloadSource).toContain("ipcRenderer.on('scroll-capture:progress'")
  })

  it('keeps the stitching primitives free of electron imports', () => {
    expect(read('src/main/scroll-stitch.ts')).not.toContain("from 'electron'")
  })

  it('waits for content to move instead of spending the frame budget', () => {
    expect(scrollingSource).toContain('while (captured < maxFrames && Date.now() < deadline)')
    expect(scrollingSource).toContain('STABLE_ROUNDS_TO_STOP')
    expect(scrollingSource).toContain('options.timeoutMs ?? DEFAULT_TIMEOUT_MS')
  })

  it('cleans up the scroll helper process', () => {
    expect(scrollingSource).toContain('finally {')
    expect(scrollingSource).toMatch(/scroller\s*&&\s*!scroller\.killed/)
  })
})

describe('scrolling capture UI', () => {
  it('replaces the placeholder menu entry with a working action', () => {
    expect(inputSource).not.toContain('滚动截图（稍后支持）')
    expect(inputSource).toContain('滚动截图（长图）')
    expect(inputSource).toContain('const doScrollScreenshot = useCallback')
    expect(inputSource).toContain('onScrollScreenshot?.(')
  })

  it('asks the overlay to hand the region over instead of cropping it', () => {
    expect(overlaySource).toContain("mode?: 'crop' | 'scroll'")
    expect(overlaySource).toContain('onScrollCapture?.(r)')
    // The scroll target is wherever the cursor is, so it must sit inside the selection.
    expect(overlaySource).toContain('请把鼠标移到选区内')
    expect(overlaySource).toContain('is-busy')
  })

  it('tells the user to scroll by hand when injection is unavailable', () => {
    expect(overlaySource).toContain('若页面没有自动滚动，请手动滚动鼠标')
  })

  it('wires the App flow end to end', () => {
    expect(appSource).toContain('const startScrollScreenshot')
    expect(appSource).toContain('const handleScrollCapture')
    expect(appSource).toContain('electronAPI.captureScrollRegion(')
    expect(appSource).toContain('onScrollCapture={handleScrollCapture}')
    expect(appSource).toContain('mode={captureMode}')
    expect(appSource).toContain('onScrollScreenshot={startScrollScreenshot}')
  })
})
