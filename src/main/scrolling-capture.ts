import { spawn, type ChildProcess } from 'child_process'
import { desktopCapturer, nativeImage, screen } from 'electron'
import type { Display, NativeImage } from 'electron'
import { stitchFrames, toRawFrame, type RawFrame } from './scroll-stitch'

/** Region expressed in window/CSS pixels, as reported by the renderer. */
export interface ScrollCaptureRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface ScrollCaptureOptions {
  maxFrames?: number
  frameIntervalMs?: number
  /** Overall budget, including time spent waiting for manual scrolling. */
  timeoutMs?: number
  /** Wheel delta per scroll step (Windows only). Negative scrolls down. */
  scrollDelta?: number
  onProgress?: (info: { frames: number }) => void
  isCancelled?: () => boolean
}

export interface ScrollCaptureResult {
  dataUrl: string | null
  frames: number
  height: number
  /** False when the platform has no automatic scroll injection. */
  autoScroll: boolean
  error?: string
}

const DEFAULT_MAX_FRAMES = 40
const DEFAULT_FRAME_INTERVAL_MS = 260
const DEFAULT_TIMEOUT_MS = 20000
const DEFAULT_SCROLL_DELTA = -120
// Rotations without any change before the capture is considered finished.
// Generous enough that a user scrolling by hand does not get cut off.
const STABLE_ROUNDS_TO_STOP = 3
const MIN_REGION_PX = 24
const MAX_OUTPUT_HEIGHT = 8000

/** Scroll steps issued between two captured frames. */
const STEPS_PER_FRAME: Record<string, number> = { win32: 3, darwin: 10 }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function grabDisplay(display: Display): Promise<NativeImage | null> {
  const scale = display.scaleFactor || 1
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.max(1, Math.round(display.size.width * scale)),
      height: Math.max(1, Math.round(display.size.height * scale))
    },
    fetchWindowIcons: false
  })
  const source = sources.find((candidate) => candidate.display_id === String(display.id)) || sources[0]
  if (!source) return null
  const image = source.thumbnail
  const size = image.getSize()
  if (size.width <= 0 || size.height <= 0) return null
  return image
}

/**
 * Spawns a helper that keeps scrolling the content under the cursor while the
 * capture loop runs. Returns `null` on platforms without a usable mechanism,
 * in which case the caller relies on the user scrolling manually.
 */
function startAutoScroll(totalSteps: number, delta: number, stepIntervalMs: number): ChildProcess | null {
  if (totalSteps <= 0) return null
  const stepsPerFrame = STEPS_PER_FRAME[process.platform]

  if (process.platform === 'win32') {
    // mouse_event keeps the scroll smooth and delta-controllable, unlike SendKeys.
    const definition = '[DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, int extra);'
    const script = [
      `Add-Type -MemberDefinition '${definition}' -Name ChouYuInput -Namespace ChouYu;`,
      `for ($i = 0; $i -lt ${totalSteps}; $i++) {`,
      `  [ChouYuInput]::mouse_event(0x0800, 0, 0, ${delta}, 0);`,
      `  Start-Sleep -Milliseconds ${stepIntervalMs};`,
      '}'
    ].join(' ')
    return spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: 'ignore'
    })
  }

  if (process.platform === 'darwin') {
    // Requires accessibility permission; otherwise the user scrolls manually.
    const script = `repeat ${totalSteps} times\n  tell application "System Events" to key code 125\n  delay ${(stepIntervalMs / 1000).toFixed(3)}\nend repeat`
    return spawn('osascript', ['-e', script], { stdio: 'ignore' })
  }

  return null
}

/**
 * Captures a screen region repeatedly while the content beneath it scrolls,
 * then stitches the frames into a single tall image.
 *
 * The region is given in CSS pixels relative to the overlay window, which
 * always sits at the origin of the primary display's work area.
 */
export async function captureScrollingRegion(
  region: ScrollCaptureRegion,
  options: ScrollCaptureOptions = {}
): Promise<ScrollCaptureResult> {
  const maxFrames = Math.max(1, options.maxFrames ?? DEFAULT_MAX_FRAMES)
  const frameIntervalMs = options.frameIntervalMs ?? DEFAULT_FRAME_INTERVAL_MS
  const scrollDelta = options.scrollDelta ?? DEFAULT_SCROLL_DELTA
  const stepsPerFrame = STEPS_PER_FRAME[process.platform] ?? 0
  const stepIntervalMs = Math.max(16, Math.round(frameIntervalMs / Math.max(1, stepsPerFrame)))

  const display = screen.getPrimaryDisplay()
  let scroller: ChildProcess | null = null
  const frames: RawFrame[] = []

  try {
    const probe = await grabDisplay(display)
    if (!probe) return { dataUrl: null, frames: 0, height: 0, autoScroll: false, error: '无法读取屏幕内容，请检查系统的屏幕录制权限。' }

    const probeSize = probe.getSize()
    const ratioX = probeSize.width / display.size.width
    const ratioY = probeSize.height / display.size.height
    const offsetX = display.workArea.x - display.bounds.x
    const offsetY = display.workArea.y - display.bounds.y

    const left = Math.max(0, Math.round((offsetX + region.x) * ratioX))
    const top = Math.max(0, Math.round((offsetY + region.y) * ratioY))
    const width = Math.max(MIN_REGION_PX, Math.round(region.width * ratioX))
    const height = Math.max(MIN_REGION_PX, Math.round(region.height * ratioY))
    const bounds = {
      x: Math.min(left, Math.max(0, probeSize.width - MIN_REGION_PX)),
      y: Math.min(top, Math.max(0, probeSize.height - MIN_REGION_PX)),
      width: Math.min(width, probeSize.width),
      height: Math.min(height, probeSize.height)
    }

    scroller = startAutoScroll(maxFrames * (stepsPerFrame || 1), scrollDelta, stepIntervalMs)
    const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    let stableRounds = 0
    let captured = 0

    // Only successful frames consume the budget: waiting for the content to
    // move (automatic scroll injection unavailable, or the user scrolling by
    // hand) must not shorten the capture.
    while (captured < maxFrames && Date.now() < deadline) {
      const shot = await grabDisplay(display)
      if (!shot) break
      const frame = toRawFrame(shot.crop(bounds).toBitmap(), bounds.width, bounds.height)
      if (!frame) break

      const previous = frames[frames.length - 1]
      if (previous && previous.buffer.equals(frame.buffer)) {
        stableRounds += 1
        if (stableRounds >= STABLE_ROUNDS_TO_STOP) break
      } else {
        stableRounds = 0
        frames.push(frame)
        captured += 1
      }

      options.onProgress?.({ frames: frames.length })
      if (options.isCancelled?.()) break
      if (captured < maxFrames) await sleep(frameIntervalMs)
    }

    if (frames.length === 0) {
      return { dataUrl: null, frames: 0, height: 0, autoScroll: Boolean(scroller), error: '没有捕获到任何画面，请重试。' }
    }

    const stitched = stitchFrames(frames, { maxHeight: MAX_OUTPUT_HEIGHT })
    if (!stitched) {
      return { dataUrl: null, frames: frames.length, height: 0, autoScroll: Boolean(scroller), error: '画面拼接失败，请缩小选区后重试。' }
    }

    const image = nativeImage.createFromBuffer(stitched.buffer, { width: stitched.width, height: stitched.height })
    const dataUrl = `data:image/png;base64,${image.toPNG().toString('base64')}`
    return { dataUrl, frames: frames.length, height: stitched.height, autoScroll: Boolean(scroller) }
  } catch (error) {
    return {
      dataUrl: null,
      frames: frames.length,
      height: 0,
      autoScroll: Boolean(scroller),
      error: error instanceof Error ? error.message : '滚动截图失败，请重试。'
    }
  } finally {
    if (scroller && !scroller.killed) scroller.kill()
  }
}
